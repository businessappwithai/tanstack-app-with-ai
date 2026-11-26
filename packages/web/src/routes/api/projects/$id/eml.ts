/**
 * The project's EML document.
 *
 * A project's model is one `.mmd` file — ERD, business rules and workflows
 * together — and that file is the source of truth the generator consumes. The
 * design phase edits rules and workflows as structured records; this route is
 * where they are merged back in, so the document stays complete and valid
 * however it was edited.
 *
 * GET  → the complete document, plus its sections parsed out for an editor
 * PUT  → replace the rules and/or workflow sections, leaving the ERD untouched
 */

import { createFileRoute } from "@tanstack/react-router";
import { requireProjectAccess } from "@/lib/project-access";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Turn a thrown error into a response.
 *
 * An error that escapes a handler is not just an unhelpful 500 — the dev server
 * dies trying to serialise it — so nothing here is allowed to throw.
 */
function failed(error: unknown, action: string): Response {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`[eml] ${action} failed:`, error);
  return json({ error: `Could not ${action}: ${message}` }, 500);
}

export const Route = createFileRoute("/api/projects/$id/eml")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const access = await requireProjectAccess(request, params.id);
          if (access.response) return access.response;

          const { projectDb } = await import("@appwithai/core/services");
          const { extractRuleSections, extractWorkflowSections } = await import(
            "@appwithai/generator"
          );

          const project = await projectDb.findById(params.id);
          if (!project) return json({ error: "Project not found" }, 404);

          const eml = project.erdCode ?? "";

          return json({
            projectId: params.id,
            name: project.name,
            eml,
            rules: extractRuleSections(eml),
            workflows: extractWorkflowSections(eml),
          });
        } catch (error) {
          return failed(error, "read the model");
        }
      },

      PUT: async ({ request, params }) => {
        try {
          const access = await requireProjectAccess(request, params.id, "read_write");
          if (access.response) return access.response;

          const { projectDb } = await import("@appwithai/core/services");
          const { mergeSections, extractRuleSections, extractWorkflowSections, parseModel } =
            await import("@appwithai/generator");

          const project = await projectDb.findById(params.id);
          if (!project) return json({ error: "Project not found" }, 404);

          const existing = project.erdCode ?? "";
          if (!existing.trim()) {
            return json(
              { error: "This project has no ERD yet. Design the data model before adding rules." },
              409
            );
          }

          const body = (await request.json()) as {
            rules?: unknown;
            workflows?: unknown;
          };

          // Omitting a collection leaves it as it is; sending an empty array
          // clears it. An editor that only handles rules must not silently drop
          // the workflows the model already declares.
          const rules = Array.isArray(body.rules)
            ? (body.rules as ReturnType<typeof extractRuleSections>)
            : extractRuleSections(existing);
          const workflows = Array.isArray(body.workflows)
            ? (body.workflows as ReturnType<typeof extractWorkflowSections>)
            : extractWorkflowSections(existing);

          const { sectionProblems } = await import("@appwithai/editors/lib/eml/section-problems");
          const problems = sectionProblems(
            Array.isArray(body.rules) ? rules : [],
            Array.isArray(body.workflows) ? workflows : []
          );
          if (problems.length > 0) {
            return json({ error: problems.map((p) => p.message).join(" "), problems }, 400);
          }

          const eml = mergeSections(existing, { rules, workflows });

          // The model is versioned, so editing rules leaves the previous document
          // recoverable rather than overwriting it in place.
          const model = parseModel(eml);
          const { saveProject } = await import("@/lib/server/project-repository");
          await saveProject(params.id, access.user.id, {
            model: eml,
            mode: "version",
            description: `Rules and workflows updated (${model.entities.length} entities)`,
            expectedCommit: project.gitCommit,
            requestId: request.headers.get("Idempotency-Key") ?? undefined,
          });

          // Re-embed so the assistant answers from what was just saved rather
          // than from the previous version. Deliberately awaited but not
          // allowed to fail the save: a model the user has written is worth
          // keeping even when the vector store is unreachable, and stale
          // context is a worse answer, not a lost document.
          try {
            const { ingestProjectModel } = await import("@appwithai/ai");
            await ingestProjectModel(params.id, eml, { name: project.name });
          } catch (ingestError) {
            console.warn("[eml] model saved but not re-embedded:", ingestError);
          }

          return json({
            projectId: params.id,
            eml,
            rules: extractRuleSections(eml),
            workflows: extractWorkflowSections(eml),
          });
        } catch (error) {
          return failed(error, "save the model");
        }
      },
    },
  },
});
