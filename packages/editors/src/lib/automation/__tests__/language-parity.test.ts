/**
 * The language definition must describe the builder that ships.
 *
 * `language/appwithai-language.json` is declared the single source of truth for
 * EML, but nothing enforced that — the automation builder was written with its
 * own trigger, operator and step vocabulary and the definition was never
 * updated, so the canonical description of the language omitted the dialect
 * every stored automation is written in. That drift is invisible: both sides
 * work perfectly on their own, and only a reader trusting the definition to
 * write an automation would discover it.
 *
 * These tests pin the two together in the direction that matters. `model.ts` is
 * the implementation and therefore wins ties; the definition is checked for
 * being complete and accurate about it, not the other way round.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OPERATORS, parseAutomation, STEP_FIELDS, TRIGGER_EVENTS, TRIGGER_HOOKS } from "../model";

const definition = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "../../../../../../language/appwithai-language.json"),
    "utf8"
  )
) as {
  automations: {
    shipped: boolean;
    triggers: { events: Array<{ event: string; hook: string; phase: string; blocking: boolean }> };
    conditions: { operators: Array<{ id: string; label: string; arity: number }> };
    steps: { types: Array<{ type: string; properties: string[] }> };
  };
  directives: { reserved: Array<{ keyword: string; form: string }> };
};

const auto = definition.automations;

describe("language definition ↔ automation model", () => {
  it("documents the automation dialect at all", () => {
    expect(auto).toBeDefined();
    expect(auto.shipped).toBe(true);
  });

  it("lists exactly the trigger events the model defines", () => {
    expect(auto.triggers.events.map((e) => e.event).sort()).toEqual([...TRIGGER_EVENTS].sort());
  });

  it("maps each trigger to the hook the serialiser actually writes", () => {
    for (const { event, hook } of auto.triggers.events) {
      expect(hook).toBe(TRIGGER_HOOKS[event as (typeof TRIGGER_EVENTS)[number]]);
    }
  });

  it("agrees on which triggers can still block the write", () => {
    // A `before` hook runs ahead of the write and can stop it; an `after` hook
    // cannot. Anything else is a documentation error, not a naming preference.
    for (const t of auto.triggers.events) {
      expect(t.blocking).toBe(t.phase === "before");
      expect(t.hook.startsWith(t.phase === "before" ? "before" : "after")).toBe(true);
    }
  });

  it("lists exactly the operators the model defines, with matching arity", () => {
    const documented = auto.conditions.operators;
    expect(documented.map((o) => o.id).sort()).toEqual(OPERATORS.map((o) => o.id).sort());

    for (const op of documented) {
      const impl = OPERATORS.find((o) => o.id === op.id);
      expect(impl, `operator ${op.id}`).toBeDefined();
      expect(op.arity).toBe(impl?.arity);
      expect(op.label).toBe(impl?.label);
    }
  });

  it("lists exactly the step types the model defines, with matching properties", () => {
    const documented = auto.steps.types;
    expect(documented.map((s) => s.type).sort()).toEqual(Object.keys(STEP_FIELDS).sort());

    for (const step of documented) {
      const fields = STEP_FIELDS[step.type as keyof typeof STEP_FIELDS];
      expect(step.properties, `step ${step.type}`).toEqual([...fields]);
    }
  });

  it("gives %%guard one meaning, and RBAC its own keyword", () => {
    // %%guard used to mean both an automation condition and an RBAC
    // restriction. The RBAC sense moved to %%rbac; %%guard must not drift back
    // into carrying both, because the two forms are only distinguishable by
    // shape and a misread turns a live automation into one that never runs.
    const guard = definition.directives.reserved.find((d) => d.keyword === "%%guard");
    expect(guard?.form).toBe("%%guard <field> <operator> <jsonValue>");
    expect(guard?.form).not.toContain("role");

    const rbac = definition.directives.reserved.find((d) => d.keyword === "%%rbac");
    expect(rbac?.form).toContain("<roleExpr>");
  });

  it("documents the two-token %%hook form the automation trigger uses", () => {
    const hook = definition.directives.reserved.find((d) => d.keyword === "%%hook");
    expect(hook?.form).toContain("%%hook <type> on <Entity>");
  });
});

describe("reading a model written before %%rbac existed", () => {
  const legacy = [
    "flowchart TD",
    "%%hook afterCreate on Order",
    "%%guard role:admin on Order.delete",
    '%%guard status eq "open"',
  ].join("\n");

  it("skips the old RBAC shape instead of reading it as a check", () => {
    // Parsed naively this becomes `role:admin on "Order.delete"` — a condition
    // on a field that does not exist, with an operator that is not one. It can
    // never pass, so the automation would look fine and never run.
    const automation = parseAutomation(legacy, "Order");
    expect(automation.conditions).toHaveLength(1);
    expect(automation.conditions[0]).toMatchObject({ field: "status", operator: "eq" });
  });

  it("still reads the rest of the automation", () => {
    expect(parseAutomation(legacy, "Order").trigger).toEqual({
      entity: "Order",
      event: "created",
    });
  });
});
