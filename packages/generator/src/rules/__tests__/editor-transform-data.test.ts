/**
 * Regression: a transform written in the rule editors did nothing.
 *
 * The table editor offers **Field** and **Value** columns for a `transform`
 * row, and its help page tells the author to fill them. The generated runtime
 * applies one `transformData` object and, finding none, logs "has no
 * transformData — skipping". `%%action` rules were translated for this
 * (ISSUE-005); rows authored in the table editor or the graph editor were not,
 * so a transform written exactly as documented never changed a record.
 */

import { ZenEngineSingleton } from "@appwithai/core/rules";
import { describe, expect, it } from "vitest";
import { compileRules } from "../index";
import type { JdmGraph } from "../jdm-converter";

const table = {
  hitPolicy: "first",
  inputs: [{ id: "i1", name: "Credits", field: "credits_purchased" }],
  outputs: [
    { id: "o1", name: "Action", field: "action" },
    { id: "o2", name: "Field", field: "field" },
    { id: "o3", name: "Value", field: "value" },
  ],
  rules: [
    { _id: "r1", i1: "> 0", o1: "transform", o2: "status", o3: "active" },
    { _id: "r2", i1: "", o1: "validation-error", o2: "", o3: "" },
  ],
};

const compile = (flowchart: string) => {
  const [rule] = compileRules([
    { name: "stamp", entity: "Pack", event: "beforeCreate", priority: 1, flowchart },
  ]);
  if (!rule) throw new Error("did not compile");
  const graph = JSON.parse(rule.jdmContent) as JdmGraph;
  const node = graph.nodes.find((n) => n.type === "decisionTableNode");
  return node?.content as {
    outputs: Array<{ id: string; field: string }>;
    rules: Array<Record<string, string>>;
  };
};

const dataOf = (content: ReturnType<typeof compile>, row: number) => {
  const column = content.outputs.find((o) => o.field === "transformData");
  return column ? content.rules[row]?.[column.id] : undefined;
};

describe("a transform authored in an editor carries transformData", () => {
  it("from the table editor's Field and Value columns", () => {
    const content = compile(
      `flowchart TD\n    A([Rule table]) --> B([Result])\n    %%decision-table ${JSON.stringify(table)}`
    );
    expect(dataOf(content, 0)).toBe(`'{"status":"active"}'`);
    // A row that is not a transform carries an empty cell — zen skips a row with no cell at all.
    expect(dataOf(content, 1)).toBe("");
  });

  it("from the graph editor's decision-table node", () => {
    const graph = {
      nodes: [
        { id: "in", type: "inputNode", name: "in" },
        {
          id: "t",
          type: "decisionTableNode",
          name: "t",
          content: {
            hitPolicy: "first",
            inputs: [{ id: "i1", name: "Credits", field: "credits_purchased" }],
            outputs: table.outputs,
            rules: [{ _id: "r1", i1: "> 0", o1: '"transform"', o2: '"status"', o3: '"active"' }],
          },
        },
        { id: "out", type: "outputNode", name: "out" },
      ],
      edges: [
        { id: "a", sourceId: "in", targetId: "t" },
        { id: "b", sourceId: "t", targetId: "out" },
      ],
    };
    const content = compile(
      `flowchart TD\n    A([Rule]) --> B([Result])\n    %%jdm-graph ${JSON.stringify(graph)}`
    );
    expect(dataOf(content, 0)).toBe(`'{"status":"active"}'`);
  });

  it("leaves a table that already writes transformData alone", () => {
    const withData = {
      ...table,
      outputs: [...table.outputs, { id: "o4", name: "Data", field: "transformData" }],
      rules: [{ _id: "r1", i1: "> 0", o1: "transform", o2: "status", o3: "active", o4: "{}" }],
    };
    const content = compile(
      `flowchart TD\n    A([T]) --> B([R])\n    %%decision-table ${JSON.stringify(withData)}`
    );
    expect(content.outputs.filter((o) => o.field === "transformData")).toHaveLength(1);
  });
});

describe("a table that mixes a refusal, a transform and a default", () => {
  const mixed = {
    hitPolicy: "first",
    inputs: [{ id: "i1", name: "Minutes late", field: "minutes_late" }],
    outputs: [
      { id: "o1", name: "Action", field: "action" },
      { id: "o2", name: "Message", field: "message" },
      { id: "o3", name: "Field", field: "field" },
      { id: "o4", name: "Value", field: "value" },
    ],
    rules: [
      { _id: "r1", i1: ">= 60", o1: '"validation-error"', o2: '"Far too late"', o3: "", o4: "" },
      { _id: "r2", i1: ">= 30", o1: '"transform"', o2: "", o3: '"status"', o4: '"late"' },
      { _id: "r3", i1: "", o1: '"allow"', o2: "", o3: "", o4: "" },
    ],
  };

  const graph = {
    nodes: [
      { id: "in", type: "inputNode", name: "in" },
      { id: "t", type: "decisionTableNode", name: "t", content: mixed },
      { id: "out", type: "outputNode", name: "out" },
    ],
    edges: [
      { id: "a", sourceId: "in", targetId: "t" },
      { id: "b", sourceId: "t", targetId: "out" },
    ],
  };

  const answer = async (minutesLate: number) => {
    const [rule] = compileRules([
      {
        name: "ladder",
        entity: "AttendanceRecord",
        event: "beforeCreate",
        priority: 1,
        flowchart: `flowchart TD\n    A([Rule]) --> B([Result])\n    %%jdm-graph ${JSON.stringify(graph)}`,
      },
    ]);
    const evaluated = await ZenEngineSingleton.evaluate(JSON.parse(rule?.jdmContent ?? "{}"), {
      minutes_late: minutesLate,
    });
    return evaluated.decision?.result as Record<string, unknown> | undefined;
  };

  it("answers each row's own case — the refusal and the default still fire", async () => {
    expect((await answer(90))?.action).toBe("prevent");
    expect((await answer(45))?.action).toBe("transform");
    expect((await answer(2))?.action).toBe("allow");
  });
});
