/**
 * What a `.mmd` document actually contains.
 *
 * Used before a model is accepted into a project. Someone importing a file
 * wants to know what they are about to get — how many entities, how many rules,
 * which workflows — and, more importantly, to be told *now* if the document is
 * not a model at all, rather than discovering it on the design page with an
 * empty canvas and no explanation.
 *
 * It also runs the checker — `language/checker.ts`, the engine behind
 * `bun language/checker.ts` and the published `checker.js` — without repairing
 * anything, so the Design page's Validate reports the same errors, warnings and
 * notes generation will. `ok` stays about whether the document is a model at all:
 * generation repairs the auto-fixable errors itself, so they do not block an import.
 */

import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/require-user";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export interface EmlSummary {
  ok: boolean;
  entities: string[];
  relationships: number;
  rules: { name: string; entity: string }[];
  workflows: { name: string; entity: string; kind: string }[];
  /** Reasons the document cannot be used as it stands. */
  problems: string[];
  /** What the checker reports, worst first; absent when the checker itself failed. */
  check?: {
    errors: number;
    warnings: number;
    infos: number;
    issues: { severity: string; code: string; message: string; line?: number; hint?: string }[];
  };
  /** Why `check` is absent. It never blocks an import: generation checks again. */
  checkFailure?: string;
}

export const Route = createFileRoute("/api/eml/validate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const caller = await requireUser(request, "eml:validate", "read");
        if (caller.response) return caller.response;

        try {
          const body = (await request.json()) as { eml?: string };
          const eml = typeof body.eml === "string" ? body.eml : "";

          if (!eml.trim()) {
            return json({
              ok: false,
              entities: [],
              relationships: 0,
              rules: [],
              workflows: [],
              problems: ["The file is empty."],
            } satisfies EmlSummary);
          }

          const { parseModel, extractRuleSections, extractWorkflowSections, reviewModel } =
            await import("@appwithai/generator");

          const problems: string[] = [];
          let entities: string[] = [];
          let relationships = 0;

          try {
            const model = parseModel(eml);
            entities = model.entities.map((entity) => entity.name);
            relationships = model.relationships.length;
          } catch (parseError) {
            const message = parseError instanceof Error ? parseError.message : "Unknown error";
            problems.push(`The ERD could not be read: ${message}`);
          }

          if (entities.length === 0 && problems.length === 0) {
            problems.push(
              "No entities found. An EML document needs an `erDiagram` section describing the data."
            );
          }

          const rules = extractRuleSections(eml).map((rule) => ({
            name: rule.name,
            entity: rule.entity,
          }));
          const workflows = extractWorkflowSections(eml).map((workflow) => ({
            name: workflow.name,
            entity: workflow.entity,
            kind: workflow.kind,
          }));

          let check: EmlSummary["check"];
          let checkFailure: string | undefined;
          try {
            const review = reviewModel(eml, { autoFix: false });
            check = {
              ...review.counts,
              issues: review.issues.map(({ severity, code, message, line, hint }) => ({
                severity,
                code,
                message,
                line,
                hint,
              })),
            };
          } catch (checkError) {
            checkFailure = checkError instanceof Error ? checkError.message : "Unknown error";
          }

          return json({
            ok: problems.length === 0,
            entities,
            relationships,
            rules,
            workflows,
            problems,
            check,
            checkFailure,
          } satisfies EmlSummary);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error";
          return json({ error: `Could not read the document: ${message}` }, 500);
        }
      },
    },
  },
});
