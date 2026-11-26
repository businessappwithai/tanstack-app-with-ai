/**
 * Field logic — Compiere's Display, Read Only and Mandatory Logic.
 *
 * `%%field <E>.<c> display: | readonly: | mandatory: <logic>` passes through
 * five readers, and these tests hold them to one meaning: the syntax itself
 * (language/field-logic.ts), the checker, the dictionary both stacks seed
 * from, the NestJS seed template, and the browser stack's JavaScript twin.
 *
 * The copies are the part most worth pinning. The generated applications
 * cannot import this repository, so each carries the evaluator: the NestJS
 * stack a byte copy of the TypeScript, the browser stack a JavaScript twin. A
 * copy that drifted would have the form hide a field the API then requires, or
 * the API lock a field the form lets a person edit — and nothing on either
 * screen would say which reading was wrong.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import Handlebars from "handlebars";
import { describe, expect, it } from "vitest";
import { checkSource } from "../../../../../language/checker";
import * as canonical from "../../../../../language/field-logic";
import * as twin from "../../../templates/wasm/server/lib/field-logic.js";
import { DictionaryGenerator } from "../dictionary.generator";
import { withFormLayout } from "../tanstack-start-nestjs/nestjs-backend.generator";
import { buildModelBundle } from "../wasm/model-bundle";
import { parseModel } from "../../pipeline/parse-model";
import { TemplateLoader } from "../../templates/loader";
import { entityToBusEntity } from "@appwithai/core/types";

const ROOT = join(import.meta.dirname, "../../../../..");

/** [expression, record, expected] — Compiere's own examples first. */
const CASES: Array<[string, Record<string, unknown>, boolean]> = [
  ["@IsSOTrx@=Y", { IsSOTrx: true }, true],
  ["@IsSOTrx@=Y", { IsSOTrx: false }, false],
  ["@DocStatus@!DR", { DocStatus: "CO" }, true],
  ["@DocStatus@!DR", { DocStatus: "DR" }, false],
  ["@DocStatus@!=DR", { DocStatus: "DR" }, false],
  ["@DocStatus@^DR", { DocStatus: "CO" }, true],
  ["@PaymentRule@=B", { PaymentRule: "B" }, true],
  ["@GrandTotal@>1000", { GrandTotal: "1500.50" }, true],
  ["@GrandTotal@>1000", { GrandTotal: 999 }, false],
  ["@QtyOrdered@<10", { QtyOrdered: 9 }, true],
  ["@QtyOrdered@>=10", { QtyOrdered: 10 }, true],
  ["@QtyOrdered@<=100", { QtyOrdered: 101 }, false],
  // Numbers compare as numbers: 9 < 10 although "9" > "10" as text.
  ["@n@<10", { n: "9" }, true],
  ["@IsSOTrx@=Y & @DocStatus@=DR", { IsSOTrx: true, DocStatus: "DR" }, true],
  ["@IsSOTrx@=Y & @DocStatus@=DR", { IsSOTrx: true, DocStatus: "CO" }, false],
  ["@DocStatus@=CO | @DocStatus@=CL", { DocStatus: "CL" }, true],
  // Left to right, no precedence: (true | false) & false.
  ["@a@=1 | @b@=1 & @c@=1", { a: 1, b: 0, c: 0 }, false],
  // …where precedence would have read true | (false & false) = true.
  ["@a@=1 | @b@=1 & @c@=1", { a: 1, b: 0, c: 1 }, true],
  // Empty is the empty string.
  ["@x@=''", {}, true],
  ["@x@!''", { x: null }, false],
  ["@x@!''", { x: "set" }, true],
  ['@x@="a b"', { x: "a b" }, true],
  // A variable may be on either side.
  ["closed_lost=@stage@", { stage: "closed_lost" }, true],
  ["@stage@=@expected@", { stage: "a", expected: "a" }, true],
  // An ISO date compares in date order.
  ["@due@<2026-01-01", { due: "2025-12-31" }, true],
  // Malformed logic is false, never true: it must not hide or lock a field.
  ["(@a@=1)", { a: 1 }, false],
  ["@a@", { a: 1 }, false],
];

describe("the syntax", () => {
  it.each(CASES)("%s against %j is %s", (expression, record, expected) => {
    expect(canonical.evaluateLogic(expression, record)).toBe(expected);
  });

  it("reports what an expression reads, once each", () => {
    expect(canonical.logicVariables("@a@=1 | @b@=2 & @a@!3")).toEqual(["a", "b"]);
  });

  it("refuses what Compiere's evaluator cannot read, with the reason", () => {
    for (const bad of ["", "(@a@=1)", "@a@", "a=b", "@a@=1 &", "@a=1", "@a b@=1", "@a@='x"]) {
      const parsed = canonical.parseLogic(bad);
      expect(parsed.ok, bad).toBe(false);
    }
  });

  it("requires only a displayed field, and keeps the static flags", () => {
    const field = {
      is_displayed: true,
      is_read_only: false,
      is_mandatory: false,
      display_logic: "@auto_renew@=Y",
      mandatory_logic: "@auto_renew@=Y",
      read_only_logic: "@status@!draft",
    };
    expect(canonical.fieldLogicState(field, { auto_renew: true, status: "draft" })).toEqual({
      displayed: true,
      readOnly: false,
      mandatory: true,
    });
    expect(canonical.fieldLogicState(field, { auto_renew: false, status: "active" })).toEqual({
      displayed: false,
      readOnly: true,
      mandatory: false,
    });
    expect(canonical.fieldLogicState({ is_mandatory: true }, {}).mandatory).toBe(true);
    expect(canonical.fieldLogicState({ is_displayed: false, display_logic: "@a@=1" }, { a: 1 }))
      .toMatchObject({ displayed: false });
  });
});

describe("what the API refuses", () => {
  const fields = [
    {
      column_name: "renewal_notice_days",
      name: "Renewal Notice Days",
      display_logic: "@auto_renew@=Y",
      mandatory_logic: "@auto_renew@=Y",
    },
    { column_name: "discount_percent", name: "Discount %", read_only_logic: "@status@!draft" },
  ];

  it("a displayed field its mandatory logic requires, left empty", () => {
    expect(canonical.logicViolations(fields, { auto_renew: true }, {}, null)).toEqual([
      "Renewal Notice Days is required when @auto_renew@=Y",
    ]);
    expect(canonical.logicViolations(fields, { auto_renew: true, renewal_notice_days: 30 }, {}))
      .toEqual([]);
    expect(canonical.logicViolations(fields, { auto_renew: false }, {})).toEqual([]);
  });

  it("a change to a field locked by the record as it is stored — and only a change", () => {
    const stored = { status: "approved", discount_percent: "12.50" };
    expect(
      canonical.logicViolations(fields, { ...stored, discount_percent: 20 }, { discount_percent: 20 }, stored)
    ).toEqual(["Discount % is read-only when @status@!draft"]);
    // The whole record sent back, value unchanged but spelt differently, is not a change.
    expect(
      canonical.logicViolations(fields, stored, { discount_percent: 12.5 }, stored)
    ).toEqual([]);
    // A draft is not locked; a create has nothing stored to lock.
    const draft = { status: "draft", discount_percent: 5 };
    expect(canonical.logicViolations(fields, draft, { discount_percent: 9 }, draft)).toEqual([]);
    expect(canonical.logicViolations(fields, stored, stored, null)).toEqual([]);
  });

  it("treats a date and its text, and a number and its text, as one value", () => {
    expect(canonical.sameValue(new Date("2026-10-01T00:00:00.000Z"), "2026-10-01")).toBe(true);
    expect(canonical.sameValue("50000.00", 50000)).toBe(true);
    expect(canonical.sameValue(null, "")).toBe(true);
    expect(canonical.sameValue("a", "b")).toBe(false);
  });
});

describe("the copies the generated applications carry", () => {
  it("NestJS: templates/common/field-logic.ts is language/field-logic.ts, byte for byte", () => {
    expect(readFileSync(join(ROOT, "packages/generator/templates/common/field-logic.ts"), "utf8"))
      .toBe(readFileSync(join(ROOT, "language/field-logic.ts"), "utf8"));
  });

  it("browser: the JavaScript twin exports the same functions", () => {
    expect(Object.keys(twin).sort()).toEqual(Object.keys(canonical).sort());
  });

  it.each(CASES)("browser twin: %s against %j is %s", (expression, record, expected) => {
    expect(twin.evaluateLogic(expression, record)).toBe(expected);
  });

  it("browser twin refuses and allows the same writes", () => {
    const fields = [
      { column_name: "a", mandatory_logic: "@b@=Y", read_only_logic: "@c@=x" },
    ];
    for (const [record, changes, stored] of [
      [{ b: true }, {}, null],
      [{ b: true, a: 1 }, {}, null],
      [{ c: "x", a: 2 }, { a: 2 }, { c: "x", a: 1 }],
      [{ c: "y", a: 2 }, { a: 2 }, { c: "y", a: 1 }],
    ] as const) {
      expect(twin.logicViolations(fields, record, changes, stored)).toEqual(
        canonical.logicViolations(fields, record, changes, stored)
      );
    }
  });
});

const MODEL = `%%meta name: Contracts
erDiagram
    Contract {
        string id PK
        string name
        string status
        boolean auto_renew
        integer renewal_notice_days OPTIONAL
        decimal annual_value
    }
    %%entity Contract help: An agreement with a customer for a term, renewed or ended at its close.
    %%field Contract.name help: What the agreement is called on the paperwork both sides keep.
    %%field Contract.status help: Whether the contract is still being drafted or has been signed.
    %%field Contract.auto_renew help: Whether the contract renews itself at the end of its term.
    %%field Contract.renewal_notice_days help: How many days' notice either side must give to stop a renewal.
    %%field Contract.annual_value help: What the contract is worth a year, which revenue reads.
    %%field Contract.renewal_notice_days display: @auto_renew@=Y
    %%field Contract.renewal_notice_days mandatory: @auto_renew@=Y
    %%field Contract.annual_value readonly: @status@!draft
    %%section entity: Contract; name: Contract; help: The agreement and what it is worth.; rows: name, status | annual_value
    %%section entity: Contract; name: Renewal; help: Whether it renews and the notice needed.; rows: auto_renew, renewal_notice_days
`;

const codes = (source: string) => checkSource(source).issues.map((issue) => issue.code);

describe("the checker", () => {
  it("accepts field logic over the entity's own columns", () => {
    expect(codes(MODEL).filter((code) => code.startsWith("EML15"))).toEqual([]);
  });

  it("EML156: logic that does not parse", () => {
    expect(codes(MODEL.replace("display: @auto_renew@=Y", "display: (@auto_renew@=Y)"))).toContain(
      "EML156"
    );
  });

  it("EML157: logic reading a column the entity does not declare", () => {
    expect(codes(MODEL.replace("display: @auto_renew@=Y", "display: @renews@=Y"))).toContain("EML157");
  });

  it("EML158: display logic that depends on its own field", () => {
    expect(
      codes(MODEL.replace("display: @auto_renew@=Y", "display: @renewal_notice_days@>0"))
    ).toContain("EML158");
  });

  it("EML159: logic on the primary key", () => {
    expect(codes(`${MODEL}    %%field Contract.id readonly: @status@=x\n`)).toContain("EML159");
  });

  it("reads %%field lines whether or not they are indented", () => {
    const flush = MODEL.replace(
      "    %%field Contract.renewal_notice_days display: @auto_renew@=Y",
      "%%field Contract.renewal_notice_days display: @nope@=Y"
    );
    expect(codes(flush)).toContain("EML157");
    expect(codes(MODEL.replace("display: @auto_renew@=Y", "display: @nope@=Y"))).toContain(
      "EML157"
    );
  });
});

describe("the dictionary both stacks seed from", () => {
  const parsed = parseModel(MODEL);
  const context = new DictionaryGenerator({
    databaseType: "postgresql",
    includeRbac: true,
    randomizeFieldOrder: false,
  }).generateDictionaryContext(parsed.entities, parsed.relationships);
  const columnName = new Map(context.sysColumns.map((c) => [c._tempId, c.column_name]));
  const field = (name: string) =>
    context.sysFields.find((candidate) => columnName.get(candidate._columnRef) === name);
  const column = (name: string) => context.sysColumns.find((c) => c.column_name === name);

  it("puts display logic on the field, and read-only and mandatory on column and field", () => {
    expect(field("renewal_notice_days")).toMatchObject({
      display_logic: "@auto_renew@=Y",
      mandatory_logic: "@auto_renew@=Y",
    });
    expect(column("renewal_notice_days")).toMatchObject({ mandatory_logic: "@auto_renew@=Y" });
    expect(column("annual_value")).toMatchObject({ read_only_logic: "@status@!draft" });
    expect(field("annual_value")).toMatchObject({ read_only_logic: "@status@!draft" });
    expect(field("name")?.display_logic).toBeUndefined();
  });

  it("carries it into the browser stack's model.json", () => {
    const { model } = buildModelBundle(parsed, { name: "Contracts", description: "x" } as never);
    expect(
      model.dictionary.fields.find((candidate) => candidate.columnName === "renewal_notice_days")
    ).toMatchObject({ displayLogic: "@auto_renew@=Y", mandatoryLogic: "@auto_renew@=Y" });
    expect(
      model.dictionary.columns.find((candidate) => candidate.columnName === "annual_value")
    ).toMatchObject({ readOnlyLogic: "@status@!draft" });
  });
});

describe("the NestJS seed", () => {
  new TemplateLoader(join(import.meta.dirname, "../../../templates"));
  const template = readFileSync(
    join(import.meta.dirname, "../../../templates/common/seeds/sys-dictionary.ts.hbs"),
    "utf8"
  );
  const rendered = Handlebars.compile(template, { noEscape: true })({
    now: "2026-10-28T00:00:00.000Z",
    config: { createdBy: "System" },
    entities: parseModel(MODEL).entities.map((entity) => withFormLayout(entityToBusEntity(entity))),
    access: { entityVisibility: {} },
  });

  it("writes the column's logic into sys_column and every logic into sys_field", () => {
    expect(rendered).toContain('mandatory_logic: "@auto_renew@=Y"');
    expect(rendered).toContain('read_only_logic: "@status@!draft"');
    expect(rendered).toContain('displayLogic: "@auto_renew@=Y"');
    expect(rendered).toContain("display_logic: col.displayLogic");
    expect(rendered).toContain("mandatory_logic: col.mandatoryLogic");
  });
});
