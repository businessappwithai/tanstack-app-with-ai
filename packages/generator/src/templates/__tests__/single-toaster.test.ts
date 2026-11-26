/**
 * Regression: ISSUE-006 — React warned "Cannot update a component while rendering a
 * different component" about four seconds after any refused save.
 * Found by /qa on 2026-10-30
 * Report: .gstack/qa-reports/run-20261030T005141Z/qa-report-localhost-2026-10-30.md
 *
 * Two sonner Toasters were mounted: one in `routes/__root.tsx` and `ClientToaster` in
 * `providers/index.tsx`. When a toast closes, sonner calls `toast.dismiss()` inside a
 * state updater, and dismiss notifies every Toaster, so one Toaster's render updated
 * the other. Every toast was also drawn twice in the same corner and announced twice.
 * `ClientToaster` is the one kept: it sits inside the providers and waits for
 * hydration.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "../../../templates/tanstack-start-nestjs/frontend/src");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "editors" ? [] : sources(path);
    return /\.tsx?(\.hbs)?$/.test(name) ? [path] : [];
  });
}

describe("toast surface", () => {
  it("mounts exactly one sonner Toaster", () => {
    const mounts = sources(SRC).flatMap((file) =>
      (readFileSync(file, "utf8").match(/<Toaster\b/g) ?? []).map(() => file.slice(SRC.length))
    );
    expect(mounts).toEqual(["/providers/index.tsx"]);
  });
});
