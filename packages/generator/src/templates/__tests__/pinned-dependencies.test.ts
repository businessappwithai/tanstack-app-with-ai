/**
 * The generated front end's CopilotKit packages are pinned exactly.
 *
 * A generated application has no lockfile — `bun install` resolves every range
 * the day it runs — so a caret is a promise about releases nobody has seen yet.
 * On 2026-10-28 `^1.68.1` resolved `@copilotkit/runtime` to 1.83.0, published
 * that morning, whose `@copilotkit/channels-*@^0.12.0` dependencies were listed
 * on the registry and served 404: every fresh generation failed to install,
 * and with it CI's "Generate an application and build it".
 *
 * 1.68.1 is the version this repository's own lockfile runs, and every
 * CopilotKit package at 1.68.1 pins its siblings exactly, so the three
 * top-level pins close the whole set. Moving it is a deliberate change: move
 * `packages/web`'s lock with it and generate an application.
 *
 * The TanStack Start 1.97 family is held the other way — by `overrides` in the
 * root manifest `full-stack.generator.ts` writes — and is asserted here too,
 * because the two are the same failure: a transitive caret drifting onto a
 * release the pinned packages were never built against.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const TEMPLATE = readFileSync(
  join(import.meta.dirname, "../../../templates/tanstack-start-nestjs/frontend/package.json.hbs"),
  "utf8"
);
const FULL_STACK = readFileSync(
  join(import.meta.dirname, "../../generators/full-stack.generator.ts"),
  "utf8"
);

function versionOf(name: string): string | undefined {
  return TEMPLATE.match(new RegExp(`"${name.replace("/", "\\/")}":\\s*"([^"]+)"`))?.[1];
}

describe("the generated front end's pinned dependencies", () => {
  it.each(["@copilotkit/react-core", "@copilotkit/react-ui", "@copilotkit/runtime"])(
    "%s is an exact version, not a range",
    (name) => {
      const version = versionOf(name);
      expect(version, `${name} is declared`).toBeDefined();
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    }
  );

  it("pins the three CopilotKit packages to one version", () => {
    const versions = new Set(
      ["@copilotkit/react-core", "@copilotkit/react-ui", "@copilotkit/runtime"].map(versionOf)
    );
    expect(versions.size).toBe(1);
  });

  it("keeps the TanStack Start 1.97 family on the root manifest's overrides", () => {
    for (const name of [
      "@tanstack/router-generator",
      "@tanstack/router-plugin",
      "@tanstack/start-plugin",
      "@tanstack/server-functions-plugin",
      "@tanstack/react-cross-context",
      "@tanstack/directive-functions-plugin",
    ]) {
      expect(FULL_STACK, name).toMatch(new RegExp(`"${name.replace("/", "\\/")}": "1\\.97\\.\\d+"`));
    }
  });
});
