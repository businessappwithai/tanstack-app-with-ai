/**
 * Converting an authored `%%rule` flowchart into a decision table.
 *
 * The property worth holding is not "it produces a table" — it is that the
 * table decides what the diagram decided. So the cases below convert a tree
 * and then evaluate the result, and the refusals assert that a diagram which
 * cannot be a table is refused rather than approximated.
 *
 * The 54-row case is the one to keep. `leadScoring` first converted "fine":
 * every `Add 35 firmographic points` node had a single outgoing edge, so the
 * walk stepped through it, dropped what it did, kept the tests around it, and
 * produced 54 confident rows keyed on a `score` that nothing had computed.
 */

import { describe, expect, it } from "vitest";
import { evaluateTable } from "../decision-table";
import {
  convertFlowchartToTable,
  parseCondition,
  parseOutcome,
  readFlowchart,
} from "../flowchart-to-table";

const chart = (...lines: string[]) => ["flowchart TD", ...lines].join("\n");

describe("parseCondition", () => {
  it("reads equality as a bare value, the way the table editor writes it", () => {
    expect(parseCondition("case_type == incident?")).toEqual({
      field: "case_type",
      cell: "incident",
    });
  });

  it("keeps a comparison operator", () => {
    expect(parseCondition("employee_count >= 1000?")).toEqual({
      field: "employee_count",
      cell: ">= 1000",
    });
  });

  it("normalises a spelled-out field to a column name", () => {
    expect(parseCondition("account tier == strategic?")?.field).toBe("account_tier");
  });

  it("refuses a predicate that names no comparison", () => {
    // "owner assigned?" is a question about the record, not a test of a column.
    expect(parseCondition("owner assigned?")).toBeNull();
    expect(parseCondition("email present?")).toBeNull();
  });
});

describe("parseOutcome", () => {
  it("reads an assignment", () => {
    expect(parseOutcome("Set priority critical")).toEqual({ cells: { priority: "critical" } });
  });

  it("reads two assignments joined by and", () => {
    expect(parseOutcome("Set probability 100 and category closed")).toEqual({
      cells: { probability: "100", category: "closed" },
    });
  });

  it("reads a rejection as a validation error carrying its message", () => {
    expect(parseOutcome("Reject: Loss reason required")).toEqual({
      cells: { action: "validation-error", message: "Loss reason required" },
    });
  });

  it("refuses prose, which names no field to write", () => {
    expect(parseOutcome("Route to Partner Desk")).toBeNull();
    expect(parseOutcome("Add 35 firmographic points")).toBeNull();
    expect(parseOutcome("Grade renewal at risk")).toBeNull();
  });
});

describe("readFlowchart", () => {
  it("keeps node shapes and edge labels", () => {
    const { nodes, edges } = readFlowchart(
      chart("    A([Start]) --> B{x == 1?}", "    B -->|Yes| C[Set y two]")
    );
    expect(nodes.get("A")?.shape).toBe("stadium");
    expect(nodes.get("B")?.shape).toBe("diamond");
    expect(nodes.get("C")?.label).toBe("Set y two");
    expect(edges[1]?.label).toBe("Yes");
  });
});

describe("convertFlowchartToTable", () => {
  /** The shape of caseTriage: a tree three levels deep, re-testing one field. */
  const tree = chart(
    "    A([Start: Case Raised]) --> B{account tier == strategic?}",
    "    B -->|Yes| C{case_type == incident?}",
    "    C -->|Yes| D[Set priority critical]",
    "    C -->|No| E[Set priority high]",
    "    B -->|No| F{case_type == incident?}",
    "    F -->|Yes| G{account tier == enterprise?}",
    "    G -->|Yes| H[Set priority high]",
    "    G -->|No| I[Set priority medium]",
    "    F -->|No| J{case_type == billing?}",
    "    J -->|Yes| K[Set priority medium]",
    "    J -->|No| L[Set priority low]"
  );

  it("turns every root-to-leaf path into a row, in order", () => {
    const result = convertFlowchartToTable(tree);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.table.rules).toHaveLength(6);
    expect(result.table.inputs.map((c) => c.field)).toEqual(["account_tier", "case_type"]);
    expect(result.table.outputs.map((c) => c.field)).toEqual(["priority"]);
    expect(result.table.hitPolicy).toBe("first");
  });

  it("carries only the positive tests, leaning on first-match for the rest", () => {
    const result = convertFlowchartToTable(tree);
    if (!result.ok) throw new Error("expected a table");

    // Row 4 is reached by tier != strategic and case_type == incident. Only the
    // positive test is written; rows 1-3 above it already excluded the rest.
    const row = result.table.rules[3];
    expect(row?.i1).toBe("");
    expect(row?.i2).toBe("incident");
    expect(row?.o1).toBe("medium");
  });

  it("decides what the diagram decided", () => {
    const result = convertFlowchartToTable(tree);
    if (!result.ok) throw new Error("expected a table");

    const decide = (values: Record<string, string>) =>
      evaluateTable(result.table, values).outputs.priority;

    expect(decide({ account_tier: "strategic", case_type: "incident" })).toBe("critical");
    expect(decide({ account_tier: "strategic", case_type: "question" })).toBe("high");
    expect(decide({ account_tier: "enterprise", case_type: "incident" })).toBe("high");
    expect(decide({ account_tier: "smb", case_type: "incident" })).toBe("medium");
    expect(decide({ account_tier: "smb", case_type: "billing" })).toBe("medium");
    expect(decide({ account_tier: "smb", case_type: "question" })).toBe("low");
  });

  it("gives one column per assignment when a leaf sets two things", () => {
    const result = convertFlowchartToTable(
      chart(
        "    A([Start]) --> B{stage == closed_won?}",
        "    B -->|Yes| C[Set probability 100 and category closed]",
        "    B -->|No| D[Set probability 10 and category pipeline]"
      )
    );
    if (!result.ok) throw new Error("expected a table");
    expect(result.table.outputs.map((c) => c.field)).toEqual(["probability", "category"]);
    expect(evaluateTable(result.table, { stage: "closed_won" }).outputs).toEqual({
      probability: "100",
      category: "closed",
    });
  });

  it("refuses an accumulator rather than dropping the arithmetic", () => {
    const result = convertFlowchartToTable(
      chart(
        "    A([Start]) --> B{employee_count >= 1000?}",
        "    B -->|Yes| C[Add 35 firmographic points]",
        "    B -->|No| D[Add 5 firmographic points]",
        "    C --> P{score >= 70?}",
        "    D --> P",
        "    P -->|Yes| Q[Set rating hot]",
        "    P -->|No| R[Set rating cold]"
      )
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Naming the node that stopped it is the whole point: the old message said
    // only that branches would not carry over.
    expect(result.reason).toContain("Add 35 firmographic points");
  });

  it("refuses a leaf that describes an action instead of setting a field", () => {
    const result = convertFlowchartToTable(
      chart(
        "    A([Start]) --> B{lead_source == partner?}",
        "    B -->|Yes| C[Route to Partner Desk]",
        "    B -->|No| D[Route to SMB Queue]"
      )
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("Route to Partner Desk");
  });

  it("refuses a question that is not a comparison", () => {
    const result = convertFlowchartToTable(
      chart(
        "    A([Start]) --> B{email present?}",
        "    B -->|Yes| C[Set status qualified]",
        "    B -->|No| D[Set status incomplete]"
      )
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("email present");
  });

  it("refuses a branch missing its No arm", () => {
    const result = convertFlowchartToTable(
      chart("    A([Start]) --> B{stage == won?}", "    B -->|Yes| C[Set probability 100]")
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("Yes and a No");
  });

  it("reports a tested column the entity does not have", () => {
    const result = convertFlowchartToTable(tree, ["case_type", "priority"]);
    if (!result.ok) throw new Error("expected a table");
    expect(result.notes.join(" ")).toContain("account_tier");
  });

  it("always ends on a catch-all, because the all-No path carries no tests", () => {
    const result = convertFlowchartToTable(
      chart(
        "    A([Start]) --> B{stage == won?}",
        "    B -->|Yes| C[Set probability 100]",
        "    B -->|No| D{stage == lost?}",
        "    D -->|Yes| E[Set probability 0]",
        "    D -->|No| F[Reject: Unknown stage]"
      )
    );
    if (!result.ok) throw new Error("expected a table");

    const last = result.table.rules.at(-1);
    expect(result.table.inputs.every((c) => !(last?.[c.id] ?? "").trim())).toBe(true);
    // So every record reaches a row, whatever its stage.
    expect(evaluateTable(result.table, { stage: "anything" }).rowIndex).not.toBeNull();
  });
});
