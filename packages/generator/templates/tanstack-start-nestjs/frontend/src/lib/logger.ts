/**
 * The browser's logger.
 *
 * Levels are the operator's to set: `VITE_LOG_LEVEL` (debug | info | warn |
 * error | silent), defaulting to `warn` in a production build and `debug` while
 * developing. It is read when the bundle is built, so changing it means
 * rebuilding the front end — the server-side counterpart, which can be retuned
 * on a running box, is the backend's `LOG_LEVEL`.
 *
 * Two things this exists to prevent:
 *
 *   - Values in the console. Anything under a key that looks like a credential
 *     is replaced before it is printed, as the server's redaction does by key
 *     name. Request bodies are not logged at all.
 *   - Errors nobody hears about. A render error or a rejected promise happens
 *     on a machine the operator cannot see. `reportClientError` tells the
 *     backend, which writes it to the same log as everything else, tagged with
 *     the request id of the call that failed when there was one.
 *
 * This is the one file in the front end allowed to call `console`.
 */

export type ClientLogLevel = "debug" | "info" | "warn" | "error" | "silent";

const RANK: Record<ClientLogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

function configuredLevel(): ClientLogLevel {
  const declared = (import.meta.env?.VITE_LOG_LEVEL as string | undefined)?.toLowerCase();
  if (declared && declared in RANK) return declared as ClientLogLevel;
  return import.meta.env?.MODE === "production" ? "warn" : "debug";
}

const level = configuredLevel();

/** Keys whose values are never printed. Matches the server's redaction by name. */
const SENSITIVE = /pass(word)?|token|secret|authorization|cookie|api[-_]?key|credential/i;

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== "object") return value;
  if (depth > 4) return "[…]";
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redact(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE.test(key) ? "[redacted]" : redact(inner, depth + 1);
  }
  return out;
}

export interface ClientLogger {
  debug: (message: string, context?: unknown) => void;
  info: (message: string, context?: unknown) => void;
  warn: (message: string, context?: unknown) => void;
  error: (message: string, context?: unknown) => void;
}

function emit(name: ClientLogLevel, component: string, message: string, context?: unknown): void {
  if (RANK[name] < RANK[level]) return;
  const method = name === "debug" ? "debug" : name === "silent" ? "log" : name;
  const args: unknown[] = [`[${component}] ${message}`];
  if (context !== undefined) args.push(redact(context));
  // eslint-disable-next-line no-console -- the one place the browser's console is written
  console[method](...args);
}

export function getClientLogger(component: string): ClientLogger {
  return {
    debug: (message, context) => emit("debug", component, message, context),
    info: (message, context) => emit("info", component, message, context),
    warn: (message, context) => emit("warn", component, message, context),
    error: (message, context) => emit("error", component, message, context),
  };
}

/* -------------------------------------------------------------------------- */
/*  Telling the server                                                         */
/* -------------------------------------------------------------------------- */

export interface ClientReport {
  level: "error" | "warn" | "info";
  /** Where it came from: boundary, window, rejection, query, mutation… */
  source: string;
  message: string;
  stack?: string;
  component?: string;
  /** The catalogue code and request id of the failed call, when there was one. */
  code?: string;
  ref?: string;
}

const REPORT_ENDPOINT = "/api/client-logs";
const REPORTS_PER_MINUTE = 20;
const recent = new Map<string, number>();
let windowStartedAt = 0;
let windowCount = 0;

/**
 * Tell the backend about a failure. Fire and forget, and never throws: the
 * reporter failing must not be a second error, and it must not retry, because
 * a reporter that retries on a dead backend is a loop.
 *
 * The same report is sent once a minute at most, and no more than twenty are
 * sent in a minute: a component that throws on every render would otherwise
 * post on every frame.
 */
export function reportClientError(report: ClientReport): void {
  if (typeof window === "undefined" || typeof fetch === "undefined") return;

  const now = Date.now();
  const key = `${report.source}|${report.message}`;
  const last = recent.get(key);
  if (last !== undefined && now - last < 60_000) return;
  if (now - windowStartedAt >= 60_000) {
    windowStartedAt = now;
    windowCount = 0;
  }
  if (windowCount >= REPORTS_PER_MINUTE) return;
  windowCount += 1;
  recent.set(key, now);
  if (recent.size > 200) recent.clear();

  try {
    void fetch(REPORT_ENDPOINT, {
      method: "POST",
      credentials: "include",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...report, url: window.location.pathname }),
    }).catch(() => undefined);
  } catch {
    // Nothing to do: see above.
  }
}

let installed = false;

/** Report what escapes every handler: `window.onerror` and unhandled rejections. */
export function installGlobalErrorReporting(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (event) => {
    reportClientError({
      level: "error",
      source: "window",
      message: event.message || "Uncaught error",
      stack: event.error instanceof Error ? event.error.stack : undefined,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const message = reason instanceof Error ? reason.message : String(reason ?? "Unhandled rejection");
    reportClientError({
      level: "error",
      source: "rejection",
      message,
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
}
