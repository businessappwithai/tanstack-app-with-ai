/**
 * The reporting application's activity log — `rpt_activity_log`.
 *
 * Written by the sign-in, by every report and chart run, and by every
 * administrator change; read by the System Logs screen. A failure to write it
 * is swallowed: the log records what happened, and losing a line of it must
 * never be the reason a report did not run or a sign-in was refused.
 *
 * Nothing that could carry business data goes in `detail` — no row values, no
 * passwords, and never a query's result. A refusal names the tables it refused,
 * which is the one thing the reader needs to see.
 */
export async function logReportActivity(db, entry) {
  try {
    await db.insert("rpt_activity_log", {
      rpt_user_id: entry.user?.id ?? null,
      email: entry.user?.email ?? entry.email ?? null,
      action: entry.action,
      target: entry.target ?? null,
      outcome: entry.outcome,
      detail: entry.detail ?? null,
      duration_ms: entry.durationMs ?? null,
    });
  } catch {
    // Deliberately ignored — see above.
  }
}
