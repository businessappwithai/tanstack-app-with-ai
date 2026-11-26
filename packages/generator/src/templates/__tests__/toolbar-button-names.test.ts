/**
 * Regression: ISSUE-005 — Search and New had no accessible name on small screens.
 * Found by /qa on 2026-10-30
 * Report: .gstack/qa-reports/run-20261030T005141Z/qa-report-localhost-2026-10-30.md
 *
 * The record toolbar hid each button's word below `sm` with `hidden sm:inline`.
 * `display: none` takes the text out of the accessibility tree as well, so at 375px
 * a screen reader announced Search, New, Copy, Undo and Print as bare "button".
 * `sr-only sm:not-sr-only` hides the word from sight only.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const TOOLBAR = join(
  import.meta.dirname,
  "../../../templates/tanstack-start-nestjs/frontend/src/components/admin/ad-toolbar.tsx"
);

describe("record toolbar", () => {
  const source = readFileSync(TOOLBAR, "utf8");

  it("never removes a button's only text from the accessibility tree", () => {
    expect(source).not.toMatch(/className="hidden sm:inline"/);
  });

  it.each(["Search", "New", "Copy", "Undo", "Print"])("keeps %s announced", (word) => {
    expect(source).toContain(`<span className="sr-only sm:not-sr-only">${word}</span>`);
  });
});
