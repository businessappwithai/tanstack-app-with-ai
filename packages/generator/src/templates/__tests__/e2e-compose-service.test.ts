/**
 * The generated end-to-end suite is runnable on demand from the compose file:
 * `docker compose run --rm e2e`.
 *
 * Held here: the service exists behind the `test` profile (so `up` never starts
 * it), waits for both applications and for the seeder to finish, builds the
 * generated `tests/` project, sits between removable markers (so `skipTests`
 * can drop it with the project it builds), and the new suites and harness are
 * registered with the generator and have templates.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const TEMPLATES = join(import.meta.dirname, "../../../templates/tanstack-start-nestjs");
const compose = readFileSync(join(TEMPLATES, "docker-compose.yml.hbs"), "utf8");
const generator = readFileSync(
  join(import.meta.dirname, "../../generators/tests/bun-e2e.generator.ts"),
  "utf8"
);
const e2e = /\n  # <e2e>[\s\S]*?# <\/e2e>\n/.exec(compose)?.[0] ?? "";

describe("the e2e compose service", () => {
  it("is a removable block", () => {
    expect(e2e).not.toBe("");
  });

  it("is behind the test profile and builds the generated tests project", () => {
    expect(e2e).toContain('profiles: ["test"]');
    expect(e2e).toContain("context: ./tests");
  });

  it("waits for the backend, the frontend, the reporting platform and the seeder", () => {
    expect(e2e).toMatch(/backend:\s+condition: service_healthy/);
    expect(e2e).toMatch(/frontend:\s+condition: service_started/);
    expect(e2e).toMatch(/report:\s+condition: service_healthy/);
    expect(e2e).toMatch(/report-seeder:\s+condition: service_completed_successfully/);
  });

  it("reads the pack the seeder loaded rather than deriving one", () => {
    expect(e2e).toContain("./reporting/reporting-pack.json:/app/reporting/reporting-pack.json:ro");
    expect(e2e).toContain("E2E_REPORT_PACK");
  });

  it("lets the backend trust the front end's address on the compose network", () => {
    expect(compose).toMatch(/CORS_ORIGIN: \$\{CORS_ORIGIN:-.*http:\/\/frontend:/);
    expect(e2e).toContain("E2E_ORIGIN: ${E2E_ORIGIN:-http://frontend:");
  });

  it("raises the throttle and trusts the report origin, so a run is deterministic", () => {
    expect(compose).toContain("THROTTLE_LIMIT:");
    expect(compose).toContain("BETTER_AUTH_URL: ${REPORT_BASE_URL");
  });
});

describe("the reporting suites are registered", () => {
  for (const suite of [
    "26-status-flows-by-role",
    "28-reporting-platform",
    "29-app-and-reports-together",
  ]) {
    it(`${suite} has a template and is in SHARED_SUITES`, () => {
      expect(generator).toContain(`"${suite}.test.ts"`);
      expect(existsSync(join(TEMPLATES, "tests/suites", `${suite}.test.ts.hbs`))).toBe(true);
    });
  }

  it("has a browser-layer service whose image uses a glibc bun", () => {
    expect(e2e).toContain("e2e-ui:");
    expect(e2e).toContain("dockerfile: Dockerfile.ui");
    const ui = readFileSync(join(TEMPLATES, "tests/Dockerfile.ui.hbs"), "utf8");
    // The Playwright image is glibc; an Alpine bun copied into it exits 127.
    expect(ui).toMatch(/^FROM oven\/bun:1\.4\.4 AS bun$/m);
    expect(ui).not.toMatch(/^FROM oven\/bun:[^ ]*alpine/m);
  });

  it("ships the reporting harness module and the tests Dockerfile", () => {
    expect(generator).toContain('"reporting.ts"');
    expect(existsSync(join(TEMPLATES, "tests/harness/reporting.ts.hbs"))).toBe(true);
    expect(generator).toContain('"Dockerfile"');
    expect(existsSync(join(TEMPLATES, "tests/Dockerfile.hbs"))).toBe(true);
  });
});
