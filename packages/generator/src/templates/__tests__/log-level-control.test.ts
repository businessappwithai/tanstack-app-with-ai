/**
 * Changing a log level on a running process, and who may.
 *
 * The decisions are plain TypeScript copied into every generated backend, so they are
 * imported from the template tree and driven with plain values.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  describeLevels,
  LEVEL_NAMES,
  parseLevel,
} from "../../../templates/tanstack-start-nestjs/backend/src/common/logging/level-control";
import {
  heldRoles,
  isAdministrator,
} from "../../../templates/tanstack-start-nestjs/backend/src/modules/auth/guards/admin-roles";

const BACKEND = join(import.meta.dirname, "../../../templates/tanstack-start-nestjs/backend/src");

describe("parseLevel", () => {
  it("accepts every level and silent", () => {
    for (const level of LEVEL_NAMES) expect(parseLevel(level)).toBe(level);
  });

  it("refuses anything else, including a level in the wrong case", () => {
    for (const value of ["DEBUG", "loud", "", null, undefined, 3, {}]) {
      expect(parseLevel(value), String(value)).toBeNull();
    }
  });
});

describe("describeLevels", () => {
  it("reports declared, effective and whether an override is active", () => {
    const channels = [
      { name: "http", level: "info" },
      { name: "rules", level: "debug" },
    ];
    const report = describeLevels(channels, (c) => (c === "rules" ? "trace" : "info"), new Map([["rules", "trace"]]));
    expect(report).toEqual([
      { channel: "http", declared: "info", effective: "info", overridden: false },
      { channel: "rules", declared: "debug", effective: "trace", overridden: true },
    ]);
  });
});

describe("who is an administrator", () => {
  it("reads every place a role can arrive, case-insensitively", () => {
    expect(isAdministrator({ sysRoles: ["Administrator"] })).toBe(true);
    expect(isAdministrator({ roles: ["ADMIN"] })).toBe(true);
    expect(isAdministrator({ role: "admin" })).toBe(true);
    expect(isAdministrator({ isMaster: true })).toBe(true);
  });

  it("refuses an ordinary user, a user with no roles, and nobody", () => {
    expect(isAdministrator({ sysRoles: ["Clerk"], roles: ["user"], role: "user" })).toBe(false);
    expect(isAdministrator({})).toBe(false);
    expect(isAdministrator(null)).toBe(false);
    expect(isAdministrator(undefined)).toBe(false);
  });

  it("does not take a role that merely contains the word", () => {
    expect(isAdministrator({ sysRoles: ["administrative assistant"] })).toBe(false);
  });

  it("lists what a user holds, lower-cased, for the refusal message", () => {
    expect([...heldRoles({ sysRoles: ["Clerk"], role: "User" })].sort()).toEqual(["clerk", "user"]);
  });
});

describe("the wiring", () => {
  const read = (relative: string) => readFileSync(join(BACKEND, relative), "utf-8");

  it("guards every method of the logging controller, reads included", () => {
    const controller = read("modules/logging/logging.controller.ts");
    expect(controller).toContain("@UseGuards(SessionAuthGuard, AdminOnlyGuard)");
    // The guard must not borrow the dictionary guard's read exemption.
    expect(read("modules/auth/guards/admin-only.guard.ts.hbs")).not.toMatch(/READ_METHODS|GET/);
  });

  it("has the dictionary guard and the admin guard read roles the same way", () => {
    expect(read("modules/auth/guards/dictionary-write.guard.ts.hbs")).toContain("isAdministrator");
    expect(read("modules/auth/guards/admin-only.guard.ts.hbs")).toContain("isAdministrator");
  });

  it("registers the module in the application", () => {
    expect(read("app.module.ts.hbs")).toContain("LoggingModule");
  });
});
