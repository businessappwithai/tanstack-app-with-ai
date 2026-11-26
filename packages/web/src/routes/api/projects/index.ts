/**
 * Projects API route
 * Handles CRUD operations for projects
 */

import { createFileRoute } from "@tanstack/react-router";
import { getCurrentUser } from "@/lib/auth-server";

// Ensure DB schema exists on first request
let _dbReady = false;
async function ensureDb() {
  if (!_dbReady) {
    _dbReady = true;
    const { runMigrations } = await import("@appwithai/core/services");
    await runMigrations().catch((err) => console.error("[DB] Migration error:", err));
  }
}

export const Route = createFileRoute("/api/projects/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
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
          const url = new URL(request.url);
          const search = url.searchParams.get("search");

          let projects: Array<Record<string, unknown>>;

          if (search) {
            projects = await db
              .selectFrom("projects")
              .selectAll()
              .where("is_deleted", "=", false)
              .where((eb) =>
                eb.or([
                  eb("owner_user_id", "=", user.id),
                  eb(
                    "id",
                    "in",
                    db
                      .selectFrom("project_members")
                      .select("project_id")
                      .where("user_id", "=", user.id)
                  ),
                ])
              )
              .where((eb) =>
                eb.or([eb("name", "like", `%${search}%`), eb("description", "like", `%${search}%`)])
              )
              .execute();
          } else {
            projects = await db
              .selectFrom("projects")
              .selectAll()
              .where("is_deleted", "=", false)
              .where((eb) =>
                eb.or([
                  eb("owner_user_id", "=", user.id),
                  eb(
                    "id",
                    "in",
                    db
                      .selectFrom("project_members")
                      .select("project_id")
                      .where("user_id", "=", user.id)
                  ),
                ])
              )
              .execute();
          }

          const transformed = projects.map((p: any) => ({
            id: p.id,
            name: p.name,
            description: p.description,
            icon: p.icon,
            iconColor: p.icon_color,
            createdAt: p.created_at,
            updatedAt: p.updated_at,
            status: p.status,
            isDeleted: p.is_deleted,
            ownerId: p.owner_user_id,
            stackType: p.stack_type,
            port: p.port,
            databaseUrl: p.database_url,
            generatedPath: p.generated_path,
          }));

          return new Response(JSON.stringify({ projects: transformed }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const errorStack = error instanceof Error ? error.stack : "";
          console.error("Error fetching projects:", errorMessage, errorStack);
          return new Response(
            JSON.stringify({
              error: "Failed to fetch projects",
              details: errorMessage,
            }),
            {
              status: 500,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
      },

      POST: async ({ request }) => {
        try {
          const user = await getCurrentUser(request);
          if (!user) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            });
          }

          const body = await request.json();
          const {
            name,
            description,
            icon,
            iconColor,
            stackType,
            port,
            databaseUrl,
            environmentVariables,
            erdCode,
          } = body;

          if (!name) {
            return new Response(JSON.stringify({ error: "Name is required" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }

          const projectId = `proj_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          const now = new Date().toISOString();
          const { getDatabase } = await import("@appwithai/core/services");
          const db = getDatabase();

          await db
            .insertInto("projects")
            .values({
              id: projectId,
              name,
              description,
              icon,
              icon_color: iconColor,
              status: "draft",
              is_deleted: false,
              stack_type: stackType,
              stack_version: "latest",
              port,
              database_url: databaseUrl,
              database_type: "postgresql",
              environment_variables: environmentVariables,
              owner_user_id: user.id,
              created_at: now,
              updated_at: now,
            })
            .execute();

          // Persist a model supplied at creation as version 1. It used to be
          // accepted and dropped, so a project created with a complete EML
          // document came back with nothing to design against.
          if (typeof erdCode === "string" && erdCode.trim()) {
            const { saveProject } = await import("@/lib/server/project-repository");
            await saveProject(projectId, user.id, {
              model: erdCode,
              mode: "version",
              description: "Initial model",
            });
          }

          const dbProject = await db
            .selectFrom("projects")
            .selectAll()
            .where("id", "=", projectId)
            .executeTakeFirst();

          const project = dbProject
            ? {
                id: dbProject.id,
                name: dbProject.name,
                description: dbProject.description,
                icon: dbProject.icon,
                iconColor: dbProject.icon_color,
                createdAt: dbProject.created_at,
                updatedAt: dbProject.updated_at,
                status: dbProject.status,
                isDeleted: dbProject.is_deleted,
                ownerId: dbProject.owner_user_id,
                stackType: dbProject.stack_type,
                port: dbProject.port,
                databaseUrl: dbProject.database_url,
                generatedPath: dbProject.generated_path,
                erdCode: typeof erdCode === "string" && erdCode.trim() ? erdCode : "",
              }
            : null;

          return new Response(JSON.stringify({ project }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          });
        } catch (error) {
          console.error("Error creating project:", error);
          return new Response(JSON.stringify({ error: "Failed to create project" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
