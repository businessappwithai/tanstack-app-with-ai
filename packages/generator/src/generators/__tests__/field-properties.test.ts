/**
 * Every property of the Field window does something in the generated application.
 *
 * The Field window (Admin → Windows, Tabs & Fields → Field) offered some thirty
 * properties and the application acted on about half: Description, Display
 * Length, Num Lines, Heading, Field Only, Encrypted, Obscure Type, Sort Number,
 * Included Tab, the field's own Default Value and Active were stored, shown in
 * the window, and read by nothing; Reference Type Override was offered and had
 * no column to be stored in. X and Y Position were removed rather than wired:
 * Sequence, Same Line and Column Span are the whole of a form's layout.
 *
 * These hold the three ends together — the table, what the API serves, and
 * what the form and the grid read — so a property cannot quietly go back to
 * being decorative.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OBSCURE_TYPES, obscureValue, resolveDefaultValue } from "../../../templates/common/field-values";

const TEMPLATES = join(import.meta.dirname, "../../../templates");
const read = (path: string) => readFileSync(join(TEMPLATES, path), "utf8");

const MIGRATION = read("common/migrations/sys-tables.migration.ts.hbs");
const FIELD_MIGRATION = read("tanstack-start-nestjs/backend/src/migrations/021_field_dictionary.ts.hbs");
const BUS_SERVICE = read("tanstack-start-nestjs/backend/src/modules/bus/bus.service.ts.hbs");
const FORM = read("tanstack-start-nestjs/frontend/src/components/forms/dynamic-form.tsx");
const GRID = read("tanstack-start-nestjs/frontend/src/components/tables/dynamic-table.tsx");
const ADMIN = read("tanstack-start-nestjs/frontend/src/components/admin/ad-field-definitions.ts");
const SEED = read("common/seeds/sys-dictionary.ts.hbs");
const BROWSER_SCHEMA = read("wasm/app/schema.sys.sql");

/** The columns `CREATE TABLE sys_field` declares, plus any the field migration adds. */
function sysFieldColumns(): string[] {
  const body = /CREATE TABLE IF NOT EXISTS sys_field \(([\s\S]*?)\n\s*\)\s*`/.exec(MIGRATION)?.[1] ?? "";
  const declared = body
    .split("\n")
    .map((line) => /^\s*([a-z_]+)\s+[A-Z]/.exec(line)?.[1])
    .filter((name): name is string => !!name && name !== "UNIQUE");
  const added = [...FIELD_MIGRATION.matchAll(/ADD COLUMN IF NOT EXISTS ([a-z_]+)/g)]
    .map((match) => match[1]!)
    .filter((name) => !/position/.test(name));
  return [...new Set([...declared, ...added])];
}

/** The `sys_field.<column>` names `getEntityMetadata` selects. */
function servedColumns(): Set<string> {
  return new Set([...BUS_SERVICE.matchAll(/'sys_field\.([a-z_]+)/g)].map((match) => match[1]!));
}

/** Columns the API deliberately does not serve, each with why. */
const NOT_SERVED: Record<string, string> = {
  sys_tab_id: "the join key — a field belongs to the tab being drawn",
  sys_column_id: "the join key — the column's own properties are served",
  entity_type: "who owns the definition; recorded, and nothing on screen depends on it",
  created_by: "audit",
  updated_by: "audit",
  created_at: "audit",
  updated_at: "audit",
};

describe("the Field window's properties", () => {
  it("are all served to the form and the grid, but for the few that are not about the screen", () => {
    const served = servedColumns();
    const columns = sysFieldColumns();
    expect(columns.length).toBeGreaterThan(25);
    const unserved = columns.filter((column) => !served.has(column) && !(column in NOT_SERVED));
    expect(unserved).toEqual([]);
  });

  it("have no X or Y Position anywhere a field is stored, seeded or edited", () => {
    expect(MIGRATION).not.toMatch(/x_position|y_position/);
    expect(SEED).not.toMatch(/x_position|y_position|xPosition|yPosition/);
    expect(ADMIN).not.toMatch(/x_position|y_position|X Position|Y Position/);
    expect(BUS_SERVICE).not.toMatch(/x_position|y_position/);
    // An existing database loses them: the NestJS migration and the browser schema drop both.
    expect(FIELD_MIGRATION).toMatch(/up[\s\S]*DROP COLUMN IF EXISTS x_position[\s\S]*down/);
    expect(BROWSER_SCHEMA).toContain("DROP COLUMN IF EXISTS x_position");
    expect(BROWSER_SCHEMA).toContain("DROP COLUMN IF EXISTS y_position");
  });

  it("store a Reference Type Override in a column that exists", () => {
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS sys_field \([\s\S]*sys_reference_id INTEGER/);
    expect(FIELD_MIGRATION).toContain("ADD COLUMN IF NOT EXISTS sys_reference_id INTEGER");
    // …and the override replaces the column's reference before anything reads it.
    expect(BUS_SERVICE).toContain("if (col.field_reference_id) col.sys_reference_id = col.field_reference_id;");
  });

  it.each([
    ["description", FORM],
    ["display_length", FORM],
    ["num_lines", FORM],
    ["is_same_line", FORM],
    ["is_heading", FORM],
    ["is_field_only", FORM],
    ["is_encrypted", FORM],
    ["obscure_type", FORM],
    ["default_value", FORM],
    ["included_tab", FORM],
    ["display_length", GRID],
    ["is_encrypted", GRID],
    ["obscure_type", GRID],
    ["sort_no", GRID],
    ["description", GRID],
  ])("%s is read by the screen that draws it", (property, source) => {
    expect(source).toContain(`field.${property}`);
  });

  it("are enforced by the API where they decide what may be saved", () => {
    // Active takes a field off every screen.
    expect(BUS_SERVICE).toMatch(/is_displayed: isStateField \? false : fieldActive &&/);
    expect(BUS_SERVICE).toMatch(/is_displayed_grid: isStateField \? true : fieldActive &&/);
    // Read Only refuses a change on update; the field's Default Value fills a create.
    expect(BUS_SERVICE).toContain("this.enforceReadOnlyFields(metadata, processedData, current);");
    expect(BUS_SERVICE).toContain("default_value: col.field_default_value || col.default_value");
    expect(BUS_SERVICE).toContain("resolveDefaultValue(column.default_value, column.sys_reference_id)");
    // Sort Number orders a list nobody asked to order.
    expect(BUS_SERVICE).toMatch(/nextOptions\.orderDir = sortField\.sort_no! < 0 \? 'desc' : 'asc'/);
    // …which the seeded default clause (`updated_at DESC`, written into every
    // window) must not prevent: found by driving the CRM, where it always did.
    expect(BUS_SERVICE).toContain("!== DEFAULT_ORDER_BY_CLAUSE.toLowerCase()");
  });

  it("explain themselves in the Field window", () => {
    const fieldWindow = ADMIN.slice(ADMIN.indexOf("The column of this tab's table the field shows."));
    for (const label of [
      "Description",
      "Display Length",
      "Num Lines",
      "Same Line",
      "Heading",
      "Field Only (no label)",
      "Encrypted",
      "Default Value",
      "Sort Number",
      "Obscure Type",
      "Included Tab",
      "Active",
    ]) {
      const at = fieldWindow.indexOf(`"${label}"`);
      expect(at, label).toBeGreaterThan(-1);
      expect(fieldWindow.slice(at, fieldWindow.indexOf("}),", at)), label).toContain("help:");
    }
  });
});

describe("Default Value, read as Compiere writes it", () => {
  const now = new Date("2026-10-28T09:15:00.000Z");

  it.each([
    ["42", 11, 42],
    ["12.50", 12, 12.5],
    ["Y", 20, true],
    ["N", 20, false],
    ["true", 20, true],
    ["'open'", 10, "open"],
    ["open", 10, "open"],
    ["@#Date@", 15, "2026-10-28"],
    ["@Date@", 16, "2026-10-28T09:15:00.000Z"],
    ['{"a":1}', 28, { a: 1 }],
    ["2026-01-31", 15, "2026-01-31"],
  ])("%s as reference %i is %j", (raw, reference, expected) => {
    expect(resolveDefaultValue(raw, reference, now)).toEqual(expected);
  });

  it.each([
    ["", 10],
    ["   ", 10],
    ["@#AD_User_ID@", 18],
    ["@SQL=SELECT 1", 11],
    ["now()", 16],
    ["CURRENT_TIMESTAMP", 16],
    ["gen_random_uuid()", 13],
    ["abc", 11],
    ["maybe", 20],
    ["not a date", 15],
  ])("%j as reference %i gives no value — the database's default stands", (raw, reference) => {
    expect(resolveDefaultValue(raw, reference, now)).toBeUndefined();
  });
});

describe("Obscure Type, as iDempiere masks a value", () => {
  it.each([
    [OBSCURE_TYPES.DIGITS_BUT_LAST_4, "4111-1111-1111-1234", "****-****-****-1234"],
    [OBSCURE_TYPES.DIGITS_BUT_FIRST_LAST_4, "4111-1111-1111-1234", "4111-****-****-1234"],
    [OBSCURE_TYPES.ALPHANUMERIC_BUT_LAST_4, "GB29NWBK60161331926819", "******************6819"],
    [OBSCURE_TYPES.ALPHANUMERIC_BUT_FIRST_LAST_4, "GB29NWBK60161331926819", "GB29**************6819"],
    [OBSCURE_TYPES.DIGITS_BUT_LAST_4, "AB-123456", "AB-**3456"],
  ])("%s masks %s as %s", (type, value, expected) => {
    expect(obscureValue(value, type)).toBe(expected);
  });

  it("leaves a value alone under no type or an unknown one", () => {
    expect(obscureValue("1234-5678", null)).toBe("1234-5678");
    expect(obscureValue("1234-5678", "XYZ")).toBe("1234-5678");
    expect(obscureValue(null, OBSCURE_TYPES.DIGITS_BUT_LAST_4)).toBe("");
  });

  it("keeps everything when there are four or fewer characters to mask", () => {
    expect(obscureValue("1234", OBSCURE_TYPES.DIGITS_BUT_LAST_4)).toBe("1234");
  });
});
