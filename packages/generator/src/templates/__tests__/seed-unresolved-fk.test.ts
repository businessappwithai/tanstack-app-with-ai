/**
 * Regression: a required reference whose parent entity the model never declares
 * took the whole business-data seed down.
 *
 * `Document.document_type_id` is marked FK and required, and the model declares
 * no `DocumentType` — the checker reports it as EML502 and generates anyway.
 * The seed's `fk()` found no `bus_document_type` pool, returned null, and the
 * insert into `bus_document` failed `NOT NULL`. One failed insert fails the
 * seed, the backend retries its migrations and seeds five times, and an
 * application that generated and built never started.
 *
 * What is held: a required column whose parent does not exist takes a uuid, an
 * optional one stays null, and a parent that does exist is still used.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import Handlebars from "handlebars";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { TemplateLoader } from "../loader";

const templates = join(import.meta.dirname, "../../../templates");
new TemplateLoader(templates);

const attribute = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  type: "string",
  isForeignKey: true,
  required: false,
  ...extra,
});

/** The seed rendered for two tables, then its pure part evaluated. */
function loadFk() {
  const source = readFileSync(join(templates, "common/seeds/business-data.ts.hbs"), "utf8");
  const output = Handlebars.compile(source, { noEscape: true })({
    now: "test",
    fkOverrides: [],
    entities: [
      {
        name: "Party",
        displayName: "Party",
        tableName: "bus_party",
        primaryKey: "id",
        attributes: [],
      },
      {
        name: "Document",
        displayName: "Document",
        tableName: "bus_document",
        primaryKey: "id",
        attributes: [
          attribute("party_id", { required: true }),
          attribute("document_type_id", { required: true }),
          attribute("reviewer_note_id"),
        ],
      },
    ],
  });
  // Everything above `export async function seed` is the lookup the rows call.
  const head = output.slice(0, output.indexOf("export async function seed"));
  const js = ts.transpileModule(head, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const uuid = (() => {
    let n = 0;
    return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  })();
  const run = new Function("require", `const exports = {}; ${js}; return { fk, ids };`);
  return run((id: string) => (id === "uuid" ? { v4: uuid } : {})) as {
    fk: (column: string, index: number, required?: boolean) => string | null;
    ids: Record<string, string[]>;
  };
}

describe("fk() in the business-data seed", () => {
  const { fk, ids } = loadFk();

  it("gives a required reference with no parent a uuid instead of null", () => {
    for (let i = 0; i < 4; i++) {
      expect(fk("document_type_id", i, true)).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it("keeps the same uuid pool per column, so the data is stable within a run", () => {
    expect(fk("document_type_id", 0, true)).toBe(fk("document_type_id", 4, true));
  });

  it("leaves an optional reference with no parent null", () => {
    expect(fk("reviewer_note_id", 0, false)).toBeNull();
    expect(fk("reviewer_note_id", 0)).toBeNull();
  });

  it("still points a reference whose parent exists at a row that exists", () => {
    expect(ids.bus_party).toContain(fk("party_id", 1, true));
  });
});

describe("the seed template", () => {
  it("tells fk() whether each column is required", () => {
    const source = readFileSync(join(templates, "common/seeds/business-data.ts.hbs"), "utf8");
    const calls = source.match(/fk\('\{\{name\}\}', \{\{@\.\.\/index\}\}[^)]*\)/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).toContain("{{#if required}}");
  });
});
