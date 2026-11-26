/**
 * Reading and writing the workflow model that lives inside BPMN.
 *
 * bpmn-js owns the diagram; this owns what the diagram *means*. Every
 * executable step is a `bpmn:serviceTask` whose behaviour is carried by
 * `appwithai:property` extension elements, and the executor runs them in
 * sequence-flow order. These functions read that back out — in the same order
 * the executor will use — so the editor can show a workflow's variable wiring
 * without guessing.
 *
 * Kept free of React and of bpmn-js so both applications can share it and so
 * the analysis can be tested without a browser.
 */

/** Step types the generated executor knows how to run. */
export const STEP_TYPES = [
  "Decision",
  "CreateEntity",
  "UpdateEntity",
  "DeleteEntity",
  "Formula",
  "REST",
] as const;

export type StepType = (typeof STEP_TYPES)[number];

export const STEP_LABELS: Record<StepType, string> = {
  Decision: "Decision",
  CreateEntity: "Create",
  UpdateEntity: "Update",
  DeleteEntity: "Delete",
  Formula: "Formula",
  REST: "REST call",
};

export const STEP_HINTS: Record<StepType, string> = {
  Decision: "Run a decision table and publish what it decides.",
  CreateEntity: "Insert a row, and remember its id for later steps.",
  UpdateEntity: "Write one column, on this record or a related one.",
  DeleteEntity: "Delete a record. Soft by default, so the audit trail resolves.",
  Formula: "Work out a value, or stage a literal, for a later step.",
  REST: "Call an external endpoint.",
};

export interface WorkflowStep {
  /** The bpmn element id — stable, and what selection is keyed on. */
  id: string;
  name: string;
  type: StepType | string;
  props: Record<string, string>;
}

/* -------------------------------------------------------------------------- */
/*  Decision tables                                                            */
/* -------------------------------------------------------------------------- */

export interface DecisionColumn {
  id: string;
  name: string;
  /** Context key read (inputs) or published (outputs). */
  field: string;
  /** When set, the cell renders as a dropdown constrained to these values. */
  options?: string[];
}

/** The output columns the rule engine recognises. */
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

export function emptyDecisionTable(): DecisionTable {
  return {
    hitPolicy: "first",
    inputs: [{ id: "i1", name: "Input", field: "" }],
    outputs: [{ id: "o1", name: "Output", field: "" }],
    rules: [{ _id: newRowId(), i1: "", o1: "" }],
  };
}

let rowCounter = 0;
export function newRowId(): string {
  return `r${(rowCounter++).toString(36)}${Date.now().toString(36)}`;
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

/**
 * Serialise a table, filling in the cells a row leaves blank.
 *
 * zen-engine silently discards a row that does not carry a value for every
 * output column the table declares — and one dropped row is enough to stop the
 * whole table matching. Rather than make that the author's problem, every
 * output cell is written, using `''` where they left it empty.
 */
export function serializeDecisionTable(table: DecisionTable): string {
  const rules = table.rules.map((row) => {
    const complete: DecisionRow = { _id: row._id || newRowId() };
    for (const input of table.inputs) complete[input.id] = row[input.id] ?? "";
    for (const output of table.outputs) {
      const cell = (row[output.id] ?? "").trim();
      complete[output.id] = cell || "''";
    }
    return complete;
  });
  return JSON.stringify({ ...table, rules });
}

/** Problems that make a table match nothing, stated as the author would see them. */
/* -------------------------------------------------------------------------- */
/*  Whole-record checks                                                         */
/* -------------------------------------------------------------------------- */

type Scalar = string | number | boolean | null;

const IDENTIFIER = /^[A-Za-z_][\w.]*$/;
const COMPARISON = /^\s*([A-Za-z_][\w.]*)\s*(==|!=|>=|<=|>|<)\s*(.+?)\s*$/;
const KEYWORDS = new Set(["true", "false", "null", "and", "or"]);

function plainText(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && (t.startsWith('"') || t.startsWith("'")) && t.endsWith(t[0] as string)) {
    return t.slice(1, -1);
  }
  return t;
}

/** What a test box holds: blank is null, and numbers and booleans are read as such. */
function typedValue(raw: string | undefined): Scalar {
  const text = (raw ?? "").trim();
  if (!text || text === "null") return null;
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return plainText(text);
}

function operand(text: string, values: Record<string, string>): Scalar | undefined {
  const t = text.trim();
  if (/^(["']).*\1$/.test(t)) return t.slice(1, -1);
  if (t === "null") return null;
  if (t === "true") return true;
  if (t === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (IDENTIFIER.test(t)) return typedValue(values[t]);
  return undefined;
}

function compare(left: Scalar, op: string, right: Scalar): boolean {
  switch (op) {
    case "==":
      return left === right;
    case "!=":
      return left !== right;
    default: {
      if (typeof left !== "number" || typeof right !== "number") return false;
      if (op === ">") return left > right;
      if (op === ">=") return left >= right;
      if (op === "<") return left < right;
      return left <= right;
    }
  }
}

/**
 * Evaluate a check of the form `field op value`, joined by `and` / `or`
 * (`and` binding tighter), against typed test values. Returns `undefined`
 * for anything outside that shape, so the caller never claims a verdict on
 * an expression it could not read.
 */
export function evaluateExpression(
  expression: string,
  values: Record<string, string>
): boolean | undefined {
  let any = false;
  for (const clause of expression.split(/\s+or\s+/)) {
    let all = true;
    for (const part of clause.split(/\s+and\s+/)) {
      const m = part.match(COMPARISON);
      if (!m) return undefined;
      const right = operand(m[3] ?? "", values);
      if (right === undefined) return undefined;
      all = compare(typedValue(values[m[1] ?? ""]), m[2] ?? "==", right) && all;
    }
    any = any || all;
  }
  return any;
}

/** The fields a table's whole-record checks read, in the order they appear. */
export function expressionFields(table: DecisionTable): string[] {
  const fields = new Set<string>();
  for (const col of table.inputs) {
    if (col.field.trim()) continue;
    for (const row of table.rules) {
      const cell = row[col.id] ?? "";
      for (const part of cell.split(/\s+(?:and|or)\s+/)) {
        const m = part.match(COMPARISON);
        if (!m) continue;
        if (m[1]) fields.add(m[1]);
        const right = (m[3] ?? "").trim();
        if (IDENTIFIER.test(right) && !KEYWORDS.has(right)) fields.add(right);
      }
    }
  }
  return [...fields];
}

export function validateDecisionTable(table: DecisionTable): string[] {
  const problems: string[] = [];
  if (table.inputs.length === 0) problems.push("Add at least one input column to test against.");
  if (table.outputs.length === 0) {
    problems.push("Add at least one output column — a table that publishes nothing does nothing.");
  }
  if (table.rules.length === 0) problems.push("Add at least one row.");

  for (const input of table.inputs) {
    // Under `collect` (what `%%action` compiles to) an input with no field
    // reads the whole record, and each of its cells is a check on it.
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
/*  Variable flow                                                              */
/* -------------------------------------------------------------------------- */

export interface VariableFact {
  name: string;
  /** Step that publishes it, by name. */
  publishedBy?: string;
  publishedByIndex?: number;
  /** Steps that read it, by name. */
  usedBy: string[];
  /**
   * `unused`    published and never read
   * `late`      read by a step that runs before the one publishing it
   * `external`  read but never published — a column of the triggering record
   */
  problem?: "unused" | "late" | "external";
}

/** Variables a step makes available to the ones after it. */
export function publishedBy(step: WorkflowStep): string[] {
  const props = step.props;

  if (step.type === "CreateEntity") {
    const explicit = props.as?.trim();
    if (explicit) return [explicit];
    const entity = props.entity?.trim();
    return entity ? [`${entity.replace(/^bus_/, "")}Id`] : [];
  }

  if (step.type === "Formula") {
    const target = props.target?.trim();
    return target ? [target] : [];
  }

  if (step.type === "Decision") {
    const allowed = splitList(props.publish);
    if (allowed.length > 0) return allowed;
    const table = parseDecisionTable(props.decisionTable);
    if (!table) return [];
    return table.outputs.map((output) => output.field.trim()).filter(Boolean);
  }

  return [];
}

/** Variables a step reads. */
export function consumedBy(step: WorkflowStep): string[] {
  const props = step.props;
  const names = new Set<string>();

  for (const key of ["source", "targetSource"]) {
    const value = props[key]?.trim();
    if (value) names.add(value);
  }

  // A CreateEntity's field map is column -> context key or literal, and the
  // executor substitutes anything that names a key. Every value is therefore a
  // candidate; the caller decides which ones actually resolve.
  if (step.type === "CreateEntity" && props.fields) {
    try {
      const map = JSON.parse(props.fields) as Record<string, unknown>;
      for (const value of Object.values(map)) {
        if (typeof value === "string" && value.trim()) names.add(value.trim());
      }
    } catch {
      // A malformed map is reported elsewhere; it publishes no reads here.
    }
  }

  // REST bodies interpolate {{key}}.
  if (step.type === "REST" && props.bodyTemplate) {
    for (const match of props.bodyTemplate.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) {
      if (match[1]) names.add(match[1]);
    }
  }

  // A decision reads whatever its input columns name.
  if (step.type === "Decision") {
    const table = parseDecisionTable(props.decisionTable);
    for (const input of table?.inputs ?? []) {
      if (input.field.trim()) names.add(input.field.trim());
    }
  }

  return [...names];
}

/**
 * The reads a step is definitely making, as opposed to might be.
 *
 * A CreateEntity field map holds column -> value, and the executor substitutes
 * a value that happens to name something in context. So `"internal"` is a
 * literal until the moment it isn't, and reporting every such literal as an
 * undefined variable buried the real warnings in noise. Those values still
 * count as reads when they *do* resolve — that is the useful half — but they
 * never raise "nothing publishes this".
 */
export function definitelyConsumedBy(step: WorkflowStep): string[] {
  const names = new Set<string>();
  for (const key of ["source", "targetSource"]) {
    const value = step.props[key]?.trim();
    if (value) names.add(value);
  }
  for (const name of consumedBy(step)) {
    if (step.type === "Decision" || step.type === "REST") names.add(name);
  }
  return [...names];
}

/**
 * Work out where every variable comes from and who reads it.
 *
 * This is the part a list of steps cannot show you. A workflow only does
 * something because one step hands a value to a later one, and the three ways
 * that silently fails — publishing something nobody reads, reading something
 * published later, reading something nobody publishes at all — all look
 * identical at runtime: the step just quietly does nothing.
 *
 * `entityColumns`, when known, separates "reads a column of the triggering
 * record" (fine, and the commonest case) from "reads a name nothing defines".
 */
export function analyzeVariables(
  steps: WorkflowStep[],
  entityColumns: string[] = []
): VariableFact[] {
  const columns = new Set(entityColumns.map((column) => column.toLowerCase()));
  const facts = new Map<string, VariableFact>();
  const publishIndex = new Map<string, number>();

  const fact = (name: string): VariableFact => {
    let existing = facts.get(name);
    if (!existing) {
      existing = { name, usedBy: [] };
      facts.set(name, existing);
    }
    return existing;
  };

  steps.forEach((step, index) => {
    for (const name of publishedBy(step)) {
      const entry = fact(name);
      // First publisher wins, which is what the executor does: a later write
      // overwrites the value, but the variable came into being here.
      if (entry.publishedByIndex === undefined) {
        entry.publishedBy = step.name || step.type;
        entry.publishedByIndex = index;
        publishIndex.set(name, index);
      }
    }
  });

  steps.forEach((step, index) => {
    const definite = new Set(definitelyConsumedBy(step));
    for (const name of consumedBy(step)) {
      const publishedAt = publishIndex.get(name);
      const isColumn = columns.has(name.toLowerCase());
      if (publishedAt === undefined && !isColumn && !looksLikeVariable(name)) continue;

      // A value in a create's field map that resolves to nothing is a literal,
      // not a broken read — record it only when something does publish it.
      if (publishedAt === undefined && !isColumn && !definite.has(name)) continue;

      const entry = fact(name);
      const reader = step.name || step.type;
      if (!entry.usedBy.includes(reader)) entry.usedBy.push(reader);

      if (publishedAt !== undefined && publishedAt > index) entry.problem = "late";
      else if (publishedAt === undefined && !isColumn) entry.problem ??= "external";
    }
  });

  for (const entry of facts.values()) {
    if (entry.publishedByIndex !== undefined && entry.usedBy.length === 0) {
      entry.problem = "unused";
    }
  }

  // Publishers first, in the order they run, so the table reads down the flow.
  // Ties keep insertion order — two outputs of one decision table should read
  // in the order the table declares them, not alphabetically.
  const seen = [...facts.values()];
  return seen
    .map((entry, order) => ({ entry, order }))
    .sort((a, b) => {
      const left = a.entry.publishedByIndex ?? Number.MAX_SAFE_INTEGER;
      const right = b.entry.publishedByIndex ?? Number.MAX_SAFE_INTEGER;
      return left - right || a.order - b.order;
    })
    .map(({ entry }) => entry);
}

export function describeProblem(fact: VariableFact): string | null {
  if (fact.problem === "unused") {
    return `${fact.name} is published but never read. Wire it into a later step, or drop it.`;
  }
  if (fact.problem === "late") {
    return `${fact.name} is read before ${fact.publishedBy} publishes it, so the step that reads it will be skipped. Move that step earlier.`;
  }
  if (fact.problem === "external") {
    return `${fact.name} is read but nothing publishes it — it has to be a column of the triggering record, or the step is skipped.`;
  }
  return null;
}

/** A bare identifier, which is what a context key looks like. */
function looksLikeVariable(value: string): boolean {
  return /^[A-Za-z_][\w.]*$/.test(value);
}

export function splitList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/* -------------------------------------------------------------------------- */
/*  Step requirements                                                          */
/* -------------------------------------------------------------------------- */

/**
 * What a step still needs before it will run.
 *
 * The executor skips a step missing these and writes a line to the log, which
 * is a bad place to find out that a workflow has been quietly doing nothing —
 * so the editor says so while it is being drawn.
 */
export function missingRequirements(step: WorkflowStep): string[] {
  const has = (key: string) => (step.props[key] ?? "").trim().length > 0;
  const missing: string[] = [];

  if (step.type === "Decision") {
    if (!has("decisionTable") && !has("rule")) {
      missing.push("a decision table, or the name of a rule to evaluate");
    } else if (has("decisionTable")) {
      const table = parseDecisionTable(step.props.decisionTable);
      if (!table) missing.push("a decision table that parses");
      else missing.push(...validateDecisionTable(table));
    }
  }

  if (step.type === "UpdateEntity") {
    if (!has("field")) missing.push("the column to write");
    if (!has("source") && !has("value")) missing.push("a value, or a variable to read it from");
    if (has("entity") && !has("targetSource") && (step.props.targetField ?? "id").trim() === "id") {
      missing.push("which row of that entity to write — name a variable holding its id");
    }
  }

  if (step.type === "CreateEntity") {
    if (!has("entity")) missing.push("the entity to insert into");
    let count = 0;
    try {
      count = Object.keys(JSON.parse(step.props.fields || "{}")).length;
    } catch {
      missing.push("a valid column map");
    }
    if (count === 0) missing.push("at least one column to set");
  }

  if (step.type === "DeleteEntity") {
    if (has("entity") && !has("targetSource") && (step.props.targetField ?? "id").trim() === "id") {
      missing.push("which row to delete — name a variable holding its id");
    }
  }

  if (step.type === "Formula") {
    if (!has("target")) missing.push("a variable to store the result in");
    const operation = (step.props.operation ?? "set").trim();
    if (operation === "set" && !has("value")) missing.push("a value to stage");
    else if (operation === "copy" && !has("source")) missing.push("a variable to copy from");
    else if (operation !== "set" && operation !== "copy" && (!has("source") || !has("operand"))) {
      missing.push(`${operation} needs both a source variable and an operand`);
    }
  }

  if (step.type === "REST" && !has("url")) missing.push("the URL to call");

  return missing;
}
