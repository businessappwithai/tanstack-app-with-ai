/**
 * What a browser may say to the log, and how often.
 *
 * Plain functions with no framework in them, so the limits are tested directly:
 * a route that accepts text from a browser and writes it to a log is a route
 * someone will try to fill the log through.
 */

/** Bounds on what a browser may say, so this route cannot be used to fill a log. */
export const CLIENT_LOG_LIMITS = {
  messageChars: 1000,
  stackChars: 4000,
  shortChars: 200,
  /** Reports per signed-in user per minute. */
  perMinute: 60,
  /** A whole body, as JSON. */
  bodyChars: 8192,
} as const;

/** userId → the start of their current minute and how many reports it holds. */
const windows = new Map<string, { startedAt: number; count: number }>();

/** True when this caller may report now. Exported for the test that holds the limit. */
export function admit(userId: string, now = Date.now()): boolean {
  const window = windows.get(userId);
  if (!window || now - window.startedAt >= 60_000) {
    windows.set(userId, { startedAt: now, count: 1 });
    // Bounded: a user who never comes back must not stay in the map forever.
    if (windows.size > 5000) {
      for (const [id, w] of windows) if (now - w.startedAt >= 60_000) windows.delete(id);
    }
    return true;
  }
  window.count += 1;
  return window.count <= CLIENT_LOG_LIMITS.perMinute;
}

export function text(value: unknown, max: number): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  // Control characters out: a report is written into a log line.
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, max);
}

/** The path only. A query string or fragment can carry what the user was searching for. */
export function pathOf(value: unknown): string | null {
  const raw = text(value, 500);
  if (!raw) return null;
  try {
    return new URL(raw, "http://localhost").pathname;
  } catch {
    return null;
  }
}

