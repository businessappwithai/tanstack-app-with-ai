import { describe, expect, it } from "vitest";
import { describeOutcome } from "../rule-outcome";

describe("describeOutcome", () => {
  it("reads EML's refusal word and the runtime's as the same thing", () => {
    for (const action of ["validation-error", "prevent"]) {
      const [outcome] = describeOutcome({ action, message: "No." });
      expect(outcome).toEqual({ kind: "blocks", text: "Blocks the write: “No.”" });
    }
  });

  it("says so when nothing matched", () => {
    expect(describeOutcome(null)[0]?.kind).toBe("nothing");
    expect(describeOutcome({})[0]?.kind).toBe("nothing");
    expect(describeOutcome([])[0]?.kind).toBe("nothing");
  });

  it("flags values with no action — the most common first-rule mistake", () => {
    const [outcome] = describeOutcome({ total: 20 });
    expect(outcome?.kind).toBe("problem");
    expect(outcome?.text).toMatch(/no action/);
  });

  it("flags a workflow with no name and a transform with no data", () => {
    expect(describeOutcome({ action: "trigger-workflow" })[0]?.kind).toBe("problem");
    expect(describeOutcome({ action: "transform" })[0]?.kind).toBe("problem");
  });

  it("names the fields a transform changes, from an object or a JSON string", () => {
    expect(describeOutcome({ action: "transform", transformData: '{"status":"x"}' })[0]?.text).toBe(
      "Changes status on the record."
    );
    expect(describeOutcome({ action: "transform", transformData: { a: 1, b: 2 } })[0]?.text).toBe(
      "Changes a, b on the record."
    );
  });

  it("describes each row of a collect table", () => {
    const outcomes = describeOutcome([
      { action: "validation-error", message: "A" },
      { action: "trigger-workflow", workflowName: "W" },
    ]);
    expect(outcomes.map((o) => o.kind)).toEqual(["blocks", "workflow"]);
  });

  it("rejects an action the application does not know", () => {
    expect(describeOutcome({ action: "explode" })[0]?.kind).toBe("problem");
  });
});
