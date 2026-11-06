/**
 * The reporting pack — a generated application's reporting layer, derived.
 *
 * The Enterprise Reporting platform stores reports, charts and dashboards as
 * definitions over saved SQL queries, and it holds roles that decide which
 * tables a reporting user's queries may touch. This turns a parsed model into
 * exactly those definitions, so an application arrives with a reporting layer
 * built for *its* entities instead of an empty workspace and a SQL editor.
 *
 * Nothing here is invented. Every query is derived from something the model
 * actually declares, and a model that declares less gets a smaller pack:
 *
 *   entity                → a register: what rows exist, newest first
 *   %%enum-bound column   → a breakdown: how the rows divide, as a chart
 *   created_at            → volume by month, as a line
 *   kind: state workflow  → a lifecycle report over the states the diagram
 *                           declares, in the diagram's order, zeroes included
 *   numeric columns       → a measures report, grouped by the entity's own
 *                           primary enum column where it has one
 *   oneToMany             → children per parent, ranked
 *   %%report              → the author's own question, listed first
 *
 * The *names and descriptions* come from `%%entity help:` and `%%field help:` —
 * the only place a model says what an entity is for rather than what shape it
 * is. That is the difference between a report called "bus_account by status"
 * and one called "Accounts by status" that explains what an account is in this
 * business. A model with no help text still produces a working pack; it just
 * produces one named after tables.
 *
 * ## Why this lives here
 *
 * It was written in `app-and-report-with-ai-tanstack`, where docker-compose
 * stands the real platform up beside a deployed application. That is still the
 * only place the *platform* runs — but the pack it consumes is a pure reading
 * of a model, and two more readers now need it: the browser stack, which serves
 * the same reports and roles from its own runtime, and the full-stack project,
 * which ships the pack in its `reporting/` directory for the platform its
 * compose file starts. Deriving it three times would be three answers to "what
 * reports does this model have". The orchestrator imports this module.
 *
 * Pure, and deliberately so — no `node:fs`, no clock, no database. The browser
 * bundle reaches it.
 */

import type { Entity, EntityAttribute } from "@appwithai/core/types";
import { tableNameFor } from "../naming/tables";
import type { ParsedModel } from "../pipeline/parse-model";
import { type DerivedAccess, deriveAccess } from "../rbac/roles";
import type { CompiledWorkflow } from "../workflows";

// --- The pack ----------------------------------------------------------------

export interface SavedQuerySpec {
  key: string;
  name: string;
  description: string;
  sql: string;
  /**
   * The `bus_` tables this query reads, so a reporting role can be scoped
   * without parsing SQL at run time.
   *
   * Read off the query text rather than tracked as it is assembled, which
   * sounds like the weaker of the two and is the stronger: a `%%report` the
   * author wrote arrives as opaque SQL and has to be scanned anyway, and one
   * answer for both kinds cannot drift between them. The platform does not need
   * this — it parses the SQL and checks `ds_entity_permissions` itself — but
   * every runtime that serves the pack without that machinery does.
   */
  tables: string[];
}

export interface ReportSpec {
  key: string;
  name: string;
  description: string;
  queryKey: string;
  columns: { field: string; label: string }[];
  pageSize: number;
}

export interface ChartSpec {
  key: string;
  name: string;
  description: string;
  queryKey: string;
  chartType: "bar" | "line" | "pie" | "area";
  xField: string;
  yField: string;
}

export interface DashboardWidgetSpec {
  chartKey?: string;
  reportKey?: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DashboardSpec {
  key: string;
  name: string;
  description: string;
  /** The declared `%%rbac` role an authored `%%dashboard` is for; absent on the overview. */
  role?: string;
  widgets: DashboardWidgetSpec[];
}

/**
 * One reporting-side role, derived from a `%%rbac` role but not the same thing.
 *
 * The application's role decides what a user may *do* to a record. This one
 * decides what a reporting user may *read* — which tables their queries and
 * reports may touch. The names line up so an administrator can see which is
 * which; nothing else is shared, and the two are signed into separately.
 */
export interface AccessRoleSpec {
  /** Display name, title-cased: `sales_manager` -> `Sales Manager`. */
  name: string;
  /** The spelling the model used. */
  declaredAs: string;
  description: string;
  isAdmin: boolean;
  /** The account seeded for this role on the *reporting* side. */
  email: string;
  /**
   * The account the *generated application* seeds for the same role.
   *
   * Carried so a front door can show both sign-ins side by side without a
   * second derivation. It never authenticates anything here — the two products
   * do not share a user table, and this is the other one's address.
   */
  appEmail: string;
  /** `bus_` tables this role may read. Empty means every table for the administrator and none for any other role. */
  tables: string[];
}

export interface AccessSpec {
  roles: AccessRoleSpec[];
  /**
   * The password each side's seeded accounts use — and they are not the same.
   *
   * The generated application seeds `admin123` (`DEFAULT_PASSWORD` in
   * `common/seeds/users-and-roles.ts.hbs`, which is what better-auth's minimum
   * length forces); the reporting platform's bootstrap administrator and the
   * accounts seeded beside it use `admin`. A front door stating one password
   * for both was wrong for every application account on it, which is worse than
   * stating none: a reader told the wrong password concludes the account is
   * broken.
   */
  appPassword: string;
  reportPassword: string;
  /** True when at least one role is narrower than the whole schema. */
  scoped: boolean;
  /**
   * How many tables the application has in total.
   *
   * Stated rather than inferred from the widest role: the widest role is not
   * necessarily the whole schema, and a page reading "0 of 15" where the model
   * declares 17 entities is wrong about the only number a reader would check.
   */
  entityTotal: number;
}

export interface ReportingPack {
  application: {
    name: string;
    description: string;
    model: string;
    databaseName: string;
    /** Set only when the caller supplies one — see `BuildPackOptions`. */
    generatedAt?: string;
  };
  dataSource: { name: string; description: string; clientType: "pg" };
  queries: SavedQuerySpec[];
  reports: ReportSpec[];
  charts: ChartSpec[];
  dashboards: DashboardSpec[];
  /** Roles to create on the reporting side, mirroring the model's `%%rbac`. */
  access: AccessSpec;
}

export interface BuildPackOptions {
  /**
   * The name the application was generated under — `appwithai generate -n`.
   *
   * Not `%%meta name:`, and the difference is the whole point: it is what the
   * generated application's own seeded addresses are built from, so deriving
   * the reporting addresses from anything else produces accounts that exist
   * nowhere while being printed as the way in.
   */
  projectName: string;
  /**
   * What the application is *called*, where that differs from `projectName`.
   *
   * `projectName` is the generate-time name and is what the seeded addresses
   * are built from, so it cannot also be the display name: a model whose
   * `%%meta name:` reads "Enterprise CRM" generated as `crm` wants the reports
   * titled "Enterprise CRM — overview" and the accounts at `@crm.reports…`.
   * Defaults to `projectName`, which is right whenever a caller has only one
   * name to give.
   */
  applicationName?: string;
  /** The application's description, for the pack's own header. */
  projectDescription?: string;
  /** The database the queries will run against, e.g. `crm`. */
  databaseName: string;
  /** The model file's basename, recorded so a pack says where it came from. */
  modelFileName?: string;
  /** The administrator's address, matching what the application seeds. */
  adminEmail?: string;
  adminName?: string;
  /**
   * When the pack was built, if the caller wants it recorded.
   *
   * Deliberately injected rather than read off the clock. Generation is
   * compared byte for byte — CI generates the browser stack twice and diffs the
   * two trees — and a timestamp the generator invents makes every such
   * comparison fail on a file nothing is wrong with.
   */
  generatedAt?: string;
}

/**
 * What the two sides actually seed, stated once.
 *
 * `APP_PASSWORD` mirrors `DEFAULT_PASSWORD` in the generator's
 * `templates/common/seeds/users-and-roles.ts.hbs`. It cannot be imported —
 * that file is a Handlebars template, not a module — so this is a copy, and the
 * test that reads the template is what holds the two together.
 */
const APP_PASSWORD = "admin123";
const REPORT_PASSWORD = "admin";

// --- Naming ------------------------------------------------------------------

/**
 * What to call the entity in a report title.
 *
 * The entity's own name, split on its capitals — deliberately *not* `%%entity
 * <E> label:`. That directive is documented as entity metadata and no generator
 * reads it, so an application generated from a model declaring
 * `%%entity Product label: Product Catalogue` calls the thing "Product" on
 * every screen and in its navigation. Naming it "Product Catalogues" here
 * produced a reporting layer whose report titles matched nothing in the
 * application they report on, which is the opposite of what a mirror is for.
 * If `label:` is ever compiled, this is one of the places that should honour it.
 */
function titleOf(e: Entity): string {
  return e.name.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

function pluralTitle(e: Entity): string {
  const t = titleOf(e);
  if (/[^aeiou]y$/i.test(t)) return `${t.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(t)) return `${t}es`;
  return `${t}s`;
}

function labelOf(column: string): string {
  return column
    .replace(/_id$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * The entity's own sentence, trimmed to one line. Falls back to a plain
 * statement of what the report covers rather than to nothing: an empty
 * description reads, in a reporting UI, exactly like a broken import.
 */
function helpOf(e: Entity): string {
  const h = e.description?.trim();
  if (h) return h.replace(/\s+/g, " ");
  return `Rows of ${pluralTitle(e).toLowerCase()} held by the application.`;
}

/** SQL string literal. Model text reaches these queries, so it is escaped. */
function lit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * The business tables a query reads.
 *
 * Every table in a generated schema is `bus_` or `sys_`, and a report may only
 * read, so the names appearing in the text are the tables it touches. Scanning
 * for the prefix is therefore exact for the derived queries (this file wrote
 * them) and the best available reading of an authored one — and where it is
 * wrong it is wrong by including a name that appears in a string literal or a
 * comment, which over-reports what a role needs and never under-reports it.
 */
function tablesIn(sql: string): string[] {
  const found = new Set<string>();
  for (const match of sql.matchAll(/\bbus_[a-z0-9_]+\b/g)) found.add(match[0]);
  return [...found].sort();
}

/** `Acme CRM` -> `acme-crm`, for the account domain. */
export function kebabName(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "app"
  );
}

// --- Column classification ---------------------------------------------------

/**
 * Columns the generator adds rather than the model declaring them.
 *
 * `created_at` is not in the set even though it is managed: a volume-by-month
 * report is derived from it, so it is a column this file reads on purpose.
 */
const AUDIT_COLUMNS = new Set([
  "created_at",
  "updated_at",
  "deleted_at",
  "created_by",
  "updated_by",
  "deleted_by",
  "version",
]);

function businessColumns(e: Entity): EntityAttribute[] {
  return e.attributes.filter((a) => a.name !== e.primaryKey && !AUDIT_COLUMNS.has(a.name));
}

/**
 * The column a human recognises a row by. A report keyed on a UUID is a report
 * nobody can read, so this is picked before anything else is derived.
 */
function displayColumn(e: Entity): string {
  const cols = businessColumns(e).filter((a) => !a.isForeignKey);
  const byName = cols.find((a) => /^(name|title|label|code|reference|subject)$/.test(a.name));
  if (byName) return byName.name;
  const unique = cols.find((a) => a.unique && (a.type === "string" || a.type === "text"));
  if (unique) return unique.name;
  const email = cols.find((a) => /email/.test(a.name));
  if (email) return email.name;
  const firstString = cols.find((a) => a.type === "string");
  return firstString?.name ?? e.primaryKey;
}

/**
 * Enum-bound columns, most characteristic first.
 *
 * `status` before `type` before everything else, because a lifecycle column is
 * what an operator actually asks about, and because it is the column a state
 * machine (when the model draws one) is keyed on.
 */
function enumColumns(e: Entity): EntityAttribute[] {
  const bound = businessColumns(e).filter((a) => a.enumRef);
  const rank = (a: EntityAttribute): number => {
    if (/^(status|state)$/.test(a.name)) return 0;
    if (/(stage|phase|priority)/.test(a.name)) return 1;
    if (/(type|tier|category|kind)/.test(a.name)) return 2;
    return 3;
  };
  return [...bound].sort((x, y) => rank(x) - rank(y) || x.name.localeCompare(y.name));
}

function measureColumns(e: Entity): EntityAttribute[] {
  return businessColumns(e).filter(
    (a) => !a.isForeignKey && (a.type === "integer" || a.type === "decimal")
  );
}

/**
 * The states the diagram declares, in the order it declares them, with the
 * pseudo-states dropped. Order matters: a lifecycle report sorted
 * alphabetically tells you nothing about where work is piling up.
 */
function declaredStates(w: CompiledWorkflow): string[] {
  const seen: string[] = [];
  const push = (s: string) => {
    const v = s.trim();
    if (!v || v === "[*]" || seen.includes(v)) return;
    seen.push(v);
  };
  for (const s of w.states) push(s.name);
  for (const t of w.transitions) {
    push(t.from);
    push(t.to);
  }
  return seen;
}

/**
 * The column on `child` that points at `parent`.
 *
 * The relationship's own `foreignKey` is tried second rather than first. It is
 * derived from one end of the relationship and a model may name the column
 * either way, so the column named for the parent — which is what both stacks'
 * migrations emit — is looked for first. A join on a column that does not exist
 * is a report that fails at run time rather than one that is simply absent.
 */
function linkColumn(
  parent: Entity,
  child: Entity,
  relForeignKey: string | undefined
): EntityAttribute | undefined {
  const expected = `${tableNameFor(parent).replace(/^bus_/, "")}_id`;
  return (
    child.attributes.find((a) => a.name === expected) ??
    (relForeignKey ? child.attributes.find((a) => a.name === relForeignKey) : undefined)
  );
}

// --- Derivation --------------------------------------------------------------

interface Ctx {
  model: ParsedModel;
  queries: SavedQuerySpec[];
  reports: ReportSpec[];
  charts: ChartSpec[];
}

/** Push a query, filling in the tables it reads so no call site can forget. */
function addQuery(ctx: Ctx, spec: Omit<SavedQuerySpec, "tables">): string {
  ctx.queries.push({ ...spec, tables: tablesIn(spec.sql) });
  return spec.key;
}

function deriveEntity(ctx: Ctx, e: Entity): void {
  const table = tableNameFor(e);
  const slug = table.replace(/^bus_/, "");
  const display = displayColumn(e);
  const help = helpOf(e);
  const live = "deleted_at IS NULL";

  // 1. The register — every entity earns one.
  const registerCols = [
    display,
    ...enumColumns(e)
      .slice(0, 2)
      .map((a) => a.name),
    ...measureColumns(e)
      .slice(0, 2)
      .map((a) => a.name),
  ].filter((c, i, all) => all.indexOf(c) === i);
  const registerSelect = [...registerCols, "created_at", "updated_at"].join(", ");
  const qRegister = addQuery(ctx, {
    key: `${slug}__register`,
    name: `${pluralTitle(e)} — register`,
    description: `${help} Newest first.`,
    sql: `SELECT ${registerSelect}\nFROM ${table}\nWHERE ${live}\nORDER BY created_at DESC\nLIMIT 500`,
  });
  ctx.reports.push({
    key: `${slug}__register`,
    name: `${pluralTitle(e)} — register`,
    description: help,
    queryKey: qRegister,
    columns: [...registerCols, "created_at", "updated_at"].map((c) => ({
      field: c,
      label: labelOf(c),
    })),
    pageSize: 50,
  });

  // 2. Breakdowns, one per enum-bound column (the two most characteristic).
  for (const col of enumColumns(e).slice(0, 2)) {
    const values =
      col.enumValues ?? ctx.model.enums.find((en) => en.name === col.enumRef)?.values ?? [];
    const key = `${slug}__by_${col.name}`;
    const q = addQuery(ctx, {
      key,
      name: `${pluralTitle(e)} by ${labelOf(col.name).toLowerCase()}`,
      description:
        col.description?.trim() ??
        `How ${pluralTitle(e).toLowerCase()} divide across ${labelOf(col.name).toLowerCase()}.`,
      sql: `SELECT COALESCE(${col.name}, '(unset)') AS bucket, COUNT(*) AS records\nFROM ${table}\nWHERE ${live}\nGROUP BY 1\nORDER BY records DESC`,
    });
    ctx.charts.push({
      key,
      name: `${pluralTitle(e)} by ${labelOf(col.name).toLowerCase()}`,
      description:
        col.description?.trim() ?? `${help} Grouped by ${labelOf(col.name).toLowerCase()}.`,
      queryKey: q,
      // Few buckets read as a share of a whole; many read as a ranking. The
      // model states how many, so this is decided rather than guessed.
      chartType: values.length > 0 && values.length <= 6 ? "pie" : "bar",
      xField: "bucket",
      yField: "records",
    });
    ctx.reports.push({
      key,
      name: `${pluralTitle(e)} by ${labelOf(col.name).toLowerCase()}`,
      description: `Counts of ${pluralTitle(e).toLowerCase()} per ${labelOf(col.name).toLowerCase()}.`,
      queryKey: q,
      columns: [
        { field: "bucket", label: labelOf(col.name) },
        { field: "records", label: "Records" },
      ],
      pageSize: 50,
    });
  }

  // 3. Volume over time — every generated table carries created_at.
  const qVolume = addQuery(ctx, {
    key: `${slug}__volume_by_month`,
    name: `${pluralTitle(e)} created per month`,
    description: `New ${pluralTitle(e).toLowerCase()} per month over the last two years.`,
    sql: `SELECT date_trunc('month', created_at)::date AS month, COUNT(*) AS records\nFROM ${table}\nWHERE ${live} AND created_at >= now() - interval '24 months'\nGROUP BY 1\nORDER BY 1`,
  });
  ctx.charts.push({
    key: `${slug}__volume_by_month`,
    name: `${pluralTitle(e)} created per month`,
    description: `${help} Counted by the month the record was created.`,
    queryKey: qVolume,
    chartType: "line",
    xField: "month",
    yField: "records",
  });

  // 4. Lifecycle — only where the model draws a state machine.
  const wf = ctx.model.workflows.find((w) => w.entity === e.name);
  const statusCol = enumColumns(e).find((a) => /^(status|state)$/.test(a.name))?.name;
  if (wf && statusCol) {
    const states = declaredStates(wf);
    if (states.length > 0) {
      // The states come from the diagram, LEFT JOINed to the counts, so a state
      // the application has never reached shows as zero rather than vanishing.
      // A missing row and a zero row mean very different things here.
      // One SELECT per state, joined by UNION ALL — not `WITH declared(state,
      // position) AS (VALUES …)`. Postgres runs either, but the Enterprise
      // Reporting platform parses every query to decide which tables a role
      // may read, its parser has no CTE column list, and a query it cannot
      // parse is refused to every role but the administrator. So the lifecycle
      // reports — one per state machine — ran for nobody who signed in as a
      // role. The first row names the columns; the rest follow them.
      const valuesList = states
        .map((s, i) =>
          i === 0 ? `SELECT ${lit(s)} AS state, ${i} AS position` : `SELECT ${lit(s)}, ${i}`
        )
        .join("\n  UNION ALL ");
      const key = `${slug}__lifecycle`;
      const q = addQuery(ctx, {
        key,
        name: `${titleOf(e)} lifecycle — ${wf.name}`,
        description: `Where ${pluralTitle(e).toLowerCase()} sit in the ${wf.name} state machine. Every state the model declares appears, including the ones nothing has reached.`,
        sql: `WITH declared AS (\n  ${valuesList}\n)\nSELECT d.state, COALESCE(c.records, 0) AS records\nFROM declared d\nLEFT JOIN (\n  SELECT ${statusCol} AS state, COUNT(*) AS records\n  FROM ${table}\n  WHERE ${live}\n  GROUP BY 1\n) c ON c.state = d.state\nORDER BY d.position`,
      });
      ctx.reports.push({
        key,
        name: `${titleOf(e)} lifecycle — ${wf.name}`,
        description: `Where ${pluralTitle(e).toLowerCase()} sit in the ${wf.name} state machine, in the order the diagram draws it.`,
        queryKey: q,
        columns: [
          { field: "state", label: "State" },
          { field: "records", label: "Records" },
        ],
        pageSize: 50,
      });
      ctx.charts.push({
        key,
        name: `${titleOf(e)} lifecycle`,
        description: `${pluralTitle(e)} per declared state of ${wf.name}.`,
        queryKey: q,
        chartType: "bar",
        xField: "state",
        yField: "records",
      });
    }
  }

  // 5. Measures — only where the entity has something to add up.
  const measures = measureColumns(e);
  if (measures.length > 0) {
    const groupCol = enumColumns(e)[0]?.name;
    const aggregates = measures
      .slice(0, 4)
      .flatMap((m) => [
        `SUM(${m.name}) AS total_${m.name}`,
        `ROUND(AVG(${m.name})::numeric, 2) AS avg_${m.name}`,
      ]);
    const key = `${slug}__measures`;
    const sql = groupCol
      ? `SELECT COALESCE(${groupCol}, '(unset)') AS bucket, COUNT(*) AS records, ${aggregates.join(", ")}\nFROM ${table}\nWHERE ${live}\nGROUP BY 1\nORDER BY records DESC`
      : `SELECT COUNT(*) AS records, ${aggregates.join(", ")}\nFROM ${table}\nWHERE ${live}`;
    const q = addQuery(ctx, {
      key,
      name: `${pluralTitle(e)} — measures`,
      description: `Totals and averages over the numeric columns of ${pluralTitle(e).toLowerCase()}${groupCol ? `, by ${labelOf(groupCol).toLowerCase()}` : ""}.`,
      sql,
    });
    ctx.reports.push({
      key,
      name: `${pluralTitle(e)} — measures`,
      description: `Totals and averages${groupCol ? ` by ${labelOf(groupCol).toLowerCase()}` : ""}. ${help}`,
      queryKey: q,
      columns: [
        ...(groupCol ? [{ field: "bucket", label: labelOf(groupCol) }] : []),
        { field: "records", label: "Records" },
        ...measures.slice(0, 4).flatMap((m) => [
          { field: `total_${m.name}`, label: `Total ${labelOf(m.name).toLowerCase()}` },
          { field: `avg_${m.name}`, label: `Average ${labelOf(m.name).toLowerCase()}` },
        ]),
      ],
      pageSize: 50,
    });
  }
}

/**
 * `%%report` directives — the queries the model's author wrote for the people
 * who will use the application.
 *
 * These are not derived from anything. Everything else here infers a report
 * from structure: an entity earns a register, an enum earns a breakdown, a
 * state machine earns a lifecycle. That inference is complete and shallow — it
 * can tell you how many opportunities sit in each stage, and it can never tell
 * you that the sales manager's actual question is which of them slipped past
 * their close date with no activity logged. That question lives in the model
 * because somebody who understood the business put it there.
 */
function addAuthoredReports(ctx: Ctx): void {
  for (const r of ctx.model.reports) {
    const key = `authored__${r.name}`;
    const description = r.help?.trim() ?? `Declared in the model as %%report ${r.name}.`;
    addQuery(ctx, { key, name: r.title, description, sql: r.sql });

    // Result columns are only knowable by running the query, which this
    // derivation deliberately does not do. A chart's own x/y are named, so they
    // are the columns the report shows; without a chart the report renders
    // whatever the query returns, which each runtime handles from the result
    // set.
    const columns =
      r.chart && r.x && r.y
        ? [
            { field: r.x, label: labelOf(r.x) },
            { field: r.y, label: labelOf(r.y) },
          ]
        : [];

    ctx.reports.push({ key, name: r.title, description, queryKey: key, columns, pageSize: 50 });

    if (r.chart && r.x && r.y) {
      ctx.charts.push({
        key,
        name: r.title,
        description,
        queryKey: key,
        chartType: r.chart,
        xField: r.x,
        yField: r.y,
      });
    }
  }
}

/** Children per parent, for every oneToMany the diagram actually draws. */
function deriveRelationships(ctx: Ctx): void {
  const byName = new Map(ctx.model.entities.map((e) => [e.name, e]));
  for (const rel of ctx.model.relationships) {
    if (rel.cardinality !== "oneToMany") continue;
    const parent = byName.get(rel.sourceEntity);
    const child = byName.get(rel.targetEntity);
    if (!parent || !child) continue;
    const fk = linkColumn(parent, child, rel.foreignKey);
    if (!fk) continue;

    const parentDisplay = displayColumn(parent);
    const parentSlug = tableNameFor(parent).replace(/^bus_/, "");
    const childSlug = tableNameFor(child).replace(/^bus_/, "");
    const key = `${childSlug}__per_${parentSlug}`;

    /*
     * Whether the two sides of the join are the same SQL type.
     *
     * A column gets `uuid` when the Application Dictionary makes it a Table
     * Direct reference, which needs both the `FK` modifier and a name ending
     * `_id` or `_by`; anything else falls through to `varchar`. A primary key is
     * always `uuid`. So the join is `uuid = uuid` for a column the model marked
     * properly and `uuid = varchar` for one it did not — and PostgreSQL has no
     * implicit cast between them, so the wrong guess is not a slow report but
     * `operator does not exist` on every run.
     */
    const sameType = fk.isForeignKey && (fk.name.endsWith("_id") || fk.name.endsWith("_by"));
    const parentKey = sameType ? `p.${parent.primaryKey}` : `p.${parent.primaryKey}::text`;
    const q = addQuery(ctx, {
      key,
      name: `${pluralTitle(child)} per ${titleOf(parent).toLowerCase()}`,
      description: `How many ${pluralTitle(child).toLowerCase()} each ${titleOf(parent).toLowerCase()} has, most first. Derived from the ${rel.name.replace(/_/g, " ")} relationship the model draws.`,
      sql: `SELECT p.${parentDisplay} AS ${parentSlug}, COUNT(c.${child.primaryKey}) AS records\nFROM ${tableNameFor(parent)} p\nLEFT JOIN ${tableNameFor(child)} c\n  ON c.${fk.name} = ${parentKey} AND c.deleted_at IS NULL\nWHERE p.deleted_at IS NULL\nGROUP BY 1\nORDER BY records DESC\nLIMIT 50`,
    });
    ctx.reports.push({
      key,
      name: `${pluralTitle(child)} per ${titleOf(parent).toLowerCase()}`,
      description: `${helpOf(parent)} Counted by the ${pluralTitle(child).toLowerCase()} attached to each.`,
      queryKey: q,
      columns: [
        { field: parentSlug, label: titleOf(parent) },
        { field: "records", label: pluralTitle(child) },
      ],
      pageSize: 50,
    });
    ctx.charts.push({
      key,
      name: `${pluralTitle(child)} per ${titleOf(parent).toLowerCase()}`,
      description: `The ${titleOf(parent).toLowerCase()} records carrying the most ${pluralTitle(child).toLowerCase()}.`,
      queryKey: q,
      chartType: "bar",
      xField: parentSlug,
      yField: "records",
    });
  }
}

/**
 * How central an entity is to the model: what points at it, whether it has a
 * lifecycle, whether it has anything to measure. The overview dashboard shows
 * the top of this ranking rather than whichever entities happen to be first in
 * the file.
 */
function centrality(model: ParsedModel, e: Entity): number {
  const incoming = model.relationships.filter((r) => r.sourceEntity === e.name).length;
  const outgoing = model.relationships.filter((r) => r.targetEntity === e.name).length;
  const hasState = model.workflows.some((w) => w.entity === e.name) ? 3 : 0;
  const hasMeasures = measureColumns(e).length > 0 ? 1 : 0;
  return incoming * 2 + outgoing + hasState + hasMeasures;
}

function deriveDashboards(ctx: Ctx, appName: string, appDescription?: string): DashboardSpec[] {
  const model = ctx.model;
  const ranked = [...model.entities].sort((a, b) => centrality(model, b) - centrality(model, a));
  const headline = ranked.slice(0, 6);

  const widgets: DashboardWidgetSpec[] = [];
  let x = 0;
  let y = 0;
  const place = (title: string, chartKey: string) => {
    widgets.push({ chartKey, title, x, y, w: 6, h: 4 });
    x += 6;
    if (x >= 12) {
      x = 0;
      y += 4;
    }
  };

  // An authored chart is a question somebody asked for by name, so it takes the
  // top of the dashboard ahead of anything inferred.
  for (const c of ctx.charts.filter((c) => c.key.startsWith("authored__")).slice(0, 4)) {
    place(c.name, c.key);
  }

  for (const e of headline) {
    // A lifecycle chart where the model draws one, else the primary breakdown,
    // else the volume line. Every entity contributes exactly one tile, so the
    // dashboard stays readable on a model with fifty entities.
    const slug = tableNameFor(e).replace(/^bus_/, "");
    const lifecycle = ctx.charts.find((c) => c.key === `${slug}__lifecycle`);
    const breakdown = ctx.charts.find((c) => c.key.startsWith(`${slug}__by_`));
    const volume = ctx.charts.find((c) => c.key === `${slug}__volume_by_month`);
    const chosen = lifecycle ?? breakdown ?? volume;
    if (chosen) place(chosen.name, chosen.key);
  }

  return [
    {
      key: "overview",
      name: `${appName} — overview`,
      description:
        appDescription?.trim() ||
        `The ${headline.length} entities this model puts at the centre of ${appName}, one tile each.`,
      widgets,
    },
    ...deriveAuthoredDashboards(ctx),
  ];
}

/**
 * `%%dashboard` directives — a role's own reports, grouped by the author.
 *
 * The overview above is inferred from structure and is the same for everyone.
 * These are written for the person who opens them: the tiles are the
 * `%%report` directives the author listed, in that order. A charted report is a
 * chart tile, half a row wide; one without a chart is a table tile, a full row.
 */
function deriveAuthoredDashboards(ctx: Ctx): DashboardSpec[] {
  const charts = new Set(ctx.charts.map((c) => c.key));
  const reports = new Set(ctx.reports.map((r) => r.key));
  const specs: DashboardSpec[] = [];

  for (const d of ctx.model.dashboards ?? []) {
    const widgets: DashboardWidgetSpec[] = [];
    let x = 0;
    let y = 0;
    for (const name of d.reports) {
      const key = `authored__${name}`;
      const title = ctx.model.reports.find((r) => r.name === name)?.title ?? name;
      if (charts.has(key)) {
        widgets.push({ chartKey: key, title, x, y, w: 6, h: 4 });
        x += 6;
        if (x >= 12) {
          x = 0;
          y += 4;
        }
      } else if (reports.has(key)) {
        if (x !== 0) {
          x = 0;
          y += 4;
        }
        widgets.push({ reportKey: key, title, x, y, w: 12, h: 4 });
        y += 4;
      }
    }
    if (widgets.length === 0) continue;
    specs.push({
      key: `authored__${d.name}`,
      name: d.title,
      description:
        d.help?.trim() ??
        (d.role
          ? `${d.title} — a dashboard for the ${d.role} role, declared in the model as %%dashboard ${d.name}.`
          : `Declared in the model as %%dashboard ${d.name}.`),
      ...(d.role ? { role: d.role } : {}),
      widgets,
    });
  }
  return specs;
}

/**
 * Drop a derived item whose *name* an authored one already uses.
 *
 * The reporting platform has no column for the pack's key: its seeder upserts
 * by name, the way its own sample seeds do. So two items sharing a name are not
 * two rows in the platform — they are one row, written twice, and which query
 * survives depends on insertion order. Nothing reports it.
 *
 * That is not hypothetical. An authored "Accounts per territory" collided with
 * the children-per-parent report derived from the same relationship, and the
 * derived one silently replaced the query somebody had written by hand.
 *
 * The authored one wins: it is the same question asked deliberately, usually
 * with the filters and joins the derived version cannot know about.
 */
function dropDerivedDuplicatesOfAuthored(ctx: Ctx): void {
  const authoredNames = new Set(
    [...ctx.reports, ...ctx.charts, ...ctx.queries]
      .filter((x) => x.key.startsWith("authored__"))
      .map((x) => x.name)
  );
  if (authoredNames.size === 0) return;

  const keep = <T extends { key: string; name: string }>(items: T[]): T[] =>
    items.filter((x) => x.key.startsWith("authored__") || !authoredNames.has(x.name));

  const droppedQueryKeys = new Set(
    ctx.queries
      .filter((q) => !q.key.startsWith("authored__") && authoredNames.has(q.name))
      .map((q) => q.key)
  );

  ctx.queries = keep(ctx.queries);
  // A report or chart whose query has gone must go too, or it points at nothing.
  ctx.reports = keep(ctx.reports).filter((r) => !droppedQueryKeys.has(r.queryKey));
  ctx.charts = keep(ctx.charts).filter((c) => !droppedQueryKeys.has(c.queryKey));
}

/**
 * Names are what the platform keys on, so a duplicate is data loss rather than
 * a cosmetic problem. Checked here so it fails generation, loudly, instead of
 * surfacing as a report whose query is not the one it was written with.
 */
function assertNamesUnique(ctx: Ctx, dashboards: DashboardSpec[]): void {
  const collections: [string, { name: string; key: string }[]][] = [
    ["queries", ctx.queries],
    ["reports", ctx.reports],
    ["charts", ctx.charts],
    ["dashboards", dashboards],
  ];
  const problems: string[] = [];
  for (const [label, items] of collections) {
    const byName = new Map<string, string[]>();
    for (const item of items) {
      byName.set(item.name, [...(byName.get(item.name) ?? []), item.key]);
    }
    for (const [name, keys] of byName) {
      if (keys.length > 1) problems.push(`  ${label}: "${name}" ← ${keys.join(", ")}`);
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `The reporting pack has items sharing a name. The reporting platform upserts by name, so these would collapse into one row:\n${problems.join("\n")}`
    );
  }
}

/**
 * The reporting platform's roles, shaped by the model's `%%rbac`.
 *
 * Two deliberate decisions here.
 *
 * **The addresses differ from the application's.** `deriveAccess` gives the
 * generated application `sales.manager@crm.example.com`; the reporting account
 * for the same role is `sales.manager@crm.reports.example.com`. They are
 * different accounts, in different databases, behind different sign-in screens,
 * and an address that looked identical would invite a reader to believe one
 * password works for both. The administrator is the exception and keeps
 * `admin@admin.com`, because that is the account the reporting platform
 * bootstraps for itself and the one every existing instruction names.
 *
 * **A role's tables come from `read` rules only.** `%%rbac` also restricts
 * create, update and delete, and none of that means anything to a reporting
 * user, who cannot write through that product at all. A role no `read` rule
 * mentions gets every table — which is what the application does too: a target
 * no directive names stays open.
 */
function deriveAccessSpec(model: ParsedModel, options: BuildPackOptions): AccessSpec {
  const projectId = kebabName(options.projectName);
  const access: DerivedAccess = deriveAccess(model.rbac, {
    projectId,
    adminEmail: options.adminEmail,
    adminName: options.adminName,
    entities: model.entities.map((e) => e.name),
  });

  const reportDomain = `${projectId || "app"}.reports.example.com`;

  const roles: AccessRoleSpec[] = access.roles.map((role) => {
    const appUser = access.users.find((u) => u.roleName === role.name);

    // An administrator reads everything; that is what the role is for, and
    // narrowing it would make the one account that can compare the others
    // narrower than all of them.
    const tables = role.isAdmin
      ? []
      : model.entities
          .filter((entity) => {
            const admitted = access.entityVisibility[entity.name];
            // No `read` rule on this entity: open to every role.
            if (!admitted || admitted.length === 0) return true;
            return admitted.some((r) => r.toLowerCase() === role.declaredAs.toLowerCase());
          })
          .map((entity) => tableNameFor(entity));

    return {
      name: role.name,
      declaredAs: role.declaredAs,
      description: role.isAdmin
        ? "Reads every table of the attached application"
        : `Reads what ${role.name} may see in the application`,
      isAdmin: role.isAdmin,
      email: role.isAdmin
        ? (appUser?.email ?? "admin@admin.com")
        : `${role.declaredAs
            .toLowerCase()
            .split(/[\s_-]+/)
            .filter(Boolean)
            .join(".")}@${reportDomain}`,
      appEmail: appUser?.email ?? "admin@admin.com",
      tables,
    };
  });

  /*
   * Checked against the derivation's own answer rather than trusted.
   *
   * `entityCounts` is what the generated application prints beside each seeded
   * account — "Support Agent · 5 of 17" — and it is computed by `deriveAccess`
   * from the same visibility map this walks. Two readings of one fact is
   * exactly how the two products come to disagree about what a role may see, so
   * the second is asserted against the first instead of merely resembling it.
   * A mismatch is a bug here, not a pack to be shipped anyway.
   */
  for (const role of roles) {
    if (role.isAdmin) continue;
    const expected = access.entityCounts[role.name];
    if (expected !== undefined && expected !== role.tables.length) {
      throw new Error(
        `Reporting role "${role.name}" resolved ${role.tables.length} readable tables, ` +
          `but the application derives ${expected} for the same role. ` +
          `These must agree — the reporting side is mirroring %%rbac, not reinterpreting it.`
      );
    }
  }

  return {
    roles,
    scoped: roles.some((role) => !role.isAdmin && role.tables.length < model.entities.length),
    entityTotal: model.entities.length,
    appPassword: APP_PASSWORD,
    reportPassword: REPORT_PASSWORD,
  };
}

// --- Entry point -------------------------------------------------------------

/** Turn a parsed model into the reporting layer derived from it. */
export function buildReportingPack(model: ParsedModel, options: BuildPackOptions): ReportingPack {
  if (model.entities.length === 0) {
    throw new Error("Cannot derive a reporting pack: the model declares no entities.");
  }

  const ctx: Ctx = { model, queries: [], reports: [], charts: [] };
  // Authored first, and therefore listed first. A `%%report` is a question
  // somebody decided the application's users ask; the derived ones below
  // describe the shape of the data and cannot know that.
  addAuthoredReports(ctx);
  for (const e of model.entities) deriveEntity(ctx, e);
  deriveRelationships(ctx);
  dropDerivedDuplicatesOfAuthored(ctx);

  const appName = options.applicationName?.trim() || options.projectName;
  const dashboards = deriveDashboards(ctx, appName, options.projectDescription);
  assertNamesUnique(ctx, dashboards);

  return {
    application: {
      name: appName,
      description:
        options.projectDescription?.trim() ||
        // Both kinds, because `%%workflow` is one directive to whoever wrote
        // the model: the state machines are `parsed.workflows` and the sagas
        // are `parsed.sagas`, and counting only the first understates a model
        // whose processes are mostly sagas by most of its processes.
        `${appName}: ${model.entities.length} entities, ${model.workflows.length + model.sagas.length} workflows.`,
      model: options.modelFileName ?? `${kebabName(appName)}.eml.mmd`,
      databaseName: options.databaseName,
      ...(options.generatedAt ? { generatedAt: options.generatedAt } : {}),
    },
    dataSource: {
      name: `${appName} (application database)`,
      description:
        "The generated application's own PostgreSQL database, read directly. Every report and chart below is a query against its bus_ tables.",
      clientType: "pg",
    },
    queries: ctx.queries,
    reports: ctx.reports,
    charts: ctx.charts,
    dashboards,
    access: deriveAccessSpec(model, options),
  };
}
