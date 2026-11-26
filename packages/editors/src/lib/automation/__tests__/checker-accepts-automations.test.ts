/**
 * Regression: ISSUE-008 — the checker rejected every automation the app writes.
 * Found by /qa on 2026-09-01.
 * Report: .gstack/qa-reports/qa-report-dance-studio-qa-2026-09-01.md
 *
 * `serializeAutomation()` is the only writer of automations, and everything it
 * emitted failed `language/checker.ts`:
 *
 *   - `%%workflow name: <name>` drew EML240 "Invalid %%workflow syntax".
 *   - `%%hook <event> on <Entity>`, the two-token trigger form, drew EML201
 *     "Invalid %%hook syntax" from the model parser.
 *   - Every `%%step` line drew EML269 "only read inside a kind: saga workflow".
 *   - And a saga built in the builder drew EML261 `unknown type "type"`, because
 *     it writes automation-dialect steps under a positional saga header — so
 *     even the one shape whose `%%workflow` line was already valid failed.
 *
 * An automation built in a running application therefore could not be validated
 * after a round trip into EML, though `appwithai-language.json` documents the
 * dialect as shipped and the compiler has read it all along.
 *
 * Both ends are real here on purpose. The writer is the app's own, the checker
 * is the published one, and neither is imitated by a fixture — a hand-copied
 * sample of the dialect would keep passing after the writer changed shape,
 * which is the one way this test could go quietly useless.
 */

import { describe, expect, it } from "vitest";
import { checkSource } from "../../../../../../language/checker";
import {
  type Automation,
  emptyAutomation,
  newCondition,
  newHook,
  newLoop,
  newStep,
  serializeAutomation,
} from "../model";

/** A model the automations below can bind to. Kept minimal but valid. */
const ERD = `%%meta name: Probe
%%meta kind: erd
%%enum PackStatus: active, exhausted, expired
erDiagram
    ClassPack {
        string  id PK
        integer credits_remaining
        string  status
    }
    %%entity ClassPack help: A block of prepaid credits bought by a member.
    %%field ClassPack.credits_remaining help: Credits still available to spend.
    %%field ClassPack.status help: active, exhausted or expired.
    %%field ClassPack.status enum: PackStatus
    %%rbac role:manager on ClassPack.read

`;

const check = (automation: Automation) => checkSource(ERD + serializeAutomation(automation));
const errorsOf = (automation: Automation) =>
  check(automation).issues.filter((issue) => issue.severity === "error");

function updateStatus(value: string) {
  const step = newStep("UpdateEntity");
  step.props = { field: "status", value };
  return step;
}

describe("the checker accepts what the automation builder writes", () => {
  it("takes a plain automation: trigger, conditions and steps", () => {
    const a = emptyAutomation("ClassPack");
    a.name = "Close a spent pack";
    a.trigger = { entity: "ClassPack", event: "updated" };
    a.conditions = [{ ...newCondition(), field: "credits_remaining", operator: "eq", value: "0" }];
    const rest = newStep("REST");
    rest.props = { method: "POST", url: "https://hooks.example.com/notify" };
    a.steps = [updateStatus("exhausted"), rest];

    expect(errorsOf(a)).toEqual([]);
  });

  it("takes an automation with no conditions at all", () => {
    const a = emptyAutomation("ClassPack");
    a.name = "Always runs";
    a.trigger = { entity: "ClassPack", event: "created" };
    a.steps = [updateStatus("active")];

    expect(errorsOf(a)).toEqual([]);
  });

  it("takes an arity-0 operator, which still emits a value token", () => {
    const a = emptyAutomation("ClassPack");
    a.name = "Arity zero";
    a.trigger = { entity: "ClassPack", event: "beforeDeleted" };
    a.conditions = [{ ...newCondition(), field: "status", operator: "isEmpty", value: "" }];
    a.steps = [updateStatus("expired")];

    expect(errorsOf(a)).toEqual([]);
  });

  it("takes a bounded loop and its member steps", () => {
    const a = emptyAutomation("ClassPack");
    a.name = "Drain the balance";
    a.trigger = { entity: "ClassPack", event: "beforeUpdated" };
    a.loops = [
      {
        ...newLoop([]),
        condition: {
          ...newCondition(),
          field: "credits_remaining",
          operator: "gt",
          value: "0",
        },
        maxPasses: "20",
      },
    ];
    const step = updateStatus("{{L1.iteration}}");
    step.props = { field: "credits_remaining", value: "{{L1.iteration}}" };
    step.loopId = "L1";
    a.steps = [step];

    expect(errorsOf(a)).toEqual([]);
  });

  it("takes a hook workflow, which writes the three-token handler form", () => {
    const a = emptyAutomation("ClassPack", "hook");
    a.name = "Pack hooks";
    a.trigger = { entity: "ClassPack", event: "created" };
    a.hooks = [
      { ...newHook("beforeDelete"), handler: "blockPackWithBookings" },
      { ...newHook("afterDelete"), handler: "archivePackPayments" },
    ];

    expect(errorsOf(a)).toEqual([]);
  });

  it("takes a saga, whose steps are the automation dialect under a positional header", () => {
    // The shape that hid the widest: the %%workflow line is the saga form and
    // was always accepted, so the failure showed up as EML261 on the steps.
    const a = emptyAutomation("ClassPack", "saga");
    a.name = "Escalate pack";
    a.trigger = { entity: "ClassPack", event: "created" };
    a.sagaTrigger = "automatic";
    a.sagaOperation = "UPDATE";
    const formula = newStep("Formula");
    formula.props = { operation: "set", left: "1" };
    a.steps = [formula];

    expect(errorsOf(a)).toEqual([]);
  });

  it("names the entity from %%hook, so a bad one is still reported", () => {
    const a = emptyAutomation("Nonexistent");
    a.name = "Bound to nothing";
    a.trigger = { entity: "Nonexistent", event: "created" };
    a.steps = [updateStatus("active")];

    const codes = check(a).issues.map((issue) => issue.code);
    expect(codes).toContain("EML206");
  });
});

describe("accepting the dialect did not make the checker permissive", () => {
  const codesFor = (body: string) => checkSource(ERD + body).issues.map((issue) => issue.code);

  it("still rejects a genuinely malformed %%workflow", () => {
    expect(codesFor("%%meta kind: workflow\n%%workflow Nonsense entity: kind:\n")).toContain(
      "EML240"
    );
  });

  it("still rejects a genuinely malformed %%hook", () => {
    expect(codesFor("%%meta kind: workflow\n%%hook justonetoken\n")).toContain("EML201");
  });

  it("reports an automation trigger bound to an event nothing fires", () => {
    expect(
      codesFor("%%meta kind: workflow\n%%workflow name: X\n%%hook whenevs on ClassPack\n")
    ).toContain("EML205");
  });

  it("reports step properties with no type: line to say what they configure", () => {
    expect(
      codesFor(
        [
          "%%meta kind: workflow",
          "%%workflow name: X",
          "%%hook afterCreate on ClassPack",
          "flowchart TD",
          "    s1[x]",
          "%%step s1 field: status",
        ].join("\n")
      )
    ).toContain("EML274");
  });

  it("still reports an unknown step type in the dialect", () => {
    expect(
      codesFor(
        [
          "%%meta kind: workflow",
          "%%workflow name: X",
          "%%hook afterCreate on ClassPack",
          "flowchart TD",
          "    s1[x]",
          "%%step s1 type: Teleport",
        ].join("\n")
      )
    ).toContain("EML261");
  });

  it("still reports two positional bindings on one node", () => {
    // The dialect legitimately shares a node id across lines; the positional
    // form does not, and folding them together must not have excused it.
    expect(
      codesFor(
        [
          "%%meta kind: workflow",
          "%%workflow Dup entity: ClassPack kind: saga",
          "flowchart TD",
          "    A --> B",
          "    %%step B Formula target: a operation: set value: 1",
          "    %%step B Formula target: b operation: set value: 2",
        ].join("\n")
      )
    ).toContain("EML270");
  });

  it("still reports a %%step in a section that carries none", () => {
    expect(
      codesFor(
        [
          "%%meta kind: workflow",
          "%%workflow Stateful entity: ClassPack kind: state",
          "stateDiagram-v2",
          "    [*] --> active",
          "    active --> expired : expire",
          "    expired --> [*]",
          "    %%step s1 type: UpdateEntity",
        ].join("\n")
      )
    ).toContain("EML269");
  });
});
