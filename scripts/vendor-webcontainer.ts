#!/usr/bin/env bun

/**
 * Put a copy of `@webcontainer/api` beside the guide, for
 * `html/run-real-stack.html`.
 *
 * The page imports it from `assets/vendor/webcontainer-api/` and nowhere else:
 * no library this repository uses is fetched from a CDN. The package is plain
 * ES modules with relative imports only, so its `dist/` is served as it is.
 * Not checked in, the same as PGlite beside it (`bun run vendor:pglite`).
 *
 * What the API then connects to — the WebContainer runtime — is StackBlitz's
 * own service, opened in an iframe. That is the product the page demonstrates,
 * and it cannot be served from here.
 *
 *   bun run vendor:webcontainer
 */

import { existsSync } from "node:fs";
import { cp, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const FROM = join(ROOT, "node_modules/@webcontainer/api/dist");
const TO = join(ROOT, "html/assets/vendor/webcontainer-api");

if (!existsSync(FROM)) {
  console.error("@webcontainer/api is not installed. Run: bun install");
  process.exit(1);
}

await rm(TO, { recursive: true, force: true });
// The type declarations are of no use to a browser.
await cp(FROM, TO, { recursive: true, filter: (source) => !source.endsWith(".d.ts") });

const count = async (dir: string): Promise<number> =>
  (await readdir(dir, { withFileTypes: true })).reduce(
    async (total, entry) =>
      (await total) + (entry.isDirectory() ? await count(join(dir, entry.name)) : 1),
    Promise.resolve(0)
  );
console.log(
  `✓ vendored @webcontainer/api (${await count(TO)} files) into ${TO.slice(ROOT.length + 1)}`
);
