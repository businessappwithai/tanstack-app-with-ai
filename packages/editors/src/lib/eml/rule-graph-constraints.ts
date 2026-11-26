/**
 * Hold a rule graph to what the model declares.
 *
 * The GoRules editor takes a column's allowed values from its `fieldType`: a
 * string column with an inline enum is a list the cell is picked from, in place
 * of free text. This sets that on every decision table in the graph, from the
 * entity's own constraints, and reports whatever the graph names that does not
 * exist — a field the entity lacks, a status its state machine never reaches, a
 * process nobody defined. The report is the part that reaches a check written
 * as an expression, which no column type can close.
 */

import type { RuleConstraints } from "./rule-constraints";

/** What a rule may answer. Starting a process is chosen in the workflow editor. */
export const ANSWERS = ["validation-error", "transform", "allow"] as const;

interface Column {
  id?: string;
  name?: string | null;
  field?: string | null;
  fieldType?: unknown;
  outputFieldType?: unknown;
}

interface TableContent {
  inputs?: Column[];
  outputs?: Column[];
  rules?: Array<Record<string, string | undefined>>;
}

interface GraphNode {
  id?: string;
  type?: string;
  name?: string;
  content?: unknown;
}

interface Graph {
  nodes?: GraphNode[];
  edges?: Array<{ sourceId?: string; targetId?: string }>;
}

const STOCK_IMPORT = /^[ \t]*import\s+zen\s+from\s+['"]zen['"];?[ \t]*\r?\n?/m;

/** The editor's starter source for a function node, minus the import it ships with. */
export function withoutStockImport(content: unknown): unknown {
  if (typeof content === "string") return content.replace(STOCK_IMPORT, "").replace(/^\s*\n/, "");
  if (
    content &&
    typeof content === "object" &&
    typeof (content as { source?: unknown }).source === "string"
  ) {
    const source = (content as { source: string }).source;
    return { ...content, source: source.replace(STOCK_IMPORT, "").replace(/^\s*\n/, "") };
  }
  return content;
}

const choices = (values: readonly string[]) => ({
  type: "string" as const,
  enum: {
    type: "inline" as const,
    values: values.map((value) => ({ label: value, value })),
  },
});

/** The values a column may hold, or null when it is free. */
function allowedFor(
  field: string,
  kind: "input" | "output",
  constraints: RuleConstraints
): readonly string[] | null {
  if (kind === "output") {
    if (field === "action") return ANSWERS;
    if (field === "workflowName") return constraints.workflowNames;
    if (field === "field") return constraints.fields;
  }
  return constraints.values[field] ?? null;
}

/** The same graph, with each constrained column typed as a pick-list. */
export function constrainGraph<G extends Graph>(graph: G, constraints: RuleConstraints): G {
  return {
    ...graph,
    nodes: (graph.nodes ?? []).map((node) => {
      // The node every rule starts from is the record being written, so it is
      // called that — the editor's own default name for it is "Request".
      if (node.type === "inputNode") {
        return !node.name || node.name === "Request" ? { ...node, name: "Record" } : node;
      }
      // A new function node opens with `import zen from 'zen'`, a line the
      // application's own check refuses (a function may not import), so a rule
      // saved from the editor's default body could never compile.
      if (node.type === "functionNode")
        return { ...node, content: withoutStockImport(node.content) };
      if (node.type !== "decisionTableNode") return node;
      const content = (node.content ?? {}) as TableContent;
      const type = (column: Column, kind: "input" | "output") => {
        const allowed = column.field ? allowedFor(column.field, kind, constraints) : null;
        return allowed ? choices(allowed) : undefined;
      };
      return {
        ...node,
        content: {
          ...content,
          inputs: (content.inputs ?? []).map((column) => {
            const fieldType = type(column, "input");
            return fieldType ? { ...column, fieldType } : column;
          }),
          outputs: (content.outputs ?? []).map((column) => {
            const outputFieldType = type(column, "output");
            return outputFieldType ? { ...column, outputFieldType } : column;
          }),
        },
      };
    }),
  };
}

const unquote = (cell: string) => cell.trim().replace(/^["']|["']$/g, "");

/**
 * The values a cell under a constrained column names.
 *
 * "Is one of" in the table writes `["cancelled","completed"]`, "is not one of"
 * and "not equals" write `not(...)`/`!=`, and a typed list is `"a","b"`. Reading
 * the whole cell as one value reported `["cancelled"]` as "not an existing
 * status" for a rule that named a real one.
 */
export function cellValues(cell: string): string[] {
  let text = cell.trim();
  const negated = /^not\s*\(([\s\S]*)\)$/.exec(text);
  if (negated) text = (negated[1] ?? "").trim();
  text = text.replace(/^(?:==|!=|=)\s*/, "");
  const list = /^\[([\s\S]*)\]$/.exec(text);
  if (list) text = (list[1] ?? "").trim();
  const values: string[] = [];
  let current = "";
  let quote = "";
  for (const char of text) {
    if (quote) {
      current += char;
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") {
      current += char;
      quote = char;
    } else if (char === ",") {
      values.push(current);
      current = "";
    } else current += char;
  }
  values.push(current);
  return values.map(unquote).filter((value) => value !== "");
}

/**
 * The names a function's source hands on: the keys of every object it returns
 * (`return { ...input, score }`, `return { tier: "gold" }`) and every property it
 * sets on the record it was given (`input.score = 1`). Read, not run — a name
 * built at run time is not seen, which errs towards a warning, never a refusal.
 */
export function functionOutputs(content: unknown): string[] {
  const source =
    typeof content === "string"
      ? content
      : typeof (content as { source?: unknown } | null)?.source === "string"
        ? (content as { source: string }).source
        : "";
  const names = new Set<string>();
  for (const block of source.matchAll(/return\s*\{([^{}]*)\}/g)) {
    for (const part of (block[1] ?? "").split(",")) {
      const entry = part.trim();
      if (!entry || entry.startsWith("...")) continue;
      const name = /^["']?([A-Za-z_$][\w$]*)["']?\s*(?::|$)/.exec(entry)?.[1];
      if (name) names.add(name);
    }
  }
  for (const m of source.matchAll(/\b(?:input|output|result)\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)) {
    names.add(m[1]!);
  }
  return [...names];
}

/** The names one node adds to what flows on: an expression's keys, a table's outputs, a function's returns. */
function producedBy(node: GraphNode): string[] {
  if (node.type === "expressionNode") {
    const rows = ((node.content ?? {}) as { expressions?: Array<{ key?: string }> }).expressions;
    return (rows ?? []).map((row) => (row.key ?? "").trim()).filter(Boolean);
  }
  if (node.type === "decisionTableNode") {
    return (((node.content ?? {}) as TableContent).outputs ?? [])
      .map((column) => (column.field ?? "").trim())
      .filter(Boolean);
  }
  if (node.type === "functionNode") return functionOutputs(node.content);
  return [];
}

/**
 * The names a node can read besides the record's own fields: whatever the nodes
 * before it produced. Found by walking the graph's lines backwards, so a value a
 * later node works out is still unknown here — as it is to the engine.
 */
export function derivedNamesBefore(graph: Graph, nodeId: string | undefined): Set<string> {
  const names = new Set<string>();
  if (!nodeId) return names;
  const byId = new Map((graph.nodes ?? []).map((node) => [node.id, node]));
  const seen = new Set<string>([nodeId]);
  const queue = [nodeId];
  while (queue.length > 0) {
    const target = queue.shift()!;
    for (const edge of graph.edges ?? []) {
      if (edge.targetId !== target || !edge.sourceId || seen.has(edge.sourceId)) continue;
      seen.add(edge.sourceId);
      queue.push(edge.sourceId);
      const source = byId.get(edge.sourceId);
      if (source) for (const name of producedBy(source)) names.add(name);
    }
  }
  return names;
}

/**
 * What the graph names that the model does not have.
 *
 * Reads the decision tables: a column's field, a cell under a constrained
 * column, and — for a whole-record check such as `status == "qualified"` — the
 * field and the value on either side of a comparison.
 */
export function graphProblems(graph: Graph, constraints: RuleConstraints): string[] {
  const problems = new Set<string>();
  const entityFields = new Set(constraints.fields);

  for (const node of graph.nodes ?? []) {
    if (node.type !== "decisionTableNode") continue;
    const content = (node.content ?? {}) as TableContent;
    // A table reads the record and whatever the nodes before it worked out: an
    // expression's keys, an earlier table's outputs, what a function returned.
    // Checking against the record alone called every one of those "not a field".
    const derived = derivedNamesBefore(graph, node.id);
    const fields = new Set([...entityFields, ...derived]);
    const columns = [
      ...(content.inputs ?? []).map((c) => ({ c, kind: "input" as const })),
      ...(content.outputs ?? []).map((c) => ({ c, kind: "output" as const })),
    ];

    for (const { c, kind } of columns) {
      if (kind === "input" && c.field && !fields.has(c.field)) {
        problems.add(`"${c.field}" is not a field of this entity.`);
      }
      const allowed = c.field ? allowedFor(c.field, kind, constraints) : null;
      if (!c.id || !c.field || !allowed) continue;
      for (const row of content.rules ?? []) {
        const cell = row[c.id];
        if (!cell || !cell.trim()) continue;
        for (const value of cellValues(cell)) {
          // zen's null-check cells ("null", "!= null") are always valid — they
          // mean "field is null / is not null", not the string literal "null".
          if (value === "null") continue;
          if (c.field === "action" && value === "trigger-workflow") {
            problems.add(
              "A rule cannot start a workflow — attach the rule to the workflow in the workflow editor."
            );
          } else if (!allowed.includes(value)) {
            const what = c.field === "workflowName" ? "process" : c.field;
            problems.add(`"${value}" is not an existing ${what} for this entity.`);
          }
        }
      }
    }

    // Whole-record checks: `status == "qualified"`, `amount > 10 and stage != "won"`.
    for (const row of content.rules ?? []) {
      for (const column of content.inputs ?? []) {
        if (column.field || !column.id) continue;
        const cell = row[column.id];
        if (!cell) continue;
        for (const m of cell.matchAll(
          /([A-Za-z_]\w*)\s*(?:==|!=|>=|<=|>|<)\s*("[^"]*"|'[^']*'|[^\s)]+)/g
        )) {
          const [, name, raw] = m as unknown as [string, string, string];
          if (!fields.has(name)) {
            problems.add(`"${name}" is not a field of this entity.`);
            continue;
          }
          const allowed = constraints.values[name];
          if (allowed && /^["']/.test(raw) && !allowed.includes(unquote(raw))) {
            problems.add(`"${unquote(raw)}" is not a ${name} this entity can have.`);
          }
        }
      }
    }
  }
  return [...problems];
}

export interface InputColumn {
  nodeId: string;
  nodeName: string;
  columnId: string;
  /** The field the column checks, or "" for a whole-record check. */
  field: string;
}

/** Every input column of every decision table in the graph. */
export function inputColumns(
  graph: Graph & { nodes?: Array<GraphNode & { id?: string }> }
): InputColumn[] {
  const columns: InputColumn[] = [];
  for (const node of graph.nodes ?? []) {
    if (node.type !== "decisionTableNode") continue;
    for (const column of ((node.content ?? {}) as TableContent).inputs ?? []) {
      columns.push({
        nodeId: node.id ?? "",
        nodeName: node.name ?? "Decision table",
        columnId: column.id ?? "",
        field: column.field ?? "",
      });
    }
  }
  return columns;
}

/**
 * Point an input column at a field, or add a column for one. A column that was a
 * whole-record check loses its cells: they were written against the whole
 * record, and under a single field they would mean something else.
 */
export function setInputField<G extends Graph>(
  graph: G,
  nodeId: string,
  columnId: string | null,
  field: string
): G {
  return {
    ...graph,
    nodes: (graph.nodes ?? []).map((node) => {
      if ((node as GraphNode & { id?: string }).id !== nodeId) return node;
      const content = (node.content ?? {}) as TableContent;
      if (columnId === null) {
        const id = `in_${Math.random().toString(36).slice(2, 8)}`;
        return {
          ...node,
          content: { ...content, inputs: [...(content.inputs ?? []), { id, name: field, field }] },
        };
      }
      const previous = (content.inputs ?? []).find((c) => c.id === columnId);
      const wasWholeRecord = !previous?.field;
      return {
        ...node,
        content: {
          ...content,
          inputs: (content.inputs ?? []).map((c) =>
            c.id === columnId ? { ...c, field, name: field, fieldType: undefined } : c
          ),
          rules: wasWholeRecord
            ? (content.rules ?? []).map((row) => ({ ...row, [columnId]: "" }))
            : content.rules,
        },
      };
    }),
  };
}
