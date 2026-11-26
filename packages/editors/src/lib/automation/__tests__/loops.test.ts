/**
 * Repeat-while-a-rule-holds.
 *
 * The loop is the only construct in the builder that can fail to terminate, and
 * an automation runs inside the write that triggered it — so a loop that cannot
 * end does not spin a harmless background job, it holds a transaction open.
 * That makes two things worth pinning hardest: the check survives a round trip
 * exactly, and the model refuses the shapes that could never stop.
 */

import { describe, expect, it } from "vitest";
import {
  type Automation,
  type AutomationStep,
  emptyAutomation,
  loopIsContiguous,
  loopsOf,
  newLoop,
  parseAutomation,
  serializeAutomation,
  stepsInLoop,
  validateAutomation,
  valuesAvailableAt,
} from "../model";

function update(field: string, value: string, loopId?: string): AutomationStep {
  return {
    id: `st_${field}_${loopId ?? "out"}`,
    type: "UpdateEntity",
    resultName: "",
    props: { entity: "Sample", field, value },
    loopId,
  };
}

/** A well-formed loop: the body writes the field the check reads. */
function looping(): Automation {
  const a = emptyAutomation("Sample");
  a.name = "Drain the backlog";
  a.trigger.event = "updated";
  const loop = newLoop(a.loops);
  loop.condition = { id: "c1", field: "retry_count", operator: "lt", value: "5" };
  loop.maxPasses = "10";
  a.loops.push(loop);
  a.steps.push(update("retry_count", "{{L1.iteration}}", loop.id));
  a.steps.push(update("status", "drained"));
  return a;
}

describe("serialising a loop", () => {
  const mermaid = serializeAutomation(looping());

  it("writes the check as a %%loop directive", () => {
    expect(mermaid).toContain('%%loop L1 while: retry_count lt "5" max: 10');
  });

  it("marks each member with in:", () => {
    expect(mermaid).toContain("%%step s1 in: L1");
    expect(mermaid).not.toContain("%%step s2 in:");
  });

  it("draws the body as a subgraph, so any renderer shows the repeat", () => {
    expect(mermaid).toContain("subgraph L1[Repeat while retry_count is less than 5]");
    expect(mermaid).toContain("  end");
  });

  it("puts the loop in the edge chain once, not each member", () => {
    // The repeat is one unit in the flow: start -> L1 -> the step after it.
    expect(mermaid).toContain("start --> L1");
    expect(mermaid).toContain("L1 --> s2");
    expect(mermaid).not.toContain("--> s1");
  });
});

describe("reading a loop back", () => {
  const back = parseAutomation(serializeAutomation(looping()), "Sample");

  it("recovers the give-up limit", () => {
    expect(loopsOf(back)[0]?.maxPasses).toBe("10");
  });

  it("recovers the check exactly", () => {
    expect(loopsOf(back)[0]?.condition).toMatchObject({
      field: "retry_count",
      operator: "lt",
      value: "5",
    });
  });

  it("recovers which steps are inside", () => {
    expect(stepsInLoop(back, "L1")).toHaveLength(1);
    expect(back.steps).toHaveLength(2);
    expect(back.steps[1]?.loopId).toBeUndefined();
  });

  it("survives a second round trip unchanged", () => {
    expect(serializeAutomation(parseAutomation(serializeAutomation(back), "Sample"))).toBe(
      serializeAutomation(back)
    );
  });

  it("drops a membership naming a loop that was never declared", () => {
    // Keeping the step and dropping the membership is the recoverable half: the
    // alternative is a box with no check, which would execute once and look
    // like it repeated.
    const orphan = [
      "flowchart TD",
      "%%hook afterUpdate on Sample",
      "  s1[Set status]",
      "%%step s1 type: UpdateEntity",
      "%%step s1 field: status",
      "%%step s1 value: x",
      "%%step s1 in: Lnope",
    ].join("\n");
    const parsed = parseAutomation(orphan, "Sample");
    expect(parsed.steps).toHaveLength(1);
    expect(parsed.steps[0]?.loopId).toBeUndefined();
    expect(loopsOf(parsed)).toHaveLength(0);
  });

  it("drops a loop that ended up with no members", () => {
    const empty = ["flowchart TD", "%%hook afterUpdate on Sample", "%%loop L1 while: a eq 1"].join(
      "\n"
    );
    expect(loopsOf(parseAutomation(empty, "Sample"))).toHaveLength(0);
  });
});

describe("what the model refuses", () => {
  it("a loop whose check nothing inside can change", () => {
    // The body writes `status`, the check reads `retry_count`. It would read the
    // same every pass, so the loop either never runs or runs to the limit.
    const a = looping();
    a.steps[0] = update("status", "spinning", "L1");
    const problems = validateAutomation(a);
    expect(
      problems.some((p) => p.target === "L1" && /Nothing inside repeat L1 changes/.test(p.message))
    ).toBe(true);
    expect(problems.some((p) => p.message.includes("10 passes"))).toBe(true);
  });

  it("a loop with no check at all", () => {
    const a = looping();
    (loopsOf(a)[0] as { condition: { field: string } }).condition.field = "";
    expect(
      validateAutomation(a).some((p) => p.target === "L1" && /never stop/.test(p.message))
    ).toBe(true);
  });

  it("a check that needs a value but has none", () => {
    const a = looping();
    (loopsOf(a)[0] as { condition: { value: string } }).condition.value = "";
    expect(
      validateAutomation(a).some((p) => p.target === "L1" && /needs a value/.test(p.message))
    ).toBe(true);
  });

  it("members split apart by an outside step", () => {
    const a = looping();
    a.steps = [
      update("retry_count", "1", "L1"),
      update("status", "middle"),
      update("retry_count", "2", "L1"),
    ];
    expect(loopIsContiguous(a, "L1")).toBe(false);
    expect(
      validateAutomation(a).some((p) => p.target === "L1" && /between them/.test(p.message))
    ).toBe(true);
  });

  it("a repeat with no give-up limit", () => {
    // There is no default: an unbounded repeat is the one thing that can hold a
    // write open, so the author has to state what "too many" means here.
    const a = looping();
    (loopsOf(a)[0] as { maxPasses: string }).maxPasses = "";
    expect(
      validateAutomation(a).some((p) => p.target === "L1" && /how many passes/.test(p.message))
    ).toBe(true);
  });

  it("a limit that is not a whole number", () => {
    const a = looping();
    (loopsOf(a)[0] as { maxPasses: string }).maxPasses = "lots";
    expect(
      validateAutomation(a).some(
        (p) => p.target === "L1" && /whole number of passes/.test(p.message)
      )
    ).toBe(true);
  });

  it("a limit below one pass", () => {
    const a = looping();
    (loopsOf(a)[0] as { maxPasses: string }).maxPasses = "0";
    expect(
      validateAutomation(a).some((p) => p.target === "L1" && /at least 1 pass/.test(p.message))
    ).toBe(true);
  });

  it("accepts the well-formed one", () => {
    expect(validateAutomation(looping())).toEqual([]);
  });

  it("treats a non-UpdateEntity member as able to change anything", () => {
    // A REST call or a Decision can change the world in ways this cannot see,
    // so only the case it is certain about is reported.
    const a = looping();
    a.steps[0] = {
      id: "rest",
      type: "REST",
      resultName: "",
      props: { method: "POST", url: "https://example.com/x", body: "" },
      loopId: "L1",
    };
    expect(validateAutomation(a).filter((p) => p.target === "L1")).toEqual([]);
  });
});

describe("what a step inside a loop can reference", () => {
  it("offers the pass number", () => {
    const a = looping();
    const paths = valuesAvailableAt(a, 0, { Sample: ["retry_count"] }).map((v) => v.path);
    expect(paths).toContain("L1.iteration");
  });

  it("does not offer it to a step outside the loop", () => {
    const a = looping();
    const paths = valuesAvailableAt(a, 1, { Sample: ["retry_count"] }).map((v) => v.path);
    expect(paths).not.toContain("L1.iteration");
  });
});

describe("an automation stored before loops existed", () => {
  it("serialises unchanged rather than throwing", () => {
    // The majority of stored rows have no `loops` field at all.
    const legacy = emptyAutomation("Sample") as Automation & { loops?: unknown };
    legacy.steps.push(update("status", "x"));
    legacy.loops = undefined as never;
    expect(() => serializeAutomation(legacy as Automation)).not.toThrow();
    expect(validateAutomation(legacy as Automation)).toEqual([]);
  });
});
