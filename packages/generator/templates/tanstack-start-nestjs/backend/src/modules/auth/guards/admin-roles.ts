/**
 * Who counts as an administrator — one reading, for every guard that asks.
 *
 * Roles arrive in four places: `sysRoles` (read out of `sys_user_roles` by the session guard),
 * `roles`, Better Auth's own `role`, and the `isMaster` flag. They are matched
 * case-insensitively because the seeded role is `Administrator` and Better Auth says `admin`.
 * `DictionaryWriteGuard` and `AdminOnlyGuard` both call this, so they cannot disagree.
 */

export const ADMIN_ROLES = ['admin', 'administrator'] as const;

export interface RoleBearer {
  isMaster?: boolean;
  sysRoles?: unknown[];
  roles?: unknown[];
  role?: unknown;
}

/** Every role name the user holds, lower-cased. */
export function heldRoles(user: RoleBearer | null | undefined): Set<string> {
  const held = new Set<string>();
  if (!user) return held;
  for (const value of [...(user.sysRoles ?? []), ...(user.roles ?? [])]) {
    if (typeof value === 'string' && value) held.add(value.toLowerCase());
  }
  if (typeof user.role === 'string' && user.role) held.add(user.role.toLowerCase());
  return held;
}

export function isAdministrator(user: RoleBearer | null | undefined): boolean {
  if (!user) return false;
  if (user.isMaster === true) return true;
  const held = heldRoles(user);
  return ADMIN_ROLES.some((role) => held.has(role));
}
