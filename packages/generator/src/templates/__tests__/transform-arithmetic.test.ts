/**
 * A `%%action … transform value: quantity * unit_price` names a computed value.
 *
 * The executor used to write the text itself into the column: a numeric column refused it
 * ("invalid input syntax for type numeric") and every update of the record failed — found by the
 * airport model's Charge, whose `validateCharge` rule computes `net_amount` and `gross_amount`.
 * `evaluateArithmetic` lives in the rules service template; this loads that function from the
 * template and runs it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const TEMPLATE = join(
  import.meta.dirname,
  "../../../templates/tanstack-start-nestjs/backend/src/modules/rules/rules.service.ts.hbs"
);
const source = readFileSync(TEMPLATE, "utf8");
const start = source.indexOf("export function evaluateArithmetic");
const end = source.indexOf("@Injectable()", start);
const compiled = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exportsBag: { evaluateArithmetic?: (e: string, r: Record<string, unknown>) => number | undefined } = {};
new Function("exports", compiled)(exportsBag);
const evaluate = exportsBag.evaluateArithmetic!;

describe("evaluateArithmetic", () => {
  const record = { quantity: 3, unit_price: "12.50", net_amount: 37.5, tax_amount: 7.5, note: "x" };

  it("computes a product and a sum over the record's columns", () => {
    expect(evaluate("quantity * unit_price", record)).toBe(37.5);
    expect(evaluate("net_amount + tax_amount", record)).toBe(45);
  });

  it("respects precedence, parentheses and unary minus", () => {
    expect(evaluate("quantity + unit_price * 2", record)).toBe(28);
    expect(evaluate("(quantity + unit_price) * 2", record)).toBe(31);
    expect(evaluate("-quantity + 10", record)).toBe(7);
  });

  it("leaves a literal alone: a date, a number, a word, text naming no column", () => {
    expect(evaluate("2026-01-01", record)).toBeUndefined();
    expect(evaluate("10", record)).toBeUndefined();
    expect(evaluate("approved", record)).toBeUndefined();
    expect(evaluate("current_user", record)).toBeUndefined();
    expect(evaluate("first-class", record)).toBeUndefined();
  });

  it("refuses what it cannot compute rather than writing a wrong number", () => {
    expect(evaluate("quantity / 0", record)).toBeUndefined();
    expect(evaluate("quantity * missing_column", record)).toBeUndefined();
    expect(evaluate("quantity * note", record)).toBeUndefined();
    expect(evaluate("quantity * (unit_price", record)).toBeUndefined();
    expect(evaluate("quantity ** 2", record)).toBeUndefined();
  });

  it("is wired into the transform executor, in order, over the stored row", () => {
    expect(source).toContain("evaluateArithmetic(value, working)");
    expect(source).toContain("working[column] = computed[column]");
  });
});
