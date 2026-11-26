import "../../lib/dayjs-plugins";
import "../../lib/monaco-local";
import "@gorules/jdm-editor/dist/style.css";
import {
  DecisionGraph,
  type DecisionGraphType,
  type DictionaryMap,
  GraphSimulator,
  JdmConfigProvider,
  type JdmUiMode,
  nodeSpecification,
  type Simulation,
  type SimulationTrace,
} from "@gorules/jdm-editor";
import { Play } from "lucide-react";
import { useMemo, useState } from "react";
import type { DecisionTable as InternalDecisionTable } from "../../lib/eml/decision-table";
import type { RuleDryRun } from "../../lib/eml/dry-run-types";
import type { RuleConstraints } from "../../lib/eml/rule-constraints";
import {
  constrainGraph,
  graphProblems,
  inputColumns,
  setInputField,
  withoutStockImport,
} from "../../lib/eml/rule-graph-constraints";
import { withNodePositions } from "../../lib/eml/graph-layout";
import { tableToGraph } from "../../lib/eml/rule-templates";

interface GoRulesEditorPanelProps {
  /** Serialised DecisionGraphType JSON, if the rule was already saved as a graph. */
  jdmGraph?: string;
  table: InternalDecisionTable;
  entityFields: string[];
  /** Enum values for entity fields, keyed by bare field name. */
  entityEnums?: Record<string, string[]>;
  /** Processes defined for the entity — all that an answer naming one may pick from. */
  entityWorkflows?: string[];
  /** Each field's JSON type, for the request schema. */
  fieldTypes?: Record<string, "string" | "number" | "boolean">;
  /** Human-readable rule name used for the initial decision table node label. */
  ruleName?: string;
  /** The entity and a starting record, for the editor's own simulator. */
  entity: string;
  /** How the Simulator reaches the server that runs the rule. */
  dryRun: RuleDryRun;
  sampleRecord: string;
  onChange: (graphJson: string) => void;
  /** Height of the graph canvas in pixels. Defaults to 640. */
  height?: number;
  /** When true, the entity's fields haven't loaded yet — Run is disabled. */
  fieldsLoading?: boolean;
}

/**
 * What a rule may answer. There is no "start a workflow" here: a rule decides,
 * and which workflow it belongs to is chosen in the workflow editor alone.
 */
const ACTION_CHOICES: DictionaryMap = {
  action: [
    { label: "Validation Error (block write)", value: "validation-error" },
    { label: "Transform Field Value", value: "transform" },
    { label: "Allow (no action)", value: "" },
  ],
};

/**
 * The request node's schema, so the fields a check can look at are the entity's
 * own. The editor reads it for the field pickers and for its completion, and a
 * name outside it is flagged rather than accepted.
 */
function withRequestSchema(
  graph: DecisionGraphType,
  fields: string[],
  values: Record<string, string[]>,
  types: Record<string, "string" | "number" | "boolean">
): DecisionGraphType {
  if (fields.length === 0) return graph;
  const schema = JSON.stringify(
    {
      type: "object",
      properties: Object.fromEntries(
        fields.map((field) => [
          field,
          // null stays in the type union so the schema never rejects a blank field
          // arriving as null from the application.  It must NOT appear in the enum
          // list: the GoRules simulator renders enum fields as a dropdown and
          // defaults to the first null-able entry, so every field shows "null"
          // before the user touches anything.
          values[field]
            ? { type: ["string", "null"], enum: values[field] }
            : { type: [types[field] ?? "string", "null"] },
        ])
      ),
    },
    null,
    2
  );
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.type === "inputNode"
        ? { ...node, content: { ...(node.content as object), schema } }
        : node
    ),
  } as DecisionGraphType;
}

/**
 * Every rule starts from the record being written, not from a request, so the
 * editor's first node says "Record" — in the component palette, in the node
 * title, and on a node dragged out new. The library offers no prop for it: the
 * built-in components are not replaceable, only extendable, so its own
 * specification is renamed once, for this editor.
 */
const functionSpec = nodeSpecification.functionNode;
{
  const generate = functionSpec.generateNode;
  functionSpec.generateNode = (params) => {
    const node = generate(params);
    return { ...node, content: withoutStockImport(node.content) as typeof node.content };
  };
}

const inputSpec = nodeSpecification.inputNode;
if (inputSpec.displayName !== "Record") {
  const generate = inputSpec.generateNode;
  inputSpec.displayName = "Record";
  inputSpec.generateNode = (params) => ({ ...generate(params), name: "Record" });
}

const MODES: ReadonlyArray<{ id: JdmUiMode; label: string }> = [
  { id: "dev", label: "Developer" },
  { id: "business", label: "Business" },
];

/**
 * The GoRules decision-graph editor, with what it ships with: every node kind
 * (input, output, decision table, expression, function, switch), the graph
 * and the tabs for each node, Developer and Business views, and its simulator
 * panel with a per-run result. The simulator runs the same compiled rule the
 * application runs, through the dry-run route, and nothing is saved.
 */
export function GoRulesEditorPanel({
  jdmGraph,
  table,
  entityFields,
  entityEnums = {},
  entityWorkflows = [],
  fieldTypes = {},
  ruleName = "Decision",
  entity,
  dryRun,
  sampleRecord,
  onChange,
  height = 640,
  fieldsLoading = false,
}: GoRulesEditorPanelProps) {
  const [mode, setMode] = useState<JdmUiMode>("business");
  const [simulate, setSimulate] = useState<Simulation | undefined>();
  const [running, setRunning] = useState(false);

  const constraints = useMemo<RuleConstraints>(
    () => ({ fields: entityFields, values: entityEnums, workflowNames: entityWorkflows }),
    [entityFields, entityEnums, entityWorkflows]
  );

  const graphValue = useMemo<DecisionGraphType>(() => {
    let graph: DecisionGraphType | null = null;
    if (jdmGraph) {
      try {
        graph = JSON.parse(jdmGraph) as DecisionGraphType;
      } catch {
        // fall through to conversion
      }
    }
    graph ??= tableToGraph(table, ruleName) as unknown as DecisionGraphType;
    // A graph compiled from a `%%rule` flowchart has no node positions, and the
    // canvas cannot draw a node without one (lib/eml/graph-layout.ts).
    graph = withNodePositions(graph);
    return withRequestSchema(
      constrainGraph(graph, constraints),
      entityFields,
      entityEnums,
      fieldTypes
    );
  }, [jdmGraph, table, ruleName, entityFields, entityEnums, fieldTypes, constraints]);

  const problems = useMemo(() => graphProblems(graphValue, constraints), [graphValue, constraints]);

  // Every choice the editor offers is something that exists: the answers a rule
  // may give, the values a field may hold (its enum, or its state machine's
  // states), and the processes defined for this entity. Nothing is free text
  // where the model already says what is allowed.
  const dictionaries = useMemo<DictionaryMap>(
    () => ({
      ...ACTION_CHOICES,
      ...Object.fromEntries(
        Object.entries(entityEnums).map(([field, values]) => [
          field,
          values.map((v) => ({ label: v, value: v })),
        ])
      ),
      workflowName: entityWorkflows.map((name) => ({ label: name, value: name })),
    }),
    [entityEnums, entityWorkflows]
  );

  /** Every edit passes through the model's constraints before it is kept. */
  const commit = (next: DecisionGraphType) =>
    onChange(JSON.stringify(constrainGraph(next, constraints)));

  const columns = useMemo(() => inputColumns(graphValue as never), [graphValue]);
  const tableIds = [...new Set(columns.map((column) => column.nodeId))];
  const inputCount = columns.filter((column) => column.nodeId === tableIds[0]).length;

  /**
   * Controls that live in the editor's own tab bar, so they are part of the
   * graph and not a strip above it: the fields each decision table reads, picked
   * from the entity's own fields, and the Developer / Business view.
   */
  const tabBarExtra = (
    <div className="flex items-center gap-2 pr-2 text-xs">
      {tableIds.map((nodeId) => {
        const mine = columns.filter((column) => column.nodeId === nodeId);
        const used = new Set(mine.map((column) => column.field));
        return (
          <div
            key={nodeId}
            role="group"
            aria-label={`Inputs of ${mine[0]?.nodeName}`}
            className="flex items-center gap-1"
          >
            <span className="font-medium">Inputs</span>
            {mine.map((column) => (
              <select
                key={column.columnId}
                aria-label={`Input field ${column.field || "whole record"}`}
                className="max-w-[9rem] rounded border border-border bg-background px-1 py-0.5 text-foreground"
                value={column.field}
                onChange={(e) =>
                  commit(setInputField(graphValue, nodeId, column.columnId, e.target.value))
                }
              >
                {column.field === "" && <option value="">Whole record (formula)</option>}
                {entityFields.map((field) => (
                  <option key={field} value={field}>
                    {field}
                  </option>
                ))}
              </select>
            ))}
            <select
              aria-label="Add an input field"
              className="max-w-[9rem] rounded border border-dashed border-border bg-background px-1 py-0.5 text-foreground"
              value=""
              onChange={(e) => {
                if (e.target.value) commit(setInputField(graphValue, nodeId, null, e.target.value));
              }}
            >
              <option value="">+ field…</option>
              {entityFields
                .filter((field) => !used.has(field))
                .map((field) => (
                  <option key={field} value={field}>
                    {field}
                  </option>
                ))}
            </select>
          </div>
        );
      })}
      <div
        role="group"
        aria-label="Editor view"
        className="flex shrink-0 overflow-hidden rounded border border-border font-medium"
      >
        {MODES.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            aria-pressed={mode === id}
            onClick={() => setMode(id)}
            className={`px-2 py-0.5 ${mode === id ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );

  const run = async ({ graph, context }: { graph: DecisionGraphType; context: unknown }) => {
    setRunning(true);
    try {
      const data = await dryRun({ graph, record: context as Record<string, unknown>, entity });
      if (!data.ok) {
        setSimulate({
          error: { title: "The rule did not run", message: data.problems.join(" "), data: {} },
        });
        return;
      }
      // One trace entry per node, so the Simulator can show what each produced.
      // The route reports them by node name, in the order they ran.
      const steps = [...data.trace];
      const trace: Record<string, SimulationTrace> = {};
      // Index nodes by id so edges can look up their source's output.
      const nodeById = Object.fromEntries(graph.nodes.map((n) => [n.id, n]));
      for (const node of graph.nodes) {
        const own = node.type === "inputNode" ? null : steps.findIndex((s) => s.node === node.name);
        const hit = own !== null && own >= 0 ? steps.splice(own, 1)[0] : undefined;
        if (node.type !== "inputNode" && !hit) continue;
        trace[node.id] = {
          id: node.id,
          name: node.name,
          input: node.type === "inputNode" ? context : null,
          output: node.type === "inputNode" ? context : hit?.output,
          performance: "",
          traceData: null,
        };
      }
      // Wire up each node's input from its upstream neighbour's output.
      // The dry-run route only returns outputs; the graph's edges tell us
      // which node fed which, so the Simulator's Input tab shows real data.
      for (const edge of graph.edges) {
        const target = nodeById[edge.targetId];
        if (!target || target.type === "inputNode") continue;
        const sourceEntry = trace[edge.sourceId];
        const targetEntry = trace[edge.targetId];
        if (sourceEntry && targetEntry && targetEntry.input === null) {
          targetEntry.input = sourceEntry.output;
        }
      }
      setSimulate({
        result: { performance: "", result: data.result, snapshot: graph, trace },
      });
    } catch (caught) {
      setSimulate({
        error: {
          title: "The rule did not run",
          message: caught instanceof Error ? caught.message : "Could not run the rule.",
          data: {},
        },
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="jdm-scope">
      {/* The editor's own provider renders an `.ant-app` that fills its parent's
          height. Inside a stretched flex column that made it as tall as the rail
          beside it and pushed everything under the editor off the screen. */}
      <style>{`
        .jdm-scope > .ant-app { height: auto !important; min-height: 0 !important; }
        /* An input is picked from the entity's fields in the editor's tab bar, not
           typed into the editor's own free-text field box. */
        .jdm-scope thead tr:first-child th:nth-child(2) .cta-wrapper { display: none; }
        .jdm-scope thead tr:nth-child(2) th:nth-child(n+3):nth-child(-n+${2 + inputCount}) .grl-field-edit {
          pointer-events: none;
        }
      `}</style>
      <JdmConfigProvider>
        <div className="overflow-hidden rounded-xl border border-border" style={{ height }}>
          <DecisionGraph
            value={graphValue}
            onChange={(next) => commit(next)}
            dictionaries={dictionaries}
            mode={mode}
            tabBarExtraContent={tabBarExtra}
            name={ruleName}
            simulate={simulate}
            // Open on the whole graph. A compiled rule is wider than the canvas,
            // and starting at 100% showed its first two nodes and nothing to say
            // there were twelve more to the right.
            onReactFlowInit={(instance) => {
              requestAnimationFrame(() => instance.fitView({ padding: 0.15, maxZoom: 1 }));
            }}
            panels={[
              {
                id: "simulator",
                title: "Simulator",
                icon: <Play className="h-4 w-4" />,
                renderPanel: () => (
                  <GraphSimulator
                    key={sampleRecord}
                    defaultRequest={sampleRecord}
                    loading={running || fieldsLoading}
                    onRun={run}
                    onClear={() => setSimulate(undefined)}
                  />
                ),
              },
            ]}
          />
        </div>
        {problems.length > 0 && (
          <ul
            aria-label="Names that do not exist"
            className="mt-2 space-y-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
          >
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
      </JdmConfigProvider>
    </div>
  );
}
