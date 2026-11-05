/**
 * `%%report` directives → the reports a generated application ships with.
 *
 * `%%report` was the one directive this repository parsed and then dropped. The
 * checker read it (`language/cli/src/parser.ts`), held it to its shape and put
 * it in `model.reports`; the *generator's* parser had no case for it at all, so
 * a model carrying a hundred and thirty-six reports generated an application
 * with none — byte for byte the same application it would have generated with
 * the directives deleted. The questions were declared, validated, published in
 * the example models, and then answered by nothing.
 *
 * The reporting platform in `app-and-report-with-ai-tanstack` compiles the same
 * directive into saved queries, report definitions and charts. That is a
 * separate product, reached through its own docker-compose, and it cannot be
 * put inside a browser tab. This is the other half: the model's own questions,
 * carried into the application the model generates, answered against the
 * application's own database. Both readings come from the same directive, so a
 * model written for one is already written for the other.
 *
 * Nothing here invents a report. A model that declares none generates an
 * application whose reports section is empty, and says so.
 */

/** The chart types `%%report chart:` may name. Mirrors `appwithai-language.json`. */
export const REPORT_CHART_TYPES = ["bar", "line", "pie", "area"] as const;

export type ReportChartType = (typeof REPORT_CHART_TYPES)[number];

const CHART_TYPE_SET: ReadonlySet<string> = new Set(REPORT_CHART_TYPES);

/** One `%%report`, as the generated application will store it. */
export interface CompiledReport {
  /** Stable identifier — unique across the model, and the row's key. */
  name: string;
  /** What the report is called on screen. */
  title: string;
  /** The entity it is mainly about, when it is about one. Groups the list. */
  entity?: string;
  /** Absent means a table; present means a chart of this type beside it. */
  chart?: ReportChartType;
  /** Result columns the chart plots. Both required when `chart` is set. */
  x?: string;
  y?: string;
  /** Who asks this question and why — shown as the report's description. */
  help?: string;
  /** The query, exactly as it will be run. */
  sql: string;
}

/**
 * The keys `%%report` understands, in the order a value scan has to stop at.
 *
 * `sql:` is deliberately absent: it is split off the line first, because SQL
 * contains both spaces and colons and a key/value scan would shred it.
 */
const KEYS = ["title", "entity", "chart", "x", "y", "help"] as const;

/**
 * A report may only read.
 *
 * The query is authored in the model and run, verbatim, against the generated
 * application's own database — so the directive is an execution path from a
 * document into SQL. The checker rejects a write at authoring time (`EML292`),
 * but a checker runs where the author is and this runs where the generator is:
 * a model that reached the generator without being checked, or one edited after
 * it was, would otherwise arrive here with `DELETE` in it.
 *
 * Refusing at compile time means the statement never reaches a seed file, so
 * there is nothing for the generated application to run even if its own guard
 * were wrong. The generated reader refuses again at query time; this is the
 * first of the two, not the only one.
 */
const READ_ONLY = /^\s*(?:with|select)\b/i;

/**
 * A statement separator outside of quotes — the way a `SELECT` smuggles a write.
 *
 * `SELECT 1; DROP TABLE bus_account` passes `READ_ONLY` and is not one query.
 * Semicolons *inside* string literals are ordinary characters, so the scan
 * tracks quoting rather than searching for the byte, and a single trailing
 * semicolon is allowed because it is how most people end a statement.
 */
function hasStatementBreak(sql: string): boolean {
  const body = sql.replace(/;\s*$/, "");
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      // Doubling is how both SQL quote styles escape themselves.
      if (ch === quote) {
        if (body[i + 1] === quote) i += 1;
        else quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === ";") return true;
  }
  return false;
}

/**
 * Read one `%%report` line.
 *
 * Exported for the tests, which assert the reading against lines taken from the
 * published models rather than against a fixture written to match this code.
 */
export function parseReportDirective(line: string): CompiledReport | { error: string } {
  // Anchored, and a run of `%%` is allowed for the same reason `hooks/index.ts`
  // allows it: older generated flowcharts emitted `%%%%`. A `%%` line that
  // merely mentions a report in prose is prose — see CLAUDE.md, "Every
  // directive parser anchors at ^%%".
  const directive = line.trim().match(/^%%+report\s+(.+)$/is);
  if (!directive?.[1]) return { error: "not a %%report directive" };
  const rest = directive[1];

  const split = rest.match(/^(.*?)\bsql:\s*(.+)$/is);
  if (!split?.[2]) return { error: "has no sql: clause" };
  const head = split[1] ?? "";
  const sql = split[2].trim();

  const nameMatch = head.match(/^([A-Za-z_][\w-]*)\s*/);
  if (!nameMatch?.[1]) return { error: "has no name" };
  const name = nameMatch[1];
  const keys = head.slice(nameMatch[0].length);

  // Each value runs to the next key or the end of the head. Written as one
  // lookahead over the whole key set so that `help:` — which is a sentence and
  // may contain any of the other words — stops only at a real key.
  const read = (key: string): string | undefined => {
    const stop = KEYS.join("|");
    const found = keys.match(new RegExp(`\\b${key}:\\s*(.*?)(?=\\s+(?:${stop}):|$)`, "is"));
    return found?.[1]?.trim() || undefined;
  };

  if (!READ_ONLY.test(sql)) return { error: `sql: is not a SELECT or WITH query` };
  if (hasStatementBreak(sql)) return { error: `sql: contains more than one statement` };

  const chartRaw = read("chart");
  if (chartRaw && !CHART_TYPE_SET.has(chartRaw)) {
    return { error: `has unknown chart type "${chartRaw}"` };
  }
  const chart = chartRaw as ReportChartType | undefined;
  const x = read("x");
  const y = read("y");
  // A chart with one axis renders nothing and reports no error, which is worse
  // than not being a chart. Dropping the chart keeps the report — the table is
  // still the answer to the question — and says what was dropped.
  if (chart && (!x || !y)) {
    return { error: `declares chart: ${chart} but not both x: and y:` };
  }

  return {
    name,
    title: read("title") ?? name.replace(/[_-]+/g, " "),
    entity: read("entity"),
    chart,
    x,
    y,
    help: read("help"),
    sql,
  };
}

/**
 * Compile every `%%report` in the document.
 *
 * `entityNames` is what an `entity:` key is resolved against: a report naming an
 * entity the model does not declare is kept, but loses the grouping, because
 * the query is still a valid question about the database even when the label on
 * it is wrong. Everything dropped is reported through `warn` — silence is what
 * this whole module exists to fix.
 */
export function compileReports(
  source: string,
  entityNames: string[],
  warn: (message: string) => void = () => {}
): CompiledReport[] {
  const known = new Set(entityNames);
  const byName = new Map<string, CompiledReport>();

  for (const line of source.split("\n")) {
    if (!/^\s*%%+report\b/i.test(line)) continue;

    const parsed = parseReportDirective(line);
    if ("error" in parsed) {
      warn(`%%report ${parsed.error} — skipped: ${line.trim().slice(0, 120)}`);
      continue;
    }

    // The checker reports a duplicate name as EML293. Reaching here with one
    // means the model was not checked, and two rows under one key would make
    // whichever the seed wrote last the only one anybody could open.
    if (byName.has(parsed.name)) {
      warn(`%%report "${parsed.name}" is declared more than once — keeping the first`);
      continue;
    }

    if (parsed.entity && !known.has(parsed.entity)) {
      warn(
        `%%report "${parsed.name}" names entity "${parsed.entity}", which the model does not declare — ungrouped`
      );
      parsed.entity = undefined;
    }

    byName.set(parsed.name, parsed);
  }

  return [...byName.values()];
}

/** One `%%dashboard`, as the reporting pack will carry it. */
export interface CompiledDashboard {
  /** Stable identifier — unique across the model, and the pack key. */
  name: string;
  /** What the dashboard is called on screen. */
  title: string;
  /** The declared `%%rbac` role it is for. */
  role?: string;
  /** The `%%report` names it shows, in order. */
  reports: string[];
  /** Who opens this dashboard and what they decide from it. */
  help?: string;
}

/** The keys `%%dashboard` understands, in the order a value scan has to stop at. */
const DASHBOARD_KEYS = ["title", "role", "reports", "help"] as const;

/**
 * Split `key: value key: value` text at its keys.
 *
 * A key is one of `keys` followed by a colon and preceded by whitespace or the
 * start; each value runs to the next key. The first occurrence of a key wins.
 * Scanned once rather than matched with a lazy lookahead per key, which backtracks
 * over every value it passes.
 */
function scanKeys(text: string, keys: readonly string[]): Record<string, string> {
  const marks = [...text.matchAll(new RegExp(`(?:^|\\s)(${keys.join("|")}):`, "g"))];
  const out: Record<string, string> = {};
  marks.forEach((mark, i) => {
    const key = mark[1] as string;
    if (key in out) return;
    const from = (mark.index ?? 0) + mark[0].length;
    const to = marks[i + 1]?.index ?? text.length;
    const value = text.slice(from, to).trim();
    if (value) out[key] = value;
  });
  return out;
}

/**
 * Read one `%%dashboard` line.
 *
 * Anchored at `^%%` like every directive parser here, so prose that merely
 * mentions a dashboard is prose. `reports:` is a comma list and ends at the next
 * key, as any other value does.
 */
export function parseDashboardDirective(line: string): CompiledDashboard | { error: string } {
  const directive = line.trim().match(/^%%+dashboard\s+(.+)$/is);
  if (!directive?.[1]) return { error: "not a %%dashboard directive" };
  const rest = directive[1];

  const nameMatch = rest.match(/^([A-Za-z_][\w-]*)\s*/);
  if (!nameMatch?.[1]) return { error: "has no name" };
  const name = nameMatch[1];
  const keys = rest.slice(nameMatch[0].length);

  const read = (key: string): string | undefined => scanKeys(keys, DASHBOARD_KEYS)[key];

  const reports = (read("reports") ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  if (reports.length === 0) return { error: "names no reports" };

  return {
    name,
    title: read("title") ?? name.replace(/[_-]+/g, " "),
    role: read("role"),
    reports,
    help: read("help"),
  };
}

/**
 * Compile every `%%dashboard` in the document.
 *
 * A name that is not a `%%report` is dropped from the dashboard with a warning
 * rather than failing generation: the checker already refuses it (`EML297`), and
 * a tile that points at nothing would render empty, which reads as no data. A
 * dashboard left with no reports is skipped altogether.
 */
export function compileDashboards(
  source: string,
  reportNames: string[],
  warn: (message: string) => void = () => {}
): CompiledDashboard[] {
  const known = new Set(reportNames);
  const byName = new Map<string, CompiledDashboard>();

  for (const line of source.split("\n")) {
    if (!/^\s*%%+dashboard\b/i.test(line)) continue;

    const parsed = parseDashboardDirective(line);
    if ("error" in parsed) {
      warn(`%%dashboard ${parsed.error} — skipped: ${line.trim().slice(0, 120)}`);
      continue;
    }
    if (byName.has(parsed.name)) {
      warn(`%%dashboard "${parsed.name}" is declared more than once — keeping the first`);
      continue;
    }

    const shown = parsed.reports.filter((name) => known.has(name));
    for (const name of parsed.reports) {
      if (!known.has(name)) {
        warn(`%%dashboard "${parsed.name}" lists "${name}", which is not a %%report — left off`);
      }
    }
    if (shown.length === 0) {
      warn(`%%dashboard "${parsed.name}" shows no declared report — skipped`);
      continue;
    }
    byName.set(parsed.name, { ...parsed, reports: shown });
  }

  return [...byName.values()];
}
