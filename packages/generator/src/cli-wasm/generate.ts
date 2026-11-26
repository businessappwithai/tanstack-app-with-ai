#!/usr/bin/env node
/**
 * `appwithai-wasm` — generate an application that runs in a browser tab.
 *
 * The sibling of `appwithai`. It reads the same `.eml.mmd`, through the same
 * parser, and compiles the same rules, hooks, workflows and `%%rbac`
 * directives; what changes is the target. Instead of a NestJS backend on Bun
 * and a Vite frontend on Node, it emits an application whose database is
 * PostgreSQL compiled to WebAssembly, whose server runs on a Worker under a
 * Node-API runtime, and whose HTTP layer is a Service Worker — all inside the
 * page that opens it.
 *
 *   appwithai-wasm generate -i model.eml.mmd -o ./app --name "My App"
 *   appwithai-wasm serve ./app                # run it, open a browser
 *   appwithai-wasm inspect model.eml.mmd      # what would be generated
 *
 * PGlite is ~17MB of WebAssembly, and the standalone application carries its
 * own copy in `vendor/pglite/` — never a CDN. `--pglite-url` points it at a
 * copy you host instead. For the full stack, PGlite is an npm dependency of the
 * backend, and `--vendor-pglite` copies it in as well.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import { createServer } from "node:http";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getLogger } from "@appwithai/core/logging";
import { Command } from "commander";
import { DEFAULT_BACKEND_PORT, DEFAULT_FRONTEND_PORT } from "../generators/ports";
import { generateWasmApp, type WasmGeneratedApp } from "../generators/wasm";
import { applyWasmOverlay } from "../generators/wasm/overlay";
import { generateApplication, readModelSources } from "../pipeline/generate-application";
import { cliLogger } from "../pipeline/logger-port";
import { parseModel } from "../pipeline/parse-model";
import { formatIssue, type ModelReview, reviewModel } from "../pipeline/review-model";

const program = new Command();

program
  .name("appwithai-wasm")
  .description(
    "Generate the same stack `appwithai` generates, running on WebAssembly Postgres " +
      "and Node instead of a database server and Bun"
  )
  .version("5.1.0");

/**
 * Settings that belong to *generating* a browser application, kept in a file of
 * their own.
 *
 * `.env` in a generated project is the application's; this one is the
 * generator's, and mixing them would mean an application shipping a record
 * count it has no use for. Only the CLI reads it — the hosted generator has no
 * filesystem to read it from, and no business inventing records in someone's
 * model either.
 *
 *   WASM_SEED_RECORDS=10     rows per entity on first boot; 0 turns it off
 *   WASM_SEED_SEED=acme      fixes the PRNG, so the same model gives the same rows
 *   WASM_SEED_NULL_RATE=0.15 how often an OPTIONAL column is left empty
 *
 * Precedence, highest first: the command-line flag, the process environment,
 * this file, the built-in default.
 */
const WASM_ENV_FILE = ".env.wasm";

interface WasmEnv {
  values: Record<string, string>;
  from?: string;
}

async function readWasmEnv(explicit?: string): Promise<WasmEnv> {
  const candidate = explicit ?? WASM_ENV_FILE;
  const resolved = path.resolve(candidate);
  if (!existsSync(resolved)) {
    /* An explicit --env-file that is not there is a typo worth reporting; the
       default one missing simply means the defaults apply. */
    if (explicit) console.error(`✖ ${resolved} does not exist`);
    if (explicit) process.exit(1);
    return { values: {} };
  }

  const values: Record<string, string> = {};
  for (const line of (await fs.readFile(resolved, "utf8")).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const at = trimmed.indexOf("=");
    if (at <= 0) continue;
    const key = trimmed.slice(0, at).trim();
    let value = trimmed.slice(at + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return { values, from: path.relative(process.cwd(), resolved) || candidate };
}

/** The first of flag, environment, file that is set — reported with its origin. */
function settingFrom(
  flag: string | undefined,
  key: string,
  env: WasmEnv,
  fallback: string
): { value: string; origin: string } {
  if (flag !== undefined) return { value: flag, origin: "--" };
  if (process.env[key] !== undefined) return { value: process.env[key] as string, origin: key };
  if (env.values[key] !== undefined) {
    return { value: env.values[key] as string, origin: env.from ?? WASM_ENV_FILE };
  }
  return { value: fallback, origin: "default" };
}

/** Files PGlite needs at runtime. The `.map` and `contrib` halves are not among them. */
const PGLITE_FILES = [
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
  "vector.tar.gz",
];

program
  .command("generate")
  .description("Generate the full stack, running on WebAssembly Postgres with no server")
  .option("-i, --input <file>", "Input Mermaid ERD / EML file")
  .option("--sys-file <file>", "System entities file (multi-file mode)")
  .option("--bus-file <file>", "Business entities file (multi-file mode)")
  .option("--ref-file <file>", "Reference entities file (multi-file mode)")
  .option("-o, --output <dir>", "Output directory", "./generated-wasm-app")
  .option("-n, --name <name>", "Project name", "my-app")
  .option("-v, --version <version>", "Project version", "1.0.0")
  // The same default as `appwithai`, because it is the same application. A
  // different one showed up as three files differing between the two CLIs —
  // README, the front end's meta description, the test package — which read
  // like the overlay touching things it does not touch.
  .option("-d, --description <desc>", "Project description", "Generated application")
  .option("--admin-email <email>", "Seeded administrator's email", "admin@admin.com")
  .option("--admin-password <password>", "Seeded administrator's password", "admin")
  .option("--admin-name <name>", "Seeded administrator's display name", "admin")
  .option(
    "--vendor-pglite",
    "Full stack: also copy PGlite into backend/vendor (the standalone app always carries it)"
  )
  .option(
    "--standalone",
    "Emit the self-contained browser runtime instead of the full stack: no npm install, " +
      "no build step, boots in seconds — at the cost of not being the NestJS/TanStack source"
  )
  .option("--data-dir <dir>", "Where PostgreSQL (wasm) keeps its files", "./pgdata")
  .option(
    "--pglite-url <url>",
    "Standalone: load PGlite from a copy you host instead of carrying vendor/pglite"
  )
  .option(
    "--sample-records <n>",
    `Rows of sample data to seed per entity on first boot; 0 for none ` +
      `(default 10, or WASM_SEED_RECORDS in ${WASM_ENV_FILE})`
  )
  .option("--sample-seed <text>", "Fix the sample-data PRNG so the rows are reproducible")
  .option(
    "--env-file <file>",
    `Read generation settings from this file instead of ${WASM_ENV_FILE}`
  )
  .option("--force", "Overwrite a non-empty output directory")
  .option("--dry-run", "List what would be written, without writing it")
  .option("--quiet", "Only print errors")
  .option("--skip-check", "Generate without checking the model first")
  .option("--no-auto-fix", "Report what the fixer could repair instead of repairing it")
  .action(async (options) => {
    const say = options.quiet ? () => {} : (line = "") => console.log(line);

    const inputs = [options.input, options.sysFile, options.busFile, options.refFile].filter(
      Boolean
    );
    if (!inputs.length) {
      console.error(
        "✖ Provide a model with -i / --input (or --sys-file / --bus-file / --ref-file)"
      );
      process.exit(1);
    }
    for (const input of inputs) {
      if (!existsSync(path.resolve(input))) {
        console.error(`✖ No such file: ${input}`);
        process.exit(1);
      }
    }

    const sources = await readModelSources(inputs);
    if (!sources.length) {
      console.error("✖ Could not read any of the given model files");
      process.exit(1);
    }

    // Check before compiling. The generator will happily produce an application
    // from a model with an %%rbac rule naming an entity that does not exist —
    // the rule simply never matches, and nothing anywhere says so. The checker
    // knows; it just had to be asked.
    const checked = options.skipCheck
      ? sources
      : reviewSources(sources, inputs, say, options.autoFix !== false);

    say(`\n  Parsing ${inputs.join(", ")}`);
    const parsed = parseModel(checked);

    if (!parsed.entities.length) {
      console.error("✖ The model declares no entities — is the erDiagram section present?");
      process.exit(1);
    }

    const outputDirEarly = path.resolve(options.output);
    if (!options.standalone && !options.dryRun) {
      /* Sample data is a property of the self-contained runtime's first boot,
         where migrate.js reads the rows out of model.json. The default mode
         emits the real NestJS stack, which seeds through its own migrations —
         so say so rather than accepting a flag that would do nothing. */
      if (options.sampleRecords !== undefined) {
        console.error(
          "✖ --sample-records applies to --standalone. The default mode generates the " +
            "NestJS stack, which seeds through its own migrations."
        );
        process.exit(1);
      }
      if (existsSync(outputDirEarly) && !options.force) {
        const entries = await fs.readdir(outputDirEarly);
        if (entries.length) {
          console.error(`✖ ${outputDirEarly} is not empty. Pass --force to overwrite.`);
          process.exit(1);
        }
      }

      // The same pipeline the `appwithai` CLI runs. Nothing about the stack is
      // re-implemented here — the overlay that follows changes the driver and
      // the scripts, and leaves every generated source file alone.
      say("  Generating the NestJS backend and TanStack Start front end");
      await generateApplication({
        logger: cliLogger(getLogger("pipeline")),
        sources,
        model: parsed,
        projectName: options.name,
        projectVersion: options.version,
        projectDescription: options.description,
        outputDir: outputDirEarly,
        stackOption: "tanstackjs-nestjs",
        databaseType: "postgresql",
        port: DEFAULT_BACKEND_PORT,
        frontendPort: DEFAULT_FRONTEND_PORT,
        manifest: { input: inputs, packageManager: "npm" },
      });

      say("  Applying the WebAssembly overlay");
      const overlay = await applyWasmOverlay({
        outputDir: outputDirEarly,
        dataDir: options.dataDir,
        log: (message) => say(`    ${message}`),
      });

      describeStack(say, parsed, overlay);

      if (options.vendorPglite) {
        const copied = await vendorPglite(path.join(outputDirEarly, "backend"));
        say(
          copied
            ? `  Vendored PGlite (${copied} files) into backend/vendor/pglite`
            : "  ⚠ Could not find @electric-sql/pglite to vendor"
        );
      }

      say(`
  Run it:

    cd ${path.relative(process.cwd(), outputDirEarly) || "."}
    npm install --prefix backend && npm run --prefix backend db:setup
    npm run --prefix backend start          # NestJS on WebAssembly Postgres
    npm install --prefix frontend && npm run --prefix frontend dev

  There is no database to start. Sign in as ${options.adminEmail} / ${options.adminPassword}
`);
      return;
    }

    const env = await readWasmEnv(options.envFile);
    const records = settingFrom(options.sampleRecords, "WASM_SEED_RECORDS", env, "10");
    const seed = settingFrom(options.sampleSeed, "WASM_SEED_SEED", env, options.name);
    const nullRate = settingFrom(undefined, "WASM_SEED_NULL_RATE", env, "0.15");

    const sampleRecords = Number.parseInt(records.value, 10);
    if (Number.isNaN(sampleRecords) || sampleRecords < 0) {
      console.error(
        `✖ Sample records must be a whole number, got "${records.value}" (${records.origin})`
      );
      process.exit(1);
    }

    const generated = generateWasmApp(parsed, {
      name: options.name,
      version: options.version,
      description: options.description,
      adminEmail: options.adminEmail,
      adminPassword: options.adminPassword,
      adminName: options.adminName,
      source: sources.join("\n\n"),
      pgliteUrl: options.pgliteUrl,
      sampleRecords,
      sampleSeed: seed.value,
      sampleNullRate: Number.parseFloat(nullRate.value),
    });

    say(
      sampleRecords > 0
        ? `  Sample data      ${generated.stats.sampleRows} rows — ${sampleRecords} per entity (${records.origin})`
        : `  Sample data      none (${records.origin})`
    );

    describe(say, parsed, generated);

    const outputDir = path.resolve(options.output);

    if (options.dryRun) {
      say("\n  Files (dry run):");
      for (const name of [...generated.files.keys()].sort()) say(`    ${name}`);
      say(`\n  ${generated.files.size} files, nothing written.\n`);
      return;
    }

    if (existsSync(outputDir) && !options.force) {
      const entries = await fs.readdir(outputDir);
      if (entries.length) {
        console.error(`✖ ${outputDir} is not empty. Pass --force to overwrite.`);
        process.exit(1);
      }
    }

    await writeFiles(outputDir, generated.files);
    say(`\n  Wrote ${generated.files.size} files to ${outputDir}`);

    // The application's database ships with it. There is no CDN to fall back
    // to, so an application that could not be given PGlite is not finished.
    if (options.pgliteUrl) {
      say(`  PGlite           loaded from ${options.pgliteUrl}`);
    } else {
      const copied = await vendorPglite(outputDir);
      if (!copied) {
        console.error(
          "✖ Could not find @electric-sql/pglite to copy into vendor/pglite. Install it " +
            "(bun add @electric-sql/pglite), or pass --pglite-url with a copy you host."
        );
        process.exit(1);
      }
      say(`  Vendored PGlite (${copied} files) — the application needs no network`);
    }

    say(`
  Run it:

    cd ${path.relative(process.cwd(), outputDir) || "."}
    appwithai-wasm serve .

  Sign in as ${options.adminEmail} / ${options.adminPassword}
`);
  });

program
  .command("serve [dir]")
  .description("Serve a generated application over http (a Service Worker needs http, not file)")
  .option("-p, --port <port>", "Port", "4000")
  .action(async (directory = ".", options) => {
    const root = path.resolve(directory);
    if (!existsSync(path.join(root, "index.html"))) {
      console.error(`✖ ${root} does not look like a generated application (no index.html)`);
      process.exit(1);
    }
    await serveStatic(root, Number(options.port));
  });

program
  .command("run [dir]")
  .description("Serve a generated application and run its backend under Node as well")
  .option("-p, --port <port>", "Port for the backend host", "4001")
  .action(async (directory = ".", options) => {
    const root = path.resolve(directory);
    const host = path.join(root, "host/node-host.mjs");
    if (!existsSync(host)) {
      console.error(`✖ ${root} has no host/node-host.mjs`);
      process.exit(1);
    }
    const child = spawn(process.execPath, [host, "--port", String(options.port)], {
      stdio: "inherit",
      cwd: root,
    });
    child.on("exit", (code) => process.exit(code ?? 0));
  });

program
  .command("inspect <file>")
  .description("Show what would be generated from a model, without generating it")
  .action(async (file) => {
    const sources = await readModelSources([file]);
    if (!sources.length) {
      console.error(`✖ Could not read ${file}`);
      process.exit(1);
    }
    const parsed = parseModel(sources);
    const generated = generateWasmApp(parsed, {
      name: "inspection",
      version: "0.0.0",
      description: "",
      adminEmail: "admin@admin.com",
      adminPassword: "admin",
      adminName: "admin",
    });
    describe((line = "") => console.log(line), parsed, generated);
    console.log("");
  });

/**
 * Check every model file, repair what is repairable, and report the rest.
 *
 * Errors stop the run. That is a deliberate change of posture from `appwithai`,
 * and it is the right one here: the applications this CLI writes are meant to be
 * opened and used immediately — in a tab, with no build log to read afterwards —
 * so a model that says something impossible should be rejected while there is
 * still someone looking at a terminal. `--skip-check` restores the old
 * behaviour for anyone who wants the application anyway.
 *
 * Returns the sources to compile, which are the repaired ones when the fixer
 * had anything to apply.
 */
function reviewSources(
  sources: string[],
  inputs: string[],
  say: (line?: string) => void,
  autoFix: boolean
): string[] {
  const reviews: Array<{ label: string; review: ModelReview }> = sources.map((source, index) => ({
    label: inputs[index] ?? `model ${index + 1}`,
    review: reviewModel(source, { autoFix }),
  }));

  const log = cliLogger(getLogger("pipeline"));

  let errors = 0;
  for (const { label, review } of reviews) {
    errors += review.counts.errors;
    const applied = review.fixes.filter((fix) => fix.applied);

    // The terminal output below is for whoever is watching the run. This is for
    // whoever reads the logs afterwards and wants to know why an application
    // generated a month ago behaves the way it does — a warning the operator
    // scrolled past is the usual answer, and until now it existed only in a
    // terminal that has since been closed.
    for (const issue of review.issues) {
      if (issue.severity !== "warning") continue;
      log.event("pipeline.model.warning", {
        code: issue.code,
        detail: issue.message,
        line: issue.line ?? null,
        model: label,
      });
    }

    if (!review.issues.length && !applied.length) continue;

    say(`\n  Checking ${label}`);
    for (const fix of applied) say(`    fixed  [${fix.code}] ${fix.description}`);
    for (const issue of review.issues) {
      // Info-level findings are the generator's own inferences being announced
      // — a missing FK it will add anyway. Printing them all would bury the two
      // lines that matter under thirty that do not.
      if (issue.severity === "info") continue;
      say(`    ${formatIssue(issue)}`);
      if (issue.hint) say(`           ${issue.hint}`);
    }
    const { errors: e, warnings: w, infos: i } = review.counts;
    say(`    ${e} error(s) · ${w} warning(s) · ${i} info`);
  }

  if (errors > 0) {
    console.error(
      `\n✖ The model has ${errors} error(s). Nothing was generated.\n` +
        "  Fix them, or pass --skip-check to generate anyway.\n"
    );
    process.exit(1);
  }

  return reviews.map(({ review }) => review.source);
}

/** What the overlay changed, so the reader can see the whole difference. */
function describeStack(
  say: (line?: string) => void,
  parsed: ReturnType<typeof parseModel>,
  overlay: { added: string[]; rewritten: string[]; debunned: string[] }
): void {
  say("");
  say(`  Entities       ${parsed.entities.length}`);
  say(`  Rules          ${parsed.rules.length}`);
  say(`  Processes      ${parsed.workflows.length + parsed.sagas.length}`);
  say(`  Access rules   ${parsed.rbac.operations.length + parsed.rbac.transitions.length}`);
  say("");
  say("  The overlay changed only this:");
  for (const file of overlay.added) say(`    + ${file}`);
  for (const file of overlay.rewritten) say(`    ~ ${file}`);
  say(`    ~ ${overlay.debunned.length} scripts moved from bun to node`);
  say("");
  say("  Every other file is what `appwithai` generates, unchanged.");
}

function describe(
  say: (line?: string) => void,
  parsed: ReturnType<typeof parseModel>,
  generated: WasmGeneratedApp
): void {
  const kb = (bytes: number) => `${(bytes / 1024).toFixed(0)}KB`;
  say("");
  say(
    `  Entities       ${parsed.entities.length}  ${parsed.entities.map((e) => e.name).join(", ")}`
  );
  say(`  Relationships  ${parsed.relationships.length}`);
  say(
    `  Categories     ${parsed.categories.length}  ${parsed.categories.map((c) => c.name).join(", ")}`
  );
  say(`  Enums          ${parsed.enums.length}`);
  say(`  Rules          ${parsed.rules.length}  ${parsed.rules.map((r) => r.name).join(", ")}`);
  say(`  Hooks          ${parsed.hooks.length}`);
  say(
    `  State machines ${parsed.workflows.length}  ${parsed.workflows.map((w) => w.name).join(", ")}`
  );
  say(`  Sagas          ${parsed.sagas.length}`);
  say(
    `  Access rules   ${parsed.rbac.operations.length + parsed.rbac.transitions.length} ` +
      `(${parsed.rbac.operations.length} CRUD, ${parsed.rbac.transitions.length} transition)`
  );
  say("");
  say(`  Application    ${generated.stats.fileCount} files, ${kb(generated.stats.bytes)}`);
  say(`                 of which ${kb(generated.stats.runtimeBytes)} is the shared runtime`);
}

async function writeFiles(outputDir: string, files: Map<string, string>): Promise<void> {
  for (const [name, contents] of files) {
    const target = path.join(outputDir, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents, "utf-8");
  }
}

/**
 * Copy PGlite into the application.
 *
 * Resolved from this package's own dependencies rather than the user's cwd, so
 * `appwithai-wasm` installed globally still finds it. Files that are missing in
 * a given PGlite release are skipped rather than failing the generation: the
 * list is a superset across versions, and a vendored app that is missing an
 * optional filesystem backend still runs.
 */
async function vendorPglite(outputDir: string): Promise<number> {
  let base: string;
  try {
    const entry = await import.meta.resolve?.("@electric-sql/pglite");
    base = entry
      ? path.dirname(fileURLToPath(entry))
      : path.dirname(fileURLToPath(pathToFileURL(require.resolve("@electric-sql/pglite")).href));
  } catch {
    const guess = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../../node_modules/@electric-sql/pglite/dist"
    );
    if (!existsSync(guess)) return 0;
    base = guess;
  }

  let copied = 0;
  for (const name of PGLITE_FILES) {
    const from = path.join(base, name);
    if (!existsSync(from)) continue;
    const to = path.join(outputDir, "vendor/pglite", name);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(from, to);
    copied += 1;
  }
  return copied;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".data": "application/octet-stream",
  ".sql": "text/plain; charset=utf-8",
  ".mmd": "text/plain; charset=utf-8",
  ".gz": "application/gzip",
  ".svg": "image/svg+xml",
};

/**
 * A static server, deliberately not a dependency.
 *
 * The generated application has exactly one hosting requirement — be reachable
 * over http so a Service Worker can register — and adding `serve` or `express`
 * to a package whose entire point is that the app has no runtime dependencies
 * would be its own kind of joke.
 */
async function serveStatic(root: string, port: number): Promise<void> {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://localhost:${port}`);
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
      let target = path.normalize(path.join(root, relative));

      if (!target.startsWith(root)) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      if (existsSync(target) && (await fs.stat(target)).isDirectory()) {
        target = path.join(target, "index.html");
      }
      if (!existsSync(target)) {
        response.writeHead(404).end("Not found");
        return;
      }

      // WebContainers need cross-origin isolation; the standalone application
      // needs the absence of it. Both are served from here, so the headers are
      // per-path rather than per-server: only the page that boots a
      // WebContainer is isolated, and everything else keeps working as it did.
      const isolated = /run-real-stack/.test(target);

      response.writeHead(200, {
        "Content-Type": MIME[path.extname(target)] ?? "application/octet-stream",
        "Cache-Control": "no-cache",
        ...(isolated
          ? {
              "Cross-Origin-Opener-Policy": "same-origin",
              "Cross-Origin-Embedder-Policy": "require-corp",
            }
          : {}),
        // Deliberately no COEP. Cross-origin isolation would buy a faster
        // Postgres where SharedArrayBuffer is available, and it costs the
        // ability to embed the application in an iframe — which is exactly what
        // the hosted generator page does, and what broke: a COEP document
        // refuses to embed a response that does not opt in, and a response the
        // Service Worker synthesised cannot easily opt in. PGlite runs fine
        // without it.
        "Cross-Origin-Resource-Policy": "same-origin",
        // Without this a Service Worker registered from /sw.js can only claim
        // its own directory, which is fine here and wrong the moment someone
        // serves the app from a subpath.
        "Service-Worker-Allowed": "/",
      });
      response.end(await fs.readFile(target));
    } catch (error) {
      response.writeHead(500).end(String(error));
    }
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));
  console.log(`\n  Serving ${root}\n  http://localhost:${port}\n`);
}

program.parse(process.argv);
