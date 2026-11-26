/**
 * What a generated application is given to log against.
 *
 * The spec it ships with is derived from the canonical one at generation time
 * rather than kept as a template, so the risk this file exists to catch is not
 * "the copy is wrong" but "the derivation stopped being right" — a channel that
 * should have been filtered out, a redaction path lost on the way through, an
 * event pointing at a channel that did not survive the filter.
 *
 * The second half asserts against the Handlebars templates themselves, because
 * nothing else in this repository does. A template is text until it is
 * rendered, so a logger the generated app imports from a path that no longer
 * exists compiles here and fails only when somebody generates an application
 * and builds it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import canonical from "../../../../core/src/logging/log-spec.json" with { type: "json" };
import {
  generatedChannels,
  generatedErrorCatalogue,
  generatedErrorCodes,
  generatedEventIds,
  generatedLogSpec,
} from "../generated-spec";

const TEMPLATES = join(import.meta.dirname, "../../../templates/tanstack-start-nestjs/backend");

function template(relative: string): string {
  return readFileSync(join(TEMPLATES, relative), "utf-8");
}

interface Spec {
  specVersion: string;
  redact: { censor: string; paths: string[] };
  channels: Array<{ name: string; level: string; surfaces?: string[] }>;
  events: Array<{ id: string; channel: string; level: string; message: string; fields: string[] }>;
}

const shipped = JSON.parse(generatedLogSpec()) as Spec;
const source = canonical as unknown as Spec;

describe("the spec a generated application ships with", () => {
  it("is valid JSON ending in a newline, so it reads as a file rather than a blob", () => {
    expect(generatedLogSpec().endsWith("}\n")).toBe(true);
  });

  it("carries the canonical version, so a shipped spec can be traced to its source", () => {
    expect(shipped.specVersion).toBe(source.specVersion);
  });

  it("keeps only the channels a generated application can actually emit on", () => {
    expect(shipped.channels.map((channel) => channel.name).sort()).toEqual(
      source.channels
        .filter((channel) => channel.surfaces?.includes("generated"))
        .map((channel) => channel.name)
        .sort()
    );
  });

  it("ships no pipeline or model-call events — a generated app has neither", () => {
    const channels = new Set(shipped.channels.map((channel) => channel.name));
    expect(channels.has("pipeline")).toBe(false);
    expect(channels.has("ai")).toBe(false);
    expect(shipped.events.some((event) => event.id.startsWith("pipeline."))).toBe(false);
    expect(shipped.events.some((event) => event.id.startsWith("ai."))).toBe(false);
  });

  it("leaves no event pointing at a channel the filter removed", () => {
    const channels = new Set(shipped.channels.map((channel) => channel.name));
    const orphans = shipped.events
      .filter((event) => !channels.has(event.channel))
      .map((event) => event.id);
    expect(orphans).toEqual([]);
  });

  it("drops `surfaces` — it is the generator's bookkeeping, not the app's", () => {
    for (const channel of shipped.channels) {
      expect(channel).not.toHaveProperty("surfaces");
    }
  });

  it("carries the redaction policy through intact", () => {
    expect(shipped.redact.paths).toEqual(source.redact.paths);
    expect(shipped.redact.censor).toBe(source.redact.censor);
  });

  it("covers the three severities an operator reads for", () => {
    const levels = new Set(shipped.events.map((event) => event.level));
    expect(levels).toContain("error");
    expect(levels).toContain("warn");
    expect(levels).toContain("info");
  });

  it("declares the events the running application is expected to emit", () => {
    for (const required of [
      "app.starting",
      "app.started",
      "app.uncaught",
      "http.request.completed",
      "http.request.client_error",
      "http.request.failed",
      "entity.created",
      "entity.updated",
      "entity.deleted",
      "workflow.transition.refused",
      "rules.write.prevented",
      "hooks.failed",
      "auth.access.denied",
    ]) {
      expect(generatedEventIds(), `log-spec.json no longer declares ${required}`).toContain(
        required
      );
    }
  });

  it("agrees with generatedChannels()", () => {
    expect(generatedChannels().sort()).toEqual(
      shipped.channels.map((channel) => channel.name).sort()
    );
  });
});

describe("the error catalogue a generated application ships with", () => {
  const catalogue = generatedErrorCatalogue();

  it("ships every category and every generated code, without the generator's bookkeeping", () => {
    const parsed = JSON.parse(generatedLogSpec()) as {
      errorCategories: Array<{ name: string }>;
      errors: Array<Record<string, unknown>>;
    };
    expect(parsed.errorCategories.length).toBe(12);
    expect(parsed.errors.map((error) => error.code)).toEqual(generatedErrorCodes());
    for (const error of parsed.errors) expect(error).not.toHaveProperty("surfaces");
  });

  it("is TypeScript whose ErrorCode union names each code, so a typo fails bun check", () => {
    expect(catalogue).toContain("export type ErrorCode = keyof typeof ERROR_CATALOGUE;");
    for (const code of generatedErrorCodes()) {
      expect(catalogue, code).toContain(`  ${code}: { category:`);
    }
  });

  it("types ErrorCategory as a closed union ending in a semicolon", () => {
    expect(catalogue).toMatch(/export type ErrorCategory =\n(  \| "[a-z_]+"\n)*  \| "internal";/);
  });

  it("agrees with the canonical status of each code", () => {
    const source = (canonical as unknown as { errors: Array<{ code: string; status: number }> })
      .errors;
    for (const error of source) {
      expect(catalogue).toContain(`${error.code}: { category:`);
      expect(catalogue).toMatch(new RegExp(`${error.code}: \\{[^}]*status: ${error.status},`));
    }
  });
});

describe("the templates that do the logging", () => {
  const logger = template("src/common/logging/logger.service.ts.hbs");

  it("reads the spec off disk rather than importing it, so it stays editable", () => {
    expect(logger).toContain("readFileSync");
    expect(logger).not.toMatch(/import .*from '\.\/log-spec\.json'/);
  });

  it("is copied into dist as a build asset, so a built server can find it", () => {
    const nestCli = template("nest-cli.json.hbs");
    expect(nestCli).toContain("common/logging/log-spec.json");
  });

  it("names the base binding `service`, leaving `name` free for the event's own field", () => {
    expect(logger).toContain("base: { service:");
  });

  it("logs HTTP from a Fastify hook, not a Nest interceptor", () => {
    // Interceptors run after guards, so an interceptor never sees the 401s and
    // 403s a guard produced — which is most of what an operator looks for.
    expect(logger).toContain("onResponse");
    expect(logger).toContain("export function installHttpLogging");
  });

  it("declares pino as a dependency of the generated backend", () => {
    const pkg = JSON.parse(
      template("package.json.hbs").replace(/\{\{#if[\s\S]*?\{\{\/if\}\}/g, "")
    );
    expect(pkg.dependencies).toHaveProperty("pino");
    expect(pkg.dependencies).toHaveProperty("pino-pretty");
  });

  it("wires the logger into the application's bootstrap", () => {
    const main = template("src/main.ts.hbs");
    expect(main).toContain("installProcessLogging()");
    expect(main).toContain("installHttpLogging(fastifyInstance)");
    expect(main).toContain("app.starting");
    expect(main).toContain("app.started");
    // Nest's own output has to come through the same pipe, or a deployment
    // produces two log formats on one file descriptor.
    expect(main).toContain("new AppLoggerService()");
  });

  it("no longer writes the request body into the log", () => {
    // A POST body on this schema is business data, and on a sign-up or a
    // password change it is a credential. The exception filter used to dump it
    // at error level on every 4xx.
    const filter = template("src/common/filters/http-exception.filter.ts.hbs");
    expect(filter).not.toContain("Request Body:");
  });

  it("stashes the exception so the response hook can report what actually failed", () => {
    const filter = template("src/common/filters/http-exception.filter.ts.hbs");
    expect(filter).toContain("__logError");
    expect(logger).toContain("request.__logError");
  });

  it("carries the user and request id without threading them through every call", () => {
    expect(logger).toContain("AsyncLocalStorage");
    expect(template("src/modules/auth/guards/session-auth.guard.ts.hbs")).toContain(
      "setRequestContext"
    );
    // The entity service has no user in scope and must not invent one.
    const bus = template("src/modules/bus/bus.service.ts.hbs");
    expect(bus).toContain("entity.created");
    expect(bus).not.toContain("userId: null");
  });

  it("logs field names on an update, never their values", () => {
    const bus = template("src/modules/bus/bus.service.ts.hbs");
    expect(bus).toContain("changedFields: Object.keys(data ?? {})");
  });
});
