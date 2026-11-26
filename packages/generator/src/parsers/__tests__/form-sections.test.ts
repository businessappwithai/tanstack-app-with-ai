/**
 * `%%section` — a form laid out as the model says, in both stacks.
 *
 * Before the directive a form was one flat list in column order, and the only
 * grouping either stack ever applied was decided by position — the NestJS seed
 * split every form after its third column into a "General" and a collapsed
 * "Details" section nobody asked for. Sections now come from the model or not
 * at all, and these tests hold the four places a section passes through to the
 * same reading: the checker, the fixer, the dictionary both stacks seed from,
 * and the NestJS seed template.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import Handlebars from "handlebars";
import { describe, expect, it } from "vitest";
import { AUTO_FIXABLE_CODES, checkSource } from "../../../../../language/checker";
import { applyFixes } from "../../../../../language/fixer";
import { DictionaryGenerator } from "../../generators/dictionary.generator";
import { withFormLayout } from "../../generators/tanstack-start-nestjs/nestjs-backend.generator";
import { buildModelBundle } from "../../generators/wasm/model-bundle";
import { parseModel } from "../../pipeline/parse-model";
import { TemplateLoader } from "../../templates/loader";
import { entityToBusEntity } from "@appwithai/core/types";

const BASE = `%%meta name: Shop
erDiagram
    Customer ||--o{ Order : places
    Customer {
        string id PK
        string name
        string email
    }
    Order {
        string id PK
        string order_number
        date order_date
        string customer_id FK
        decimal total
        text notes
    }
    %%entity Customer help: A person or company that buys from the shop and is invoiced for it.
    %%entity Order help: One purchase by one customer, priced and dated when it is placed.
    %%field Customer.name help: The name printed on invoices and shown in every lookup of a customer.
    %%field Customer.email help: Where order confirmations go, so it must be one the customer reads.
    %%field Order.order_number help: The number quoted on the phone and printed on the invoice.
    %%field Order.order_date help: The day the order was placed, which starts the delivery clock.
    %%field Order.customer_id help: Who placed the order and is invoiced for it.
    %%field Order.total help: What the customer pays, tax included, recalculated from the lines.
    %%field Order.notes help: Anything the packer should know before the order ships.
`;

const SECTIONED = `${BASE}    %%section entity: Customer; name: Customer; help: Who buys, and where to reach them; both are needed before an order.; rows: name, email
    %%section entity: Order; name: Order; help: Who placed the order and when it was taken.; rows: order_number, order_date | customer_id
    %%section entity: Order; name: Money; help: What is charged for the order.; rows: total
    %%section entity: Order; name: Notes; help: Anything the next person handling it should know.; rows: notes; collapsed: true
`;

const codes = (source: string) => checkSource(source).issues.map((issue) => issue.code);

/** Run the fixer the way `checkAndFix` does: issues marked fixable, applied in memory. */
function fix(source: string): string {
  const issues = checkSource(source).issues.map((issue) => ({
    ...issue,
    autoFixable: AUTO_FIXABLE_CODES.has(issue.code),
  }));
  return applyFixes(source, issues).newSource;
}

describe("the checker", () => {
  it("accepts a model whose every entity is laid out, with none of EML170-EML177", () => {
    const found = codes(SECTIONED).filter((code) => /^EML17\d$/.test(code));
    expect(found).toEqual([]);
  });

  it("reports an entity with no sections as EML170, once per entity", () => {
    expect(codes(BASE).filter((code) => code === "EML170")).toHaveLength(2);
  });

  it("reports a missing key, an unknown entity, a third column, the key, and an unknown column", () => {
    const found = codes(`${SECTIONED}    %%section entity: Order; name: Broken
    %%section entity: Invoice; name: Lines; help: The lines.; rows: total
    %%section entity: Order; name: Extra; help: Placed again to test.; rows: id | missing_column
    %%section entity: Customer; name: Wide; help: Three abreast is too many.; rows: name, email, name
`);
    expect(found).toEqual(
      expect.arrayContaining(["EML171", "EML173", "EML174", "EML175", "EML176"])
    );
  });

  it("reports columns no row places, and a section whose help restates its name", () => {
    const source = SECTIONED.replace("rows: total\n", "rows: order_date\n").replace(
      "help: What is charged for the order.",
      "help: Money fields."
    );
    const issues = checkSource(source).issues;
    expect(issues.find((issue) => issue.code === "EML172")?.message).toContain("total");
    expect(issues.map((issue) => issue.code)).toContain("EML177");
  });
});

describe("the fixer", () => {
  it("places unplaced columns in the entity's last section, two per row", () => {
    const withoutNotes = SECTIONED.split("\n")
      .filter((line) => !line.includes("name: Notes"))
      .join("\n");
    const fixed = fix(withoutNotes);
    const money = fixed.split("\n").find((line) => line.includes("name: Money"));
    expect(money).toContain("rows: total | notes");
    expect(codes(fixed)).not.toContain("EML172");
  });

  it("splits a row of three into rows of two, keeping the rest of the line", () => {
    const fixed = fix(
      SECTIONED.replace("rows: order_number, order_date | customer_id", "rows: order_number, order_date, customer_id")
    );
    expect(fixed).toContain("rows: order_number, order_date | customer_id");
    expect(codes(fixed)).not.toContain("EML174");
  });

  it("removes the later of two placements of one column", () => {
    const fixed = fix(SECTIONED.replace("rows: total", "rows: total, order_number"));
    expect(fixed).toContain("name: Money; help: What is charged for the order.; rows: total\n");
    expect(codes(fixed)).not.toContain("EML175");
  });
});

describe("the dictionary both stacks seed from", () => {
  const parsed = parseModel(SECTIONED);
  const context = new DictionaryGenerator({
    databaseType: "postgresql",
    includeRbac: true,
    randomizeFieldOrder: false,
  }).generateDictionaryContext(parsed.entities, parsed.relationships);

  it("creates one two-column group per section, on the entity's own tab, in order", () => {
    const groups = context.sysFieldGroups.filter((group) => group._tabRef);
    expect(groups.map((group) => group.name)).toEqual(["Customer", "Order", "Money", "Notes"]);
    expect(groups.every((group) => group.columns === 2)).toBe(true);
    expect(groups.find((group) => group.name === "Notes")?.is_collapsed_by_default).toBe(true);
    expect(groups.find((group) => group.name === "Money")?.description).toBe(
      "What is charged for the order."
    );
  });

  it("places each field beside the one before it or on a new row, and spans a field alone on its row", () => {
    const columnName = new Map(context.sysColumns.map((c) => [c._tempId, c.column_name]));
    const field = (name: string) =>
      context.sysFields.find((candidate) => columnName.get(candidate._columnRef) === name);
    expect(field("order_number")).toMatchObject({ is_same_line: false, column_span: 1 });
    expect(field("order_date")).toMatchObject({ is_same_line: true, column_span: 1 });
    expect(field("customer_id")).toMatchObject({ is_same_line: false, column_span: 2 });
    // X and Y Position are not part of the dictionary any more.
    expect(field("order_date")).not.toHaveProperty("x_position");
    expect(field("order_date")).not.toHaveProperty("y_position");
    const order = ["order_number", "order_date", "customer_id", "total", "notes"].map(
      (name) => field(name)?.seq_no ?? 0
    );
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("carries the layout into the browser stack's model.json", () => {
    const { model } = buildModelBundle(parsed, { name: "Shop", description: "A shop" } as never);
    const groups = model.dictionary.fieldGroups.filter((group) => group.tableName === "bus_order");
    expect(groups.map((group) => group.name)).toEqual(["Order", "Money", "Notes"]);
    const date = model.dictionary.fields.find((candidate) => candidate.columnName === "order_date");
    expect(date).toMatchObject({ fieldGroup: "Order", isSameLine: true, columnSpan: 1 });
    expect(date).not.toHaveProperty("xPosition");
  });

  it("puts a column no row places into a trailing collapsed Other section", () => {
    const partial = parseModel(SECTIONED.replace("rows: notes; collapsed: true", "rows: total"));
    const gen = new DictionaryGenerator({
      databaseType: "postgresql",
      includeRbac: true,
      randomizeFieldOrder: false,
    }).generateDictionaryContext(partial.entities, partial.relationships);
    const other = gen.sysFieldGroups.find((group) => group.name === "Other");
    expect(other?.is_collapsed_by_default).toBe(true);
    const notes = gen.sysFields.find(
      (candidate) =>
        gen.sysColumns.find((c) => c._tempId === candidate._columnRef)?.column_name === "notes"
    );
    expect(notes?._groupRef).toBe(other?._tempId);
  });

  it("leaves an entity with no sections exactly as it was: no groups, declared order", () => {
    const flat = parseModel(BASE);
    const gen = new DictionaryGenerator({
      databaseType: "postgresql",
      includeRbac: true,
      randomizeFieldOrder: false,
    }).generateDictionaryContext(flat.entities, flat.relationships);
    expect(gen.sysFieldGroups.filter((group) => group._tabRef)).toEqual([]);
    expect(gen.sysFields.every((candidate) => !candidate._groupRef)).toBe(true);
  });
});

describe("the NestJS seed", () => {
  new TemplateLoader(join(import.meta.dirname, "../../../templates"));
  const template = readFileSync(
    join(import.meta.dirname, "../../../templates/common/seeds/sys-dictionary.ts.hbs"),
    "utf8"
  );
  const rendered = Handlebars.compile(template, { noEscape: true })({
    now: "2026-10-19T00:00:00.000Z",
    config: { createdBy: "System" },
    entities: parseModel(SECTIONED).entities.map((entity) => withFormLayout(entityToBusEntity(entity))),
    access: { entityVisibility: {} },
  });

  it("inserts the model's sections as two-column groups instead of the generic four", () => {
    const order = rendered.slice(rendered.indexOf("table_name: 'bus_order'"));
    expect(order).toContain('orderGroupIds.set("Money", groupId)');
    expect(order).toContain("columns: 2");
    expect(order).not.toContain("name: 'Details'");
  });

  it("places each field in its group, with its same-line flag and span", () => {
    expect(rendered).toContain('group: "Order"');
    expect(rendered).toMatch(/sameLine: true,\s+columnSpan: 1/);
    expect(rendered).not.toMatch(/xPosition|yPosition|x_position|y_position/);
    expect(rendered).toContain("sys_field_group_id: col.layout ? orderGroupIds.get(col.layout.group) : undefined");
  });
});
