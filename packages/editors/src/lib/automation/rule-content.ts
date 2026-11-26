/**
 * Reading and writing what the rules API stores.
 *
 * Rules predate the rule-table editor, so `jdm_content` may hold either a
 * decision table or an older JDM decision graph. Anything that is not a table
 * opens as an empty one rather than a guessed conversion: a graph flattened by
 * assumption would look like a working table while deciding something different,
 * and visibly empty is the failure an author can actually see and fix.
 */

import { type DecisionRow, type DecisionTable, emptyDecisionTable } from "../workflow/bpmn-model";

/** What the rules API round-trips. Kept loose because older rows vary. */
export type StoredRuleContent = DecisionTable | Record<string, unknown>;

export function isDecisionTable(content: unknown): content is DecisionTable {
  if (!content || typeof content !== "object") return false;
  const c = content as Partial<DecisionTable>;
  return Array.isArray(c.inputs) && Array.isArray(c.outputs) && Array.isArray(c.rules);
}

/** A table to edit, whatever was stored. */
export function asDecisionTable(content: unknown): DecisionTable {
  // Parse JSON strings that came back from the API as raw text
  const parsed: unknown =
    typeof content === "string"
      ? (() => {
          try {
            return JSON.parse(content);
          } catch {
            return null;
          }
        })()
      : content;

  if (isDecisionTable(parsed)) {
    const t = parsed as DecisionTable;
    return {
      hitPolicy: t.hitPolicy === "collect" ? "collect" : "first",
      inputs: t.inputs,
      outputs: t.outputs,
      rules: t.rules,
    };
  }

  // JDM graph format: { name, nodes: [..., { type: "decisionTableNode", content: {...} }] }
  if (
    parsed &&
    typeof parsed === "object" &&
    Array.isArray((parsed as Record<string, unknown>).nodes)
  ) {
    const nodes = (parsed as { nodes: unknown[] }).nodes;
    for (const node of nodes) {
      if (
        node &&
        typeof node === "object" &&
        (node as Record<string, unknown>).type === "decisionTableNode"
      ) {
        const tableContent = (node as Record<string, unknown>).content;
        if (isDecisionTable(tableContent)) return editableGraphTable(tableContent as DecisionTable);
      }
    }
  }

  return emptyDecisionTable();
}

/** A whole zen string literal — `'prevent'`, `"a \"b\""` — and nothing after it. */
const ZEN_STRING = /^'(?:[^'\\]|\\.)*'$|^"(?:[^"\\]|\\.)*"$/;

/** The runtime's words for an action, in the editor's (EML's). */
const EDITOR_ACTION: Record<string, string> = { prevent: "validation-error" };

/**
 * A graph's table, as the editor edits it.
 *
 * A graph holds zen literals — `'prevent'`, `''` — because the engine reads
 * every cell as an expression. The editor edits plain text, and the engine
 * quotes a bare table's outcome cells again on the way in, so they are read
 * back unquoted here. Without this, a rule compiled from `%%action` opened
 * with its Action picker blank and nine quoted columns, and saving it after
 * any change wrote the blank back. Input cells are expressions and are left
 * as they are. `ruleId` and columns no row uses are dropped: the engine names
 * a violation after the stored rule, and the rest is noise.
 */
function editableGraphTable(t: DecisionTable): DecisionTable {
  const rules = t.rules.map((row) => {
    const next: DecisionRow = { _id: row._id };
    for (const column of t.inputs) next[column.id] = row[column.id] ?? "";
    for (const column of t.outputs) {
      const raw = String(row[column.id] ?? "").trim();
      const text = ZEN_STRING.test(raw) ? raw.slice(1, -1).replace(/\\(.)/g, "$1") : raw;
      next[column.id] = column.field === "action" ? (EDITOR_ACTION[text] ?? text) : text;
    }
    return next;
  });
  const outputs = t.outputs.filter(
    (column) =>
      column.field !== "ruleId" && rules.some((row) => (row[column.id] ?? "").trim() !== "")
  );
  return {
    hitPolicy: t.hitPolicy === "collect" ? "collect" : "first",
    inputs: t.inputs,
    outputs: outputs.length ? outputs : t.outputs,
    rules,
  };
}

/** The older decision-graph shape, still accepted on write for existing tooling. */
export function isJdmGraph(content: unknown): boolean {
  if (!content || typeof content !== "object") return false;
  const c = content as { name?: unknown; nodes?: unknown };
  return typeof c.name === "string" && Array.isArray(c.nodes) && c.nodes.length > 0;
}

/**
 * What is wrong with a rule someone is trying to save, in the words they would
 * use to fix it. Empty means it is fine.
 *
 * Both shapes are accepted: a decision table, which is what the rule table
 * editor writes, and a JDM graph, which is what older rules and any external
 * tooling still write. Validating only the graph shape is what made the table
 * editor unable to save at all.
 */
export function validateStoredRuleContent(content: unknown): string[] {
  if (!content || typeof content !== "object") {
    return ["The rule has no content. Add at least one row."];
  }

  if (isDecisionTable(content)) {
    const table = content as DecisionTable;
    const problems: string[] = [];
    if (table.inputs.length === 0) problems.push("Add at least one input column to test against.");
    if (table.outputs.length === 0) {
      problems.push("Add at least one outcome column — a table that decides nothing does nothing.");
    }
    if (table.rules.length === 0) problems.push("Add at least one row.");
    // A `collect` table's field-less input reads the whole record (`%%action`).
    const named =
      table.hitPolicy === "collect" ? table.outputs : [...table.inputs, ...table.outputs];
    for (const column of named) {
      if (!String(column.field ?? "").trim()) {
        problems.push(`Column "${column.name || column.id}" does not say which field it reads.`);
      }
    }
    return problems;
  }

  if (isJdmGraph(content)) return [];

  return [
    "The rule content is neither a decision table nor a decision graph. Build it in the rule table editor.",
  ];
}

/**
 * Whether opening this rule will lose what was stored.
 *
 * True for a rule saved as something other than a table — the editor shows an
 * empty table, and saving would replace the old content. The routes use this to
 * warn before that happens rather than after.
 */
export function wouldReplaceStoredContent(content: unknown): boolean {
  return content !== null && content !== undefined && !isDecisionTable(content);
}
