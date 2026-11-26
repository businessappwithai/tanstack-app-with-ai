/**
 * Regression: ISSUE-003 — the record navigator's arrows were squashed to 4px.
 * Found by /qa on 2026-10-30
 * Report: .gstack/qa-reports/run-20261030T005141Z/qa-report-localhost-2026-10-30.md
 *
 * `Button` rendered `buttonVariants({ variant, size, className })`, which cva only
 * concatenates. A caller's `className="h-7 w-7 p-0"` on `size="sm"` therefore kept
 * the variant's `h-9 px-3` beside it, and the stylesheet's order decided the winner:
 * `px-3` beat `p-0`, leaving 4px of a 28px button for its icon. Every Button whose
 * className overrides a variant class had the same problem. `cn` (tailwind-merge)
 * lets the caller's class win, as shadcn's own Button does.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BUTTON = join(
  import.meta.dirname,
  "../../../templates/tanstack-start-nestjs/frontend/src/components/ui/button.tsx"
);

describe("Button template", () => {
  const source = readFileSync(BUTTON, "utf8");

  it("merges a caller's classes over the variant's", () => {
    expect(source).toMatch(/import \{ cn \} from "@\/lib\/utils";/);
    expect(source).toContain("className={cn(buttonVariants({ variant, size, className }))}");
  });
});
