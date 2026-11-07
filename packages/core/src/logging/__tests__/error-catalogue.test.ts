/**
 * The error catalogue, held to the rules that make it worth having.
 *
 * `log-spec.json` declares twelve categories and, for each error a client may
 * branch on, a code, a status and a message. The validator in `spec.ts` refuses
 * a spec that contradicts itself at load; this file states the *policy* in
 * plain assertions so that weakening it is a visible edit to a test, not a
 * quiet edit to a JSON file.
 */

import { describe, expect, it } from "vitest";

import { categoryForStatus, errorCodes, findError, findErrorCategory, logSpec } from "../spec";

const CATEGORY_NAMES = [
  "validation",
  "authentication",
  "authorization",
  "not_found",
  "conflict",
  "business_rule",
  "workflow",
  "rate_limit",
  "integration",
  "database",
  "configuration",
  "internal",
];

describe("the error categories", () => {
  it("are the twelve every product shares", () => {
    expect(logSpec.errorCategories.map((category) => category.name)).toEqual(CATEGORY_NAMES);
  });

  it("never log a caller's mistake at error", () => {
    for (const category of logSpec.errorCategories) {
      if (category.statuses.every((status) => status < 500)) {
        expect(["warn", "info"], category.name).toContain(category.level);
      }
    }
  });

  it("always log a server failure at error or above", () => {
    for (const category of logSpec.errorCategories) {
      if (category.statuses.every((status) => status >= 500)) {
        expect(["error", "fatal"], category.name).toContain(category.level);
      }
    }
  });

  it("never show a server failure's cause to the caller", () => {
    for (const name of ["integration", "database", "configuration", "internal"]) {
      expect(findErrorCategory(name)?.expose, name).toBe("generic");
    }
  });

  it("never describe why access was refused", () => {
    expect(findErrorCategory("authentication")?.expose).toBe("generic");
    expect(findErrorCategory("authorization")?.expose).not.toBe("message");
  });
});

describe("the error codes", () => {
  it("are unique and UPPER_SNAKE_CASE", () => {
    const codes = errorCodes();
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[A-Z][A-Z0-9_]*$/);
  });

  it("keep every code the generated application already sends", () => {
    // These are read by generated suites and by the front end. Renaming one
    // is a breaking change to the API, not a tidy-up.
    for (const code of [
      "VERSION_CONFLICT",
      "WORKFLOW_FAILED",
      "TRANSITION_FORBIDDEN",
      "RULE_REFUSED",
      "RECORD_FINAL",
      "PRECONDITION_REQUIRED",
      "INVALID_TRANSITION",
      "LIFECYCLE_STATES_IN_USE",
      "STATE_FIELD_SYSTEM_MANAGED",
    ]) {
      expect(findError(code), code).toBeDefined();
    }
  });

  it("carry the status the application already answers with", () => {
    const status = (code: string) => findError(code)?.status;
    expect(status("VERSION_CONFLICT")).toBe(409);
    expect(status("PRECONDITION_REQUIRED")).toBe(428);
    expect(status("RULE_REFUSED")).toBe(422);
    expect(status("WORKFLOW_FAILED")).toBe(422);
    expect(status("TRANSITION_FORBIDDEN")).toBe(403);
    expect(status("STATE_FIELD_SYSTEM_MANAGED")).toBe(403);
  });

  it("put a session lookup that failed in the database category, not authentication", () => {
    // A busy database must not read as "signed out": the front end signs the
    // person out on a 401.
    const error = findError("SESSION_UNAVAILABLE");
    expect(error?.category).toBe("database");
    expect(error?.status).toBe(503);
  });

  it("give every category a catch-all or a specific code, so none is unreachable", () => {
    for (const category of logSpec.errorCategories) {
      const codes = logSpec.errors.filter((error) => error.category === category.name);
      expect(codes.length, `category ${category.name} has no code`).toBeGreaterThan(0);
    }
  });
});

describe("classifying a status that carries no code", () => {
  it("reads a bare 404 as not_found and a bare 409 as conflict", () => {
    expect(categoryForStatus(404).name).toBe("not_found");
    expect(categoryForStatus(409).name).toBe("conflict");
  });

  it("reads 422 as validation before a business rule", () => {
    expect(categoryForStatus(422).name).toBe("validation");
  });

  it("falls back to internal for an unknown 5xx and validation for an unknown 4xx", () => {
    expect(categoryForStatus(599).name).toBe("internal");
    expect(categoryForStatus(418).name).toBe("validation");
  });
});
