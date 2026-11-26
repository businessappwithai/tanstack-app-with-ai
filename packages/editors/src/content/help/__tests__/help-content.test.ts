/**
 * The help pages, held to the editors they describe.
 *
 * Help that names a control the editor no longer has, or never mentions one it
 * gained, is worse than none: the reader follows it and the screen disagrees.
 * So every choice an editor offers — its events, outcomes, actions, step types,
 * inspector fields and tests — must be named on that editor's page. A control
 * added without a word of help fails here.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RULE_EVENTS } from "../../../components/eml/RuleEditor";
import { HOOK_EVENTS, OPERATORS, STEP_LABELS } from "../../../lib/automation/model";
import { KNOWN_OUTPUT_FIELDS, WELL_KNOWN_OPTIONS } from "../../../lib/eml/decision-table";

const HELP = path.resolve(__dirname, "..");
const page = (file: string) => readFileSync(path.join(HELP, file), "utf8");
const INSPECTOR = readFileSync(
  path.resolve(__dirname, "../../../components/automation/StepInspector.tsx"),
  "utf8"
);

function missingFrom(text: string, terms: readonly string[]): string[] {
  return terms.filter((term) => !text.includes(term));
}

describe("the business rules page", () => {
  const text = page("business-rules.md");

  it("names every event a rule can run on", () => {
    expect(missingFrom(text, RULE_EVENTS)).toEqual([]);
  });

  it("names every outcome the table offers", () => {
    expect(
      missingFrom(
        text,
        KNOWN_OUTPUT_FIELDS.map((f) => f.label)
      )
    ).toEqual([]);
  });

  it("names every action an outcome can take", () => {
    expect(missingFrom(text, WELL_KNOWN_OPTIONS.action ?? [])).toEqual([]);
  });
});

describe("the lifecycle page", () => {
  it("names every lifecycle moment", () => {
    expect(missingFrom(page("lifecycle.md"), HOOK_EVENTS)).toEqual([]);
  });
});

describe("the process page", () => {
  const text = page("process.md");

  it("names every step type, as the menu words it", () => {
    expect(missingFrom(text, [...Object.values(STEP_LABELS), "A check", "A repeat"])).toEqual([]);
  });

  it("names every test a check can make", () => {
    expect(
      missingFrom(
        text,
        OPERATORS.map((o) => o.label)
      )
    ).toEqual([]);
  });

  it("names every field the step inspector shows", () => {
    const labels = [...INSPECTOR.matchAll(/label="([^"]+)"/g)].map((m) => m[1] as string);
    expect(labels.length).toBeGreaterThan(10);
    expect(missingFrom(text, [...new Set(labels)])).toEqual([]);
  });
});

describe("a workflow bound to a status", () => {
  it("is explained where a workflow is started", () => {
    for (const file of ["lifecycle.md", "process.md"]) {
      expect(missingFrom(page(file), ["When the status becomes", "two transactions"])).toEqual([]);
    }
    expect(missingFrom(page("status.md"), ["Runs when a state is entered"])).toEqual([]);
  });
});

describe("every page", () => {
  it("is shipped and has a title", () => {
    for (const file of [
      "overview.md",
      "business-rules.md",
      "lifecycle.md",
      "status.md",
      "process.md",
    ]) {
      expect(page(file)).toMatch(/^# \S/);
    }
  });
});
