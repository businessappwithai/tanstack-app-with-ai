/**
 * `/reports` — the questions the model declared with `%%report`.
 *
 * Each one is a title, a sentence saying who asks it and why, and the SQL that
 * answers it. The queries run against this application's own WebAssembly
 * PostgreSQL, which is the whole reason they can be here at all: the reporting
 * platform the orchestrator composes beside a deployed application needs a
 * server, a second database and a seeder, and a browser tab has none of those.
 * The same directive, read a second way.
 *
 * **The reports are a table now, and that is a reversal.** This comment used to
 * say they were not: that they came off `model.json`, that the model *was* the
 * definition, and that "nothing in this runtime edits a report, so nothing needs
 * a row to edit". The last clause was the load-bearing one and it stopped being
 * true the moment the administrator section was asked to offer create, update
 * and delete — at which point "no row to edit" is not a design, it is the reason
 * the feature cannot exist.
 *
 * So `sys_report` is seeded from `model.json` at first boot and read from after
 * that, which is what `sys_rule_definitions` already did for rules and what the
 * Application Dictionary does for screens. The NestJS stack has had the same
 * table since migration 018, so this also closes a gap between the two rather
 * than inventing something for one of them.
 *
 * The concern the old comment had — a copy that can disagree with the model — is
 * real and is the point rather than a cost: an administrator who edits a report
 * *means* to disagree with the model, the same way one who hides a field does.
 * Regenerating restores the model's version, because the seed skips a report
 * whose name is already there and a regenerated application starts on an empty
 * database.
 */

import { Router } from "../lib/router.js";
import { badRequest, json, noContent, notFound, readJson } from "../lib/http.js";
import { requireAdmin, requireUser } from "../lib/guards.js";

/**
 * The most rows one report returns.
 *
 * A model's query is free to have no LIMIT, and most do — the interesting ones
 * are already narrowed by their WHERE clause. This is a browser tab holding the
 * whole database in memory, so "every row" is a question that ends the tab
 * rather than answering anything.
 */
const MAX_ROWS = 2000;

/**
 * A report may only read.
 *
 * The generator refuses a non-SELECT at compile time, so this is the second
 * check rather than the only one — but `model.json` is a file in the
 * application directory, and the runtime should not hand a statement to the
 * database because a file said to.
 */
function assertReadOnly(sql) {
  const body = String(sql).replace(/;\s*$/, "");
  if (!/^\s*(?:with|select)\b/i.test(body)) {
    throw badRequest("A report query must be a SELECT or a WITH query.");
  }
  // A semicolon outside quotes is a second statement hiding behind the first.
  let quote = null;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      if (ch === quote) {
        if (body[i + 1] === quote) i += 1;
        else quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === ";") throw badRequest("A report query must be a single statement.");
  }
  return body;
}

/**
 * A row as the rest of the application talks about a report.
 *
 * The table's column names are the NestJS stack's (`sql_text`, `x_axis`,
 * `entity_name`); the shape every caller already reads is the model's (`sql`,
 * `x`, `entity`). Translated in one place so neither side has to learn the
 * other's spelling.
 */
function fromRow(row) {
  return {
    id: row.sys_report_id,
    name: row.name,
    title: row.title,
    entity: row.entity_name ?? null,
    tableName: row.table_name ?? null,
    chart: row.chart ?? null,
    x: row.x_axis ?? null,
    y: row.y_axis ?? null,
    help: row.help ?? null,
    sql: row.sql_text,
    sortOrder: row.sort_order,
    isActive: row.is_active !== false,
  };
}

/** What a caller may see: everything except the query itself. */
function withoutSql(report) {
  const { sql: _sql, ...meta } = report;
  return meta;
}

export function reportsRoutes(model) {
  const router = new Router();
  /* Reads open to any signed-in user, writes administrator-only — the same
     arrangement `/sys`, `/rules` and `/workflows` use. A report's SQL runs
     against this application's whole database, so who may write one is a
     different question from who may read the answers. */
  router.use(async (request, { user }) => {
    requireUser(user);
    if (request.method !== "GET") requireAdmin(user);
  });

  async function reportByName(db, name) {
    const row = await db.one("SELECT * FROM sys_report WHERE name = $1", [name]);
    return row ? fromRow(row) : null;
  }

  router.get("/", async (_request, { db }) => {
    const rows = await db.select("sys_report", { orderBy: "sort_order" });
    return json(rows.map((row) => withoutSql(fromRow(row))));
  });

  router.get("/:name", async (_request, { db, params, user }) => {
    const report = await reportByName(db, params.name);
    if (!report) throw notFound(`No report named "${params.name}"`);
    /*
     * The query itself goes only to an administrator, who is the only caller
     * that can edit one — everyone else gets what they always got.
     *
     * `withoutSql` exists because a report's SQL names tables the reader may
     * have no access to, and reading the statement is a way to learn the schema
     * and the joins behind a screen that would otherwise only show its results.
     * Editing needs the text, so this route hands it over; that is a reason to
     * gate it, not a reason to widen it.
     */
    return json(user?.isAdmin ? report : withoutSql(report));
  });

  router.get("/:name/run", async (_request, { db, params }) => {
    const report = await reportByName(db, params.name);
    if (!report) throw notFound(`No report named "${params.name}"`);

    const body = assertReadOnly(report.sql);
    const started = Date.now();

    // Wrapped rather than appended to: a model's query may end in ORDER BY, a
    // LIMIT of its own or a comment, and adding to any of those changes what it
    // means. One row past the cap distinguishes a full page from a truncated
    // one without counting the whole thing twice.
    let rows;
    let numeric;
    try {
      ({ rows, numeric } = await db.queryWithNumeric(
        `SELECT * FROM (${body}) AS report_body LIMIT ${MAX_ROWS + 1}`
      ));
    } catch (error) {
      // The query came out of the model, so this is a defect in the document
      // rather than in the request. Name the report and quote the database —
      // an author cannot act on "the report failed".
      throw badRequest(`Report "${report.name}" failed: ${error?.message || String(error)}`);
    }

    const truncated = rows.length > MAX_ROWS;
    if (truncated) rows = rows.slice(0, MAX_ROWS);

    return json({
      report: withoutSql(report),
      // Off the first row rather than a driver field list, so the column order
      // the report's own SELECT declares is the order it renders in.
      columns: rows.length > 0 ? Object.keys(rows[0]) : [],
      // Which of those are NUMERIC, which arrives as a string — see queryWithNumeric.
      numeric,
      rows,
      rowCount: rows.length,
      truncated,
      durationMs: Date.now() - started,
    });
  });

  /*
   * Create, update and delete.
   *
   * **The SQL is checked here as well as on every run**, and both matter. The
   * run-time check is the one that cannot be skipped, because `sys_report` is
   * an ordinary table whose rows predate this route and could be written by
   * anything that reaches the database. The save-time check is the one that
   * tells an administrator *now* that what they typed is not a query this
   * application will execute, rather than storing it and failing whenever
   * somebody next opens the report.
   *
   * It is the same `assertReadOnly` both times, deliberately: two spellings of
   * "read-only" is how one of them comes to permit something the other refuses.
   */
  function reportFields(body, existing = {}) {
    const values = {};
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) throw badRequest("A report needs a `name`");
      if (!/^[a-z0-9][a-z0-9-]*$/i.test(name)) {
        throw badRequest("`name` is the report's handle in a URL — letters, digits and hyphens");
      }
      values.name = name;
    }
    if (body.title !== undefined) {
      const title = String(body.title).trim();
      if (!title) throw badRequest("A report needs a `title` — the question it answers");
      values.title = title;
    }
    if (body.entity !== undefined) {
      values.entity_name = body.entity || null;
      /* `tableName` follows the entity rather than being accepted beside it:
         two fields naming the same thing is two chances to disagree. */
      const entity = body.entity ? resolveReportEntity(model, body.entity) : null;
      values.table_name = entity ? entity.tableName : null;
    }
    if (body.help !== undefined) values.help = body.help || null;
    if (body.sortOrder !== undefined) {
      const order = Number(body.sortOrder);
      if (!Number.isInteger(order)) throw badRequest("`sortOrder` must be a whole number");
      values.sort_order = order;
    }
    if (body.isActive !== undefined) values.is_active = !!body.isActive;

    /*
     * A chart needs both axes or neither. The dashboard draws `chart` with `x`
     * and `y`; one without the other renders an empty frame, which reads as a
     * broken report rather than as a report nobody finished configuring.
     */
    if (body.chart !== undefined || body.x !== undefined || body.y !== undefined) {
      const chart = body.chart ? String(body.chart).trim() : null;
      if (chart && !CHART_TYPES.has(chart)) {
        throw badRequest(`\`chart\` must be one of ${[...CHART_TYPES].join(", ")}`);
      }
      const x = body.x !== undefined ? body.x || null : (existing.x_axis ?? null);
      const y = body.y !== undefined ? body.y || null : (existing.y_axis ?? null);
      if (chart && (!x || !y)) {
        throw badRequest("A chart needs both `x` and `y` — an axis on its own draws nothing");
      }
      values.chart = chart;
      values.x_axis = chart ? x : null;
      values.y_axis = chart ? y : null;
    }

    if (body.sql !== undefined) {
      values.sql_text = assertReadOnly(body.sql);
    }
    if (!values.sql_text && !existing.sql_text) {
      throw badRequest("A report needs `sql` — the query that answers the question");
    }
    return values;
  }

  router.post("/", async (request, { db }) => {
    const body = await readJson(request);
    const values = { sort_order: 0, is_active: true, ...reportFields(body) };
    if (!values.name) throw badRequest("A report needs a `name`");
    if (!values.title) throw badRequest("A report needs a `title`");

    const clash = await db.one("SELECT sys_report_id FROM sys_report WHERE name = $1", [
      values.name,
    ]);
    /* Answered as a conflict rather than left to the unique index, so the
       message names the report instead of quoting a constraint. */
    if (clash) throw badRequest(`A report named "${values.name}" already exists`);

    const row = await db.insert("sys_report", values);
    return json(fromRow(row), { status: 201 });
  });

  router.patch("/:name", async (request, { db, params }) => {
    const existing = await db.one("SELECT * FROM sys_report WHERE name = $1", [params.name]);
    if (!existing) throw notFound(`No report named "${params.name}"`);

    const body = await readJson(request);
    const values = reportFields(body, existing);
    if (Object.keys(values).length === 0) throw badRequest("Nothing to change");

    if (values.name && values.name !== existing.name) {
      const clash = await db.one("SELECT sys_report_id FROM sys_report WHERE name = $1", [
        values.name,
      ]);
      if (clash) throw badRequest(`A report named "${values.name}" already exists`);
    }
    values.updated_at = new Date().toISOString();

    const row = await db.update("sys_report", values, { sys_report_id: existing.sys_report_id });
    return json(fromRow(row));
  });

  router.delete("/:name", async (_request, { db, params }) => {
    const existing = await db.one("SELECT sys_report_id FROM sys_report WHERE name = $1", [
      params.name,
    ]);
    if (!existing) throw notFound(`No report named "${params.name}"`);
    await db.remove("sys_report", { sys_report_id: existing.sys_report_id });
    return noContent();
  });

  return router;
}

/** The chart types the dashboard knows how to draw. */
const CHART_TYPES = new Set(["bar", "line", "pie", "area"]);

/** The entity a report names, by any of the spellings a model might use. */
function resolveReportEntity(model, name) {
  const wanted = String(name ?? "").toLowerCase();
  return (
    (model.entities || []).find(
      (entity) =>
        entity.name.toLowerCase() === wanted ||
        entity.tableName === wanted ||
        entity.route === wanted
    ) || null
  );
}
