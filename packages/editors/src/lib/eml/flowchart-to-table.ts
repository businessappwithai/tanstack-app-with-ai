/**
 * Reading a hand-authored `%%rule` flowchart as a decision table.
 *
 * The rule editor can only edit tables it wrote itself, so every rule in the
 * checked-in example models opens read-only with an offer to convert that
 * threw the logic away and asked the author to retype it. Most of those rules
 * do not need retyping: a decision tree and a decision table say the same
 * thing, and the translation is mechanical.
 *
 * A tree becomes a table by walking every root-to-leaf path in order. Each
 * path is one row, carrying only the *positive* tests along it — under
 * `hitPolicy: "first"` the rows above already account for the negative
 * branches, which is how a person writes the table by hand. So
 *
 *     B{tier == strategic?} -->|Yes| C{type == incident?}
 *     C -->|Yes| D[Set priority critical]
 *     C -->|No|  E[Set priority high]
 *     B -->|No|  F[Set priority low]
 *
 * is three rows: (strategic, incident) → critical, (strategic) → high, and a
 * catch-all → low.
 *
 * What it will not do is guess. A leaf that does not state a field and a value
 * has no honest table cell, and `leadScoring` — which adds points across three
 * dimensions and grades the sum — is not a table at all, because a first-match
 * row cannot carry an accumulator. Those still open read-only, now saying which
 * leaf stopped the conversion rather than a blanket "branches are not carried
 * over".
 */

import {
  type DecisionColumn,
  type DecisionRow,
  type DecisionTable,
  newRowId,
} from "./decision-table";

/* -------------------------------------------------------------------------- */
/*  A very small flowchart reader                                              */
/* -------------------------------------------------------------------------- */

type Shape = "diamond" | "rect" | "stadium" | "circle" | "round";

interface Node {
  id: string;
  label: string;
  shape: Shape;
}

interface Edge {
  from: string;
  to: string;
  label?: string;
}

/**
 * Only what this conversion needs, so the client bundle does not have to pull
 * in `@appwithai/generator` — which is Node-only and externalised from it.
 */
export function readFlowchart(source: string): { nodes: Map<string, Node>; edges: Edge[] } {
  const nodes = new Map<string, Node>();
  const edges: Edge[] = [];

  const define = (id: string, body: string | undefined): void => {
    if (!body) {
      if (!nodes.has(id)) nodes.set(id, { id, label: id, shape: "rect" });
      return;
    }
    const shapes: Array<[RegExp, Shape]> = [
      [/^\(\[(.*)\]\)$/, "stadium"],
      [/^\(\((.*)\)\)$/, "circle"],
      [/^\{(.*)\}$/, "diamond"],
      [/^\[(.*)\]$/, "rect"],
      [/^\((.*)\)$/, "round"],
    ];
    for (const [pattern, shape] of shapes) {
      const match = body.match(pattern);
      if (match) {
        nodes.set(id, { id, label: (match[1] ?? "").trim(), shape });
        return;
      }
    }
    if (!nodes.has(id)) nodes.set(id, { id, label: id, shape: "rect" });
  };

  // `A[Label] -->|Yes| B{Other}` — the two node definitions and the edge label.
  const line =
    /^([A-Za-z_]\w*)\s*(\(\[.*?\]\)|\(\(.*?\)\)|\{.*?\}|\[.*?\]|\(.*?\))?\s*-->\s*(?:\|([^|]*)\|)?\s*([A-Za-z_]\w*)\s*(\(\[.*?\]\)|\(\(.*?\)\)|\{.*?\}|\[.*?\]|\(.*?\))?\s*$/;

  for (const raw of (source ?? "").split("\n")) {
    const text = raw.trim();
    if (!text || text.startsWith("%%") || /^flowchart\b/.test(text)) continue;

    const match = text.match(line);
    if (match) {
      const [, from, fromBody, edgeLabel, to, toBody] = match;
      define(from as string, fromBody);
      define(to as string, toBody);
      edges.push({ from: from as string, to: to as string, label: edgeLabel?.trim() });
      continue;
    }

    // A bare node definition on its own line.
    const alone = text.match(
      /^([A-Za-z_]\w*)\s*(\(\[.*?\]\)|\(\(.*?\)\)|\{.*?\}|\[.*?\]|\(.*?\))\s*$/
    );
    if (alone) define(alone[1] as string, alone[2]);
  }

  return { nodes, edges };
}

/* -------------------------------------------------------------------------- */
/*  Conditions                                                                 */
/* -------------------------------------------------------------------------- */

export interface ParsedCondition {
  field: string;
  /** Written the way the table editor writes it: an operator, or bare for `=`. */
  cell: string;
}

const OPERATORS = [">=", "<=", "!=", "==", "=", ">", "<"] as const;

/** `employee_count >= 1000?` → field `employee_count`, cell `>= 1000`. */
export function parseCondition(label: string): ParsedCondition | null {
  const text = label.trim().replace(/\?+$/, "").trim();
  if (!text) return null;

  for (const operator of OPERATORS) {
    const at = text.indexOf(operator);
    if (at <= 0) continue;
    const field = normalizeField(text.slice(0, at));
    const value = text.slice(at + operator.length).trim();
    if (!field || !value) return null;
    // `==` and `=` are equality, which the table writes as a bare value.
    const written = operator === "==" || operator === "=" ? value : `${operator} ${value}`;
    return { field, cell: written };
  }
  return null;
}

/** `account tier` and `Account Tier` both name the column `account_tier`. */
function normalizeField(raw: string): string {
  return raw
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

/* -------------------------------------------------------------------------- */
/*  Outcomes                                                                   */
/* -------------------------------------------------------------------------- */

export interface ParsedOutcome {
  /** Output field → cell value, e.g. `{ field: "rating", value: "hot" }`. */
  cells: Record<string, string>;
}

/**
 * The two leaf shapes that state what they do rather than describe it.
 *
 * `Set priority critical` names a field and a value. `Reject: <why>` is a
 * validation error carrying its message. Anything else — "Route to Partner
 * Desk", "Add 35 firmographic points" — is a description, and inventing a
 * field for it would put words in the author's mouth.
 */
export function parseOutcome(label: string): ParsedOutcome | null {
  const text = label.trim();

  const reject = text.match(/^(?:Reject|Block|Refuse)\s*[:\-—]\s*(.+)$/i);
  if (reject?.[1]) {
    return { cells: { action: "validation-error", message: reject[1].trim() } };
  }

  // `Set probability 100 and category closed` — more than one assignment.
  if (/^Set\s+/i.test(text)) {
    const cells: Record<string, string> = {};
    for (const clause of text.replace(/^Set\s+/i, "").split(/\s+and\s+/i)) {
      const pair = clause.trim().match(/^([A-Za-z][\w ]*?)\s+(?:to\s+)?([\w.'"-]+)$/);
      if (!pair?.[1] || !pair[2]) return null;
      cells[normalizeField(pair[1])] = pair[2].replace(/^['"]|['"]$/g, "");
    }
    return Object.keys(cells).length ? { cells } : null;
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/*  The walk                                                                   */
/* -------------------------------------------------------------------------- */

export type ConversionResult =
  | { ok: true; table: DecisionTable; notes: string[] }
  | { ok: false; reason: string };

const YES = /^(yes|y|true)$/i;
const NO = /^(no|n|false)$/i;

interface Branch {
  field: string;
  cell: string;
}

/**
 * Turn a rule's flowchart into a table, or say why it cannot be one.
 *
 * `knownFields` is the entity's columns. A test against something that is not
 * a column still converts — the author may be reading a joined value — but it
 * is reported, because a column the record does not have will never match.
 */
export function convertFlowchartToTable(
  flowchart: string,
  knownFields: string[] = []
): ConversionResult {
  const { nodes, edges } = readFlowchart(flowchart);
  if (!nodes.size) return { ok: false, reason: "There is no diagram here to read." };

  const outgoing = new Map<string, Edge[]>();
  for (const edge of edges) {
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge);
    outgoing.set(edge.from, list);
  }

  const start = findStart(nodes, edges);
  if (!start) return { ok: false, reason: "The diagram has no single starting point." };

  const firstDecision = walkToDecision(start, nodes, outgoing);
  if (!firstDecision) {
    return { ok: false, reason: "The diagram asks no questions, so there is nothing to tabulate." };
  }

  const inputOrder: string[] = [];
  const rows: Array<{ branches: Branch[]; cells: Record<string, string> }> = [];
  const outputOrder: string[] = [];
  let failure: string | null = null;
  /** Depth guard: a cycle would otherwise walk forever. */
  const visiting = new Set<string>();

  const visit = (nodeId: string, branches: Branch[]): void => {
    if (failure) return;
    if (visiting.has(nodeId)) {
      failure = "The diagram loops back on itself, which a table cannot express.";
      return;
    }

    const node = nodes.get(nodeId);
    if (!node) return;

    if (node.shape === "diamond") {
      const condition = parseCondition(node.label);
      if (!condition) {
        failure = `"${node.label}" is not a comparison this can read as a column and a value.`;
        return;
      }
      if (!inputOrder.includes(condition.field)) inputOrder.push(condition.field);

      const branchEdges = outgoing.get(nodeId) ?? [];
      const yes = branchEdges.find((e) => YES.test(e.label ?? ""));
      const no = branchEdges.find((e) => NO.test(e.label ?? ""));
      if (!yes || !no) {
        failure = `"${node.label}" does not have both a Yes and a No branch.`;
        return;
      }

      visiting.add(nodeId);
      // Yes first: the table is read top to bottom, and the positive branch is
      // the more specific one, so it has to be the earlier row.
      visit(yes.to, [...branches, { field: condition.field, cell: condition.cell }]);
      visit(no.to, branches);
      visiting.delete(nodeId);
      return;
    }

    // Not a question. Either it states an outcome, or the path runs on to one.
    const outcome = parseOutcome(node.label);
    if (outcome) {
      for (const key of Object.keys(outcome.cells)) {
        if (!outputOrder.includes(key)) outputOrder.push(key);
      }
      rows.push({ branches, cells: outcome.cells });
      return;
    }

    const next = outgoing.get(nodeId) ?? [];

    // Only a Start/End marker is allowed to be walked through. Following any
    // other unreadable node would drop what it does while keeping the tests
    // around it — which is how `leadScoring` first converted to 54 confident,
    // wrong rows: each `Add 35 firmographic points` vanished, leaving a
    // `score >= 70` test against a score nothing had computed.
    if (node.shape === "stadium") {
      if (next.length === 0) return;
      if (next.length === 1 && next[0]) {
        visiting.add(nodeId);
        visit(next[0].to, branches);
        visiting.delete(nodeId);
        return;
      }
    }

    failure =
      `"${node.label}" does not say which field it sets. ` +
      `A table row has to name a column and a value.`;
  };

  visit(firstDecision, []);

  if (failure) return { ok: false, reason: failure };
  if (!rows.length) return { ok: false, reason: "No outcome in the diagram could be read." };

  const inputs: DecisionColumn[] = inputOrder.map((field, index) => ({
    id: `i${index + 1}`,
    name: field,
    field,
  }));
  const outputs: DecisionColumn[] = outputOrder.map((field, index) => ({
    id: `o${index + 1}`,
    name: field,
    field,
  }));

  const tableRows: DecisionRow[] = rows.map((row) => {
    const cells: DecisionRow = { _id: newRowId() };
    for (const column of inputs) {
      cells[column.id] = row.branches.find((b) => b.field === column.field)?.cell ?? "";
    }
    for (const column of outputs) cells[column.id] = row.cells[column.field] ?? "";
    return cells;
  });

  const notes: string[] = [];
  const unknown = inputOrder.filter((field) => knownFields.length && !knownFields.includes(field));
  if (unknown.length) {
    notes.push(
      `${unknown.join(", ")} ${unknown.length === 1 ? "is not a column" : "are not columns"} on this entity — check the name before saving.`
    );
  }
  // No coverage note here on purpose. Every diamond is walked down both arms,
  // so the all-No path always ends at a leaf carrying no positive test — the
  // last row is a catch-all by construction, and a warning about it could
  // never fire.

  return {
    ok: true,
    notes,
    table: { hitPolicy: "first", inputs, outputs, rules: tableRows },
  };
}

/** The node nothing points at — the diagram's entry. */
function findStart(nodes: Map<string, Node>, edges: Edge[]): string | null {
  const targeted = new Set(edges.map((edge) => edge.to));
  const roots = [...nodes.keys()].filter((id) => !targeted.has(id));
  return roots.length === 1 ? (roots[0] as string) : (roots[0] ?? null);
}

/** Skip the Start marker and any preamble to the first question. */
function walkToDecision(
  from: string,
  nodes: Map<string, Node>,
  outgoing: Map<string, Edge[]>
): string | null {
  let current: string | undefined = from;
  const seen = new Set<string>();

  while (current && !seen.has(current)) {
    seen.add(current);
    if (nodes.get(current)?.shape === "diamond") return current;
    const next: Edge[] = outgoing.get(current) ?? [];
    if (next.length !== 1) return null;
    current = next[0]?.to;
  }
  return null;
}
