/**
 * Regression: ISSUE-005 — an `%%action` rule opens as a `collect` table (every
 * row that fits runs), but the editor treated it as `first`: it asked for a
 * catch-all row — which under `collect` would act on every record — warned
 * that the whole-record input "reads no field", and its Test panel offered
 * one "Record" box that could never match an expression.
 * Found by /qa on 2026-09-25.
 */

import { describe, expect, it } from "vitest";
import {
  checkCoverage,
  type DecisionTable,
  evaluateExpression,
  evaluateTable,
  expressionFields,
  validateDecisionTable,
} from "../decision-table";

const actions = (): DecisionTable => ({
  hitPolicy: "collect",
  inputs: [{ id: "i1", name: "Record", field: "" }],
  outputs: [
    { id: "o1", name: "Action", field: "action" },
    { id: "o2", name: "Message", field: "message" },
  ],
  rules: [
    { _id: "a", i1: 'status == "withdrawn" and withdrawn_on == null', o1: "prevent", o2: "Date." },
    { _id: "b", i1: 'status == "withdrawn"', o1: "trigger-workflow", o2: "" },
    { _id: "c", i1: "amount > balance_before", o1: "prevent", o2: "Too much." },
  ],
});

describe("an %%action (collect) table", () => {
  it("runs every row that fits, not just the first", () => {
    const result = evaluateTable(actions(), { status: "withdrawn", withdrawn_on: "" });
    expect(result.matches.map((m) => m.rowIndex)).toEqual([0, 1]);
    expect(result.rowIndex).toBe(0);
  });

  it("reads fields on both sides of a comparison", () => {
    expect(evaluateTable(actions(), { amount: "120", balance_before: "100" }).rowIndex).toBe(2);
    expect(evaluateTable(actions(), { amount: "80", balance_before: "100" }).rowIndex).toBeNull();
    expect(expressionFields(actions())).toEqual([
      "status",
      "withdrawn_on",
      "amount",
      "balance_before",
    ]);
  });

  it("does not ask for a catch-all, and says what a blank row would do", () => {
    expect(checkCoverage(actions())).toEqual([
      {
        level: "ok",
        message:
          "Each row runs on its own when its check fits. A record that no row fits passes untouched.",
      },
    ]);
    const withBlank = actions();
    withBlank.rules.push({ _id: "d", i1: "", o1: "prevent", o2: "" });
    expect(checkCoverage(withBlank)[0]).toEqual({
      level: "warn",
      message: "Row 4 has no check, so its action runs on every record.",
    });
  });

  it("does not call the whole-record input a missing field", () => {
    expect(validateDecisionTable(actions())).toEqual([]);
  });
});

describe("evaluateExpression", () => {
  it("binds and tighter than or, and reads null, booleans and numbers", () => {
    const v = { a: "1", b: "true", c: "" };
    expect(evaluateExpression("a == 2 or b == true and c == null", v)).toBe(true);
    expect(evaluateExpression("a >= 1 and b == false", v)).toBe(false);
  });

  it("declines what it cannot read rather than guessing", () => {
    expect(evaluateExpression("len(name) > 3", {})).toBeUndefined();
    expect(evaluateExpression("> 5", {})).toBeUndefined();
  });

  it("leaves a first-policy table's plain cells to the old matcher", () => {
    const table: DecisionTable = {
      hitPolicy: "first",
      inputs: [{ id: "i1", name: "Score", field: "score" }],
      outputs: [{ id: "o1", name: "Band", field: "band" }],
      rules: [
        { _id: "a", i1: ">= 70", o1: "high" },
        { _id: "b", i1: "", o1: "low" },
      ],
    };
    expect(evaluateTable(table, { score: "75" }).matches).toEqual([
      { rowIndex: 0, outputs: { band: "high" } },
    ]);
    expect(checkCoverage(table)[0]?.level).toBe("ok");
  });
});
