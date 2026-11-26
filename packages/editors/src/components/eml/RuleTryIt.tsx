import { AlertCircle, CheckCircle2, Play } from "lucide-react";
import { useMemo, useState } from "react";
import type { DryRunResult, RuleDryRun } from "../../lib/eml/dry-run-types";
import { sampleRecord } from "../../lib/eml/rule-templates";

interface RuleTryItProps {
  entity: string;
  /** How the rule is run on the server. */
  dryRun: RuleDryRun;
  entityFields: string[];
  entityEnums: Record<string, string[]>;
  /** Each field's JSON type, so the sample starts with a value of the right kind. */
  fieldTypes?: Record<string, "string" | "number" | "boolean">;
  /** The graph as it stands now, saved or not. */
  getGraph: () => string;
  /** When set, the section is exactly this tall and the textarea fills the space. */
  height?: number;
}

const KIND_STYLE: Record<string, string> = {
  blocks: "border-red-300 bg-red-50 text-red-900",
  workflow: "border-blue-300 bg-blue-50 text-blue-900",
  changes: "border-blue-300 bg-blue-50 text-blue-900",
  notifies: "border-amber-300 bg-amber-50 text-amber-900",
  cascade: "border-blue-300 bg-blue-50 text-blue-900",
  nothing: "border-emerald-300 bg-emerald-50 text-emerald-900",
  problem: "border-amber-400 bg-amber-50 text-amber-900",
};

/**
 * Try the rule on a sample record before saving it.
 *
 * The answer is a sentence about what would happen to the write, not raw JSON:
 * a rule that "does nothing" looks the same whether it did not match or never
 * said what to do, and only one of those is the author's mistake.
 */
export function RuleTryIt({
  entity,
  dryRun,
  entityFields,
  entityEnums,
  fieldTypes,
  getGraph,
  height,
}: RuleTryItProps) {
  const initial = useMemo(
    () => JSON.stringify(sampleRecord(entityFields, entityEnums, fieldTypes), null, 2),
    [entityFields, entityEnums, fieldTypes]
  );
  const [text, setText] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<DryRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = text ?? initial;

  const run = async () => {
    setError(null);
    setResult(null);
    let record: unknown;
    try {
      record = JSON.parse(shown);
    } catch {
      setError("The sample record is not valid JSON.");
      return;
    }
    setRunning(true);
    try {
      const data = await dryRun({
        graph: getGraph(),
        record: record as Record<string, unknown>,
        entity,
      });
      setResult(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not run the rule.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <section
      aria-label="Try the rule"
      style={height ? { height } : undefined}
      className={`mt-3 rounded-lg border border-border p-3${height ? " flex flex-col overflow-hidden" : ""}`}
    >
      <h3 className="text-sm font-semibold">Try it before you save</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Edit the sample record, then run the rule to see what it would do to the write. Nothing is
        saved.
      </p>
      <div className={`mt-2 grid gap-3 lg:grid-cols-2${height ? " flex-1 min-h-0" : ""}`}>
        <label className={height ? "flex min-h-0 flex-col" : "block"}>
          <span className="mb-1 block text-xs font-medium">Sample {entity || "record"}</span>
          <textarea
            className={`w-full rounded-md border border-border p-2 font-mono text-xs${height ? " min-h-0 flex-1 resize-none" : " h-40"}`}
            value={shown}
            onChange={(event) => setText(event.target.value)}
            spellCheck={false}
          />
        </label>
        <div aria-live="polite" className={height ? "min-h-0 overflow-y-auto" : ""}>
          <span className="mb-1 block text-xs font-medium">What would happen</span>
          {error && (
            <p className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
            </p>
          )}
          {result && !result.ok && (
            <ul className="space-y-1">
              {result.problems.map((problem) => (
                <li
                  key={problem}
                  className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900"
                >
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {problem}
                </li>
              ))}
            </ul>
          )}
          {result?.ok && (
            <>
              <ul className="space-y-1">
                {result.outcomes.map((outcome) => (
                  <li
                    key={`${outcome.kind}-${outcome.text}`}
                    className={`flex items-start gap-1.5 rounded-md border p-2 text-xs ${KIND_STYLE[outcome.kind]}`}
                  >
                    {outcome.kind === "problem" ? (
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    )}
                    {outcome.text}
                  </li>
                ))}
              </ul>
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer font-medium">How it got there</summary>
                <ol className="mt-1 list-decimal space-y-1 pl-5">
                  {result.trace.map((step, index) => (
                    // a trace is ordered and static
                    <li key={index}>
                      <span className="font-medium">{step.node || "node"}</span>
                      <code className="ml-1 break-all text-[11px] text-muted-foreground">
                        {JSON.stringify(step.output)}
                      </code>
                    </li>
                  ))}
                </ol>
              </details>
            </>
          )}
          {!error && !result && (
            <p className="text-xs text-muted-foreground">Run the rule to see the answer here.</p>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={run}
        disabled={running || !entity || entityFields.length === 0}
        className="mt-2 flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
      >
        <Play className="h-3.5 w-3.5" />
        {running ? "Running…" : "Run the rule"}
      </button>
    </section>
  );
}
