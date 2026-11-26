/**
 * Regression: every role in the model was seeded twice.
 *
 * `00_users_and_roles` seeds the title-cased role (`Airport Manager`) and the
 * `%%rbac` seed then looked for `airport_manager` with a case-only comparison.
 * `lower('Airport Manager')` is not `airport_manager`, so it wrote a second role
 * beside each real one: ten roles seeded, nine more added, and the Role screen
 * listed eighteen. The entity-access guard folds case and treats `_`, `-` and
 * spaces alike, so the seed has to as well.
 *
 * Found by /qa on 2026-10-21 (role-by-role walkthrough, airport model).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SEED = join(
  import.meta.dirname,
  "../../../templates/common/seeds/operation-access.ts.hbs"
);
const BACKEND = join(import.meta.dirname, "../../../templates/tanstack-start-nestjs/backend/src");
/** The role key the grants are joined on, stored by the database on both sides. */
const MIGRATION = join(BACKEND, "migrations/022_record_lifecycle.ts.hbs");
/** The same fold in code, for a role a Better Auth session names directly. */
const CAPABILITIES = join(BACKEND, "modules/auth/capability.service.ts.hbs");

describe("%%rbac role seed", () => {
  const seed = readFileSync(SEED, "utf8");

  it("matches an existing role with separators folded, not by case alone", () => {
    expect(seed).not.toContain("sql`lower(name)`");
    expect(seed).toContain("regexp_replace(trim(name), '[[:space:]_-]+', ' ', 'g')");
    expect(seed).toContain(".replace(/[\\s_-]+/g, ' ')");
  });

  it("folds names the way access is decided", () => {
    // The seed, the role key the grants join on, and the code fold must agree,
    // or a role the seed thinks is new is one access already treats as existing.
    const migration = readFileSync(MIGRATION, "utf8");
    expect(migration).toContain("lower(regexp_replace(trim(name), '[[:space:]_-]+', ' ', 'g'))");
    expect(migration).toContain("lower(regexp_replace(trim(role_name), '[[:space:]_-]+', ' ', 'g'))");
    expect(readFileSync(CAPABILITIES, "utf8")).toContain(".replace(/[\\s_-]+/g, ' ')");
  });
});
