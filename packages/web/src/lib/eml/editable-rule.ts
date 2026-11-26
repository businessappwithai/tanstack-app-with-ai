/**
 * A model rule, read into the shape the rule editor edits — and written back.
 *
 * Both the Logic step and the Enhance page edit the same `%%rule` sections, and
 * they used to read them differently. Enhance recognised a rule written as
 * `%%action` directives and opened it as the decision table it compiles to;
 * Logic did not, so every such rule opened there as a read-only flowchart whose
 * only offer was "Start an empty table instead" — which discarded the actions.
 * One reader, used by both, is what keeps the two screens describing one model.
 */

import type { EditableRule } from "@appwithai/editors/components/eml/RuleEditor";
import { slugifyRuleName } from "@appwithai/editors/components/eml/RuleEditor";
import { asDecisionTable } from "@appwithai/editors/lib/automation/rule-content";
import {
  type DecisionRow,
  type DecisionTable,
  emptyDecisionTable,
  graphToEmlFlowchart,
  parseGraphFromFlowchart,
  parseTableFromFlowchart,
  tableToEmlFlowchart,
} from "@appwithai/editors/lib/eml/decision-table";
import {
  buildActionDecisionTable,
  parseRuleActions,
  replaceRuleActions,
  serializeRuleActions,
} from "@appwithai/generator/rules";

/** A rule as `GET /api/projects/:id/eml` returns it. */
export interface ModelRule {
  name: string;
  entity: string;
  event: string;
  priority?: number;
  title?: string;
  flowchart: string;
}

/** Cells the compiler wrote as zen literals, read back for the editor. */
function unquoteZenCell(value: string): string {
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

/** The runtime's `prevent` is EML's `validation-error` — the word an author wrote. */
const RUNTIME_TO_EML_ACTION: Record<string, string> = { prevent: "validation-error" };

/**
 * The compiled action table, presented the way the editor expects it.
 *
 * `buildActionDecisionTable` quotes every cell (`'prevent'`, `''`) and spells
 * actions in the runtime's vocabulary, which left the action dropdown showing
 * nothing selected and the grid full of nine quoted columns. Read the cells
 * back as plain text, translate `prevent`, and drop the columns no row uses —
 * a two-action rule opens as Action and Message, not nine wide columns.
 */
export function normalizeActionTable(table: DecisionTable): DecisionTable {
  const rules = table.rules.map((row) => {
    const next: DecisionRow = { _id: row._id };
    for (const column of [...table.inputs, ...table.outputs]) {
      const raw = unquoteZenCell(row[column.id] ?? "");
      const value = column.field === "action" ? (RUNTIME_TO_EML_ACTION[raw] ?? raw) : raw;
      next[column.id] = value;
    }
    return next;
  });

  // `ruleId` repeats the rule's own name on every row — it lives on the
  // directive, not per row. Other columns are kept only while some row uses
  // them, so the table reads as what the rule actually does.
  const outputs = table.outputs.filter(
    (column) =>
      column.field !== "ruleId" && rules.some((row) => (row[column.id] ?? "").trim() !== "")
  );

  return { ...table, rules, outputs };
}

/** Read one model rule into the editor's shape, recognising how it is stored. */
export function toEditableRule(rule: ModelRule, key: string): EditableRule {
  // Full JDM graph stored by the graph editor takes priority.
  const graphJson = parseGraphFromFlowchart(rule.flowchart);
  if (graphJson) {
    return {
      key,
      name: rule.name,
      entity: rule.entity,
      event: rule.event,
      priority: rule.priority,
      title: rule.title,
      table: emptyDecisionTable(),
      jdmGraph: graphJson,
      sourceKind: "decision-table",
      sourceRuleName: rule.name,
    };
  }

  const directiveTable = parseTableFromFlowchart(rule.flowchart);
  const actions = parseRuleActions(rule.flowchart);

  let table: DecisionTable;
  let sourceKind: "actions" | "decision-table" | "flowchart";
  if (directiveTable) {
    // A table this editor wrote round-trips through `%%decision-table`.
    table = directiveTable;
    sourceKind = "decision-table";
  } else if (actions.length) {
    // Show the same decision table the generated application's rule editor
    // edits, compiled from the `%%action` directives, with the compiler's
    // quoting and runtime vocabulary read back for editing.
    table = normalizeActionTable(asDecisionTable(buildActionDecisionTable(rule.name, actions)));
    sourceKind = "actions";
  } else {
    // A rule that is only a flowchart. A hand-authored one opens read-only;
    // a convertible one can be turned into the table it describes.
    table = emptyDecisionTable();
    sourceKind = "flowchart";
  }

  return {
    key,
    name: rule.name,
    entity: rule.entity,
    event: rule.event,
    priority: rule.priority,
    title: rule.title,
    table,
    sourceKind,
    sourceRuleName: rule.name,
    // The original body is kept for "Show EML" and, for an actions rule, to
    // preserve the flowchart when the actions are rewritten.
    ...(sourceKind === "decision-table" ? {} : { sourceFlowchart: rule.flowchart }),
  };
}

/** The rule body the save path sends, in whichever form the rule is stored. */
export function ruleFlowchartForSave(rule: EditableRule): string {
  // A full JDM graph (from the graph editor) is stored as %%jdm-graph.
  if (rule.jdmGraph) return graphToEmlFlowchart(rule.jdmGraph);
  // An actions rule is stored as `%%action` directives; writing the table back
  // as them keeps its flowchart and its meaning. Everything else is already a
  // document the composer reads.
  if (rule.sourceKind === "actions") {
    return replaceRuleActions(
      rule.sourceFlowchart ?? "",
      serializeRuleActions(rule.sourceRuleName ?? rule.name, rule.table)
    );
  }
  return rule.sourceFlowchart ?? tableToEmlFlowchart(rule.table);
}

/** The whole rule as the `PUT /api/projects/:id/eml` body carries it. */
export function ruleForSave(rule: EditableRule): ModelRule {
  return {
    name: slugifyRuleName(rule.title ?? rule.name),
    entity: rule.entity,
    event: rule.event,
    priority: rule.priority,
    title: rule.title,
    flowchart: ruleFlowchartForSave(rule),
  };
}
