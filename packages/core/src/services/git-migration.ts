import { type Kysely, sql } from "kysely";
import type { Database } from "../config/db.types";

/** Additive and repeatable: existing versions and files are never removed. */
export async function migrateProjectGit(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable("project_git_state")
    .ifNotExists()
    .addColumn("project_id", "varchar(128)", (c) => c.primaryKey().references("projects.id"))
    .addColumn("model_code", "text", (c) => c.notNull())
    .addColumn("model_commit", "varchar(64)", (c) => c.notNull())
    .addColumn("generation_commit", "varchar(64)")
    .addColumn("generation_model_commit", "varchar(64)")
    .addColumn("updated_at", "varchar(64)", (c) => c.notNull())
    .execute();
  await db.schema
    .createTable("project_git_operations")
    .ifNotExists()
    .addColumn("id", "varchar(128)", (c) => c.primaryKey())
    .addColumn("project_id", "varchar(128)", (c) => c.notNull().references("projects.id"))
    .addColumn("request_id", "varchar(128)", (c) => c.notNull())
    .addColumn("fingerprint", "varchar(64)", (c) => c.notNull())
    .addColumn("kind", "varchar(32)", (c) => c.notNull())
    .addColumn("status", "varchar(32)", (c) => c.notNull())
    .addColumn("payload", "text", (c) => c.notNull())
    .addColumn("result", "text")
    .addColumn("created_at", "varchar(64)", (c) => c.notNull())
    .addUniqueConstraint("project_git_request", ["project_id", "request_id"])
    .execute();
  await sql`ALTER TABLE erd_versions ADD COLUMN IF NOT EXISTS git_commit VARCHAR(64)`.execute(db);
  // Older databases may already contain duplicate numbers. Do not renumber history.
  const duplicates =
    await sql`SELECT 1 FROM erd_versions GROUP BY project_id, version_number HAVING count(*) > 1 LIMIT 1`.execute(
      db
    );
  if (!duplicates.rows.length) {
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS erd_project_version_unique ON erd_versions(project_id, version_number)`.execute(
      db
    );
  }
}
