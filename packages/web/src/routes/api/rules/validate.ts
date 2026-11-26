import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/require-user";

export const Route = createFileRoute("/api/rules/validate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const caller = await requireUser(request, "rules:validate");
        if (caller.response) return caller.response;

        try {
          const body = await request.json();
          const { jdm } = body;

          if (!jdm) {
            return new Response(JSON.stringify({ error: "Missing JDM content" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }

          const errors: string[] = [];
          const warnings: string[] = [];

          // A decision table is a complete rule on its own — the node walk below
          // only applies to the older decision-graph shape.
          const { isDecisionTable, validateStoredRuleContent } = await import(
            "@appwithai/editors/lib/automation/rule-content"
          );
          if (isDecisionTable(jdm)) {
            const problems = validateStoredRuleContent(jdm);
            return new Response(
              JSON.stringify({ valid: problems.length === 0, errors: problems }),
              {
                headers: { "Content-Type": "application/json" },
              }
            );
          }

          // Validate required fields
          if (!jdm.name) {
            errors.push("Rule name is required");
          }

          if (!jdm.nodes || jdm.nodes.length === 0) {
            errors.push("At least one node is required");
          }

          // Validate each node
          jdm.nodes?.forEach(
            (
              node: { id?: string; type?: string; content?: Record<string, unknown> },
              index: number
            ) => {
              if (!node.id) {
                errors.push(`Node ${index}: id is required`);
              }

              if (!node.type) {
                errors.push(`Node ${index}: type is required`);
              }

              if (node.type === "decisionTable") {
                if (!node.content) {
                  errors.push(`Node ${index}: content is required for decision table`);
                } else {
                  if (!node.content.inputs || !Array.isArray(node.content.inputs)) {
                    errors.push(`Node ${index}: inputs must be an array`);
                  }
                  if (!node.content.outputs || !Array.isArray(node.content.outputs)) {
                    errors.push(`Node ${index}: outputs must be an array`);
                  }
                  if (!node.content.rules || !Array.isArray(node.content.rules)) {
                    errors.push(`Node ${index}: rules must be an array`);
                  } else {
                    node.content.rules.forEach(
                      (rule: { condition?: string; output?: unknown }, ruleIndex: number) => {
                        if (!rule.condition) {
                          errors.push(`Node ${index}, Rule ${ruleIndex}: condition is required`);
                        }
                        if (!rule.output) {
                          warnings.push(`Node ${index}, Rule ${ruleIndex}: no output defined`);
                        }
                      }
                    );
                  }
                }
              }
            }
          );

          // Validate JSON structure
          try {
            JSON.stringify(jdm);
          } catch (_error) {
            errors.push("Invalid JSON structure");
          }

          return new Response(
            JSON.stringify({
              valid: errors.length === 0,
              errors: errors.length > 0 ? errors : undefined,
              warnings: warnings.length > 0 ? warnings : undefined,
            }),
            {
              headers: { "Content-Type": "application/json" },
            }
          );
        } catch (error) {
          console.error("Error validating rule:", error);
          return new Response(JSON.stringify({ error: "Failed to validate rule" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
