/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Database service for APPWITHAI — PostgreSQL via Kysely + pg
 *
 * Connection config lives in ONE place: packages/core/src/config/db.config.ts
 * Change driver / connection string there only.
 */

import { type Kysely, sql } from "kysely";
import { type Database, destroyDb, getDb } from "../config/db.config.js";
import { getLogger } from "../logging/index.js";
import { migrateProjectGit } from "./git-migration";

// Re-export types consumed by other packages
export type { Database };
export { sql };

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function insertAndReturn<T>(
  db: Kysely<Database>,
  table: keyof Database,
  values: Record<string, any>
): Promise<T> {
  await db.insertInto(table).values(values).execute();
  return db
    .selectFrom(table)
    .selectAll()
    .where("id", "=", values.id)
    .executeTakeFirstOrThrow() as Promise<T>;
}

async function updateAndReturn<T>(
  db: Kysely<Database>,
  table: keyof Database,
  id: string,
  values: Record<string, any>
): Promise<T> {
  await db.updateTable(table).set(values).where("id", "=", id).execute();
  return db
    .selectFrom(table)
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirstOrThrow() as Promise<T>;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Returns the shared Kysely instance. Throws if pool cannot connect. */
export function getDatabase(): Kysely<Database> {
  return getDb();
}

export async function closeDatabase(): Promise<void> {
  await destroyDb();
}

// ─── Schema migrations ────────────────────────────────────────────────────────

export async function runMigrations(): Promise<void> {
  const db = getDb();
  await _runMigrationsImpl(db);
}

/** One swallowed migration step, kept until the whole run can be reported. */
interface MigrationFailure {
  step: string;
  err: unknown;
}

/**
 * Record a migration step that did not apply.
 *
 * Every one of these was a bare `catch {}` commented "already exists". Once the
 * failures were actually reported, five of them turned out to be exactly that:
 * `alterTable().addColumn()` emits no `IF NOT EXISTS`, so those steps threw on
 * every restart of a database that already had the column. They now ask for
 * `ifNotExists()` like every other step, which is what the comment had always
 * claimed was true.
 *
 * So anything reaching this handler now is something else: a permission the role
 * does not have, a type that does not exist, a connection that went away
 * mid-run. All of it used to apply silently, and the first sign was a query
 * failing against a column that was never added.
 *
 * Collected rather than thrown, because the run should still attempt the
 * remaining steps: a database missing one column is more recoverable than one
 * missing every table after the first failure.
 */
function noteMigrationFailure(failures: MigrationFailure[], step: string, err: unknown): void {
  failures.push({ step, err });
}

async function _runMigrationsImpl(db: Kysely<Database>): Promise<void> {
  const log = getLogger("db");
  const startedAt = Date.now();
  const failures: MigrationFailure[] = [];

  try {
    await db.schema
      .createTable("projects")
      .ifNotExists()
      .addColumn("id", "varchar(128)", (col) => col.primaryKey())
      .addColumn("name", "varchar(255)", (col) => col.notNull())
      .addColumn("description", "text")
      .addColumn("icon", "varchar(64)", (col) => col.defaultTo("📊"))
      .addColumn("icon_color", "varchar(32)", (col) => col.defaultTo("#3b82f6"))
      .addColumn("status", "varchar(32)", (col) => col.defaultTo("draft"))
      .addColumn("is_deleted", "boolean", (col) => col.defaultTo(false))
      .addColumn("stack_type", "varchar(64)", (col) => col.defaultTo("tanstackjs-nestjs"))
      .addColumn("stack_version", "varchar(64)", (col) => col.defaultTo("latest"))
      .addColumn("port", "integer", (col) => col.defaultTo(4001))
      .addColumn("base_url", "varchar(512)")
      .addColumn("database_url", "text")
      .addColumn("database_type", "varchar(32)", (col) => col.defaultTo("postgresql"))
      .addColumn("database_schema", "text")
      .addColumn("environment_variables", "text")
      .addColumn("secrets", "text")
      .addColumn("generated_path", "text")
      .addColumn("output_directory", "text")
      .addColumn("build_config", "text")
      .addColumn("is_typescript", "boolean", (col) => col.defaultTo(true))
      .addColumn("is_tailwind", "boolean", (col) => col.defaultTo(true))
      .addColumn("deployment_status", "varchar(32)")
      .addColumn("deployment_url", "text")
      .addColumn("uptime", "varchar(64)")
      .addColumn("created_at", "varchar(64)", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn("updated_at", "varchar(64)", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();
  } catch (err) {
    noteMigrationFailure(failures, "create table projects", err);
  }

  try {
    await db.schema
      .createTable("erd_versions")
      .ifNotExists()
      .addColumn("id", "varchar(128)", (col) => col.primaryKey())
      .addColumn("project_id", "varchar(128)", (col) => col.notNull())
      .addColumn("version_number", "integer", (col) => col.notNull())
      .addColumn("mermaid_code", "text", (col) => col.notNull())
      .addColumn("description", "text")
      .addColumn("is_current", "boolean", (col) => col.defaultTo(false))
      .addColumn("validation_errors", "text")
      .addColumn("parsed_schema", "text")
      .addColumn("entity_count", "integer", (col) => col.defaultTo(0))
      .addColumn("relationship_count", "integer", (col) => col.defaultTo(0))
      .addColumn("ai_suggestions", "text")
      .addColumn("ai_enhanced", "boolean", (col) => col.defaultTo(false))
      .addColumn("import_source", "varchar(128)")
      .addColumn("import_metadata", "text")
      .addColumn("created_by", "varchar(128)")
      .addColumn("commit_message", "text")
      .addColumn("change_summary", "text")
      .addColumn("created_at", "varchar(64)", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();
  } catch (err) {
    noteMigrationFailure(failures, "create table erd_versions", err);
  }

  try {
    await db.schema
      .createTable("workflows")
      .ifNotExists()
      .addColumn("id", "varchar(128)", (col) => col.primaryKey())
      .addColumn("project_id", "varchar(128)", (col) => col.notNull())
      .addColumn("name", "varchar(255)", (col) => col.notNull())
      .addColumn("service_name", "varchar(128)", (col) => col.notNull())
      .addColumn("workflow_type", "varchar(64)", (col) => col.defaultTo("crud"))
      .addColumn("mermaid_code", "text")
      .addColumn("description", "text")
      .addColumn("extension_points", "text")
      .addColumn("config", "text")
      .addColumn("triggers", "text")
      .addColumn("conditions", "text")
      .addColumn("generated_code", "text")
      .addColumn("code_language", "varchar(32)", (col) => col.defaultTo("typescript"))
      .addColumn("status", "varchar(32)", (col) => col.defaultTo("draft"))
      .addColumn("is_enabled", "boolean", (col) => col.defaultTo(true))
      .addColumn("created_at", "varchar(64)", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn("updated_at", "varchar(64)", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn("last_executed_at", "varchar(64)")
      .addColumn("hook_definitions", "text")
      .addColumn("flowchart_code", "text")
      .addColumn("generated_hook_code", "text")
      .addColumn("is_draft", "boolean", (col) => col.defaultTo(false))
      .execute();
  } catch (err) {
    noteMigrationFailure(failures, "create table workflows", err);
  }

  try {
    await db.schema
      .createTable("generation_history")
      .ifNotExists()
      .addColumn("id", "varchar(128)", (col) => col.primaryKey())
      .addColumn("project_id", "varchar(128)", (col) => col.notNull())
      .addColumn("stack_type", "varchar(64)", (col) => col.notNull())
      .addColumn("stack_version", "varchar(64)")
      .addColumn("generation_options", "text")
      .addColumn("status", "varchar(32)", (col) => col.notNull())
      .addColumn("progress", "integer", (col) => col.defaultTo(0))
      .addColumn("current_step", "varchar(255)")
      .addColumn("generated_path", "text")
      .addColumn("output_structure", "text")
      .addColumn("port", "integer")
      .addColumn("file_manifest", "text")
      .addColumn("entry_points", "text")
      .addColumn("build_command", "varchar(512)")
      .addColumn("start_command", "varchar(512)")
      .addColumn("install_command", "varchar(512)")
      .addColumn("dependencies", "text")
      .addColumn("dev_dependencies", "text")
      .addColumn("environment_config", "text")
      .addColumn("docker_config", "text")
      .addColumn("logs", "text")
      .addColumn("error_message", "text")
      .addColumn("warnings", "text")
      .addColumn("files_generated", "integer", (col) => col.defaultTo(0))
      .addColumn("total_size_bytes", "integer", (col) => col.defaultTo(0))
      .addColumn("started_at", "varchar(64)", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn("completed_at", "varchar(64)")
      .addColumn("duration_ms", "integer")
      .execute();
  } catch (err) {
    noteMigrationFailure(failures, "create table generation_history", err);
  }

  try {
    await db.schema
      .createTable("deployments")
      .ifNotExists()
      .addColumn("id", "varchar(128)", (col) => col.primaryKey())
      .addColumn("project_id", "varchar(128)", (col) => col.notNull())
      .addColumn("status", "varchar(32)", (col) => col.notNull())
      .addColumn("environment", "varchar(32)", (col) => col.defaultTo("development"))
      .addColumn("deployment_url", "text")
      .addColumn("port", "integer", (col) => col.defaultTo(4001))
      .addColumn("host", "varchar(255)", (col) => col.defaultTo("localhost"))
      .addColumn("process_id", "varchar(64)")
      .addColumn("process_command", "text")
      .addColumn("uptime", "varchar(64)")
      .addColumn("uptime_seconds", "integer")
      .addColumn("last_health_check", "varchar(64)")
      .addColumn("health_status", "text")
      .addColumn("resource_usage", "text")
      .addColumn("deployment_config", "text")
      .addColumn("auto_restart", "boolean", (col) => col.defaultTo(false))
      .addColumn("restart_count", "integer", (col) => col.defaultTo(0))
      .addColumn("stdout_log", "text")
      .addColumn("stderr_log", "text")
      .addColumn("started_at", "varchar(64)")
      .addColumn("stopped_at", "varchar(64)")
      .addColumn("created_at", "varchar(64)", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn("updated_at", "varchar(64)", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();
  } catch (err) {
    noteMigrationFailure(failures, "create table deployments", err);
  }

  try {
    await db.schema
      .createTable("entities")
      .ifNotExists()
      .addColumn("id", "varchar(128)", (col) => col.primaryKey())
      .addColumn("project_id", "varchar(128)", (col) => col.notNull())
      .addColumn("erd_version_id", "varchar(128)")
      .addColumn("name", "varchar(255)", (col) => col.notNull())
      .addColumn("display_name", "varchar(255)")
      .addColumn("type", "varchar(64)", (col) => col.defaultTo("entity"))
      .addColumn("description", "text")
      .addColumn("schema", "text")
      .addColumn("fields", "text")
      .addColumn("relationships", "text")
      .addColumn("generate_api", "boolean", (col) => col.defaultTo(true))
      .addColumn("generate_ui", "boolean", (col) => col.defaultTo(true))
      .addColumn("generate_crud", "boolean", (col) => col.defaultTo(true))
      .addColumn("created_at", "varchar(64)", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn("updated_at", "varchar(64)", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();
  } catch (err) {
    noteMigrationFailure(failures, "create table entities", err);
  }

  try {
    await db.schema
      .createTable("settings")
      .ifNotExists()
      .addColumn("key", "varchar(255)", (col) => col.primaryKey())
      .addColumn("value", "text")
      .addColumn("type", "varchar(32)", (col) => col.defaultTo("string"))
      .addColumn("description", "text")
      .addColumn("updated_at", "varchar(64)", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();
  } catch (err) {
    noteMigrationFailure(failures, "create table settings", err);
  }

  try {
    await db.schema
      .createTable("rules")
      .ifNotExists()
      .addColumn("id", "varchar(128)", (col) => col.primaryKey())
      .addColumn("entity_name", "varchar(255)", (col) => col.notNull())
      .addColumn("rule_name", "varchar(255)", (col) => col.notNull())
      .addColumn("operation", "varchar(64)", (col) => col.notNull())
      .addColumn("jdm_content", "text", (col) => col.notNull())
      .addColumn("created_at", "varchar(64)", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn("updated_at", "varchar(64)", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();
  } catch (err) {
    noteMigrationFailure(failures, "create table rules", err);
  }

  // Auth tables
  try {
    await db.schema
      .createTable("auth_users")
      .ifNotExists()
      .addColumn("id", "varchar(128)", (col) => col.primaryKey())
      .addColumn("email", "varchar(255)", (col) => col.notNull())
      .addColumn("name", "varchar(255)")
      .addColumn("image", "text")
      .addColumn("emailVerified", "boolean", (col) => col.defaultTo(false))
      .addColumn("createdAt", "varchar(64)", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn("updatedAt", "varchar(64)", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();
  } catch (err) {
    noteMigrationFailure(failures, "create table auth_users", err);
  }

  try {
    await db.schema
      .createTable("auth_sessions")
      .ifNotExists()
      .addColumn("id", "varchar(128)", (col) => col.primaryKey())
      .addColumn("userId", "varchar(128)", (col) => col.notNull())
      .addColumn("token", "varchar(512)", (col) => col.notNull())
      .addColumn("expiresAt", "varchar(64)", (col) => col.notNull())
      .addColumn("createdAt", "varchar(64)", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn("updatedAt", "varchar(64)", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();
  } catch (err) {
    noteMigrationFailure(failures, "create table auth_sessions", err);
  }

  try {
    await db.schema
      .createTable("auth_accounts")
      .ifNotExists()
      .addColumn("id", "varchar(128)", (col) => col.primaryKey())
      .addColumn("userId", "varchar(128)", (col) => col.notNull())
      .addColumn("provider", "varchar(64)", (col) => col.notNull())
      .addColumn("providerAccountId", "varchar(255)", (col) => col.notNull())
      .addColumn("refreshToken", "text")
      .addColumn("accessToken", "text")
      .addColumn("expiresAt", "bigint")
      .addColumn("createdAt", "varchar(64)", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();
  } catch (err) {
    noteMigrationFailure(failures, "create table auth_accounts", err);
  }

  try {
    await db.schema
      .createTable("auth_verification_tokens")
      .ifNotExists()
      .addColumn("token", "varchar(512)", (col) => col.primaryKey())
      .addColumn("email", "varchar(255)", (col) => col.notNull())
      .addColumn("expires", "varchar(64)", (col) => col.notNull())
      .addColumn("createdAt", "varchar(64)", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();
  } catch (err) {
    noteMigrationFailure(failures, "create table auth_verification_tokens", err);
  }

  try {
    await db.schema
      .alterTable("auth_users")
      .addColumn("status", "varchar(32)", (col) => col.defaultTo("approved").ifNotExists())
      .execute();
  } catch (err) {
    noteMigrationFailure(failures, "add column auth_users.status", err);
  }

  try {
    await db.schema
      .alterTable("auth_users")
      .addColumn("role", "varchar(64)", (col) => col.defaultTo("user").ifNotExists())
      .execute();
  } catch (err) {
    noteMigrationFailure(failures, "add column auth_users.role", err);
  }

  try {
    await db.schema
      .alterTable("auth_users")
      .addColumn("passwordHash", "text", (col) => col.ifNotExists())
      .execute();
  } catch (err) {
    noteMigrationFailure(failures, "add column auth_users.passwordHash", err);
  }

  try {
    await db.schema
      .alterTable("projects")
      .addColumn("owner_user_id", "varchar(128)", (col) => col.ifNotExists())
      .execute();
  } catch (err) {
    noteMigrationFailure(failures, "add column projects.owner_user_id", err);
  }

  try {
    await db.schema
      .createTable("project_members")
      .ifNotExists()
      .addColumn("id", "varchar(128)", (col) => col.primaryKey())
      .addColumn("project_id", "varchar(128)", (col) => col.notNull())
      .addColumn("user_id", "varchar(128)", (col) => col.notNull())
      .addColumn("permission", "varchar(32)", (col) => col.notNull().defaultTo("read_only"))
      .addColumn("created_at", "varchar(64)", (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();
  } catch (err) {
    noteMigrationFailure(failures, "create table project_members", err);
  }

  try {
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS target_db_connection TEXT`.execute(db);
  } catch (err) {
    noteMigrationFailure(failures, "add column projects.target_db_connection", err);
  }

  await migrateProjectGit(db);

  for (const failure of failures) {
    log.event("db.migration.failed", { name: failure.step, err: failure.err });
  }

  log.event("db.migration.applied", {
    name: "schema",
    durationMs: Date.now() - startedAt,
    failed: failures.length,
  });
}

// ─── Transform helpers ─────────────────────────────────────────────────────────

function transformProject(dbProject: any): any {
  if (!dbProject) return null;
  return {
    id: dbProject.id,
    name: dbProject.name,
    description: dbProject.description,
    icon: dbProject.icon,
    iconColor: dbProject.icon_color,
    createdAt: dbProject.created_at,
    updatedAt: dbProject.updated_at,
    status: dbProject.status,
    isDeleted: Boolean(dbProject.is_deleted),
    stackType: dbProject.stack_type,
    port: dbProject.port,
    databaseUrl: dbProject.database_url,
    generatedPath: dbProject.generated_path,
    deploymentStatus: dbProject.deployment_status,
    deploymentUrl: dbProject.deployment_url,
    uptime: dbProject.uptime,
  };
}

// ─── projectDb ────────────────────────────────────────────────────────────────

export const projectDb = {
  async findAll(options?: { status?: string; includeDeleted?: boolean }) {
    try {
      const db = getDb();
      let query = db.selectFrom("projects").selectAll();
      if (!options?.includeDeleted) query = query.where("is_deleted", "=", false);
      if (options?.status) query = query.where("status", "=", options.status);
      const rows = await query.orderBy("updated_at", "desc").execute();
      return (rows as any[]).map(transformProject);
    } catch (err) {
      getLogger("db").event("db.query.failed", {
        operation: "list",
        table: "projects",
        err,
      });
      return [];
    }
  },

  async search(searchTerm: string) {
    try {
      const db = getDb();
      const term = `%${searchTerm.toLowerCase()}%`;
      const rows = await db
        .selectFrom("projects")
        .selectAll()
        .where("is_deleted", "=", false)
        .where((eb) => eb(sql`lower(name)`, "like", term).or(sql`lower(description)`, "like", term))
        .orderBy("updated_at", "desc")
        .execute();
      return (rows as any[]).map(transformProject);
    } catch (err) {
      getLogger("db").event("db.query.failed", {
        operation: "search",
        table: "projects",
        err,
      });
      return [];
    }
  },

  async findById(id: string) {
    const db = getDb();
    const dbProject = await db
      .selectFrom("projects")
      .selectAll()
      .where("id", "=", id)
      .where("is_deleted", "=", false)
      .executeTakeFirst();
    if (!dbProject) return null;

    const project = transformProject(dbProject);
    const [currentErdVersion, erdVersions, workflows, entities, latestGeneration, deployment] =
      await Promise.all([
        erdVersionDb.getCurrentErdVersion(id),
        erdVersionDb.getVersions(id),
        workflowDb.getWorkflows(id),
        entityDb.getByProject(id),
        generationHistoryDb.getLatest(id),
        deploymentDb.getDeployment(id),
      ]);

    const gitState = await db
      .selectFrom("project_git_state")
      .selectAll()
      .where("project_id", "=", id)
      .executeTakeFirst();
    return {
      ...project,
      gitCommit: gitState?.model_commit ?? null,
      erdCode: gitState?.model_code ?? currentErdVersion?.mermaid_code,
      erdVersions,
      parsedSchema: currentErdVersion?.parsed_schema
        ? JSON.parse(currentErdVersion.parsed_schema)
        : undefined,
      workflows,
      entities,
      // The generation-history row is the better source when it exists — it
      // describes one specific run — but the generate step records the path on
      // the project and does not always write history. Preferring history
      // unconditionally reported "not generated yet" for a project whose files
      // were sitting on disk, which is what the deploy step refused to build.
      generatedPath: latestGeneration?.generated_path ?? dbProject.generated_path,
      fileManifest: latestGeneration?.file_manifest
        ? JSON.parse(latestGeneration.file_manifest)
        : undefined,
      generationStatus: latestGeneration?.status,
      generationOptions: latestGeneration?.generation_options
        ? JSON.parse(latestGeneration.generation_options)
        : undefined,
      deploymentStatus: deployment?.status,
      deploymentUrl: deployment?.deployment_url,
      uptime: deployment?.uptime,
      deploymentEnvironment: deployment?.environment,
      environmentVariables: dbProject.environment_variables
        ? JSON.parse(dbProject.environment_variables)
        : {},
      buildConfig: dbProject.build_config ? JSON.parse(dbProject.build_config) : {},
    };
  },

  async create(data: {
    id: string;
    name: string;
    description?: string;
    icon?: string;
    icon_color?: string;
    stack_type?: string;
    stack_version?: string;
    port?: number;
    base_url?: string;
    database_url?: string;
    database_type?: string;
    environment_variables?: Record<string, any>;
    secrets?: Record<string, any>;
    generated_path?: string;
    output_directory?: string;
    build_config?: Record<string, any>;
    is_typescript?: boolean;
    is_tailwind?: boolean;
  }) {
    const db = getDb();
    const values = {
      id: data.id,
      name: data.name,
      description: data.description || null,
      icon: data.icon || "📊",
      icon_color: data.icon_color || "#3b82f6",
      stack_type: data.stack_type || "tanstackjs-nestjs",
      stack_version: data.stack_version || "latest",
      port: data.port || 4001,
      base_url: data.base_url || `http://localhost:${data.port || 4001}`,
      database_url: data.database_url || null,
      database_type: data.database_type || "mariadb",
      environment_variables: JSON.stringify(data.environment_variables || {}),
      secrets: JSON.stringify(data.secrets || {}),
      generated_path: data.generated_path || null,
      output_directory: data.output_directory || null,
      build_config: JSON.stringify(data.build_config || {}),
      is_typescript: data.is_typescript !== false,
      is_tailwind: data.is_tailwind !== false,
      is_deleted: false,
      status: "draft",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    return insertAndReturn(db, "projects", values);
  },

  async update(
    id: string,
    data: {
      name?: string;
      description?: string;
      icon?: string;
      icon_color?: string;
      status?: string;
      stack_type?: string;
      stack_version?: string;
      port?: number;
      base_url?: string;
      database_url?: string;
      database_type?: string;
      database_schema?: string;
      environment_variables?: Record<string, any>;
      secrets?: Record<string, any>;
      generated_path?: string;
      generatedPath?: string;
      output_directory?: string;
      build_config?: Record<string, any>;
      deployment_url?: string;
      deploymentStatus?: string;
      uptime?: string;
    }
  ) {
    const db = getDb();
    const u: any = { updated_at: new Date().toISOString() };
    if (data.name !== undefined) u.name = data.name;
    if (data.description !== undefined) u.description = data.description;
    if (data.icon !== undefined) u.icon = data.icon;
    if (data.icon_color !== undefined) u.icon_color = data.icon_color;
    if (data.status !== undefined) u.status = data.status;
    if (data.stack_type !== undefined) u.stack_type = data.stack_type;
    if (data.stack_version !== undefined) u.stack_version = data.stack_version;
    if (data.port !== undefined) u.port = data.port;
    if (data.base_url !== undefined) u.base_url = data.base_url;
    if (data.database_url !== undefined) u.database_url = data.database_url;
    if (data.database_type !== undefined) u.database_type = data.database_type;
    if (data.database_schema !== undefined) u.database_schema = data.database_schema;
    if (data.environment_variables !== undefined)
      u.environment_variables = JSON.stringify(data.environment_variables);
    if (data.secrets !== undefined) u.secrets = JSON.stringify(data.secrets);
    if (data.generated_path !== undefined) u.generated_path = data.generated_path;
    if (data.generatedPath !== undefined) u.generated_path = data.generatedPath;
    if (data.output_directory !== undefined) u.output_directory = data.output_directory;
    if (data.build_config !== undefined) u.build_config = JSON.stringify(data.build_config);
    if (data.deployment_url !== undefined) u.deployment_url = data.deployment_url;
    if (data.uptime !== undefined) u.uptime = data.uptime;
    if (data.deploymentStatus !== undefined) u.deployment_status = data.deploymentStatus;
    return updateAndReturn(db, "projects", id, u);
  },

  async softDelete(id: string) {
    await getDb().updateTable("projects").set({ is_deleted: true }).where("id", "=", id).execute();
  },

  async delete(id: string) {
    await getDb().deleteFrom("projects").where("id", "=", id).execute();
  },
};

// ─── erdVersionDb ─────────────────────────────────────────────────────────────

export const erdVersionDb = {
  async getVersions(projectId: string) {
    return getDb()
      .selectFrom("erd_versions")
      .selectAll()
      .where("project_id", "=", projectId)
      .orderBy("version_number", "desc")
      .execute();
  },

  async getCurrentErdVersion(projectId: string) {
    return getDb()
      .selectFrom("erd_versions")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("is_current", "=", true)
      .executeTakeFirst();
  },

  async createVersion(data: {
    project_id: string;
    mermaid_code: string;
    description?: string;
    is_current?: boolean;
    created_by?: string;
    validation_errors?: any[];
    parsed_schema?: any;
    entity_count?: number;
    relationship_count?: number;
    ai_suggestions?: any;
    ai_enhanced?: boolean;
    import_source?: string;
    import_metadata?: any;
    commit_message?: string;
    change_summary?: any;
  }) {
    const db = getDb();
    const last = await db
      .selectFrom("erd_versions")
      .select("version_number")
      .where("project_id", "=", data.project_id)
      .orderBy("version_number", "desc")
      .executeTakeFirst();
    const versionNumber = (last?.version_number || 0) + 1;

    if (data.is_current) {
      await db
        .updateTable("erd_versions")
        .set({ is_current: false })
        .where("project_id", "=", data.project_id)
        .execute();
    }

    const id = `erd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    return insertAndReturn(db, "erd_versions", {
      id,
      project_id: data.project_id,
      version_number: versionNumber,
      mermaid_code: data.mermaid_code,
      description: data.description || null,
      is_current: data.is_current ?? true,
      created_by: data.created_by || null,
      validation_errors: JSON.stringify(data.validation_errors || []),
      parsed_schema: JSON.stringify(data.parsed_schema || {}),
      entity_count: data.entity_count || 0,
      relationship_count: data.relationship_count || 0,
      ai_suggestions: JSON.stringify(data.ai_suggestions || {}),
      ai_enhanced: data.ai_enhanced || false,
      import_source: data.import_source || null,
      import_metadata: JSON.stringify(data.import_metadata || {}),
      commit_message: data.commit_message || null,
      change_summary: JSON.stringify(data.change_summary || {}),
      created_at: new Date().toISOString(),
    });
  },

  /**
   * Make one version the project's current one.
   *
   * `projectId` is required, and the lookup is scoped to it, because a version
   * id is enough to reach a version but not enough to say whose it is. Resolved
   * by id alone, this walked out of the project the caller named and rewrote
   * the history of whichever project the version happened to belong to — a
   * caller with write access to one project could roll back another. Returns
   * null when the version is not that project's, which the route reports as a
   * 404 like any other id it cannot use.
   */
  async setCurrentVersion(versionId: string, projectId: string) {
    const db = getDb();
    const version = await db
      .selectFrom("erd_versions")
      .selectAll()
      .where("id", "=", versionId)
      .where("project_id", "=", projectId)
      .executeTakeFirst();
    if (!version) return null;
    await db
      .updateTable("erd_versions")
      .set({ is_current: false })
      .where("project_id", "=", version.project_id)
      .execute();
    await db
      .updateTable("erd_versions")
      .set({ is_current: true })
      .where("id", "=", versionId)
      .execute();
    return db.selectFrom("erd_versions").selectAll().where("id", "=", versionId).executeTakeFirst();
  },

  /**
   * Remove one version from a project's history.
   *
   * Scoped to the project for the same reason as `setCurrentVersion`, and it
   * matters more here: a restore of the wrong project's version can be undone
   * by restoring the right one, and a delete cannot be undone at all. Reports
   * whether anything was removed so the route can answer 404 rather than
   * confirming a deletion that did not happen.
   */
  async delete(versionId: string, projectId: string): Promise<boolean> {
    const result = await getDb()
      .deleteFrom("erd_versions")
      .where("id", "=", versionId)
      .where("project_id", "=", projectId)
      .executeTakeFirst();
    return Number(result?.numDeletedRows ?? 0) > 0;
  },
};

// ─── workflowDb ───────────────────────────────────────────────────────────────

export const workflowDb = {
  async getWorkflows(projectId: string) {
    return getDb()
      .selectFrom("workflows")
      .selectAll()
      .where("project_id", "=", projectId)
      .orderBy("created_at", "desc")
      .execute();
  },

  async findById(id: string) {
    return getDb().selectFrom("workflows").selectAll().where("id", "=", id).executeTakeFirst();
  },

  async create(data: {
    project_id: string;
    name: string;
    service_name: string;
    workflow_type?: string;
    mermaid_code: string;
    description?: string;
    extension_points?: any;
    config?: any;
    triggers?: any;
    conditions?: any;
    generated_code?: string;
    code_language?: string;
  }) {
    const id = `wf_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    return insertAndReturn(getDb(), "workflows", {
      id,
      project_id: data.project_id,
      name: data.name,
      service_name: data.service_name,
      workflow_type: data.workflow_type || "crud",
      mermaid_code: data.mermaid_code,
      description: data.description || null,
      extension_points: JSON.stringify(data.extension_points || {}),
      config: JSON.stringify(data.config || {}),
      triggers: JSON.stringify(data.triggers || []),
      conditions: JSON.stringify(data.conditions || []),
      generated_code: data.generated_code || null,
      code_language: data.code_language || "typescript",
      status: "draft",
      is_enabled: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  },

  async update(
    id: string,
    data: {
      name?: string;
      service_name?: string;
      mermaid_code?: string;
      description?: string;
      status?: string;
      extension_points?: any;
      config?: any;
      triggers?: any;
      conditions?: any;
      generated_code?: string;
    }
  ) {
    const u: any = { updated_at: new Date().toISOString() };
    if (data.name !== undefined) u.name = data.name;
    if (data.service_name !== undefined) u.service_name = data.service_name;
    if (data.mermaid_code !== undefined) u.mermaid_code = data.mermaid_code;
    if (data.description !== undefined) u.description = data.description;
    if (data.status !== undefined) u.status = data.status;
    if (data.extension_points !== undefined)
      u.extension_points = JSON.stringify(data.extension_points);
    if (data.config !== undefined) u.config = JSON.stringify(data.config);
    if (data.triggers !== undefined) u.triggers = JSON.stringify(data.triggers);
    if (data.conditions !== undefined) u.conditions = JSON.stringify(data.conditions);
    if (data.generated_code !== undefined) u.generated_code = data.generated_code;
    return updateAndReturn(getDb(), "workflows", id, u);
  },

  async delete(id: string) {
    await getDb().deleteFrom("workflows").where("id", "=", id).execute();
  },
};

// ─── hookWorkflowDb ───────────────────────────────────────────────────────────

export const hookWorkflowDb = {
  async getByService(projectId: string, serviceName: string) {
    const workflow = await getDb()
      .selectFrom("workflows")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("service_name", "=", serviceName)
      .where("workflow_type", "=", "hooks")
      .executeTakeFirst();
    if (!workflow) return null;
    return {
      ...workflow,
      hook_definitions: workflow.hook_definitions ? JSON.parse(workflow.hook_definitions) : [],
      is_draft: Boolean(workflow.is_draft),
    };
  },

  async getAllHookWorkflows(projectId: string) {
    const rows = await getDb()
      .selectFrom("workflows")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("workflow_type", "=", "hooks")
      .orderBy("updated_at", "desc")
      .execute();
    return (rows as any[]).map((w) => ({
      ...w,
      hook_definitions: w.hook_definitions ? JSON.parse(w.hook_definitions) : [],
      is_draft: Boolean(w.is_draft),
    }));
  },

  async upsert(data: {
    projectId: string;
    serviceName: string;
    hooks: any[];
    flowchartCode: string;
    generatedHookCode?: string;
    isDraft: boolean;
    description?: string;
  }) {
    const db = getDb();
    const existing = await this.getByService(data.projectId, data.serviceName);
    const workflowData: any = {
      project_id: data.projectId,
      name: `${data.serviceName} Hooks`,
      service_name: data.serviceName,
      workflow_type: "hooks",
      hook_definitions: JSON.stringify(data.hooks),
      flowchart_code: data.flowchartCode,
      generated_hook_code: data.generatedHookCode || null,
      is_draft: data.isDraft,
      description: data.description || null,
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      const row = await updateAndReturn<any>(db, "workflows", existing.id, workflowData);
      return { ...row, hook_definitions: data.hooks, is_draft: data.isDraft };
    } else {
      const id = `wf_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const row = await insertAndReturn<any>(db, "workflows", {
        id,
        ...workflowData,
        status: data.isDraft ? "draft" : "active",
        is_enabled: true,
        created_at: new Date().toISOString(),
        mermaid_code: data.flowchartCode || "",
      });
      return { ...row, hook_definitions: data.hooks, is_draft: data.isDraft };
    }
  },

  async saveDraft(data: {
    projectId: string;
    serviceName: string;
    hooks: any[];
    flowchartCode: string;
  }) {
    return this.upsert({ ...data, isDraft: true });
  },

  async apply(data: {
    projectId: string;
    serviceName: string;
    hooks: any[];
    flowchartCode: string;
    generatedHookCode?: string;
    description?: string;
  }) {
    return this.upsert({ ...data, isDraft: false });
  },

  async deleteByService(projectId: string, serviceName: string) {
    await getDb()
      .deleteFrom("workflows")
      .where("project_id", "=", projectId)
      .where("service_name", "=", serviceName)
      .where("workflow_type", "=", "hooks")
      .execute();
  },

  async saveGoRules(data: {
    projectId: string;
    serviceName: string;
    workflowId: string;
    hookType: string;
    rules: string;
  }) {
    const db = getDb();
    const workflow = await this.getByService(data.projectId, data.serviceName);
    if (!workflow) throw new Error(`Workflow not found for service ${data.serviceName}`);
    const defs = workflow.hook_definitions || [];
    const idx = defs.findIndex((h: any) => h.type === data.hookType);
    if (idx === -1) throw new Error(`Hook of type ${data.hookType} not found`);
    defs[idx].goRules = data.rules;
    const row = await updateAndReturn<any>(db, "workflows", workflow.id, {
      hook_definitions: JSON.stringify(defs),
      updated_at: new Date().toISOString(),
    });
    return { ...row, hook_definitions: defs, is_draft: Boolean(row.is_draft) };
  },

  async getGoRules(data: {
    projectId: string;
    serviceName: string;
    workflowId: string;
    hookType: string;
  }) {
    const workflow = await this.getByService(data.projectId, data.serviceName);
    if (!workflow) return null;
    const defs = workflow.hook_definitions || [];
    const hook = defs.find((h: any) => h.type === data.hookType);
    if (!hook) return null;
    return {
      workflowId: data.workflowId,
      hookType: data.hookType,
      rules: hook.goRules || null,
      updatedAt: workflow.updated_at,
    };
  },
};

// ─── generationHistoryDb ──────────────────────────────────────────────────────

export const generationHistoryDb = {
  async getAll(projectId: string) {
    return getDb()
      .selectFrom("generation_history")
      .selectAll()
      .where("project_id", "=", projectId)
      .orderBy("started_at", "desc")
      .execute();
  },

  async getLatest(projectId: string) {
    return getDb()
      .selectFrom("generation_history")
      .selectAll()
      .where("project_id", "=", projectId)
      .orderBy("started_at", "desc")
      .executeTakeFirst();
  },

  async getByStatus(projectId: string, status: string) {
    return getDb()
      .selectFrom("generation_history")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("status", "=", status)
      .orderBy("started_at", "desc")
      .execute();
  },

  async create(data: {
    project_id: string;
    stack_type: string;
    stack_version?: string;
    generation_options?: any;
    status: string;
  }) {
    const id = `gen_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    return insertAndReturn(getDb(), "generation_history", {
      id,
      project_id: data.project_id,
      stack_type: data.stack_type,
      stack_version: data.stack_version || null,
      generation_options: JSON.stringify(data.generation_options || {}),
      status: data.status,
      progress: 0,
      files_generated: 0,
      total_size_bytes: 0,
      started_at: new Date().toISOString(),
    });
  },

  async updateProgress(
    id: string,
    data: {
      progress?: number;
      current_step?: string;
      status?: string;
      logs?: string;
      error_message?: string;
      warnings?: any;
      files_generated?: number;
      total_size_bytes?: number;
    }
  ) {
    const u: any = {};
    if (data.progress !== undefined) u.progress = data.progress;
    if (data.current_step !== undefined) u.current_step = data.current_step;
    if (data.status !== undefined) u.status = data.status;
    if (data.logs !== undefined) u.logs = data.logs;
    if (data.error_message !== undefined) u.error_message = data.error_message;
    if (data.warnings !== undefined) u.warnings = JSON.stringify(data.warnings);
    if (data.files_generated !== undefined) u.files_generated = data.files_generated;
    if (data.total_size_bytes !== undefined) u.total_size_bytes = data.total_size_bytes;
    return updateAndReturn(getDb(), "generation_history", id, u);
  },

  async complete(
    id: string,
    data: {
      generated_path: string;
      output_structure?: any;
      port?: number;
      file_manifest?: any;
      entry_points?: any;
      build_command?: string;
      start_command?: string;
      install_command?: string;
      dependencies?: any;
      dev_dependencies?: any;
      environment_config?: any;
      docker_config?: any;
      duration_ms?: number;
      files_generated?: number;
      total_size_bytes?: number;
    }
  ) {
    const u: any = {
      status: "completed",
      progress: 100,
      completed_at: new Date().toISOString(),
      generated_path: data.generated_path,
    };
    if (data.output_structure !== undefined)
      u.output_structure = JSON.stringify(data.output_structure);
    if (data.file_manifest !== undefined) u.file_manifest = JSON.stringify(data.file_manifest);
    if (data.entry_points !== undefined) u.entry_points = JSON.stringify(data.entry_points);
    if (data.dependencies !== undefined) u.dependencies = JSON.stringify(data.dependencies);
    if (data.dev_dependencies !== undefined)
      u.dev_dependencies = JSON.stringify(data.dev_dependencies);
    if (data.environment_config !== undefined)
      u.environment_config = JSON.stringify(data.environment_config);
    if (data.docker_config !== undefined) u.docker_config = JSON.stringify(data.docker_config);
    if (data.port !== undefined) u.port = data.port;
    if (data.duration_ms !== undefined) u.duration_ms = data.duration_ms;
    if (data.files_generated !== undefined) u.files_generated = data.files_generated;
    if (data.total_size_bytes !== undefined) u.total_size_bytes = data.total_size_bytes;
    return updateAndReturn(getDb(), "generation_history", id, u);
  },

  async fail(id: string, errorMessage: string, logs?: string) {
    return updateAndReturn(getDb(), "generation_history", id, {
      status: "failed",
      error_message: errorMessage,
      logs: logs || null,
      completed_at: new Date().toISOString(),
    });
  },
};

// ─── deploymentDb ─────────────────────────────────────────────────────────────

export const deploymentDb = {
  async getDeployment(projectId: string, environment = "development") {
    return getDb()
      .selectFrom("deployments")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("environment", "=", environment)
      .executeTakeFirst();
  },

  async getAllDeployments(projectId: string) {
    return getDb()
      .selectFrom("deployments")
      .selectAll()
      .where("project_id", "=", projectId)
      .orderBy("created_at", "desc")
      .execute();
  },

  async upsert(data: {
    project_id: string;
    status: string;
    environment?: string;
    deployment_url?: string;
    port?: number;
    host?: string;
    process_id?: string;
    process_command?: string;
    uptime?: string;
    uptime_seconds?: number;
    deployment_config?: any;
    stdout_log?: string;
    stderr_log?: string;
  }) {
    const db = getDb();
    const existing = await this.getDeployment(data.project_id, data.environment || "development");
    const u: any = { ...data, updated_at: new Date().toISOString() };
    if (data.deployment_config !== undefined)
      u.deployment_config = JSON.stringify(data.deployment_config);

    if (existing) {
      if (data.status === "running" && existing.status !== "running") {
        u.started_at = new Date().toISOString();
        u.restart_count = (existing.restart_count || 0) + 1;
      } else if (data.status === "stopped" && existing.status === "running") {
        u.stopped_at = new Date().toISOString();
        if (existing.started_at) {
          u.uptime_seconds = Math.floor(
            (Date.now() - new Date(existing.started_at).getTime()) / 1000
          );
        }
      }
      return updateAndReturn(db, "deployments", existing.id, u);
    } else {
      const id = `dep_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      if (data.status === "running") u.started_at = new Date().toISOString();
      return insertAndReturn(db, "deployments", {
        id,
        ...u,
        environment: data.environment || "development",
        port: data.port || 4001,
        host: data.host || "localhost",
        auto_restart: false,
        restart_count: 0,
        created_at: new Date().toISOString(),
      });
    }
  },

  async updateHealth(
    id: string,
    healthData: {
      health_status?: any;
      resource_usage?: any;
      last_health_check?: Date;
      stdout_log?: string;
      stderr_log?: string;
      uptime?: string;
      uptime_seconds?: number;
    }
  ) {
    const u: any = { ...healthData };
    if (healthData.health_status !== undefined)
      u.health_status = JSON.stringify(healthData.health_status);
    if (healthData.resource_usage !== undefined)
      u.resource_usage = JSON.stringify(healthData.resource_usage);
    return updateAndReturn(getDb(), "deployments", id, u);
  },

  async delete(projectId: string, environment = "development") {
    const db = getDb();
    await db
      .updateTable("deployments")
      .set({ status: "stopped", stopped_at: new Date().toISOString() })
      .where("project_id", "=", projectId)
      .where("environment", "=", environment)
      .execute();
    await db
      .deleteFrom("deployments")
      .where("project_id", "=", projectId)
      .where("environment", "=", environment)
      .execute();
  },
};

// ─── entityDb ─────────────────────────────────────────────────────────────────

export const entityDb = {
  async getByProject(projectId: string) {
    return getDb()
      .selectFrom("entities")
      .selectAll()
      .where("project_id", "=", projectId)
      .orderBy("name")
      .execute();
  },

  async getByErdVersion(erdVersionId: string) {
    return getDb()
      .selectFrom("entities")
      .selectAll()
      .where("erd_version_id", "=", erdVersionId)
      .orderBy("name")
      .execute();
  },

  async upsert(data: {
    project_id: string;
    erd_version_id?: string;
    name: string;
    display_name?: string;
    type?: string;
    description?: string;
    schema?: any;
    fields?: any[];
    relationships?: any[];
    generate_api?: boolean;
    generate_ui?: boolean;
    generate_crud?: boolean;
  }) {
    const db = getDb();
    const existing = await db
      .selectFrom("entities")
      .selectAll()
      .where("project_id", "=", data.project_id)
      .where("name", "=", data.name)
      .executeTakeFirst();

    const vals: any = {
      ...data,
      schema: JSON.stringify(data.schema || {}),
      fields: JSON.stringify(data.fields || []),
      relationships: JSON.stringify(data.relationships || []),
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      return updateAndReturn(db, "entities", existing.id, vals);
    } else {
      const id = `ent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      return insertAndReturn(db, "entities", { id, ...vals, created_at: new Date().toISOString() });
    }
  },

  async deleteByProject(projectId: string) {
    await getDb().deleteFrom("entities").where("project_id", "=", projectId).execute();
  },
};

// ─── settingsDb ───────────────────────────────────────────────────────────────

export const settingsDb = {
  async get(key: string) {
    const setting = await getDb()
      .selectFrom("settings")
      .selectAll()
      .where("key", "=", key)
      .executeTakeFirst();
    if (!setting) return null;
    switch (setting.type) {
      case "number":
        return Number(setting.value);
      case "boolean":
        return setting.value === "true";
      case "json":
        return JSON.parse(setting.value || "{}");
      default:
        return setting.value;
    }
  },

  async set(key: string, value: any, type = "string", description?: string) {
    const db = getDb();
    const stringValue = type === "json" ? JSON.stringify(value) : String(value);
    const existing = await db
      .selectFrom("settings")
      .selectAll()
      .where("key", "=", key)
      .executeTakeFirst();
    if (existing) {
      await db
        .updateTable("settings")
        .set({ value: stringValue, type, description, updated_at: new Date().toISOString() })
        .where("key", "=", key)
        .execute();
    } else {
      await db
        .insertInto("settings")
        .values({
          key,
          value: stringValue,
          type,
          description,
          updated_at: new Date().toISOString(),
        })
        .execute();
    }
  },
};

// ─── rulesDb ──────────────────────────────────────────────────────────────────

export const rulesDb = {
  async findAll(options?: { entityName?: string; operation?: string }) {
    const db = getDb();
    let query = db.selectFrom("rules").selectAll();
    if (options?.entityName) query = query.where("entity_name", "=", options.entityName);
    if (options?.operation) query = query.where("operation", "=", options.operation);
    const rows = await query.orderBy("created_at", "desc").execute();
    return (rows as any[]).map((r) => ({
      id: r.id,
      entityName: r.entity_name,
      ruleName: r.rule_name,
      operation: r.operation,
      jdmContent: JSON.parse(r.jdm_content),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  },

  async findById(id: string) {
    const db = getDb();
    const row = await db.selectFrom("rules").selectAll().where("id", "=", id).executeTakeFirst();
    if (!row) return null;
    return {
      id: row.id,
      entityName: row.entity_name,
      ruleName: row.rule_name,
      operation: row.operation,
      jdmContent: JSON.parse(row.jdm_content),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  },

  async create(data: {
    id: string;
    entityName: string;
    ruleName: string;
    operation: string;
    jdmContent: object;
  }) {
    const db = getDb();
    const now = new Date().toISOString();
    await db
      .insertInto("rules")
      .values({
        id: data.id,
        entity_name: data.entityName,
        rule_name: data.ruleName,
        operation: data.operation,
        jdm_content: JSON.stringify(data.jdmContent),
        created_at: now,
        updated_at: now,
      })
      .execute();
    return this.findById(data.id);
  },

  async update(
    id: string,
    data: { entityName?: string; ruleName?: string; operation?: string; jdmContent?: object }
  ) {
    const db = getDb();
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (data.entityName !== undefined) updates.entity_name = data.entityName;
    if (data.ruleName !== undefined) updates.rule_name = data.ruleName;
    if (data.operation !== undefined) updates.operation = data.operation;
    if (data.jdmContent !== undefined) updates.jdm_content = JSON.stringify(data.jdmContent);
    await db.updateTable("rules").set(updates).where("id", "=", id).execute();
    return this.findById(id);
  },

  async delete(id: string) {
    await getDb().deleteFrom("rules").where("id", "=", id).execute();
  },
};

// ─── Aggregate export ─────────────────────────────────────────────────────────

export const dbOperations = {
  projects: projectDb,
  erdVersions: erdVersionDb,
  workflows: workflowDb,
  generationHistory: generationHistoryDb,
  deployments: deploymentDb,
  entities: entityDb,
  settings: settingsDb,
  rules: rulesDb,
};
