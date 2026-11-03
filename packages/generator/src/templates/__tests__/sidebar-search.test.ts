/**
 * The sidebar's navigation search.
 *
 * A generated application's navigation is as long as its model: the hospital
 * example puts twenty-six entities in the sidebar across seven categories, and
 * finding one by scrolling is the thing this replaces. The search is entirely
 * client-side, because `/sys/categories/dashboard` has already delivered every
 * row the list is drawn from — going back to the server to filter data that is
 * in the browser would be slower and would fail offline.
 *
 * These are shape assertions on the template, which is what this repository can
 * test about a `.hbs` file; the behaviour itself — ranking, wrapping, Enter,
 * Escape — was driven in Chromium against a generated application. What they
 * protect is the set of things that are easy to delete by accident and silent
 * when gone: the combobox semantics a screen reader needs, the keys, and the
 * fact that the physical table name is searchable.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SIDEBAR = readFileSync(
  join(
    import.meta.dirname,
    "../../../templates/tanstack-start-nestjs/frontend/src/components/layout/sidebar.tsx.hbs"
  ),
  "utf8"
);

describe("the sidebar search", () => {
  it("renders an input that filters without a round trip", () => {
    expect(SIDEBAR).toContain('placeholder="Search screens..."');
    // No fetch, no query key, no endpoint: the rows are already here.
    const searchRegion = SIDEBAR.slice(SIDEBAR.indexOf("const results = useMemo"));
    expect(searchRegion).not.toMatch(/apiClient\.(get|post)/);
  });

  it("announces itself as a combobox over a listbox", () => {
    /*
     * Without these it is an input that mysteriously changes the page when you
     * press Enter. `aria-activedescendant` is the one that carries the keyboard
     * cursor to a screen reader — the visual highlight alone tells it nothing.
     */
    expect(SIDEBAR).toContain('role="combobox"');
    expect(SIDEBAR).toContain("aria-expanded=");
    expect(SIDEBAR).toContain("aria-activedescendant=");
    expect(SIDEBAR).toContain('role="listbox"');
    expect(SIDEBAR).toContain('role="option"');
    expect(SIDEBAR).toContain("aria-selected=");
  });

  it("handles the three keys a reader will try", () => {
    expect(SIDEBAR).toContain("'ArrowDown'");
    expect(SIDEBAR).toContain("'ArrowUp'");
    expect(SIDEBAR).toContain("'Enter'");
    expect(SIDEBAR).toContain("'Escape'");
  });

  it("clears the query before it gives up the focus on Escape", () => {
    // One press should undo the typing, not also throw away the focus and make
    // the reader click back in.
    const handler = SIDEBAR.slice(SIDEBAR.indexOf("event.key === 'Escape'"));
    const clearAt = handler.indexOf("setQuery('')");
    const blurAt = handler.indexOf("blur()");
    expect(clearAt).toBeGreaterThan(-1);
    expect(blurAt).toBeGreaterThan(clearAt);
  });

  it("finds a screen by its physical table name and its category", () => {
    // Somebody reading a migration or a log knows the entity as
    // `bus_lab_order`; typing that should find "Lab Order".
    expect(SIDEBAR).toContain("keywords: `${table.table_name} ${group.name}`");
  });

  it("matches across spaces, underscores and hyphens", () => {
    // "laborder" finds "Lab Order".
    expect(SIDEBAR).toMatch(/function fold[\s\S]{0,200}replace\(\/\[\\s_-\]\+\/g, ''\)/);
  });

  it("ranks a prefix above a substring", () => {
    /*
     * Typing "pa" should offer Patient and Payment before Department. Asserted
     * on the tiers rather than on an outcome, because the outcome depends on
     * the model and this file is shared by every generated application.
     */
    const ranker = SIDEBAR.slice(SIDEBAR.indexOf("function rank("));
    const prefixAt = ranker.indexOf("startsWith(needle)");
    const includesAt = ranker.indexOf("title.includes(needle)");
    expect(prefixAt).toBeGreaterThan(-1);
    expect(includesAt).toBeGreaterThan(prefixAt);
  });

  it("keeps the fixed entry out of the component body", () => {
    /*
     * `DASHBOARD_ENTRY` is at module scope. As a literal in the body it was a
     * new object every render, and the `useMemo` that lists it as a dependency
     * recomputed on every keystroke — the memo was decorative, which is worse
     * than no memo because it reads as though the cost has been handled.
     */
    const bodyAt = SIDEBAR.indexOf("export function Sidebar(");
    expect(SIDEBAR.indexOf("const DASHBOARD_ENTRY")).toBeLessThan(bodyAt);
  });

  it("carries no Handlebars token it did not mean", () => {
    // This is a `.hbs` file, so a JSX `style={{ … }}` would be compiled as a
    // Handlebars expression and the generated file would be broken.
    const tokens = SIDEBAR.match(/\{\{[^}]*\}\}/g) ?? [];
    // The application name appears twice on purpose: the visible text and the `title` that
    // shows the whole of a long name the header clamps to two lines.
    expect(tokens.sort()).toEqual(["{{now}}", "{{project.name}}", "{{project.name}}"]);
  });
});
