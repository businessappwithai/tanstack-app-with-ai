/**
 * The record form's half of optimistic locking: recognising a stale save, and
 * saying which fields the other save changed.
 *
 * Imported from the template by path — the file a generated application
 * ships — so a change to it is tested as written, not through a copy.
 */

import { describe, expect, it } from "vitest";
import {
  changedByOthers,
  ifMatchHeader,
  isVersionConflict,
} from "../../../templates/tanstack-start-nestjs/frontend/src/lib/version-conflict";

describe("isVersionConflict", () => {
  it("recognises the 409 a stale save receives", () => {
    expect(isVersionConflict({ statusCode: 409, details: { code: "VERSION_CONFLICT" } })).toBe(
      true
    );
  });

  it("does not mistake a duplicate key or any other error for one", () => {
    expect(
      isVersionConflict({
        statusCode: 409,
        message: "A record with the same value already exists.",
      })
    ).toBe(false);
    expect(isVersionConflict({ statusCode: 422, details: { code: "VERSION_CONFLICT" } })).toBe(
      false
    );
    expect(isVersionConflict(null)).toBe(false);
  });
});

describe("ifMatchHeader", () => {
  it("quotes the version, and sends nothing when there is none", () => {
    expect(ifMatchHeader(3)).toEqual({ "If-Match": '"3"' });
    expect(ifMatchHeader("4")).toEqual({ "If-Match": '"4"' });
    expect(ifMatchHeader(undefined)).toEqual({});
    expect(ifMatchHeader(null)).toEqual({});
  });
});

describe("changedByOthers", () => {
  const base = {
    id: "r1",
    version: 2,
    name: "Acme",
    city: "Paris",
    amount: "100.0000",
    notes: null,
  };

  it("lists only what the other save changed, never managed columns", () => {
    const theirs = { ...base, version: 3, updated_at: "later", city: "Lyon" };
    const mine = { ...base, name: "Acme Ltd" };
    const fields = changedByOthers(base, mine, theirs);
    expect(fields.map((f) => f.field)).toEqual(["city"]);
    expect(fields[0]).toMatchObject({ theirs: "Lyon", mine: "Paris", clash: false });
  });

  it("marks a field both people changed to different values, first", () => {
    const theirs = { ...base, version: 3, city: "Lyon", name: "Acme SA" };
    const mine = { ...base, name: "Acme Ltd" };
    const fields = changedByOthers(base, mine, theirs);
    expect(fields[0]).toMatchObject({
      field: "name",
      clash: true,
      theirs: "Acme SA",
      mine: "Acme Ltd",
    });
    expect(fields.find((f) => f.field === "city")?.clash).toBe(false);
  });

  it("is not a clash when both made the same change", () => {
    const theirs = { ...base, version: 3, city: "Lyon" };
    const mine = { ...base, city: "Lyon" };
    expect(changedByOthers(base, mine, theirs)[0]).toMatchObject({ field: "city", clash: false });
  });

  it("treats a NUMERIC string and the number it holds as the same value", () => {
    const theirs = { ...base, version: 3, amount: 100 };
    expect(changedByOthers(base, base, theirs)).toEqual([]);
  });
});
