import { describe, expect, it } from "vitest";
import { slugifyRuleName } from "../RuleEditor";

describe("slugifyRuleName", () => {
  it("writes a title as a camelCase identifier", () => {
    expect(slugifyRuleName("Student record control")).toBe("studentRecordControl");
    expect(slugifyRuleName("Late flag at fifteen")).toBe("lateFlagAtFifteen");
  });

  // `%%rule invoiceControl` is looked up by that name from a process step; saving it as
  // `invoicecontrol` broke the lookup without any error.
  it("keeps a name that is already an identifier", () => {
    expect(slugifyRuleName("invoiceControl")).toBe("invoiceControl");
    expect(slugifyRuleName("attendanceMarking")).toBe("attendanceMarking");
  });

  it("still normalises what is not one", () => {
    expect(slugifyRuleName("InvoiceControl")).toBe("invoicecontrol");
    expect(slugifyRuleName("  ")).toBe("rule");
  });
});
