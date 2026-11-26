/**
 * What a rule's answer would do to the write, in a sentence.
 *
 * The application reads the final output row's `action` and nothing else
 * decides anything: a graph that computes a perfectly good `total` but never
 * says `action` refuses nothing, changes nothing and starts nothing. That is
 * the most likely way for a first rule to "not work", and it looks identical to
 * a rule that works and simply did not match — so the Try-it panel says which.
 */

export type OutcomeKind =
  | "blocks"
  | "workflow"
  | "changes"
  | "notifies"
  | "cascade"
  | "nothing"
  | "problem";

export interface Outcome {
  kind: OutcomeKind;
  text: string;
}

type Row = Record<string, unknown>;

const isRow = (value: unknown): value is Row =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function asRecord(value: unknown): Row | null {
  if (isRow(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return isRow(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function describeRow(row: Row): Outcome {
  const raw = typeof row.action === "string" ? row.action.trim() : "";
  // The runtime accepts EML's word and its own; both mean "refuse".
  const action = raw === "validation-error" ? "prevent" : raw;
  const message = typeof row.message === "string" && row.message ? row.message : "";

  switch (action) {
    case "prevent":
      return {
        kind: "blocks",
        text: message ? `Blocks the write: “${message}”` : "Blocks the write (no message given).",
      };
    case "trigger-workflow": {
      const name = typeof row.workflowName === "string" ? row.workflowName.trim() : "";
      return name
        ? { kind: "workflow", text: `Starts the workflow “${name}” once the write is saved.` }
        : {
            kind: "problem",
            text: "Says trigger-workflow but names no Workflow Name, so nothing will start.",
          };
    }
    case "transform": {
      const data = asRecord(row.transformData);
      const keys = data ? Object.keys(data) : [];
      return keys.length
        ? { kind: "changes", text: `Changes ${keys.join(", ")} on the record.` }
        : {
            kind: "problem",
            text: "Says transform but carries no Transform Data (or Field and Value), so nothing will change.",
          };
    }
    case "notify":
    case "validate":
      return { kind: "notifies", text: message ? `Notes: “${message}”` : "Raises a note." };
    case "cascade-update":
    case "cascade-create":
    case "cascade-delete":
      return {
        kind: "cascade",
        text: `Runs ${action} on ${String(row.targetEntity ?? "a related record")}.`,
      };
    case "":
      return Object.keys(row).length
        ? {
            kind: "problem",
            text: "The rule returned values but no action, so the application does nothing with them. Add an output named action.",
          }
        : { kind: "nothing", text: "No row matched, so the write goes ahead." };
    case "allow":
      return { kind: "nothing", text: "Lets the write through." };
    default:
      return {
        kind: "problem",
        text: `The action “${action}” is not one the application knows (use validation-error, trigger-workflow or transform).`,
      };
  }
}

/** One line per row the rule returned; a single "nothing happens" line when none did. */
export function describeOutcome(result: unknown): Outcome[] {
  const rows = Array.isArray(result) ? result.filter(isRow) : isRow(result) ? [result] : [];
  if (!rows.length) return [{ kind: "nothing", text: "No row matched, so the write goes ahead." }];
  return rows.map(describeRow);
}
