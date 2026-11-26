/**
 * The generated backend logs through the log spec, and nowhere else.
 *
 * A `console.log` or a Nest `new Logger(...)` in server code is a line the
 * spec does not know about: no level an operator can turn down, no stable id to
 * search for, no redaction. They were everywhere (24 files) before the sweep,
 * and nothing would have stopped them coming back. This is a text scan on
 * purpose — like the conformance check beside the spec, the property is one a
 * human can verify with grep.
 *
 * Every event id a template emits must also be declared (a typo degrades to a
 * warning at run time, which is the wrong place to learn it), and every event
 * a generated application is meant to emit must be emitted somewhere.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import canonical from "../../../../core/src/logging/log-spec.json" with { type: "json" };
import { generatedChannels, generatedEventIds } from "../../logging/generated-spec";

const BACKEND = join(import.meta.dirname, "../../../templates/tanstack-start-nestjs/backend/src");

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, found);
    else if (/\.tsx?(\.hbs)?$/.test(entry)) found.push(full);
  }
  return found;
}

const files = walk(BACKEND);

/**
 * Where a console is the point.
 *  - the logger itself, which writes the process's output;
 *  - scripts and migrations, whose stdout is their report to the person running
 *    them (their outcomes are also events);
 *  - the Trigger.dev tasks, which run in that platform's runtime and use its log;
 *  - the last-resort line in main.ts, for a failure before the logger exists.
 */
const CONSOLE_ALLOWED = [
  /^common\/logging\//,
  /^migrate\.ts/,
  /^seed\.ts/,
  /^migrations\//,
  /^trigger\//,
  /^main\.ts/,
];

const rel = (file: string) => relative(BACKEND, file);

describe("server code in a generated backend", () => {
  it("never calls console.* outside a script, a migration or the logger itself", () => {
    const offenders = files
      .filter((file) => !CONSOLE_ALLOWED.some((allowed) => allowed.test(rel(file))))
      .filter((file) => /\bconsole\.(log|info|warn|error|debug)\(/.test(readFileSync(file, "utf-8")))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("never constructs a Nest Logger — the free-text line the spec cannot see", () => {
    const offenders = files
      .filter((file) => !/^common\/logging\//.test(rel(file)))
      .filter((file) => /new Logger\(/.test(readFileSync(file, "utf-8")))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("turns Fastify's own request logger off — it writes the line the response hook already does", () => {
    const main = readFileSync(join(BACKEND, "main.ts.hbs"), "utf-8");
    expect(main).toMatch(/logger: false,/);
    expect(main).not.toMatch(/logger: process\.env\.NODE_ENV === 'development'/);
  });

  it("keeps main.ts to a single console, the last resort before the logger exists", () => {
    const main = readFileSync(join(BACKEND, "main.ts.hbs"), "utf-8");
    expect(main.match(/\bconsole\.(log|info|warn|error|debug)\(/g)).toHaveLength(1);
  });
});

describe("browser code in a generated front end", () => {
  const FRONTEND = join(import.meta.dirname, "../../../templates/tanstack-start-nestjs/frontend/src");
  const frontendFiles = walk(FRONTEND);

  // The logger writes the console; the two proxies run on the front end's own
  // server, where there is no browser to report to and no backend logger.
  const ALLOWED = [/^lib\/logger\.ts$/, /^lib\/api-proxy\.ts$/, /^lib\/copilot-runtime\.ts$/];

  it("prints through the client logger, never console.* directly", () => {
    const offenders = frontendFiles
      .filter((file) => !ALLOWED.some((allowed) => allowed.test(relative(FRONTEND, file))))
      .filter((file) =>
        readFileSync(file, "utf-8")
          .split("\n")
          .some((line) => /\bconsole\.(log|info|warn|error|debug)\(/.test(line) && !/^\s*(\*|\/\/)/.test(line))
      )
      .map((file) => relative(FRONTEND, file));
    expect(offenders).toEqual([]);
  });
});

describe("the events the templates emit", () => {
  const emitted = new Set<string>();
  for (const file of files) {
    for (const match of readFileSync(file, "utf-8").matchAll(/\.event\(\s*['"`]([^'"`]+)['"`]/g)) {
      if (match[1]) emitted.add(match[1]);
    }
  }
  const declared = new Set((canonical as { events: Array<{ id: string }> }).events.map((e) => e.id));

  it("are all declared in the spec", () => {
    expect([...emitted].filter((id) => !declared.has(id))).toEqual([]);
  });

  it("include every event the generated application is meant to emit", () => {
    // Generated-only events must be emitted by a template. Events on a channel the
    // modelling tool shares are checked from the other side, in core.
    const unused = generatedEventIds().filter((id) => {
      const event = (canonical as { events: Array<{ id: string; channel: string; surfaces?: string[] }> })
        .events.find((e) => e.id === id);
      const shared = generatedChannels().includes(event?.channel ?? "") &&
        (canonical as { channels: Array<{ name: string; surfaces: string[] }> }).channels
          .find((c) => c.name === event?.channel)?.surfaces.includes("generator");
      return !shared && !emitted.has(id);
    });
    expect(unused, "declared for generated applications but emitted by no template").toEqual([]);
  });
});
