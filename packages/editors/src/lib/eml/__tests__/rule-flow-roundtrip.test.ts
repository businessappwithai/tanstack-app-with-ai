import { parseRuleActions } from "@appwithai/generator/rules";
import { describe, expect, it } from "vitest";
import { emitRuleFlow, parseRuleFlow } from "../rule-flow";

/**
 * The `.mmd` is the source of truth, so opening a rule in the editor and saving
 * it must not narrow the model to the subset the canvas can draw.
 */
const SECTION = `flowchart TD
    A([Start: Deviation Reported]) --> B{severity == critical?}
    B -->|Yes| C[Escalate]
    B -->|No| D[Log only]
    C --> E([End: Routed])
    D --> E

    %%action escalateCritical trigger-workflow when: severity == "critical" workflow: CriticalDeviationEscalation message: Critical deviation`;

describe("rule flowchart round trip", () => {
  it("keeps the nodes and edges", () => {
    const flow = parseRuleFlow(SECTION);
    expect(flow.nodes).toHaveLength(5);
    expect(flow.edges).toHaveLength(5);

    const again = parseRuleFlow(emitRuleFlow(flow));
    expect(again.nodes).toHaveLength(5);
    expect(again.edges).toHaveLength(5);
  });

  // Saving a rule used to delete this line. A critical deviation then stopped
  // opening a CAPA, and nothing anywhere reported an error.
  it("keeps the %%action directive the canvas does not model", () => {
    const flow = parseRuleFlow(SECTION);
    expect(flow.directives).toEqual([
      '%%action escalateCritical trigger-workflow when: severity == "critical" workflow: CriticalDeviationEscalation message: Critical deviation',
    ]);

    const emitted = emitRuleFlow(flow);
    expect(emitted).toContain("%%action escalateCritical trigger-workflow");
  });

  it("re-emits an action the generator can still compile", () => {
    // The directive is indented on the way out; the compiler has to see it.
    const emitted = emitRuleFlow(parseRuleFlow(SECTION));
    const actions = parseRuleActions(emitted);

    expect(actions).toHaveLength(1);
    expect(actions[0]?.name).toBe("escalateCritical");
    expect(actions[0]?.type).toBe("trigger-workflow");
    expect(actions[0]?.when).toBe('severity == "critical"');
    expect(actions[0]?.props.workflow).toBe("CriticalDeviationEscalation");
  });

  it("survives more than one round trip", () => {
    let text = SECTION;
    for (let pass = 0; pass < 3; pass++) {
      text = emitRuleFlow(parseRuleFlow(text));
    }
    expect(parseRuleActions(text)).toHaveLength(1);
    expect(parseRuleFlow(text).nodes).toHaveLength(5);
  });

  it("leaves a plain %% comment alone", () => {
    // A bare comment is prose, not a directive; re-emitting it would accumulate
    // stray lines on every save.
    const flow = parseRuleFlow(`flowchart TD\n    %% just a note\n    A([Start]) --> B([End])`);
    expect(flow.directives).toEqual([]);
  });

  it("emits nothing extra when a rule has no directives", () => {
    const flow = parseRuleFlow(`flowchart TD\n    A([Start]) --> B([End])`);
    expect(emitRuleFlow(flow)).not.toContain("%%");
  });
});
