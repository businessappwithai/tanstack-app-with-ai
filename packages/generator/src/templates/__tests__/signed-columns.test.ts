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
