/**
 * What a process built in the editor hands its steps, read the way the editor wrote it.
 *
 * Found by building a close-out process in the generated CRM's Rules and
 * workflows screen and running it on a won deal:
 *
 * - a Formula whose second value is a variable (`{{commissionRate}}`) read the
 *   reference as a number, got NaN, and was skipped as "non-numeric operand";
 * - a Create step's value with a reference inside text (`Commission {{commission}}`)
 *   was written into the record verbatim, braces and all — a REST body three
 *   steps later was filled in;
 * - a Decision on a `%%rule` drawn as a flowchart failed with the engine's
 *   "missing field `content`" instead of saying the rule decides nothing;
 * - and, to get the deal there at all, clearing a date in the record form sent
 *   '' and the API refused it ("must be a valid date").
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BACKEND = join(import.meta.dirname, "../../../templates/tanstack-start-nestjs/backend/src/modules");
const WORKFLOW = readFileSync(join(BACKEND, "workflow/workflow.service.ts.hbs"), "utf8");
const RULES = readFileSync(join(BACKEND, "rules/rules-engine.service.ts.hbs"), "utf8");
const BUS = readFileSync(join(BACKEND, "bus/bus.service.ts.hbs"), "utf8");

/** The helper as the generated file will hold it: Handlebars' `\{{` is a literal `{{`. */
function resolveReference(text: string | undefined, context: Record<string, unknown>): unknown {
  const source = /private resolveReference[\s\S]*?\n  \}/.exec(WORKFLOW)?.[0] ?? "";
  const regex = /const match = (\/.*\/)\.exec/.exec(source)?.[1];
  expect(regex, "resolveReference's pattern").toBeDefined();
  const pattern = new Function(`return ${regex}`)() as RegExp;
  const match = pattern.exec(text ?? "");
  return match ? context[match[1]!] : text;
}

describe("a process's steps read references the way the editor writes them", () => {
  it("a Formula's second value may be a variable", () => {
    expect(WORKFLOW).toContain("const right = Number(this.resolveReference(task.operand, context));");
    expect(resolveReference("{{commissionRate}}", { commissionRate: "0.05" })).toBe("0.05");
    expect(resolveReference(" {{ commission }} ", { commission: 6250 })).toBe(6250);
    expect(resolveReference("12", {})).toBe("12");
    expect(resolveReference("net {{x}}", { x: 1 })).toBe("net {{x}}");
  });

  it("a Create step fills references inside text, and keeps a lone reference typed", () => {
    expect(WORKFLOW).toMatch(/value = single !== source \? single : this\.interpolate\(source, context\);/);
  });

  it("a Decision on a drawn rule says why it decided nothing", () => {
    expect(RULES).toMatch(/\n  isDiagramOnly\(jdmContent: string\): boolean \{/);
    expect(WORKFLOW).toContain("if (this.rulesEngine.isDiagramOnly(stored)) {");
    expect(WORKFLOW).toContain("its nodes carry no conditions, so it decides nothing");
  });

  it("an emptied date, number or lookup is saved as no value", () => {
    expect(BUS).toContain(
      "if (data[column.column_name] === '' && BusService.NON_TEXT_REFERENCES.has(column.sys_reference_id)) {"
    );
    const references = /NON_TEXT_REFERENCES = new Set\(\[([^\]]+)\]\)/.exec(BUS)?.[1] ?? "";
    for (const id of [11, 12, 13, 15, 16, 18, 19, 20]) expect(references.split(/,\s*/)).toContain(String(id));
    // Text stays text: an emptied string column is still ''.
    expect(references.split(/,\s*/)).not.toContain("10");
  });
});
