/**
 * What the rule editor needs around a graph: the node and edge shapes, the
 * sample record the Try-it panel opens with, and a flat decision table drawn as
 * the smallest graph that runs it.
 */

import type { DecisionRow, DecisionTable } from "./decision-table";

/** Fields the application manages itself — never a good example to check. */
const MANAGED = new Set(["id", "version", "created_at", "updated_at", "created_by", "updated_by"]);

type Node = {
  id: string;
  name: string;
  type: string;
  position: { x: number; y: number };
  content?: unknown;
};
type Edge = { id: string; type: "edge"; sourceId: string; targetId: string; sourceHandle?: string };

export interface TemplateGraph {
  nodes: Node[];
  edges: Edge[];
}

/** A believable value for a field, by its name — a starting point to edit, not a schema. */
function sampleValue(
  field: string,
  enumValues: string[] | undefined,
  type: "string" | "number" | "boolean" | undefined
): unknown {
  if (enumValues?.length) return enumValues[0];
  // The declared type wins over a guess from the name: a number field the name
  // does not hint at (`annual_revenue`) started as "" and failed the Record's
  // own schema before the rule ran.
  if (type === "number") return 0;
  if (type === "boolean") return false;
  if (/(^|_)(is|has|can)_/.test(field)) return false;
  if (/(_at|_on|date)$/.test(field)) return new Date().toISOString().slice(0, 10);
  if (/(amount|total|price|qty|quantity|count|balance|fee|credit|cost|score|age)/.test(field)) {
    return 0;
  }
  return "";
}

/** The sample record the Try-it panel opens with: one entry per editable field. */
export function sampleRecord(
  fields: string[],
  enums: Record<string, string[]> = {},
  types: Record<string, "string" | "number" | "boolean"> = {}
): Record<string, unknown> {
  return Object.fromEntries(
    fields
      .filter((f) => !MANAGED.has(f))
      .map((field) => [field, sampleValue(field, enums[field], types[field])])
  );
}

/* -------------------------------------------------------------------------- */
/*  Cell quoting for the zen decision-table engine                             */
/* -------------------------------------------------------------------------- */

/** Wrap a value as a zen single-quoted string literal. */
function zenLiteralCell(value: string): string {
  return `'${value.replace(/'/g, "\\'")}'`;
}

/** True when the value is already a zen string literal (`'…'` or `"…"`). */
function isAlreadyQuoted(value: string): boolean {
  return (
    value.length >= 2 &&
    (value.startsWith("'") || value.startsWith('"')) &&
    value.endsWith(value[0] as string)
  );
}

/** True when the value is a bare zen literal: null, true, false, or a number. */
function isBareLiteral(value: string): boolean {
  return (
    value === "true" ||
    value === "false" ||
    value === "null" ||
    (value !== "" && !Number.isNaN(Number(value)))
  );
}

/**
 * Quote an output cell value for the zen decision-table engine.
 *
 * The editor stores plain text (`validation-error`, `transform`).  Zen
 * evaluates those as identifier expressions — field references — and finds
 * nothing, so no output field is written.  Wrapping them as zen string
 * literals makes them constant values instead.
 */
function quotedOutputCell(raw: string): string {
  const value = raw.trim();
  if (!value || isAlreadyQuoted(value) || isBareLiteral(value)) return value;
  return zenLiteralCell(value);
}

/**
 * Quote an input cell value for the zen decision-table engine.
 *
 * Leading comparison operators (`>= 0`, `< 1`, `!= null`) are preserved;
 * bare string values like `submitted` are quoted to `'submitted'` so zen
 * treats them as equality checks, not field references.
 */
function quotedInputCell(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  const match = value.match(/^(>=|<=|!=|=|>|<)\s*(.*)/);
  if (match) {
    const [, op, operand] = match as [string, string, string];
    const cell = quotedOutputCell(operand);
    return op === "=" ? cell : `${op} ${cell}`;
  }
  return quotedOutputCell(value);
}

/** A flat decision table as the smallest graph that runs it: Input → Table → Output. */
export function tableToGraph(table: DecisionTable, name: string): TemplateGraph {
  const quotedRules: DecisionRow[] = table.rules.map((row) => {
    const quoted: DecisionRow = { _id: row._id };
    for (const input of table.inputs) quoted[input.id] = quotedInputCell(row[input.id] ?? "");
    for (const output of table.outputs) quoted[output.id] = quotedOutputCell(row[output.id] ?? "");
    return quoted;
  });

  return {
    nodes: [
      { id: "input-1", name: "Record", type: "inputNode", position: { x: 80, y: 200 } },
      {
        id: "dt-1",
        name: name || "Decision",
        type: "decisionTableNode",
        position: { x: 340, y: 200 },
        content: { ...table, rules: quotedRules },
      },
      { id: "output-1", name: "Response", type: "outputNode", position: { x: 680, y: 200 } },
    ],
    edges: [
      { id: "e1", type: "edge", sourceId: "input-1", targetId: "dt-1" },
      { id: "e2", type: "edge", sourceId: "dt-1", targetId: "output-1" },
    ],
  };
}
