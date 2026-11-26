import { describe, expect, it } from "vitest";
import { stateToken, statusFromOperation, statusOperation } from "../../eml/workflow-hooks";
import { emptyAutomation, parseAutomation, serializeAutomation, validateAutomation } from "../model";

describe("a saga bound to a status", () => {
  const saga = () => ({
    ...emptyAutomation("Contract", "saga"),
    name: "Contract review",
    sagaTrigger: "automatic" as const,
    sagaOperation: "UPDATE" as const,
    onStatus: "to_be_reviewed",
  });

  it("writes status: on the %%workflow line", () => {
    expect(serializeAutomation(saga())).toContain(
      "%%workflow ContractReview entity: Contract kind: saga operation: UPDATE status: to_be_reviewed"
    );
  });

  it("reads it back, with the trigger and operation beside it", () => {
    const back = parseAutomation(serializeAutomation(saga()), "Contract");
    expect(back.onStatus).toBe("to_be_reviewed");
    expect(back.sagaTrigger).toBe("automatic");
    expect(back.sagaOperation).toBe("UPDATE");
  });

  it("writes nothing for a saga bound to no status", () => {
    const { onStatus: _unused, ...plain } = saga();
    expect(serializeAutomation(plain)).not.toContain("status:");
  });
});

describe("a hook workflow bound to a status", () => {
  it("accepts update rungs and refuses the others", () => {
    const hook = emptyAutomation("Contract", "hook");
    const update = { ...hook, onStatus: "approved", hooks: [{ ...hook.hooks[0]!, event: "afterUpdate" as const }] };
    expect(validateAutomation(update).map((p) => p.message).join(" ")).not.toMatch(/bound to a status/);
    const create = { ...hook, onStatus: "approved", hooks: [{ ...hook.hooks[0]!, event: "afterCreate" as const }] };
    expect(validateAutomation(create).map((p) => p.message).join(" ")).toMatch(/bound to a status/);
  });
});

describe("how a binding is stored", () => {
  it("is the operation the generated runner selects on a move", () => {
    expect(statusOperation("To be reviewed")).toBe("ENTER:TO_BE_REVIEWED");
    expect(statusFromOperation("ENTER:TO_BE_REVIEWED")).toBe("to_be_reviewed");
    expect(statusFromOperation("UPDATE")).toBeUndefined();
    expect(stateToken("To-Be Reviewed")).toBe("to_be_reviewed");
  });
});
