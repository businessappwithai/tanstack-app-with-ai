/**
 * Workflows, both directions.
 *
 * EML expresses a workflow two ways (spec/03-workflows.md):
 *
 *   hook   a flowchart annotated with `%%hook` directives binding named
 *          handlers to entity lifecycle events
 *   state  a `stateDiagram-v2` whose states become the entity's status enum
 *          and whose transitions define the allowed moves
 *
 * The hook form is a list, so it is edited as one. The state form is a graph,
 * so it gets a canvas. Both serialise back to the exact text a hand-written
 * workflow would use.
 */

import { parseHooksFromFlowchart } from "../workflow/hook-parser";

/* -------------------------------------------------------------------------- */
/*  Hook workflows                                                             */
/* -------------------------------------------------------------------------- */

/** The 13 lifecycle events, in the order they run. Matches the EML spec. */
export const HOOK_TYPES = [
  "beforeCreate",
  "afterCreate",
  "beforeUpdate",
  "afterUpdate",
  "beforeDelete",
  "afterDelete",
  "beforeRead",
  "afterRead",
  "beforeQuery",
  "afterQuery",
  "beforeList",
  "afterList",
  "customValidate",
] as const;

export type HookType = (typeof HOOK_TYPES)[number];

export const HOOK_HINTS: Record<string, string> = {
  beforeCreate: "Runs before a record is written — hash a password, set a default.",
  afterCreate: "Runs once the record exists — send a welcome email, emit an event.",
  beforeUpdate: "Validate or transform before the write.",
  afterUpdate: "Audit the change, invalidate a cache.",
  beforeDelete: "Block the delete if the record is still referenced.",
  afterDelete: "Clean up related rows or files.",
  beforeRead: "Guard a single-record read.",
  afterRead: "Redact or enrich a record on the way out.",
  beforeQuery: "Scope the query — tenant filters, injected conditions.",
  afterQuery: "Post-process the rows that came back.",
  beforeList: "Adjust filtering, sorting or pagination.",
  afterList: "Post-process a page of results.",
  customValidate: "Cross-field or business validation on any write.",
};

export interface WorkflowHook {
  id: string;
  type: HookType | string;
  /** Generated function name. */
  handler: string;
  /** Optional field the hook is scoped to. */
  field?: string;
}

/** Read the `%%hook` directives out of a hook workflow's diagram. */
export function parseHookWorkflow(diagram: string): WorkflowHook[] {
  const { hooks } = parseHooksFromFlowchart(diagram ?? "");
  return hooks.map((hook, index) => ({
    id: `h${index}_${hook.name}`,
    type: hook.type,
    handler: hook.name,
    field: hook.parameters?.find((parameter) => parameter.type === "field")?.name,
  }));
}

/**
 * Write a hook workflow.
 *
 * The flowchart is generated from the hooks, so the picture and the directives
 * can never disagree — the directives carry the meaning, and the diagram is how
 * a reader sees it. The steps are drawn as one chain in run order because that
 * is what actually happens at runtime.
 */
export function emitHookWorkflow(entity: string, hooks: WorkflowHook[]): string {
  const lines = ["flowchart TD", `    request[Request] --> validate[Validate ${entity}]`];

  let previous = "validate";
  hooks.forEach((hook, index) => {
    const id = `step${index + 1}`;
    lines.push(`    ${previous} --> ${id}[${hook.type}: ${hook.handler}]`);
    previous = id;
  });

  lines.push(
    `    ${previous} --> persist[Persist ${entity}]`,
    "    persist --> done[Response]",
    ""
  );

  for (const hook of hooks) {
    lines.push(
      `    %%hook ${hook.type} ${hook.handler} on ${entity}` +
        (hook.field ? `[field: ${hook.field}]` : "")
    );
  }

  return lines.join("\n");
}

export function validateHookWorkflow(entity: string, hooks: WorkflowHook[]): string[] {
  const problems: string[] = [];
  if (!entity) problems.push("Pick the entity this workflow runs for.");
  if (!hooks.length) problems.push("Add at least one lifecycle step.");

  const seen = new Set<string>();
  for (const hook of hooks) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(hook.handler)) {
      problems.push(`"${hook.handler || "(unnamed)"}" is not a valid handler name.`);
    }
    const key = `${hook.type}:${hook.handler}`;
    if (seen.has(key)) problems.push(`${hook.type} ${hook.handler} is listed twice.`);
    seen.add(key);
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/*  State workflows                                                            */
/* -------------------------------------------------------------------------- */

export interface StateNode {
  id: string;
  /** The state name, which becomes a status enum value. */
  name: string;
  position?: { x: number; y: number };
}

export interface StateTransition {
  id: string;
  from: string;
  to: string;
  /** Optional trigger label, e.g. `submit`. */
  label?: string;
  /**
   * The roles that may press this move — its `%%rbac role:… on <Entity>.<event>`
   * line. Empty: anyone who may update the record.
   */
  roles?: string[];
}

export interface StateFlow {
  states: StateNode[];
  transitions: StateTransition[];
  /** State the entity starts in — the `[*] --> x` transition. */
  initial?: string;
  /** States that end the process — `x --> [*]`. */
  terminal: string[];
  /** The roles that may reopen a Final record (`%%rbac … on <Entity>.reopen`). */
  reopenRoles?: string[];
  /** The entity the `%%rbac` move lines name, as read. */
  entity?: string;
  /** Any other `%%` line of the section, kept as written so a save loses nothing. */
  directives?: string[];
}

const START_MARKER = "[*]";
const RBAC_MOVE = /^%%rbac\s+(\S+)\s+on\s+([A-Za-z_]\w*)\.([A-Za-z_][\w-]*(?:->[A-Za-z_]\w*)?)\s*$/;

/** `close won`, `Close-Won` and `close_won` are one event. */
function oneToken(event: string): string {
  return event.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function rolesOf(expression: string): string[] {
  return expression
    .split("|")
    .map((part) => part.trim().replace(/^role:/i, "").trim())
    .filter(Boolean);
}

const CRUD_TARGETS = new Set(["create", "read", "update", "delete", "*", "write", "modify", "remove", "destroy", "view", "list", "get", "insert", "add", "edit"]);

/** Read a `stateDiagram-v2` into the editable model. */
export function parseStateFlow(diagram: string): StateFlow {
  const states = new Map<string, StateNode>();
  const transitions: StateTransition[] = [];
  const terminal: string[] = [];
  let initial: string | undefined;

  const ensure = (name: string) => {
    if (name === START_MARKER) return;
    if (!states.has(name)) states.set(name, { id: name, name });
  };

  let index = 0;
  const moveLines: Array<{ roles: string[]; entity: string; target: string; line: string }> = [];
  const directives: string[] = [];
  for (const rawLine of (diagram ?? "").split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("%%")) {
      const move = RBAC_MOVE.exec(line);
      if (move && !CRUD_TARGETS.has(move[3]!.toLowerCase())) {
        moveLines.push({ roles: rolesOf(move[1]!), entity: move[2]!, target: move[3]!, line });
      } else {
        directives.push(line);
      }
      continue;
    }
    if (!line || /^stateDiagram(-v2)?$/.test(line)) continue;

    // `from --> to : label`
    const match = line.match(
      /^(\[\*\]|[A-Za-z_][\w]*)\s*-->\s*(\[\*\]|[A-Za-z_][\w]*)\s*(?::\s*(.+))?$/
    );
    if (!match) continue;

    const [, from, to, label] = match as unknown as [string, string, string, string | undefined];
    ensure(from);
    ensure(to);

    if (from === START_MARKER) {
      initial = to;
      continue;
    }
    if (to === START_MARKER) {
      terminal.push(from);
      continue;
    }

    transitions.push({ id: `t${index++}_${from}_${to}`, from, to, label: label?.trim() });
  }

  // Left-to-right by reachability from the initial state, so the process reads
  // in the order it happens.
  const ordered = [...states.values()];
  const depth = new Map<string, number>();
  if (initial) depth.set(initial, 0);
  let changed = true;
  while (changed) {
    changed = false;
    for (const transition of transitions) {
      const fromDepth = depth.get(transition.from);
      if (fromDepth === undefined) continue;
      if (!depth.has(transition.to)) {
        depth.set(transition.to, fromDepth + 1);
        changed = true;
      }
    }
  }
  const perColumn = new Map<number, number>();
  for (const state of ordered) {
    const column = depth.get(state.id) ?? 0;
    const row = perColumn.get(column) ?? 0;
    perColumn.set(column, row + 1);
    // A state is ~150px wide; at 220 apart a move's label had 70px between two
    // states and ran into both ("accept_offer" over offer_made and accepted).
    state.position = { x: 80 + column * 300, y: 60 + row * 140 };
  }

  // The %%rbac move lines: each names its edges by event or `from->to`, or is
  // Reopen. A line naming no drawn move is kept as written.
  let reopenRoles: string[] | undefined;
  let entity: string | undefined;
  for (const move of moveLines) {
    entity ??= move.entity;
    const arrow = /^(\w+)->(\w+)$/.exec(move.target);
    const matched = transitions.filter((transition) =>
      arrow
        ? transition.from === arrow[1] && transition.to === arrow[2]
        : !!transition.label && oneToken(transition.label) === oneToken(move.target)
    );
    if (matched.length > 0) {
      for (const transition of matched) {
        transition.roles = [...new Set([...(transition.roles ?? []), ...move.roles])];
      }
    } else if (!arrow && oneToken(move.target) === "reopen") {
      reopenRoles = [...new Set([...(reopenRoles ?? []), ...move.roles])];
    } else {
      directives.push(move.line);
    }
  }

  return {
    states: ordered,
    transitions,
    initial,
    terminal,
    ...(reopenRoles ? { reopenRoles } : {}),
    ...(entity ? { entity } : {}),
    ...(directives.length ? { directives } : {}),
  };
}

/**
 * Write the editable model back out as a `stateDiagram-v2`, followed by the
 * `%%rbac` line of every move given to roles and any other `%%` line the
 * section carried. `entity` names the record type the move lines are about.
 */
export function emitStateFlow(flow: StateFlow, entity = flow.entity): string {
  const lines = ["stateDiagram-v2"];

  // `initial`, `terminal` and a transition's `from`/`to` all hold state *ids*,
  // not names. `parseStateFlow` sets `id === name`, so an imported diagram
  // round-trips whichever one is written — but a state added in the editor gets
  // an opaque id like `smtd05euwc`, and writing that puts the id where the
  // status enum value belongs. Resolve to the name on the way out.
  const nameOf = new Map(flow.states.map((state) => [state.id, state.name] as const));
  const named = (ref: string) => nameOf.get(ref) ?? ref;

  if (flow.initial) lines.push(`    ${START_MARKER} --> ${named(flow.initial)}`);
  for (const transition of flow.transitions) {
    const label = transition.label?.trim();
    lines.push(
      `    ${named(transition.from)} --> ${named(transition.to)}${label ? ` : ${label}` : ""}`
    );
  }
  for (const state of flow.terminal) lines.push(`    ${named(state)} --> ${START_MARKER}`);

  // A state with no transitions at all would vanish; name it so it survives.
  const mentioned = new Set<string>();
  if (flow.initial) mentioned.add(flow.initial);
  for (const transition of flow.transitions) {
    mentioned.add(transition.from);
    mentioned.add(transition.to);
  }
  for (const state of flow.terminal) mentioned.add(state);
  for (const state of flow.states) {
    if (!mentioned.has(state.id)) lines.push(`    ${state.name}`);
  }

  // Who may press each move. Edges sharing an event share its line.
  const owner = entity?.trim();
  const moves = new Map<string, Set<string>>();
  for (const transition of flow.transitions) {
    const given = (transition.roles ?? []).map((role) => role.trim()).filter(Boolean);
    if (!given.length) continue;
    const label = transition.label?.trim();
    const target = label ? oneToken(label) : `${named(transition.from)}->${named(transition.to)}`;
    const roles = moves.get(target) ?? new Set<string>();
    for (const role of given) roles.add(role);
    moves.set(target, roles);
  }
  if (flow.reopenRoles?.length) moves.set("reopen", new Set(flow.reopenRoles));
  const extra = [
    ...(owner
      ? [...moves].map(([target, roles]) => `    %%rbac role:${[...roles].join("|")} on ${owner}.${target}`)
      : []),
    ...(flow.directives ?? []).map((line) => `    ${line}`),
  ];
  if (extra.length) lines.push("", ...extra);

  return lines.join("\n");
}

export function validateStateFlow(flow: StateFlow): string[] {
  const problems: string[] = [];
  if (!flow.states.length) return ["No states yet — add the first one."];
  if (!flow.initial) problems.push("No starting state — mark the state the entity begins in.");
  if (!flow.terminal.length) problems.push("No finishing state — mark at least one as an end.");

  for (const state of flow.states) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(state.name)) {
      problems.push(`"${state.name}" is not a valid status value (letters, digits, underscore).`);
    }
  }
  // Two states with one value are one node in the saved diagram: the second
  // one's transitions would silently join the first.
  const seen = new Set<string>();
  for (const state of flow.states) {
    if (seen.has(state.name)) {
      problems.push(`Two states are called "${state.name}" — give each state its own value.`);
    }
    seen.add(state.name);
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/*  Saga workflows — multi-step processes                                      */
/* -------------------------------------------------------------------------- */

/**
 * A saga is a flowchart whose nodes are bound to executable steps by `%%step`
 * directives. The generated executor runs them in the order the edges give, so
 * this editor keeps them as an ordered list and emits a straight chain: the
 * node ids are bookkeeping the author should never have to hold in their head.
 *
 * The vocabulary mirrors `workflowConstructs.stepNodes` in
 * `language/appwithai-language.json`, which is the canonical declaration.
 */
export const SAGA_STEP_TYPES = [
  "Decision",
  "Formula",
  "CreateEntity",
  "UpdateEntity",
  "DeleteEntity",
  "REST",
] as const;

export type SagaStepType = (typeof SAGA_STEP_TYPES)[number];

export const SAGA_STEP_HINTS: Record<SagaStepType, string> = {
  Decision: "Run a decision table and publish what it decides for later steps.",
  Formula: "Work out a value — or stage a literal — for a later step to use.",
  CreateEntity: "Insert a row. Name the variable its id lands in so a later step can reach it.",
  UpdateEntity: "Write one column, on this record or on a related one.",
  DeleteEntity: "Delete a record. Soft by default, so the audit trail still resolves.",
  REST: "Call an external endpoint.",
};

export const FORMULA_OPERATIONS = ["set", "copy", "multiply", "divide", "add", "subtract"] as const;

/** Which property fields each step type shows, in the order they read. */
export const SAGA_STEP_FIELDS: Record<SagaStepType, string[]> = {
  Decision: ["rule", "publish", "decisionTable"],
  Formula: ["target", "operation", "value", "source", "operand"],
  CreateEntity: ["entity", "fields", "as"],
  UpdateEntity: ["entity", "targetField", "targetSource", "field", "value", "source"],
  DeleteEntity: ["entity", "targetField", "targetSource", "hard"],
  REST: ["url", "method", "bodyTemplate"],
};

export const SAGA_FIELD_LABELS: Record<string, string> = {
  rule: "Evaluate the saved rule",
  publish: "Publish only these outputs",
  decisionTable: "Decision table (JSON)",
  entity: "Entity",
  field: "Column to write",
  value: "Literal value",
  source: "Read from variable",
  target: "Store in variable",
  targetField: "Match rows on column",
  targetSource: "…against this variable",
  operation: "Operation",
  operand: "Operand",
  as: "Bind new row id to",
  hard: "Hard delete",
  fields: "Columns to set (JSON)",
  url: "URL",
  method: "Method",
  bodyTemplate: "Body template",
};

export interface SagaStep {
  /** Stable across renames, so React keeps the row being edited. */
  id: string;
  type: SagaStepType;
  /** Node label, shown on the flowchart. */
  label: string;
  props: Record<string, string>;
}

export interface SagaFlow {
  steps: SagaStep[];
  /** `rule` means a business rule decides when this runs. */
  trigger: "automatic" | "rule";
  operation: "CREATE" | "UPDATE" | "DELETE" | "ALL";
}

export function emptySagaFlow(): SagaFlow {
  return { steps: [], trigger: "rule", operation: "CREATE" };
}

let sagaStepCounter = 0;
const nextSagaStepId = () => `s${(sagaStepCounter++).toString(36)}${Date.now().toString(36)}`;

/** Node id for the nth step. Positional, because the editor owns the order. */
function stepNodeId(index: number): string {
  return `S${index + 1}`;
}

/** `key: value` pairs, each value running to the next `key:` token. */
function parseStepProps(rest: string): Record<string, string> {
  const props: Record<string, string> = {};
  const trimmed = rest.trim();
  if (!trimmed) return props;
  for (const chunk of trimmed.split(/\s+(?=[A-Za-z_]\w*:)/)) {
    const at = chunk.indexOf(":");
    if (at <= 0) continue;
    const key = chunk.slice(0, at).trim();
    if (key) props[key] = chunk.slice(at + 1).trim();
  }
  return props;
}

/**
 * Read a saga flowchart back into the editable model.
 *
 * Steps come out in the order the edges chain them, so a document written by
 * hand — or by an earlier version of this editor — still opens in the order it
 * runs rather than in directive order.
 */
export function parseSagaFlow(diagram: string): SagaFlow {
  const declared = new Map<string, SagaStep>();
  const labels = new Map<string, string>();
  const next = new Map<string, string>();
  const hasIncoming = new Set<string>();

  const nodeLabel =
    /(?:^|[^\w])([A-Za-z_]\w*)\s*(?:\(\[([^\]]*)\]\)|\[([^\]]*)\]|\{([^}]*)\}|\(([^)]*)\))/g;
  const edge =
    /([A-Za-z_]\w*)\s*(?:\(\[[^\]]*\]\)|\[[^\]]*\]|\{[^}]*\}|\([^)]*\))?\s*(?:-->|---|==>)(?:\|[^|]*\|)?\s*([A-Za-z_]\w*)/g;

  for (const rawLine of (diagram ?? "").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const step = line.match(/^%%step\s+([A-Za-z_]\w*)\s+([A-Za-z]\w*)\s*(.*)$/);
    if (step) {
      const [, nodeId, typeName, rest] = step as unknown as [string, string, string, string];
      if (!SAGA_STEP_TYPES.includes(typeName as SagaStepType)) continue;
      if (declared.has(nodeId)) continue;
      declared.set(nodeId, {
        id: nextSagaStepId(),
        type: typeName as SagaStepType,
        label: "",
        props: parseStepProps(rest ?? ""),
      });
      continue;
    }
    if (line.startsWith("%%")) continue;

    for (const match of line.matchAll(nodeLabel)) {
      const id = match[1]!;
      const text = (match[2] ?? match[3] ?? match[4] ?? match[5] ?? "").trim();
      if (text && !labels.has(id)) labels.set(id, text);
    }

    edge.lastIndex = 0;
    let match: RegExpExecArray | null;
    // Not matchAll: the body rewinds lastIndex so a chained `A --> B --> C`
    // yields both edges, and matchAll owns the cursor.
    // standard exec-loop idiom
    while ((match = edge.exec(line)) !== null) {
      const from = match[1]!;
      const to = match[2]!;
      if (!next.has(from)) next.set(from, to);
      hasIncoming.add(to);
      edge.lastIndex = match.index + match[0].length - to.length;
    }
  }

  // Walk the chain from its head so the list opens in execution order.
  const ordered: SagaStep[] = [];
  const seen = new Set<string>();
  const heads = [...next.keys()].filter((id) => !hasIncoming.has(id));
  for (const head of heads) {
    let cursor: string | undefined = head;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const step = declared.get(cursor);
      if (step) ordered.push({ ...step, label: labels.get(cursor) ?? step.label });
      cursor = next.get(cursor);
    }
  }
  for (const [id, step] of declared) {
    if (!seen.has(id)) ordered.push({ ...step, label: labels.get(id) ?? step.label });
  }

  return { steps: ordered, trigger: "rule", operation: "CREATE" };
}

/**
 * Write the editable model back out as a flowchart plus `%%step` directives.
 *
 * Emits a start and end terminal so the diagram reads as a process even before
 * any step is added, and so a reader can tell at a glance where it begins.
 */
export function emitSagaFlow(flow: SagaFlow): string {
  const lines = ["flowchart TD"];
  const ids = ["Start", ...flow.steps.map((_step, index) => stepNodeId(index)), "Done"];

  lines.push(`    Start([Start])`);
  flow.steps.forEach((step, index) => {
    const label = (step.label || step.type).replace(/[[\]{}()|]/g, " ").trim();
    lines.push(`    ${stepNodeId(index)}[${label}]`);
  });
  lines.push(`    Done([Done])`);
  lines.push("");
  for (let index = 0; index < ids.length - 1; index++) {
    lines.push(`    ${ids[index]} --> ${ids[index + 1]}`);
  }

  if (flow.steps.length) lines.push("");
  flow.steps.forEach((step, index) => {
    const JSON_PROPS = ["fields", "decisionTable"];
    const props = Object.entries(step.props)
      .filter(([key, value]) => value?.trim() && !JSON_PROPS.includes(key))
      .map(([key, value]) => `${key}: ${value.trim()}`);
    // JSON values go last — every other value ends at the next `key:` token,
    // and JSON is full of them. Only one of these is ever set on a step.
    for (const key of JSON_PROPS) {
      const value = step.props[key]?.trim();
      if (value) props.push(`${key}: ${value}`);
    }
    lines.push(
      `    %%step ${stepNodeId(index)} ${step.type}${props.length ? ` ${props.join(" ")}` : ""}`
    );
  });

  return lines.join("\n");
}

/**
 * The same requirements the checker enforces on the model and the executor
 * enforces at runtime, surfaced while the step is being drawn.
 */
export function validateSagaFlow(flow: SagaFlow): string[] {
  const problems: string[] = [];
  if (!flow.steps.length) return ["No steps yet — add the first one."];

  const published = new Set<string>();

  flow.steps.forEach((step, index) => {
    const at = `Step ${index + 1}`;
    const has = (key: string) => (step.props[key] ?? "").trim().length > 0;

    if (step.type === "Formula") {
      if (!has("target")) problems.push(`${at}: name the variable to store the result in.`);
      const operation = (step.props.operation ?? "").trim();
      if (!operation) problems.push(`${at}: choose an operation.`);
      else if (operation === "set" && !has("value")) problems.push(`${at}: give a value to stage.`);
      else if (operation === "copy" && !has("source"))
        problems.push(`${at}: name the variable to copy from.`);
      else if (operation !== "set" && operation !== "copy" && (!has("source") || !has("operand")))
        problems.push(`${at}: ${operation} needs both a source variable and an operand.`);
    }

    if (step.type === "CreateEntity") {
      if (!has("entity")) problems.push(`${at}: choose the entity to insert into.`);
      if (!has("fields")) problems.push(`${at}: set at least one column.`);
      else {
        try {
          const parsed = JSON.parse(step.props.fields!);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
          if (!Object.keys(parsed).length) problems.push(`${at}: set at least one column.`);
        } catch {
          problems.push(`${at}: the columns must be a JSON object, e.g. {"status":"open"}.`);
        }
      }
    }

    if (step.type === "UpdateEntity") {
      if (!has("field")) problems.push(`${at}: choose the column to write.`);
      if (!has("value") && !has("source"))
        problems.push(`${at}: give a literal value or a variable to read from.`);
    }

    if (step.type === "REST" && !has("url")) problems.push(`${at}: give the URL to call.`);

    // The executor refuses a cross-entity write it cannot aim at a row.
    if (
      (step.type === "UpdateEntity" || step.type === "DeleteEntity") &&
      has("entity") &&
      !has("targetSource") &&
      (step.props.targetField ?? "id").trim() === "id"
    ) {
      problems.push(
        `${at}: say which row of ${step.props.entity} — a variable holding its id, or a foreign key column to match on.`
      );
    }

    const reference = (step.props.targetSource ?? "").trim();
    if (reference && !published.has(reference)) {
      problems.push(
        `${at}: nothing before it stores "${reference}" — unless that is a column of the triggering record.`
      );
    }

    if (step.type === "CreateEntity") {
      const bound =
        (step.props.as ?? "").trim() ||
        ((step.props.entity ?? "").trim()
          ? `${step.props.entity!.trim().replace(/^bus_/, "")}Id`
          : "");
      if (bound) published.add(bound);
    }
    if (step.type === "Formula" && has("target")) published.add(step.props.target!.trim());
  });

  return problems;
}
