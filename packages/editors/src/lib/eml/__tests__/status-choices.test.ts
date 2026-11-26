import { describe, expect, it } from "vitest";
import { emptyStateFlow } from "../../../components/eml/StateFlowCanvas";
import { sectionProblems } from "../section-problems";
import { emitStateFlow, parseStateFlow } from "../workflow-flow";
import { canBindStatus, statusChoicesFor, statusLabel } from "../workflow-hooks";

const MACHINE = [
  "stateDiagram-v2",
  "    [*] --> draft",
  "    draft --> to_be_reviewed : submit",
  "    to_be_reviewed --> approved : approve",
  "    approved --> [*]",
].join("\n");

const machine = (entity: string) => ({ entity, kind: "state", states: parseStateFlow(MACHINE) });

describe("what a record type can be bound to", () => {
  it("offers the states some arrow enters, not the first one", () => {
    const choices = statusChoicesFor("Contract", [machine("Contract")]);
    expect(choices.kind).toBe("machine");
    if (choices.kind === "machine") {
      expect(choices.states.map((s) => s.value)).toEqual(["to_be_reviewed", "approved"]);
    }
  });

  it("names each state as its button does, never by its raw id", () => {
    const choices = statusChoicesFor("Contract", [machine("Contract")]);
    expect(choices.kind === "machine" && choices.states.map((s) => s.label)).toEqual([
      "To be reviewed",
      "Approved",
    ]);
    expect(statusLabel("QUALIFICATION")).toBe("Qualification");
    expect(statusLabel("CLOSED_WON")).toBe("Closed won");
    expect(statusLabel("on-hold")).toBe("On hold");
  });

  it("falls back to Draft and Final for a record type with no flow", () => {
    expect(statusChoicesFor("Invoice", [machine("Contract")]).kind).toBe("default");
    expect(statusChoicesFor("Invoice", [{ entity: "Invoice", kind: "hook", states: emptyStateFlow() }])).toEqual({
      kind: "default",
    });
  });

  it("binds only to the update hooks", () => {
    expect(canBindStatus("afterUpdate")).toBe(true);
    expect(canBindStatus("beforeUpdate")).toBe(true);
    expect(canBindStatus("afterCreate")).toBe(false);
  });
});

describe("the page refuses a binding the checker would", () => {
  const stored = (status: string, extra: object = {}) => [
    { name: "ContractLifecycle", entity: "Contract", kind: "state", diagram: MACHINE },
    { name: "Review", entity: "Contract", kind: "hook", status, diagram: "flowchart TD", ...extra },
  ];

  it("accepts a state an arrow enters", () => {
    expect(sectionProblems([], stored("to_be_reviewed"))).toEqual([]);
  });

  it("refuses a state the flow does not draw", () => {
    expect(sectionProblems([], stored("signed")).map((p) => p.message).join(" ")).toMatch(/signed/);
  });

  it("refuses a status on a record type with no flow", () => {
    const problems = sectionProblems([], [
      { name: "Review", entity: "Invoice", kind: "hook", status: "final", diagram: "flowchart TD" },
    ]);
    expect(problems.map((p) => p.message).join(" ")).toMatch(/no status flow/);
  });

  it("refuses a saga that a create or a rule starts", () => {
    const saga = (extra: object) =>
      sectionProblems([], stored("to_be_reviewed", { kind: "saga", ...extra }));
    expect(saga({ operation: "CREATE" }).length).toBeGreaterThan(0);
    expect(saga({ operation: "UPDATE", trigger: "rule" }).length).toBeGreaterThan(0);
    expect(saga({ operation: "UPDATE", trigger: "automatic" })).toEqual([]);
  });

  it("round-trips the machine it reads", () => {
    expect(parseStateFlow(emitStateFlow(parseStateFlow(MACHINE), "Contract")).transitions).toHaveLength(2);
  });
});
