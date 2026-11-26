/**
 * The log spec a generated application ships with.
 *
 * Derived from the canonical `packages/core/src/logging/log-spec.json` at
 * generation time rather than kept as a second copy under `templates/`. A
 * template would be a duplicate, and duplicates of a specification drift in the
 * direction nobody notices: the generator would go on compiling against one
 * catalogue while every application it wrote used another.
 *
 * Imported by relative path because the exports map for `@appwithai/core`
 * points at built JavaScript, and reaching the JSON through it would pull the
 * Pino-backed runtime into a module the browser bundle compiles. The same
 * pattern already carries `appwithai-language.json` into `browser/full-stack.ts`.
 *
 * What is filtered out: channels whose `surfaces` do not include `generated`.
 * A generated application has no code-generation pipeline and makes no model
 * calls, so shipping it `pipeline.*` and `ai.*` would hand its operator a
 * catalogue of events that can never appear.
 */

import canonical from "../../../core/src/logging/log-spec.json" with { type: "json" };

interface SpecChannel {
  name: string;
  description: string;
  level: string;
  surfaces: string[];
}

interface SpecEvent {
  id: string;
  channel: string;
  level: string;
  message: string;
  fields: string[];
  surfaces?: string[];
}

interface SpecErrorCategory {
  name: string;
  statuses: number[];
  level: string;
  expose: string;
  description: string;
}

interface SpecError {
  code: string;
  category: string;
  status: number;
  message: string;
  surfaces: string[];
}

interface Spec {
  specVersion: string;
  description: string;
  levels: Record<string, number>;
  environments: Record<string, { level: string; pretty: boolean }>;
  transport: Record<string, unknown>;
  redact: { censor: string; paths: string[] };
  errorCategories: SpecErrorCategory[];
  errors: SpecError[];
  channels: SpecChannel[];
  events: SpecEvent[];
}

const SURFACE = "generated";

/**
 * The spec as a generated application's `log-spec.json`, ready to write.
 *
 * Returned as text rather than an object so the caller writes it verbatim;
 * re-serialising it somewhere else is how the file's formatting would end up
 * depending on which code path wrote it.
 */
export function generatedLogSpec(): string {
  const spec = canonical as unknown as Spec;

  const channels = spec.channels.filter((channel) => channel.surfaces.includes(SURFACE));
  const kept = new Set(channels.map((channel) => channel.name));

  const shipped = {
    specVersion: spec.specVersion,
    description:
      "The log specification for this application. Levels, channels, messages and " +
      "redaction are declared here; the code names an event id and this file decides " +
      "the rest. Generated from the APPWITHAI canonical specification — edit it to " +
      "change what this application logs.",
    levels: spec.levels,
    environments: spec.environments,
    transport: spec.transport,
    redact: spec.redact,
    errorCategories: spec.errorCategories,
    errors: spec.errors
      .filter((error) => error.surfaces.includes(SURFACE))
      .map(({ surfaces: _surfaces, ...error }) => error),
    channels: channels.map(({ surfaces: _surfaces, ...channel }) => channel),
    events: spec.events
      .filter((event) => kept.has(event.channel))
      .filter((event) => event.surfaces === undefined || event.surfaces.includes(SURFACE))
      .map(({ surfaces: _surfaces, ...event }) => event),
  };

  return `${JSON.stringify(shipped, null, 2)}\n`;
}

/** The channels a generated application logs on, for tests and for the manual. */
export function generatedChannels(): string[] {
  return (canonical as unknown as Spec).channels
    .filter((channel) => channel.surfaces.includes(SURFACE))
    .map((channel) => channel.name);
}

/** The event ids a generated application may emit. */
export function generatedEventIds(): string[] {
  const kept = new Set(generatedChannels());
  return (canonical as unknown as Spec).events
    .filter((event) => kept.has(event.channel))
    .filter((event) => event.surfaces === undefined || event.surfaces.includes(SURFACE))
    .map((event) => event.id);
}

/** The error codes a generated application may throw, in declared order. */
export function generatedErrorCodes(): string[] {
  return (canonical as unknown as Spec).errors
    .filter((error) => error.surfaces.includes(SURFACE))
    .map((error) => error.code);
}

/**
 * The generated application's `common/errors/catalogue.ts`, as source text.
 *
 * Derived from the same spec as `log-spec.json`, so the two cannot disagree
 * about what a code means. It is TypeScript rather than JSON for one reason:
 * `ErrorCode` becomes a union, and `appError("VERSION_CONFLCT")` then fails
 * `bun check` instead of surfacing as a `INTERNAL_ERROR` in production.
 *
 * Unlike `log-spec.json` this one is imported, not read off disk. The spec is
 * read at run time so an operator can retune a level without a rebuild; a
 * code's category and status are part of the application's contract with its
 * own front end, and editing them on a running box would be a bug.
 */
export function generatedErrorCatalogue(): string {
  const spec = canonical as unknown as Spec;
  const errors = spec.errors.filter((error) => error.surfaces.includes(SURFACE));
  const categories = spec.errorCategories;

  const categoryUnion = categories.map(
    (category, index) =>
      `  | ${JSON.stringify(category.name)}${index === categories.length - 1 ? ";" : ""}`
  );
  const categoryRows = categories.map(
    (category) =>
      `  ${category.name}: { level: ${JSON.stringify(category.level)}, ` +
      `expose: ${JSON.stringify(category.expose)}, ` +
      `statuses: ${JSON.stringify(category.statuses)} },`
  );
  const codeRows = errors.map(
    (error) =>
      `  ${error.code}: { category: ${JSON.stringify(error.category)}, ` +
      `status: ${error.status}, message: ${JSON.stringify(error.message)} },`
  );

  return [
    "/**",
    " * The errors this application can raise, and what each one is worth.",
    " *",
    " * Generated from the APPWITHAI log specification — do not edit by hand. A code",
    " * names its category, its HTTP status and the message a caller is shown when",
    " * the error may not show its own. The category decides the level the request",
    " * is logged at and how much of the error leaves the server.",
    " */",
    "",
    "export type ErrorCategory =",
    ...categoryUnion,
    "",
    'export type ErrorExposure = "message" | "code" | "generic";',
    "",
    "export const ERROR_CATEGORIES: Record<",
    "  ErrorCategory,",
    '  { level: "warn" | "info" | "error" | "fatal"; expose: ErrorExposure; statuses: number[] }',
    "> = {",
    ...categoryRows,
    "};",
    "",
    "export const ERROR_CATALOGUE = {",
    ...codeRows,
    "} as const satisfies Record<string, { category: ErrorCategory; status: number; message: string }>;",
    "",
    "export type ErrorCode = keyof typeof ERROR_CATALOGUE;",
    "",
  ].join("\n");
}
