import { createFileRoute } from "@tanstack/react-router";
import { getCurrentUser } from "@/lib/auth-server";

let _dbReady = false;
async function ensureDb() {
  if (!_dbReady) {
    _dbReady = true;
    const { runMigrations } = await import("@appwithai/core/services");
    await runMigrations().catch((err) => console.error("[DB] Migration error:", err));
  }
}

async function checkProjectAccess(
  db: any,
  projectId: string,
  userId: string,
  requiredPermission?: "read_write"
): Promise<{ allowed: boolean; reason?: string }> {
  const project = await db
    .selectFrom("projects")
    .selectAll()
    .where("id", "=", projectId)
    .executeTakeFirst();

  if (!project) {
    return { allowed: false, reason: "Project not found" };
  }

  if (project.owner_user_id === userId) {
    return { allowed: true };
  }

  const membership = await db
    .selectFrom("project_members")
    .selectAll()
    .where("project_id", "=", projectId)
    .where("user_id", "=", userId)
    .executeTakeFirst();

  if (!membership) {
    return { allowed: false, reason: "Access denied" };
  }

  if (requiredPermission === "read_write" && membership.permission !== "read_write") {
    return { allowed: false, reason: "Insufficient permissions" };
  }

  return { allowed: true };
}

/**
 * The project fields a client may change, and the columns they write to.
 *
 * The handler used to spread the request body straight into the UPDATE. That
 * was wrong twice over. The API speaks camelCase and the table is snake_case,
 * so every field that differed silently failed the statement — recording
 * `generatedPath` after a successful generation returned a 500 and left the
 * page believing nothing had been generated. And an unfiltered spread lets a
 * caller name any column at all, including `owner_user_id` and `is_deleted`,
 * which turns an edit right into the ability to take a project over or make it
 * disappear.
 *
 * Anything not named here is ignored. `id`, `owner_user_id` and the timestamps
 * are deliberately absent: they are not the client's to set.
 */
export const EDITABLE_PROJECT_COLUMNS: Record<string, string> = {
  name: "name",
  description: "description",
  icon: "icon",
  iconColor: "icon_color",
  status: "status",
  stackType: "stack_type",
  stackVersion: "stack_version",
  port: "port",
  baseUrl: "base_url",
  databaseUrl: "database_url",
  databaseType: "database_type",
  databaseSchema: "database_schema",
  environmentVariables: "environment_variables",
  generatedPath: "generated_path",
  outputDirectory: "output_directory",
  buildConfig: "build_config",
  isTypescript: "is_typescript",
  isTailwind: "is_tailwind",
  deploymentStatus: "deployment_status",
  deploymentUrl: "deployment_url",
  uptime: "uptime",
};

/**
 * Shape a project row the way the client's `Project` type expects.
 *
 * Both handlers used to spell this out separately, and both were missing
 * fields the type declares — `deploymentStatus` among them, which the generate
 * step reads to decide whether a project has been generated. Without it the
 * page showed the stack picker again after a successful run. One mapper means
 * a field added here reaches every caller.
 *
 * `erdCode` is not included: it lives in `erd_versions` and each caller decides
 * whether the extra query is worth it.
 */
export function toProjectResponse(row: Record<string, any>): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    iconColor: row.icon_color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status,
    isDeleted: row.is_deleted,
    ownerId: row.owner_user_id,
    stackType: row.stack_type,
    port: row.port,
    databaseUrl: row.database_url,
    databaseType: row.database_type,
    generatedPath: row.generated_path,
    outputDirectory: row.output_directory,
    deploymentStatus: row.deployment_status,
    deploymentUrl: row.deployment_url,
    uptime: row.uptime,
  };
}

/** Narrow a request body to the columns it is allowed to write. */
export function toProjectColumns(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object") return {};
  const changes: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(body as Record<string, unknown>)) {
    const column = EDITABLE_PROJECT_COLUMNS[field];
    // A field sent as undefined means "not being changed", not "set to null".
    if (column && value !== undefined) changes[column] = value;
  }
  return changes;
}

export const Route = createFileRoute("/api/projects/$id/")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        await ensureDb();
        try {
          const { getDatabase } = await import("@appwithai/core/services");
          const user = await getCurrentUser(request);
          if (!user) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            });
          }

          const db = getDatabase();
          const id = params.id as string;

          const access = await checkProjectAccess(db, id, user.id);
          if (!access.allowed) {
            return new Response(JSON.stringify({ error: access.reason ?? "Access denied" }), {
              status: 403,
              headers: { "Content-Type": "application/json" },
            });
          }

          const dbProject = await db
            .selectFrom("projects")
            .selectAll()
            .where("id", "=", id)
            .executeTakeFirst();

          if (!dbProject) {
            return new Response(JSON.stringify({ error: "Project not found" }), {
              status: 404,
              headers: { "Content-Type": "application/json" },
            });
          }

          // The model lives in erd_versions, not on the project row. Leaving it
          // out meant a project whose model came from anywhere but this browser
          // session opened the design step with an empty canvas — which is what
          // every imported model does.
          const currentVersion = await db
            .selectFrom("erd_versions")
            .select(["mermaid_code"])
            .where("project_id", "=", id)
            .where("is_current", "=", true)
            .orderBy("created_at", "desc")
            .executeTakeFirst();

          const gitState = await db
            .selectFrom("project_git_state")
            .selectAll()
            .where("project_id", "=", id)
            .executeTakeFirst();
          const project = {
            gitCommit: gitState?.model_commit ?? null,
            ...toProjectResponse(dbProject as Record<string, any>),
            erdCode: gitState?.model_code ?? currentVersion?.mermaid_code ?? "",
          };

          return new Response(JSON.stringify({ project }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (error) {
          console.error("Error fetching project:", error);
          return new Response(JSON.stringify({ error: "Failed to fetch project" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },

      PATCH: async ({ request, params }) => {
        await ensureDb();
        try {
          const { getDatabase } = await import("@appwithai/core/services");
          const user = await getCurrentUser(request);
          if (!user) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            });
          }

          if (user.role === "admin") {
            return new Response(JSON.stringify({ error: "Admins cannot modify projects" }), {
              status: 403,
              headers: { "Content-Type": "application/json" },
            });
          }

          const db = getDatabase();
          const id = params.id as string;

          const access = await checkProjectAccess(db, id, user.id, "read_write");
          if (!access.allowed) {
            return new Response(JSON.stringify({ error: access.reason ?? "Access denied" }), {
              status: 403,
              headers: { "Content-Type": "application/json" },
            });
          }

          const body = await request.json();
          const now = new Date().toISOString();

          const changes = toProjectColumns(body);
          if (Object.keys(changes).length === 0) {
            return new Response(JSON.stringify({ error: "No editable fields in request" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }

          await db
            .updateTable("projects")
            .set({ ...changes, updated_at: now })
            .where("id", "=", id)
            .execute();

          const dbProject = await db
            .selectFrom("projects")
            .selectAll()
            .where("id", "=", id)
            .executeTakeFirst();

          const project = dbProject ? toProjectResponse(dbProject as Record<string, any>) : null;

          return new Response(JSON.stringify({ project }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (error) {
          console.error("Error updating project:", error);
          return new Response(JSON.stringify({ error: "Failed to update project" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },

      DELETE: async ({ request, params }) => {
        await ensureDb();
        try {
          const { getDatabase } = await import("@appwithai/core/services");
          const user = await getCurrentUser(request);
          if (!user) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            });
          }

          if (user.role === "admin") {
            return new Response(JSON.stringify({ error: "Admins cannot delete projects" }), {
              status: 403,
              headers: { "Content-Type": "application/json" },
            });
          }

          const db = getDatabase();
          const id = params.id as string;

          const access = await checkProjectAccess(db, id, user.id, "read_write");
          if (!access.allowed) {
            return new Response(JSON.stringify({ error: access.reason ?? "Access denied" }), {
              status: 403,
              headers: { "Content-Type": "application/json" },
            });
          }

          const now = new Date().toISOString();
          await db
            .updateTable("projects")
            .set({ is_deleted: true, updated_at: now })
            .where("id", "=", id)
            .execute();

          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (error) {
          console.error("Error deleting project:", error);
          return new Response(JSON.stringify({ error: "Failed to delete project" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
