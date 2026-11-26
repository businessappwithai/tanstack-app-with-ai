/**
 * The generator, as it runs in a browser.
 *
 * This is the entry point bundled into `html/assets/appwithai-wasm.js`, and it
 * is deliberately thin: the parsing, compiling and assembling it exposes are
 * the same functions the CLI calls, imported from the same files. There is no
 * browser edition of the compiler, which is the only way the page can promise
 * that what it generates is what `appwithai-wasm generate` would have written.
 *
 * What it cannot import is anything reaching `node:fs` — hence `parse-model.ts`
 * being separate from `generate-application.ts`, and hence the runtime being
 * inlined by `scripts/build-wasm-runtime.ts` rather than read off disk.
 */

import { setLanguageDefinition as setCheckerDefinition } from "../../../../language";
import languageDefinition from "../../../../language/appwithai-language.json";
import { setLanguageDefinition } from "../parsers/language-maps";
import { type ParsedModel, parseModel } from "../pipeline/parse-model";
import { type ModelReview, reviewModel } from "../pipeline/review-model";
import { ModelCheckError } from "./model-check-error";

// The parser resolves the language definition off disk, which a browser has
// none of. Injecting the real JSON here — bundled, not re-typed — is what makes
// a model read the same way in a tab as it does in a terminal.
setLanguageDefinition(languageDefinition);
// The checker resolves it separately, through `language/index.ts`. Same JSON,
// same object — a tab has no disk for either of them to read it from.
setCheckerDefinition(languageDefinition as unknown as Parameters<typeof setCheckerDefinition>[0]);

import { RUNTIME_BYTES } from "../generators/wasm/runtime-assets.generated";
import { generateWasmApp, type WasmGeneratorOptions } from "../generators/wasm/wasm-app.generator";

export type { ModelReview, ParsedModel, WasmGeneratorOptions };
// Exported on its own so the page can check a model the moment it is chosen,
// rather than only finding out at the point of generating it.
// Re-exported so `import { ModelCheckError } from "./appwithai-wasm.js"` keeps
// working; it is defined next door so the full-stack bundle can have it alone.
export { generateWasmApp, ModelCheckError, parseModel, RUNTIME_BYTES, reviewModel };

export interface BrowserGenerateOptions extends Partial<WasmGeneratorOptions> {
  /** The EML document. */
  source: string;
  /** Repair what the fixer can repair before checking. Default true. */
  autoFix?: boolean;
}

/**
 * Rows per entity when a caller asks for sample data but not for an amount.
 *
 * Ten is what `appwithai-wasm generate` uses, and the number matters more than
 * it looks: three rows is a screenshot rather than a grid, and a hundred puts
 * the reader in front of a paginator before they have seen a record. Ten fills
 * every list, every lookup and the dashboard counts on one screen.
 */
export const DEFAULT_SAMPLE_RECORDS = 10;

export interface BrowserGenerateResult {
  /** Every file of the application, path -> contents. */
  files: Record<string, string>;
  /** What the model turned out to contain, for the page to show. */
  summary: {
    project: string;
    entities: string[];
    categories: string[];
    relationships: number;
    enums: number;
    rules: string[];
    hooks: number;
    workflows: string[];
    sagas: string[];
    accessRules: number;
    fileCount: number;
    bytes: number;
    /** Sample rows written into the application; 0 when none were asked for. */
    sampleRows: number;
  };
  warnings: string[];
  /** What the checker made of the model, after the fixer had its turn. */
  review: ModelReview;
}

/**
 * Parse a model and produce an application, in one call.
 *
 * Warnings are collected rather than logged. In a terminal a warning on stderr
 * is seen; in a tab it goes to a console nobody has open, and "your rule was
 * skipped because it has no entity" is exactly the thing the person who just
 * uploaded the model needs to read.
 */
export function generateFromSource(options: BrowserGenerateOptions): BrowserGenerateResult {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(
      args
        .map(String)
        .join(" ")
        .replace(/^\s*⚠️?\s*/u, "")
        .trim()
    );
  };

  // Checked before it is compiled, and with the same engine the CLI uses. A
  // browser is the one place where nobody sees a build log, so a model that says
  // something impossible has to say so here or nowhere.
  const review = reviewModel(options.source, { autoFix: options.autoFix !== false });
  if (!review.ok) {
    console.warn = originalWarn;
    throw new ModelCheckError(review);
  }
  const source = review.source;

  let parsed: ParsedModel;
  try {
    parsed = parseModel(source);
  } finally {
    console.warn = originalWarn;
  }

  if (!parsed.entities.length) {
    throw new Error(
      "This model declares no entities. An EML document needs an `erDiagram` section — " +
        "check that the file is a Mermaid ER diagram and not, say, a flowchart on its own."
    );
  }

  const name = options.name?.trim() || "Generated App";
  const generated = generateWasmApp(parsed, {
    name,
    version: options.version ?? "1.0.0",
    description: options.description ?? `Generated from ${parsed.entities.length} entities`,
    adminEmail: options.adminEmail ?? "admin@admin.com",
    adminPassword: options.adminPassword ?? "admin",
    adminName: options.adminName ?? "admin",
    source,
    pgliteUrl: options.pgliteUrl,
    /* Passed through rather than defaulted here. The generator's own default is
       zero, and a page that generates an application for a model someone is
       about to read should not invent records in it unasked — but a page that
       then *boots* that application has the opposite problem, so the choice is
       the caller's and this only carries it. */
    sampleRecords: options.sampleRecords,
    sampleSeed: options.sampleSeed,
    sampleNullRate: options.sampleNullRate,
  });

  return {
    files: Object.fromEntries(generated.files),
    summary: {
      project: name,
      entities: parsed.entities.map((entity) => entity.name),
      categories: parsed.categories.map((category) => category.name),
      relationships: parsed.relationships.length,
      enums: parsed.enums.length,
      rules: parsed.rules.map((rule) => rule.name),
      hooks: parsed.hooks.length,
      workflows: parsed.workflows.map((workflow) => workflow.name),
      sagas: parsed.sagas.map((saga) => saga.name),
      accessRules: parsed.rbac.operations.length + parsed.rbac.transitions.length,
      fileCount: generated.stats.fileCount,
      bytes: generated.stats.bytes,
      sampleRows: generated.stats.sampleRows,
    },
    warnings,
    review,
  };
}
