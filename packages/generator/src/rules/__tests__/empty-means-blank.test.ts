/**
 * "Is empty" must match a blank string, in every engine that runs the rule.
 *
 * The table's "is empty" writes `null` and "is not empty" writes `!= null`, which zen
 * reads strictly. A text field a person clears arrives as `""`, so "Withdrawal needs a
 * reason" let a withdrawal through with its reason blanked — and "is not empty" counted a
 * blank as filled. The compiler now widens those two cells; the browser runtime reads the
 * same words the same way. Each case runs through both and compares.
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

const graphWith = (cell: string) => ({
  nodes: [
    { id: "in", type: "inputNode", name: "in", position: { x: 0, y: 0 } },
    {
      id: "t",
      type: "decisionTableNode",
      name: "t",
      position: { x: 1, y: 0 },
      content: {
        hitPolicy: "first",
        inputs: [{ id: "i1", name: "Reason", field: "reason" }],
        outputs: [{ id: "o1", name: "Action", field: "action" }],
        rules: [
          { _id: "r1", i1: cell, o1: '"validation-error"' },
          { _id: "r2", i1: "", o1: '"allow"' },
        ],
      },
    },
    { id: "out", type: "outputNode", name: "out", position: { x: 2, y: 0 } },
  ],
  edges: [
    { id: "a", type: "edge", sourceId: "in", targetId: "t" },
    { id: "b", type: "edge", sourceId: "t", targetId: "out" },
  ],
});

function compile(cell: string): string {
  const [rule] = compileRules([
    {
      name: "qa",
      entity: "Student",
      event: "beforeUpdate",
      priority: 1,
      flowchart: `flowchart TD\n    A([Rule]) --> B([Result])\n    %%jdm-graph ${JSON.stringify(graphWith(cell))}`,
    },
  ]);
  if (!rule) throw new Error("did not compile");
  return rule.jdmContent;
}

const zenRefuses = async (jdm: string, record: Record<string, unknown>) => {
  const out = (await engine.createDecision(Buffer.from(jdm)).evaluate(record)).result as {
    action?: string;
  };
  return out?.action === "prevent";
};

const browserRefuses = async (jdm: string, record: Record<string, unknown>) =>
  (
    (await evaluateRules([{ name: "qa", jdm_content: jdm }], record, { columns: ["reason"] }))
      .violations as unknown[]
  ).length > 0;

const RECORDS: Array<[string, Record<string, unknown>]> = [
  ["blank", { reason: "" }],
  ["null", { reason: null }],
  ["absent", {}],
  ["filled", { reason: "moved away" }],
];

describe("an input cell that says empty", () => {
  const expected = { blank: true, null: true, absent: true, filled: false };

  for (const [label, record] of RECORDS) {
    it(`${label}: zen and the browser runtime both say empty=${expected[label as keyof typeof expected]}`, async () => {
      const jdm = compile("null");
      const want = expected[label as keyof typeof expected];
      expect(await zenRefuses(jdm, record)).toBe(want);
      expect(await browserRefuses(jdm, record)).toBe(want);
    });
  }
});

describe("an input cell that says not empty", () => {
  const expected = { blank: false, null: false, absent: false, filled: true };

  for (const [label, record] of RECORDS) {
    it(`${label}: zen and the browser runtime both say notEmpty=${expected[label as keyof typeof expected]}`, async () => {
      const jdm = compile("!= null");
      const want = expected[label as keyof typeof expected];
      expect(await zenRefuses(jdm, record)).toBe(want);
      expect(await browserRefuses(jdm, record)).toBe(want);
    });
  }

  it("leaves a number alone: zero is not empty", async () => {
    const jdm = compile("!= null");
    expect(await zenRefuses(jdm, { reason: 0 })).toBe(true);
  });
});
