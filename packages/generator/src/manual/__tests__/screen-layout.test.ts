/**
 * The manual reports the window, the tab and the fields — and reports the ones
 * the application actually draws.
 *
 * Two defects this covers, and they are different shapes.
 *
 * The first is absence. The manual described an entity's *columns* and stopped,
 * so the layer between a column and a screen — `sys_window`, `sys_tab`,
 * `sys_field`, which is what the running application reads on every render —
 * was in the dictionary, in the database, and in no document a reader was given.
 *
 * The second is the one adding it invites. `DictionaryGenerator` marks every
 * column grid-visible and leaves each consumer to narrow it: the browser stack
 * through `isNoise`, the NestJS seed through its own `GRID_NOISE`. A manual that
 * read the derivation raw would report a list carrying `id`, `version` and the
 * four audit columns that no application shows — accurate about the dictionary
 * and wrong about the screen, which is the worse of the two failures because it
 * reads as authoritative.
 *
 * The fixture is a real published model rather than one written to match the
 * renderer, for the reason `compile-reports.test.ts` gives: a fixture that
 * matches the code proves only that the code matches itself.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GRID_NOISE } from "../../generators/wasm/model-bundle";
import { parseModel } from "../../pipeline/parse-model";
import { renderManual } from "../index";

const MODEL = join(import.meta.dirname, "../../../../../language/examples/crm.eml.mmd");

function manual() {
  const parsed = parseModel(readFileSync(MODEL, "utf-8"));
  return {
    parsed,
    html: renderManual(parsed, {
      name: "CRM",
      version: "1.0.0",
      description: "A manual test",
      stack: "browser",
      generatedAt: "2026-01-01T00:00:00.000Z",
    }),
  };
}

describe("the manual's screen layout", () => {
  it("gives every entity a window, a tab and its fields", () => {
    const { parsed, html } = manual();

    expect(parsed.entities.length).toBeGreaterThan(0);
    const blocks = html.match(/Where it appears/g) ?? [];
    expect(blocks).toHaveLength(parsed.entities.length);

    /* Not just the heading: the sentence naming the window and the tab has to be
       there too, or the section is a title over an empty table. */
    const named =
      html.match(/opens this record in the <b>[^<]+<\/b> window, on the <b>[^<]+<\/b> tab/g) ?? [];
    expect(named).toHaveLength(parsed.entities.length);
  });

  it("does not report the audit columns as part of the list", () => {
    const { html } = manual();

    /* Each row is Column | Label | On the form | In the list | Order | Read only.
       A noise column must reach the form and not the list. */
    for (const column of GRID_NOISE) {
      const row = new RegExp(
        `<td><code>${column}</code></td>\\s*<td>[^<]*</td>\\s*<td>(Yes|No)</td>\\s*<td>(Yes|No)</td>`,
        "g"
      );
      for (const match of html.matchAll(row)) {
        expect(
          match[2],
          `${column} is in GRID_NOISE, so the manual must not show it in the list`
        ).toBe("No");
      }
    }
  });

  it("orders the fields the way the screen draws them", () => {
    const { html } = manual();
    const table = html.slice(html.indexOf("Where it appears"));
    const orders = [...table.matchAll(/<td>(\d+)<\/td>\s*<td>(?:Yes|No)<\/td>\s*<\/tr>/g)]
      .slice(0, 8)
      .map((match) => Number(match[1]));

    expect(orders.length).toBeGreaterThan(1);
    expect([...orders]).toEqual([...orders].sort((a, b) => a - b));
  });
});
