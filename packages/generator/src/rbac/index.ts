/**
 * `%%rbac` directives → per-operation access rules.
 *
 * The directive was reserved for a long time: documented, renderer-safe, and
 * read by nobody, so a model could declare `%%rbac role:admin on Order.delete`
 * and every signed-in user could still delete orders. This module is what makes
 * it mean something.
 *
 * ## It restricts; it does not grant
 *
 * An `(entity, operation)` pair carrying no `%%rbac` directive is unrestricted —
 * anyone the session guard admits may perform it. One or more directives turn
 * that pair into a closed list: the caller must hold at least one of the named
 * roles, or a master role.
 *
 * The alternative reading — every operation denied until granted — is the
 * stricter default and the wrong one here. It would silently lock every user
 * out of every existing model on the next regeneration, and a model that says
 * nothing about permissions is a model whose author has not thought about them
 * yet, not one that wants everything forbidden.
 *
 * ## Why this does not write `sys_access`
 *
 * `sys_access` looks like the natural home and is not. It is a *grant* table
 * whose rows feed `sys_refresh_dictionary_scope()`, which recomputes
 * `allowed_roles` on every dictionary table: a table with no `sys_access` rows
 * is visible to all roles, and the first row added narrows it to that role
 * alone. Seeding one from `%%rbac role:admin on Order.delete` would therefore
 * hide the Order window from everybody except admin — a restriction on deleting
 * silently becoming a restriction on looking. The two concerns need two tables,
 * so operation rules live in `sys_operation_access`.
 */

import { LIFECYCLE_DRAFT, normalizeEvent, REOPEN_EVENT } from "../../../../language/state-field";

/** The CRUD operations an `%%rbac` directive may restrict. */
export const RBAC_OPERATIONS = ["create", "read", "update", "delete"] as const;

export type RbacOperation = (typeof RBAC_OPERATIONS)[number];

/**
 * Aliases accepted for an operation, so a model may say what it means.
 *
 * `*` and `all` expand to every operation — a whole entity behind one role is
 * the common case and writing four directives for it is noise.
 */
const OPERATION_ALIASES: Record<string, RbacOperation | "*"> = {
  "*": "*",
  all: "*",
  any: "*",
  create: "create",
  insert: "create",
  add: "create",
  read: "read",
  view: "read",
  select: "read",
  list: "read",
  update: "update",
  edit: "update",
  write: "update",
  modify: "update",
  delete: "delete",
  remove: "delete",
  destroy: "delete",
};

/**
 * `%%rbac <roleExpr> on <Entity>.<target>` — the target is an operation, a move's
 * event (`close_won`), an edge the diagram did not label (`negotiation->closed_won`),
 * or `reopen`.
 */
const DIRECTIVE = /^%%rbac\s+(\S+)\s+on\s+([A-Za-z_]\w*)\.([A-Za-z_*][\w-]*(?:->[A-Za-z_]\w*)?)\s*$/;

/** One state change a transition rule covers: `from` → `to` on the status column. */
export interface RbacTransitionEdge {
  from: string;
  to: string;
}

/**
 * A restriction on moving a record along a named state-machine transition.
 *
 * `edges` rather than a single target state because a transition event may
 * appear more than once in a machine (two states that both `approve` into
 * `approved`). Carrying the `from` as well as the `to` keeps the rule precise:
 * restricting `approve` must not also restrict a different event that happens
 * to land on the same state.
 */
export interface CompiledRbacTransition {
  entity: string;
  tableName: string;
  /** The transition event as the model spells it, e.g. `convert`. */
  transition: string;
  edges: RbacTransitionEdge[];
  roles: string[];
}

/** One `(entity, operation)` pair and the roles permitted to perform it. */
export interface CompiledRbacRule {
  /** ERD entity name, as declared. */
  entity: string;
  /** Physical table the guard matches on, e.g. `bus_order`. */
  tableName: string;
  operation: RbacOperation;
  /** Role names permitted, de-duplicated and sorted. Never empty. */
  roles: string[];
}

/** Everything `%%rbac` compiles to. */
export interface CompiledRbac {
  /** CRUD restrictions, seeded into `sys_operation_access`. */
  operations: CompiledRbacRule[];
  /** State-transition restrictions, seeded into `sys_transition_access`. */
  transitions: CompiledRbacTransition[];
}

/** The shape `compileWorkflows` produces, repeated structurally to avoid the import cycle. */
export interface RbacStateMachine {
  entity: string;
  transitions: Array<{ from: string; to: string; trigger?: string }>;
  /** The states the diagram ends (`x --> [*]`) — the Final states a `reopen` leaves. */
  terminal?: string[];
}

/**
 * Read the role names out of a role expression.
 *
 * `role:admin`, `role:sales|manager` and `role:sales|role:manager` are all
 * accepted — the second is what the spec's example writes and the third is what
 * someone repeating the prefix naturally produces. A bare `admin` is taken as a
 * role name too, because rejecting it would fail a directive whose meaning is
 * unambiguous.
 */
export function parseRoleExpression(expression: string): string[] {
  const roles: string[] = [];
  for (const part of expression.split("|")) {
    const name = part
      .trim()
      .replace(/^role:/i, "")
      .trim();
    if (name) roles.push(name);
  }
  return roles;
}

/** `Order` → `bus_order`. Mirrors the ERD parser's table naming. */
function busTableName(entity: string): string {
  const snake = entity
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase()
    .replace(/^_/, "");
  return snake.startsWith("bus_") || snake.startsWith("sys_") ? snake : `bus_${snake}`;
}

/**
 * Compile every `%%rbac` directive in a document.
 *
 * Directives naming the same target are merged rather than overriding one
 * another: two lines each naming a role mean either role may perform it, which
 * is the reading that matches `|` inside a single directive.
 *
 * An operation name that is not CRUD is looked up among `stateMachines` as a
 * transition event on that entity. One that matches neither is skipped with a
 * warning naming both possibilities, because at that point the model has said
 * something the generator genuinely cannot act on.
 */
export function compileRbac(
  source: string,
  knownEntities: string[] = [],
  stateMachines: RbacStateMachine[] = [],
  onWarn: (message: string) => void = () => {}
): CompiledRbac {
  const known = new Set(knownEntities);

  /** `entity:operation` → role set. */
  const operations = new Map<
    string,
    { entity: string; operation: RbacOperation; roles: Set<string> }
  >();
  /** `entity:transition` → edges + role set. */
  const transitions = new Map<
    string,
    { entity: string; transition: string; edges: RbacTransitionEdge[]; roles: Set<string> }
  >();

  /**
   * Every `from -> to` edge a target names on an entity's machines.
   *
   * - an event: every edge it labels — a model's own `reopen` edge included, which
   *   wins over the lifecycle's;
   * - `from->to`: that drawn edge, or a Final state back to Draft (`closed_won->draft`);
   * - `reopen`, when no edge is labelled so: one edge from each Final state to Draft.
   */
  const edgesFor = (entity: string, target: string): RbacTransitionEdge[] => {
    const found: RbacTransitionEdge[] = [];
    const arrow = /^([A-Za-z_]\w*)->([A-Za-z_]\w*)$/.exec(target);
    for (const machine of stateMachines) {
      if (machine.entity !== entity) continue;
      const draft =
        machine.transitions
          .flatMap((edge) => [edge.from, edge.to])
          .find((state) => state.toLowerCase() === LIFECYCLE_DRAFT) ?? LIFECYCLE_DRAFT;
      for (const edge of machine.transitions) {
        if (arrow) {
          if (edge.from === arrow[1] && edge.to === arrow[2]) found.push({ from: edge.from, to: edge.to });
        } else if (edge.trigger && normalizeEvent(edge.trigger) === normalizeEvent(target)) {
          // Events are written as they read in a diagram (`close won`,
          // `counter-signed`); a directive spells the same thing in one token.
          found.push({ from: edge.from, to: edge.to });
        }
      }
      const finals = machine.terminal ?? [];
      if (arrow && found.length === 0 && finals.includes(arrow[1]!) && arrow[2] === draft) {
        found.push({ from: arrow[1]!, to: draft });
      }
      if (!arrow && found.length === 0 && normalizeEvent(target) === REOPEN_EVENT) {
        for (const from of finals) found.push({ from, to: draft });
      }
    }
    return found;
  };

  for (const rawLine of (source ?? "").split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("%%rbac")) continue;

    const match = line.match(DIRECTIVE);
    if (!match) {
      onWarn(`Skipping malformed %%rbac directive: ${line}`);
      continue;
    }

    const [, roleExpr, entity, rawTarget] = match as unknown as [string, string, string, string];

    if (known.size && !known.has(entity)) {
      onWarn(`%%rbac targets unknown entity "${entity}" — skipped.`);
      continue;
    }

    const roles = parseRoleExpression(roleExpr);
    if (roles.length === 0) {
      // A directive with no role names would compile to a rule nobody can
      // satisfy, locking the target for everyone including its author.
      onWarn(`%%rbac on ${entity}.${rawTarget} names no role — skipped.`);
      continue;
    }

    const resolved = OPERATION_ALIASES[rawTarget.toLowerCase()];
    if (resolved) {
      const ops: RbacOperation[] = resolved === "*" ? [...RBAC_OPERATIONS] : [resolved];
      for (const operation of ops) {
        const key = `${entity}:${operation}`;
        const existing = operations.get(key);
        if (existing) {
          for (const role of roles) existing.roles.add(role);
        } else {
          operations.set(key, { entity, operation, roles: new Set(roles) });
        }
      }
      continue;
    }

    // A move: the roles that may press the button for these edges. The record's
    // lifecycle moves only along a drawn edge, so a target that draws none says
    // something the application cannot act on.
    const edges = edgesFor(entity, rawTarget);
    if (edges.length === 0) {
      onWarn(
        `%%rbac on ${entity}.${rawTarget} names neither a CRUD operation ` +
          `(${RBAC_OPERATIONS.join(", ")}, *), a move in ${entity}'s state machine, nor ` +
          `${REOPEN_EVENT} — skipped.`
      );
      continue;
    }
    const transition = rawTarget.includes("->") ? rawTarget : normalizeEvent(rawTarget);
    const key = `${entity}:${transition}`;
    const existing = transitions.get(key);
    if (existing) {
      for (const role of roles) existing.roles.add(role);
    } else {
      transitions.set(key, { entity, transition, edges, roles: new Set(roles) });
    }
  }

  return {
    operations: [...operations.values()]
      .map(({ entity, operation, roles }) => ({
        entity,
        tableName: busTableName(entity),
        operation,
        roles: [...roles].sort(),
      }))
      .sort(
        (a, b) => a.tableName.localeCompare(b.tableName) || a.operation.localeCompare(b.operation)
      ),
    transitions: [...transitions.values()]
      .map(({ entity, transition, edges, roles }) => ({
        entity,
        tableName: busTableName(entity),
        transition,
        edges,
        roles: [...roles].sort(),
      }))
      .sort(
        (a, b) => a.tableName.localeCompare(b.tableName) || a.transition.localeCompare(b.transition)
      ),
  };
}

/** Every distinct role named across every compiled rule, sorted. */
export function rbacRoleNames(compiled: CompiledRbac): string[] {
  return [
    ...new Set([
      ...compiled.operations.flatMap((rule) => rule.roles),
      ...compiled.transitions.flatMap((rule) => rule.roles),
    ]),
  ].sort();
}

/** True when the model declared any restriction at all. */
export function hasRbacRules(compiled: CompiledRbac): boolean {
  return compiled.operations.length > 0 || compiled.transitions.length > 0;
}
