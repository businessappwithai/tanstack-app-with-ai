/**
 * Regression: ADMIN_PASSWORD was advertised by `.env.example` and the start-up
 * code, but the users seed — which runs first, on every start — created
 * `admin@admin.com` with the hard-coded "admin123", so the variable never
 * applied and the application's own admin step found the account already there.
 *
 * The seed now gives the Administrator ADMIN_PASSWORD (8+ characters), leaves
 * the other demo accounts on the default, and never prints a supplied password.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const TEMPLATES = join(import.meta.dirname, "../../../templates");
const seed = readFileSync(join(TEMPLATES, "common/seeds/users-and-roles.ts.hbs"), "utf8");
const compose = readFileSync(join(TEMPLATES, "tanstack-start-nestjs/docker-compose.yml.hbs"), "utf8");

describe("the users seed honours ADMIN_PASSWORD", () => {
  it("signs the Administrator up with it, not the constant", () => {
    expect(seed).toContain("process.env.ADMIN_PASSWORD");
    expect(seed).toMatch(/signUpEmail\(\{\s*body: \{ email: userDef\.email, password, name/);
    expect(seed).not.toMatch(/password: DEFAULT_PASSWORD, name/);
  });

  it("only applies to the Administrator and enforces the 8-character minimum", () => {
    expect(seed).toContain("userDef.roleName !== 'Administrator'");
    expect(seed).toContain("configured.length < 8");
  });

  it("does not echo a supplied password", () => {
    expect(seed).toContain("password: from ADMIN_PASSWORD");
  });

  it("reaches the backend and the single-image service from compose", () => {
    expect(compose.match(/ADMIN_PASSWORD: \$\{ADMIN_PASSWORD:-\}/g)?.length).toBe(2);
  });
});
