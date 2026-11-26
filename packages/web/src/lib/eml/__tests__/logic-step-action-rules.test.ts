/**
 * A rule written as `%%action` directives, opened on the Logic step.
 *
 * The Logic step read rules without asking how they were stored, so every rule
 * written as `%%action` lines — six of the education model's ten — opened as a
 * read-only flowchart whose only offer was "Start an empty table instead",
 * which discarded the actions. The Enhance page already knew better; both now
 * go through `toEditableRule`, and this holds the round trip they share.
 */

import { evaluateTable } from "@appwithai/editors/lib/eml/decision-table";
import { parseRuleActions } from "@appwithai/generator/rules";
import { describe, expect, it } from "vitest";
import { ruleForSave, toEditableRule } from "../editable-rule";

/** Admission Banding, from the education model. */
const BANDING = {
  name: "admissionBanding",
  entity: "AdmissionApplication",
  event: "beforeCreate",
  priority: 10,
  flowchart: `flowchart TD
    A([Application received]) --> B{Attainment recorded?}
    B -->|No| R[Band: review]
    B -->|Yes| P[Band: priority]

    %%action bandOnSibling transform when: has_sibling_enrolled == true field: admission_band value: priority
    %%action requireDecisionNotesOnRejection validation-error when: status == "rejected" and decision_notes == null message: A rejected application needs a note.
    %%action enrolOnAcceptance trigger-workflow when: status == "accepted" workflow: AdmissionToEnrolment`,
};

describe("an %%action rule on the Logic step", () => {
  it("opens as the table its actions compile to, not as a read-only flowchart", () => {
    const rule = toEditableRule(BANDING, "k1");
    expect(rule.sourceKind).toBe("actions");
    expect(rule.table.rules).toHaveLength(3);
    const action = rule.table.outputs.find((column) => column.field === "action");
    expect(action, "the table has no action column").toBeTruthy();
    expect(rule.table.rules.map((row) => row[action?.id ?? ""])).toEqual([
      "transform",
      "validation-error",
      "trigger-workflow",
    ]);
  });

  it("saves back as the same actions, with the flowchart kept", () => {
    const saved = ruleForSave(toEditableRule(BANDING, "k1"));
    expect(saved.flowchart).toContain("A([Application received])");
    expect(parseRuleActions(saved.flowchart).map((a) => a.name)).toEqual(
      parseRuleActions(BANDING.flowchart).map((a) => a.name)
    );
  });

  it("keeps an authored flowchart with no actions exactly as it came in", () => {
    const flowchart = "flowchart TD\n    A([Start]) --> B{Prior attainment recorded?}";
    const rule = toEditableRule({ ...BANDING, flowchart }, "k2");
    expect(rule.sourceKind).toBe("flowchart");
    expect(ruleForSave(rule).flowchart).toBe(flowchart);
  });
});

describe("testing a decision table with values", () => {
  // The cell reads `"cancelled"` and so did the value typed to test it; the
  // cell was unquoted and the value was not, so no row ever fit it.
  it("matches a quoted test value against a quoted cell", () => {
    const table = {
      hitPolicy: "first" as const,
      inputs: [
        { id: "i1", name: "Status", field: "status" },
        { id: "i2", name: "Balance", field: "balance_due" },
      ],
      outputs: [{ id: "o1", name: "Action", field: "action" }],
      rules: [
        { _id: "r1", i1: '"cancelled"', i2: "> 0", o1: "validation-error" },
        { _id: "r2", i1: "", i2: "", o1: "" },
      ],
    };
    expect(evaluateTable(table, { status: '"cancelled"', balance_due: "50" }).rowIndex).toBe(0);
    expect(evaluateTable(table, { status: "cancelled", balance_due: "50" }).rowIndex).toBe(0);
    expect(evaluateTable(table, { status: "cancelled", balance_due: "0" }).rowIndex).toBe(1);
  });
});
