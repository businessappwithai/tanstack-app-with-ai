/**
 * The log specification, loaded and validated.
 *
 * `log-spec.json` is the source of truth; this module is the only thing that
 * reads it. A call site never names a level or writes a message — it names an
 * event id, and the level, the channel and the message come from here. That is
 * what makes the spec worth having: changing what an event is worth, or
 * silencing a whole channel, is an edit to one JSON file rather than a sweep
 * through the code that emits it.
 *
 * The spec is validated on load rather than trusted. A spec with an event
 * pointing at a channel that does not exist, or a level that is not a level,
 * is a configuration bug that would otherwise surface as a log line that never
 * appears — which is the single hardest kind of logging bug to notice.
 */

import rawSpec from "./log-spec.json" with { type: "json" };

/** Ordered, loudest first. Mirrors Pino's own numeric levels. */
export const LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"] as const;

export type LogLevel = (typeof LEVELS)[number];

/** `silent` is a configurable level but never an event's level. */
export type ConfiguredLevel = LogLevel | "silent";

export interface LogChannel {
  readonly name: string;
  readonly description: string;
  readonly level: LogLevel;
  readonly surfaces: readonly string[];
}

export interface LogEvent {
  readonly id: string;
  readonly channel: string;
  readonly level: LogLevel;
  readonly message: string;
  readonly fields: readonly string[];
  /**
   * Where the event is emitted, when that is narrower than its channel's
   * surfaces. A channel such as `http` is shared by the modelling tool and the
   * generated application, but some events only the latter can produce.
   */
  readonly surfaces?: readonly string[];
}

export interface EnvironmentProfile {
  readonly level: ConfiguredLevel;
  readonly pretty: boolean;
}

export interface RedactionPolicy {
  readonly censor: string;
  readonly paths: readonly string[];
}

/**
 * How much of an error the caller is told.
 *
 * `message` — the error's own message (it was written for a person: a rule's
 * wording, a validation reason). `code` — the catalogue's fixed message plus
 * the code, so a client can branch without the server describing why access
 * was refused. `generic` — the catalogue's fixed message and a reference only;
 * the cause stays in the log.
 */
export const EXPOSURES = ["message", "code", "generic"] as const;

export type ErrorExposure = (typeof EXPOSURES)[number];

/** A kind of failure. Fixed, and the same in every product that reads the spec. */
export interface ErrorCategory {
  readonly name: string;
  /** The HTTP statuses an error of this category may carry. */
  readonly statuses: readonly number[];
  /** The level the request line is written at when the response is this category. */
  readonly level: LogLevel;
  readonly expose: ErrorExposure;
  readonly description: string;
}

/** One declared error: the code a client branches on, and what it means. */
export interface ErrorDefinition {
  readonly code: string;
  readonly category: string;
  readonly status: number;
  /** The message shown when the error carries none of its own, or may not show it. */
  readonly message: string;
  readonly surfaces: readonly string[];
}

export interface LogSpec {
  readonly specVersion: string;
  readonly levels: Readonly<Record<LogLevel, number>>;
  readonly environments: Readonly<Record<string, EnvironmentProfile>>;
  readonly redact: RedactionPolicy;
  readonly errorCategories: readonly ErrorCategory[];
  readonly errors: readonly ErrorDefinition[];
  readonly channels: readonly LogChannel[];
  readonly events: readonly LogEvent[];
}

function isLevel(value: unknown): value is LogLevel {
  return typeof value === "string" && (LEVELS as readonly string[]).includes(value);
}

function isConfiguredLevel(value: unknown): value is ConfiguredLevel {
  return value === "silent" || isLevel(value);
}

/**
 * Validate the spec's internal consistency.
 *
 * Thrown rather than logged, and thrown at module load: a malformed spec means
 * the logger cannot be trusted to report anything, including its own problem.
 */
function validate(spec: LogSpec): LogSpec {
  const problems: string[] = [];

  const channelNames = new Set(spec.channels.map((channel) => channel.name));
  if (channelNames.size !== spec.channels.length) {
    problems.push("two channels share a name");
  }

  for (const channel of spec.channels) {
    if (!isLevel(channel.level)) {
      problems.push(
        `channel ${channel.name} has level ${String(channel.level)}, which is not a level`
      );
    }
  }

  const eventIds = new Set<string>();
  for (const event of spec.events) {
    if (eventIds.has(event.id)) problems.push(`two events share the id ${event.id}`);
    eventIds.add(event.id);

    if (!channelNames.has(event.channel)) {
      problems.push(`event ${event.id} is on channel ${event.channel}, which is not declared`);
    }
    if (!isLevel(event.level)) {
      problems.push(`event ${event.id} has level ${String(event.level)}, which is not a level`);
    }
    if (!event.message) {
      problems.push(`event ${event.id} has no message`);
    }
  }

  const categories = new Map<string, ErrorCategory>();
  for (const category of spec.errorCategories) {
    if (categories.has(category.name)) problems.push(`two error categories are named ${category.name}`);
    categories.set(category.name, category);

    if (!isLevel(category.level)) {
      problems.push(`error category ${category.name} has level ${String(category.level)}`);
    }
    if (!(EXPOSURES as readonly string[]).includes(category.expose)) {
      problems.push(`error category ${category.name} exposes ${String(category.expose)}`);
    }
    if (category.statuses.length === 0) {
      problems.push(`error category ${category.name} allows no status`);
    }
    // A caller's mistake is not the operator's emergency. Only a category that
    // can answer 5xx may log at error, or an alert on error volume pages
    // someone for a mistyped password.
    const clientOnly = category.statuses.every((status) => status < 500);
    if (clientOnly && (category.level === "error" || category.level === "fatal")) {
      problems.push(`error category ${category.name} is 4xx-only and logs at ${category.level}`);
    }
    const serverSide = category.statuses.every((status) => status >= 500);
    if (serverSide && category.level !== "error" && category.level !== "fatal") {
      problems.push(`error category ${category.name} is 5xx-only and logs at ${category.level}`);
    }
  }

  const codes = new Set<string>();
  for (const error of spec.errors) {
    if (codes.has(error.code)) problems.push(`two errors share the code ${error.code}`);
    codes.add(error.code);
    if (!/^[A-Z][A-Z0-9_]*$/.test(error.code)) {
      problems.push(`error code ${error.code} is not UPPER_SNAKE_CASE`);
    }

    const category = categories.get(error.category);
    if (!category) {
      problems.push(`error ${error.code} is in category ${error.category}, which is not declared`);
    } else if (!category.statuses.includes(error.status)) {
      problems.push(
        `error ${error.code} answers ${error.status}, which category ${error.category} does not allow`
      );
    }
    if (!error.message) problems.push(`error ${error.code} has no message`);
  }

  for (const [name, profile] of Object.entries(spec.environments)) {
    if (!isConfiguredLevel(profile.level)) {
      problems.push(`environment ${name} has level ${String(profile.level)}, which is not a level`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`log-spec.json is not internally consistent:\n  - ${problems.join("\n  - ")}`);
  }

  return spec;
}

export const logSpec: LogSpec = validate(rawSpec as unknown as LogSpec);

const EVENTS_BY_ID: ReadonlyMap<string, LogEvent> = new Map(
  logSpec.events.map((event) => [event.id, event])
);

const CHANNELS_BY_NAME: ReadonlyMap<string, LogChannel> = new Map(
  logSpec.channels.map((channel) => [channel.name, channel])
);

const CATEGORIES_BY_NAME: ReadonlyMap<string, ErrorCategory> = new Map(
  logSpec.errorCategories.map((category) => [category.name, category])
);

const ERRORS_BY_CODE: ReadonlyMap<string, ErrorDefinition> = new Map(
  logSpec.errors.map((error) => [error.code, error])
);

export function findErrorCategory(name: string): ErrorCategory | undefined {
  return CATEGORIES_BY_NAME.get(name);
}

export function findError(code: string): ErrorDefinition | undefined {
  return ERRORS_BY_CODE.get(code);
}

export function errorCodes(): readonly string[] {
  return [...ERRORS_BY_CODE.keys()];
}

/**
 * The category an HTTP status falls in when nothing more specific is known.
 *
 * Used to classify a plain framework exception (a bare `NotFoundException`)
 * that carries no catalogue code. Where a status belongs to several categories
 * the first declared wins, which is why `validation` is listed before
 * `business_rule` for 422.
 */
export function categoryForStatus(status: number): ErrorCategory {
  const found = logSpec.errorCategories.find((category) => category.statuses.includes(status));
  if (found) return found;
  const fallback = CATEGORIES_BY_NAME.get(status >= 500 ? "internal" : "validation");
  if (!fallback) throw new Error("log-spec.json declares no internal or validation category");
  return fallback;
}

export function findEvent(id: string): LogEvent | undefined {
  return EVENTS_BY_ID.get(id);
}

export function findChannel(name: string): LogChannel | undefined {
  return CHANNELS_BY_NAME.get(name);
}

export function eventIds(): readonly string[] {
  return [...EVENTS_BY_ID.keys()];
}

export function channelNames(): readonly string[] {
  return [...CHANNELS_BY_NAME.keys()];
}

/**
 * The environment profile for a `NODE_ENV`.
 *
 * An unrecognised environment gets production's profile, not development's.
 * Guessing wrong in that direction leaks debug output and pretty-printing into
 * something that is probably a real deployment; guessing wrong the other way
 * only costs a developer some verbosity.
 */
export function profileFor(env: string | undefined): EnvironmentProfile {
  const named = env ? logSpec.environments[env] : undefined;
  if (named) return named;
  const production = logSpec.environments.production;
  if (!production) throw new Error("log-spec.json declares no production environment");
  return production;
}

/**
 * Resolve the level a channel logs at, given the environment and any override.
 *
 * Precedence: `LOG_LEVEL_<CHANNEL>`, then `LOG_LEVEL`, then the quieter of the
 * environment's level and the channel's own. The two environment variables
 * exist so an operator can turn one subsystem up in a running deployment
 * without a redeploy — the thing you always want at 3am and never have.
 *
 * Taking the *quieter* of the two is what makes a channel's declared level
 * load-bearing in both directions. A channel declares the level of its least
 * severe event, so `debug` channels get their detail in development and are
 * clamped to `info` in production, while a channel that declares `info` is
 * saying it has nothing worth reading below that and stays quiet even in
 * development. No channel can end up louder than its environment permits,
 * which is the direction that leaks.
 */
export function resolveLevel(
  channelName: string,
  env: NodeJS.ProcessEnv = process.env
): ConfiguredLevel {
  const perChannel = env[`LOG_LEVEL_${channelName.toUpperCase()}`];
  if (isConfiguredLevel(perChannel)) return perChannel;

  const global = env.LOG_LEVEL;
  if (isConfiguredLevel(global)) return global;

  const channel = CHANNELS_BY_NAME.get(channelName);
  const profile = profileFor(env.NODE_ENV);

  // The environment floor wins over a channel that asks to be louder than the
  // environment allows: `test` sets `silent`, and a channel declaring `info`
  // must not put noise through every test run.
  if (profile.level === "silent") return "silent";
  if (!channel) return profile.level;

  const rank = (level: ConfiguredLevel): number =>
    level === "silent" ? Number.POSITIVE_INFINITY : logSpec.levels[level];

  return rank(channel.level) < rank(profile.level) ? profile.level : channel.level;
}
