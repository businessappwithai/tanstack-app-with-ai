/**
 * Business rules authored in EML.
 *
 * A `%%rule` section is a decision flowchart. These compile it to a GoRules JDM
 * decision graph — the same representation the generated application's rules
 * engine evaluates and its admin editor edits — so a rule drawn in the design
 * phase is the rule that runs.
 *
 * The flowchart parser and JDM converter live here rather than in the web app
 * because the generator is what consumes them; the web app re-exports these.
 */

export * from "./flowchart-parser";
export * from "./jdm-converter";

import type { EmlRuleSection } from "../eml";
import { parseMermaidFlowchart } from "./flowchart-parser";
import { convertToJdm, type JdmGraph } from "./jdm-converter";

/** A rule compiled from EML, ready to seed into `sys_rule_definitions`. */
export interface CompiledRule {
  /** Directive name, used as the seeded rule's identity. */
  name: string;
  /** Table the rule is bound to, e.g. `bus_sample`. */
  tableName: string;
  entity: string;
  /** Lifecycle event from the directive, e.g. `beforeCreate`. */
  event: string;
  /** CRUD operation the rules engine keys on: CREATE / UPDATE / DELETE / ALL. */
  operation: "CREATE" | "UPDATE" | "DELETE" | "ALL";
  priority: number;
  /** The JDM decision graph, serialised. */
  jdmContent: string;
}

/** Map a lifecycle event onto the operation the rules engine evaluates against. */
export function eventToOperation(event: string): CompiledRule["operation"] {
  const normalized = event.toLowerCase();
  if (normalized.includes("create")) return "CREATE";
  if (normalized.includes("update")) return "UPDATE";
  if (normalized.includes("delete")) return "DELETE";
  return "ALL";
}

/** `Sample` → `bus_sample`, matching the ERD's table naming. */
function toTableName(entity: string): string {
  const snake = entity
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
  return snake.startsWith("bus_") || snake.startsWith("sys_") ? snake : `bus_${snake}`;
}

/**
 * Compile the `%%rule` sections of a model into seedable JDM.
 *
 * A section whose flowchart cannot be parsed is skipped with a warning rather
 * than failing the build: one malformed rule should not stop an application
 * from being generated, and the checker already reports the syntax problem.
 */
/** A side-effecting action a rule emits, declared by a `%%action` directive. */
export interface CompiledRuleAction {
  name: string;
  type: string;
  /** Zen expression over the record; `true` fires on every write. */
  when: string;
  props: Record<string, string>;
}

/** `%%action <name> <type> when: <expr> <key>: <value> ...` */
const ACTION_DIRECTIVE = /^%%action\s+([A-Za-z_][\w-]*)\s+([A-Za-z][\w-]*)\s*(.*)$/;

/** `key:` starts a new property; the value runs to the next one. */
function parseActionProps(rest: string): Record<string, string> {
  const props: Record<string, string> = {};
  const trimmed = rest.trim();
  if (!trimmed) return props;
  for (const chunk of trimmed.split(/\s+(?=[A-Za-z_]\w*:)/)) {
    const at = chunk.indexOf(":");
    if (at <= 0) continue;
    const key = chunk.slice(0, at).trim();
    if (key) props[key] = chunk.slice(at + 1).trim();
  }
  return props;
}

export function parseRuleActions(flowchart: string): CompiledRuleAction[] {
  const actions: CompiledRuleAction[] = [];
  for (const rawLine of (flowchart ?? "").split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("%%action")) continue;
    const match = line.match(ACTION_DIRECTIVE);
    if (!match) continue;
    const [, name, type, rest] = match as unknown as [string, string, string, string];
    const props = parseActionProps(rest ?? "");
    const { when, ...others } = props;
    actions.push({ name, type, when: when?.trim() || "true", props: others });
  }
  return actions;
}

/** Quote a value for a zen decision-table output cell. */
function zenLiteral(value: string): string {
  return `'${value.replace(/'/g, "\\'")}'`;
}

/* -------------------------------------------------------------------------- */
/*  Decision tables authored in the editor                                      */
/* -------------------------------------------------------------------------- */

/**
 * The directive the application's decision-table editor writes.
 *
 * The editor emits a placeholder `Start --> End` flowchart and hangs the real
 * table off this comment so the model still parses as Mermaid. Without the
 * branch below, `parseMermaidFlowchart` saw only those two nodes and the rule
 * compiled to an input wired straight to an output — a rule that runs and
 * decides nothing.
 */
const DECISION_TABLE_DIRECTIVE = "%%decision-table ";

interface EditorDecisionTable {
  hitPolicy?: "first" | "collect";
  inputs?: Array<{ id: string; name?: string; field?: string }>;
  outputs?: Array<{ id: string; name?: string; field?: string }>;
  rules?: Array<Record<string, string>>;
}

export function parseDecisionTableDirective(flowchart: string): EditorDecisionTable | null {
  const line = (flowchart ?? "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith(DECISION_TABLE_DIRECTIVE));
  if (!line) return null;
  try {
    const parsed = JSON.parse(line.slice(DECISION_TABLE_DIRECTIVE.length)) as EditorDecisionTable;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/*  Whole decision graphs authored in the graph editor                          */
/* -------------------------------------------------------------------------- */

/**
 * The directive the Enhance page's graph editor writes: one line of JSON holding
 * the editor's whole graph — input, decision-table, expression, function and
 * switch nodes plus the edges between them.
 *
 * Nothing compiled this line. The rule fell through to the flowchart branch and
 * became an inert input-to-output graph, so a function or switch node an author
 * drew saved, reloaded and never ran. Anchored at `^%%` like every directive.
 */
const JDM_GRAPH_DIRECTIVE = "%%jdm-graph ";

const GRAPH_NODE_TYPES = new Set([
  "inputNode",
  "outputNode",
  "decisionTableNode",
  "expressionNode",
  "functionNode",
  "switchNode",
]);

/** Source the zen function sandbox must never be handed. */
const FORBIDDEN_FUNCTION_SOURCE = /\b(?:import|require|fetch|eval|process|globalThis)\b/;

export function parseJdmGraphDirective(flowchart: string): JdmGraph | null {
  const line = (flowchart ?? "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith(JDM_GRAPH_DIRECTIVE));
  if (!line) return null;
  try {
    const parsed = JSON.parse(line.slice(JDM_GRAPH_DIRECTIVE.length)) as JdmGraph;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** Why a graph cannot run, one sentence each; empty when it can. */
export function validateJdmGraph(graph: JdmGraph): string[] {
  const problems: string[] = [];
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  const ids = new Set<string>();

  if (!nodes.length) return ["the graph has no nodes"];
  for (const node of nodes as unknown as Array<Record<string, unknown>>) {
    const label = String(node.name ?? node.id);
    ids.add(String(node.id));
    if (typeof node.type !== "string" || !GRAPH_NODE_TYPES.has(node.type)) {
      problems.push(`node "${label}" has an unsupported type "${String(node.type)}"`);
      continue;
    }
    if (node.type === "inputNode" || node.type === "outputNode") continue;
    if (node.content === undefined || node.content === null) {
      problems.push(`${node.type} "${label}" has no content, so the engine would reject it`);
    }
    if (node.type === "functionNode") {
      const content = node.content;
      const source =
        typeof content === "string"
          ? content
          : typeof (content as { source?: unknown } | null)?.source === "string"
            ? (content as { source: string }).source
            : "";
      if (!/\bhandler\b/.test(source)) {
        problems.push(
          `functionNode "${label}" defines no handler; write export const handler = async (input) => ({ ... })`
        );
      }
      if (FORBIDDEN_FUNCTION_SOURCE.test(source)) {
        problems.push(
          `functionNode "${label}" uses import, require, fetch, eval, process or globalThis, which the sandbox does not allow`
        );
      }
    }
  }
  if (!nodes.some((n) => n.type === "inputNode")) problems.push("the graph has no input node");
  if (!nodes.some((n) => n.type === "outputNode")) problems.push("the graph has no output node");
  for (const edge of edges as unknown as Array<Record<string, unknown>>) {
    if (!ids.has(String(edge.sourceId)) || !ids.has(String(edge.targetId))) {
      problems.push(`edge "${String(edge.id)}" joins a node that is not in the graph`);
    }
  }
  return problems;
}

/**
 * Speak the runtime's vocabulary in a graph's decision-table cells.
 *
 * The editor's authors are told `validation-error` blocks a write (that is EML's
 * word, and the one the table editor shows); the runtime refuses on `prevent`.
 * A cell left in EML's word matched, was handed to the engine and was dropped.
 * Function and expression nodes are the author's own code and are not rewritten.
 */
export function normalizeGraphActions(graph: JdmGraph): JdmGraph {
  const rewrite = (cell: unknown): unknown =>
    typeof cell === "string" ? cell.replace(/(["'])validation-error\1/g, "$1prevent$1") : cell;
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const content = (node as { content?: unknown }).content;
      // zen 0.54 runs a function node only from `{ source }`. A bare string with
      // `export` is refused and one without it returns {} — a function that
      // saves, loads and silently decides nothing.
      if (node.type === ("functionNode" as string) && typeof content === "string") {
        return { ...node, content: { source: content } } as unknown as typeof node;
      }
      const table = content as
        | {
            rules?: Array<Record<string, unknown>>;
            inputs?: Array<{ id: string; name?: string; field?: string }>;
            outputs?: Array<{ id: string; name?: string; field?: string }>;
          }
        | undefined;
      if (node.type !== ("decisionTableNode" as string) || !Array.isArray(table?.rules)) {
        return node;
      }
      // Mirror buildEditorDecisionTable: drop input/output columns with no field
      // binding — the zen engine rejects an empty-field input as "invalid JDM
      // structure", and an empty-field output can never carry a value.
      const inputs = (table.inputs ?? []).filter((col) => (col.field ?? "").trim() !== "");
      const outputs = (table.outputs ?? []).map((col) => ({
        ...col,
        // When an output column's field is empty, fall back to its name —
        // matching RuleTableEditor's col.field || col.name pattern so the
        // zen engine can find the value to write into the output object.
        field: col.field || col.name || col.id,
      }));
      const inputIds = new Set(inputs.map((column) => column.id));
      const outputIds = new Set(outputs.map((column) => column.id));
      return {
        ...node,
        content: withTransformData({
          ...table,
          inputs,
          outputs,
          rules: table.rules.map((row) =>
            Object.fromEntries(
              Object.entries(row).map(([key, cell]) => [
                key,
                inputIds.has(key)
                  ? emptyMeansBlank(rewrite(cell))
                  : outputIds.has(key)
                    ? zenCell(rewrite(cell) as string | undefined)
                    : rewrite(cell),
              ])
            )
          ),
        }),
      } as typeof node;
    }),
  };
}

/**
 * "Is empty" and "is not empty" in the table write `null` and `!= null`, which zen
 * reads strictly: a text field a person cleared arrives as `""`, matched neither.
 * Empty means null, absent *or* blank, so an input cell that says only that is widened
 * to say so. Numbers, booleans and dates are unaffected — none of them is ever `""`.
 */
export function emptyMeansBlank(cell: unknown): unknown {
  if (typeof cell !== "string") return cell;
  const text = cell.trim();
  if (text === "null") return 'null, ""';
  if (text === "!= null") return '!= null and != ""';
  return cell;
}

/** A zen string literal's text, or `null` when the cell is an expression. */
function literalText(cell: unknown): string | null {
  const match = String(cell ?? "")
    .trim()
    .match(/^(?:'(.*)'|"(.*)")$/s);
  return match ? (match[1] ?? match[2] ?? "") : null;
}

interface TableContent {
  inputs?: unknown[];
  outputs?: Array<{ id: string; name?: string; field?: string }>;
  rules?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

/**
 * Give a `transform` row the `transformData` the runtime reads.
 *
 * The table editor offers **Field** and **Value** columns for a transform, and
 * its help page tells the author to fill them. The runtime reads neither: it
 * applies one `transformData` object and logs "has no transformData — skipping"
 * otherwise, so a transform written exactly as documented did nothing. The
 * `%%action` path has translated this since ISSUE-005; the two editor paths
 * (the table and the graph) did not. The Field and Value columns stay, because
 * the editors show them.
 */
function withTransformData<T extends TableContent>(content: T): T {
  const outputs = content.outputs ?? [];
  const fieldColumn = outputs.find((column) => column.field === "field");
  const valueColumn = outputs.find((column) => column.field === "value");
  const actionColumn = outputs.find((column) => column.field === "action");
  if (
    !fieldColumn ||
    !valueColumn ||
    !actionColumn ||
    outputs.some((column) => column.field === "transformData")
  ) {
    return content;
  }
  const dataColumn = { id: "transformData-auto", name: "Transform Data", field: "transformData" };
  return {
    ...content,
    outputs: [...outputs, dataColumn],
    rules: (content.rules ?? []).map((row) => {
      const target = literalText(row[fieldColumn.id])?.trim();
      const isTransform = literalText(row[actionColumn.id])?.trim() === "transform";
      // Every row needs a cell in the new column — an empty one for a row that is not a
      // transform. zen skips a row that has no cell at all for an output column, so adding
      // the column only to transform rows made a table that mixed a refusal, a transform
      // and a catch-all answer for none of them: the refusal and the default never fired.
      if (!isTransform || !target) return { ...row, [dataColumn.id]: row[dataColumn.id] ?? "" };
      const value = literalText(row[valueColumn.id]) ?? String(row[valueColumn.id] ?? "");
      return { ...row, [dataColumn.id]: zenLiteral(JSON.stringify({ [target]: value })) };
    }),
  };
}

/** A cell that zen should read as a value rather than an identifier reference. */
function isBareLiteral(value: string): boolean {
  return (
    value === "true" ||
    value === "false" ||
    value === "null" ||
    (value !== "" && !Number.isNaN(Number(value)))
  );
}

function isQuoted(value: string): boolean {
  return (
    value.length >= 2 &&
    (value.startsWith("'") || value.startsWith('"')) &&
    value.endsWith(value[0] as string)
  );
}

/**
 * The editor stores what the user typed; zen evaluates expressions.
 *
 * An output of `validation-error` is a subtraction of two identifiers to zen,
 * and an input of `hot` is a reference to an undefined variable. Both have to
 * be quoted. Numbers, booleans and already-quoted cells are left alone.
 */
function zenCell(raw: string | undefined): string {
  const value = (raw ?? "").trim();
  if (value === "") return "";
  if (isQuoted(value) || isBareLiteral(value)) return value;
  return zenLiteral(value);
}

/**
 * Input cells may carry a leading comparison, matching the editor's own
 * evaluator. `>= 70` stays a unary comparison; a bare `hot` becomes `'hot'`;
 * an explicit `= hot` drops the operator, because zen reads a bare value as
 * equality and `= 'hot'` is not valid unary syntax.
 */
function zenInputCell(raw: string | undefined): string {
  const value = (raw ?? "").trim();
  if (value === "") return "";
  const match = value.match(/^(>=|<=|!=|=|>|<)\s*(.*)$/);
  if (!match) return emptyMeansBlank(zenCell(value)) as string;
  const [, operator, operand] = match as unknown as [string, string, string];
  const cell = zenCell(operand);
  if (!cell) return "";
  return emptyMeansBlank(operator === "=" ? cell : `${operator} ${cell}`) as string;
}

/**
 * Compile the editor's table into the one JDM shape the rules engine reads.
 *
 * Every declared column is written into every row: zen-engine yields no result
 * at all for a row with a missing cell, so an omitted column would silently
 * disable the whole rule.
 */
export function buildEditorDecisionTable(ruleName: string, table: EditorDecisionTable): JdmGraph {
  const inputs = (table.inputs ?? []).filter((column) => (column.field ?? "").trim() !== "");
  const outputs = (table.outputs ?? []).filter((column) => (column.field ?? "").trim() !== "");

  const rows = (table.rules ?? []).map((row, index) => {
    const compiled: Record<string, string> = { _id: row._id || `${ruleName}-${index + 1}` };
    for (const column of inputs) compiled[column.id] = zenInputCell(row[column.id]);
    for (const column of outputs) compiled[column.id] = zenCell(row[column.id]);
    return compiled;
  });

  const tableId = `${ruleName}-table`;
  return {
    nodes: [
      { id: "input", name: "Input", type: "inputNode" },
      {
        id: tableId,
        name: ruleName,
        type: "decisionTableNode",
        content: withTransformData({
          hitPolicy: table.hitPolicy === "collect" ? ("collect" as const) : ("first" as const),
          inputs: inputs.map((column) => ({
            id: column.id,
            name: column.name ?? column.id,
            field: column.field ?? "",
          })),
          outputs: outputs.map((column) => ({
            id: column.id,
            name: column.name ?? column.id,
            field: column.field ?? "",
          })),
          rules: rows,
        }),
      },
      { id: "output", name: "Output", type: "outputNode" },
    ],
    edges: [
      { id: "edge-1", sourceId: "input", targetId: tableId },
      { id: "edge-2", sourceId: tableId, targetId: "output" },
    ],
  };
}

/**
 * EML's action names, in the vocabulary the generated runtime reads.
 *
 * The runtime's action union (RuleAction['type'] in rules-engine.service.ts) is
 * the one the in-app rule editor already writes, and it is what decides what a
 * matched row *does*: `validate()` rejects a write on `prevent`, and
 * `executeMatchedActions()` acts on the SIDE_EFFECTING_ACTIONS list. EML spells
 * the same intent `validation-error`, which is in neither, so a compiled
 * `validation-error` row matched, was handed to both readers, and was dropped by
 * each in turn — a rule that refuses a write let every write through, silently.
 *
 * `transform` and `trigger-workflow` are already the runtime's own names.
 */
const RUNTIME_ACTION: Record<string, string> = {
  "validation-error": "prevent",
};

/**
 * A transform's target, as the runtime wants it.
 *
 * EML writes `field:` and `value:` as two properties; the runtime reads one
 * `transformData` object of column → value (a JSON string is accepted and
 * parsed). Emitting only the two separate columns left every transform with no
 * transformData, and the executor logged "has no transformData — skipping" for a
 * rule the author had written correctly.
 *
 * The `field`/`value` columns stay beside it: the decision-table editor shows
 * them, and dropping them would empty that view for every model-authored rule.
 */
function transformDataCell(action: CompiledRuleAction): string {
  const field = (action.props.field ?? "").trim();
  if (action.type !== "transform" || !field) return zenLiteral("");
  return zenLiteral(JSON.stringify({ [field]: action.props.value ?? "" }));
}

/**
 * A GoRules decision table, one row per `%%action`.
 *
 * The node-graph form a rules flowchart compiles to carries no outputs, so the
 * rules engine finds no actions in it and a model-declared rule can decide but
 * never act. A decision table is the shape the engine reads `action`,
 * `message`, `ruleId` and `workflowName` from, so a section that declares
 * actions is compiled as one.
 *
 * `hitPolicy: "collect"` because several rows may match one write — a rule that
 * escalates *and* stamps a field is ordinary.
 *
 * The `action` cell and a transform's payload are translated into the runtime's
 * own vocabulary rather than written in EML's — see RUNTIME_ACTION and the
 * `transformData` column below. Emitting the EML spelling made two of the three
 * shipped action types silently inert.
 */
export function buildActionDecisionTable(
  ruleName: string,
  actions: CompiledRuleAction[]
): JdmGraph {
  // Every declared output column has to appear in every row, blank when the
  // action does not use it. zen-engine yields *no result at all* for a row with
  // a missing cell — not a row with an empty field — so an omitted column made
  // the whole rule silently evaluate to nothing.
  const cells = [
    (action: CompiledRuleAction) => zenLiteral(RUNTIME_ACTION[action.type] ?? action.type),
    (action: CompiledRuleAction) =>
      zenLiteral(action.props.message ?? `${ruleName}: ${action.name}`),
    () => zenLiteral(ruleName),
    (action: CompiledRuleAction) => zenLiteral(action.props.workflow ?? ""),
    (action: CompiledRuleAction) => zenLiteral(action.props.field ?? ""),
    (action: CompiledRuleAction) => zenLiteral(action.props.value ?? ""),
    (action: CompiledRuleAction) => zenLiteral(action.props.targetEntity ?? ""),
    (action: CompiledRuleAction) => zenLiteral(action.props.linkField ?? ""),
    transformDataCell,
  ];

  const rows = actions.map((action) => {
    const row: Record<string, string> = {
      _id: `${ruleName}-${action.name}`,
      i1: action.when,
    };
    cells.forEach((cell, index) => {
      row[`o${index + 1}`] = cell(action);
    });
    return row;
  });

  return {
    nodes: [
      { id: "input", name: "Input", type: "inputNode" },
      {
        id: `${ruleName}-table`,
        name: ruleName,
        type: "decisionTableNode",
        content: {
          hitPolicy: "collect" as const,
          inputs: [{ id: "i1", name: "Record", field: "" }],
          outputs: [
            { id: "o1", name: "Action", field: "action" },
            { id: "o2", name: "Message", field: "message" },
            { id: "o3", name: "Rule ID", field: "ruleId" },
            { id: "o4", name: "Workflow Name", field: "workflowName" },
            { id: "o5", name: "Field", field: "field" },
            { id: "o6", name: "Value", field: "value" },
            { id: "o7", name: "Target Entity", field: "targetEntity" },
            { id: "o8", name: "Link Field", field: "linkField" },
            { id: "o9", name: "Transform Data", field: "transformData" },
          ],
          rules: rows,
        },
      },
      { id: "output", name: "Output", type: "outputNode" },
    ],
    edges: [
      { id: "edge-1", sourceId: "input", targetId: `${ruleName}-table` },
      { id: "edge-2", sourceId: `${ruleName}-table`, targetId: "output" },
    ],
  };
}

/* -------------------------------------------------------------------------- */
/*  Reading an edited table back into %%action                                  */
/* -------------------------------------------------------------------------- */

/**
 * The reverse of `RUNTIME_ACTION`: what the table editor shows, in EML's words.
 *
 * A table compiled from `%%action` carries the runtime's `prevent`; the model
 * it came from says `validation-error`. Writing the round trip back is how the
 * enhance page can edit a rule's actions without changing its meaning.
 */
const EML_ACTION: Record<string, string> = {
  prevent: "validation-error",
};

/** Cells the editor shows are zen literals: `'prevent'`. Read the text back. */
function unquoteCell(value: string | undefined): string {
  const text = (value ?? "").trim();
  if (
    text.length >= 2 &&
    (text.startsWith("'") || text.startsWith('"')) &&
    text.endsWith(text[0] as string)
  ) {
    return text.slice(1, -1).replace(/\\'/g, "'");
  }
  return text;
}

/** The cell a row carries for the output column with this field. */
function outputCell(
  table: EditorDecisionTable,
  row: Record<string, string>,
  field: string
): string {
  const column = (table.outputs ?? []).find(
    (candidate) => (candidate.field ?? "").trim() === field
  );
  return column ? unquoteCell(row[column.id]) : "";
}

/** `%%action` names are identifiers; the row's `_id` is the name to keep stable. */
function actionNameFromId(ruleName: string, id: string | undefined, index: number): string {
  const raw = (id ?? "").trim();
  // `buildActionDecisionTable` prefixes every row id with the rule name.
  const prefix = `${ruleName}-`;
  const withoutRule = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
  const cleaned = withoutRule.replace(/[^A-Za-z0-9_-]/g, "_");
  return /^[A-Za-z_]/.test(cleaned) && cleaned ? cleaned : `action${index + 1}`;
}

/**
 * The inverse of `buildActionDecisionTable`.
 *
 * The enhance page shows a model's `%%action` directives as the decision table
 * the generated application's rule editor uses. An edit made there has to land
 * back in the model as the directives the checker and compiler already read, so
 * each row is walked back to one `%%action` line: the input columns join into
 * `when:`, and the output cells become the action's properties.
 *
 * The runtime vocabulary is translated back to EML's — `prevent` is written
 * `validation-error` — so the round trip is the identity on an unedited model.
 */
export function serializeRuleActions(ruleName: string, table: EditorDecisionTable): string[] {
  return (table.rules ?? [])
    .map((row, index) => {
      const runtimeType = outputCell(table, row, "action");
      const type = EML_ACTION[runtimeType] ?? runtimeType;
      if (!type) return null;

      const whens = (table.inputs ?? [])
        .map((column) => unquoteCell(row[column.id]))
        .filter(Boolean);
      const when = whens.length ? whens.join(" and ") : "true";

      const name = actionNameFromId(ruleName, row._id, index);
      // `buildActionDecisionTable` invents a message for every row that has
      // none (`<rule>: <action>`). It is not part of the model, so reading it
      // back would add a property the author never wrote.
      const messageCell = outputCell(table, row, "message");
      const message = messageCell === `${ruleName}: ${name}` ? "" : messageCell;
      const workflow = outputCell(table, row, "workflowName");
      const field = outputCell(table, row, "field");
      const value = outputCell(table, row, "value");
      const targetEntity = outputCell(table, row, "targetEntity");
      const linkField = outputCell(table, row, "linkField");

      // Emitted in the order the model's own directives use, so re-saving an
      // untouched rule is a byte-for-byte no-op rather than a reordering.
      const props: Array<[string, string]> = [];
      if (workflow) props.push(["workflow", workflow]);
      if (message) props.push(["message", message]);
      if (field) props.push(["field", field]);
      if (value) props.push(["value", value]);
      if (targetEntity) props.push(["targetEntity", targetEntity]);
      if (linkField) props.push(["linkField", linkField]);

      // A compiled transform carries its payload in `transformData`; a table the
      // author typed may carry only that, so read the target back out of it.
      if (type === "transform" && !field) {
        const payload = outputCell(table, row, "transformData");
        if (payload) {
          try {
            const pair = Object.entries(JSON.parse(payload) as Record<string, unknown>)[0];
            if (pair) props.push(["field", pair[0]], ["value", String(pair[1])]);
          } catch {
            // Not JSON; leave the row without a target rather than guess one.
          }
        }
      }

      return [
        `%%action ${name} ${type} when: ${when}`,
        ...props.map(([key, val]) => `${key}: ${val}`),
      ].join(" ");
    })
    .filter((line): line is string => line !== null);
}

/**
 * Replace a rule body's `%%action` lines, leaving its flowchart untouched.
 *
 * The flowchart is the rule's visual; the compiler reads the actions when a
 * rule declares them. So editing the table must not rewrite the diagram the
 * author drew.
 */
export function replaceRuleActions(body: string, actionLines: string[]): string {
  const lines = (body ?? "").split("\n");
  const isAction = (line: string) => line.trim().startsWith("%%action");
  const first = lines.findIndex(isAction);

  // The rewritten actions go where the old ones were, at their indentation. A
  // rule's body runs to the next `%%rule`, so it can end in the prose that
  // introduces the next section — "%% ---- Business rules — the student
  // record". Appending after that moved this rule's actions under the next
  // rule's heading, which every reader then attributed to the wrong rule.
  if (first >= 0) {
    const indent = (lines[first] ?? "").match(/^\s*/)?.[0] ?? "";
    const before = lines.slice(0, first);
    const after = lines.slice(first).filter((line) => !isAction(line));
    return [...before, ...actionLines.map((line) => indent + line), ...after].join("\n");
  }

  // No actions yet: add them after the diagram, ahead of any trailing prose.
  const kept = [...lines];
  const trailing: string[] = [];
  while (kept.length) {
    const last = (kept[kept.length - 1] ?? "").trim();
    if (last && !last.startsWith("%%")) break;
    trailing.unshift(kept.pop() as string);
  }
  while (trailing.length && !(trailing[0] ?? "").trim()) trailing.shift();
  return [...kept, ...actionLines, ...(trailing.length ? ["", ...trailing] : [])].join("\n");
}

export function compileRules(
  sections: EmlRuleSection[],
  onWarn: (message: string) => void = () => {}
): CompiledRule[] {
  const compiled: CompiledRule[] = [];

  for (const section of sections) {
    if (!section.entity) {
      onWarn(`Rule "${section.name}" declares no entity; skipping.`);
      continue;
    }

    try {
      // A table authored in the editor carries its own directive and only a
      // placeholder flowchart, so it has to be read before the AST — compiling
      // the placeholder yields a rule that decides nothing.
      const editorTable = parseDecisionTableDirective(section.flowchart);
      const editorGraph = parseJdmGraphDirective(section.flowchart);
      if (editorGraph) {
        const problems = validateJdmGraph(editorGraph);
        if (problems.length) {
          onWarn(`Rule "${section.name}" has a graph that cannot run: ${problems.join("; ")}.`);
          continue;
        }
        compiled.push({
          name: section.name,
          entity: section.entity,
          tableName: toTableName(section.entity),
          event: section.event,
          operation: eventToOperation(section.event),
          priority: section.priority ?? 100,
          jdmContent: JSON.stringify(normalizeGraphActions(editorGraph)),
        });
        continue;
      }

      const ast = parseMermaidFlowchart(section.flowchart);
      if (!editorTable && !ast.nodes.size) {
        onWarn(`Rule "${section.name}" has no nodes; skipping.`);
        continue;
      }

      // A section that declares actions compiles to a decision table: that is
      // the only JDM shape the rules engine reads actions out of.
      const actions = parseRuleActions(section.flowchart);
      let jdm: JdmGraph;
      if (editorTable) {
        jdm = buildEditorDecisionTable(section.name, editorTable);
      } else if (actions.length) {
        jdm = buildActionDecisionTable(section.name, actions);
      } else {
        jdm = convertToJdm(ast);
      }
      compiled.push({
        name: section.name,
        entity: section.entity,
        tableName: toTableName(section.entity),
        event: section.event,
        operation: eventToOperation(section.event),
        priority: section.priority ?? 100,
        jdmContent: JSON.stringify(jdm),
      });
    } catch (error) {
      onWarn(
        `Rule "${section.name}" could not be compiled: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  return compiled;
}
