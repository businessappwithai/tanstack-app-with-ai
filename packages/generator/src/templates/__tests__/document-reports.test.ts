/**
 * The per-entity document report, and the three ways it was not working.
 *
 * Every entity is seeded a printable layout, an administrator can redesign it
 * in Admin → Report Designs, and a Print button on the record renders it. All
 * three pieces were generated and none of them worked, in ways that produce no
 * error anywhere:
 *
 *   - the record screen looked a design up by the route slug (`account`) while
 *     designs are stored against the table (`bus_account`), so the lookup
 *     answered null for every business entity and the Print button never
 *     appeared;
 *   - the designer fetched its field list from `/sys/entity-metadata/:table`,
 *     a path no controller serves, so its data-source tree was empty and no
 *     field could be bound;
 *   - the seeded layout was not AnkaReport's `ILayout`. The renderer reads the
 *     layout directly and ignores anything shaped differently, so a layout
 *     with nested `style` objects, a numeric `fontSize` and no page `width`
 *     rendered as an unstyled, zero-width document.
 *
 * Each is pinned below, against the library's own contract.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const TEMPLATES = join(import.meta.dirname, "../..", "..", "templates");

function read(relative: string): string {
  return readFileSync(join(TEMPLATES, relative), "utf8");
}

describe("the record screen finds the design that was seeded for it", () => {
  const shell = read("tanstack-start-nestjs/frontend/src/components/admin/ad-detail-shell.tsx");

  it("looks the design up by table name, not by route slug", () => {
    expect(shell).toContain("helpTableNameFromEndpoint(level.endpoint)");
    expect(shell).toContain("`/sys/report-designs/${reportTableName}`");
    expect(shell).not.toContain("`/sys/report-designs/${level.id}`");
  });
});

describe("the designer is fed the window's own fields", () => {
  const route = read("tanstack-start-nestjs/frontend/src/routes/admin/reports.$tableName.tsx");

  // The data-source tree is the window's fields under their labels — the view
  // layer — not the table's columns with labels guessed from their names.
  it("reads the dictionary's windows, tabs and fields", () => {
    expect(route).toContain("useDictionaryTabs()");
    expect(route).toContain("tabForTable(tabs, tableName)");
    // Matched as a call rather than as a string, so the comment above the fix
    // naming the dead path does not itself fail this.
    expect(route).not.toMatch(/apiClient\.get[^)]*sys\/entity-metadata/);
  });

  it("memoises the column list so the designer is not remounted mid-edit", () => {
    expect(route).toContain("useMemo(");
  });
});

describe("the seeded layout is the shape AnkaReport reads", () => {
  const seed = read("common/seeds/report-designs.ts.hbs");

  it("sets the page width the renderer writes onto the element", () => {
    // Absent, the renderer assigns `undefinedpx` and the document has no width.
    expect(seed).toContain("width: PAGE_W");
  });

  it("puts style properties flat on the item, where they are inherited from", () => {
    // A nested `style` object is read by nobody: `applyLayout` copies named
    // properties off the item itself.
    expect(seed).not.toMatch(/style:\s*\{/);
    expect(seed).toContain("fontWeight: 'bold'");
  });

  it("writes fontSize as a CSS length", () => {
    // `element.style.fontSize = "11"` is invalid and silently dropped.
    expect(seed).toMatch(/fontSize: '\d+px'/);
    expect(seed).not.toMatch(/fontSize: \d/);
  });

  it("gives every section a binding and every item a name", () => {
    expect(seed).toContain("binding: 'records'");
    expect(seed.match(/binding: ''/g)?.length).toBe(2); // header and footer
    expect(seed).toContain("name: `${f.field}_label`");
  });
});

describe("the renderer and the designer are styled", () => {
  const modal = read("tanstack-start-nestjs/frontend/src/components/reports/ReportPrintModal.tsx");
  const designer = read("tanstack-start-nestjs/frontend/src/components/reports/ReportDesigner.tsx");

  it("imports the stylesheet the package ships separately from its bundle", () => {
    for (const source of [modal, designer]) {
      expect(source).toContain('import "ankareport/dist/ankareport.css"');
    }
  });

  it("resolves values so a null column does not print its own name", () => {
    // A bound item with an empty value falls back to the literal `[column]`.
    expect(modal).toContain("displayValue");
    expect(modal).toContain('return "—"');
  });
});
