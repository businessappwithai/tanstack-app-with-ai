import assert from "node:assert/strict";
import { test } from "vitest";
import { canonicalizeArchitecture, ensureLinkId } from "../src/core/model";
import { validateArchitecture } from "../src/core/validate";
import { generateFlowchart } from "../src/mermaid/flowchart";
import { executeQuery } from "../src/query/execute";

const graph = canonicalizeArchitecture({
  nodes: [
    { id: "root", type: "Domain", attributes: { name: "Sales" } },
    {
      id: "customer",
      type: "Entity",
      parent: "root",
      attributes: { domain: "Sales", fields: { creditLimit: { type: "money" } } },
    },
    { id: "order", type: "Entity", parent: "root", attributes: { domain: "Sales" } },
  ],
  links: [{ source: "customer", target: "order", type: "one-to-many" }],
});

test("stable link IDs are deterministic", () => {
  const a = ensureLinkId({ source: "a", target: "b", type: "Uses", attributes: { x: 1 } });
  const b = ensureLinkId({ source: "a", target: "b", type: "Uses", attributes: { x: 1 } });
  assert.equal(a.id, b.id);
});

test("architecture validation accepts nested attributes", () => {
  assert.equal(validateArchitecture(graph).ok, true);
});

test("query supports nested attributes and hierarchy", () => {
  const nested = executeQuery(graph, {
    nodes: {
      filters: [{ condition: { field: "attributes.fields.creditLimit", operator: "exists" } }],
    },
  });
  assert.deepEqual(
    nested.nodes.map((n) => n.id),
    ["customer"]
  );
  const descendant = executeQuery(graph, {
    nodes: { filters: [{ condition: { operator: "descendantOf", value: "root" } }] },
  });
  assert.deepEqual(descendant.nodes.map((n) => n.id).sort(), ["customer", "order"]);
});

test("flowchart output is deterministic", () => {
  const a = generateFlowchart(graph, { nodeLabel: "name" });
  const b = generateFlowchart(graph, { nodeLabel: "name" });
  assert.equal(a, b);
  assert.match(a, /customer -->\|one-to-many\| order/);
});

test("invalid parent cycles are rejected", () => {
  const result = validateArchitecture({
    nodes: [
      { id: "a", type: "X", parent: "b" },
      { id: "b", type: "X", parent: "a" },
    ],
    links: [],
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.code === "PARENT_CYCLE"));
});
