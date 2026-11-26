import { describe, expect, it } from "vitest";
import { emitWorkflowSection, extractWorkflowSections } from "../../../../../language/composer";
import { checkSource } from "../../../../../language/checker";

const MACHINE = [
  "stateDiagram-v2",
  "    [*] --> draft",
  "    draft --> to_be_reviewed : submit",
  "    to_be_reviewed --> approved : approve",
  "    approved --> [*]",
].join("\n");

describe("a workflow bound to a status", () => {
  it("writes status: on a saga and reads it back", () => {
    const text = emitWorkflowSection({
      name: "ContractReview",
      entity: "Contract",
      kind: "saga",
      trigger: "automatic",
      operation: "UPDATE",
      status: "to_be_reviewed",
      diagram: "flowchart TD\n    A([Start]) --> B([End])",
    });
    expect(text).toContain(
      "%%workflow ContractReview entity: Contract kind: saga operation: UPDATE status: to_be_reviewed"
    );
    const [back] = extractWorkflowSections(text);
    expect(back?.status).toBe("to_be_reviewed");
    expect(back?.operation).toBe("UPDATE");
  });

  it("spells the state the way the machine's events are spelled", () => {
    const [back] = extractWorkflowSections(
      "%%workflow X entity: Contract kind: hook status: To-Be-Reviewed\nflowchart TD\n  A --> B"
    );
    expect(back?.status).toBe("to_be_reviewed");
  });

  it("never writes status: on a state machine", () => {
    const text = emitWorkflowSection({
      name: "ContractLifecycle",
      entity: "Contract",
      kind: "state",
      status: "approved",
      diagram: MACHINE,
    });
    expect(text).not.toContain("status:");
  });
});

describe("the checker holds a status binding to the machine", () => {
  const model = (workflow: string) =>
    [
      "%%meta name: Contracts",
      "erDiagram",
      "    Contract {",
      "        string id PK",
      "        string status",
      "    }",
      "",
      "%%workflow ContractLifecycle entity: Contract kind: state",
      MACHINE,
      "",
      workflow,
      "flowchart TD",
      "    A([Start]) --> B([End])",
    ].join("\n");

  const codes = (workflow: string) => checkSource(model(workflow)).issues.map((d) => d.code);

  it("accepts a state the machine enters, started by an update", () => {
    const found = codes(
      "%%workflow Review entity: Contract kind: saga trigger: automatic operation: UPDATE status: to_be_reviewed"
    );
    expect(found).not.toContain("EML243");
    expect(found).not.toContain("EML244");
    expect(found).not.toContain("EML245");
  });

  it("refuses a state the machine does not draw (EML243)", () => {
    expect(
      codes("%%workflow Review entity: Contract kind: saga operation: UPDATE status: signed")
    ).toContain("EML243");
  });

  it("refuses a status on a saga a create starts (EML244)", () => {
    expect(
      codes("%%workflow Review entity: Contract kind: saga status: to_be_reviewed")
    ).toContain("EML244");
  });

  it("warns for the first state, which no button enters (EML245)", () => {
    expect(
      codes("%%workflow Review entity: Contract kind: saga operation: UPDATE status: draft")
    ).toContain("EML245");
  });
});
