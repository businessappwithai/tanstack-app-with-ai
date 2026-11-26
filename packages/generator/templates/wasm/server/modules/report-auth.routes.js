/**
 * The reporting application's sign-in — the other login.
 *
 * Deliberately not a second door onto `/auth`. It reads `rpt_user`, writes
 * `rpt_session` and answers with a token the browser keeps under its own key,
 * so the two applications in this tab have two sessions and neither can be
 * mistaken for the other. That is what the deployed pair does with two servers
 * and two databases, and a reader who tries the application's password here and
 * is refused has seen the only thing about the arrangement that is easy to get
 * wrong.
 */

import { Router } from "../lib/router.js";
import { json, readJson, unauthorized } from "../lib/http.js";
import { verifyPassword } from "../lib/auth.js";
import {
  clearedReportSessionCookie,
  createReportSession,
  destroyReportSession,
  reportSessionCookie,
} from "../lib/report-auth.js";
import { logReportActivity } from "../lib/report-log.js";

/** What a caller may know about itself. Never the token or the hash. */
function present(reportUser) {
  return {
    id: reportUser.id,
    name: reportUser.name,
    email: reportUser.email,
    role: reportUser.role,
    declaredAs: reportUser.declaredAs,
    isAdmin: reportUser.isAdmin,
    /* An array, and `null` for unrestricted — the same distinction the server
       keeps, handed to the client so its own screens can say "every table"
       rather than counting to the total and hoping. */
    tables: reportUser.tables ? [...reportUser.tables].sort() : null,
  };
}

export function reportAuthRoutes(model) {
  const router = new Router();

  router.post("/login", async (request, { db }) => {
    const body = await readJson(request);
    const identifier = String(body.email ?? body.username ?? "")
      .trim()
      .toLowerCase();
    const password = String(body.password ?? "");

    const user = await db.one(
      `SELECT u.*, r.name AS role_name, r.is_admin
         FROM rpt_user u
         LEFT JOIN rpt_role r ON r.rpt_role_id = u.rpt_role_id
        WHERE lower(u.email) = $1 OR lower(split_part(u.email, '@', 1)) = $1
        LIMIT 1`,
      [identifier]
    );

    const ok =
      user && user.is_active !== false && (await verifyPassword(password, user.password_hash));
    if (!ok) {
      /*
       * One message for a wrong password and for an address that is not here.
       *
       * Two messages would say which addresses exist — and on this side of the
       * pair that is a longer list than a reader might expect, because every
       * `%%rbac` role has an account. The application's own sign-in makes the
       * same choice. The log records the address that was tried, which is
       * only ever shown to a reporting administrator.
       */
      await logReportActivity(db, { email: identifier, action: "sign-in", outcome: "refused" });
      throw unauthorized("Invalid email or password");
    }
    await logReportActivity(db, {
      user: { id: user.rpt_user_id, email: user.email },
      action: "sign-in",
      outcome: "ok",
      detail: user.role_name ? `as ${user.role_name}` : "holding no reporting role",
    });

    const token = await createReportSession(db, user.rpt_user_id, request.headers.get("user-agent"));
    return json(
      {
        user: {
          id: user.rpt_user_id,
          name: user.name,
          email: user.email,
          role: user.role_name || null,
          isAdmin: user.is_admin === true,
        },
        token,
      },
      { headers: { "Set-Cookie": reportSessionCookie(token) } }
    );
  });

  router.post("/logout", async (_request, { db, reportUser }) => {
    if (reportUser) await destroyReportSession(db, reportUser.token);
    return json({ success: true }, { headers: { "Set-Cookie": clearedReportSessionCookie() } });
  });

  router.get("/me", async (_request, { reportUser }) => {
    if (!reportUser) throw unauthorized("Sign in to the reporting application to continue");
    return json(present(reportUser));
  });

  /**
   * What the reporting sign-in screen offers.
   *
   * Every seeded reporting account, with the number of the application's tables
   * its role may read. That number is why the list is worth printing: a
   * reporting role is *only* a statement about what its queries may see, so
   * `support.agent@… — 5 of 17 tables` is the whole of what signing in as it
   * will do. The addresses are read out of the pack rather than out of the
   * table, so the screen says the same thing whether or not the seed ran.
   */
  router.get("/config", async (_request, { db }) => {
    const pack = model.reporting || {};
    const access = pack.access || {};
    const rows = await db.query(
      `SELECT u.email, u.name, r.name AS role_name, r.is_admin,
              (SELECT COUNT(*) FROM rpt_role_tables t WHERE t.rpt_role_id = r.rpt_role_id) AS tables
         FROM rpt_user u
         LEFT JOIN rpt_role r ON r.rpt_role_id = u.rpt_role_id
        ORDER BY r.is_admin DESC, u.email`
    );

    const total = access.entityTotal ?? (model.entities || []).length;
    const accounts = rows.map((row) => ({
      email: row.email,
      name: row.name,
      role: row.role_name || null,
      isAdmin: row.is_admin === true,
      /* An administrator has no rows, and that means every table rather than
         none. Reporting the raw count here is how a sign-in screen comes to
         offer "Administrator — 0 of 17". */
      tables: row.is_admin === true ? total : Number(row.tables ?? 0),
      total,
    }));

    return json({
      application: pack.application ?? { name: model.project?.name },
      dataSource: pack.dataSource ?? null,
      password: access.reportPassword ?? "admin",
      scoped: access.scoped ?? false,
      accounts,
      counts: {
        queries: (pack.queries || []).length,
        reports: (pack.reports || []).length,
        charts: (pack.charts || []).length,
        dashboards: (pack.dashboards || []).length,
      },
    });
  });

  return router;
}
