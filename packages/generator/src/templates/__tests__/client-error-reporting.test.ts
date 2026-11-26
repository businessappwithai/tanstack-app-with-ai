/**
 * How a generated application's browser reads, prints and reports errors.
 *
 * Three small modules carry it, none with a framework in them, so they are
 * imported from the template tree and driven directly: the envelope reader
 * (`api-error`), the console logger's redaction (`logger`), and the limits on
 * the route the browser reports to (`client-log-rules`).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  describeError,
  errorCategory,
  errorCode,
  errorRef,
  isCategory,
  isServerFailure,
  withReference,
} from "../../../templates/tanstack-start-nestjs/frontend/src/lib/api-error";
import { redact } from "../../../templates/tanstack-start-nestjs/frontend/src/lib/logger";
import {
  admit,
  CLIENT_LOG_LIMITS,
  pathOf,
  text,
} from "../../../templates/tanstack-start-nestjs/backend/src/modules/client-logs/client-log-rules";

const FRONTEND = join(import.meta.dirname, "../../../templates/tanstack-start-nestjs/frontend/src");

describe("reading the error envelope", () => {
  const conflict = {
    statusCode: 409,
    message: "Someone else saved this record first.",
    ref: "abcd1234",
    details: { code: "VERSION_CONFLICT", category: "conflict", currentVersion: 4 },
  };

  it("reads the code, category and reference", () => {
    expect(errorCode(conflict)).toBe("VERSION_CONFLICT");
    expect(errorCategory(conflict)).toBe("conflict");
    expect(errorRef(conflict)).toBe("abcd1234");
    expect(isCategory(conflict, "conflict", "business_rule")).toBe(true);
    expect(isCategory(conflict, "validation")).toBe(false);
  });

  it("falls back to requestId for a client written before ref existed", () => {
    expect(errorRef({ requestId: "old-id-1234" })).toBe("old-id-1234");
  });

  it("reads nothing from things that are not envelopes", () => {
    for (const thing of [null, undefined, "boom", 42, new Error("x")]) {
      expect(errorCode(thing)).toBeUndefined();
      expect(errorCategory(thing)).toBeUndefined();
      expect(isServerFailure(thing)).toBe(false);
    }
  });

  it("adds the reference to a server failure and to nothing else", () => {
    const failure = { statusCode: 500, message: "Something went wrong.", ref: "req-77aa88bb" };
    expect(describeError(failure)).toBe("Something went wrong. (Reference: req-77aa88bb)");
    expect(describeError(conflict)).toBe("Someone else saved this record first.");
    expect(withReference("Saved", { statusCode: 404, ref: "x" })).toBe("Saved");
  });

  it("takes the first of a list of messages and a fallback for an empty one", () => {
    expect(describeError({ statusCode: 400, message: ["first", "second"] })).toBe("first");
    expect(describeError({ statusCode: 400 }, "Could not save")).toBe("Could not save");
  });
});

describe("the console logger", () => {
  it("replaces anything under a credential-looking key, at any depth", () => {
    const printed = JSON.stringify(
      redact({
        email: "a@b.c",
        password: "hunter2",
        nested: { apiKey: "k-123", Authorization: "Bearer t", ok: 1 },
        list: [{ sessionToken: "s" }],
      })
    );
    for (const secret of ["hunter2", "k-123", "Bearer t", '"s"']) {
      expect(printed).not.toContain(secret);
    }
    expect(printed).toContain("a@b.c");
  });

  it("prints an Error as its name and message, not its stack", () => {
    expect(redact(new TypeError("bad"))).toEqual({ name: "TypeError", message: "bad" });
  });
});

describe("what a browser may report", () => {
  it("is limited to sixty reports a minute per user", () => {
    const start = 1_000_000;
    let admitted = 0;
    for (let i = 0; i < 100; i++) if (admit("user-a", start + i)) admitted += 1;
    expect(admitted).toBe(CLIENT_LOG_LIMITS.perMinute);
    // Another user is unaffected, and the first is admitted again a minute later.
    expect(admit("user-b", start)).toBe(true);
    expect(admit("user-a", start + 60_000)).toBe(true);
  });

  it("truncates text and removes the control characters that could forge a log line", () => {
    expect(text("a\nb\r\n{\"level\":\"fatal\"}", 100)).not.toMatch(/[\r\n]/);
    expect(text("x".repeat(5000), CLIENT_LOG_LIMITS.messageChars)).toHaveLength(
      CLIENT_LOG_LIMITS.messageChars
    );
    expect(text("", 10)).toBeNull();
    expect(text(42, 10)).toBeNull();
  });

  it("keeps the path of a URL and drops its query and fragment", () => {
    expect(pathOf("https://x.test/bus/Order?search=jane%20doe#top")).toBe("/bus/Order");
    expect(pathOf("/admin/rules?token=abc")).toBe("/admin/rules");
    expect(pathOf(undefined)).toBeNull();
  });
});

describe("the front end's wiring", () => {
  const read = (relative: string) => readFileSync(join(FRONTEND, relative), "utf-8");

  it("reports a render error from the root error component", () => {
    const root = read("routes/__root.tsx.hbs");
    expect(root).toContain("reportClientError");
    expect(root).toContain("source: 'boundary'");
  });

  it("reports server failures from the query client and installs the global handlers", () => {
    const provider = read("providers/query-provider.tsx");
    expect(provider).toContain("new QueryCache");
    expect(provider).toContain("new MutationCache");
    expect(provider).toContain("installGlobalErrorReporting()");
  });

  it("no longer prints request bodies or headers from the API client", () => {
    const client = read("lib/api-client.ts");
    expect(client).not.toMatch(/Body:|sanitizeHeaders|Headers:/);
  });
});
