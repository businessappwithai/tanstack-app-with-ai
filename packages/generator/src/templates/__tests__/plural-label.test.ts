/**
 * Regression: ISSUE-004 — the Dangerous Goods list was titled "Dangerous Goodses".
 * Found by /qa on 2026-10-30
 * Report: .gstack/qa-reports/run-20261030T005141Z/qa-report-localhost-2026-10-30.md
 *
 * The list and record shells each carried a copy of `pluralLabel`, and both added
 * "es" to any label ending in "s", so a name that is already plural was pluralised
 * again. There is one copy now, `frontend/src/lib/plural-label.ts`, and both shells
 * import it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pluralLabel } from "../../../templates/tanstack-start-nestjs/frontend/src/lib/plural-label";

const ADMIN = join(
  import.meta.dirname,
  "../../../templates/tanstack-start-nestjs/frontend/src/components/admin"
);

describe("pluralLabel", () => {
  it.each([
    ["Dangerous Goods", "Dangerous Goods"],
    ["Booking Terms", "Booking Terms"],
    ["Shipment", "Shipments"],
    ["Party", "Parties"],
    ["Delivery", "Deliveries"],
    ["Journey", "Journeys"],
    ["Address", "Addresses"],
    ["Status", "Statuses"],
    ["Bus", "Buses"],
    ["Tax", "Taxes"],
    ["Branch", "Branches"],
    ["Customs Filing", "Customs Filings"],
    ["Analysis", "Analyses"],
  ])("%s → %s", (singular, plural) => {
    expect(pluralLabel(singular)).toBe(plural);
  });
});

describe("frontend generator", () => {
  it("writes the module the shells import (it copies a fixed list, not the directory)", () => {
    const generator = readFileSync(
      join(import.meta.dirname, "../../generators/tanstack-start-nestjs/tanstack-start-frontend.generator.ts"),
      "utf8"
    );
    expect(generator).toContain('this.component("src/lib/plural-label.ts")');
  });
});

describe.each(["ad-list-shell.tsx", "ad-detail-shell.tsx"])("%s", (file) => {
  const source = readFileSync(join(ADMIN, file), "utf8");

  it("uses the one shared pluralLabel instead of a copy of its own", () => {
    expect(source).toContain('import { pluralLabel } from "@/lib/plural-label";');
    expect(source).not.toMatch(/function pluralLabel\(/);
  });
});
