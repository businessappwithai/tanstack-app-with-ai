/**
 * The workflow designer, as a viewer.
 *
 * A model expresses a workflow three ways, and each gets the picture the design
 * tool gives it, for the same reasons:
 *
 *   state   a graph, so it gets a canvas. States are pills -- green where a
 *           record starts, grey where the process ends, blue in between --
 *           and every arrow is a move the generated application will allow.
 *           An arrow that is not drawn is refused with a 403 for every caller,
 *           the administrator included, so the picture is the enforcement.
 *   saga    already an ordered list, so it gets the ladder rather than a canvas
 *           whose layout would carry no meaning. One rung per `%%step`, in the
 *           order the document gives them.
 *   hook    a list of lifecycle handlers, so it gets a list, grouped by entity
 *           and ordered the way they run.
 *
 * Nothing here decides what a workflow is. The states, the edges, the step
 * properties and the order all arrive compiled from `eml-model.js`.
 */

import { Canvas, el } from "./canvas.js";
import { decisionTableElement } from "./decision-table.js";

/** The glyphs the automation ladder uses, so a step reads alike in both. */
const STEP_GLYPHS = {
  Decision: "▤",
  Formula: "ƒ",
  CreateEntity: "✚",
  UpdateEntity: "✎",
  DeleteEntity: "✕",
  REST: "↗",
  Agent: "◈",
};

const STEP_TITLES = {
  Decision: "Look up a rule table",
  Formula: "Work out a value",
  CreateEntity: "Create a record",
  UpdateEntity: "Update a column",
  DeleteEntity: "Delete a record",
  REST: "Call a web service",
  Agent: "Ask an agent",
};

/** How a step reads on its rung, in the model's own words. */
function describeStep(step) {
  const p = step.props || {};
  switch (step.type) {
    case "Decision":
      return "Look up " + (p.rule || "the table declared here");
    case "Formula":
      return (
        (p.operation || "set") +
        " " +
        (p.target || "a variable") +
        (p.value ? " to " + p.value : p.source ? " from " + p.source : "")
      );
    case "CreateEntity":
      return "Create " + (p.entity || "a record") + (p.as ? " → " + p.as : "");
    case "UpdateEntity":
      return (
        "Set " +
        (p.entity && p.field ? p.entity + "." + p.field : p.field || "a column") +
        (p.value ? " to " + p.value : p.source ? " from " + p.source : "")
      );
    case "DeleteEntity":
      return "Delete " + (p.entity || "a record") + (p.hard === "true" ? " permanently" : "");
    case "REST":
      return (p.method || "POST") + " to " + (p.url || "a URL");
    default:
      return STEP_TITLES[step.type] || step.type;
  }
}

/** One status pill. */
function statePill(state, machine) {
  const isInitial = machine.initial === state.name;
  const isTerminal = machine.terminal.indexOf(state.name) !== -1;
  const undeclared = machine.undeclaredStates.indexOf(state.name) !== -1;

  const pill = el("div", "awv-state");
  if (isInitial) pill.classList.add("is-initial");
  else if (isTerminal) pill.classList.add("is-terminal");
  if (undeclared) pill.classList.add("is-undeclared");

  if (isInitial) pill.append(el("span", "awv-state-glyph", "▶"));
  if (isTerminal) pill.append(el("span", "awv-state-glyph", "⚑"));
  pill.append(el("span", "awv-state-name", state.name));

  if (undeclared) {
    pill.title =
      "No %%enum declares this value, so the column can never hold it and every move onto it is refused.";
    pill.append(el("span", "awv-state-warn", "!"));
  }
  return pill;
}

/** The state-machine canvas for one `kind: state` workflow. */
export class StateMachineViewer {
  constructor(host) {
    this.canvas = new Canvas(host, {
      direction: "right",
      // Wider than the ERD's: a transition carries its trigger and, where the
      // model restricts it, the roles allowed to cross it, and that label sits
      // on the curve. Too tight and the label lands on the pill it describes.
      gapWithin: 64,
      gapBetween: 190,
      emptyMessage: "This workflow declares no states yet.",
    });
  }

  render(machine) {
    const nodes = machine.states.map((state) => ({
      id: state.name,
      element: statePill(state, machine),
      className: "awv-node-state",
    }));

    /* The label carries the trigger and nothing else. A state is changed only
       by background workflows, so the tooltip names the sagas that make the
       move, and an edge nothing writes is a colour of its own: a move no
       workflow makes is one no record will ever take. */
    const edges = machine.transitions.map((transition, index) => {
      const writers = (machine.stateWriters || {})[transition.to];
      const closing = transition.to === "[*]";
      const opening = transition.from === "[*]";
      return {
        id: "t" + index,
        source: transition.from,
        target: transition.to,
        label: transition.trigger || undefined,
        title: closing
          ? "The record's life ends here"
          : opening
            ? "A new record starts here — the application sets it"
            : writers
            ? "Moved here by " + writers.join(", ") + " — never by hand"
            : "No background workflow moves a record here",
        className: closing || opening || writers ? "" : "is-unwritten",
      };
    });

    this.canvas.render(nodes, edges);
  }
}

/** The saga ladder: one rung per step, top to bottom, in run order. */
export function sagaLadder(saga) {
  const ladder = el("div", "awv-ladder");

  const trigger = el("div", "awv-rung is-when");
  trigger.append(el("span", "awv-rung-glyph", "⚡"));
  const triggerBody = el("div", "awv-rung-body");
  triggerBody.append(el("p", "awv-rung-kicker", "When this happens"));
  triggerBody.append(
    el(
      "p",
      "awv-rung-title",
      saga.trigger === "rule"
        ? "A business rule emits trigger-workflow " + saga.name
        : "Any " + saga.operation.toLowerCase() + " of " + saga.entity
    )
  );
  trigger.append(triggerBody);
  ladder.append(trigger);

  if (saga.steps.length === 0) {
    ladder.append(
      el("p", "awv-ladder-empty", "No %%step directives yet -- this workflow does nothing.")
    );
    return ladder;
  }

  saga.steps.forEach((step, index) => {
    const rung = el("div", "awv-rung is-action");
    if (step.missing.length) rung.classList.add("has-problem");
    rung.append(el("span", "awv-rung-glyph", STEP_GLYPHS[step.type] || "●"));

    const body = el("div", "awv-rung-body");
    body.append(
      el("p", "awv-rung-kicker", "Then do this · step " + (index + 1) + " · " + step.type)
    );
    body.append(el("p", "awv-rung-title", describeStep(step)));
    if (step.label && step.label !== describeStep(step)) {
      body.append(el("p", "awv-rung-note", step.label));
    }

    /* An inline decision table is drawn as a table. Everything else is a
       property, and reads as one. */
    const table = decisionTableElement(step.props && step.props.decisionTable);
    const props = Object.keys(step.props || {}).filter(
      (key) => !(table && key === "decisionTable")
    );
    if (props.length) {
      const list = el("dl", "awv-rung-props");
      for (const key of props) {
        list.append(el("dt", null, key), el("dd", null, step.props[key]));
      }
      body.append(list);
    }
    if (table) body.append(table);

    if (step.publishes.length) {
      const published = el("p", "awv-rung-publishes");
      published.append(el("span", "awv-badge is-publishes", "publishes"));
      published.append(document.createTextNode(" " + step.publishes.join(", ")));
      body.append(published);
    }

    if (step.missing.length) {
      body.append(
        el(
          "p",
          "awv-rung-problem",
          "Missing: " + step.missing.join(", ") + " -- the executor skips a step it cannot run."
        )
      );
    }

    rung.append(body);
    ladder.append(rung);
  });

  return ladder;
}

/** The lifecycle handlers an entity declares, in the order they run. */
export function hookList(hooks) {
  const wrapper = el("div", "awv-hooks");
  const byEntity = new Map();
  for (const hook of hooks) {
    if (!byEntity.has(hook.entity)) byEntity.set(hook.entity, []);
    byEntity.get(hook.entity).push(hook);
  }

  for (const [entity, entityHooks] of byEntity) {
    const group = el("section", "awv-hook-group");
    group.append(el("h4", "awv-hook-entity", entity));
    const list = el("ol", "awv-hook-list");
    for (const hook of entityHooks) {
      const item = el("li", "awv-hook");
      item.append(el("code", "awv-hook-type", hook.type));
      item.append(el("span", "awv-hook-handler", hook.handler));
      if (hook.field) item.append(el("span", "awv-badge is-field", "on " + hook.field));
      list.append(item);
    }
    group.append(list);
    wrapper.append(group);
  }

  return wrapper;
}
