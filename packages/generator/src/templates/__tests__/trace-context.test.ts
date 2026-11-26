import { describe, expect, it } from "vitest";

import {
  keepDebug,
  parseTraceparent,
  sampleRate,
} from "../../../templates/tanstack-start-nestjs/backend/src/common/logging/trace-context";

const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const SPAN = "00f067aa0ba902b7";

describe("parseTraceparent", () => {
  it("reads a well-formed header", () => {
    expect(parseTraceparent(`00-${TRACE}-${SPAN}-01`)).toEqual({ traceId: TRACE, spanId: SPAN, sampled: true });
    expect(parseTraceparent(`00-${TRACE}-${SPAN}-00`)?.sampled).toBe(false);
  });

  it("ignores everything that is not exactly that shape, because it is caller input written to a log", () => {
    for (const bad of [
      undefined,
      null,
      42,
      "",
      `01-${TRACE}-${SPAN}-01`,
      `ff-${TRACE}-${SPAN}-01`,
      `00-${TRACE.toUpperCase()}-${SPAN}-01`,
      `00-${TRACE}-${SPAN}`,
      `00-${TRACE.slice(1)}-${SPAN}-01`,
      `00-${TRACE}-${SPAN.slice(1)}-01`,
      `00-${"0".repeat(32)}-${SPAN}-01`,
      `00-${TRACE}-${"0".repeat(16)}-01`,
      `00-${TRACE}-${SPAN}-01\nX-Injected: 1`,
      ` 00-${TRACE}-${SPAN}-01`,
    ]) {
      expect(parseTraceparent(bad), String(bad)).toBeNull();
    }
  });
});

describe("sampleRate", () => {
  it("keeps everything unless told otherwise, and clamps", () => {
    expect(sampleRate(undefined)).toBe(1);
    expect(sampleRate("")).toBe(1);
    expect(sampleRate("not a number")).toBe(1);
    expect(sampleRate("0.25")).toBe(0.25);
    expect(sampleRate("5")).toBe(1);
    expect(sampleRate("-1")).toBe(0);
  });
});

describe("keepDebug", () => {
  const ids = Array.from({ length: 4000 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);

  it("is all or nothing at the ends", () => {
    for (const id of ids.slice(0, 20)) {
      expect(keepDebug(id, 1)).toBe(true);
      expect(keepDebug(id, 0)).toBe(false);
    }
  });

  it("gives one request one answer, however many times it is asked", () => {
    for (const id of ids.slice(0, 50)) {
      const first = keepDebug(id, 0.3);
      for (let i = 0; i < 5; i++) expect(keepDebug(id, 0.3)).toBe(first);
    }
  });

  it("keeps about the requested share of requests, even for ids that differ in a few bytes", () => {
    const kept = ids.filter((id) => keepDebug(id, 0.25)).length;
    expect(kept / ids.length).toBeGreaterThan(0.2);
    expect(kept / ids.length).toBeLessThan(0.3);
  });

  it("falls back to chance when there is no request", () => {
    expect(keepDebug(undefined, 0.5, () => 0.4)).toBe(true);
    expect(keepDebug(undefined, 0.5, () => 0.6)).toBe(false);
  });
});

describe("the wiring", () => {
  it("never samples above debug: the check sits behind a level test", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const logger = readFileSync(
      join(import.meta.dirname, "../../../templates/tanstack-start-nestjs/backend/src/common/logging/logger.service.ts.hbs"),
      "utf-8"
    );
    expect(logger).toMatch(/declared\.level === 'debug' \|\| declared\.level === 'trace'\) && !keepDebug/);
    expect(logger).toMatch(/parseTraceparent\(\s*request\.headers\?\.\['traceparent'\]/);
  });
});
