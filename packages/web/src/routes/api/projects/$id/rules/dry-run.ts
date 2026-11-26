/**
 * Try a rule against a sample record.
 *
 * A function node in the graph is code, and this endpoint runs it — so the
 * caller needs write access to the project, not just read. Nothing is stored.
 */

import { createFileRoute } from "@tanstack/react-router";
import { requireProjectAccess } from "@/lib/project-access";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const Route = createFileRoute("/api/projects/$id/rules/dry-run")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const access = await requireProjectAccess(request, params.id as string, "read_write");
        if (access.response) return access.response;

        let body: { graph?: unknown; record?: unknown; entity?: unknown };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return json({ error: "The request body must be JSON." }, 400);
        }
        const record = body.record;
        if (!record || typeof record !== "object" || Array.isArray(record)) {
          return json({ error: "record must be an object." }, 400);
        }

        const { dryRunRule } = await import("@/lib/eml/dry-run");
        const outcome = await dryRunRule({
          graph: body.graph,
          record: record as Record<string, unknown>,
          entity: typeof body.entity === "string" ? body.entity : undefined,
        });
        return json(outcome);
      },
    },
  },
});
