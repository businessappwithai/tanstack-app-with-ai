import { AlertCircle, Code2, GripHorizontal } from "lucide-react";
import { lazy, Suspense, useCallback, useMemo, useState } from "react";

// Gorules JDM editor bundles monaco-editor which cannot run in SSR —
// lazy-load so it only resolves in the browser.
const GoRulesEditorPanel = lazy(() =>
  import("./GoRulesEditorPanel").then((m) => ({ default: m.GoRulesEditorPanel }))
);

import {
  type DecisionTable,
  emptyDecisionTable,
  tableToEmlFlowchart,
  validateDecisionTable,
} from "../../lib/eml/decision-table";
import type { RuleDryRun } from "../../lib/eml/dry-run-types";
import { convertFlowchartToTable } from "../../lib/eml/flowchart-to-table";
import { sampleRecord, tableToGraph } from "../../lib/eml/rule-templates";
import { RuleTryIt } from "./RuleTryIt";

/**
 * One business rule — shown as a decision table, matching the rule editor in
 * the generated admin application so both surfaces look and behave identically.
 */

export const RULE_EVENTS = [
  "beforeCreate",
  "afterCreate",
  "beforeUpdate",
  "afterUpdate",
  "beforeDelete",
  "customValidate",
] as const;

export interface EditableRule {
  /** Stable across renames, so React keeps the row it is editing. */
  key: string;
  name: string;
  entity: string;
  event: string;
  priority?: number;
  title?: string;
  table: DecisionTable;
  /**
   * Serialised `DecisionGraphType` JSON (nodes + edges) produced by the full
   * JDM graph editor. When set, the graph editor is shown instead of the table
   * editor, and the save path writes `%%jdm-graph` instead of `%%decision-table`.
   */
  jdmGraph?: string;
  /**
   * The rule's original Mermaid, kept verbatim when it is not a decision table
   * this editor wrote — a hand-authored `%%rule` flowchart, as every checked-in
   * example model uses. `table` holds a blank table in that case, and saving
   * would otherwise replace real branching logic with it. While this is set the
   * editor shows the source read-only and the save path writes it back
   * untouched; converting clears it and hands the rule to the table editor.
   */
  sourceFlowchart?: string;
  /**
   * How the rule is stored, which decides what the editor can write back.
   * `actions` means the table was compiled from `%%action` directives and a
   * save regenerates them; `decision-table` means it is the editor's own
   * directive; `flowchart` means the rule is only a Mermaid diagram.
   */
  sourceKind?: "actions" | "decision-table" | "flowchart";
  /**
   * The rule's name in the model when it was loaded. Kept because a rename here
   * must not change the `%%action` names already written under the old rule.
   */
  sourceRuleName?: string;
}

export function slugifyRuleName(value: string): string {
  // A name that is already an identifier is kept as written. Flattening `invoiceControl` to
  // `invoicecontrol` renamed every model rule that was saved, and a process looks a rule up by
  // its name.
  const identifier = value.trim();
  if (/^[a-z][A-Za-z0-9]*$/.test(identifier)) return identifier;
  const cleaned = value
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .map((word, index) =>
      index === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    )
    .join("");
  return cleaned || "rule";
}

export interface RuleEditorProps {
  rule: EditableRule;
  entities: Array<{ name: string; attributes: string[] }>;
  /** How this host runs a rule against a sample record (Try it and the Simulator). */
  dryRun: RuleDryRun;
  onChange: (patch: Partial<EditableRule>) => void;
  onError: (message: string | null) => void;
  /**
   * Show an authored flowchart as the decision table it describes, when it
   * reads as one, instead of the read-only Mermaid source. Off by default so
   * the Logic step converts only on request; the enhance page turns it on to
   * match the generated application's rule editor.
   */
  autoConvertFlowchart?: boolean;
  /** Enum values for the selected entity's fields, keyed by bare field name. */
  entityEnums?: Record<string, string[]>;
  /** Processes defined for the rule's entity — all an answer may start. */
  entityWorkflows?: string[];
  /** Each field's JSON type, so the editor can complete and check what is written. */
  fieldTypes?: Record<string, "string" | "number" | "boolean">;
  /**
   * Offer the Priority field. A host whose store has nowhere to keep one (a running application
   * orders nothing by it) turns it off rather than show a field that forgets.
   */
  showPriority?: boolean;
}

const TOTAL_HEIGHT = 880;
const MIN_GRAPH = 300;
const MIN_TRY_IT = 180;
const HANDLE_HEIGHT = 10;

export function RuleEditor({
  rule,
  entities,
  onChange,
  autoConvertFlowchart = true,
  entityEnums = {},
  entityWorkflows = [],
  fieldTypes,
  showPriority = true,
  dryRun,
}: RuleEditorProps) {
  const [showSource, setShowSource] = useState(false);
  const [graphHeight, setGraphHeight] = useState(640);
  const tryItHeight = TOTAL_HEIGHT - HANDLE_HEIGHT - graphHeight;

  const startDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startGraph = graphHeight;
      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientY - startY;
        const next = Math.max(
          MIN_GRAPH,
          Math.min(TOTAL_HEIGHT - HANDLE_HEIGHT - MIN_TRY_IT, startGraph + delta)
        );
        setGraphHeight(next);
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
      };
      document.body.style.cursor = "row-resize";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [graphHeight]
  );

  const MAX_GRAPH = TOTAL_HEIGHT - HANDLE_HEIGHT - MIN_TRY_IT;
  /** The handle is a focusable separator, so the keyboard resizes it too: ↑ and ↓, 40px a press. */
  const resizeByKey = (e: React.KeyboardEvent) => {
    const step = e.key === "ArrowUp" ? -40 : e.key === "ArrowDown" ? 40 : 0;
    if (!step) return;
    e.preventDefault();
    setGraphHeight((h) => Math.max(MIN_GRAPH, Math.min(MAX_GRAPH, h + step)));
  };
  const entityFields = useMemo(
    () => entities.find((e) => e.name === rule.entity)?.attributes ?? [],
    [entities, rule.entity]
  );
  // When the project model hasn't loaded yet, `entityFields` is empty but
  // `fieldTypes` (from the EML constraints API) already has the field names as
  // keys — use that as a fallback so the simulator opens with real field values
  // rather than an empty object that renders as null in the trace.
  const sampleFields = useMemo(
    () => (entityFields.length > 0 ? entityFields : Object.keys(fieldTypes ?? {})),
    [entityFields, fieldTypes]
  );
  // Whether the authored flowchart can be read as a table, worked out once so
  // the editor can show it and the banner can say which it is rather than
  // warning about both.
  const conversion = useMemo(
    () => convertFlowchartToTable(rule.sourceFlowchart ?? "", entityFields),
    [rule.sourceFlowchart, entityFields]
  );

  /**
   * The table the editor shows.
   *
   * A table compiled from `%%action` or read from a `%%decision-table` directive
   * is shown directly. A rule that is only a flowchart has no table of its own,
   * so it opens read-only — or, with `autoConvertFlowchart`, as the table it
   * describes when one can be read out of it. The original Mermaid stays behind
   * "Show EML".
   */
  const showModelTable = rule.sourceKind === "actions" || rule.sourceKind === "decision-table";
  const authoredFlowchart = !showModelTable && !!rule.sourceFlowchart;
  const table = authoredFlowchart
    ? autoConvertFlowchart && conversion.ok
      ? conversion.table
      : null
    : rule.table;

  // Once the rule is a graph, the table it started from is no longer its content, and
  // checking it reported an empty "Input reads no field" for a rule that was complete.
  const problems = useMemo(
    () => (table && !rule.jdmGraph ? validateDecisionTable(table) : []),
    [table, rule.jdmGraph]
  );
  return (
    <>
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium">Name</span>
          <input
            className="w-full rounded-md border border-border px-2 py-1.5 text-sm"
            value={rule.title ?? rule.name}
            onChange={(event) =>
              onChange({ title: event.target.value, name: slugifyRuleName(event.target.value) })
            }
            placeholder="Sample expiry guard"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium">Entity</span>
          <select
            className="w-full rounded-md border border-border px-2 py-1.5 text-sm"
            value={rule.entity}
            onChange={(event) => onChange({ entity: event.target.value })}
          >
            <option value="">Choose…</option>
            {entities.map((entity) => (
              <option key={entity.name} value={entity.name}>
                {entity.name}
              </option>
            ))}
          </select>
        </label>

        {showPriority && (
          <label className="block">
            <span className="mb-1 block text-xs font-medium">Priority</span>
            <input
              type="number"
              step={1}
              className="w-full rounded-md border border-border px-2 py-1.5 text-sm"
              value={rule.priority ?? 100}
              // Both runtimes store it as an integer; 2.5 would be rounded silently.
              onChange={(event) =>
                onChange({ priority: Math.trunc(Number(event.target.value)) || 0 })
              }
            />
          </label>
        )}
      </div>

      {table ? (
        <>
          {authoredFlowchart && (
            <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <p>
                This rule came from your model as a flowchart. It is shown here as the decision
                table it describes; editing it will save that table. The Mermaid is unchanged until
                then — open "Show EML" to read it.
              </p>
              {conversion.ok && conversion.notes.length > 0 && (
                <ul className="mt-1 list-disc pl-4">
                  {conversion.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <Suspense
            fallback={
              <div className="py-8 text-center text-sm text-muted-foreground">Loading editor…</div>
            }
          >
            <GoRulesEditorPanel
              jdmGraph={rule.jdmGraph}
              table={table}
              entityFields={sampleFields}
              entityEnums={entityEnums}
              entityWorkflows={entityWorkflows}
              fieldTypes={fieldTypes}
              ruleName={slugifyRuleName(rule.title ?? rule.name)}
              entity={rule.entity}
              dryRun={dryRun}
              height={graphHeight}
              fieldsLoading={sampleFields.length === 0}
              sampleRecord={JSON.stringify(
                sampleRecord(sampleFields, entityEnums, fieldTypes),
                null,
                2
              )}
              onChange={(graphJson) =>
                onChange({ jdmGraph: graphJson, sourceFlowchart: undefined })
              }
            />
          </Suspense>
          {/* Drag handle — drag up to grow the try-it panel, down to shrink it */}
          <div
            role="separator"
            tabIndex={0}
            aria-label="Resize simulator panel"
            aria-orientation="horizontal"
            aria-valuemin={MIN_GRAPH}
            aria-valuemax={MAX_GRAPH}
            aria-valuenow={graphHeight}
            onMouseDown={startDrag}
            onKeyDown={resizeByKey}
            className="mt-2 flex cursor-row-resize select-none items-center justify-center rounded border border-dashed border-border py-0.5 text-muted-foreground hover:border-primary hover:text-primary"
            style={{ height: HANDLE_HEIGHT }}
          >
            <GripHorizontal className="h-3.5 w-3.5" />
          </div>
          <RuleTryIt
            dryRun={dryRun}
            entity={rule.entity}
            entityFields={sampleFields}
            entityEnums={entityEnums}
            fieldTypes={fieldTypes}
            height={tryItHeight}
            getGraph={() =>
              rule.jdmGraph ??
              JSON.stringify(tableToGraph(table, slugifyRuleName(rule.title ?? rule.name)))
            }
          />
        </>
      ) : (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
          <div className="flex items-start gap-1.5 text-xs text-amber-900">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {conversion.ok ? (
              <p>
                This rule came from your model as a flowchart. It is saved exactly as it is here. It
                can also be read as a table of{" "}
                <strong>
                  {conversion.table.rules.length} row
                  {conversion.table.rules.length === 1 ? "" : "s"}
                </strong>{" "}
                that decides the same thing — convert it to edit it here.
              </p>
            ) : (
              <p>
                This rule came from your model as a flowchart, and it is saved exactly as it is
                here. It cannot be read as a table: {conversion.reason}
              </p>
            )}
          </div>

          <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-amber-200 bg-white/70 p-3 font-mono text-[11px] leading-relaxed">
            {rule.sourceFlowchart}
          </pre>

          {conversion.ok ? (
            <>
              {conversion.notes.map((note) => (
                <p key={note} className="mt-2 text-[11.5px] text-amber-900">
                  {note}
                </p>
              ))}
              <button
                type="button"
                onClick={() => onChange({ sourceFlowchart: undefined, table: conversion.table })}
                className="mt-2 rounded-md border border-amber-400 bg-white px-3 py-1.5 text-sm font-medium text-amber-900"
              >
                Convert to a decision table
              </button>
              <p className="mt-1.5 text-[11.5px] text-amber-900/80">
                Nothing is written until you save, and the table is shown before then.
              </p>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() =>
                  onChange({ sourceFlowchart: undefined, table: emptyDecisionTable() })
                }
                className="mt-2 rounded-md border border-amber-400 bg-white px-3 py-1.5 text-sm font-medium text-amber-900"
              >
                Start an empty table instead
              </button>
              <p className="mt-1.5 text-[11.5px] text-amber-900/80">
                This discards the flowchart above, so you would re-enter the logic by hand.
              </p>
            </>
          )}
        </div>
      )}

      {problems.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {problems.map((problem) => (
            <li key={problem} className="flex items-start gap-1.5">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              {problem}
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => setShowSource((current) => !current)}
        className="mt-3 flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium"
      >
        <Code2 className="h-3.5 w-3.5" />
        {showSource ? "Hide" : "Show"} EML
      </button>

      {showSource && (
        <pre className="mt-2 max-h-56 overflow-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
          {`%%rule ${slugifyRuleName(rule.title ?? rule.name)} on ${
            rule.entity || "<entity>"
          } event: ${rule.event} priority: ${rule.priority ?? 100}\n${
            rule.jdmGraph
              ? `%%jdm-graph ${rule.jdmGraph}`
              : (rule.sourceFlowchart ?? tableToEmlFlowchart(rule.table))
          }`}
        </pre>
      )}
    </>
  );
}
