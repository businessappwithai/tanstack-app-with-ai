/**
 * The spec and the code that logs against it, held together.
 *
 * Without this, the two drift in the one direction nobody notices. A call site
 * naming an event id that no longer exists still compiles — event ids are
 * strings, deliberately, so the spec can be edited without a codegen step — and
 * at runtime it degrades to a `logSpecViolation` warning. That is the right
 * behaviour in production and the wrong thing to discover there.
 *
 * So the check is here instead: every `log.event("…")` in the repository names
 * an event the spec declares, and every event the spec declares is reachable
 * from somewhere. The second half is what stops the catalogue turning into a
 * wishlist of events nothing emits.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { eventIds, logSpec } from "../spec";

const REPO_ROOT = join(import.meta.dirname, "../../../../..");

/** Where a `.event(…)` call may appear. Templates are covered separately. */
const SOURCE_ROOTS = [
  "packages/core/src",
  "packages/generator/src",
  "packages/ai/src",
  "packages/web/src",
  // The production server entry, which is where the process lifecycle events
  // are emitted. It sits beside `src/` rather than in it, so a scan of the
  // source directories alone would miss it and report those events as unused.
  "packages/web/server.ts",
];

const SOURCE_EXTENSIONS = [".ts", ".tsx"];

function walk(dir: string, found: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }

  for (const entry of entries) {
    // `__tests__` is skipped, not filtered later: a test deliberately emits an
    // undeclared id to prove that case is reported rather than swallowed, and
    // scanning it would make that fixture fail the very check it demonstrates.
    if (entry === "node_modules" || entry === "dist" || entry === "__tests__") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, found);
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Every `.event("id"` in the tree, with the file it came from.
 *
 * Deliberately a text scan rather than a TypeScript AST walk: the property is
 * what makes an id findable by a human with grep, and a check that only a
 * compiler can reproduce is one nobody runs by hand.
 */
function eventCallSites(): Array<{ id: string; file: string }> {
  const pattern = /\.event\(\s*["'`]([^"'`]+)["'`]/g;
  const sites: Array<{ id: string; file: string }> = [];

  for (const root of SOURCE_ROOTS) {
    const full = join(REPO_ROOT, root);
    const files = root.endsWith(".ts") ? [full] : walk(full);
    for (const file of files) {
      const text = readFileSync(file, "utf-8");
      for (const match of text.matchAll(pattern)) {
        const id = match[1];
        if (id) sites.push({ id, file: relative(REPO_ROOT, file) });
      }
    }
  }
  return sites;
}

describe("the log spec is internally sound", () => {
  it("loads and validates", () => {
    expect(logSpec.specVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(logSpec.events.length).toBeGreaterThan(0);
    expect(logSpec.channels.length).toBeGreaterThan(0);
  });

  it("puts every event on a declared channel", () => {
    const channels = new Set(logSpec.channels.map((channel) => channel.name));
    const orphans = logSpec.events
      .filter((event) => !channels.has(event.channel))
      .map((event) => `${event.id} -> ${event.channel}`);
    expect(orphans).toEqual([]);
  });

  it("declares each channel at the level of its least severe event", () => {
    const rank = logSpec.levels;
    for (const channel of logSpec.channels) {
      const events = logSpec.events.filter((event) => event.channel === channel.name);
      expect(events.length, `channel ${channel.name} has no events`).toBeGreaterThan(0);

      const quietest = events.reduce((lowest, event) =>
        rank[event.level] < rank[lowest.level] ? event : lowest
      );
      expect(channel.level, `channel ${channel.name}`).toBe(quietest.level);
    }
  });

  it("covers error, warning and informational severities on the surfaces that need them", () => {
    const levels = new Set(logSpec.events.map((event) => event.level));
    expect(levels).toContain("error");
    expect(levels).toContain("warn");
    expect(levels).toContain("info");
  });

  it("redacts the credentials that must never reach a collector", () => {
    const paths = new Set(logSpec.redact.paths);
    for (const required of ["password", "token", "secret", "authorization", "cookie"]) {
      expect(paths, `redact.paths is missing ${required}`).toContain(required);
    }
  });
});

describe("the spec and its call sites agree", () => {
  it("names only events the spec declares", () => {
    const declared = new Set(eventIds());
    const unknown = eventCallSites()
      .filter((site) => !declared.has(site.id))
      .map((site) => `${site.file}: ${site.id}`);

    expect(unknown, "these call sites name an event log-spec.json does not declare").toEqual([]);
  });

  it("declares no event that nothing emits", () => {
    const emitted = new Set(eventCallSites().map((site) => site.id));
    // Events a generated application emits are not called from this tree; they
    // are asserted against the templates by the generator's own suite.
    const generatedOnly = new Set(
      logSpec.channels
        .filter((channel) => !channel.surfaces.includes("generator"))
        .map((channel) => channel.name)
    );
    // An event can be narrower than its channel: `http` is shared, but a
    // request the generated application refused is not one this tree serves.
    const emittedElsewhere = (event: (typeof logSpec.events)[number]): boolean =>
      generatedOnly.has(event.channel) ||
      (event.surfaces !== undefined && !event.surfaces.includes("generator"));

    const unused = logSpec.events
      .filter((event) => !emittedElsewhere(event) && !emitted.has(event.id))
      .map((event) => event.id);

    expect(
      unused,
      "log-spec.json declares these events but nothing in this tree emits them"
    ).toEqual([]);
  });
});
