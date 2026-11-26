/**
 * The reporting application's administration — `/report-admin`.
 *
 * The Enterprise Reporting platform gives its administrators Users, Roles,
 * Permissions, Data Sources and System Logs. In the browser build those are
 * real here too, over the tables this tab already enforces from:
 *
 *   rpt_user, rpt_role     who may sign in, and as which reporting role
 *   rpt_role_tables        which of the application's tables a role may read —
 *                          read by `resolveReportSession` on every request, so
 *                          a grant changed here applies to the next query
 *   rpt_activity_log       sign-ins, runs, refusals and the changes made here
 *
 * The seed writes these once, from the model's `%%rbac`; after that they are
 * the administrator's. A change here is not undone by a reload.
 *
 * Every route is administrator-only, decided on the server. The client hides
 * the section from anyone else, and that is a courtesy rather than the control.
 */

import { Router } from "../lib/router.js";
import { hashPassword } from "../lib/auth.js";
import { badRequest, conflict, forbidden, json, notFound, readJson, unauthorized } from "../lib/http.js";
import { ident } from "../lib/db.js";
import { logReportActivity } from "../lib/report-log.js";

const EMAIL = /^[^\s@]+@[^\s@]+$/;
const MIN_PASSWORD = 5;

export function reportAdminRoutes(model) {
  const router = new Router();
  const pack = model.reporting || {};

  /** The application's tables — the only names a grant may carry. */
  const entities = (model.entities || []).map((entity) => ({
    table: entity.tableName,
    entity: entity.name,
    displayName: entity.displayName || entity.name,
    description: entity.description || null,
    category: entity.category || null,
  }));
  const knownTables = new Set(entities.map((entity) => entity.table));

  router.use(async (_request, { reportUser }) => {
    if (!reportUser) throw unauthorized("Sign in to the reporting application to continue");
    if (!reportUser.isAdmin) throw forbidden("Only a reporting administrator may do this");
  });

  const audit = (db, reportUser, action, target, detail) =>
    logReportActivity(db, { user: reportUser, action, target, outcome: "ok", detail });

  async function roleOr404(db, id) {
    const role = await db.one("SELECT * FROM rpt_role WHERE rpt_role_id = $1", [id]);
    if (!role) throw notFound("No such reporting role");
    return role;
  }

  async function userOr404(db, id) {
    const user = await db.one("SELECT * FROM rpt_user WHERE rpt_user_id = $1", [id]);
    if (!user) throw notFound("No such reporting user");
    return user;
  }

  // ── Users ──────────────────────────────────────────────────────────────────

  router.get("/users", async (_request, { db }) => {
    const rows = await db.query(
      `SELECT u.rpt_user_id, u.name, u.email, u.description, u.is_active, u.created_at,
              r.rpt_role_id, r.name AS role_name, r.is_admin,
              (SELECT MAX(l.occurred_at) FROM rpt_activity_log l
                WHERE l.rpt_user_id = u.rpt_user_id AND l.action = 'sign-in' AND l.outcome = 'ok') AS last_sign_in
         FROM rpt_user u
         LEFT JOIN rpt_role r ON r.rpt_role_id = u.rpt_role_id
        ORDER BY r.is_admin DESC NULLS LAST, u.name`
    );
    return json(
      rows.map((row) => ({
        id: row.rpt_user_id,
        name: row.name,
        email: row.email,
        description: row.description,
        isActive: row.is_active !== false,
        createdAt: row.created_at,
        lastSignIn: row.last_sign_in,
        roleId: row.rpt_role_id,
        role: row.role_name,
        isAdmin: row.is_admin === true,
      }))
    );
  });

  router.post("/users", async (request, { db, reportUser }) => {
    const body = await readJson(request);
    const name = String(body.name ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    if (!name) throw badRequest("A user needs a name");
    if (!EMAIL.test(email)) throw badRequest("That is not an email address");
    if (password.length < MIN_PASSWORD) {
      throw badRequest(`A password needs at least ${MIN_PASSWORD} characters`);
    }
    if (await db.one("SELECT 1 FROM rpt_user WHERE lower(email) = $1", [email])) {
      throw conflict(`${email} already has a reporting account`);
    }
    const roleId = body.roleId ? (await roleOr404(db, body.roleId)).rpt_role_id : null;

    const row = await db.insert("rpt_user", {
      name,
      email,
      password_hash: await hashPassword(password),
      rpt_role_id: roleId,
      is_active: true,
    });
    await audit(db, reportUser, "create user", email);
    return json({ id: row.rpt_user_id }, { status: 201 });
  });

  router.patch("/users/:id", async (request, { db, params, reportUser }) => {
    const user = await userOr404(db, params.id);
    const body = await readJson(request);
    const self = user.rpt_user_id === reportUser.id;
    const changes = {};
    const said = [];

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) throw badRequest("A user needs a name");
      changes.name = name;
      said.push("name");
    }
    if (body.roleId !== undefined) {
      const role = body.roleId ? await roleOr404(db, body.roleId) : null;
      // Demoting yourself is how an installation ends up with nobody who can
      // undo it — the platform refuses it for the same reason.
      if (self && !role?.is_admin) throw badRequest("You cannot remove your own administrator role");
      changes.rpt_role_id = role ? role.rpt_role_id : null;
      said.push(`role → ${role ? role.name : "none"}`);
    }
    if (body.isActive !== undefined) {
      if (self && !body.isActive) throw badRequest("You cannot deactivate your own account");
      changes.is_active = !!body.isActive;
      said.push(body.isActive ? "activated" : "deactivated");
    }
    if (body.password !== undefined) {
      const password = String(body.password);
      if (password.length < MIN_PASSWORD) {
        throw badRequest(`A password needs at least ${MIN_PASSWORD} characters`);
      }
      changes.password_hash = await hashPassword(password);
      said.push("password");
    }
    if (said.length === 0) throw badRequest("Nothing to change");

    await db.update("rpt_user", changes, { rpt_user_id: user.rpt_user_id });

    // A deactivated account, or one whose password changed, keeps no session
    // it already had — other than the administrator's own current one.
    if (changes.is_active === false || changes.password_hash) {
      await db.query("DELETE FROM rpt_session WHERE rpt_user_id = $1 AND token <> $2", [
        user.rpt_user_id,
        reportUser.token,
      ]);
    }
    await audit(db, reportUser, "update user", user.email, said.join(", "));
    return json({ success: true });
  });

  router.delete("/users/:id", async (_request, { db, params, reportUser }) => {
    const user = await userOr404(db, params.id);
    if (user.rpt_user_id === reportUser.id) throw badRequest("You cannot delete your own account");
    await db.remove("rpt_user", { rpt_user_id: user.rpt_user_id });
    await audit(db, reportUser, "delete user", user.email);
    return json({ success: true });
  });

  // ── Roles and their table grants ───────────────────────────────────────────

  router.get("/roles", async (_request, { db }) => {
    const roles = await db.query(
      `SELECT r.*, (SELECT COUNT(*) FROM rpt_user u WHERE u.rpt_role_id = r.rpt_role_id) AS users
         FROM rpt_role r
        ORDER BY r.is_admin DESC, r.name`
    );
    const grants = await db.query("SELECT rpt_role_id, table_name FROM rpt_role_tables ORDER BY table_name");
    const byRole = new Map();
    for (const grant of grants) {
      if (!byRole.has(grant.rpt_role_id)) byRole.set(grant.rpt_role_id, []);
      byRole.get(grant.rpt_role_id).push(grant.table_name);
    }
    return json(
      roles.map((role) => ({
        id: role.rpt_role_id,
        name: role.name,
        declaredAs: role.declared_as,
        description: role.description,
        isAdmin: role.is_admin === true,
        createdAt: role.created_at,
        users: Number(role.users ?? 0),
        tables: role.is_admin === true ? null : byRole.get(role.rpt_role_id) ?? [],
      }))
    );
  });

  router.post("/roles", async (request, { db, reportUser }) => {
    const body = await readJson(request);
    const name = String(body.name ?? "").trim();
    if (!name) throw badRequest("A role needs a name");
    if (await db.one("SELECT 1 FROM rpt_role WHERE lower(name) = lower($1)", [name])) {
      throw conflict(`A role named ${name} already exists`);
    }
    const row = await db.insert("rpt_role", {
      name,
      description: String(body.description ?? "").trim() || null,
      is_admin: false,
    });
    await audit(db, reportUser, "create role", name);
    return json({ id: row.rpt_role_id }, { status: 201 });
  });

  router.patch("/roles/:id", async (request, { db, params, reportUser }) => {
    const role = await roleOr404(db, params.id);
    const body = await readJson(request);
    const changes = {};
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) throw badRequest("A role needs a name");
      const clash = await db.one(
        "SELECT 1 FROM rpt_role WHERE lower(name) = lower($1) AND rpt_role_id <> $2",
        [name, role.rpt_role_id]
      );
      if (clash) throw conflict(`A role named ${name} already exists`);
      changes.name = name;
    }
    if (body.description !== undefined) changes.description = String(body.description).trim() || null;
    if (Object.keys(changes).length === 0) throw badRequest("Nothing to change");
    await db.update("rpt_role", changes, { rpt_role_id: role.rpt_role_id });
    await audit(db, reportUser, "update role", role.name, Object.keys(changes).join(", "));
    return json({ success: true });
  });

  /**
   * Replace the tables a role may read. The administrator role has no rows —
   * an empty scope there means "every table" — so it cannot be narrowed here,
   * and a name that is not one of the application's tables is refused rather
   * than stored as a grant that could never match anything.
   */
  router.put("/roles/:id/tables", async (request, { db, params, reportUser }) => {
    const role = await roleOr404(db, params.id);
    if (role.is_admin) throw badRequest("The administrator role reads every table and is not scoped");
    const body = await readJson(request);
    const tables = [...new Set((Array.isArray(body.tables) ? body.tables : []).map(String))];
    const unknown = tables.filter((table) => !knownTables.has(table));
    if (unknown.length > 0) throw badRequest(`Not tables of this application: ${unknown.join(", ")}`);

    await db.query("DELETE FROM rpt_role_tables WHERE rpt_role_id = $1", [role.rpt_role_id]);
    for (const table of tables) {
      await db.query("INSERT INTO rpt_role_tables (rpt_role_id, table_name) VALUES ($1, $2)", [
        role.rpt_role_id,
        table,
      ]);
    }
    await audit(db, reportUser, "update permissions", role.name, `${tables.length} of ${knownTables.size} tables`);
    return json({ success: true, tables: tables.sort() });
  });

  router.delete("/roles/:id", async (_request, { db, params, reportUser }) => {
    const role = await roleOr404(db, params.id);
    if (role.is_admin) throw badRequest("The administrator role cannot be deleted");
    // Its users are kept and left holding no role — `ON DELETE SET NULL` —
    // which reads nothing, the safe direction for an access change to fail in.
    await db.remove("rpt_role", { rpt_role_id: role.rpt_role_id });
    await audit(db, reportUser, "delete role", role.name);
    return json({ success: true });
  });

  // ── Data sources ───────────────────────────────────────────────────────────

  /**
   * The one data source the pack registers: this application's own database.
   * Row counts are read live, so the screen says what a query would find now.
   */
  router.get("/data-sources", async (_request, { db }) => {
    const tables = [];
    for (const entity of entities) {
      let rows = null;
      try {
        rows = Number(await db.value(`SELECT COUNT(*) FROM ${ident(entity.table)}`));
      } catch {
        rows = null;
      }
      tables.push({ ...entity, rows });
    }
    return json([
      {
        name: pack.dataSource?.name ?? model.project?.name ?? "Application database",
        description: pack.dataSource?.description ?? null,
        clientType: pack.dataSource?.clientType ?? "pg",
        database: pack.application?.databaseName ?? null,
        engine: "PostgreSQL (WebAssembly, in this tab)",
        status: "connected",
        tables,
      },
    ]);
  });

  // ── System logs ────────────────────────────────────────────────────────────

  router.get("/logs", async (request, { db }) => {
    const url = new URL(request.url, "http://localhost");
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 200, 1), 1000);
    const outcome = url.searchParams.get("outcome");
    const rows = outcome
      ? await db.query(
          "SELECT * FROM rpt_activity_log WHERE outcome = $1 ORDER BY occurred_at DESC LIMIT $2",
          [outcome, limit]
        )
      : await db.query("SELECT * FROM rpt_activity_log ORDER BY occurred_at DESC LIMIT $1", [limit]);
    return json(
      rows.map((row) => ({
        id: row.rpt_activity_log_id,
        at: row.occurred_at,
        email: row.email,
        action: row.action,
        target: row.target,
        outcome: row.outcome,
        detail: row.detail,
        durationMs: row.duration_ms,
      }))
    );
  });

  return router;
}
