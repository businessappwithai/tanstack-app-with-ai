/**
 * Regression: ISSUE-001 — a reference dropdown offered only the first 20 records.
 * Found by /qa on 2026-10-30
 * Report: .gstack/qa-reports/run-20261030T005141Z/qa-report-localhost-2026-10-30.md
 *
 * `TableReferenceField` read the referenced table through `useEntities` with no
 * `limit`, so the API's default page of 20 was all a form could choose from. On the
 * shipping model a shipment whose branch was the 21st showed that branch in view
 * mode and "Select Branch..." in edit mode, and no branch past the 20th could ever
 * be picked. The view-mode reader and the custom-endpoint reader beside it already
 * asked for 500; the editable one has to ask for the same.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FORM = join(
  import.meta.dirname,
  "../../../templates/tanstack-start-nestjs/frontend/src/components/forms/dynamic-form.tsx"
);

describe("dynamic form reference lookup", () => {
  const source = readFileSync(FORM, "utf8");
  const start = source.indexOf("function TableReferenceField(");
  const field = source.slice(start, source.indexOf("\nfunction ", start + 1));

  it("is the component under test", () => {
    expect(start).toBeGreaterThan(-1);
    expect(field).toContain("useEntities");
  });

  it("asks for as many referenced records as the other lookups do", () => {
    const call = field.slice(field.indexOf("useEntities"), field.indexOf("useEntities") + 300);
    expect(call).toMatch(/limit:\s*REFERENCE_LOOKUP_LIMIT/);
    expect(source).toMatch(/const REFERENCE_LOOKUP_LIMIT = 500;/);
  });
});
