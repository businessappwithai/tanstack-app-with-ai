/**
 * Every published model builds a reporting pack.
 *
 * `buildReportingPack` refuses a pack whose items share a name, because the reporting platform upserts by
 * name and would collapse them into one row. The checker holds a dashboard's *name* to be unique (EML297)
 * but not its title, so two hand-written dashboards both called "Rooms and capacity" checked clean and
 * only failed when the whole stack was generated. This builds the pack for each published model so the
 * next collision fails here, in seconds, rather than in the pack job against a database.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseModel } from "../../pipeline/parse-model";
import { buildReportingPack } from "../pack";

const ROOT = resolve(__dirname, "../../../../..");

const PUBLISHED = [
  "language/examples/crm.eml.mmd",
  "language/examples/dance-studio.eml.mmd",
  "examples/drug-discovery.eml.mmd",
  "examples/airport-management-system.eml.mmd",
  "examples/shipping-management-system.eml.mmd",
  "examples/investment-planning-wealth-management-system.eml.mmd",
  "examples/hospital-management-system.mmd",
  "docs/eml-sessions/education-management-system/education-management-system.mmd",
  "html/models/education-management-system.mmd",
  "html/models/sales.mmd",
  "html/models/service-management.mmd",
  "html/models/construction-enterprise-management.mmd",
];

describe("the published models' reporting packs", () => {
  for (const file of PUBLISHED) {
    it(`${file} builds, with every dashboard and report named once`, () => {
      const model = parseModel(readFileSync(resolve(ROOT, file), "utf8"));
      const pack = buildReportingPack(model, {
        projectName: "published",
        name: "Published",
        description: "A published model",
      });
      const titles = pack.dashboards.map((d) => d.name);
      expect(new Set(titles).size).toBe(titles.length);
    });
  }
});
