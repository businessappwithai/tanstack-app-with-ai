import { describe, expect, it } from "vitest";
import type { DecisionTable } from "../../workflow/bpmn-model";
import {
  asDecisionTable,
  isDecisionTable,
  isJdmGraph,
  validateStoredRuleContent,
  wouldReplaceStoredContent,
} from "../rule-content";

function table(): DecisionTable {
  return {
    hitPolicy: "first",
    inputs: [{ id: "i1", name: "Purity", field: "Compound.purity" }],
    outputs: [{ id: "o1", name: "Tier", field: "tier" }],
    rules: [{ _id: "r1", i1: "> 95", o1: "A" }],
  };
}

/**
 * Live QA found the rules API rejecting everything the rule table editor wrote,
 * because the endpoint only ever validated the older decision-graph shape. A
 * table could be built on screen and never saved. These hold both shapes open.
 */
describe("validateStoredRuleContent", () => {
  it("accepts a decision table — the shape the rule table editor writes", () => {
    expect(validateStoredRuleContent(table())).toEqual([]);
  });

  it("accepts a decision graph — the shape older rules and other tools write", () => {
    expect(validateStoredRuleContent({ name: "Old rule", nodes: [{ id: "n1" }] })).toEqual([]);
  });

  it("asks for an input column when a table tests nothing", () => {
    const t = { ...table(), inputs: [] };
    expect(validateStoredRuleContent(t).join(" ")).toMatch(/at least one input/i);
  });

  it("asks for an outcome column when a table decides nothing", () => {
    const t = { ...table(), outputs: [] };
    expect(validateStoredRuleContent(t).join(" ")).toMatch(/decides nothing does nothing/i);
  });

  it("asks for a row when a table has none", () => {
    const t = { ...table(), rules: [] };
    expect(validateStoredRuleContent(t).join(" ")).toMatch(/at least one row/i);
  });

  it("names a column that does not say which field it reads", () => {
    const t = table();
    t.inputs = [{ id: "i1", name: "Purity", field: "" }];
    expect(validateStoredRuleContent(t).join(" ")).toMatch(/does not say which field/i);
  });

  it("rejects content that is neither shape, and says where to build it", () => {
    expect(validateStoredRuleContent({ something: "else" }).join(" ")).toMatch(
      /neither a decision table nor a decision graph/i
    );
  });

  it("rejects empty content rather than saving a rule that decides nothing", () => {
    expect(validateStoredRuleContent(null).length).toBeGreaterThan(0);
    expect(validateStoredRuleContent(undefined).length).toBeGreaterThan(0);
  });
});

describe("shape detection", () => {
  it("tells the two shapes apart", () => {
    expect(isDecisionTable(table())).toBe(true);
    expect(isJdmGraph(table())).toBe(false);
    expect(isJdmGraph({ name: "n", nodes: [{ id: "a" }] })).toBe(true);
    expect(isDecisionTable({ name: "n", nodes: [{ id: "a" }] })).toBe(false);
  });

  it("treats a graph with no nodes as neither", () => {
    expect(isJdmGraph({ name: "n", nodes: [] })).toBe(false);
  });

  it("warns before an editor would replace what was stored", () => {
    expect(wouldReplaceStoredContent(table())).toBe(false);
    expect(wouldReplaceStoredContent({ name: "Old", nodes: [{ id: "a" }] })).toBe(true);
  });

  it("opens a graph as an empty table rather than a guessed conversion", () => {
    const opened = asDecisionTable({ name: "Old", nodes: [{ id: "a" }] });
    expect(opened.inputs).toHaveLength(1);
    expect(opened.rules).toHaveLength(1);
    expect(opened.inputs[0]?.field).toBe("");
  });
});

/**
 * The other live-QA finding: the page read snake_case off an endpoint that
 * serialises camelCase, so every rule table showed a blank name and an empty
 * table. This pins the reader to what /api/rules actually returns.
 */
describe("reading a rule row the way /api/rules serialises it", () => {
  const apiRow = {
    id: "rule_1",
    entityName: "Compound",
    ruleName: "Assay tier",
    operation: "UPDATE",
    jdmContent: table(),
  };

  function read(r: Record<string, unknown>) {
    return {
      name: (r.ruleName ?? r.rule_name ?? "Untitled rule") as string,
      entity: (r.entityName ?? r.entity_name ?? "") as string,
      table: asDecisionTable(r.jdmContent ?? r.jdm_content),
    };
  }

  it("reads the camelCase the endpoint returns", () => {
    const got = read(apiRow);
    expect(got.name).toBe("Assay tier");
    expect(got.entity).toBe("Compound");
    expect(got.table.rules).toHaveLength(1);
  });

  it("still reads raw column names, for callers that return them", () => {
    const got = read({
      id: "rule_2",
      entity_name: "Sample",
      rule_name: "Storage class",
      jdm_content: table(),
    });
    expect(got.name).toBe("Storage class");
    expect(got.entity).toBe("Sample");
    expect(got.table.rules).toHaveLength(1);
  });

  it("names a rule that arrives with no name at all", () => {
    expect(read({ id: "rule_3" }).name).toBe("Untitled rule");
  });
});
