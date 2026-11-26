/**
 * The browser runtime and zen-engine must agree about a graph that computes.
 *
 * `rules.js` read every non-table node by its *name* — the flowchart reader —
 * so a function node labelled "Score" decided whatever "Score" sounded like, and
 * a switch's statements were never looked at. The graph editor's rules saved,
 * generated and, in a tab, did nothing.
 *
 * Each case below is run through both engines and the two answers compared:
 * the property that matters is that a write refused by the deployed stack is
 * refused in the browser too, not that the browser matches a fixture.
 */

import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain ESM JavaScript shipped as a template, no types.
import { evaluateRules } from "../../../templates/wasm/server/lib/rules.js";
import { compileRules } from "../index";

const { ZenEngine } = createRequire(path.resolve(__dirname, "../../../../core/package.json"))(
  "@gorules/zen-engine"
) as typeof import("@gorules/zen-engine");
const engine = new ZenEngine();

const pos = { x: 0, y: 0 };
const node = (id: string, type: string, content?: unknown) => ({
  id,
  type,
  name: id,
  position: pos,
  ...(content === undefined ? {} : { content }),
});
const edge = (from: string, to: string, sourceHandle?: string) => ({
  id: `${from}-${to}`,
  type: "edge",
  sourceId: from,
  targetId: to,
  ...(sourceHandle ? { sourceHandle } : {}),
});

function compile(graph: unknown): string {
  const [rule] = compileRules([
    {
      name: "qa",
      entity: "Invoice",
      event: "beforeUpdate",
      priority: 1,
      flowchart: `flowchart TD\n    A([Rule]) --> B([Result])\n    %%jdm-graph ${JSON.stringify(graph)}`,
    },
  ]);
  if (!rule) throw new Error("did not compile");
  return rule.jdmContent;
}

/** What the deployed stack decides: the `action` zen returns. */
async function zenAction(jdm: string, record: Record<string, unknown>) {
  const out = (await engine.createDecision(Buffer.from(jdm)).evaluate(record)).result as {
    action?: string;
  };
  return out?.action;
}

async function browserRefuses(jdm: string, record: Record<string, unknown>) {
  const out = await evaluateRules([{ name: "qa", jdm_content: jdm }], record, {
    columns: Object.keys(record),
  });
  return (out.violations as unknown[]).length > 0;
}

const chain = {
  nodes: [
    node("in", "inputNode"),
    node("fee", "expressionNode", {
      expressions: [{ id: "e", key: "owed", value: "total - paid" }],
    }),
    node("t", "decisionTableNode", {
      hitPolicy: "first",
      inputs: [{ id: "i1", name: "Owed", field: "owed" }],
      outputs: [
        { id: "o1", name: "Action", field: "action" },
        { id: "o2", name: "Message", field: "message" },
      ],
      rules: [
        { _id: "r1", i1: "> 0", o1: '"validation-error"', o2: '"Balance outstanding"' },
        { _id: "r2", i1: "", o1: '"allow"', o2: '""' },
      ],
    }),
    node("out", "outputNode"),
  ],
  edges: [edge("in", "fee"), edge("fee", "t"), edge("t", "out")],
};

const viaFunction = {
  nodes: [
    node("in", "inputNode"),
    node("fn", "functionNode", {
      source:
        "export const handler = async (input) => ({ action: input.amount > 1000 ? 'prevent' : 'allow', message: 'Too large' });",
    }),
    node("out", "outputNode"),
  ],
  edges: [edge("in", "fn"), edge("fn", "out")],
};

const viaSwitch = {
  nodes: [
    node("in", "inputNode"),
    node("sw", "switchNode", {
      hitPolicy: "first",
      statements: [
        { id: "big", condition: "amount > 1000" },
        { id: "rest", condition: "", isDefault: true },
      ],
    }),
    node("block", "expressionNode", {
      expressions: [
        { id: "a", key: "action", value: "'prevent'" },
        { id: "b", key: "message", value: "'Needs approval'" },
      ],
    }),
    node("ok", "expressionNode", { expressions: [{ id: "c", key: "action", value: "'allow'" }] }),
    node("out", "outputNode"),
  ],
  edges: [
    edge("in", "sw"),
    edge("sw", "block", "big"),
    edge("sw", "ok", "rest"),
    edge("block", "out"),
    edge("ok", "out"),
  ],
};

describe("the browser runtime agrees with zen-engine on a graph that computes", () => {
  const cases: Array<[string, unknown, Record<string, unknown>, boolean]> = [
    ["expression into a table, balance owed", chain, { total: 100, paid: 40 }, true],
    ["expression into a table, paid in full", chain, { total: 100, paid: 100 }, false],
    ["function node over the limit", viaFunction, { amount: 5000 }, true],
    ["function node under the limit", viaFunction, { amount: 10 }, false],
    ["switch taking the first branch", viaSwitch, { amount: 5000 }, true],
    ["switch taking the default branch", viaSwitch, { amount: 10 }, false],
  ];

  for (const [name, graph, record, refused] of cases) {
    it(name, async () => {
      const jdm = compile(graph);
      const zen = await zenAction(jdm, record);
      expect(zen === "prevent").toBe(refused);
      expect(await browserRefuses(jdm, record)).toBe(refused);
    });
  }
});
