/**
 * The fixed half of the generated backend's `src/common/lifecycle.ts`.
 *
 * `renderLifecycle` writes one entry per business table between these two;
 * everything that reads an entry — the phase of a value, the moves out of a
 * state, whether a record is locked — is here, once, so the bus service, the
 * transition service and the access guard cannot read a lifecycle differently.
 * The vocabulary is language/state-field.ts's.
 */

import {
  DOC_STATUS_COLUMN,
  draftValueFor,
  LIFECYCLE_DRAFT,
  LIFECYCLE_ERROR,
  LIFECYCLE_FINAL,
  moveLabel,
  normalizeEvent,
  stateFieldOf,
} from "../../../../../language/state-field";
import type { CompiledWorkflow } from "../../workflows";

export const LIFECYCLE_MODULE_HEAD = `/**
 * Every business table's lifecycle — generated from the model, do not edit.
 *
 * A record is saved into Draft. With no status flow, a save that its rules and
 * workflows accept moves it to Final; one they refuse leaves it in Error with the
 * reason, and saving it again runs them again. With a status flow, the accepted
 * save moves it to the flow's first status, and from there it moves only when
 * someone presses a move along an edge the diagram drew. Every end state of a
 * flow is Final and locked: Reopen (a role the model names, or the
 * administrator) takes it back to Draft. A record with no flow is never locked:
 * each save of it runs Draft → Final again.
 *
 * Who may press a move is not stated here: that is sys_access_grant, which an
 * administrator can change in the running application.
 *
 * LIFECYCLES is the model's. An administrator can redraw a flow in Rules and
 * workflows (sys_workflow_definitions, kind = 'state'); lifecycleOf answers with
 * that one, so every reader follows the edit, and with the model's where there is
 * none.
 */

export type LifecyclePhase = 'draft' | 'active' | 'final' | 'error';

export interface LifecycleEdge {
  from: string;
  to: string;
  /** The edge's event, in one token (\`close_won\`); '' when the diagram did not label it. */
  event: string;
  /** What the button says. */
  label: string;
}

export interface Lifecycle {
  /** The column the lifecycle is stored in: the state field, else doc_status. */
  column: string;
  hasMachine: boolean;
  /** The value Draft is stored as. */
  draft: string;
  /** Where an accepted save sends a Draft record: the flow's first status, else 'final'. */
  afterDraft: string;
  /** The Final values: every state the diagram ends. */
  terminal: string[];
  /** The drawn edges, the only moves a record makes. */
  edges: LifecycleEdge[];
  /** Every value the column may hold. */
  values: string[];
}

export const LIFECYCLE_DRAFT = 'draft';
export const LIFECYCLE_FINAL = 'final';
export const LIFECYCLE_ERROR = 'error';
export const REOPEN_EVENT = 'reopen';

export const LIFECYCLES: Readonly<Record<string, Lifecycle>> = {
`;

export const LIFECYCLE_MODULE_TAIL = `
};

/**
 * The lifecycles an administrator changed in Rules and workflows, by table. A
 * table with no entry here runs the model's lifecycle above. The backend fills it
 * from sys_workflow_definitions (kind = 'state'); the front end from
 * GET /api/lifecycles.
 */
let overrides: Record<string, Lifecycle> = {};
let overridesVersion = 0;
const overrideListeners = new Set<() => void>();

/** A table's lifecycle: the administrator's, else the model's. Every business table has one. */
export function lifecycleOf(tableName: string): Lifecycle | undefined {
  return overrides[tableName] ?? LIFECYCLES[tableName];
}

/** The lifecycle the model declared, whatever an administrator has changed since. */
export function modelLifecycleOf(tableName: string): Lifecycle | undefined {
  return LIFECYCLES[tableName];
}

/** True when the table runs a lifecycle an administrator changed. */
export function isLifecycleOverridden(tableName: string): boolean {
  return !!overrides[tableName];
}

/**
 * Replace every administrator lifecycle at once. An entry for a table the model
 * gave no status flow is ignored: the column a lifecycle is stored in is schema,
 * so a flow can be changed here but not created.
 */
export function applyLifecycleOverrides(next: Record<string, Lifecycle | null | undefined>): void {
  const kept: Record<string, Lifecycle> = {};
  for (const [tableName, lifecycle] of Object.entries(next ?? {})) {
    const model = LIFECYCLES[tableName];
    if (!lifecycle || !model?.hasMachine) continue;
    kept[tableName] = { ...lifecycle, column: model.column, hasMachine: true };
  }
  overrides = kept;
  overridesVersion += 1;
  for (const listener of overrideListeners) listener();
}

/** Called after every applyLifecycleOverrides; returns the unsubscribe. */
export function subscribeLifecycles(listener: () => void): () => void {
  overrideListeners.add(listener);
  return () => {
    overrideListeners.delete(listener);
  };
}

/** Bumped by every applyLifecycleOverrides. */
export function lifecycleOverridesVersion(): number {
  return overridesVersion;
}

/** An edge's event in one token: \`close won\`, \`Close-Won\` and \`close_won\` are one event. */
export function normalizeLifecycleEvent(event: string): string {
  return event.trim().toLowerCase().replace(/[\\s-]+/g, '_');
}

/** What a button says: the status it moves to. The event stays the move's name, not its label. */
export function lifecycleMoveLabel(_event: string | undefined, to: string): string {
  const words = to.replace(/[_-]+/g, ' ').replace(/\\s+/g, ' ').trim();
  // An id written in capitals (\`QUALIFICATION\`) reads as a word, not a shout.
  const text = words === words.toUpperCase() ? words.toLowerCase() : words;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const DIAGRAM_EDGE = /^(\\[\\*\\]|[A-Za-z_]\\w*)\\s*-->\\s*(\\[\\*\\]|[A-Za-z_]\\w*)\\s*(?::\\s*(.+))?$/;

/**
 * A table's lifecycle read from a \`stateDiagram-v2\` the way the generator reads
 * the model's (\`[*] --> first\`, \`a --> b : event\`, \`end --> [*]\`; \`%%\` lines
 * ignored), on the model's column. Returns the problems instead when the diagram
 * cannot be a lifecycle: no first state, no end state, a reserved state name, or a
 * table the model gave no flow.
 */
export function lifecycleFromDiagram(
  tableName: string,
  diagram: string,
): { lifecycle?: Lifecycle; problems: string[] } {
  const model = LIFECYCLES[tableName];
  if (!model?.hasMachine) {
    return { problems: [\`\${tableName} has no status flow in the model, so it has no column to keep one in.\`] };
  }
  const states: string[] = [];
  const terminal: string[] = [];
  const edges: LifecycleEdge[] = [];
  let initial: string | undefined;
  const see = (name: string) => {
    if (name !== '[*]' && !states.includes(name)) states.push(name);
  };
  for (const raw of String(diagram ?? '').split('\\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('%%') || /^stateDiagram(-v2)?$/.test(line)) continue;
    const match = line.match(DIAGRAM_EDGE);
    if (!match) continue;
    const [, from, to, label] = match as unknown as [string, string, string, string | undefined];
    see(from);
    see(to);
    if (from === '[*]' && to === '[*]') continue;
    if (from === '[*]') {
      initial ??= to;
      continue;
    }
    if (to === '[*]') {
      if (!terminal.includes(from)) terminal.push(from);
      continue;
    }
    const event = label ? normalizeLifecycleEvent(label) : '';
    if (edges.some((edge) => edge.from === from && edge.to === to && edge.event === event)) continue;
    edges.push({ from, to, event, label: lifecycleMoveLabel(label, to) });
  }
  const problems: string[] = [];
  if (!initial) problems.push('The flow needs a first state: draw [*] --> <state>.');
  if (terminal.length === 0) problems.push('The flow needs at least one end state: draw <state> --> [*].');
  for (const reserved of [LIFECYCLE_FINAL, LIFECYCLE_ERROR]) {
    if (states.includes(reserved)) {
      problems.push(\`"\${reserved}" is the lifecycle's own; name the state something else.\`);
    }
  }
  if (problems.length > 0) return { problems };
  const draft = states.find((state) => state.toLowerCase() === LIFECYCLE_DRAFT) ?? LIFECYCLE_DRAFT;
  const values = [draft, ...states.filter((state) => state !== draft)];
  if (!values.includes(LIFECYCLE_ERROR)) values.push(LIFECYCLE_ERROR);
  return {
    lifecycle: {
      column: model.column,
      hasMachine: true,
      draft,
      afterDraft: initial!,
      terminal,
      edges,
      values,
    },
    problems: [],
  };
}

/** Where a value sits: Draft, part-way along the flow, Final, or Error. */
export function phaseOf(lifecycle: Lifecycle, value: unknown): LifecyclePhase {
  const text = value == null ? '' : String(value);
  if (text === LIFECYCLE_ERROR) return 'error';
  if (lifecycle.terminal.includes(text)) return 'final';
  if (text === '' || text === lifecycle.draft) return 'draft';
  return lifecycle.hasMachine ? 'active' : 'draft';
}

/** True when a record in this state is Final. */
export function isFinal(lifecycle: Lifecycle, value: unknown): boolean {
  return phaseOf(lifecycle, value) === 'final';
}

/**
 * True when a record in this state is locked: an end state of a flow. A record
 * with no flow is Final after every accepted save and stays editable — saving it
 * again is how it changes.
 */
export function isLocked(lifecycle: Lifecycle, value: unknown): boolean {
  return lifecycle.hasMachine && isFinal(lifecycle, value);
}

/**
 * Where a save goes, decided by where the record is. Draft and Error re-run the
 * save pipeline from Draft; part-way along the flow a save is an edit in place;
 * Final refuses it.
 */
export function saveMode(lifecycle: Lifecycle, value: unknown): 'pipeline' | 'in-place' | 'locked' {
  if (isLocked(lifecycle, value)) return 'locked';
  if (phaseOf(lifecycle, value) === 'active') return 'in-place';
  return 'pipeline';
}

export interface LifecycleMove extends LifecycleEdge {
  kind: 'move' | 'reopen';
}

/**
 * Every move out of a value: the drawn edges, and Reopen from a locked end state
 * back to Draft unless the diagram draws its own way out of that state.
 */
export function movesFrom(lifecycle: Lifecycle, value: unknown): LifecycleMove[] {
  const from = value == null ? '' : String(value);
  const moves: LifecycleMove[] = lifecycle.edges
    .filter((edge) => edge.from === from)
    .map((edge) => ({ ...edge, kind: 'move' as const }));
  if (isLocked(lifecycle, from) && !moves.some((move) => move.to === lifecycle.draft)) {
    moves.push({ from, to: lifecycle.draft, event: REOPEN_EVENT, label: 'Reopen', kind: 'reopen' });
  }
  return moves;
}

/** The move a request names, by its event or by the state it goes to. */
export function findMove(
  lifecycle: Lifecycle,
  value: unknown,
  wanted: { event?: string; to?: string },
): LifecycleMove | undefined {
  const event = wanted.event ? wanted.event.trim().toLowerCase().replace(/[\\s-]+/g, '_') : '';
  const moves = movesFrom(lifecycle, value);
  if (event && wanted.to) return moves.find((move) => move.event === event && move.to === wanted.to);
  if (event) {
    const named = moves.filter((move) => move.event === event);
    return named.length === 1 ? named[0] : undefined;
  }
  if (wanted.to) {
    const reaching = moves.filter((move) => move.to === wanted.to);
    return reaching.length === 1 ? reaching[0] : undefined;
  }
  return undefined;
}
`;

/** What `renderLifecycleModule` needs of an entity: its names, its table, its columns. */
export interface LifecycleEntity {
  name: string;
  className?: string;
  tableName: string;
  attributes?: Array<{ name?: string; columnName?: string }>;
}

const quote = (value: string) => `'${String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

/** One table's lifecycle as data — what `lifecycle.ts` holds and `model.json` carries. */
export interface LifecycleData {
  column: string;
  hasMachine: boolean;
  draft: string;
  afterDraft: string;
  terminal: string[];
  edges: Array<{ from: string; to: string; event: string; label: string }>;
  values: string[];
}

/** Every business table's lifecycle, keyed by table name. */
export function lifecycleTable(
  entities: LifecycleEntity[],
  workflows: CompiledWorkflow[]
): Record<string, LifecycleData> {
  const machineOf = (name?: string) =>
    name ? workflows.find((workflow) => workflow.entity === name) : undefined;
  const table: Record<string, LifecycleData> = {};
  for (const entity of entities) {
    const machine = machineOf(entity.name) ?? machineOf(entity.className);
    if (!machine) {
      table[entity.tableName] = {
        column: DOC_STATUS_COLUMN,
        hasMachine: false,
        draft: LIFECYCLE_DRAFT,
        afterDraft: LIFECYCLE_FINAL,
        terminal: [LIFECYCLE_FINAL],
        edges: [],
        values: [LIFECYCLE_DRAFT, LIFECYCLE_FINAL, LIFECYCLE_ERROR],
      };
      continue;
    }
    const columns = (entity.attributes ?? [])
      .map((attribute) => attribute.columnName ?? attribute.name)
      .filter((name): name is string => !!name);
    const draft = draftValueFor(machine);
    table[entity.tableName] = {
      column: stateFieldOf(columns) ?? "workflow_status",
      hasMachine: true,
      draft,
      afterDraft: machine.initial ?? draft,
      terminal: [...machine.terminal],
      edges: machine.transitions
        .filter((edge) => edge.from !== "[*]" && edge.to !== "[*]")
        .map((edge) => ({
          from: edge.from,
          to: edge.to,
          event: edge.trigger ? normalizeEvent(edge.trigger) : "",
          label: moveLabel(edge.trigger, edge.to),
        })),
      values: [...machine.lifecycleValues],
    };
  }
  return table;
}

/**
 * The whole `lifecycle.ts` module: one entry per business table between the fixed
 * head and tail. Both the backend (`src/common/lifecycle.ts`) and the front end
 * (`src/lib/lifecycle.ts`) are written from this one call, so the API and the
 * screen cannot read a lifecycle differently; the browser stack's `model.json`
 * carries the same `lifecycleTable`.
 */
export function renderLifecycleModule(
  entities: LifecycleEntity[],
  workflows: CompiledWorkflow[]
): string {
  const rows: string[] = [];
  for (const [tableName, lifecycle] of Object.entries(lifecycleTable(entities, workflows))) {
    if (!lifecycle.hasMachine) {
      rows.push(
        `  ${tableName}: { column: ${quote(lifecycle.column)}, hasMachine: false, draft: ${quote(lifecycle.draft)}, ` +
          `afterDraft: ${quote(lifecycle.afterDraft)}, terminal: [${lifecycle.terminal.map(quote).join(", ")}], edges: [], ` +
          `values: [${lifecycle.values.map(quote).join(", ")}] },`
      );
      continue;
    }
    rows.push(
      [
        `  ${tableName}: {`,
        `    column: ${quote(lifecycle.column)},`,
        `    hasMachine: true,`,
        `    draft: ${quote(lifecycle.draft)},`,
        `    afterDraft: ${quote(lifecycle.afterDraft)},`,
        `    terminal: [${lifecycle.terminal.map(quote).join(", ")}],`,
        `    edges: [`,
        ...lifecycle.edges.map(
          (edge) =>
            `      { from: ${quote(edge.from)}, to: ${quote(edge.to)}, event: ${quote(edge.event)}, ` +
            `label: ${quote(edge.label)} },`
        ),
        `    ],`,
        `    values: [${lifecycle.values.map(quote).join(", ")}],`,
        `  },`,
      ].join("\n")
    );
  }
  return LIFECYCLE_MODULE_HEAD + rows.join("\n") + LIFECYCLE_MODULE_TAIL;
}
