/**
 * Guards against a comment placed among a JSX tag's attributes.
 *
 * A `{...}` comment where an attribute is expected is a parse error, and the
 * failure surfaces a long way from the cause: the route-tree generator gives
 * up, `routeTree.gen.ts` is never written, and the generated app dies at boot
 * on a missing-module error that names neither the file nor the comment. It
 * cost a full debugging pass to find, and nothing else in this repo would have
 * caught it — these files are inert templates here and only become code in
 * someone else's project.
 *
 * This is a structural check, not a parser. No TSX parser is reachable from the
 * test environment: typescript is not resolvable from this package, esbuild is
 * not hoisted, and `Bun` is undefined inside vitest. So it proves exactly one
 * thing — that no comment sits between a tag's attributes — rather than
 * claiming the templates are valid TSX in general. Narrow and true beats broad
 * and unrunnable.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FRONTEND = join(
  import.meta.dirname,
  "../../../../../generator/templates/tanstack-start-nestjs/frontend/src"
);

/** Every .tsx and .tsx.hbs under the frontend templates. */
function collect(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) collect(full, out);
    else if (name.endsWith(".tsx") || name.endsWith(".tsx.hbs")) out.push(full);
  }
  return out;
}

/**
 * Line numbers where a comment opens inside a JSX opening tag.
 *
 * Line-based rather than syntactic, so deliberately conservative: it tracks
 * tags whose attributes are written one per line, which is how every template
 * here is formatted and the only shape the bug appeared in.
 */
function commentsInsideOpeningTags(source: string): number[] {
  const offenders: number[] = [];
  let open = false;

  source.split("\n").forEach((raw, i) => {
    const line = raw.trim();

    if (!open) {
      // `<Component` alone, or `<Component attr={…}` with the tag still open.
      if (/^<[A-Z][\w.]*(\s|$)/.test(line) && !/\/?>$/.test(line)) open = true;
      return;
    }

    if (line.startsWith("{/*")) offenders.push(i + 1);
    if (/\/?>$/.test(line)) open = false;
  });

  return offenders;
}

describe("generated frontend templates", () => {
  const files = collect(FRONTEND);

  it("finds the templates to check", () => {
    expect(files.length).toBeGreaterThan(5);
    expect(files.some((f) => f.endsWith("automations.tsx.hbs"))).toBe(true);
  });

  it("never puts a comment among a tag's attributes", () => {
    const offenders = files.flatMap((file) =>
      commentsInsideOpeningTags(readFileSync(file, "utf8")).map(
        (line) => `${file.replace(FRONTEND, "")}:${line}`
      )
    );
    expect(offenders).toEqual([]);
  });

  it("catches the shape that broke the build", () => {
    // The code that shipped and stopped every generated app booting.
    const broken = [
      "          <AutomationBuilder",
      "            automation={current}",
      "            ruleTables={ruleTableSummaries}",
      "            {/* No onOpenHelp: the header above already offers Help. */}",
      "            onPublish={() => void publish(current)}",
      "          />",
    ].join("\n");
    expect(commentsInsideOpeningTags(broken)).toEqual([4]);
  });

  it("leaves a comment above the element alone", () => {
    const fine = [
      "        {/* No onOpenHelp is passed: the header already offers Help. */}",
      "        {view.kind === 'automation' ? (",
      "          <AutomationBuilder",
      "            automation={current}",
      "            onPublish={() => void publish(current)}",
      "          />",
      "        ) : null}",
    ].join("\n");
    expect(commentsInsideOpeningTags(fine)).toEqual([]);
  });
});
