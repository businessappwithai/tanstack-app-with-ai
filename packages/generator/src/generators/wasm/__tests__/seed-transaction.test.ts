/**
 * The browser stack's first-boot seed is one transaction.
 *
 * On the browser's `idb://` store PGlite writes its files back to IndexedDB
 * after every statement made outside a transaction. The seed is thousands of
 * statements, so on the CRM model it took over three minutes to reach sign-in —
 * and the E2E job's wait for it (180s) timed out, taking the twelve tests that
 * depend on it with it. In memory the same seed is two seconds, which is why
 * nothing run under node ever showed it.
 *
 * The cause cannot be reproduced without IndexedDB, so this holds the *shape*
 * that fixes it: every seed statement goes through a transaction, not through
 * the top-level connection. And because one rejected statement aborts a
 * transaction, the sample rows — which are tolerated one at a time — must each
 * be guarded, or a single bad row would cost the whole seed.
 *
 * Runs in a child process under Bun, as `audit-ledger.test.ts` does: PGlite
 * will not load under this suite's jsdom environment.
 */

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FIXTURE = join(import.meta.dirname, "fixtures/exercise-seed.ts");

function exercise(): {
  one: {
    transactions: number;
    topLevelAfterSeedStart: number;
    marker: string | null;
    orders: number;
  };
  two: {
    skipped: boolean;
    lines: number;
    goodLines: number;
    orders: number;
    marker: string | null;
  };
  three: { threw: boolean; marker: string | null; tables: number };
} {
  try {
    const stdout = execFileSync("bun", [FIXTURE], {
      encoding: "utf-8",
      timeout: 120_000,
      env: { ...process.env, BUN_OPTIONS: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(stdout.trim().split("\n").pop() ?? "");
  } catch (error) {
    const detail = error as { stderr?: Buffer | string; stdout?: Buffer | string };
    throw new Error(
      `The seed fixture failed.\n--- stderr ---\n${String(detail.stderr ?? "")}` +
        `\n--- stdout ---\n${String(detail.stdout ?? "")}`
    );
  }
}

const report = exercise();

describe("the first-boot seed", () => {
  it("runs every statement inside one transaction", () => {
    expect(report.one.transactions).toBe(1);
    // Anything on the top-level connection after the seed began is a statement
    // PGlite flushes to IndexedDB on its own.
    expect(report.one.topLevelAfterSeedStart).toBe(0);
    expect(report.one.marker).toBe("2");
    expect(report.one.orders).toBeGreaterThan(0);
  });

  it("loses one sample row, not the seed, when a row is rejected", () => {
    expect(report.two.skipped).toBe(true);
    expect(report.two.lines).toBe(report.two.goodLines);
    expect(report.two.orders).toBeGreaterThan(0);
    expect(report.two.marker).toBe("2");
  });

  it("leaves no seeded marker, and no half a dictionary, when the seed itself fails", () => {
    expect(report.three.threw).toBe(true);
    expect(report.three.marker).toBeNull();
    expect(report.three.tables).toBe(0);
  });
});
