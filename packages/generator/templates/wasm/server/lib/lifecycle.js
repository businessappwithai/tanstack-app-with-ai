/**
 * A record's lifecycle — Draft, its status flow, Final — and its moves.
 *
 * The JS twin of the NestJS stack's `common/lifecycle.ts`, read from the same
 * data: `model.lifecycle` is the `lifecycleTable` that module is written from,
 * so one model gives both stacks the same moves and the same lock.
 *
 * A record moves only when someone presses one of its moves: an edge its state
 * diagram drew, or Reopen from the end of its flow back to Draft. Every end
 * state is Final, and Final is locked. A record with no flow is never locked.
 *
 * Who may press a move is the model's `%%rbac` (`model.rbac.transitions`): a
 * move it names belongs to those roles; one it does not is open to whoever may
 * update the record; Reopen it does not name is the administrator's alone.
 */

import { holdsRole } from "./guards.js";

export const LIFECYCLE_ERROR = "error";
export const REOPEN_EVENT = "reopen";

/** The lifecycle of a table, or null. */
export function lifecycleOf(model, tableName) {
  return model?.lifecycle?.[tableName] ?? null;
}

/** "draft" | "active" | "final" | "error". */
export function phaseOf(lifecycle, value) {
  const text = value == null ? "" : String(value);
  if (text === LIFECYCLE_ERROR) return "error";
  if (lifecycle.terminal.includes(text)) return "final";
  if (text === "" || text === lifecycle.draft) return "draft";
  return lifecycle.hasMachine ? "active" : "draft";
}

/** The end of a flow: Final, and locked until reopened. */
export function isLocked(lifecycle, value) {
  return !!lifecycle?.hasMachine && phaseOf(lifecycle, value) === "final";
}

/** Every move out of a value: the drawn edges, and Reopen from a locked end state. */
export function movesFrom(lifecycle, value) {
  const from = value == null ? "" : String(value);
  const moves = lifecycle.edges
    .filter((edge) => edge.from === from)
    .map((edge) => ({ ...edge, kind: "move" }));
  if (isLocked(lifecycle, from) && !moves.some((move) => move.to === lifecycle.draft)) {
    moves.push({ from, to: lifecycle.draft, event: REOPEN_EVENT, label: "Reopen", kind: "reopen" });
  }
  return moves;
}

const oneToken = (text) => String(text ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");

/** The move a request names, by its event or by the state it goes to. */
export function findMove(lifecycle, value, wanted) {
  const event = wanted.event ? oneToken(wanted.event) : "";
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

/** The roles `%%rbac` gives this move, or [] when it names none. */
export function moveRoles(model, tableName, move) {
  const roles = new Set();
  for (const rule of model?.rbac?.transitions || []) {
    if (rule.tableName !== tableName) continue;
    if ((rule.edges || []).some((edge) => edge.from === move.from && edge.to === move.to)) {
      for (const role of rule.roles || []) roles.add(role);
    }
  }
  return [...roles];
}

/**
 * May this person press this move? `mayUpdate` answers the fallback for a move
 * nobody restricted — whether they may update the record at all.
 */
export async function mayPress(user, model, tableName, move, mayUpdate) {
  const roles = moveRoles(model, tableName, move);
  if (user?.isAdmin) return { allowed: true, roles };
  if (roles.length > 0) return { allowed: holdsRole(user, roles), roles };
  if (move.kind === "reopen") return { allowed: false, roles: [] };
  return { allowed: await mayUpdate(), roles: [] };
}
