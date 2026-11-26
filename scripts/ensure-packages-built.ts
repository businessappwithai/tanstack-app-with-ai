#!/usr/bin/env bun
/**
 * Build the workspace packages the web app imports, if they are not built yet.
 *
 * `packages/web` reaches `@appwithai/core`, `@appwithai/generator` and
 * `@appwithai/ai` by bare specifier, and their `exports` maps point at `dist/`.
 * On a fresh clone that directory does not exist, so on a tree that has never
 * been built `bun run dev` started a server whose every API route answered 500 —
 * `Cannot find module '@appwithai/core/services'` — with nothing on the page to
 * say why. It was reproducible, undocumented, and cost everyone who met it the
 * same half hour.
 *
 * So `dev` runs this first. It builds only what is missing or older than its source, which makes the
 * first run work and every run after it cost one `existsSync` per package.
 *
 *   bun scripts/ensure-packages-built.ts          build what is missing
 *   bun scripts/ensure-packages-built.ts --force  build everything regardless
 *
 * Before building, it checks that `node_modules` matches the manifests. A pull
 * that bumps a dependency leaves the old version installed until someone runs
 * `bun install`, and Vite does not say "out of date" — it says an import does
 * not exist. `packages/editors` moving `monaco-editor` from 0.52 to 0.57 showed
 * up as `Failed to resolve import "monaco-editor/editor/editor.worker?worker"`,
 * because 0.52 has no `exports` map and the path is only 0.57's. So every
 * workspace's declared dependency is resolved the way Node would resolve it
 * from that workspace, and a missing one or one outside its range stops `dev`
 * with the one command that fixes it.
 *
 * This is deliberately not a watcher. Editing `packages/core` during a dev
 * session still needs `bun run build:core` — Vite watches `packages/web`, not
 * the built output of its dependencies.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readManifest(path: string): Manifest {
  return JSON.parse(readFileSync(path, "utf8")) as Manifest;
}

/** The installed version `name` resolves to from `from`, walking up as Node does. */
function installedVersion(name: string, from: string): string | undefined {
  for (let dir = from; ; dir = dirname(dir)) {
    const manifest = join(dir, "node_modules", name, "package.json");
    if (existsSync(manifest)) return (readManifest(manifest) as { version?: string }).version;
    if (dir === ROOT || dirname(dir) === dir) return undefined;
  }
}

/**
 * Whether bun.lock marks `name` as built for another platform — a native binary
 * such as `@gorules/zen-engine-darwin-arm64`, which bun rightly skips elsewhere.
 */
function isForAnotherPlatform(name: string): boolean {
  const lock = readFileSync(join(ROOT, "bun.lock"), "utf8");
  const entry = lock.split("\n").find((line) => line.trimStart().startsWith(`"${name}": [`));
  if (!entry) return false;
  const allows = (key: string, current: string) => {
    const match = entry.match(new RegExp(`"${key}": (\\[[^\\]]*\\]|"[^"]*")`));
    return !match?.[1] || match[1].includes(`"${current}"`);
  };
  return !allows("os", process.platform) || !allows("cpu", process.arch);
}

/** Every declared dependency that is missing or outside its range, as a printable line. */
function staleDependencies(): string[] {
  const workspaces = [
    ROOT,
    ...readdirSync(join(ROOT, "packages")).map((name) => join(ROOT, "packages", name)),
  ].filter((dir) => existsSync(join(dir, "package.json")));

  const problems: string[] = [];
  for (const dir of workspaces) {
    const manifest = readManifest(join(dir, "package.json"));
    const where = dir === ROOT ? "(root)" : dir.slice(ROOT.length + 1);
    for (const [name, range] of Object.entries({
      ...manifest.dependencies,
      ...manifest.devDependencies,
    })) {
      // `workspace:*`, `npm:` aliases and the like name no range to hold a version to.
      if (range.includes(":")) continue;
      const version = installedVersion(name, dir);
      if (version === undefined) {
        if (isForAnotherPlatform(name)) continue;
        problems.push(`  ${where}: ${name} ${range} is not installed`);
      } else if (!Bun.semver.satisfies(version, range)) {
        problems.push(`  ${where}: ${name} ${range} is installed at ${version}`);
      }
    }
  }
  return problems;
}

const stale = staleDependencies();
if (stale.length > 0) {
  console.error(
    `node_modules does not match package.json — run "bun install" first.\n\n${stale.join("\n")}\n`
  );
  process.exit(1);
}

/**
 * Each package, and one file that only exists once it has been built.
 *
 * The marker is a subpath the web app actually imports rather than the
 * directory itself: a `dist/` left behind by an interrupted or older build can
 * exist while the entry point the app needs does not.
 */
const PACKAGES = [
  { name: "core", script: "build:core", marker: "packages/core/dist/index.js" },
  { name: "generator", script: "build:generator", marker: "packages/generator/dist/index.js" },
  { name: "ai", script: "build:ai", marker: "packages/ai/dist/index.js" },
] as const;

/** The newest modification time under `dir`, in ms; 0 when it holds no files. */
function newestMtime(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(path) : statSync(path).mtimeMs);
  }
  return newest;
}

/**
 * Built, but older than the source it was built from. A pull leaves the old `dist/` in
 * place, and the web app imports the generator by bare specifier — so its dry-run kept
 * compiling rules with a compiler from before `emptyMeansBlank`, and "is empty" stopped
 * matching a cleared text box (`""`) while the source said it did.
 */
function isOlderThanSource(pkg: (typeof PACKAGES)[number]): boolean {
  const src = join(ROOT, "packages", pkg.name, "src");
  return existsSync(src) && newestMtime(src) > statSync(join(ROOT, pkg.marker)).mtimeMs;
}

const force = process.argv.includes("--force");
const missing = PACKAGES.filter(
  (pkg) => force || !existsSync(join(ROOT, pkg.marker)) || isOlderThanSource(pkg)
);

if (missing.length === 0) {
  process.exit(0);
}

console.log(
  `Building ${missing.map((pkg) => pkg.name).join(", ")} — the web app imports ${
    missing.length === 1 ? "it" : "them"
  } and ${missing.length === 1 ? "it is" : "they are"} missing or older than the source.`
);

for (const pkg of missing) {
  const result = Bun.spawnSync(["bun", "run", pkg.script], {
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });

  if (result.exitCode !== 0) {
    console.error(
      `\nFailed to build @appwithai/${pkg.name}. Run "bun run ${pkg.script}" to see why.`
    );
    process.exit(result.exitCode ?? 1);
  }
}
