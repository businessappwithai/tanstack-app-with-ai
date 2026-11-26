/**
 * Decision table model shared between the rule editor and the EML layer.
 *
 * Rules are authored as decision tables. The EML representation embeds the
 * table as a `%%decision-table` directive inside a minimal Mermaid flowchart
 * so the file round-trips without loss. The generator reads the directive and
 * compiles it to a GoRules JDM decision graph for the generated app.
 */

// Whole-record checks are evaluated by the copy the generated app ships too.
import { evaluateExpression, expressionFields } from "../workflow/bpmn-model";

export interface DecisionColumn {
  id: string;
  name: string;
  /** Context key read (inputs) or published (outputs). */
  field: string;
  /** When set, the cell renders as a dropdown constrained to these values. */
  options?: string[];
}

/** The output columns the generated rule engine recognises. */
export const KNOWN_OUTPUT_FIELDS = [
  { field: "action", label: "Action" },
  { field: "message", label: "Message" },
  { field: "ruleId", label: "Rule ID" },
  { field: "workflowName", label: "Workflow Name" },
  { field: "field", label: "Field" },
  { field: "value", label: "Value" },
  { field: "targetEntity", label: "Target Entity" },
  { field: "linkField", label: "Link Field" },
] as const;

/** Auto-applied options when a column field matches a known name. */
export const WELL_KNOWN_OPTIONS: Record<string, string[]> = {
  action: ["trigger-workflow", "validation-error", "transform"],
};

export function getColumnOptions(col: DecisionColumn): string[] | undefined {
  if (col.options && col.options.length > 0) return col.options;
  const key = col.field.trim().toLowerCase();
  return WELL_KNOWN_OPTIONS[key];
}

export interface DecisionRow {
  _id: string;
  [cell: string]: string;
}

export interface DecisionTable {
  hitPolicy: "first" | "collect";
  inputs: DecisionColumn[];
  outputs: DecisionColumn[];
  rules: DecisionRow[];
}

let rowCounter = 0;
export function newRowId(): string {
  return `r${(rowCounter++).toString(36)}${Date.now().toString(36)}`;
}

export function emptyDecisionTable(): DecisionTable {
  return {
    hitPolicy: "first",
    inputs: [{ id: "i1", name: "Input", field: "" }],
    outputs: [{ id: "o1", name: "Output", field: "" }],
    rules: [{ _id: newRowId(), i1: "", o1: "" }],
  };
}

export function parseDecisionTable(json: string | undefined): DecisionTable | null {
  if (!json?.trim()) return null;
  try {
    const parsed = JSON.parse(json) as Partial<DecisionTable>;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      hitPolicy: parsed.hitPolicy === "collect" ? "collect" : "first",
      inputs: Array.isArray(parsed.inputs) ? parsed.inputs : [],
      outputs: Array.isArray(parsed.outputs) ? parsed.outputs : [],
      rules: Array.isArray(parsed.rules) ? (parsed.rules as DecisionRow[]) : [],
    };
  } catch {
    return null;
  }
}

export function validateDecisionTable(table: DecisionTable): string[] {
  const problems: string[] = [];
  if (table.inputs.length === 0) problems.push("Add at least one input column to test against.");
  if (table.outputs.length === 0) {
    problems.push("Add at least one output column — a table that publishes nothing does nothing.");
  }
  if (table.rules.length === 0) problems.push("Add at least one row.");
  for (const input of table.inputs) {
    // A `collect` table is the one `%%action` compiles to: its input reads the
    // whole record and each cell is an expression, so no field is correct.
    if (!input.field.trim() && table.hitPolicy !== "collect") {
      problems.push(`Input "${input.name || input.id}" reads no field.`);
    }
  }
  for (const output of table.outputs) {
    if (!output.field.trim()) {
      problems.push(`Output "${output.name || output.id}" publishes under no name.`);
    }
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/*  Evaluation                                                                  */
/* -------------------------------------------------------------------------- */

export interface TableTestResult {
  /** The first row that fits — under `first`, the answer. */
  rowIndex: number | null;
  outputs: Record<string, string>;
  /** Every row that fits, in order. Under `collect` each of them runs. */
  matches: Array<{ rowIndex: number; outputs: Record<string, string> }>;
}

export { evaluateExpression, expressionFields };

export function evaluateTable(
  table: DecisionTable,
  values: Record<string, string>
): TableTestResult {
  const matches: TableTestResult["matches"] = [];
  for (let i = 0; i < table.rules.length; i++) {
    const row = table.rules[i];
    if (!row) continue;
    const fits = table.inputs.every((col) => {
      const cell = (row[col.id] ?? "").trim();
      if (!cell) return true;
      // An input with no field holds whole-record checks, as `%%action`
      // writes them: `status == "withdrawn" and withdrawn_on == null`.
      if (!col.field.trim()) {
        const verdict = evaluateExpression(cell, values);
        if (verdict !== undefined) return verdict;
      }
      return cellMatches(cell, values[col.field] ?? "");
    });
    if (!fits) continue;
    const outputs: Record<string, string> = {};
    for (const col of table.outputs) outputs[col.field || col.name] = unquote(row[col.id] ?? "");
    matches.push({ rowIndex: i, outputs });
    if (table.hitPolicy !== "collect") break;
  }
  const first = matches[0];
  return { rowIndex: first?.rowIndex ?? null, outputs: first?.outputs ?? {}, matches };
}

function cellMatches(cell: string, typed: string): boolean {
  const m = cell.match(/^\s*(>=|<=|!=|=|>|<)?\s*(.+)$/);
  if (!m) return false;
  const op = m[1] ?? "=";
  const raw = unquote((m[2] ?? "").trim());
  // The cell is unquoted, so the value typed to test it must be too: a tester
  // copying the cell's own `"cancelled"` was told no row fits it.
  const value = unquote(typed);
  const a = Number(value);
  const b = Number(raw);
  const numeric = !Number.isNaN(a) && !Number.isNaN(b) && value.trim() !== "";
  switch (op) {
    case "=":
      return numeric ? a === b : value === raw;
    case "!=":
      return numeric ? a !== b : value !== raw;
    case ">":
      return numeric && a > b;
    case ">=":
      return numeric && a >= b;
    case "<":
      return numeric && a < b;
    case "<=":
      return numeric && a <= b;
    default:
      return false;
  }
}

function unquote(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && (t.startsWith('"') || t.startsWith("'"))) {
    const q = t[0] as string;
    if (t.endsWith(q)) return t.slice(1, -1);
  }
  return t;
}

/* -------------------------------------------------------------------------- */
/*  Coverage                                                                    */
/* -------------------------------------------------------------------------- */

export interface CoverageNote {
  level: "ok" | "warn";
  message: string;
}

export function checkCoverage(table: DecisionTable): CoverageNote[] {
  const notes: CoverageNote[] = [];
  // Under `collect` every row that fits runs. A row with no check is not a
  // safety net there — it runs on every record, which is worth saying loudly.
  if (table.hitPolicy === "collect") {
    const blank = table.rules.findIndex((row) =>
      table.inputs.every((c) => !(row[c.id] ?? "").trim())
    );
    return [
      blank >= 0
        ? {
            level: "warn",
            message: `Row ${blank + 1} has no check, so its action runs on every record.`,
          }
        : {
            level: "ok",
            message:
              "Each row runs on its own when its check fits. A record that no row fits passes untouched.",
          },
    ];
  }
  const hasCatchAll = table.rules.some((row) =>
    table.inputs.every((c) => !(row[c.id] ?? "").trim())
  );
  notes.push(
    hasCatchAll
      ? { level: "ok", message: "Every combination of inputs reaches a row. No gaps." }
      : {
          level: "warn",
          message:
            "No catch-all row. If nothing fits, this table returns no answer. Add a row with every check left blank.",
        }
  );
  for (let i = 0; i < table.rules.length; i++) {
    for (let j = i + 1; j < table.rules.length; j++) {
      const earlier = table.rules[i];
      const later = table.rules[j];
      if (!earlier || !later) continue;
      const shadowed = table.inputs.every((c) => {
        const e = (earlier[c.id] ?? "").trim();
        const l = (later[c.id] ?? "").trim();
        return !e || e === l;
      });
      if (shadowed) {
        notes.push({
          level: "warn",
          message: `Row ${i + 1} already covers everything row ${j + 1} does, so row ${j + 1} can never fire.`,
        });
        return notes;
      }
    }
  }
  return notes;
}

/* -------------------------------------------------------------------------- */
/*  EML round-trip                                                              */
/* -------------------------------------------------------------------------- */

const DIRECTIVE_PREFIX = "%%decision-table ";

/**
 * Embed the decision table in a minimal EML-compatible Mermaid flowchart.
 *
 * The actual table JSON lives in a `%%decision-table` directive so it
 * survives the EML round-trip intact. The generator reads this directive when
 * compiling rules to GoRules JDM.
 */
export function tableToEmlFlowchart(table: DecisionTable): string {
  const json = JSON.stringify(table);
  return [
    "flowchart TD",
    "    Start([Rule table]) --> End([Result])",
    `    ${DIRECTIVE_PREFIX}${json}`,
  ].join("\n");
}

/**
 * Extract a decision table from an EML flowchart that was previously produced
 * by `tableToEmlFlowchart`. Returns null for flowcharts that were hand-authored
 * or produced by the old flowchart editor.
 */
export function parseTableFromFlowchart(flowchart: string): DecisionTable | null {
  const line = (flowchart ?? "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith(DIRECTIVE_PREFIX));
  if (!line) return null;
  return parseDecisionTable(line.slice(DIRECTIVE_PREFIX.length));
}

/* -------------------------------------------------------------------------- */
/*  JDM graph round-trip (full DecisionGraph with nodes + edges)              */
/* -------------------------------------------------------------------------- */

const JDM_GRAPH_PREFIX = "%%jdm-graph ";

/** Embed a full JDM graph (serialised JSON) in an EML-compatible Mermaid flowchart. */
export function graphToEmlFlowchart(graphJson: string): string {
  return [
    "flowchart TD",
    "    Start([Rule]) --> End([Result])",
    `    ${JDM_GRAPH_PREFIX}${graphJson}`,
  ].join("\n");
}

/**
 * Extract the JDM graph JSON string from a flowchart produced by
 * `graphToEmlFlowchart`. Returns null if the flowchart does not contain a
 * `%%jdm-graph` directive.
 */
export function parseGraphFromFlowchart(flowchart: string): string | null {
  const line = (flowchart ?? "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith(JDM_GRAPH_PREFIX));
  if (!line) return null;
  return line.slice(JDM_GRAPH_PREFIX.length);
}
