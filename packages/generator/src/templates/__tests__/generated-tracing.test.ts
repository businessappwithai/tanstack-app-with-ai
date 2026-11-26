/**
 * OpenTelemetry in the generated application: pinned, optional, shared ids, and shipped.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const TEMPLATES = join(import.meta.dirname, "../../../templates/tanstack-start-nestjs");
const read = (p: string) => readFileSync(join(TEMPLATES, p), "utf-8");

describe("generated application tracing", () => {
  it("pins every @opentelemetry package exactly", () => {
    const pkg = read("backend/package.json.hbs");
    const lines = pkg.split("\n").filter((l) => l.includes('"@opentelemetry/'));
    expect(lines.length).toBeGreaterThanOrEqual(6);
    for (const line of lines) expect(line).toMatch(/"\d+\.\d+\.\d+"/);
  });

  it("only starts when an endpoint is configured, and loads the SDK lazily", () => {
    const src = read("backend/src/common/tracing/tracing.ts");
    expect(src).toContain("OTEL_EXPORTER_OTLP_ENDPOINT");
    expect(src).toMatch(/import\(['"]@opentelemetry\/sdk-trace-node['"]\)/);
    expect(src).toContain("telemetry.start_failed");
  });

  it("puts the span's ids on the response log line and ends the span there", () => {
    const src = read("backend/src/common/logging/logger.service.ts.hbs");
    expect(src).toContain("request.__logTrace");
    expect(src).toMatch(/request\.__logSpan[\s\S]*\.end\(/);
  });

  it("enters the request context before the first await", () => {
    // enterWith after `await initTracing()` never reached the guards, so the audit trail lost the
    // user behind every write (suite 20 failed only with tracing on).
    const src = read("backend/src/common/logging/logger.service.ts.hbs");
    const hook = src.slice(src.indexOf("addHook('onRequest'"));
    expect(hook.indexOf("beginRequestContext(")).toBeGreaterThan(-1);
    expect(hook.indexOf("beginRequestContext(")).toBeLessThan(hook.indexOf("await initTracing();"));
  });

  it("flushes the exporter on SIGTERM", () => {
    expect(read("backend/src/common/logging/logger.service.ts.hbs")).toContain("runShutdownHooks()");
  });

  it("ships the collector config and compose profile", () => {
    expect(read("observability/otel-collector.yaml.hbs")).toContain("otlp");
    const compose = read("docker-compose.yml.hbs");
    expect(compose).toContain("otel-collector");
    expect(compose).toContain("observability");
  });
});
