/**
 * Enterprise Reporting — the browser preview.
 *
 * Two applications are generated from one model and this is the second. Deployed
 * — from the downloadable archive, or by the orchestrator — it is the real
 * Enterprise Reporting platform (`businessappwithai/enterprise_reporting_tanstack`),
 * built from its own source and not modified: a separate service, a separate
 * database, a separate user table.
 *
 * A browser tab cannot run that platform. It is a TanStack Start server over
 * PostgreSQL, and every screen it has calls that server. So this is a preview of
 * it, and it is built to look like it: the platform's sidebar, header, page
 * headers, cards, tables and badges, on the platform's own Tremor tokens (see
 * `er-kit.js` and the `.er` block in styles.css), over the same reporting pack
 * the platform is seeded with — the same saved queries, reports, charts,
 * dashboard and one reporting role per `%%rbac` role.
 *
 * Its administration is real: an administrator manages reporting users, roles,
 * each role's table permissions, and reads the data source and the activity
 * log (`report-admin.js`), and a permission changed there applies to the next
 * query. What it is not, and says so: the SQL editor, NL query, jobs,
 * monitoring, filters, the report generator, the trigger board and settings
 * need the platform's servers. They are in the sidebar where the platform puts
 * them, and each opens a page naming where the real one is, rather than a
 * button that fails.
 */

import { el, mount } from "../dom.js";
import { applyTheme, storedTheme } from "../theme.js";
import { downloadCsv, toCsv } from "../csv.js";
import { reportApi, setReportToken } from "../api.js";
import { reportLoginView } from "./report-login.js";
import { dataSourcesPage, logsPage, permissionsPage, rolesPage, usersPage } from "./report-admin.js";
import {
  alert,
  badge,
  breadcrumb,
  button,
  card,
  cardContent,
  cardHeader,
  cellText,
  chart,
  emptyState,
  icon,
  kpiCard,
  loading,
  pageHeader,
  table,
} from "./er-kit.js";

const state = {
  user: null,
  overview: null,
  sidebarCollapsed: false,
  mobileMenuOpen: false,
  /** Which header menu is open: null | "user" | "notifications". */
  menu: null,
};

/*
 * The platform's sidebar, item for item (`src/components/layout/sidebar.tsx`),
 * with the permission each one needs. A reporting role seeded from the model
 * holds `report:view`, `chart:view`, `dashboard:view` and `nl_query:*` — that is
 * what `scripts/seed-reporting-pack.ts` grants — so it sees the same six items
 * here that it sees there, and the administrator sees all of them.
 *
 * `route` is the screen the preview has. An item without one is a screen that
 * needs the platform's servers; it still appears, and opens a page saying so.
 */
const MAIN_NAV = [
  { slug: "dashboard", label: "Dashboard", icon: "home", permission: null, route: "dashboard" },
  { slug: "sql-editor", label: "SQL Editor", icon: "terminal", permission: "query", description: "Write and execute SQL queries" },
  { slug: "queries", label: "Saved Queries", icon: "database", permission: "query", route: "queries" },
  { slug: "reports", label: "Reports", icon: "fileText", permission: "report", route: "reports" },
  { slug: "charts", label: "Charts", icon: "barChart3", permission: "chart", route: "charts" },
  { slug: "dashboards", label: "Dashboards", icon: "layoutDashboard", permission: "dashboard", route: "dashboards" },
  { slug: "filters", label: "Filters", icon: "filter", permission: "filter", description: "Define reusable report filters" },
  { slug: "jobs", label: "Jobs", icon: "play", permission: "job", description: "Schedule and run background jobs" },
  { slug: "monitoring", label: "Monitoring", icon: "activity", permission: "monitoring_rule", description: "Track thresholds and breaches" },
  { slug: "nl-query", label: "NL Query", icon: "messageSquare", permission: "nl_query", description: "Ask questions in plain language" },
  { slug: "report-generator", label: "Report Generator", icon: "fileText", permission: "report", description: "Generate a report from a description" },
];

const ADMIN_NAV = [
  { slug: "data-sources", label: "Data Sources", icon: "database", permission: "data_source", route: "data-sources", description: "Manage database connections" },
  { slug: "trigger-board", label: "Trigger Board", icon: "layers", permission: "queue", description: "Inspect the job queue" },
  { slug: "logs", label: "System Logs", icon: "squareTerminal", permission: "log", route: "logs", description: "Review application logs" },
  { slug: "users", label: "Users", icon: "users", permission: "user", route: "users", description: "Manage user accounts" },
  { slug: "roles", label: "Roles", icon: "shield", permission: "role", route: "roles", description: "Manage roles and grants" },
  { slug: "permissions", label: "Permissions", icon: "shield", permission: "user", route: "permissions", description: "Review resource-level grants" },
  { slug: "settings", label: "Settings", icon: "settings", permission: "setting", description: "Configure the application" },
];

/**
 * The administration screens the preview has, by route. Server-checked too:
 * `/report-admin` refuses anyone who is not a reporting administrator.
 */
const ADMIN_ROUTES = new Map([
  ["users", usersPage],
  ["roles", rolesPage],
  ["permissions", permissionsPage],
  ["data-sources", dataSourcesPage],
  ["logs", logsPage],
]);

/** What a seeded reporting role may view — the grant the platform's seeder writes. */
const REPORTING_ROLE_GRANTS = new Set(["report", "chart", "dashboard", "nl_query"]);

function canView(permission) {
  if (permission === null) return true;
  if (state.user?.isAdmin) return true;
  return REPORTING_ROLE_GRANTS.has(permission);
}

/** `#/report/<a>/<b>` → ["<a>", "<b>"], decoded. */
function currentPath() {
  const route = (window.location.hash || "").replace(/^#\/report\/?/, "").split("?")[0];
  return route.split("/").filter(Boolean).map(decodeURIComponent);
}

const href = (...parts) => `#/report/${parts.map(encodeURIComponent).join("/")}`;

const repaint = () => window.dispatchEvent(new HashChangeEvent("hashchange"));

// ─── The shell: sidebar, header, main ────────────────────────────────────────

function navItem(item, activeSlug) {
  const active = item.slug === activeSlug;
  return el(
    "a.er-nav__item",
    {
      href: href(item.route ?? `unavailable`, ...(item.route ? [] : [item.slug])),
      class: active ? "is-active" : null,
      title: state.sidebarCollapsed ? item.label : null,
      "aria-current": active ? "page" : null,
      onclick: () => {
        state.mobileMenuOpen = false;
      },
    },
    icon(item.icon),
    state.sidebarCollapsed ? null : el("span.er-nav__label", item.label)
  );
}

function sidebar(activeSlug, { mobile = false } = {}) {
  const main = MAIN_NAV.filter((item) => canView(item.permission));
  const admin = ADMIN_NAV.filter((item) => canView(item.permission));
  const collapsed = state.sidebarCollapsed && !mobile;

  return el(
    "aside.er-sidebar",
    { class: collapsed ? "is-collapsed" : null },
    el(
      "div.er-sidebar__brand",
      el(
        "a.er-sidebar__logo",
        { href: href("dashboard") },
        icon("barChart3", "er-icon--md er-brand"),
        collapsed ? null : el("span", "Enterprise Reports")
      )
    ),
    el(
      "div.er-sidebar__scroll",
      el(
        "div.er-nav__group",
        collapsed ? null : el("h2.er-nav__heading", "Main"),
        el("nav.er-nav", ...main.map((item) => navItem(item, activeSlug)))
      ),
      admin.length > 0 ? el("div.er-separator") : null,
      admin.length > 0
        ? el(
            "div.er-nav__group",
            collapsed ? null : el("h2.er-nav__heading", "Administration"),
            el("nav.er-nav", ...admin.map((item) => navItem(item, activeSlug)))
          )
        : null
    ),
    el(
      "button.er-sidebar__collapse",
      {
        type: "button",
        "aria-label": mobile ? "Close navigation menu" : collapsed ? "Expand sidebar" : "Collapse sidebar",
        onclick: () => {
          if (mobile) state.mobileMenuOpen = false;
          else state.sidebarCollapsed = !state.sidebarCollapsed;
          repaint();
        },
      },
      icon(collapsed ? "chevronRight" : "chevronLeft", "er-icon--xs")
    )
  );
}

function initials(user) {
  const source = user.name || user.email || "U";
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : source[0]).toUpperCase();
}

function header({ project, onLeave, signOut }) {
  const user = state.user;
  const role = state.overview?.role;

  const themeSelect = el(
    "select.er-select.er-themeselect",
    {
      "aria-label": "Theme",
      onchange: (event) => applyTheme(event.currentTarget.value),
    },
    el("option", { value: "light" }, "☀  Light Theme"),
    el("option", { value: "dark" }, "☾  Dark Theme"),
    el("option", { value: "system" }, "◐  System")
  );
  themeSelect.value = storedTheme();

  const toggle = (name) => () => {
    state.menu = state.menu === name ? null : name;
    repaint();
  };

  const notifications =
    state.menu === "notifications"
      ? el(
          "div.er-menu.er-menu--wide",
          el("div.er-menu__label.er-menu__label--split", el("span", "Notifications")),
          el("div.er-menu__empty", "No notifications")
        )
      : null;

  const userMenu =
    state.menu === "user"
      ? el(
          "div.er-menu",
          el(
            "div.er-menu__label",
            el("p.er-menu__name", user.name || user.role || "Reporting user"),
            el("p.er-menu__email", user.email)
          ),
          el("div.er-menu__separator"),
          el(
            "div.er-menu__note",
            role
              ? role.tables === null
                ? `${role.name ?? "Administrator"} — reads every table (${role.tableTotal})`
                : `${role.name ?? "No reporting role"} — reads ${role.tables.length} of ${role.tableTotal} tables`
              : null
          ),
          el("div.er-menu__separator"),
          onLeave
            ? el(
                "button.er-menu__item",
                { type: "button", onclick: () => onLeave() },
                icon("arrowLeft"),
                el("span", `Back to ${project.name}`)
              )
            : null,
          el(
            "button.er-menu__item.er-menu__item--danger",
            { type: "button", onclick: signOut },
            icon("logOut"),
            el("span", "Log out")
          )
        )
      : null;

  return el(
    "header.er-header",
    el(
      "div.er-header__left",
      el(
        "button.er-btn.er-btn--ghost.er-btn--size-icon.er-mobile-only",
        {
          type: "button",
          "aria-label": "Toggle menu",
          onclick: () => {
            state.mobileMenuOpen = !state.mobileMenuOpen;
            repaint();
          },
        },
        icon("menu", "er-icon--lg")
      )
    ),
    el(
      "div.er-header__right",
      themeSelect,
      el(
        "button.er-btn.er-btn--ghost.er-btn--size-icon",
        {
          type: "button",
          "aria-label": "Help",
          title: "Help",
          onclick: () => {
            window.location.hash = href("about-preview");
          },
        },
        icon("helpCircle", "er-icon--lg")
      ),
      el(
        "div.er-menuwrap",
        el(
          "button.er-btn.er-btn--ghost.er-btn--size-icon",
          { type: "button", "aria-label": "Notifications", onclick: toggle("notifications") },
          icon("bell")
        ),
        notifications
      ),
      el(
        "div.er-menuwrap",
        el(
          "button.er-avatar",
          { type: "button", "aria-label": "Account", onclick: toggle("user") },
          initials(user)
        ),
        userMenu
      )
    )
  );
}

/**
 * The one thing this screen has that the platform does not: a line saying what
 * it is. Kept to a strip under the header, so the page below it is the
 * platform's page.
 */
function previewStrip() {
  return el(
    "div.er-previewstrip",
    icon("info", "er-icon--sm"),
    el(
      "span",
      el("strong", "Browser preview of Enterprise Reporting."),
      " The reports, charts, dashboard and roles are the ones the platform is seeded with. " +
        "The real platform runs from the deployable archive or the orchestrator. ",
      el("a", { href: href("about-preview") }, "What differs")
    )
  );
}

// ─── Pages ───────────────────────────────────────────────────────────────────

/** Whether the run endpoint named `column` as a NUMERIC — see `cellText`. */
const isNumeric = (result, column) => (result.numeric ?? []).includes(column);

const plural = (count, one, many = `${one}s`) => `${count.toLocaleString()} ${count === 1 ? one : many}`;

async function dashboardPage(main) {
  const { counts, role } = state.overview;
  const isAdmin = !!state.user.isAdmin;

  const kpis = [
    { label: "Reports", value: counts.reports, href: href("reports"), icon: "fileText", key: "report" },
    { label: "Charts", value: counts.charts, href: href("charts"), icon: "barChart3", key: "chart" },
    { label: "Dashboards", value: counts.dashboards, href: href("dashboards"), icon: "layoutDashboard", key: "dashboard" },
    { label: "Scheduled jobs", value: 0, href: href("unavailable", "jobs"), icon: "play", key: "job" },
  ].filter((kpi) => canView(kpi.key));

  const workspace = MAIN_NAV.filter((item) => item.slug !== "dashboard");
  const visible = workspace.filter((item) => canView(item.permission));
  const moduleCard = (item, admin) =>
    el(
      "a.er-card.er-module",
      { href: href(item.route ?? "unavailable", ...(item.route ? [] : [item.slug])) },
      el(
        "div.er-module__head",
        icon(item.icon, admin ? "er-icon er-subtle" : "er-icon er-brand"),
        el("h3.er-card__title.er-card__title--sm", item.label)
      ),
      el("p.er-card__description", item.description ?? moduleDescription(item.slug))
    );

  const breakdown = [
    ["Reports", counts.reports, "fileText"],
    ["Charts", counts.charts, "barChart3"],
    ["Dashboards", counts.dashboards, "layoutDashboard"],
    ...(isAdmin ? [["Saved queries", counts.queries ?? 0, "database"]] : []),
  ];
  const maxCount = Math.max(1, ...breakdown.map(([, value]) => value));

  mount(
    main,
    el(
      "div.er-stack",
      pageHeader(
        "Dashboard",
        `Welcome to the Enterprise Reporting System — ${state.user.email}`,
        { actions: badge(isAdmin ? "Administrator" : "Standard access", isAdmin ? "default" : "neutral") }
      ),
      kpis.length ? el("div.er-grid.er-grid--4", ...kpis.map((kpi) => kpiCard(kpi.label, kpi.value, kpi.icon, kpi.href))) : null,
      el(
        "div.er-grid.er-grid--2",
        card(
          cardHeader("Content by type", "What exists in your workspace today"),
          cardContent(
            el(
              "ul.er-barlist",
              ...breakdown.map(([name, value, iconName]) =>
                el(
                  "li",
                  el("div.er-barlist__bar", { style: { width: `${Math.max(4, (value / maxCount) * 100)}%` } }),
                  el("span.er-barlist__name", icon(iconName, "er-icon--sm er-subtle"), name),
                  el("span.er-barlist__value", value.toLocaleString())
                )
              )
            )
          )
        ),
        card(
          cardHeader(
            "Data access",
            role.tables === null
              ? `${role.name ?? "This role"} reads every table of ${state.overview.dataSource?.name ?? "the data source"}`
              : `${role.name ?? "This role"} reads ${role.tables.length} of ${role.tableTotal} tables of ${state.overview.dataSource?.name ?? "the data source"}`
          ),
          cardContent(
            role.tables === null
              ? el("p.er-text", "Every report, chart and dashboard tile is offered.")
              : el(
                  "div",
                  el("div.er-taglist", ...role.tables.map((tableName) => badge(tableName, "secondary"))),
                  counts.reports < counts.reportsTotal
                    ? el(
                        "p.er-text.er-mt",
                        `${counts.reports} of ${counts.reportsTotal} reports are offered to this role — ` +
                          "a report whose query names any other table is not."
                      )
                    : null
                )
          )
        )
      ),
      el(
        "div",
        el(
          "div.er-sectionhead",
          el("h2.er-sectiontitle", "Your workspace"),
          el("span.er-label", `${visible.length} of ${workspace.length} modules available`)
        ),
        el("div.er-grid.er-grid--3", ...visible.map((item) => moduleCard(item, false)))
      ),
      isAdmin
        ? el(
            "div",
            el(
              "div.er-sectionhead",
              el("h2.er-sectiontitle", "Administration"),
              el("span.er-label", `${ADMIN_NAV.length} modules`)
            ),
            el("div.er-grid.er-grid--3", ...ADMIN_NAV.map((item) => moduleCard(item, true)))
          )
        : null
    )
  );
}

function moduleDescription(slug) {
  return {
    queries: "Reuse queries you have saved",
    reports: "View and manage reports",
    charts: "Create data visualisations",
    dashboards: "Build interactive dashboards",
  }[slug];
}

function listCard(content) {
  return card(el("div.er-card__flush", content));
}

async function queriesPage(main) {
  mount(main, el("div.er-stack", pageHeader("Saved Queries", "Manage your saved SQL queries"), card(loading())));
  const queries = await reportApi.get("/reporting/queries");
  const source = state.overview.dataSource?.name ?? "—";
  let term = "";

  const body = el("div");
  const draw = () => {
    const needle = term.toLowerCase();
    const shown = queries.filter(
      (query) => !needle || `${query.name} ${query.description} ${source}`.toLowerCase().includes(needle)
    );
    mount(
      body,
      shown.length === 0
        ? emptyState("No queries found", term ? "Nothing matches that search." : "No saved queries this role may run.")
        : table(
            ["Name", "Description", "Data Source", "Created", "Modified", "Actions"],
            shown.map((query) => [
              el("span.er-strong", query.name),
              query.description || "-",
              badge(source, "outline"),
              generatedOn(),
              generatedOn(),
              button("View", { variant: "ghost", size: "sm", iconName: "eye" }),
            ]),
            { onRow: (index) => (window.location.hash = href("queries", shown[index].key)) }
          )
    );
  };

  const search = el("input.er-input.er-input--search", {
    type: "search",
    placeholder: "Search by name, description, or data source...",
    oninput: (event) => {
      term = event.currentTarget.value;
      draw();
    },
  });

  draw();
  mount(
    main,
    el(
      "div.er-stack",
      pageHeader("Saved Queries", "Manage your saved SQL queries"),
      el(
        "div.er-toolbar",
        el("div.er-searchwrap", icon("search", "er-icon er-searchicon"), search),
        badge(plural(queries.length, "query", "queries"), "secondary")
      ),
      listCard(body)
    )
  );
}

async function queryDetailPage(main, key) {
  const queries = await reportApi.get("/reporting/queries");
  const query = queries.find((candidate) => candidate.key === key);
  if (!query) return notFoundPage(main, "Saved Queries", href("queries"));
  mount(
    main,
    el(
      "div.er-stack",
      breadcrumb([{ label: "Saved Queries", href: href("queries") }, { label: query.name }]),
      pageHeader(query.name, query.description, { back: href("queries") }),
      card(
        cardHeader("SQL", `Reads ${query.tables.join(", ") || "no business table"}`),
        cardContent(el("pre.er-code", el("code", query.sql)))
      )
    )
  );
}

function generatedOn() {
  const at = state.overview.application?.generatedAt;
  return at ? new Date(at).toLocaleDateString() : "—";
}

async function reportsPage(main) {
  mount(main, el("div.er-stack", pageHeader("Reports", "Create and manage tabular reports"), card(loading())));
  const [reports, queries] = await Promise.all([
    reportApi.get("/reporting/reports"),
    state.user.isAdmin ? reportApi.get("/reporting/queries") : Promise.resolve([]),
  ]);
  const queryName = new Map(queries.map((query) => [query.key, query.name]));

  mount(
    main,
    el(
      "div.er-stack",
      pageHeader("Reports", "Create and manage tabular reports"),
      hiddenNote(state.overview.counts.reports, state.overview.counts.reportsTotal, "reports"),
      listCard(
        reports.length === 0
          ? emptyState("No reports yet", "Every report reads a table this reporting role may not.")
          : table(
              ["Name", "Description", "Query", "Created", "Modified", "Actions"],
              reports.map((report) => [
                el("span.er-strong", report.name),
                el("span.er-clamp", report.description || "-"),
                queryName.has(report.queryKey)
                  ? badge(queryName.get(report.queryKey), "secondary")
                  : badge("Linked", "secondary"),
                generatedOn(),
                generatedOn(),
                button("View", { variant: "ghost", size: "sm", iconName: "eye" }),
              ]),
              { onRow: (index) => (window.location.hash = href("reports", reports[index].key)) }
            )
      )
    )
  );
}

function hiddenNote(shown, total, noun) {
  if (shown >= total) return null;
  return alert(
    `${total - shown} ${noun} hidden`,
    `${state.user.role ?? "This role"} may not read the tables behind them. ${shown} of ${total} are offered.`
  );
}

async function run(kind, key) {
  return reportApi.get(`/reporting/${kind}/${encodeURIComponent(key)}/run`);
}

function refusal(error) {
  return alert(
    error.status === 403 ? "Access denied" : "This query did not run",
    error.message || String(error),
    "destructive"
  );
}

async function reportViewerPage(main, key) {
  const reports = await reportApi.get("/reporting/reports");
  const report = reports.find((candidate) => candidate.key === key);
  if (!report) return notFoundPage(main, "Reports", href("reports"));

  const data = card(cardHeader("Report Data"), cardContent(loading("Running the report")));
  let result = null;

  const exportCsv = () => {
    if (!result) return;
    downloadCsv(
      report.key,
      toCsv(result.columns, result.rows.map((row) => result.columns.map((column) => cellText(row[column]))))
    );
  };

  const draw = async () => {
    mount(data, cardHeader("Report Data"), cardContent(loading("Running the report")));
    try {
      result = await run("reports", report.key);
    } catch (error) {
      result = null;
      return void mount(data, cardHeader("Report Data"), cardContent(refusal(error)));
    }
    const labels = new Map((report.columns ?? []).map((column) => [column.field, column.label]));
    mount(
      data,
      cardHeader(
        "Report Data",
        `${plural(result.rowCount, "row")} in ${result.durationMs}ms` +
          (result.truncated ? " — capped; the query returns more" : ""),
        badge(result.query.name, "outline")
      ),
      el(
        "div.er-card__flush",
        result.rowCount === 0
          ? emptyState("No data", "The query is valid; nothing in the application's data answers it yet.")
          : table(
              result.columns.map((column) => labels.get(column) ?? column),
              result.rows.map((row) => result.columns.map((column) => cellText(row[column], isNumeric(result, column))))
            )
      )
    );
  };

  mount(
    main,
    el(
      "div.er-stack",
      breadcrumb([{ label: "Reports", href: href("reports") }, { label: report.name }]),
      pageHeader(report.name, report.description, {
        back: href("reports"),
        actions: [
          button("Refresh", { variant: "outline", size: "sm", iconName: "refresh", onclick: () => draw() }),
          button("CSV", { variant: "outline", size: "sm", iconName: "download", onclick: exportCsv }),
        ],
      }),
      data
    )
  );
  await draw();
}

const CHART_ICON = { bar: "barChart3", line: "lineChart", area: "areaChart", pie: "pieChart" };

async function chartsPage(main) {
  mount(main, el("div.er-stack", pageHeader("Charts", "Create and manage data visualizations"), card(loading())));
  const charts = await reportApi.get("/reporting/charts");
  mount(
    main,
    el(
      "div.er-stack",
      pageHeader("Charts", "Create and manage data visualizations"),
      hiddenNote(state.overview.counts.charts, state.overview.counts.chartsTotal, "charts"),
      listCard(
        charts.length === 0
          ? emptyState("No charts yet", "Every chart reads a table this reporting role may not.")
          : table(
              ["Name", "Type", "Query", "Created", "Actions"],
              charts.map((item) => [
                el("span.er-strong", item.name),
                el("span.er-badge.er-badge--outline.er-badge--icon", icon(CHART_ICON[item.chartType] ?? "barChart3", "er-icon--xs"), item.chartType),
                badge("Linked", "secondary"),
                generatedOn(),
                button("View", { variant: "ghost", size: "sm", iconName: "eye" }),
              ]),
              { onRow: (index) => (window.location.hash = href("charts", charts[index].key)) }
            )
      )
    )
  );
}

async function chartViewerPage(main, key) {
  const charts = await reportApi.get("/reporting/charts");
  const item = charts.find((candidate) => candidate.key === key);
  if (!item) return notFoundPage(main, "Charts", href("charts"));

  const body = card(cardContent(loading("Running the chart")));
  mount(
    main,
    el(
      "div.er-stack",
      breadcrumb([{ label: "Charts", href: href("charts") }, { label: item.name }]),
      pageHeader(item.name, item.description, { back: href("charts"), badge: badge(item.chartType, "outline") }),
      body
    )
  );

  try {
    const result = await run("charts", item.key);
    const svg = chart(item.chartType, item.xField, item.yField, result.rows);
    mount(
      body,
      cardHeader(`${item.yField} by ${item.xField}`, `${plural(result.rowCount, "row")} in ${result.durationMs}ms`),
      cardContent(svg ?? emptyState("No data", "Nothing in the application's data answers this chart yet."))
    );
  } catch (error) {
    mount(body, cardContent(refusal(error)));
  }
}

async function dashboardsPage(main) {
  mount(main, el("div.er-stack", pageHeader("Dashboards", "Create and manage interactive dashboards"), card(loading())));
  const dashboards = await reportApi.get("/reporting/dashboards");
  mount(
    main,
    el(
      "div.er-stack",
      pageHeader("Dashboards", "Create and manage interactive dashboards"),
      listCard(
        dashboards.length === 0
          ? emptyState("No dashboards yet")
          : table(
              ["Name", "Description", "Visibility", "Created", "Modified", "Actions"],
              dashboards.map((dashboard) => [
                el("span.er-strong", dashboard.name),
                el("span.er-clamp", dashboard.description || "-"),
                el("span.er-badge.er-badge--outline.er-badge--icon", icon("lock", "er-icon--xs"), "Private"),
                generatedOn(),
                generatedOn(),
                button("View", { variant: "ghost", size: "sm", iconName: "eye" }),
              ]),
              { onRow: (index) => (window.location.hash = href("dashboards", dashboards[index].key)) }
            )
      )
    )
  );
}

async function dashboardViewerPage(main, key) {
  const [dashboards, charts, reports] = await Promise.all([
    reportApi.get("/reporting/dashboards"),
    reportApi.get("/reporting/charts"),
    reportApi.get("/reporting/reports"),
  ]);
  const dashboard = dashboards.find((candidate) => candidate.key === key);
  if (!dashboard) return notFoundPage(main, "Dashboards", href("dashboards"));

  const chartOf = new Map(charts.map((item) => [item.key, item]));
  const reportOf = new Map(reports.map((item) => [item.key, item]));

  /* The platform lays a dashboard out on react-grid-layout's twelve columns
     with 100px rows; the pack writes each widget's x, y, w and h in those
     units, so the same numbers place it here. */
  const tiles = compact(dashboard.widgets).map((widget) => {
    const body = el("div.er-tile__body", loading());
    const tile = el(
      "div.er-card.er-tile",
      {
        style: {
          gridColumn: `${(widget.x ?? 0) + 1} / span ${widget.w ?? 6}`,
          gridRow: `${(widget.y ?? 0) + 1} / span ${widget.h ?? 3}`,
        },
      },
      el("div.er-tile__head", el("h3.er-card__title.er-card__title--sm", widget.title)),
      body
    );

    const chartSpec = widget.chartKey ? chartOf.get(widget.chartKey) : null;
    const reportSpec = widget.reportKey ? reportOf.get(widget.reportKey) : null;
    if (chartSpec) {
      run("charts", chartSpec.key)
        .then((result) => {
          const svg = chart(chartSpec.chartType, chartSpec.xField, chartSpec.yField, result.rows);
          mount(body, svg ?? emptyState("No data"));
        })
        .catch((error) => mount(body, refusal(error)));
    } else if (reportSpec) {
      run("reports", reportSpec.key)
        .then((result) =>
          mount(
            body,
            result.rowCount === 0
              ? emptyState("No data")
              : table(result.columns, result.rows.slice(0, 20).map((row) => result.columns.map((column) => cellText(row[column], isNumeric(result, column)))))
          )
        )
        .catch((error) => mount(body, refusal(error)));
    } else {
      mount(body, emptyState("Nothing to show"));
    }
    return tile;
  });

  mount(
    main,
    el(
      "div.er-stack",
      breadcrumb([{ label: "Dashboards", href: href("dashboards") }, { label: dashboard.name }]),
      pageHeader(dashboard.name, dashboard.description, { back: href("dashboards") }),
      dashboard.hiddenWidgets > 0
        ? alert(
            `${dashboard.hiddenWidgets} tile${dashboard.hiddenWidgets === 1 ? "" : "s"} hidden — ` +
              `${state.user.role ?? "this role"} may not read the tables behind them.`,
            null
          )
        : null,
      tiles.length === 0
        ? card(cardContent(emptyState("Nothing on this dashboard", "Every tile reads a table this role may not.")))
        : el("div.er-dashgrid", ...tiles)
    )
  );
}

/**
 * react-grid-layout's vertical compaction: each tile, in reading order, moves
 * up until it would overlap one already placed. The platform's grid does this
 * on every render, which is why a role that may not read some tiles gets a
 * shorter dashboard rather than one with holes where they were.
 */
function compact(widgets) {
  const placed = [];
  const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const ordered = [...widgets]
    .map((widget) => ({ ...widget, x: widget.x ?? 0, y: widget.y ?? 0, w: widget.w ?? 6, h: widget.h ?? 3 }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  for (const widget of ordered) {
    let y = widget.y;
    while (y > 0 && !placed.some((other) => overlaps({ ...widget, y: y - 1 }, other))) y -= 1;
    placed.push({ ...widget, y });
  }
  return placed;
}

function unavailablePage(main, slug) {
  const item = [...MAIN_NAV, ...ADMIN_NAV].find((candidate) => candidate.slug === slug);
  if (!item) return notFoundPage(main, "Dashboard", href("dashboard"));
  mount(
    main,
    el(
      "div.er-stack",
      pageHeader(item.label, item.description),
      card(
        cardContent(
          el(
            "div.er-unavailable",
            icon(item.icon, "er-icon--xl er-subtle"),
            el("h2.er-sectiontitle", `${item.label} runs on the platform's server`),
            el(
              "p.er-text",
              `This is a browser preview, and ${item.label} needs the Enterprise Reporting platform's own ` +
                "server — its database, its job runner and its AI services — which a browser tab cannot run."
            ),
            el(
              "p.er-text",
              "The real platform comes up beside this application from the deployable archive " +
                "(docker compose up --build, then port 3100), or under /report when the orchestrator runs it. " +
                "It is built from the platform's own source, unmodified, and seeded with this same pack."
            ),
            el("a.er-btn.er-btn--outline.er-btn--size-sm", { href: href("dashboard") }, icon("arrowLeft"), "Back to Dashboard")
          )
        )
      )
    )
  );
}

function aboutPreviewPage(main) {
  const row = (label, here, deployed) => [el("span.er-strong", label), here, deployed];
  mount(
    main,
    el(
      "div.er-stack",
      pageHeader("About this preview", "What the browser build of Enterprise Reporting is, and what it is not"),
      card(
        cardContent(
          el(
            "p.er-text",
            "One model generates two applications. The second is the Enterprise Reporting platform — ",
            el("code", "businessappwithai/enterprise_reporting_tanstack"),
            " — and it is a server application over PostgreSQL. Deployed, it runs unmodified beside the " +
              "application: the downloadable archive builds it from its own source, and the orchestrator " +
              "does the same under /report. A browser tab cannot run it, so this is a preview drawn in its " +
              "layout, over the same reporting pack it is seeded with."
          )
        )
      ),
      listCard(
        table(
          ["", "This preview", "The platform, deployed"],
          [
            row("Saved queries, reports, charts, dashboard", "The same pack, run against this tab's database", "The same pack, seeded into its own database"),
            row("Reporting roles and sign-in", "One account per %%rbac role, separate from the application's", "The same accounts, in its own users table"),
            row("Table-level access", "Enforced on every run", "Enforced on every run"),
            row("SQL editor, NL query, report generator", "Not available", "Available"),
            row("Jobs, monitoring, filters, delivery", "Not available", "Available"),
            row("Users, roles, table permissions", "Available to the administrator — enforced on the next query", "Available to administrators"),
            row("Data sources, system logs", "The application's database, and this tab's reporting activity", "Every registered source, and the server's logs"),
            row("Trigger board, settings", "Not available", "Available to administrators"),
            row("Creating or editing definitions", "Read-only", "Available"),
          ]
        )
      )
    )
  );
}

function notFoundPage(main, label, back) {
  mount(
    main,
    el(
      "div.er-stack",
      pageHeader("Not found", "This definition is not in the reporting pack, or this role may not read it."),
      el("a.er-btn.er-btn--default.er-btn--size-default.er-selfstart", { href: back }, `Back to ${label}`)
    )
  );
}

// ─── Entry ───────────────────────────────────────────────────────────────────

/**
 * The reporting application's shell. `onLeave` goes back to the application it
 * reports on; nothing is signed out, because the two keep separate sessions.
 */
export async function reportAppView(root, { project, onLeave }) {
  const signOut = async () => {
    await reportApi.post("/report-auth/logout").catch(() => {});
    setReportToken(null);
    state.user = null;
    state.overview = null;
    state.menu = null;
    await render();
  };

  const render = async () => {
    if (!state.user) {
      await reportLoginView(root, {
        project,
        onLeave,
        onSignedIn: async (user) => {
          state.user = user;
          state.overview = null;
          // The platform lands every sign-in on its dashboard. Staying on the
          // screen the previous account had open would put a non-administrator
          // on an administration page it cannot see.
          if (window.location.hash !== href("dashboard")) window.location.hash = href("dashboard");
          else await render();
        },
      });
      return;
    }

    if (!state.overview) {
      mount(root, el("div.er", loading("Loading Enterprise Reporting")));
      state.overview = await reportApi.get("/reporting");
    }

    const path = currentPath();
    const [section = "dashboard", key] = path;
    const activeSlug = section === "unavailable" ? key : section;

    const main = el("main.er-main");
    mount(
      root,
      el(
        "div.er",
        { onclick: (event) => closeMenus(event) },
        el("div.er-sidebar-desktop", sidebar(activeSlug)),
        el(
          "div.er-mobile-overlay",
          { class: state.mobileMenuOpen ? "is-open" : null, onclick: () => ((state.mobileMenuOpen = false), repaint()) }
        ),
        el("div.er-sidebar-mobile", { class: state.mobileMenuOpen ? "is-open" : null }, sidebar(activeSlug, { mobile: true })),
        el(
          "div.er-content",
          { class: state.sidebarCollapsed ? "is-collapsed" : null },
          header({ project, onLeave, signOut }),
          previewStrip(),
          main
        )
      )
    );

    try {
      if (section === "dashboard") await dashboardPage(main);
      else if (section === "queries" && canView("query")) {
        if (key) await queryDetailPage(main, key);
        else await queriesPage(main);
      } else if (section === "reports") {
        if (key) await reportViewerPage(main, key);
        else await reportsPage(main);
      } else if (section === "charts") {
        if (key) await chartViewerPage(main, key);
        else await chartsPage(main);
      } else if (section === "dashboards") {
        if (key) await dashboardViewerPage(main, key);
        else await dashboardsPage(main);
      } else if (ADMIN_ROUTES.has(section) && state.user.isAdmin) {
        const context = {
          me: state.user,
          rerender: render,
          href,
          tableTotal: state.overview.role.tableTotal,
          selectedRoleId: key,
        };
        await ADMIN_ROUTES.get(section)(main, context);
      } else if (section === "unavailable") unavailablePage(main, key);
      else if (section === "about-preview") aboutPreviewPage(main);
      else notFoundPage(main, "Dashboard", href("dashboard"));
    } catch (error) {
      mount(main, el("div.er-stack", refusal(error)));
    }
  };

  /* Reattach to a session the reader already has: they may have signed in,
     gone back to the application and returned, and being asked for a password
     again on the way back is the kind of friction that makes the two
     applications feel like one broken one. */
  if (!state.user) {
    try {
      state.user = await reportApi.get("/report-auth/me");
    } catch {
      state.user = null;
    }
  }

  await render();
}

/** A click anywhere outside an open header menu closes it, as the platform's dropdowns do. */
function closeMenus(event) {
  if (!state.menu) return;
  if (event.target.closest?.(".er-menuwrap")) return;
  state.menu = null;
  repaint();
}

/** Forget the reporting session in memory, without ending it on the server. */
export function resetReportView() {
  state.overview = null;
  state.menu = null;
  state.mobileMenuOpen = false;
}

/**
 * A reporting call came back 401. Was there a session to lose?
 *
 * Asked here because only this module knows. The shell probes
 * `/report-auth/me` on every entry to find out whether the reader is already
 * signed in, and a "no" to that probe is an ordinary 401 — not an expired
 * session. Treating the two alike produced a toast per probe *and* a repaint
 * per toast, and the repaint probed again.
 *
 * Returns true only when a session really ended, which is the only case worth
 * telling the reader about.
 */
export function reportSessionEnded() {
  if (!state.user) return false;
  state.user = null;
  state.overview = null;
  return true;
}
