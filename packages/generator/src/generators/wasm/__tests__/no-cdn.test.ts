/**
 * Nothing in the browser stack, or on the guide pages that run it, comes from a
 * CDN. PostgreSQL is the application's own database: it ships in
 * `vendor/pglite/`, or `serve.mjs` serves the installed package, or a URL the
 * caller hosts is written in — and when none of those holds, the application
 * says so instead of reaching for a third party.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseModel } from "../../../pipeline/parse-model";
import { RUNTIME_ASSETS } from "../runtime-assets.generated";
import { generateWasmApp, PGLITE_URL_SLOT } from "../wasm-app.generator";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../..");

// Assembled from parts so this file does not match itself.
const CDN = new RegExp(
  ["cdn\\.jsdelivr", "unpkg\\.com", "cdnjs\\.", "esm\\.sh", "cdn\\.skypack", "jspm\\.io"].join("|")
);

const MODEL = readFileSync(path.join(REPO, "language/examples/crm.eml.mmd"), "utf8");
const OPTIONS = {
  name: "No CDN",
  version: "1.0.0",
  description: "No CDN",
  adminEmail: "admin@admin.com",
  adminPassword: "admin",
  adminName: "admin",
};

function files(dir: string, keep: (name: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "vendor" ? [] : files(full, keep);
    return keep(name) ? [full] : [];
  });
}

describe("the browser stack loads nothing from a CDN", () => {
  it("in any file of a generated application", () => {
    const { files: generated } = generateWasmApp(parseModel(MODEL), OPTIONS);
    const hits = [...generated].filter(([, text]) => CDN.test(text)).map(([name]) => name);
    expect(hits).toEqual([]);
  });

  it("writes --pglite-url into the host, and nothing when there is none", () => {
    expect(RUNTIME_ASSETS["host/browser-node-host.js"]).toContain(PGLITE_URL_SLOT);

    const plain = generateWasmApp(parseModel(MODEL), OPTIONS).files;
    expect(plain.get("host/browser-node-host.js")).toContain(PGLITE_URL_SLOT);

    const hosted = generateWasmApp(parseModel(MODEL), { ...OPTIONS, pgliteUrl: "/pg/index.js" });
    expect(hosted.files.get("host/browser-node-host.js")).toContain(
      'const PGLITE_URL = "/pg/index.js";'
    );
  });

  it("in the templates, or on the guide pages that run them", () => {
    const sources = [
      ...files(path.join(REPO, "packages/generator/templates"), (name) => !name.endsWith(".map")),
      ...files(path.join(REPO, "html"), (name) => /\.(html|css|js)$/.test(name)).filter(
        // Built bundles of this repository's own source, held to it by --check.
        (file) => !/html\/assets\/appwithai-[a-z]+\.js$/.test(file)
      ),
    ];
    const hits = sources
      .filter((file) => CDN.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(REPO, file));
    expect(hits).toEqual([]);
  });
});
