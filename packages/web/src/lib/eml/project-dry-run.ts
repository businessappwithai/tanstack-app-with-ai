import type { DryRunResult, RuleDryRun } from "@appwithai/editors/lib/eml/dry-run-types";

/** The modelling tool's way to run a rule: its project's dry-run route. */
export function projectDryRun(projectId: string): RuleDryRun {
  return async ({ graph, record, entity }) => {
    const response = await fetch(`/api/projects/${projectId}/rules/dry-run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ graph, record, entity }),
    });
    const data = (await response.json()) as DryRunResult & { error?: string };
    if (!response.ok) throw new Error(data.error ?? `Could not run the rule (${response.status})`);
    return data;
  };
}
