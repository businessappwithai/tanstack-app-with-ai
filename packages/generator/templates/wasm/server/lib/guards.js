/**
 * Access control — what `%%rbac` compiled to, enforced.
 *
 * The directive restricts; it does not grant. A target no row names is open to
 * any authenticated caller, so a model that declares no `%%rbac` generates an
 * application that behaves exactly as it did before the feature existed. That
 * is the property worth protecting here: the temptation is to read an empty
 * rule set as "deny everything", which turns adding one directive into locking
 * every other entity.
 *
 * Role names match case-insensitively, and a role flagged `is_admin` bypasses —
 * both because a model writes `role:sales_manager` while the dictionary seeds
 * `Sales Manager`, and because an application whose administrator can be locked
 * out of it by its own model is unusable.
 */

import { forbidden, unauthorized } from "./http.js";

const normalize = (value) => String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");

export function holdsRole(user, roleNames) {
  if (!user) return false;
  if (user.isAdmin) return true;
  const held = new Set((user.roles || []).map(normalize));
  return roleNames.some((role) => held.has(normalize(role)));
}

/**
 * The business tables this user may look at, or `null` for "all of them".
 *
 * `null` rather than a set of everything, and the distinction is the whole
 * point: a model that declares no `read` restriction anywhere must behave
 * exactly as it did before roles existed, and a caller that has to tell "no
 * restrictions" from "restricted to nothing" cannot do that with a set.
 *
 * Only `read` narrows this. A model restricting *deletion* of Order to
 * administrators is saying something about deleting; hiding the Order window
 * from everyone would be answering a question it did not ask. Reading is the
 * one operation where the two coincide — a role that may not read an entity has
 * no use for a menu item that refuses it.
 */
export function readableTables(user, model) {
  const visibility = model?.entityVisibility;
  if (!visibility || Object.keys(visibility).length === 0) return null;
  if (user?.isAdmin) return null;

  const tableOf = new Map((model.entities || []).map((entity) => [entity.name, entity.tableName]));
  const allowed = new Set();

  for (const entity of model.entities || []) {
    const roles = visibility[entity.name];
    /* An entity nobody restricted stays open — the same rule one level up. */
    if (!roles || roles.length === 0) allowed.add(entity.tableName);
    else if (holdsRole(user, roles)) allowed.add(entity.tableName);
  }

  /* Dictionary tables are not business entities and are governed by the write
     guard, not by this. Leaving them out would empty every screen. */
  for (const [, tableName] of tableOf) if (!String(tableName).startsWith("bus_")) allowed.add(tableName);

  return allowed;
}

export function requireUser(user) {
  if (!user) throw unauthorized("Sign in to continue");
  return user;
}

export function requireAdmin(user) {
  requireUser(user);
  if (!user.isAdmin) throw forbidden("Administrator role required");
  return user;
}

/**
 * CRUD access for one entity operation.
 *
 * Rows are read for the exact operation and for `*`; a directive written as
 * `%%rbac role:admin on Order.*` has to restrict `read` as well as `delete`,
 * and a read restriction a sibling route ignores is not a restriction.
 */
export async function checkOperationAccess(db, user, tableName, operation) {
  requireUser(user);
  const rows = await db.query(
    `SELECT role_name FROM sys_operation_access
      WHERE table_name = $1 AND operation IN ($2, '*') AND is_active = true`,
    [tableName, operation]
  );
  if (!rows.length) return;
  if (!holdsRole(user, rows.map((row) => row.role_name))) {
    throw forbidden(
      `Your roles do not permit ${operation} on ${tableName} (requires ${[...new Set(rows.map((r) => r.role_name))].join(" or ")})`
    );
  }
}
