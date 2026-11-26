/**
 * Regression: a generated project's reporting seeder died on every
 * `docker compose up` with
 *
 *   report-seeder-1  | error: Cannot find module '@/lib/auth/bcrypt-cost'
 *                    |        from '/app/src/lib/db/bootstrap.ts'
 *   report-seeder-1 exited with code 1
 *
 * `reporting/Dockerfile` builds the Enterprise Reporting platform and then
 * copies part of its source into the runtime stage, because the one-shot
 * seeder (`scripts/seed-reporting-pack.ts`) is run from source and resolves
 * its imports through `@/` — which is that project's `src/`. The list of
 * directories to copy was maintained by hand: `src/lib/{db,security,sql,mastra}`
 * and `src/types`.
 *
 * It went stale the first time the platform added an import to a file already
 * on the list. `src/lib/db/bootstrap.ts` began importing
 * `@/lib/auth/bcrypt-cost`; nothing copied `src/lib/auth`; the seeder exited 1.
 *
 * Two things make that a blanket copy rather than a sixth line:
 *
 *   - Nothing fails at build time. The image builds, the `report` service
 *     serves, and only the one-shot seeder dies — so the project comes up
 *     looking healthy with an empty reporting side, and the reader is left
 *     with a module path from a repository they did not generate.
 *   - The platform is cloned at REPORT_REF, which defaults to `main`. The
 *     list has to stay correct against a moving ref this generator does not
 *     control, so it is wrong the moment somebody else adds an import.
 *
 * This pins the decision: the runtime stage copies the whole of `src/`, and
 * no per-directory `COPY` of it comes back.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DOCKERFILE = join(
  import.meta.dirname,
  "../../../templates/tanstack-start-nestjs/reporting/Dockerfile.hbs"
);

/** `COPY --from=builder <src> <dest>`, comments and blank lines ignored. */
function builderCopies(source: string): { from: string; to: string }[] {
  return source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("COPY --from=builder "))
    .map((line) => {
      const [, , from = "", to = ""] = line.split(/\s+/);
      return { from, to };
    });
}

describe("the reporting image carries the seeder's source", () => {
  const dockerfile = readFileSync(DOCKERFILE, "utf8");
  const copies = builderCopies(dockerfile);

  it("copies the whole of src/, not a hand-listed subset", () => {
    const srcCopies = copies.filter((c) => c.from.startsWith("/app/src"));

    expect(srcCopies).toEqual([{ from: "/app/src", to: "./src" }]);
  });

  it("copies the seeder itself", () => {
    expect(copies).toContainEqual({ from: "/app/scripts", to: "./scripts" });
  });

  it("copies the tsconfig that makes `@/` resolve", () => {
    // Without it bun has no `paths` mapping and every `@/` import in the
    // seeder fails exactly the way the missing directory did.
    expect(copies).toContainEqual({
      from: "/app/tsconfig.json",
      to: "./tsconfig.json",
    });
  });
});
