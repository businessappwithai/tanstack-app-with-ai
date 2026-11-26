import { describe, expect, it } from "vitest";
import { HOOK_EVENTS } from "../../automation/model";
import {
  canAttachRules,
  defaultHandlerName,
  eventForOperation,
  HOOK_CHOICES,
  hookFor,
  operationForEvent,
  RULE_HOOKS,
  rulesAttachedTo,
  rulesAvailableFor,
  sameOperation,
} from "../workflow-hooks";

const rule = (key: string, entity: string, event: string) => ({ key, name: key, entity, event });

describe("workflow hooks", () => {
  it("names a handler the checker accepts", () => {
    expect(defaultHandlerName("Lead", "beforeCreate")).toBe("leadBeforeCreate");
    expect(defaultHandlerName("Support Case", "afterUpdate")).toMatch(/^[a-zA-Z_][a-zA-Z0-9_]*$/);
  });

  it("starts with one rung, for the one hook chosen", () => {
    const hook = hookFor("Lead", "afterUpdate");
    expect([hook.event, hook.handler]).toEqual(["afterUpdate", "leadAfterUpdate"]);
  });

  it("offers every hook type the ladder knows, once", () => {
    const events = HOOK_CHOICES.map((c) => c.event);
    expect(new Set(events).size).toBe(HOOK_EVENTS.length);
    expect([...events].sort()).toEqual([...HOOK_EVENTS].sort());
  });

  it("reads 'attached to' as the same entity and the same event", () => {
    const rules = [
      rule("a", "Lead", "beforeCreate"),
      rule("b", "Lead", "beforeUpdate"),
      rule("c", "Account", "beforeCreate"),
    ];
    expect(rulesAttachedTo(rules, "Lead", "beforeCreate").map((r) => r.key)).toEqual(["a"]);
    expect(rulesAvailableFor(rules, "Lead", "beforeCreate").map((r) => r.key)).toEqual(["b"]);
  });

  it("offers rules only at hooks that judge a write", () => {
    expect(RULE_HOOKS.every(canAttachRules)).toBe(true);
    expect(canAttachRules("beforeList")).toBe(false);
  });
});

describe("a host that keeps only the write a rule judges", () => {
  const rules = [
    { key: "a", name: "A", entity: "Lead", event: "beforeCreate" },
    { key: "b", name: "B", entity: "Lead", event: "beforeUpdate" },
  ];

  it("finds a create rule under afterCreate, and offers the others", () => {
    expect(rulesAttachedTo(rules, "Lead", "afterCreate", sameOperation).map((r) => r.key)).toEqual([
      "a",
    ]);
    expect(
      rulesAvailableFor(rules, "Lead", "afterCreate", sameOperation).map((r) => r.key)
    ).toEqual(["b"]);
  });

  it("maps a hook to the write it belongs to, and back", () => {
    expect(operationForEvent("afterDelete")).toBe("DELETE");
    expect(operationForEvent("customValidate")).toBe("ALL");
    expect(operationForEvent("beforeList")).toBe("ALL");
    expect(eventForOperation("UPDATE")).toBe("beforeUpdate");
    expect(eventForOperation("ALL")).toBe("customValidate");
  });
});
