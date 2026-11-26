/**
 * What a rule or workflow must carry before it may be written into the model.
 *
 * A rule saved with no entity became `%%rule name on  event: …`, which the
 * checker reads as a rule on an entity called "event" — a warning, not an
 * error, so the model still checked clean while the rule could never fire.
 * The Logic page asks this before it sends, and the route asks it again
 * because the page is not its only caller.
 */

import { stateToken } from "./workflow-hooks";
import { parseStateFlow } from "./workflow-flow";

export interface SectionProblem {
  kind: "rule" | "workflow";
  index: number;
  message: string;
}

interface Named {
  name?: unknown;
  title?: unknown;
  entity?: unknown;
  kind?: unknown;
  /** Workflows only: the state this one is bound to. */
  status?: unknown;
  operation?: unknown;
  trigger?: unknown;
  /** A state machine's diagram, from which the states it enters are read. */
  diagram?: unknown;
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/**
 * A workflow bound to a state has to name one an arrow enters, and has to be one
 * an update starts — the same three conditions as EML243-EML245, in editor
 * words, so the page refuses it before the checker would.
 */
function statusProblems(workflows: readonly Named[]): SectionProblem[] {
  const problems: SectionProblem[] = [];
  workflows.forEach((workflow, index) => {
    const status = text(workflow.status);
    if (!status || workflow.kind === "state") return;
    const label = text(workflow.title) || text(workflow.name) || String(index + 1);
    const entity = text(workflow.entity);
    const wanted = stateToken(status);

    const machines = workflows.filter((w) => w.kind === "state" && text(w.entity) === entity);
    const entered = machines.flatMap((m) =>
      parseStateFlow(text(m.diagram)).transitions.map((t) => stateToken(t.to))
    );
    if (machines.length === 0) {
      problems.push({
        kind: "workflow",
        index,
        message: `Process "${label}" is bound to a status, but ${entity} has no status flow. Draw one, or remove the status.`,
      });
    } else if (!entered.includes(wanted)) {
      problems.push({
        kind: "workflow",
        index,
        message: `Process "${label}" is bound to "${status}", which no arrow in ${entity}'s status flow enters.`,
      });
    }
    if (workflow.kind === "saga" && (text(workflow.operation) !== "UPDATE" || workflow.trigger === "rule")) {
      problems.push({
        kind: "workflow",
        index,
        message: `Process "${label}" is bound to a status, so it must start on "Updated" — a move is an update.`,
      });
    }
  });
  return problems;
}

export function sectionProblems(
  rules: readonly Named[] = [],
  workflows: readonly Named[] = []
): SectionProblem[] {
  const problems: SectionProblem[] = [];
  const check = (kind: SectionProblem["kind"], items: readonly Named[]) => {
    const noun = kind === "rule" ? "Rule" : "Process";
    items.forEach((item, index) => {
      const label = text(item.title) || text(item.name);
      if (!label) {
        problems.push({ kind, index, message: `${noun} ${index + 1} has no name.` });
      }
      if (!text(item.entity)) {
        problems.push({
          kind,
          index,
          message: `${noun} "${label || index + 1}" has no entity. Choose the entity it runs on.`,
        });
      }
    });
  };
  check("rule", rules);
  check("workflow", workflows);
  problems.push(...statusProblems(workflows));
  return problems;
}
