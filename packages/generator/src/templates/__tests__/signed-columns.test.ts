/**
 * A decimal column's generated "must not be negative" rule must not apply to a
 * column that is signed by nature. Found driving the construction model:
 * `ProjectSite.latitude` of a site in the southern hemisphere was refused.
 */
import { describe, expect, it } from "vitest";
import { SIGNED_COLUMN } from "../loader";

describe("SIGNED_COLUMN", () => {
  it.each(["latitude", "longitude", "lat", "lng", "site_latitude", "cost_variance", "balance"])(
    "treats %s as signed",
    (name) => expect(SIGNED_COLUMN.test(name)).toBe(true)
  );
  it.each(["amount", "quantity", "price", "platform_fee", "contribution", "salary"])(
    "leaves %s non-negative",
    (name) => expect(SIGNED_COLUMN.test(name)).toBe(false)
  );
});

describe("the generated suite's static rule builder", () => {
  it("keeps the same list as the generator's helper", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const template = readFileSync(
      join(__dirname, "../../../templates/tanstack-start-nestjs/tests/harness/rules.ts.hbs"),
      "utf8"
    );
    const match = template.match(/const SIGNED_COLUMN =\s*\/(.+)\/i;/);
    expect(match, "the harness carries its own SIGNED_COLUMN").not.toBeNull();
    expect(match![1]).toBe(SIGNED_COLUMN.source);
  });
});
