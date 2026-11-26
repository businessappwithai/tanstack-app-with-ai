/**
 * The rule editor of the generated application — the modelling tool's own.
 *
 * `GoRulesEditorPanel` and `RuleTryIt` are the files the Logic step runs,
 * byte for byte. What is this application's is what they are handed: the
 * fields, values and processes this model declares (`lib/rule-model.ts`, written
 * when it was generated) and the route that runs a rule (`POST /rules/simulate`).
 *
 * The panel draws with the GoRules editor and Monaco, which touch `window`, so
 * it is loaded in the browser only, after the first render.
 */

import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { RuleTryIt } from "@/editors/components/eml/RuleTryIt";
import { asDecisionTable } from "@/editors/lib/automation/rule-content";
import { simulateRule as dryRun } from "@/lib/logic-host";
import { sampleRecord } from "@/editors/lib/eml/rule-templates";
import { RULE_MODEL } from "@/lib/rule-model";

const GoRulesEditorPanel = lazy(() =>
  import("@/editors/components/eml/GoRulesEditorPanel").then((m) => ({ default: m.GoRulesEditorPanel }))
);

/** Graph nodes a plain decision table is made of; anything else is the author's own graph. */
const TABLE_ONLY = new Set(["inputNode", "outputNode", "decisionTableNode"]);

interface RuleGraphEditorProps {
  /** The table the rule is filed under, e.g. `bus_student`. */
  entityName: string;
  /** What the rule is called. */
  ruleName: string;
  /** The stored rule: a graph, or a bare decision table. Read once, when the editor opens. */
  initialContent: string;
  /** The columns the dictionary shows, for an entity the model does not describe. */
  fallbackFields?: string[];
  /** Every edit, as the graph's JSON. */
  onChange: (graphJson: string) => void;
}

/** The rule as a graph to open, when it is more than a table; otherwise as the table. */
function readContent(content: string): { jdmGraph?: string } {
  try {
    const parsed = JSON.parse(content) as { nodes?: Array<{ type?: string }> };
    if (Array.isArray(parsed?.nodes) && parsed.nodes.some((node) => !TABLE_ONLY.has(node.type ?? ""))) {
      return { jdmGraph: content };
    }
  } catch {
    // not JSON: open an empty table
  }
  return {};
}

export function RuleGraphEditor({
  entityName,
  ruleName,
  initialContent,
  fallbackFields = [],
  onChange,
}: RuleGraphEditorProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const entity = RULE_MODEL.find((candidate) => candidate.table === entityName);
  // Keyed by what the list says, not by the array: a parent that builds it on
  // every render would otherwise hand the editor "new" fields each time it
  // re-rendered, which redraws the graph under whatever the author has open.
  const fallbackKey = fallbackFields.join("\u0000");
  const fields = useMemo(
    () => (entity ? entity.fields.map((field) => field.name) : fallbackKey ? fallbackKey.split("\u0000") : []),
    [entity, fallbackKey]
  );
  const fieldTypes = useMemo(
    () => Object.fromEntries((entity?.fields ?? []).map((field) => [field.name, field.type])),
    [entity]
  );
  const values = useMemo(() => entity?.values ?? {}, [entity]);
  const processes = useMemo(() => entity?.processes ?? [], [entity]);
  const [seed] = useState(() => ({
    table: asDecisionTable(initialContent),
    graph: readContent(initialContent).jdmGraph,
  }));
  // The graph as the editor last drew it. It goes back into the panel on every
  // edit, as the Logic step does: the panel derives from it what it offers next —
  // the Record's schema on a Record just added, the fields a table may read, the
  // names that do not exist — and the Try-it panel runs it, saved or not.
  const [current, setCurrent] = useState<string | undefined>(seed.graph);

  if (!entityName) {
    return (
      <p className="px-6 py-8 text-sm text-muted-foreground">
        Choose the record type first: the editor offers only its fields.
      </p>
    );
  }
  if (!mounted) {
    return <div className="py-8 text-center text-sm text-muted-foreground">Loading editor…</div>;
  }

  return (
    <div className="p-4">
      <Suspense
        fallback={<div className="py-8 text-center text-sm text-muted-foreground">Loading editor…</div>}
      >
        <GoRulesEditorPanel
          jdmGraph={current}
          table={seed.table}
          entityFields={fields}
          entityEnums={values}
          entityWorkflows={processes}
          fieldTypes={fieldTypes}
          ruleName={ruleName}
          entity={entityName}
          dryRun={dryRun}
          sampleRecord={JSON.stringify(sampleRecord(fields, values, fieldTypes), null, 2)}
          onChange={(json) => {
            setCurrent(json);
            onChange(json);
          }}
        />
      </Suspense>
      <RuleTryIt
        entity={entityName}
        dryRun={dryRun}
        entityFields={fields}
        entityEnums={values}
        fieldTypes={fieldTypes}
        getGraph={() => current ?? initialContent}
      />
    </div>
  );
}
