import { describe, expect, it } from "vitest";
import { emptyDecisionTable } from "../decision-table";
import {
  cellValues,
  constrainGraph,
  derivedNamesBefore,
  functionOutputs,
  graphProblems,
  withoutStockImport,
} from "../rule-graph-constraints";
import { sampleRecord, tableToGraph } from "../rule-templates";

describe("a rule's graph", () => {
  it("starts from the Record, not a Request", () => {
    const graph = tableToGraph(emptyDecisionTable(), "lateFee");
    expect(graph.nodes.find((n) => n.type === "inputNode")?.name).toBe("Record");
  });

  it("renames a stored graph's Request node, and only that one", () => {
    const stored = {
      nodes: [
        { id: "a", type: "inputNode", name: "Request" },
        { id: "b", type: "decisionTableNode", name: "Request" },
      ],
    };
    const shown = constrainGraph(stored, { fields: [], values: {}, workflowNames: [] });
    expect(shown.nodes.map((n) => n.name)).toEqual(["Record", "Request"]);
  });

  it("fills the sample record from the entity's own fields, not the managed ones", () => {
    expect(Object.keys(sampleRecord(["id", "status", "amount", "updated_at"]))).toEqual([
      "status",
      "amount",
    ]);
  });

  it("drops the import a new function node ships with, which the compiler refuses", () => {
    const stock =
      "import zen from 'zen';\n\n/** @type {Handler} **/\nexport const handler = async (input) => {\n  return input;\n};\n";
    expect(withoutStockImport(stock)).not.toMatch(/import/);
    expect(withoutStockImport({ source: stock })).toEqual({
      source: expect.not.stringMatching(/import/),
    });
    expect(withoutStockImport("export const handler = async (i) => i;")).toBe(
      "export const handler = async (i) => i;"
    );
  });
});

describe("a cell under a constrained column", () => {
  const constraints = {
    fields: ["status"],
    values: { status: ["open", "cancelled", "completed"] },
    workflowNames: [],
  };
  const graphWith = (cell: string) => ({
    nodes: [
      {
        id: "t",
        type: "decisionTableNode",
        content: {
          inputs: [{ id: "i1", field: "status" }],
          outputs: [],
          rules: [{ i1: cell }],
        },
      },
    ],
  });

  it("reads a list, a negation and a bare value as the values they name", () => {
    expect(cellValues('["cancelled","completed"]')).toEqual(["cancelled", "completed"]);
    expect(cellValues('"cancelled", "completed"')).toEqual(["cancelled", "completed"]);
    expect(cellValues('not("open")')).toEqual(["open"]);
    expect(cellValues('!= "open"')).toEqual(["open"]);
    expect(cellValues('"a,b"')).toEqual(["a,b"]);
    expect(cellValues("")).toEqual([]);
  });

  it('accepts "is one of" naming real statuses and flags the one that is not', () => {
    expect(graphProblems(graphWith('["cancelled","completed"]'), constraints)).toEqual([]);
    expect(graphProblems(graphWith('["cancelled","closed"]'), constraints)).toEqual([
      '"closed" is not an existing status for this entity.',
    ]);
  });

  it("does not flag a null cell as an invalid enum value — null means is-null in zen", () => {
    // Regression: /qa 2026-10-12
    // Report: .gstack/qa-reports/run-20261012T103545Z/qa-report.md
    expect(graphProblems(graphWith("null"), constraints)).toEqual([]);
    expect(graphProblems(graphWith("!= null"), constraints)).toEqual([]);
  });
});

describe("a name an earlier node worked out", () => {
  // Found building a thirty-rule flow in the generated CRM's editor: the verdict
  // table read `score` (from a function) and `discountCap` (from an earlier table),
  // and the editor called both "not a field of this entity".
  const constraints = { fields: ["amount", "probability"], values: {}, workflowNames: [] };
  const flow = (verdictCell: string, edges = true) => ({
    nodes: [
      { id: "rec", type: "inputNode" },
      {
        id: "derive",
        type: "expressionNode",
        content: { expressions: [{ id: "e1", key: "isLarge", value: "amount >= 100000" }] },
      },
      {
        id: "band",
        type: "decisionTableNode",
        content: {
          inputs: [{ id: "a", field: "amount" }],
          outputs: [{ id: "o1", field: "discountCap" }, { id: "o2", field: "tier" }],
          rules: [{ a: ">= 500000", o1: "25", o2: '"platinum"' }],
        },
      },
      {
        id: "score",
        type: "functionNode",
        content: {
          source:
            "export const handler = async (input) => {\n  let score = 50;\n  input.flag = true;\n  return { ...input, score, 'level': 1 };\n};",
        },
      },
      {
        id: "verdict",
        type: "decisionTableNode",
        content: {
          inputs: [{ id: "c" }],
          outputs: [{ id: "x", field: "action" }],
          rules: [{ c: verdictCell, x: '"allow"' }],
        },
      },
    ],
    edges: edges
      ? [
          { sourceId: "rec", targetId: "derive" },
          { sourceId: "derive", targetId: "band" },
          { sourceId: "band", targetId: "score" },
          { sourceId: "score", targetId: "verdict" },
        ]
      : [],
  });

  it("reads what a function hands on", () => {
    expect(
      functionOutputs({
        source:
          "export const handler = async (input) => {\n  input.flag = true;\n  return { ...input, score, 'level': 1, tier: \"a\" };\n};",
      }).sort()
    ).toEqual(["flag", "level", "score", "tier"]);
    expect(functionOutputs("export const handler = async (input) => input;")).toEqual([]);
  });

  it("is a field to every table after the node that produced it", () => {
    expect(derivedNamesBefore(flow(""), "verdict")).toEqual(
      new Set(["isLarge", "discountCap", "tier", "score", "flag", "level"])
    );
    expect(
      graphProblems(flow("discountCap >= 20 and score < 40 and isLarge and probability < 20"), constraints)
    ).toEqual([]);
  });

  it("is still unknown to a table that runs before it, and so is a name nothing produces", () => {
    expect(derivedNamesBefore(flow(""), "band")).toEqual(new Set(["isLarge"]));
    expect(graphProblems(flow("score < 40", false), constraints)).toEqual([
      '"score" is not a field of this entity.',
    ]);
    expect(graphProblems(flow("margin < 40"), constraints)).toEqual([
      '"margin" is not a field of this entity.',
    ]);
  });
});
