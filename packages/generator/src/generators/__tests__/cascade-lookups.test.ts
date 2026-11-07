import { describe, expect, test } from "vitest";
import { breakCascadeCycles, type CascadeEdge } from "../../../templates/common/cascade-lookups";

const edge = (source: string): CascadeEdge => ({
  ref_filter_param: `filter.${source}`,
  ref_filter_source: source,
});

describe("breakCascadeCycles", () => {
  test("Portfolio: household and risk profile no longer wait on each other", () => {
    // found by creating a Portfolio in the generated wealth-management application: both
    // selects were disabled, each saying to select the other first
    const out = breakCascadeCycles(
      { household_id: edge("risk_profile_id"), risk_profile_id: edge("household_id") },
      ["household_id", "risk_profile_id", "status"]
    );
    expect(out.household_id).toBeUndefined(); // chosen first
    expect(out.risk_profile_id?.ref_filter_source).toBe("household_id"); // narrows by it
  });

  test("a one-way cascade is untouched, even when the source is declared later", () => {
    // Doctor.employee_id lists the employees of the chosen department_id
    const input = { employee_id: edge("department_id") };
    expect(breakCascadeCycles(input, ["employee_id", "department_id"])).toEqual(input);
  });

  test("a three-field cycle is broken at its latest source", () => {
    const out = breakCascadeCycles(
      { a: edge("b"), b: edge("c"), c: edge("a") },
      ["a", "b", "c"]
    );
    // b waits on c, the field declared last, so that is the edge that goes; a (on b) and
    // c (on a) keep theirs and the chain now starts at b
    expect(out.b).toBeUndefined();
    expect(Object.keys(out).length).toBe(2);
    // nothing waits in a circle any more
    for (const start of Object.keys(out)) {
      const seen = new Set<string>();
      let n: string | undefined = start;
      while (n && out[n]) {
        expect(seen.has(n)).toBe(false);
        seen.add(n);
        n = out[n]?.ref_filter_source;
      }
    }
  });

  test("a chain into a cycle keeps the chain", () => {
    const out = breakCascadeCycles(
      { x: edge("a"), a: edge("b"), b: edge("a") },
      ["x", "a", "b"]
    );
    expect(out.x?.ref_filter_source).toBe("a");
    expect(Object.keys(out).filter((k) => k !== "x").length).toBe(1);
  });

  test("an empty or acyclic map is returned as it came", () => {
    expect(breakCascadeCycles({}, [])).toEqual({});
  });
});
