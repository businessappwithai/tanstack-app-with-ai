/**
 * Volume QA over the drug-discovery model.
 *
 * Builds 200 automations and 200 rule tables against the seventeen entities in
 * `examples/drug-discovery.eml.mmd` and pushes each one through the whole
 * model: validate, serialise, reopen, re-serialise.
 *
 * The point is not that 200 is a magic number — it is that the shapes are
 * generated rather than hand-picked, so combinations nobody thought to write a
 * case for (a delete with no result name followed by a reference to it, a table
 * whose catch-all sits third, an automation with eight steps of one type) get
 * exercised. A deterministic seed keeps a failure reproducible.
 */

import { describe, expect, it } from "vitest";
import { checkCoverage, evaluateTable } from "../../../components/automation/RuleTableEditor";
import type { DecisionTable } from "../../workflow/bpmn-model";
import {
  type Automation,
  type AutomationStep,
  emptyAutomation,
  newCondition,
  newStep,
  parseAutomation,
  STEP_TYPES,
  type StepType,
  serializeAutomation,
  TRIGGER_EVENTS,
  validateAutomation,
  valuesAvailableAt,
} from "../model";
import { asDecisionTable, isDecisionTable } from "../rule-content";

/* -------------------------------------------------------------------------- */
/*  The drug-discovery model                                                   */
/* -------------------------------------------------------------------------- */

const ENTITIES = [
  "Compound",
  "CompoundAlias",
  "Experiment",
  "ExperimentMetadata",
  "User",
  "Team",
  "Sample",
  "ChemicalInventory",
  "Instrument",
  "InstrumentBooking",
  "Vendor",
  "VendorRequest",
  "WorkflowEvent",
  "DeviationReport",
  "CAPA",
  "StabilityTest",
  "StabilityPull",
] as const;

const FIELDS: Record<string, string[]> = Object.fromEntries(
  ENTITIES.map((e) => [e, ["id", "status", "created_at", "quantity", "owner_id", "notes"]])
);

const RULE_TABLES = ["Assay tier", "Hazard band", "Storage class", "Approval route"];

/** Deterministic PRNG, so a failing run reproduces exactly. */
function makeRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const rand = makeRandom(20260807);
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)] as T;
const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

/* -------------------------------------------------------------------------- */
/*  Generators                                                                 */
/* -------------------------------------------------------------------------- */

function randomStep(index: number, entity: string): AutomationStep {
  const type = pick(STEP_TYPES) as StepType;
  const step = newStep(type);
  const other = pick(ENTITIES);

  switch (type) {
    case "Decision":
      step.props = { ruleTable: pick(RULE_TABLES) };
      step.resultName = `decision${index}`;
      break;
    case "CreateEntity":
      step.props = { entity: other };
      step.resultName = `created${index}`;
      break;
    case "UpdateEntity":
      step.props = { entity, field: pick(FIELDS[entity] ?? ["status"]), value: `v${index}` };
      step.resultName = "";
      break;
    case "DeleteEntity":
      step.props = { entity: other, target: `{{${other.toLowerCase()}.id}}` };
      step.resultName = "";
      break;
    case "Formula":
      step.props = {
        operation: pick(["set", "copy", "add", "subtract", "multiply", "divide"]),
        left: `{{${entity.toLowerCase()}.quantity}}`,
        right: String(between(1, 100)),
      };
      step.resultName = `value${index}`;
      break;
    case "REST":
      step.props = {
        method: pick(["POST", "PUT", "PATCH"]),
        url: `https://lims.example.com/hooks/${entity.toLowerCase()}`,
        body: `{"id":"{{${entity.toLowerCase()}.id}}"}`,
      };
      step.resultName = `response${index}`;
      break;
  }
  return step;
}

function randomAutomation(n: number): Automation {
  const entity = pick(ENTITIES);
  const a = emptyAutomation(entity);
  a.name = `Drug discovery automation ${n}`;
  a.trigger = { entity, event: pick(TRIGGER_EVENTS) };

  const checks = between(0, 4);
  a.conditions = Array.from({ length: checks }, () => ({
    ...newCondition(),
    field: `${entity.toLowerCase()}.${pick(FIELDS[entity] ?? ["status"])}`,
    operator: pick(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "isEmpty", "isNotEmpty"]),
    value: String(between(1, 5000)),
  }));

  const stepCount = between(1, 8);
  a.steps = Array.from({ length: stepCount }, (_, i) => randomStep(i + 1, entity));
  return a;
}

function randomTable(n: number): DecisionTable {
  const inputCount = between(1, 3);
  const outputCount = between(1, 3);
  const entity = pick(ENTITIES);

  const inputs = Array.from({ length: inputCount }, (_, i) => ({
    id: `i${i + 1}`,
    name: `In ${i + 1}`,
    field: `${entity}.${pick(FIELDS[entity] ?? ["status"])}${i}`,
  }));
  const outputs = Array.from({ length: outputCount }, (_, i) => ({
    id: `o${i + 1}`,
    name: `Out ${i + 1}`,
    field: `outcome_${n}_${i}`,
  }));

  const rowCount = between(1, 6);
  const rules = Array.from({ length: rowCount }, (_, r) => {
    const row: Record<string, string> = { _id: `r${n}_${r}` };
    for (const input of inputs) {
      // A quarter of cells are left blank, which means "any" — that is what
      // creates the catch-alls and the shadowing this is meant to find.
      row[input.id] =
        rand() < 0.25 ? "" : `${pick([">", "<", ">=", "<=", "="])} ${between(1, 500)}`;
    }
    for (const output of outputs) row[output.id] = String(between(0, 99));
    return row;
  });

  return { hitPolicy: "first", inputs, outputs, rules };
}

/* -------------------------------------------------------------------------- */
/*  200 automations                                                            */
/* -------------------------------------------------------------------------- */

describe("200 automations over the drug-discovery model", () => {
  const automations = Array.from({ length: 200 }, (_, i) => randomAutomation(i + 1));

  it("builds 200 distinct automations across all seventeen entities", () => {
    expect(automations).toHaveLength(200);
    const used = new Set(automations.map((a) => a.trigger.entity));
    expect(used.size).toBe(ENTITIES.length);
  });

  it("serialises and reopens every one without losing a step", () => {
    const damaged: string[] = [];
    for (const a of automations) {
      const reopened = parseAutomation(serializeAutomation(a), a.trigger.entity);
      if (reopened.steps.length !== a.steps.length) {
        damaged.push(`${a.name}: ${a.steps.length} steps in, ${reopened.steps.length} out`);
      }
    }
    expect(damaged).toEqual([]);
  });

  it("keeps step order and type through a round-trip", () => {
    const wrong: string[] = [];
    for (const a of automations) {
      const reopened = parseAutomation(serializeAutomation(a), a.trigger.entity);
      const before = a.steps.map((s) => s.type).join(",");
      const after = reopened.steps.map((s) => s.type).join(",");
      if (before !== after) wrong.push(`${a.name}: ${before} -> ${after}`);
    }
    expect(wrong).toEqual([]);
  });

  it("keeps the trigger and every check", () => {
    const wrong: string[] = [];
    for (const a of automations) {
      const reopened = parseAutomation(serializeAutomation(a), a.trigger.entity);
      if (reopened.trigger.entity !== a.trigger.entity) {
        wrong.push(`${a.name}: entity ${a.trigger.entity} -> ${reopened.trigger.entity}`);
      }
      if (reopened.trigger.event !== a.trigger.event) {
        wrong.push(`${a.name}: event ${a.trigger.event} -> ${reopened.trigger.event}`);
      }
      if (reopened.conditions.length !== a.conditions.length) {
        wrong.push(
          `${a.name}: ${a.conditions.length} checks in, ${reopened.conditions.length} out`
        );
      }
    }
    expect(wrong).toEqual([]);
  });

  it("is stable — a second round-trip changes nothing", () => {
    const unstable: string[] = [];
    for (const a of automations) {
      const once = serializeAutomation(a);
      const twice = serializeAutomation(parseAutomation(once, a.trigger.entity));
      if (once !== twice) unstable.push(a.name);
    }
    expect(unstable).toEqual([]);
  });

  it("emits renderable mermaid for every one", () => {
    for (const a of automations) {
      const source = serializeAutomation(a);
      expect(source.startsWith("flowchart TD")).toBe(true);
      expect(source).toContain("--> done");
    }
  });

  it("validates every one without throwing, and explains each problem", () => {
    for (const a of automations) {
      const problems = validateAutomation(a);
      for (const p of problems) {
        expect(p.message.length).toBeGreaterThan(10);
        expect(p.target).toBeTruthy();
      }
    }
  });

  it("never offers a step a value produced at or below it", () => {
    const leaks: string[] = [];
    for (const a of automations) {
      a.steps.forEach((_step, i) => {
        const paths = valuesAvailableAt(a, i, FIELDS).map((v) => v.path);
        for (let later = i; later < a.steps.length; later++) {
          const name = a.steps[later]?.resultName;
          if (name && paths.includes(name)) {
            leaks.push(`${a.name}: step ${i + 1} can see step ${later + 1}'s "${name}"`);
          }
        }
      });
    }
    expect(leaks).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/*  200 rule tables                                                            */
/* -------------------------------------------------------------------------- */

describe("200 rule tables over the drug-discovery model", () => {
  const tables = Array.from({ length: 200 }, (_, i) => randomTable(i + 1));

  it("builds 200 tables", () => {
    expect(tables).toHaveLength(200);
    expect(tables.every((t) => t.inputs.length > 0 && t.outputs.length > 0)).toBe(true);
  });

  it("evaluates every table without throwing, for a spread of inputs", () => {
    for (const table of tables) {
      for (const probe of ["0", "1", "250", "9999", "", "not-a-number"]) {
        const values = Object.fromEntries(table.inputs.map((c) => [c.field, probe]));
        const result = evaluateTable(table, values);
        expect(result.rowIndex === null || result.rowIndex >= 0).toBe(true);
      }
    }
  });

  it("always returns the first row that fits, never a later one", () => {
    const wrong: string[] = [];
    for (const [n, table] of tables.entries()) {
      const values = Object.fromEntries(table.inputs.map((c) => [c.field, "250"]));
      const result = evaluateTable(table, values);
      if (result.rowIndex === null) continue;

      // Every row above the winner must have failed at least one check.
      for (let earlier = 0; earlier < result.rowIndex; earlier++) {
        const single = evaluateTable(
          { ...table, rules: [table.rules[earlier] as (typeof table.rules)[number]] },
          values
        );
        if (single.rowIndex === 0) {
          wrong.push(`table ${n}: row ${earlier + 1} also fits but row ${result.rowIndex + 1} won`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it("returns a value for every declared outcome when a row fits", () => {
    for (const table of tables) {
      const values = Object.fromEntries(table.inputs.map((c) => [c.field, "250"]));
      const result = evaluateTable(table, values);
      if (result.rowIndex === null) continue;
      for (const output of table.outputs) {
        expect(result.outputs).toHaveProperty(output.field);
      }
    }
  });

  it("reports coverage for every table, and flags the ones with no catch-all", () => {
    let warned = 0;
    for (const table of tables) {
      const notes = checkCoverage(table);
      expect(notes.length).toBeGreaterThan(0);

      const hasCatchAll = table.rules.some((row) =>
        table.inputs.every((c) => !(row[c.id] ?? "").trim())
      );
      const saysNoGaps = notes[0]?.level === "ok";
      expect(saysNoGaps).toBe(hasCatchAll);
      if (!saysNoGaps) warned += 1;
    }
    // The generator leaves a quarter of cells blank, so both outcomes occur —
    // a run where every table happened to have a catch-all would prove nothing.
    expect(warned).toBeGreaterThan(0);
    expect(warned).toBeLessThan(200);
  });

  it("round-trips every table through the stored-content adapter", () => {
    for (const table of tables) {
      expect(isDecisionTable(table)).toBe(true);
      const reopened = asDecisionTable(JSON.parse(JSON.stringify(table)));
      expect(reopened.rules).toHaveLength(table.rules.length);
      expect(reopened.inputs).toHaveLength(table.inputs.length);
      expect(reopened.outputs).toHaveLength(table.outputs.length);
    }
  });

  it("opens a legacy JDM graph as an empty table rather than guessing", () => {
    const legacy = { name: "Old rule", nodes: [{ id: "n1", type: "decisionTable" }] };
    expect(isDecisionTable(legacy)).toBe(false);
    const table = asDecisionTable(legacy);
    expect(table.rules).toHaveLength(1);
    expect(table.inputs).toHaveLength(1);
  });
});
