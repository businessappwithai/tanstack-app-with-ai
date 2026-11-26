/**
 * A saga bound to a status runs in a button press's second transaction, and a
 * failure undoes that transaction alone.
 *
 * `status: <state>` compiles to `operation: ENTER:<STATE>`; this holds what the
 * browser stack does with it against a real PGlite:
 *
 *   - a plain save (an UPDATE) never selects it — only a move into the state does;
 *   - a press runs the sagas bound to the move and to its state, and the record's
 *     update sagas too, unless the press has just saved the form (they ran then);
 *   - a saga that fails inside the move's transaction throws, so what an earlier
 *     saga of the same move wrote is undone while the first transaction's save
 *     stays; and the failed run is written back afterwards, with the operation,
 *     because the rollback took the run row with it.
 *
 * Runs in a child process under Bun, as `seed-transaction.test.ts` does: PGlite
 * will not load under this suite's jsdom environment.
 */

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FIXTURE = join(import.meta.dirname, "fixtures/exercise-bound-sagas.ts");

function exercise(): {
  plain: string[];
  press: string[];
  pressAfterSave: string[];
  failure: { workflow?: string; operation?: string; reason?: string } | null;
  notes: string[];
  failedRuns: Array<{ workflow: string; operation?: string }>;
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
      `The saga fixture failed.\n--- stderr ---\n${String(detail.stderr ?? "")}` +
        `\n--- stdout ---\n${String(detail.stdout ?? "")}`
    );
  }
}

const report = exercise();

describe("which sagas a write or a press selects", () => {
  it("never selects a bound saga for a plain save", () => {
    expect(report.plain).toEqual(["updateOnly"]);
  });

  it("selects the update sagas and those bound to the move and its state, for a press", () => {
    expect(report.press).toEqual(["onApproved", "onSubmit", "updateOnly"]);
  });

  it("skips the update sagas when the press has just saved the form", () => {
    expect(report.pressAfterSave).toEqual(["onApproved", "onSubmit"]);
  });
});

describe("a saga that fails inside the move's transaction", () => {
  it("names the workflow, the operation and the reason", () => {
    expect(report.failure?.workflow).toBe("breaks");
    expect(report.failure?.operation).toBe("ENTER:APPROVED");
    expect(report.failure?.reason).toContain("no_such_column");
  });

  it("undoes what the move wrote, and keeps what the first transaction saved", () => {
    expect(report.notes).toEqual(["saved first, by the press's first transaction"]);
  });

  it("is written back to Run History after the rollback", () => {
    expect(report.failedRuns).toEqual([{ workflow: "breaks", operation: "ENTER:APPROVED" }]);
  });
});
