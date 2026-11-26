#!/usr/bin/env bun

/**
 * Put a copy of PGlite beside the guide, so `html/run-in-browser.html` runs
 * with the network off.
 *
 * Not checked in: it is ~17MB of WebAssembly, most of it one `.wasm` and one
 * `.data`, and a documentation folder is the wrong place to keep that in git.
 * There is no CDN fallback: without this the page generates and downloads an
 * application but will not run one, and says so.
 *
 *   bun run vendor:pglite
 */

import { existsSync } from "node:fs";
import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const FROM = join(ROOT, "node_modules/@electric-sql/pglite/dist");
const TO = join(ROOT, "html/assets/vendor/pglite");

/** What the browser build loads at runtime. The maps and contribs are not it. */
const FILES = [
  "index.js",
  "chunk-2BOC2OMW.js",
  "chunk-F4GETNPB.js",
  "chunk-JDT7TZ73.js",
  "chunk-QY3QWFKW.js",
  "chunk-RYDTTX3G.js",
  "chunk-TDKVRJ2S.js",
  "chunk-VVBUWNGP.js",
  "pglite.js",
  "pglite.wasm",
  "pglite.data",
  "initdb.js",
  "initdb.wasm",
  "templating.js",
  "fs/base.js",
  "fs/opfs-ahp.js",
  "fs/nodefs.js",
  "live/index.js",
  "worker/index.js",
];

if (!existsSync(FROM)) {
  console.error("@electric-sql/pglite is not installed. Run: bun install");
  process.exit(1);
}

let bytes = 0;
let copied = 0;
for (const name of FILES) {
  const from = join(FROM, name);
  if (!existsSync(from)) continue;
  const to = join(TO, name);
  await mkdir(dirname(to), { recursive: true });
  await copyFile(from, to);
  bytes += (await stat(to)).size;
  copied += 1;
}

console.log(
  `\u2713 vendored ${copied} PGlite files (${(bytes / 1024 / 1024).toFixed(1)}MB) into html/assets/vendor/pglite`
);
console.log("  html/run-in-browser.html will find it automatically. It is gitignored.");
