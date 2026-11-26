/**
 * Regression: a graph drawn in the Enhance page's graph editor never ran.
 *
 * The editor saves its whole graph as one `%%jdm-graph <json>` line. Nothing
 * compiled that line, so the rule fell through to the flowchart branch and
 * became an input wired to an output: an expression, function or switch node
 * saved, reloaded and decided nothing in the generated application.
 *
 * The property worth holding is that the compiled rule *evaluates*, so these
 * tests hand the compiled graph to the real zen engine rather than comparing it
 * with the graph that went in.
 */

import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileRules, validateJdmGraph } from "../index";
import type { JdmGraph } from "../jdm-converter";

// The engine is core's dependency, not the generator's: resolve it from there.
const { ZenEngine } = createRequire(path.resolve(__dirname, "../../../../core/package.json"))(
  "@gorules/zen-engine"
) as typeof import("@gorules/zen-engine");
const engine = new ZenEngine();

const flowchartFor = (graph: unknown) =>
  [
    "flowchart TD",
    "    Start([Rule]) --> End([Result])",
    `    %%jdm-graph ${JSON.stringify(graph)}`,
  ].join("\n");

function compile(graph: unknown, onWarn: (m: string) => void = () => {}) {
  const [rule] = compileRules(
    [
      {
        name: "graphRule",
        entity: "Invoice",
        event: "beforeUpdate",
        priority: 100,
        flowchart: flowchartFor(graph),
      },
    ],
    onWarn
  );
  return rule;
}

async function run(jdmContent: string, input: Record<string, unknown>) {
  const decision = engine.createDecision(Buffer.from(jdmContent));
  return (await decision.evaluate(input)).result as Record<string, unknown>;
}

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

describe("rules authored in the graph editor", () => {
  it("runs an expression node", async () => {
    const rule = compile({
      nodes: [
        node("in", "inputNode"),
        node("calc", "expressionNode", {
          expressions: [{ id: "e1", key: "total", value: "price * qty" }],
        }),
        node("out", "outputNode"),
      ],
      edges: [edge("in", "calc"), edge("calc", "out")],
    });
    expect(rule).toBeDefined();
    expect(await run(rule?.jdmContent ?? "", { price: 4, qty: 5 })).toMatchObject({ total: 20 });
  });

  const functionGraph = (content: unknown) => ({
    nodes: [
      node("in", "inputNode"),
      node("fn", "functionNode", content),
      node("out", "outputNode"),
    ],
    edges: [edge("in", "fn"), edge("fn", "out")],
  });
  const BAND =
    "export const handler = async (input) => ({ band: input.score >= 70 ? 'merit' : 'pass' });";

  it("runs a function node", async () => {
    const rule = compile(functionGraph({ source: BAND }));
    expect(await run(rule?.jdmContent ?? "", { score: 82 })).toMatchObject({ band: "merit" });
    expect(await run(rule?.jdmContent ?? "", { score: 40 })).toMatchObject({ band: "pass" });
  });

  it("wraps a bare-string function in { source }, the only shape the engine runs", async () => {
    // Handed through as written, a bare string either errors ("unsupported
    // keyword: export") or, without `export`, returns {} and decides nothing.
    const rule = compile(functionGraph(BAND));
    expect(await run(rule?.jdmContent ?? "", { score: 82 })).toMatchObject({ band: "merit" });
  });

  it("refuses a function node that defines no handler", () => {
    const warnings: string[] = [];
    expect(
      compile(functionGraph({ source: "const x = 1;" }), (m) => warnings.push(m))
    ).toBeUndefined();
    expect(warnings.join(" ")).toMatch(/no handler/);
  });

  it("routes a switch node to the branch whose condition fits", async () => {
    const rule = compile({
      nodes: [
        node("in", "inputNode"),
        node("sw", "switchNode", {
          hitPolicy: "first",
          statements: [
            { id: "big", condition: "amount > 1000" },
            { id: "small", condition: "" },
          ],
        }),
        node("bigTable", "expressionNode", {
          expressions: [{ id: "a", key: "route", value: "'review'" }],
        }),
        node("smallTable", "expressionNode", {
          expressions: [{ id: "b", key: "route", value: "'auto'" }],
        }),
        node("out", "outputNode"),
      ],
      edges: [
        edge("in", "sw"),
        edge("sw", "bigTable", "big"),
        edge("sw", "smallTable", "small"),
        edge("bigTable", "out"),
        edge("smallTable", "out"),
      ],
    });
    expect(await run(rule?.jdmContent ?? "", { amount: 5000 })).toMatchObject({ route: "review" });
    expect(await run(rule?.jdmContent ?? "", { amount: 20 })).toMatchObject({ route: "auto" });
  });

  it("writes the runtime's word for a refusal in a decision-table cell", async () => {
    const rule = compile({
      nodes: [
        node("in", "inputNode"),
        node("t", "decisionTableNode", {
          hitPolicy: "first",
          inputs: [{ id: "i1", name: "Balance", field: "balance_due" }],
          outputs: [{ id: "o1", name: "Action", field: "action" }],
          rules: [
            { _id: "r1", i1: "> 0", o1: '"validation-error"' },
            { _id: "r2", i1: "", o1: '"allow"' },
          ],
        }),
        node("out", "outputNode"),
      ],
      edges: [edge("in", "t"), edge("t", "out")],
    });
    // `prevent` is what RulesService.validate() rejects on; EML's own word is dropped.
    expect(await run(rule?.jdmContent ?? "", { balance_due: 10 })).toMatchObject({
      action: "prevent",
    });
    expect(await run(rule?.jdmContent ?? "", { balance_due: 0 })).toMatchObject({
      action: "allow",
    });
  });

  it("refuses a graph that cannot run, with a reason, instead of compiling it inert", () => {
    const warnings: string[] = [];
    const rule = compile(
      {
        nodes: [node("in", "inputNode"), node("calc", "expressionNode"), node("out", "outputNode")],
        edges: [edge("in", "calc"), edge("calc", "ghost")],
      },
      (m) => warnings.push(m)
    );
    expect(rule).toBeUndefined();
    expect(warnings.join(" ")).toMatch(/no content/);
    expect(warnings.join(" ")).toMatch(/not in the graph/);
  });

  it("keeps network and process access out of function nodes", () => {
    const problems = validateJdmGraph({
      nodes: [
        node("in", "inputNode"),
        node("fn", "functionNode", "export const handler = async () => fetch('http://x')"),
        node("out", "outputNode"),
      ],
      edges: [],
    } as unknown as JdmGraph);
    expect(problems.join(" ")).toMatch(/fetch/);
  });
});
