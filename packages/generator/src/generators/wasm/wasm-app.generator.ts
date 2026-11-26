/**
 * The browser stack's generator.
 *
 * It produces a `Map<path, contents>` rather than writing to disk, because the
 * two entry points that use it cannot agree on what disk means: the CLI writes
 * the map into a directory, and the hosted generator page posts it to a Service
 * Worker that serves it back as an application. Returning files instead of
 * writing them is what lets both do that without a second generator.
 *
 * Almost everything it emits is the same for every model — the runtime is
 * copied in verbatim from `templates/wasm`. The model-specific part is three
 * files: `app/model.json`, `app/schema.bus.sql`, and the title in `index.html`.
 * That ratio is the design, not an accident; see model-bundle.ts.
 */

import { renderManual } from "../../manual";
import type { ParsedModel } from "../../pipeline/generate-application";
import { buildModelBundle, type WasmProjectSettings } from "./model-bundle";
import { RUNTIME_ASSETS, RUNTIME_BYTES } from "./runtime-assets.generated";
import { buildSampleData } from "./sample-data";

export interface WasmGeneratorOptions extends WasmProjectSettings {
  /** The EML the model was parsed from, shipped so the app can describe itself. */
  source?: string;
  /**
   * Where PGlite's ES module is loaded from when the app carries no
   * `vendor/pglite/` — a copy the caller hosts. The runtime tries
   * `vendor/pglite/index.js` first regardless, and there is no CDN after it.
   */
  pgliteUrl?: string;
  /**
   * Rows of sample data to generate per entity, seeded on first boot.
   *
   * Zero by default, and left that way for every caller that does not ask:
   * the hosted browser generator produces an application for a model someone
   * is about to look at, and inventing records in it is a decision its page
   * has not made. `appwithai-wasm` passes 10 unless told otherwise, because a
   * CLI generates an application to run rather than to inspect.
   */
  sampleRecords?: number;
  /** Seeds the sample-data PRNG. Defaults to the project name, so it is stable. */
  sampleSeed?: string;
  /** How often an OPTIONAL column is left empty, 0-1. Defaults to 0.15. */
  sampleNullRate?: number;
}

export interface WasmGeneratedApp {
  files: Map<string, string>;
  /** Handy for reporting; the map is the source of truth. */
  stats: {
    fileCount: number;
    bytes: number;
    runtimeBytes: number;
    entities: number;
    rules: number;
    workflows: number;
    /** Sample rows generated across every table; 0 when none were asked for. */
    sampleRows: number;
  };
}

/** The line in `host/browser-node-host.js` that a supplied PGlite URL replaces. */
export const PGLITE_URL_SLOT = 'const PGLITE_URL = "";';

export function generateWasmApp(
  parsed: ParsedModel,
  options: WasmGeneratorOptions
): WasmGeneratedApp {
  const files = new Map<string, string>();

  for (const [name, contents] of Object.entries(RUNTIME_ASSETS)) files.set(name, contents);

  const { model, schema } = buildModelBundle(parsed, options);

  /* Sample rows travel inside the bundle rather than as a second file: the
     seeder already reads model.json at first boot, and a file it had to find
     could go missing between the generator and the Service Worker. */
  const sampleData = buildSampleData(parsed, {
    records: options.sampleRecords ?? 0,
    seed: options.sampleSeed ?? options.name,
    nullRate: options.sampleNullRate,
  });
  const sampleRows = Object.values(sampleData).reduce((total, rows) => total + rows.length, 0);
  if (sampleRows > 0) (model as Record<string, unknown>).sampleData = sampleData;

  files.set("app/model.json", `${JSON.stringify(model, null, 2)}\n`);
  files.set("app/schema.bus.sql", schema);

  if (options.source?.trim()) files.set("model/model.eml.mmd", options.source);

  // The shell is the one runtime file with the project's name in it. Three
  // placeholders substituted here beat a template engine the browser build
  // would then have to carry.
  files.set(
    "index.html",
    (RUNTIME_ASSETS["index.html"] ?? "")
      .replaceAll("__PROJECT_NAME__", escapeHtml(options.name))
      .replaceAll("__PROJECT_DESCRIPTION__", escapeHtml(options.description))
      .replaceAll("__PROJECT_INITIALS__", escapeHtml(initials(options.name)))
  );

  if (options.pgliteUrl) {
    const host = RUNTIME_ASSETS["host/browser-node-host.js"] ?? "";
    if (!host.includes(PGLITE_URL_SLOT)) {
      throw new Error("host/browser-node-host.js has no PGLITE_URL to set");
    }
    files.set(
      "host/browser-node-host.js",
      host.replace(PGLITE_URL_SLOT, `const PGLITE_URL = ${JSON.stringify(options.pgliteUrl)};`)
    );
  }

  /* The manual is a static file rather than a screen the runtime renders,
     because it has to survive being opened out of the zip, out of the Service
     Worker and off a static host alike. `manual.html` is the same file in all
     three. */
  files.set(
    "manual.html",
    renderManual(parsed, {
      name: options.name,
      version: options.version,
      description: options.description,
      stack: "browser",
    })
  );

  files.set("package.json", packageJson(options));
  files.set("README.md", readme(options, parsed));
  files.set(
    ".appwithai.json",
    `${JSON.stringify(
      {
        name: options.name,
        version: options.version,
        description: options.description,
        stack: "wasm-browser",
        database: "pglite (postgresql/wasm)",
        entities: parsed.entities.map((entity) => entity.name),
        rules: parsed.rules.map((rule) => rule.name),
        workflows: parsed.workflows.map((workflow) => workflow.name),
        sagas: parsed.sagas.map((saga) => saga.name),
        generatedAt: new Date().toISOString(),
        generator: "appwithai-wasm",
      },
      null,
      2
    )}\n`
  );

  let bytes = 0;
  for (const contents of files.values()) bytes += contents.length;

  return {
    files,
    stats: {
      fileCount: files.size,
      bytes,
      runtimeBytes: RUNTIME_BYTES,
      entities: parsed.entities.length,
      rules: parsed.rules.length,
      workflows: parsed.workflows.length + parsed.sagas.length,
      sampleRows,
    },
  };
}

function packageJson(options: WasmGeneratorOptions): string {
  return `${JSON.stringify(
    {
      name: slug(options.name),
      version: options.version,
      description: options.description,
      private: true,
      type: "module",
      scripts: {
        // The application ships its own static server. There is nothing to
        // compile and no dependency to install: the single hosting requirement
        // is being reachable over http, so that a Service Worker can register.
        start: "node serve.mjs --port 4000",
        // The same backend, hosted by Node instead of by the browser. Needs
        // PGlite from node_modules unless the app was generated with
        // --vendor-pglite, which is why it is the second script and not the
        // first.
        server: "node host/node-host.mjs --port 4000",
      },
      devDependencies: { "@electric-sql/pglite": "^0.5.5" },
      appwithai: { stack: "wasm-browser" },
    },
    null,
    2
  )}\n`;
}

function readme(options: WasmGeneratorOptions, parsed: ParsedModel): string {
  return `# ${options.name}

${options.description}

Generated by \`appwithai-wasm\` from an EML model. It runs entirely in a browser
tab: PostgreSQL 18 compiled to WebAssembly, an application server on a Worker,
and a Service Worker answering the page's own \`/api\` requests. After the first
load nothing is fetched, and no data leaves the browser.

## Run it

\`\`\`bash
node serve.mjs         # any static host works; it must be http://, not file://
\`\`\`

Then open http://localhost:4000 and sign in as
**${options.adminEmail}** / **${options.adminPassword}**.

The first load starts Postgres and seeds the dictionary, which takes a few
seconds; the boot screen says what it is doing. The database is kept in
IndexedDB, so a reload reattaches to it. Add \`?ephemeral\` to the URL for a
clean in-memory run.

## Run the same backend under Node

\`\`\`bash
node host/node-host.mjs --port 4000
\`\`\`

The identical \`server/\` code on \`node:http\` instead of a Service Worker, against
the identical WebAssembly Postgres. Useful for scripting against the API, and it
is how the generator's own tests exercise it.

This application has no Bun in it and no build step: Node runs the host, the
browser runs the same code under its own Node-API runtime, and nothing is
compiled on the way in either direction. PostgreSQL ships with the application,
in \`vendor/pglite/\`, and is never fetched from a CDN. An application without that
folder — one downloaded from the in-browser generator — needs \`npm install\`
once: \`serve.mjs\` and the Node host then use the installed package.

## What is in here

| Path | |
|---|---|
| \`app/model.json\` | the compiled model: entities, dictionary, rules, processes, access rules |
| \`app/schema.*.sql\` | the schema — \`sys\` (fixed) and \`bus\` (yours) |
| \`server/\` | the backend: routing, CRUD, rules engine, guards, hooks |
| \`host/\` | the two runtimes that can start it — browser Worker, Node |
| \`ui/\` | the interface, drawn from the Application Dictionary |
| \`model/model.eml.mmd\` | the model this was generated from |

## This model

- **${parsed.entities.length}** entities: ${parsed.entities.map((entity) => entity.name).join(", ") || "—"}
- **${parsed.rules.length}** rules${parsed.rules.length ? `: ${parsed.rules.map((rule) => rule.name).join(", ")}` : ""}
- **${parsed.workflows.length}** state machines, **${parsed.sagas.length}** sagas
- **${parsed.hooks.length}** lifecycle hooks
- **${parsed.rbac.operations.length + parsed.rbac.transitions.length}** access restrictions

## What it is not

The roles here decide what the application shows and refuses, exactly as they
would on a server — but the database is a file in your own browser, so they are
not a secret from you. Point this model at the \`tanstackjs-nestjs\` stack when
the data needs to be somewhere other than the reader's machine.
`;
}

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "generated-app";

const initials = (value: string) =>
  value
    .split(/[\s\-_]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => (word[0] ?? "").toUpperCase())
    .join("") || "AP";

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ??
      character
  );
