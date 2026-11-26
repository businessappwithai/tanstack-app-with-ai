/**
 * Regression: ISSUE-001 — a rule saved with no entity was written as
 * `%%rule name on  event: …`, which the checker read as a rule on an entity
 * called "event". The model still checked clean and the rule never fired.
 * Found by /qa on 2026-09-25.
 */

import { describe, expect, it } from "vitest";
import { sectionProblems } from "../section-problems";

describe("sectionProblems", () => {
  it("refuses a rule with no entity, and names it", () => {
    const problems = sectionProblems([{ name: "rule11", entity: "" }], []);
    expect(problems).toEqual([
      {
        kind: "rule",
        index: 0,
        message: 'Rule "rule11" has no entity. Choose the entity it runs on.',
      },
    ]);
  });

  it("refuses a process with no entity or no name", () => {
    const problems = sectionProblems([], [{ name: " ", entity: undefined }]);
    expect(problems.map((p) => p.message)).toEqual([
      "Process 1 has no name.",
      'Process "1" has no entity. Choose the entity it runs on.',
    ]);
    expect(problems.every((p) => p.kind === "workflow" && p.index === 0)).toBe(true);
  });

  it("accepts complete sections, preferring the title as the label", () => {
    expect(
      sectionProblems(
        [{ name: "a", title: "A", entity: "Student" }],
        [{ name: "B", entity: "Payment" }]
      )
    ).toEqual([]);
  });
});
