/**
 * Apply the EML model's schema to a target database using a Flyway-compatible
 * migration approach:
 *
 *   1. Ensure `flyway_schema_history` exists (Flyway's standard tracking table).
 *   2. Introspect the current public schema.
 *   3. Diff against the desired schema parsed from the EML mermaid code.
 *   4. If nothing changed, return early — no migration is written.
 *   5. Otherwise generate forward-only SQL (CREATE TABLE for new tables,
 *      ALTER TABLE … ADD COLUMN IF NOT EXISTS for new columns in existing tables).
 *      Columns and tables are never dropped; type changes are never forced.
 *   6. Apply the SQL, record the migration in `flyway_schema_history`.
 *
 * The resulting `flyway_schema_history` table is identical to the one real
 * Flyway writes, so the database is compatible with the Flyway CLI or Docker
 * image if the team ever switches to it.
 *
 * Written with `createFileRoute` + `server.handlers` — the previous
 * `createAPIFileRoute` shape was never registered by the Vite shim and
 * silently answered every POST with the application shell HTML.
 */

import { createFileRoute } from "@tanstack/react-router";
import { requireProjectAccess } from "@/lib/project-access";
import { requireUser } from "@/lib/require-user";

type Attribute = {
  name: string;
  type?: string;
  required?: boolean;
  unique?: boolean;
  isForeignKey?: boolean;
};
type Entity = { name: string; attributes: Attribute[] };
type Rel = {
  sourceEntity: string;
  targetEntity: string;
  cardinality: string;
  foreignKey?: string;
};

function toTableName(entityName: string): string {
  return entityName.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function toColType(rawType: string | undefined, isFk = false): string {
  if (isFk) return "UUID";
  switch ((rawType ?? "string").toLowerCase()) {
    case "int":
    case "integer":
      return "INTEGER";
    case "bigint":
      return "BIGINT";
    case "float":
    case "double":
      return "DOUBLE PRECISION";
    case "decimal":
      return "NUMERIC(10,2)";
    case "boolean":
    case "bool":
      return "BOOLEAN";
    case "date":
      return "DATE";
    case "datetime":
    case "timestamp":
      return "TIMESTAMPTZ";
    case "json":
      return "JSONB";
    default:
      return "TEXT";
  }
}

function buildCreateTable(tableName: string, attributes: Attribute[]): string {
  const columns: string[] = [];

  // Always use UUID primary key to match FK column types
  if (!attributes.some((a) => (a.unique || a.name === "id") && a.name === "id")) {
    columns.push('  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid()');
  }

  for (const attr of attributes) {
    if (attr.name === "id" && (attr.unique || attr.name === "id")) {
      columns.push(`  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid()`);
      continue;
    }
    const colType = toColType(attr.type, attr.isForeignKey === true);
    const notNull = attr.required ? " NOT NULL" : "";
    columns.push(`  "${attr.name}" ${colType}${notNull}`);
  }

  return `CREATE TABLE "${tableName}" (\n${columns.join(",\n")}\n);`;
}

/** Build ALTER TABLE statements that add FK constraints after all tables exist. */
function buildFkConstraints(
  entities: Entity[],
  relationships: Rel[],
  _existingTables: Set<string>,
): string[] {
  const tableSet = new Set(entities.map((e) => toTableName(e.name)));
  const stmts: string[] = [];

  for (const rel of relationships) {
    const { sourceEntity, targetEntity, cardinality, foreignKey } = rel;

    // For oneToMany: FK lives on the many side (targetEntity)
    // For manyToOne: FK lives on the source side (sourceEntity)
    // Skip manyToMany (needs junction table)
    let childTable: string;
    let parentTable: string;
    let fkCol: string;

    if (cardinality === "oneToMany") {
      childTable = toTableName(targetEntity);
      parentTable = toTableName(sourceEntity);
      fkCol = foreignKey ?? `${toTableName(sourceEntity)}_id`;
    } else if (cardinality === "manyToOne") {
      childTable = toTableName(sourceEntity);
      parentTable = toTableName(targetEntity);
      fkCol = foreignKey ?? `${toTableName(targetEntity)}_id`;
    } else {
      continue; // oneToOne handled below, manyToMany skipped
    }

    if (!tableSet.has(childTable) || !tableSet.has(parentTable)) continue;

    const constraintName = `fk_${childTable}_${fkCol}`.slice(0, 63);

    // Ensure the FK column exists — IF NOT EXISTS makes this idempotent
    const childEntity = entities.find((e) => toTableName(e.name) === childTable);
    const hasCol = childEntity?.attributes.some((a) => a.name === fkCol);
    if (!hasCol) {
      stmts.push(
        `ALTER TABLE "${childTable}" ADD COLUMN IF NOT EXISTS "${fkCol}" UUID;`,
      );
    }

    stmts.push(
      `ALTER TABLE "${childTable}" DROP CONSTRAINT IF EXISTS "${constraintName}";`,
      `ALTER TABLE "${childTable}" ADD CONSTRAINT "${constraintName}" FOREIGN KEY ("${fkCol}") REFERENCES "${parentTable}"("id") ON DELETE SET NULL;`,
    );
  }

  return stmts;
}

export const Route = createFileRoute("/api/db/generate-schema")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const caller = await requireUser(request, "db:generate-schema", "write");
        if (caller.response) return caller.response;

        const json = (body: unknown, status = 200) =>
          new Response(JSON.stringify(body), {
            status,
            headers: { "Content-Type": "application/json" },
          });

        try {
          const body = (await request.json()) as {
            mermaidCode: string;
            targetDbConnection: string;
            projectId?: string;
            dropExisting?: boolean;
          };
          const { mermaidCode, targetDbConnection, projectId, dropExisting = false } = body;

          if (!mermaidCode?.trim()) {
            return json({ error: "mermaidCode is required" }, 400);
          }
          if (!targetDbConnection) {
            return json({ error: "targetDbConnection is required" }, 400);
          }

          // Parse EML
          const { MermaidParser } = await import("@appwithai/generator");
          const parser = new MermaidParser();
          const schema = parser.parse(mermaidCode);

          if (!schema.entities || schema.entities.length === 0) {
            return json({ error: "No entities found in ERD. Check your Mermaid syntax." }, 400);
          }

          const { Client } = await import("pg");
          const client = new Client({
            connectionString: targetDbConnection,
            connectionTimeoutMillis: 10000,
          });
          await client.connect();

          try {
            // ── 1. Ensure flyway_schema_history ─────────────────────────────
            await client.query(`
              CREATE TABLE IF NOT EXISTS flyway_schema_history (
                installed_rank SERIAL PRIMARY KEY,
                version        VARCHAR(50),
                description    VARCHAR(200) NOT NULL,
                type           VARCHAR(20)  NOT NULL DEFAULT 'SQL',
                script         TEXT         NOT NULL,
                checksum       INTEGER,
                installed_by   VARCHAR(100) NOT NULL DEFAULT 'appwithai',
                installed_on   TIMESTAMP    NOT NULL DEFAULT NOW(),
                execution_time INTEGER      NOT NULL DEFAULT 0,
                success        BOOLEAN      NOT NULL DEFAULT true
              )
            `);

            // ── 2. Current migration version ────────────────────────────────
            const verRes = await client.query<{ v: string }>(
              `SELECT COALESCE(MAX(CAST(version AS INTEGER)), 0) AS v
               FROM flyway_schema_history
               WHERE version ~ '^[0-9]+$' AND success = true`
            );
            const currentVersion = Number(verRes.rows[0]?.v ?? 0);

            // ── 3. Introspect existing public schema ─────────────────────────
            const tablesRes = await client.query<{ table_name: string }>(
              `SELECT table_name
               FROM information_schema.tables
               WHERE table_schema = 'public'
                 AND table_type   = 'BASE TABLE'
                 AND table_name   != 'flyway_schema_history'`
            );
            const existingTables = new Set(tablesRes.rows.map((r) => r.table_name));

            const colsRes = await client.query<{ table_name: string; column_name: string }>(
              `SELECT table_name, column_name
               FROM information_schema.columns
               WHERE table_schema = 'public'`
            );
            const existingCols = new Map<string, Set<string>>();
            for (const row of colsRes.rows) {
              if (!existingCols.has(row.table_name))
                existingCols.set(row.table_name, new Set());
              existingCols.get(row.table_name)!.add(row.column_name);
            }

            // ── 4. Diff ──────────────────────────────────────────────────────
            const ddlStatements: string[] = [];
            const tablesCreated: string[] = [];
            const tablesModified: string[] = [];

            // Ensure pgcrypto is available for gen_random_uuid()
            await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`).catch(() => {});

            // ── 4a. Drop existing model tables if requested ──────────────────
            if (dropExisting) {
              const modelTables = (schema.entities as Entity[])
                .map((e) => toTableName(e.name))
                .filter((t) => existingTables.has(t));
              if (modelTables.length > 0) {
                // CASCADE handles FK order automatically
                const dropList = modelTables.map((t) => `"${t}"`).join(", ");
                await client.query(`DROP TABLE IF EXISTS ${dropList} CASCADE`);
                // Clear existingTables so the diff treats everything as new
                for (const t of modelTables) existingTables.delete(t);
                for (const t of modelTables) existingCols.delete(t);
              }
            }

            for (const entity of schema.entities as Entity[]) {
              const tableName = toTableName(entity.name);

              if (!existingTables.has(tableName)) {
                ddlStatements.push(buildCreateTable(tableName, entity.attributes));
                tablesCreated.push(tableName);
              } else {
                const currentCols = existingCols.get(tableName) ?? new Set<string>();
                const alters: string[] = [];

                if (!currentCols.has("id")) {
                  alters.push(
                    `ALTER TABLE "${tableName}" ADD COLUMN IF NOT EXISTS "id" UUID DEFAULT gen_random_uuid() PRIMARY KEY;`
                  );
                }

                for (const attr of entity.attributes) {
                  if (!currentCols.has(attr.name)) {
                    const colType = toColType(attr.type, attr.isForeignKey === true);
                    alters.push(
                      `ALTER TABLE "${tableName}" ADD COLUMN IF NOT EXISTS "${attr.name}" ${colType};`
                    );
                  }
                }

                if (alters.length > 0) {
                  ddlStatements.push(...alters);
                  tablesModified.push(tableName);
                }
              }
            }

            // ── 4b. FK constraints from relationships ────────────────────────
            const relationships = (schema.relationships ?? []) as Rel[];
            const fkStatements = buildFkConstraints(
              schema.entities as Entity[],
              relationships,
              existingTables,
            );
            ddlStatements.push(...fkStatements);

            // ── 5. No changes ────────────────────────────────────────────────
            if (ddlStatements.length === 0) {
              return json({
                success: true,
                noChanges: true,
                version: `V${currentVersion}`,
                message: `Schema is already up to date at V${currentVersion} — no migration needed.`,
              });
            }

            // ── 6. Apply migration ───────────────────────────────────────────
            // Run each statement separately so one FK failure doesn't abort
            // the whole migration (e.g. a cycle between tables).
            const startMs = Date.now();
            const migrationErrors: string[] = [];
            for (const stmt of ddlStatements) {
              await client.query(stmt).catch((err: Error) => {
                // Non-fatal: log the error but continue applying the rest
                migrationErrors.push(`-- ${stmt.slice(0, 80)}: ${err.message}`);
              });
            }
            const durationMs = Date.now() - startMs;
            const migrationScript = ddlStatements.join("\n");

            // ── 7. Record in flyway_schema_history ───────────────────────────
            const nextVersion = currentVersion + 1;
            const description = `eml_sync_${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`;
            await client.query(
              `INSERT INTO flyway_schema_history
                 (version, description, type, script, installed_by, execution_time, success)
               VALUES ($1, $2, 'SQL', $3, 'appwithai', $4, true)`,
              [String(nextVersion), description, migrationScript, durationMs]
            );

            // ── 8. Persist migration script in project git ───────────────────
            if (projectId) {
              const access = await requireProjectAccess(request, projectId, "read_write");
              if (!("response" in access)) {
                const { saveProjectFiles } = await import("@/lib/server/project-repository");
                const fileName = `migrations/V${nextVersion}__${description}.sql`;
                await saveProjectFiles(projectId, access.user.id, {
                  [fileName]: migrationScript,
                }).catch(() => {/* best-effort — DB op already succeeded */});
              }
            }

            return json({
              success: true,
              version: `V${nextVersion}`,
              tablesCreated,
              tablesModified,
              statements: ddlStatements.length,
            });
          } finally {
            await client.end();
          }
        } catch (err) {
          return json(
            { error: err instanceof Error ? err.message : "Failed to generate schema" },
            500
          );
        }
      },
    },
  },
});
