/**
 * Describe an existing database as EML.
 *
 * The introspection itself lives in `@appwithai/core/services` because the
 * container bootstrap seeds a project the same way without going through HTTP.
 * One implementation, so a model imported from a connection string is identical
 * whichever door it came through.
 */

import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/require-user";

export const Route = createFileRoute("/api/db/reverse-engineer")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const caller = await requireUser(request, "db:reverse-engineer", "read");
        if (caller.response) return caller.response;

        const json = (body: unknown, status = 200): Response =>
          new Response(JSON.stringify(body), {
            status,
            headers: { "Content-Type": "application/json" },
          });

        try {
          const body = (await request.json()) as { targetDbConnection?: string };
          if (!body.targetDbConnection) {
            return json({ error: "targetDbConnection is required" }, 400);
          }

          const { introspectDatabase } = await import("@appwithai/core/services");
          const schema = await introspectDatabase({ connectionString: body.targetDbConnection });

          return json({
            mermaidCode: schema.eml,
            tableCount: schema.tableCount,
            relationshipCount: schema.relationshipCount,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Failed to reverse-engineer schema";
          // A database that never answered is not the same failure as one that
          // answered with something we could not read.
          const unreachable = message.includes("ECONNREFUSED") || message.includes("timeout");
          return json({ error: message }, unreachable ? 504 : 500);
        }
      },
    },
  },
});
