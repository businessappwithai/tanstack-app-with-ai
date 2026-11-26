import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/require-user";

let _dbReady = false;
async function ensureDb() {
  if (!_dbReady) {
    _dbReady = true;
    const { runMigrations } = await import("@appwithai/core/services");
    await runMigrations().catch((err) => console.error("[DB] Migration error:", err));
  }
}

export const Route = createFileRoute("/api/rules/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        await ensureDb();
        const caller = await requireUser(request, "rules");
        if (caller.response) return caller.response;

        try {
          const { rulesDb } = await import("@appwithai/core/services");
          const url = new URL(request.url);
          const entityName = url.searchParams.get("entityName") ?? undefined;
          const operation = url.searchParams.get("operation") ?? undefined;

          // Paged at 200, which is also the ceiling. A list endpoint that can be
          // asked for everything eventually is, and then the page it feeds stops
          // loading for the person with the most rules — the one who needs it most.
          const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 200), 1), 200);
          const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);

          const all = await rulesDb.findAll({ entityName, operation });
          const rules = all.slice(offset, offset + limit);

          return new Response(
            JSON.stringify({
              rules,
              total: all.length,
              limit,
              offset,
              hasMore: offset + rules.length < all.length,
            }),
            { headers: { "Content-Type": "application/json" } }
          );
        } catch (error) {
          console.error("Error fetching rules:", error);
          return new Response(JSON.stringify({ error: "Failed to fetch rules" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },

      POST: async ({ request }) => {
        await ensureDb();
        const caller = await requireUser(request, "rules", "write");
        if (caller.response) return caller.response;

        try {
          const { rulesDb } = await import("@appwithai/core/services");
          const body = await request.json();
          const { entityName, ruleName, operation, jdmContent } = body;

          if (!entityName || !ruleName || !operation || !jdmContent) {
            return new Response(
              JSON.stringify({
                error: "Missing required fields: entityName, ruleName, operation, jdmContent",
              }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              }
            );
          }

          // Accepts both shapes: the decision table the rule table editor writes,
          // and the older decision graph. Validating only the graph shape is what
          // stopped the table editor being able to save at all.
          const { validateStoredRuleContent } = await import(
            "@appwithai/editors/lib/automation/rule-content"
          );
          const errors = validateStoredRuleContent(jdmContent);

          if (errors.length > 0) {
            return new Response(
              JSON.stringify({ error: "This rule cannot be saved yet", errors }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              }
            );
          }

          const id = `rule_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
          const rule = await rulesDb.create({ id, entityName, ruleName, operation, jdmContent });

          return new Response(JSON.stringify({ success: true, id, rule }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          });
        } catch (error) {
          console.error("Error creating rule:", error);
          return new Response(JSON.stringify({ error: "Failed to create rule" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
