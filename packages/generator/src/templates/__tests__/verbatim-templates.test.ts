/**
 * Regression: a template copied verbatim carried a Handlebars token.
 *
 * `packages/generator/templates` holds two kinds of file and the difference is
 * the extension. A `.hbs` file is compiled — `{{project.name}}` becomes the
 * project's name. Everything else is copied byte for byte, by `copyFile` or by
 * `BaseGenerator.component()`, and a `{{…}}` in one of those is shipped to the
 * generated application exactly as written.
 *
 * Ten files did. Each carried `* Generated: {{now}}` in its header comment,
 * inherited from a `.hbs` sibling, so every generated application shipped ten
 * files claiming to have been generated at `{{now}}` — including
 * `src/components/layout/index.ts`, which is three lines long.
 *
 * They compiled, which is why nobody noticed: all ten sat inside block
 * comments. A token in code would have been a syntax error and would have been
 * found the first time an application was built. This is the failure mode that
 * survives — visible only to whoever opens the file.
 *
 * The tokens listed below are the generator's own vocabulary: the context keys
 * `prepareContext` builds and the block helpers the templates use. Deliberately
 * not "any `{{`": the generated application's help documents the
 * generated application's *own* reference syntax, which is spelled the same way
 * — `{{tier.discount_pct}}`, `{{L1.iteration}}` — inside string literals it is
 * meant to display. Those are content, not tokens.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const TEMPLATE_ROOT = join(import.meta.dirname, "../../../templates");

/**
 * Handlebars constructs that only a compiled template can mean.
 *
 * A context key (`now`, `project.*`, `config.*`, `projectName`), a helper call,
 * or a block. Each would be substituted in a `.hbs` file and is shipped raw
 * from anything else.
 */
const GENERATOR_TOKENS = [
  /\{\{\s*now\s*\}\}/,
  /\{\{\s*project\./,
  /\{\{\s*config\./,
  /\{\{\s*projectName\s*\}\}/,
  /\{\{\s*projectSnake\s*\}\}/,
  /\{\{\s*projectKebab\s*\}\}/,
  /\{\{\s*entities\s*\}\}/,
  /\{\{[#/]/, // {{#each}}, {{#if}}, {{/each}} — a block, in any template
  /\{\{\s*(?:camelCase|kebabCase|snakeCase|pascalCase|tsString|seedValue)\s/,
];

/** Every file under the template root that is NOT compiled. */
function verbatimFiles(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules") continue;
      verbatimFiles(full, found);
    } else if (extname(name) !== ".hbs") {
      found.push(full);
    }
  }
  return found;
}

describe("templates copied verbatim", () => {
  const files = verbatimFiles(TEMPLATE_ROOT);

  it("finds the template tree", () => {
    // If the root ever moves, every assertion below passes vacuously.
    expect(files.length).toBeGreaterThan(100);
  });

  it("carry no Handlebars token the generator would have substituted", () => {
    const offenders: string[] = [];

    for (const file of files) {
      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue; // A binary asset; nothing to substitute in it.
      }
      // Cheap reject first: most files have no braces at all.
      if (!text.includes("{{")) continue;

      for (const token of GENERATOR_TOKENS) {
        const match = text.match(token);
        if (match) {
          offenders.push(`${relative(TEMPLATE_ROOT, file)}: ${match[0]}`);
          break;
        }
      }
    }

    // Named rather than counted: the failure has to say which file, because
    // the fix is either to delete the token or to rename the file to `.hbs`.
    expect(offenders).toEqual([]);
  });
});
