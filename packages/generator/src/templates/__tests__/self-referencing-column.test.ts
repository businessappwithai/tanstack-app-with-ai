/**
 * Regression: a self-referencing hierarchy column could never be written.
 *
 * `bus.service` stripped any `<entity>_id` field on create, on the assumption
 * that it is a legacy primary-key alias. For `AssetClass.asset_class_id` — a
 * real column pointing at the parent asset class — that discarded the value,
 * and the generated "reference is required" rule then refused every create:
 * "Asset Class is required". Seeded rows existed, so the list looked fine and
 * only a write failed.
 *
 * The strip must apply only when the table has no such column of its own.
 *
 * Found running the website's deployable zip under docker compose on the
 * investment-planning v1.0.1 model.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SERVICE = join(
  import.meta.dirname,
  "../../../templates/tanstack-start-nestjs/backend/src/modules/bus/bus.service.ts.hbs"
);

describe("bus.service create — entity-named id column", () => {
  const source = readFileSync(SERVICE, "utf8");

  it("only strips `<entity>_id` when the table has no column of that name", () => {
    expect(source).toMatch(/hasOwnColumn\s*=\s*metadata\.columns\.some\(/);
    expect(source).toMatch(/if \(!hasOwnColumn && entityPkField in processedData\)/);
  });
});

const RULES_ENGINE = join(
  import.meta.dirname,
  "../../../templates/tanstack-start-nestjs/backend/src/modules/rules/rules-engine.service.ts.hbs"
);

describe("rules engine — a drawn rule with no %%action rows", () => {
  const source = readFileSync(RULES_ENGINE, "utf8");

  it("is skipped quietly instead of logged as an engine error on every write", () => {
    // Public: a workflow Decision step asks it too, to name a drawn rule rather than fail on it.
    expect(source).toMatch(/\n  isDiagramOnly\(/);
    expect(source).toMatch(/if \(this\.isDiagramOnly\(jdmContent\)\)/);
  });
});
