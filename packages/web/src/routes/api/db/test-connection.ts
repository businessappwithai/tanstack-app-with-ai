import { createFileRoute } from "@tanstack/react-router";
import { requireProjectAccess } from "@/lib/project-access";
import { getDatabase } from "@appwithai/core/services";

export const Route = createFileRoute("/api/db/test-connection")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const projectId = url.searchParams.get("projectId");
        if (!projectId) {
          return new Response(JSON.stringify({ error: "projectId is required" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        const access = await requireProjectAccess(request, projectId, "read");
        if ("response" in access) return access.response;

        const db = getDatabase();
        const project = await db
          .selectFrom("projects")
          .select("database_url")
          .where("id", "=", projectId)
          .executeTakeFirst();

        return new Response(
          JSON.stringify({ connectionString: project?.database_url ?? null }),
          { headers: { "Content-Type": "application/json" } }
        );
      },

      POST: async ({ request }) => {
        const json = (body: unknown, status = 200): Response =>
          new Response(JSON.stringify(body), {
            status,
            headers: { "Content-Type": "application/json" },
          });

        try {
          const body = (await request.json()) as {
            targetDbConnection?: string;
            projectId?: string;
            saveOnSuccess?: boolean;
          };
          if (!body.targetDbConnection?.trim()) {
            return json({ error: "targetDbConnection is required" }, 400);
          }
          if (!body.projectId) {
            return json({ error: "projectId is required" }, 400);
          }

          const accessLevel = body.saveOnSuccess ? "read_write" : "read";
          const access = await requireProjectAccess(request, body.projectId, accessLevel);
          if ("response" in access) return access.response;

          const { Client } = await import("pg");
          const client = new Client({
            connectionString: body.targetDbConnection,
            connectionTimeoutMillis: 10000,
          });
          await client.connect();
          const result = await client.query(
            "SELECT COUNT(*) AS table_count FROM information_schema.tables WHERE table_schema = 'public'"
          );
          await client.end();
          const tableCount = Number(result.rows[0]?.table_count ?? 0);

          if (body.saveOnSuccess) {
            const db = getDatabase();
            await db
              .updateTable("projects")
              .set({ database_url: body.targetDbConnection, updated_at: new Date().toISOString() })
              .where("id", "=", body.projectId)
              .execute();
          }

          return json({ success: true, tableCount });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Connection failed";
          const unreachable = message.includes("ECONNREFUSED") || message.includes("timeout");
          return json({ error: message }, unreachable ? 504 : 400);
        }
      },
    },
  },
});
