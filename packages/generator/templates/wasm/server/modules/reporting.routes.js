/**
 * `/reporting` — the Enterprise Reporting platform's surface, in a browser tab.
 *
 * The platform stores reports, charts and dashboards as definitions over saved
 * SQL queries, and holds a role table deciding which of a data source's tables
 * a reporting user's queries may read. These routes serve exactly those
 * definitions, from the pack the generator derived, against the same PGlite
 * database the application uses as its data source.
 *
 * What is the same as the deployed platform: the definitions, the roles, which
 * tables each role reads, and the refusal when a query names a table the role
 * does not.
 *
 * What is not: there is no SQL editor, nothing here writes a definition, and
 * the platform's NL→SQL pipeline, scheduled deliveries and knowledge graph need
 * servers this runtime does not have. The screens say so rather than offering
 * buttons that fail. Who may read which table *is* editable, by a reporting
 * administrator, through `report-admin.routes.js`.
 *
 * ## Access
 *
 * A query declares the `bus_` tables it reads (`SavedQuerySpec.tables`, filled
 * in where the pack is derived). A role either reads every table or reads a
 * named set, and a query is visible when every table it names is in that set.
 * Checked twice on purpose: once when listing, so a report a role cannot run is
 * not offered, and again when running, because a list is a convenience and the
 * refusal is the boundary. The platform does the same thing with a SQL parser
 * and `ds_entity_permissions`; here the tables are already known, so there is
 * nothing to parse.
 */

import { Router } from "../lib/router.js";
import { badRequest, forbidden, json, notFound, unauthorized } from "../lib/http.js";
import { logReportActivity } from "../lib/report-log.js";

/**
 * The most rows one report returns.
 *
 * A pack's query is free to have no LIMIT, and the derived ones mostly do have
 * one; an authored `%%report` need not. This is a browser tab holding the whole
 * database in memory, so "every row" is a question that ends the tab rather
 * than answering anything.
 */
const MAX_ROWS = 2000;

/**
 * A report may only read.
 *
 * Refused three times over: the checker at authoring time (`EML293`), the
 * compiler before the SQL can reach a pack, and here before the database is
 * handed a statement. `model.json` is a file in the application directory, and
 * the runtime should not execute SQL because a file said to.
 */
function assertReadOnly(sql) {
  const body = String(sql).replace(/;\s*$/, "");
  if (!/^\s*(?:with|select)\b/i.test(body)) {
    throw badRequest("A report query must be a SELECT or a WITH query.");
  }
  // A semicolon outside quotes is a second statement hiding behind the first.
  let quote = null;
  for (let index = 0; index < body.length; index++) {
    const ch = body[index];
    if (quote) {
      if (ch === quote) {
        if (body[index + 1] === quote) index += 1;
        else quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === ";") throw badRequest("A report query must be a single statement.");
  }
  return body;
}

function requireReportUser(reportUser) {
  if (!reportUser) throw unauthorized("Sign in to the reporting application to continue");
  return reportUser;
}

/** The tables a query reads that this role may not. Empty means it may run. */
function tablesRefused(reportUser, query) {
  if (!reportUser.tables) return [];
  return (query?.tables ?? []).filter((table) => !reportUser.tables.has(table));
}

export function reportingRoutes(model) {
  const router = new Router();
  const pack = model.reporting || {};

  const queries = pack.queries || [];
  const byQueryKey = new Map(queries.map((query) => [query.key, query]));
  const reports = pack.reports || [];
  const charts = pack.charts || [];
  const dashboards = pack.dashboards || [];

  router.use(async (_request, { reportUser }) => {
    requireReportUser(reportUser);
  });

  /** A report or chart is readable when the query behind it is. */
  const readable = (reportUser) => (item) =>
    tablesRefused(reportUser, byQueryKey.get(item.queryKey)).length === 0;

  /** What a caller sees of a definition: everything except the SQL. */
  const describe = (item) => {
    const query = byQueryKey.get(item.queryKey);
    const { sql: _sql, ...rest } = { ...item };
    return { ...rest, tables: query?.tables ?? [] };
  };

  router.get("/", async (_request, { reportUser }) => {
    const visibleReports = reports.filter(readable(reportUser));
    const visibleCharts = charts.filter(readable(reportUser));
    return json({
      application: pack.application ?? { name: model.project?.name },
      dataSource: pack.dataSource ?? null,
      role: {
        name: reportUser.role,
        isAdmin: reportUser.isAdmin,
        tables: reportUser.tables ? [...reportUser.tables].sort() : null,
        tableTotal: pack.access?.entityTotal ?? (model.entities || []).length,
      },
      counts: {
        /* Both numbers, always. "18 reports" on a scoped role is a number the
           reader cannot act on — "18 of 116" is the whole story of what the
           role did, and it is the only place in either application where the
           two halves of `%%rbac` can be compared side by side. */
        reports: visibleReports.length,
        reportsTotal: reports.length,
        charts: visibleCharts.length,
        chartsTotal: charts.length,
        dashboards: dashboards.length,
        queries: queries.filter((query) => tablesRefused(reportUser, query).length === 0).length,
      },
    });
  });

  router.get("/reports", async (_request, { reportUser }) =>
    json(reports.filter(readable(reportUser)).map(describe))
  );

  router.get("/charts", async (_request, { reportUser }) =>
    json(charts.filter(readable(reportUser)).map(describe))
  );

  /**
   * The dashboards, with the widgets this role cannot see removed.
   *
   * Removed rather than the dashboard being hidden: an overview of six tiles
   * where a role may read four is an overview of four, and a role whose
   * dashboard disappears entirely has been told less than one showing what it
   * does cover. `hiddenWidgets` says how many went, so the screen can say so
   * instead of quietly presenting a gap-toothed grid as complete.
   */
  router.get("/dashboards", async (_request, { reportUser }) =>
    json(
      dashboards.map((dashboard) => {
        const chartOf = new Map(charts.map((chart) => [chart.key, chart]));
        const reportOf = new Map(reports.map((report) => [report.key, report]));
        const widgets = (dashboard.widgets || []).filter((widget) => {
          // A tile is a chart or a report, and either one reads a query. Both
          // are held to the role's tables — a report tile used to pass
          // unchecked, and then refused itself on the dashboard with a 403.
          const target = widget.chartKey
            ? chartOf.get(widget.chartKey)
            : widget.reportKey
              ? reportOf.get(widget.reportKey)
              : null;
          if (!target) return !widget.chartKey && !widget.reportKey;
          return readable(reportUser)(target);
        });
        return {
          ...dashboard,
          widgets,
          hiddenWidgets: (dashboard.widgets || []).length - widgets.length,
        };
      })
    )
  );

  /**
   * Run one report or chart, by key.
   *
   * `kind` is in the path rather than guessed from the key, because a report
   * and the chart derived from the same query share one: the pack keys both
   * `account__by_status`, and a single lookup would answer whichever collection
   * was searched first.
   */
  router.get("/:kind/:key/run", async (_request, { db, params, reportUser }) => {
    const collection =
      params.kind === "reports" ? reports : params.kind === "charts" ? charts : null;
    if (!collection) throw notFound(`No reporting collection named "${params.kind}"`);

    const item = collection.find((candidate) => candidate.key === params.key);
    if (!item) throw notFound(`No ${params.kind.replace(/s$/, "")} named "${params.key}"`);

    const query = byQueryKey.get(item.queryKey);
    if (!query) {
      // The pack is internally inconsistent — a definition pointing at a query
      // that is not there. Say which, because the answer is in the generator.
      throw notFound(`"${item.name}" points at query "${item.queryKey}", which the pack has not`);
    }

    const refused = tablesRefused(reportUser, query);
    const action = `run ${params.kind.replace(/s$/, "")}`;
    if (refused.length > 0) {
      await logReportActivity(db, {
        user: reportUser,
        action,
        target: item.name,
        outcome: "refused",
        detail: `may not read ${refused.join(", ")}`,
      });
      throw forbidden(
        `${reportUser.role ?? "This role"} may not read ${refused.join(", ")}, which "${item.name}" queries.`
      );
    }

    const body = assertReadOnly(query.sql);
    const started = Date.now();

    // Wrapped rather than appended to: a pack's query may end in ORDER BY, a
    // LIMIT of its own or a comment, and adding to any of those changes what it
    // means. One row past the cap distinguishes a full page from a truncated
    // one without counting the whole thing twice.
    let rows;
    let numeric;
    try {
      ({ rows, numeric } = await db.queryWithNumeric(`SELECT * FROM (${body}) AS report_body LIMIT ${MAX_ROWS + 1}`));
    } catch (error) {
      // The query came out of the model, so this is a defect in the document or
      // in the derivation rather than in the request. Name the report and quote
      // the database — nobody can act on "the report failed".
      await logReportActivity(db, {
        user: reportUser,
        action,
        target: item.name,
        outcome: "failed",
        detail: error?.message || String(error),
        durationMs: Date.now() - started,
      });
      throw badRequest(
        `Report "${item.name}" failed: ${error?.message || String(error)}`
      );
    }

    await logReportActivity(db, {
      user: reportUser,
      action,
      target: item.name,
      outcome: "ok",
      detail: `${Math.min(rows.length, MAX_ROWS)} row${rows.length === 1 ? "" : "s"}`,
      durationMs: Date.now() - started,
    });

    const truncated = rows.length > MAX_ROWS;
    if (truncated) rows = rows.slice(0, MAX_ROWS);

    return json({
      definition: describe(item),
      query: { key: query.key, name: query.name, description: query.description, tables: query.tables },
      // Off the first row rather than a driver field list, so the column order
      // the query's own SELECT declares is the order it renders in.
      columns: rows.length > 0 ? Object.keys(rows[0]) : [],
      // Which of those are NUMERIC, which arrives as a string — see queryWithNumeric.
      numeric,
      rows,
      rowCount: rows.length,
      truncated,
      durationMs: Date.now() - started,
    });
  });

  /**
   * The saved queries, with their SQL.
   *
   * The SQL is shown here and withheld everywhere else, which is deliberate
   * rather than inconsistent: a reporting user's question about a number is
   * always "where did this come from", and the platform answers it with the
   * saved query the report is built on. Only the queries this role may run are
   * listed, so the screen is not a catalogue of what it cannot have.
   */
  router.get("/queries", async (_request, { reportUser }) =>
    json(
      queries
        .filter((query) => tablesRefused(reportUser, query).length === 0)
        .map((query) => ({ ...query }))
    )
  );

  return router;
}
