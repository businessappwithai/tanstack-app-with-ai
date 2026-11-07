/**
 * Regression: the generators named templates that were not there.
 *
 * `nestjs-backend.generator.ts` listed seven `src/common/**` files to render
 * and three of them had no template:
 *
 *   src/common/decorators/etag.decorator.ts
 *   src/common/guards/etag.guard.ts
 *   src/common/interceptors/logging.interceptor.ts
 *
 * Two were for an ETag feature nobody ever wrote — the only trace of it left
 * in the tree is `ETag` in the CORS `exposedHeaders` — and the third was
 * deliberately abandoned, because HTTP logging is a Fastify `onResponse` hook
 * and an interceptor would see no 401, no 403 and none of the better-auth
 * routes.
 *
 * None of that was visible, because the loop rendering them was wrapped in a
 * try/catch whose whole body was the comment "Template may not exist, skip".
 * A list allowed to lie will, and the cost is not the dead entries: it is
 * that a *live* one can go missing the same way. A Handlebars syntax error
 * raises through the same catch, so a template with a typo would silently
 * vanish from the generated application and the first symptom would be a
 * build failure somewhere else.
 *
 * This test sweeps every generator's source for template paths and asserts
 * each resolves on disk — so the sixteen arrays across the two generators are
 * covered, not just the one that rotted, and so is any ad-hoc
 * `renderTemplate` call that names a path inline.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { COMMON_TEMPLATES } from "../tanstack-start-nestjs/nestjs-backend.generator";

const GENERATOR_ROOT = join(import.meta.dirname, "..");
const TEMPLATE_ROOT = join(import.meta.dirname, "../../../templates");

/**
 * The roots a generator resolves a template path against.
 *
 * Each generator knows its own, and they are not recorded anywhere a test can
 * read. Trying every one is deliberately lenient: this test is here to catch a
 * path that exists under *none* of them, which is the failure that actually
 * happened. A path that resolves under the wrong root is a different bug and
 * the generated application would not build.
 */
const TEMPLATE_ROOTS = [
  "tanstack-start-nestjs",
  "tanstack-start-nestjs/backend",
  "tanstack-start-nestjs/frontend",
  "common",
  "",
];

/**
 * Paths that look like templates and are not.
 *
 * `log-spec.json` is the generated application's log specification, derived
 * from the canonical one by `logging/generated-spec.ts` and written straight
 * to disk rather than rendered — deliberately, so the two cannot drift. The
 * string in the generator is where it is *written*, not where it is read from.
 *
 * `state-fields.ts` is the table → state field map the guard and the bus
 * service read. It is rendered from the compiled state machines by
 * `renderStateFields`, not from a template, because the initial state is not
 * stored anywhere a template could read it.
 *
 * `src/common/field-logic.ts` (backend) and `src/lib/field-logic.ts` (front
 * end) are where the field-logic evaluator is *written*: both are copies of one
 * template, `templates/common/field-logic.ts`, itself held byte-identical to
 * `language/field-logic.ts` by `field-logic.test.ts`. One source, two outputs.
 *
 * An addition here needs a reason written beside it. That is the point of the
 * allowlist being short: a new entry is a review conversation, not a habit.
 */
const OUTPUT_ONLY_PATHS = new Set([
  "src/common/logging/log-spec.json",
  "src/common/state-fields.ts",
  "src/common/field-logic.ts",
  "src/lib/field-logic.ts",
  // `templates/common/field-values.ts`, copied the same way: Default Value and
  // Obscure Type for the bus service and for the form and grid.
  "src/common/field-values.ts",
  "src/lib/field-values.ts",
  // `templates/common/cascade-lookups.ts`: which lookups wait for another, with a circular
  // wait broken; the bus service applies it to the metadata the form is drawn from.
  "src/common/cascade-lookups.ts",
  // Every table's lifecycle, rendered by `renderLifecycle` from the compiled
  // state machines like `state-fields.ts`, around the fixed half in
  // `lifecycle-module.ts`; the front end's copy comes from the same call.
  "src/common/lifecycle.ts",
  "src/lib/lifecycle.ts",
]);

/** Generator sources, excluding tests and generated bundles. */
function generatorSources(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "__tests__") generatorSources(full, found);
    } else if (name.endsWith(".ts") && !name.endsWith(".generated.ts")) {
      found.push(full);
    }
  }
  return found;
}

/** Does this path resolve to a template, with or without the `.hbs` suffix? */
function resolves(templatePath: string): boolean {
  return TEMPLATE_ROOTS.some(
    (root) =>
      existsSync(join(TEMPLATE_ROOT, root, templatePath)) ||
      existsSync(join(TEMPLATE_ROOT, root, `${templatePath}.hbs`))
  );
}

describe("templates the generators declare", () => {
  it("has a template for every path named in generator source", () => {
    const missing: string[] = [];

    for (const file of generatorSources(GENERATOR_ROOT)) {
      const source = readFileSync(file, "utf8");
      // A quoted `src/…` path with a file extension: how every one of these
      // arrays spells an entry.
      for (const match of source.matchAll(
        /["'`](src\/[A-Za-z0-9_\-./$]+\.(?:ts|tsx|css|json|js|sh))["'`]/g
      )) {
        const templatePath = match[1] as string;
        if (OUTPUT_ONLY_PATHS.has(templatePath)) continue;
        if (resolves(templatePath)) continue;
        missing.push(`${relative(GENERATOR_ROOT, file)} names ${templatePath}`);
      }
    }

    // Named, not counted: the fix is either to write the template, to delete
    // the entry, or — if it is an output path rather than a template — to add
    // it to OUTPUT_ONLY_PATHS with a reason.
    expect([...new Set(missing)].sort()).toEqual([]);
  });

  it("renders every common template without a fallback", () => {
    // This list is the one that rotted, and it is exported so the assertion
    // reads the real array rather than a copy of it.
    expect(COMMON_TEMPLATES.length).toBeGreaterThan(0);
    for (const templatePath of COMMON_TEMPLATES) {
      expect(resolves(templatePath), `${templatePath} has no template`).toBe(true);
    }
  });
});
