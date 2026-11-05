#!/usr/bin/env node

/**
 * APPWITHAI Code Generator CLI
 *
 * Generates full-stack applications from Mermaid ERD / EML diagrams.
 * One stack is supported: tanstackjs-nestjs (TanStack Start + NestJS).
 */

import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { getLogger } from "@appwithai/core/logging";
import type { Entity, EntityEnum, Relationship } from "@appwithai/core/types";
import { Command } from "commander";
import { extractRuleSections } from "../eml";
import type { StackOption } from "../generators/full-stack.generator";
import { NestJsBackendGenerator } from "../generators/tanstack-start-nestjs/nestjs-backend.generator";
import { TanStackStartFrontendGenerator } from "../generators/tanstack-start-nestjs/tanstack-start-frontend.generator";
import { compileHooks } from "../hooks";
import { type EntityCategory, resolveCategories } from "../parsers/category.parser";
import { MermaidParser } from "../parsers/mermaid.parser";
import { attachFormSections } from "../parsers/section.parser";
import { generateApplication, readModelSources } from "../pipeline";
import { cliLogger } from "../pipeline/logger-port";
import { compileRbac } from "../rbac";
import { compileDashboards, compileReports } from "../reports";
import { compileRules } from "../rules";
import { runTypeChecks } from "../utils/type-check.js";
import { compileSagaWorkflows, compileWorkflows } from "../workflows";

// Resolve relative paths from the workspace root (INIT_CWD) when called via bun --filter
const resolvePath = (p: string) =>
  path.isAbsolute(p) ? p : path.resolve(process.env.INIT_CWD || process.cwd(), p);

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function log(msg: string, quiet: boolean) {
  if (!quiet) console.log(msg);
}

function getStackDescription(_stack: StackOption): string {
  return "tanstackjs-nestjs - Modern Web (TanStack Start + NestJS)";
}

/** Parse an ERD / EML / Mermaid file and return entities + relationships. */
async function parseFile(
  filePath: string
): Promise<{ entities: Entity[]; relationships: Relationship[]; enums: EntityEnum[] }> {
  const absPath = resolvePath(filePath);
  await fs.access(absPath);
  const content = await fs.readFile(absPath, "utf-8");
  const parser = new MermaidParser();
  const parsed = parser.parse(content);
  // `%%section` lives in `%%` comment lines the ERD parser drops — the same
  // reason categories are read from the raw text below.
  attachFormSections(content, parsed.entities);
  return parsed;
}

/**
 * Read the Application Dictionary categories a model declares with `%%category`
 * directives, filling in a "General" default for anything left unassigned.
 * Reads the raw source because the ERD parser discards `%%` comment lines.
 */
async function parseCategoriesFrom(
  filePaths: Array<string | undefined>,
  entities: Entity[]
): Promise<EntityCategory[]> {
  const sources = await readModelSources(filePaths.map((p) => p && resolvePath(p)));
  // Reuses the pipeline's resolution so the CLI and the web app agree on what a
  // model's `%%category` directives mean, including the "General" fallback.
  return resolveCategories(
    sources.join("\n"),
    entities.map((entity) => entity.name)
  );
}

/** Check whether the output directory already contains files. */
async function outputDirHasContent(outputDir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(outputDir);
    return entries.filter((e) => !e.startsWith(".")).length > 0;
  } catch {
    return false;
  }
}

/**
 * Post-generation setup: install deps, create DB, run migrations + seeds.
 * Copies .env.example → .env if .env does not already exist.
 */
async function runSetup(opts: {
  outputDir: string;
  dbType: string;
  projectName: string;
  packageManager: string;
  quiet: boolean;
}) {
  const { outputDir, dbType, packageManager: pm, quiet } = opts;
  const backendDir = path.join(outputDir, "backend");
  const frontendDir = path.join(outputDir, "frontend");
  const dbName = opts.projectName
    .replace(/-/g, "_")
    .replace(/[^a-z0-9_]/gi, "")
    .toLowerCase();

  const run = (cmd: string, args: string[], cwd: string, label: string) => {
    log(`   ${label}…`, quiet);
    const res = spawnSync(cmd, args, { cwd, stdio: quiet ? "pipe" : "inherit", shell: false });
    if (res.status !== 0) {
      const stderr = res.stderr?.toString().trim();
      throw new Error(`${label} failed${stderr ? `: ${stderr}` : ""}`);
    }
  };

  // 1. Install deps (root workspace so both backend + frontend get installed)
  log("\n📦 Installing dependencies…", quiet);
  run(pm, ["install"], outputDir, `${pm} install`);

  // 2. Generate the router's route tree.
  //
  // Every route file imports the ids declared in `src/routeTree.gen.ts`, and
  // the Vite plugin only writes it on the first `dev` or `build`. Until then a
  // freshly generated application does not typecheck — around seventy errors,
  // all of them the same missing module and none of them a real defect.
  //
  // Runs here, straight after the install that provides the CLI, rather than at
  // the end: the steps below touch a database, and whether the route tree
  // exists has nothing to do with whether Postgres is reachable. Ordering it
  // after them meant a failed migration left the application unable to
  // typecheck for an unrelated reason.
  //
  // Non-fatal either way: if it fails, the first `dev` run still writes it.
  log("\n🧭 Generating the route tree…", quiet);
  const routes = spawnSync(pm, ["run", "routes:generate"], {
    cwd: frontendDir,
    stdio: "pipe",
  });
  if (routes.status === 0) {
    log("   ✓ src/routeTree.gen.ts written", quiet);
  } else {
    console.warn("   ⚠️  Could not generate the route tree; the first `dev` run will write it.");
  }

  // 3. Copy .env.example → .env in backend (skip if already exists)
  const envPath = path.join(backendDir, ".env");
  const envExamplePath = path.join(backendDir, ".env.example");
  try {
    await fs.access(envPath);
  } catch {
    try {
      await fs.copyFile(envExamplePath, envPath);
      log("   ✓ backend/.env created from .env.example", quiet);
    } catch {
      // non-fatal — user can copy manually
    }
  }

  // 3. Create PostgreSQL database if needed
  if (dbType === "postgresql") {
    log(`\n🗄️  Creating database "${dbName}"…`, quiet);
    const createDb = spawnSync("createdb", [dbName], { stdio: "pipe" });
    if (createDb.status === 0) {
      log(`   ✓ Database "${dbName}" created`, quiet);
    } else {
      const msg = createDb.stderr?.toString() ?? "";
      if (msg.includes("already exists")) {
        log(`   ✓ Database "${dbName}" already exists`, quiet);
      } else {
        // Non-fatal — user may be using DATABASE_URL or remote DB
        console.warn(
          `   ⚠️  createdb: ${msg.trim() || "could not create database (may already exist or need manual setup)"}`
        );
      }
    }
  }

  // 4. Run migrations
  log("\n🔄 Running migrations…", quiet);
  run(pm, ["run", "migrate"], backendDir, "migrate");

  // 5. Run seeds
  log("\n🌱 Running seeds…", quiet);
  run(pm, ["run", "seed"], backendDir, "seed");

  // 6. Install frontend deps separately if it has its own package.json
  try {
    await fs.access(path.join(frontendDir, "package.json"));
    log("\n📦 Installing frontend dependencies…", quiet);
    run(pm, ["install"], frontendDir, `${pm} install (frontend)`);
  } catch {
    // no separate frontend package.json — already installed at root
  }
}

// ---------------------------------------------------------------------------
// E2E test run (bun:test)
// ---------------------------------------------------------------------------

/**
 * Install the test workspace's dependencies and run the generated suites.
 *
 * The suites start the backend themselves (or attach to one already listening),
 * so this only needs a migrated + seeded database — which `runSetup` has
 * already produced by the time we get here.
 *
 * Returns true when the suites pass, false when they fail, and null when they
 * could not be run at all.
 */
async function runE2ETests(opts: {
  outputDir: string;
  packageManager: string;
  fast: boolean;
  quiet: boolean;
}): Promise<boolean | null> {
  const { outputDir, packageManager: pm, fast, quiet } = opts;
  const testsDir = path.join(outputDir, "tests");

  try {
    await fs.access(path.join(testsDir, "run.ts"));
  } catch {
    console.warn("\n⚠️  No tests/ directory found — skipping the E2E run.");
    return null;
  }

  log("\n📦 Installing test dependencies…", quiet);
  const install = spawnSync(pm, ["install"], {
    cwd: testsDir,
    stdio: quiet ? "pipe" : "inherit",
    shell: false,
  });
  if (install.status !== 0) {
    const stderr = install.stderr?.toString().trim();
    console.error(`\n❌ Installing test dependencies failed${stderr ? `: ${stderr}` : ""}`);
    return false;
  }

  log(`\n🧪 Running E2E tests${fast ? " (fast — no bulk seed)" : ""}…\n`, quiet);
  const run = spawnSync("bun", ["run", "run.ts", ...(fast ? ["--fast"] : [])], {
    cwd: testsDir,
    // Always inherit: a test run the user asked for should stream its output.
    stdio: "inherit",
    shell: false,
  });

  if (run.status === 0) {
    log("\n✅ E2E tests passed", quiet);
    return true;
  }

  console.error(`\n❌ E2E tests failed (exit code ${run.status ?? "unknown"})`);
  return false;
}

// ---------------------------------------------------------------------------
// EML checker + fixer pre-flight
// ---------------------------------------------------------------------------

/**
 * Run the language/checker.ts on a .mmd file, then auto-fix with fixer.ts,
 * then re-check. Throws if errors remain after fixing.
 */
async function runCheckerFixer(mmdPath: string, quiet: boolean): Promise<void> {
  // Workspace root is 4 levels above packages/generator/src/cli/
  const workspaceRoot = path.resolve(__dirname, "../../../../");
  const checkerScript = path.join(workspaceRoot, "language", "checker.ts");
  const fixerScript = path.join(workspaceRoot, "language", "fixer.ts");

  // If language tooling isn't present in this installation, skip silently
  try {
    await fs.access(checkerScript);
  } catch {
    return;
  }

  const runBun = (script: string, args: string[]) =>
    spawnSync("bun", [script, ...args], {
      stdio: "pipe",
      cwd: workspaceRoot,
    });

  // Step 1: Run checker
  log(`\n🔍 Checking ${path.basename(mmdPath)} for EML errors…`, quiet);
  const check1 = runBun(checkerScript, [mmdPath, "--no-color"]);

  if (check1.status === 0) {
    log("   ✓ No EML errors found.", quiet);
    return;
  }

  // Print checker output so the developer sees what's wrong
  if (check1.stdout) process.stdout.write(check1.stdout.toString());

  // Step 2: Auto-fix (if fixer exists)
  let fixerExists = false;
  try {
    await fs.access(fixerScript);
    fixerExists = true;
  } catch {
    /* not installed */
  }

  if (fixerExists) {
    log(`\n🔧 Auto-fixing EML issues in ${path.basename(mmdPath)}…`, quiet);
    const fix = runBun(fixerScript, [mmdPath, "--no-recheck"]);
    if (fix.stdout) process.stdout.write(fix.stdout.toString());
  }

  // Step 3: Re-check after fixes
  log(`\n🔍 Re-checking ${path.basename(mmdPath)} after fixes…`, quiet);
  const check2 = runBun(checkerScript, [mmdPath, "--no-color"]);
  if (check2.stdout) process.stdout.write(check2.stdout.toString());

  if (check2.status === 0) {
    log("   ✓ All EML errors resolved.", quiet);
    return;
  }

  // Still errors — block generation
  throw new Error(
    `EML validation failed for "${path.basename(mmdPath)}".\n` +
      `  Fix the errors shown above and re-run generation.`
  );
}

// ---------------------------------------------------------------------------
// CLI setup
// ---------------------------------------------------------------------------

/**
 * Where a generated application listens by default.
 *
 * 4000 is the app itself — the address someone opens. The API sits beside it on
 * 4001. Both used to default into the 3000s, which is where the modelling tool
 * runs, so generating an app and then trying to run it produced EADDRINUSE on
 * the very first `bun run dev`.
 */
export const DEFAULT_FRONTEND_PORT = 4000;
export const DEFAULT_BACKEND_PORT = 4001;

const program = new Command();

program
  .name("appwithai")
  .description("Generate full-stack applications from EML / Mermaid ERD diagrams")
  .version("5.2.0");

// ---------------------------------------------------------------------------
// generate — main full-stack generation command
// ---------------------------------------------------------------------------

program
  .command("generate")
  .description("Generate a full-stack application from a Mermaid ERD or EML file")
  // Input sources
  .option("-i, --input <file>", "Input Mermaid ERD / EML file (single-file mode)")
  .option("--sys-file <file>", "System entities file (sys_ tables, multi-file mode)")
  .option("--bus-file <file>", "Business entities file (bus_ tables, multi-file mode)")
  .option("--ref-file <file>", "Reference entities file (REF_ tables, multi-file mode)")
  // Output
  .requiredOption("-o, --output <dir>", "Output directory")
  .option("--force", "Overwrite existing output directory without prompting")
  .option("--dry-run", "Preview files that would be generated without writing them")
  // Project metadata
  .option("-n, --name <name>", "Project name", "my-app")
  .option("-v, --version <version>", "Project version", "1.0.0")
  .option("-d, --description <desc>", "Project description", "Generated application")
  // Stack & database
  .option("-s, --stack <stack>", "Stack: tanstackjs-nestjs", "tanstackjs-nestjs")
  .option("--db <type>", "Database type: postgresql | sqlite", "postgresql")
  // Ports & URLs
  .option("--port <port>", "Backend API port", String(DEFAULT_BACKEND_PORT))
  .option("--frontend-port <port>", "Frontend dev-server port", String(DEFAULT_FRONTEND_PORT))
  .option("--api-url <url>", "Backend API URL used by the frontend (overrides --port default)")
  .option(
    "--cors-origin <origin>",
    "CORS allowed origin (default: http://localhost:<frontend-port>)"
  )
  // Frontend options
  .option("--dark-mode", "Enable dark mode in the generated frontend")
  // Backend options
  .option("--no-swagger", "Disable Swagger / OpenAPI UI in the backend")
  .option("--no-cors", "Disable CORS in the backend")
  // Scope
  .option("--skip-frontend", "Generate backend only (shorthand for generate:backend)")
  .option("--skip-backend", "Generate frontend only (shorthand for generate:frontend)")
  .option(
    "--cli-scaffold",
    "Scaffold with `bun create tanstack-start` / `nest new` before overlaying templates (network, interactive)"
  )
  // Package manager
  .option("--package-manager <pm>", "Package manager: bun | npm | pnpm | yarn", "bun")
  // Output verbosity
  .option("--verbose", "Print each file as it is written")
  .option("--quiet", "Suppress all non-error output")
  // Post-generation setup
  .option("--no-setup", "Skip automatic install, migrate and seed after generation")
  // End-to-end tests (bun:test)
  .option("--no-tests", "Skip generation of the bun:test E2E suite in tests/")
  .option(
    "--records-per-entity <count>",
    "Records the bulk-seed E2E suite creates per entity",
    "1000"
  )
  .option("--run-tests", "Run the generated E2E suite after setup completes")
  .option("--run-tests-fast", "Run the E2E suite but skip the bulk-seed volume suite")
  .action(async (options) => {
    const quiet: boolean = !!options.quiet;

    if (!quiet) {
      console.log("\n🚀 APPWITHAI Code Generator");
      console.log("═══════════════════════════════════════════\n");
    }

    try {
      // ── Input validation ────────────────────────────────────────────────
      const isMultiFileMode = options.sysFile || options.busFile || options.refFile;

      if (isMultiFileMode && options.input) {
        throw new Error(
          "Cannot combine --input with --sys-file / --bus-file / --ref-file. Use one or the other."
        );
      }
      if (!isMultiFileMode && !options.input) {
        throw new Error(
          "Specify --input <file> or at least one of --sys-file / --bus-file / --ref-file."
        );
      }

      // ── EML check + auto-fix (pre-flight) ──────────────────────────────
      if (isMultiFileMode) {
        for (const flag of [options.sysFile, options.busFile, options.refFile]) {
          if (flag) await runCheckerFixer(resolvePath(flag), quiet);
        }
      } else {
        await runCheckerFixer(resolvePath(options.input), quiet);
      }

      // ── Parse ERD ───────────────────────────────────────────────────────
      let allEntities: Entity[] = [];
      let allRelationships: Relationship[] = [];
      /** `%%enum` declarations a `%%field` binds to a column, with their ids. */
      let allEnums: EntityEnum[] = [];

      if (isMultiFileMode) {
        for (const [flag, label] of [
          [options.sysFile, "sys_"],
          [options.busFile, "bus_"],
          [options.refFile, "REF_"],
        ] as [string | undefined, string][]) {
          if (!flag) continue;
          log(`📄 Reading ${label} entities from: ${resolvePath(flag)}`, quiet);
          const { entities, relationships, enums } = await parseFile(flag);
          allEntities.push(...entities);
          allRelationships.push(...relationships);
          allEnums.push(...enums);
          log(`   ✓ Parsed ${entities.length} ${label} entities`, quiet);
        }
        log(
          `   ✓ Total: ${allEntities.length} entities, ${allRelationships.length} relationships`,
          quiet
        );
      } else {
        const inputPath = resolvePath(options.input);
        log(`📄 Reading ERD from: ${inputPath}`, quiet);
        const { entities, relationships, enums } = await parseFile(options.input);
        allEntities = entities;
        allRelationships = relationships;
        allEnums = enums;
        log(
          `   ✓ Parsed ${entities.length} entities, ${relationships.length} relationships`,
          quiet
        );
      }

      // ── Entity categories ───────────────────────────────────────────────
      const categories = await parseCategoriesFrom(
        [options.input, options.sysFile, options.busFile, options.refFile],
        allEntities
      );

      // ── Business rules ──────────────────────────────────────────────────
      // `%%rule` sections are decision flowcharts; compiled here to GoRules
      // JDM so a rule declared in the model is enforced by the generated app.
      const ruleSources = await readModelSources(
        [options.input, options.sysFile, options.busFile, options.refFile].map(
          (p) => p && resolvePath(p)
        )
      );
      const warn = (message: string) => console.warn(`  ⚠️  ${message}`);
      const compiledRules = compileRules(extractRuleSections(ruleSources.join("\n")), warn);
      // `%%hook` directives name the lifecycle handlers the generated service
      // runs around each CRUD operation.
      const compiledHooks = compileHooks(
        ruleSources.join("\n"),
        allEntities.map((entity) => entity.name),
        warn
      );
      // `%%workflow ... kind: state` sections become seeded workflow definitions.
      const compiledWorkflows = compileWorkflows(
        ruleSources.join("\n"),
        allEntities.map((entity) => entity.name),
        warn
      );
      // `%%workflow ... kind: saga` sections become multi-step definitions: one
      // BPMN service task per `%%step`, ordered by the flowchart's edges.
      const compiledSagas = compileSagaWorkflows(
        ruleSources.join("\n"),
        allEntities.map((entity) => entity.name),
        warn
      );
      // `%%rbac` directives close CRUD operations and state transitions to named
      // roles. A target no directive mentions stays open. The state machines go
      // in because a directive may name a transition rather than an operation.
      const compiledRbac = compileRbac(
        ruleSources.join("\n"),
        allEntities.map((entity) => entity.name),
        compiledWorkflows,
        warn
      );
      // `%%report` declares a question and the SQL that answers it. Seeded into
      // the generated application's own sys_report and served from its reports
      // screen — the reporting platform in the orchestrator compiles the same
      // directive separately, and neither reading replaces the other.
      const compiledReports = compileReports(
        ruleSources.join("\n"),
        allEntities.map((entity) => entity.name),
        warn
      );
      // `%%dashboard` groups a role's reports into a dashboard for the reporting pack.
      const compiledDashboards = compileDashboards(
        ruleSources.join("\n"),
        compiledReports.map((report) => report.name),
        warn
      );

      // ── Entity summary ──────────────────────────────────────────────────
      if (!quiet) {
        console.log("\n📊 Entities found:");
        for (const e of allEntities) {
          console.log(`   • ${e.name} (${e.attributes.length} attributes)`);
        }

        console.log(`\n📐 Business rules (${compiledRules.length}):`);
        for (const rule of compiledRules) {
          console.log(`   • ${rule.name} on ${rule.entity} (${rule.operation})`);
        }

        console.log(`\n🪝 Lifecycle hooks (${compiledHooks.length}):`);
        for (const hook of compiledHooks) {
          console.log(`   • ${hook.type} ${hook.handler} on ${hook.entity}`);
        }

        console.log(`\n🧩 Multi-step workflows (${compiledSagas.length}):`);
        for (const saga of compiledSagas) {
          console.log(
            `   • ${saga.name} on ${saga.entity} — ${saga.steps.length} steps, ` +
              `${saga.trigger}-triggered on ${saga.operation}`
          );
        }

        console.log(`\n🔁 Status workflows (${compiledWorkflows.length}):`);
        for (const workflow of compiledWorkflows) {
          console.log(
            `   • ${workflow.name} on ${workflow.entity} — ${workflow.states.length} states, ` +
              `${workflow.transitions.length} transitions`
          );
        }

        console.log(`\n🗂️  Entity categories (${categories.length}):`);
        for (const c of [...categories].sort((a, b) => a.name.localeCompare(b.name))) {
          const flag = c.isDefault ? " (default)" : "";
          console.log(`   • ${c.name}${flag} — ${c.entities.length} entities`);
        }
      }

      // ── Stack validation ────────────────────────────────────────────────
      const stackOption = options.stack as StackOption;
      if (!["tanstackjs-nestjs"].includes(stackOption)) {
        throw new Error('Invalid stack. Use "tanstackjs-nestjs"');
      }

      // ── Port / URL resolution ───────────────────────────────────────────
      const backendPort = parseInt(options.port, 10);
      const frontendPort = options.frontendPort
        ? parseInt(options.frontendPort, 10)
        : DEFAULT_FRONTEND_PORT;
      const apiUrl = options.apiUrl || `http://localhost:${backendPort}`;
      const corsOrigin = options.corsOrigin || `http://localhost:${frontendPort}`;

      // ── Output directory ────────────────────────────────────────────────
      const outputDir = resolvePath(options.output);

      if (!options.dryRun) {
        const hasContent = await outputDirHasContent(outputDir);
        if (hasContent && !options.force) {
          throw new Error(
            `Output directory "${outputDir}" already contains files.\n` +
              `  Use --force to overwrite, or choose a different --output path.`
          );
        }
        await fs.mkdir(outputDir, { recursive: true });
      }

      // ── Configuration summary ───────────────────────────────────────────
      if (!quiet) {
        console.log("\n⚙️  Generation Configuration:");
        console.log(`   • Stack:            ${getStackDescription(stackOption)}`);
        console.log(`   • Project:          ${options.name} v${options.version}`);
        console.log(`   • Database:         ${options.db}`);
        console.log(`   • Backend port:     ${backendPort}`);
        console.log(`   • Frontend port:    ${frontendPort}`);
        console.log(`   • API URL:          ${apiUrl}`);
        console.log(`   • CORS origin:      ${corsOrigin}`);
        console.log(`   • Dark mode:        ${options.darkMode ? "yes" : "no"}`);
        console.log(`   • Swagger:          ${options.swagger !== false ? "yes" : "no"}`);
        console.log(`   • Package manager:  ${options.packageManager}`);
        console.log(`   • Output:           ${outputDir}`);
        if (options.dryRun) console.log("   • Mode:             DRY RUN (no files written)");
        if (options.skipFrontend) console.log("   • Scope:            backend only");
        if (options.skipBackend) console.log("   • Scope:            frontend only");
      }

      // ── Dry-run: list expected output files from templates ──────────────
      if (options.dryRun) {
        console.log("\n📂 Files that would be generated:\n");
        const templateRoot = path.resolve(__dirname, "../../templates/tanstack-start-nestjs");
        await listTemplateFiles(templateRoot, "", options.skipFrontend, options.skipBackend);
        console.log("\n✅ Dry run complete — no files were written.");
        return;
      }

      // ── Generate ────────────────────────────────────────────────────────
      log("\n📦 Generating application...\n", quiet);

      // Generation and the manifest both go through the shared pipeline, which
      // the web app's /api/generate route also calls — that is what keeps a
      // model generating the same application from either entry point.
      await generateApplication({
        // The pipeline takes its logger rather than importing one, because the
        // same code is bundled for a browser tab where Pino cannot run. A Node
        // CLI is the case that can, so it passes the real one.
        logger: cliLogger(getLogger("pipeline")),
        // Passed even though the model is already parsed: the pipeline ships
        // the document into the generated application, and the compiled code
        // does not record what it was asked to do. `ruleSources` is the same
        // set of files, already read above.
        sources: ruleSources,
        model: {
          entities: allEntities,
          relationships: allRelationships,
          categories,
          enums: allEnums,
          rules: compiledRules,
          hooks: compiledHooks,
          workflows: compiledWorkflows,
          sagas: compiledSagas,
          rbac: compiledRbac,
          reports: compiledReports,
          dashboards: compiledDashboards,
        },
        stackOption,
        projectName: options.name,
        projectVersion: options.version,
        projectDescription: options.description,
        outputDir,
        databaseType: options.db as "postgresql" | "sqlite",
        port: backendPort,
        frontendPort,
        apiBaseUrl: apiUrl,
        enableSwagger: options.swagger !== false,
        enableCors: options.cors !== false,
        enableDarkMode: !!options.darkMode,
        skipFrontend: !!options.skipFrontend,
        skipBackend: !!options.skipBackend,
        skipCliScaffold: !options.cliScaffold,
        skipTests: options.tests === false,
        recordsPerEntity: Number(options.recordsPerEntity) || 1000,
        manifest: {
          input: options.input || {
            sysFile: options.sysFile,
            busFile: options.busFile,
            refFile: options.refFile,
          },
          packageManager: options.packageManager,
        },
      });

      // ── Auto-setup (install + migrate + seed) ───────────────────────────
      if (options.setup !== false) {
        log("\n⚙️  Running automatic setup…", quiet);
        await runSetup({
          outputDir,
          dbType: options.db,
          projectName: options.name,
          packageManager: options.packageManager,
          quiet,
        });

        // After the install, not before it: run inside the generator there is no
        // node_modules, and a check that cannot pass reports nothing real.
        if (!quiet) {
          console.log("\n🔍 Running type checks...");
          await runTypeChecks(outputDir, {
            skipBackend: !!options.skipBackend,
            skipFrontend: !!options.skipFrontend,
            packageManager: options.packageManager,
          });
        }
      }

      // ── Run E2E tests ───────────────────────────────────────────────────
      // Generation → setup → tests, in that order: the suites sign in as the
      // seeded administrator, so they cannot run before migrate + seed.
      const wantsTests = !!(options.runTests || options.runTestsFast);
      let testsPassed: boolean | null = null;

      if (wantsTests && options.tests === false) {
        console.warn("\n⚠️  --run-tests ignored: test generation was disabled with --no-tests");
      } else if (wantsTests && options.setup === false) {
        console.warn(
          "\n⚠️  --run-tests ignored: the suites need a migrated and seeded database (--no-setup was given)"
        );
      } else if (wantsTests) {
        testsPassed = await runE2ETests({
          outputDir,
          packageManager: options.packageManager,
          fast: !!options.runTestsFast,
          quiet,
        });
      }

      // ── Success ─────────────────────────────────────────────────────────
      if (!quiet) {
        const pm = options.packageManager;
        console.log("\n═══════════════════════════════════════════");
        console.log("✅ Generation complete!\n");
        if (options.setup === false) {
          console.log("Next steps:");
          console.log(`   1. cd ${outputDir}`);
          console.log("   2. cp backend/.env.example backend/.env");
          console.log(`   3. ${pm} install`);
          console.log(`   4. ${pm} run db:setup   # migrate + seed`);
          console.log(`   5. ${pm} run dev\n`);
        } else {
          console.log(`   App ready in: ${outputDir}`);
          console.log(`   cd ${outputDir} && ${pm} run dev\n`);
          // Matches the bootstrap defaults in backend/src/main.ts
          // (ADMIN_EMAIL / ADMIN_PASSWORD override them).
          console.log("   Default admin:  admin@admin.com / admin123\n");
        }
        if (options.tests !== false) {
          console.log(`   E2E tests:      cd ${outputDir} && ${pm} run test:e2e`);
          console.log(`                   (add :fast to skip the bulk-seed volume suite)\n`);
        }
      }

      if (testsPassed === false) {
        process.exitCode = 1;
      }
    } catch (error: unknown) {
      console.error("\n❌ Error:", error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// inspect — parse and display ERD without generating
// ---------------------------------------------------------------------------

program
  .command("inspect")
  .description("Parse an ERD / EML file and display entities, relationships and statistics")
  .argument("<file>", "Mermaid ERD or EML file to inspect")
  .option("-f, --format <format>", "Output format: table | json | tree", "table")
  .action(async (file, options) => {
    try {
      const { entities, relationships } = await parseFile(file);

      if (options.format === "json") {
        console.log(JSON.stringify({ entities, relationships }, null, 2));
        return;
      }

      console.log("\n🔍 ERD Inspection Report");
      console.log("═══════════════════════════════════════════\n");

      // Entities table
      console.log(`📊 Entities (${entities.length})\n`);
      const header = padRow(["Entity", "Table", "PK", "Attributes", "FKs", "Unique"]);
      console.log(header);
      console.log("─".repeat(header.length));
      for (const e of entities) {
        const fks = e.attributes.filter((a) => a.name.endsWith("_id") && a.name !== "id").length;
        const uniq = e.attributes.filter((a) => a.unique && a.name !== "id").length;
        console.log(
          padRow([
            e.name,
            `bus_${e.tableName}`,
            e.primaryKey ?? "id",
            String(e.attributes.length),
            String(fks),
            String(uniq),
          ])
        );
      }

      // Relationships
      if (relationships.length > 0) {
        console.log(`\n🔗 Relationships (${relationships.length})\n`);
        const relHeader = padRow(["From", "Cardinality", "To", "Via"]);
        console.log(relHeader);
        console.log("─".repeat(relHeader.length));
        for (const r of relationships) {
          console.log(
            padRow([
              r.sourceEntity,
              cardinalityLabel(r.cardinality),
              r.targetEntity,
              r.foreignKey ?? "",
            ])
          );
        }
      }

      // Statistics
      const totalAttrs = entities.reduce((s, e) => s + e.attributes.length, 0);
      const totalFKs = entities.reduce(
        (s, e) => s + e.attributes.filter((a) => a.name.endsWith("_id") && a.name !== "id").length,
        0
      );
      console.log("\n📈 Statistics");
      console.log(`   • Total entities:      ${entities.length}`);
      console.log(`   • Total attributes:    ${totalAttrs}`);
      console.log(`   • Total relationships: ${relationships.length}`);
      console.log(`   • Total FK columns:    ${totalFKs}`);
      console.log(
        `   • Avg attrs/entity:    ${(totalAttrs / Math.max(entities.length, 1)).toFixed(1)}\n`
      );

      if (options.format === "tree") {
        console.log("🌳 Entity Tree\n");
        for (const e of entities) {
          console.log(`  ${e.name}`);
          for (const a of e.attributes) {
            const flags = [
              a.name === e.primaryKey ? "PK" : "",
              a.name.endsWith("_id") && a.name !== "id" ? "FK" : "",
              a.unique && a.name !== "id" ? "UK" : "",
              a.required ? "" : "optional",
            ].filter(Boolean);
            console.log(
              `    ├─ ${a.name} : ${a.type}${flags.length ? ` [${flags.join(", ")}]` : ""}`
            );
          }
        }
        console.log();
      }
    } catch (error: unknown) {
      console.error("❌ Error:", error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// generate:entity — add / regenerate a single entity in an existing project
// ---------------------------------------------------------------------------

program
  .command("generate:entity")
  .description(
    "Add or regenerate a single entity from an .mmd / .eml file into an existing generated project"
  )
  .requiredOption("-i, --input <file>", "Input .mmd / .eml file containing the entity")
  .requiredOption("-e, --entity <name>", "Entity name to generate (PascalCase, e.g. 'Compound')")
  .requiredOption(
    "-o, --output <dir>",
    "Root of the generated project directory (must contain backend/ and/or frontend/)"
  )
  .option("--backend-only", "Generate backend files only (JDM + migration)")
  .option("--frontend-only", "Generate frontend files only (list + detail routes)")
  .option(
    "--backend-dir <dir>",
    "Explicit path to the backend directory (overrides <output>/backend)"
  )
  .option(
    "--frontend-dir <dir>",
    "Explicit path to the frontend directory (overrides <output>/frontend)"
  )
  .option("--force", "Overwrite existing generated files without prompting")
  .option("--dry-run", "Print what would be generated without writing files")
  .option("--quiet", "Suppress non-error output")
  .action(async (options) => {
    const quiet: boolean = !!options.quiet;

    try {
      if (!quiet) {
        console.log("\n🧩 APPWITHAI — Generate Single Entity");
        console.log("═══════════════════════════════════════════\n");
      }

      // ── EML pre-flight check + auto-fix ──────────────────────────────────
      await runCheckerFixer(resolvePath(options.input), quiet);

      // ── Parse the input file ─────────────────────────────────────────────
      const { entities, relationships } = await parseFile(options.input);

      // ── Find the entity ──────────────────────────────────────────────────
      const entityName = options.entity as string;
      const entity = entities.find((e) => e.name.toLowerCase() === entityName.toLowerCase());
      if (!entity) {
        const available = entities.map((e) => e.name).join(", ");
        throw new Error(
          `Entity "${entityName}" not found in ${path.basename(options.input)}.\n` +
            `  Available entities: ${available}`
        );
      }

      // ── Resolve project directories ──────────────────────────────────────
      const projectRoot = resolvePath(options.output);
      const backendDir = options.backendDir
        ? resolvePath(options.backendDir)
        : path.join(projectRoot, "backend");
      const frontendDir = options.frontendDir
        ? resolvePath(options.frontendDir)
        : path.join(projectRoot, "frontend");

      // ── Read project manifest for config ────────────────────────────────
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let manifest: Record<string, any> = {};
      try {
        const raw = await fs.readFile(path.join(projectRoot, ".appwithai.json"), "utf-8");
        manifest = JSON.parse(raw);
      } catch {
        /* no manifest — use defaults */
      }

      if (!quiet) {
        console.log(`📋 Entity:  ${entity.name}`);
        console.log(`📄 Source:  ${path.basename(options.input)}`);
        console.log(`📁 Project: ${projectRoot}\n`);
      }

      // ── Dry-run: just print what would be generated ──────────────────────
      if (options.dryRun) {
        const snake = entity.name
          .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
          .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
          .toLowerCase();
        const kebab = snake.replace(/_/g, "-");
        const tableName = `bus_${snake}`;
        console.log("📂 Files that would be generated (dry-run):");
        if (!options.frontendOnly) {
          console.log(`  backend/src/modules/rules/jdm/${tableName}.jdm.json`);
          console.log(`  backend/src/migrations/<ts>_add_${snake}.ts`);
        }
        if (!options.backendOnly) {
          console.log(`  frontend/src/routes/${kebab}.tsx`);
          console.log(`  frontend/src/routes/${kebab}.$id.tsx`);
        }
        return;
      }

      // ── Backend ──────────────────────────────────────────────────────────
      if (!options.frontendOnly) {
        let backendExists = false;
        try {
          await fs.access(backendDir);
          backendExists = true;
        } catch {
          /* skip */
        }
        if (backendExists) {
          if (!quiet) console.log("⚙️  Generating backend files…");
          const backendGen = new NestJsBackendGenerator({
            projectName: String(manifest.name ?? "my-app"),
            projectVersion: String(manifest.version ?? "1.0.0"),
            projectDescription: String(manifest.description ?? ""),
            databaseType: (manifest.database ?? "postgresql") as "postgresql" | "sqlite",
            port: Number(manifest.backendPort ?? 3000),
            frontendPort: Number(manifest.frontendPort ?? 3001),
            enableSwagger: true,
            enableCors: true,
            skipCliScaffold: true,
          });
          await backendGen.generateSingleEntity(entity, relationships, backendDir, entities);
        } else {
          console.warn(`  ⚠️  backend/ not found at ${backendDir} — skipping backend`);
        }
      }

      // ── Frontend ─────────────────────────────────────────────────────────
      if (!options.backendOnly) {
        let frontendExists = false;
        try {
          await fs.access(frontendDir);
          frontendExists = true;
        } catch {
          /* skip */
        }
        if (frontendExists) {
          if (!quiet) console.log("\n🎨 Generating frontend files…");
          const frontendGen = new TanStackStartFrontendGenerator({
            projectName: String(manifest.name ?? "my-app"),
            projectVersion: String(manifest.version ?? "1.0.0"),
            projectDescription: String(manifest.description ?? ""),
            apiBaseUrl: String(manifest.apiUrl ?? "http://localhost:3000"),
            enableDarkMode: false,
            skipCliScaffold: true,
          });
          await frontendGen.generateSingleEntity(entity, relationships, frontendDir, entities);
        } else {
          console.warn(`  ⚠️  frontend/ not found at ${frontendDir} — skipping frontend`);
        }
      }

      if (!quiet) {
        console.log(`\n✅ Entity "${entity.name}" generated successfully!`);
        console.log(
          "   Re-run migrations to apply the schema change:\n" +
            `   cd ${path.join(projectRoot, "backend")} && bun run migrate\n`
        );
      }
    } catch (error: unknown) {
      console.error("\n❌ Error:", error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// validate — check ERD for common problems
// ---------------------------------------------------------------------------

program
  .command("validate")
  .description("Validate an ERD / EML file for structural correctness")
  .argument("<file>", "Mermaid ERD or EML file to validate")
  .option("--strict", "Fail on warnings in addition to errors")
  .action(async (file, options) => {
    try {
      const { entities, relationships } = await parseFile(file);

      const errors: string[] = [];
      const warnings: string[] = [];

      const entityNames = new Set(entities.map((e) => e.name));

      // Duplicate entity names
      const seen = new Set<string>();
      for (const e of entities) {
        if (seen.has(e.name)) errors.push(`Duplicate entity name: "${e.name}"`);
        else seen.add(e.name);
      }

      // Each entity must have at least one attribute
      for (const e of entities) {
        if (e.attributes.length === 0) {
          errors.push(`Entity "${e.name}" has no attributes`);
        }
      }

      // Every FK field should reference a real entity.
      //
      // Compared with the underscores removed, because the two sides are
      // written in different cases by convention: the column is
      // `class_offering_id` and the entity is `ClassOffering`. Folding case
      // alone left every multi-word entity in the model looking unresolvable —
      // five of the nine in the dance-studio example, all of them real.
      const fold = (name: string) => name.toLowerCase().replace(/_/g, "");
      const foldedEntityNames = new Set([...entityNames].map(fold));
      for (const e of entities) {
        for (const a of e.attributes) {
          if (a.name.endsWith("_id") && a.name !== "id") {
            const referencedEntity = a.name.replace(/_id$/, "");
            const exists = foldedEntityNames.has(fold(referencedEntity));
            if (!exists) {
              warnings.push(
                `Entity "${e.name}": FK column "${a.name}" — no entity named "${referencedEntity}" found`
              );
            }
          }
        }
      }

      // Relationship source/target must exist
      for (const r of relationships) {
        if (!entityNames.has(r.sourceEntity)) {
          errors.push(`Relationship source "${r.sourceEntity}" is not a known entity`);
        }
        if (!entityNames.has(r.targetEntity)) {
          errors.push(`Relationship target "${r.targetEntity}" is not a known entity`);
        }
      }

      // Self-referencing relationships
      for (const r of relationships) {
        if (r.sourceEntity === r.targetEntity) {
          warnings.push(`Self-referencing relationship on entity "${r.sourceEntity}"`);
        }
      }

      // Entities with no relationships
      const entitiesInRelationships = new Set([
        ...relationships.map((r) => r.sourceEntity),
        ...relationships.map((r) => r.targetEntity),
      ]);
      for (const e of entities) {
        if (!entitiesInRelationships.has(e.name)) {
          warnings.push(`Entity "${e.name}" has no relationships (isolated entity)`);
        }
      }

      // Report
      console.log("\n✅ ERD Validation Report");
      console.log("═══════════════════════════════════════════\n");
      console.log(`   File:     ${resolvePath(file)}`);
      console.log(`   Entities: ${entities.length}`);
      console.log(`   Rels:     ${relationships.length}\n`);

      if (errors.length === 0 && warnings.length === 0) {
        console.log("✅ No issues found — ERD is valid.\n");
        return;
      }

      if (errors.length > 0) {
        console.log(`❌ Errors (${errors.length}):`);
        for (const e of errors) console.log(`   • ${e}`);
        console.log();
      }

      if (warnings.length > 0) {
        console.log(`⚠️  Warnings (${warnings.length}):`);
        for (const w of warnings) console.log(`   • ${w}`);
        console.log();
      }

      if (errors.length > 0 || (options.strict && warnings.length > 0)) {
        process.exit(1);
      }
    } catch (error: unknown) {
      console.error("❌ Error:", error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// diff — compare two ERD / EML files
// ---------------------------------------------------------------------------

program
  .command("diff")
  .description("Compare two ERD / EML files and report what changed")
  .argument("<from>", "Original ERD file")
  .argument("<to>", "Updated ERD file")
  .option("--no-attributes", "Show only entity-level diffs (skip attribute details)")
  .action(async (fromFile, toFile, options) => {
    try {
      const [fromParsed, toParsed] = await Promise.all([parseFile(fromFile), parseFile(toFile)]);

      const fromMap = new Map(fromParsed.entities.map((e) => [e.name, e]));
      const toMap = new Map(toParsed.entities.map((e) => [e.name, e]));

      const added = [...toMap.keys()].filter((n) => !fromMap.has(n));
      const removed = [...fromMap.keys()].filter((n) => !toMap.has(n));
      const common = [...fromMap.keys()].filter((n) => toMap.has(n));

      console.log("\n🔀 ERD Diff");
      console.log("═══════════════════════════════════════════\n");
      console.log(`   From: ${resolvePath(fromFile)}`);
      console.log(`   To:   ${resolvePath(toFile)}\n`);

      if (added.length === 0 && removed.length === 0) {
        let hasAttrChanges = false;
        if (options.attributes) {
          for (const name of common) {
            const attrDiffs = diffAttributes(fromMap.get(name)!, toMap.get(name)!);
            if (attrDiffs.length > 0) {
              hasAttrChanges = true;
              break;
            }
          }
        }
        if (!hasAttrChanges) {
          console.log("✅ No entity changes detected.\n");
        }
      }

      for (const name of added) {
        const e = toMap.get(name)!;
        console.log(`  + [ADDED]   ${name} (${e.attributes.length} attrs)`);
        if (options.attributes) {
          for (const a of e.attributes) console.log(`      + ${a.name}: ${a.type}`);
        }
      }

      for (const name of removed) {
        const e = fromMap.get(name)!;
        console.log(`  - [REMOVED] ${name} (${e.attributes.length} attrs)`);
      }

      for (const name of common) {
        const fromEntity = fromMap.get(name)!;
        const toEntity = toMap.get(name)!;
        if (!options.attributes) continue;
        const attrDiffs = diffAttributes(fromEntity, toEntity);
        if (attrDiffs.length === 0) continue;
        console.log(`  ~ [CHANGED] ${name}`);
        for (const d of attrDiffs) console.log(`    ${d}`);
      }

      // Relationship diffs
      const fromRels = new Set(
        fromParsed.relationships.map((r) => `${r.sourceEntity}->${r.targetEntity}`)
      );
      const toRels = new Set(
        toParsed.relationships.map((r) => `${r.sourceEntity}->${r.targetEntity}`)
      );
      const addedRels = [...toRels].filter((r) => !fromRels.has(r));
      const removedRels = [...fromRels].filter((r) => !toRels.has(r));

      if (addedRels.length > 0 || removedRels.length > 0) {
        console.log("\n  Relationship changes:");
        for (const r of addedRels) console.log(`    + ${r}`);
        for (const r of removedRels) console.log(`    - ${r}`);
      }

      console.log(
        `\n  Summary: +${added.length} added, -${removed.length} removed, ` +
          `~${common.length - (common.length - added.length)} unchanged entities\n`
      );
    } catch (error: unknown) {
      console.error("❌ Error:", error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// info — read .appwithai.json manifest from a generated project
// ---------------------------------------------------------------------------

program
  .command("info")
  .description("Show metadata about a previously generated project")
  .argument("<dir>", "Path to a generated project directory")
  .action(async (dir) => {
    try {
      const manifestPath = path.join(resolvePath(dir), ".appwithai.json");
      const raw = await fs.readFile(manifestPath, "utf-8");
      const meta = JSON.parse(raw);

      console.log("\n📋 Generated Project Info");
      console.log("═══════════════════════════════════════════\n");
      console.log(`   Name:          ${meta.name ?? "—"}`);
      console.log(`   Version:       ${meta.version ?? "—"}`);
      console.log(`   Description:   ${meta.description ?? "—"}`);
      console.log(`   Stack:         ${meta.stack ?? "—"}`);
      console.log(`   Database:      ${meta.database ?? "—"}`);
      console.log(`   Backend port:  ${meta.backendPort ?? "—"}`);
      console.log(`   Frontend port: ${meta.frontendPort ?? "—"}`);
      console.log(`   API URL:       ${meta.apiUrl ?? "—"}`);
      console.log(`   Package mgr:   ${meta.packageManager ?? "—"}`);
      console.log(`   Generated at:  ${meta.generatedAt ?? "—"}`);
      if (meta.entities?.length) {
        console.log(`   Entities:      ${(meta.entities as string[]).join(", ")}`);
      }
      if (meta.input) {
        const inp = typeof meta.input === "string" ? meta.input : JSON.stringify(meta.input);
        console.log(`   Input:         ${inp}`);
      }
      console.log();
    } catch {
      console.error(
        `❌ No .appwithai.json found in "${dir}". Was this project generated by appwithai?`
      );
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// generate:backend — backend-only generation
// ---------------------------------------------------------------------------

program
  .command("generate:backend")
  .description("Generate backend only")
  .requiredOption("-i, --input <file>", "Input Mermaid ERD file")
  .requiredOption("-o, --output <dir>", "Output directory")
  .option("-n, --name <name>", "Project name", "my-backend")
  .option("-s, --stack <stack>", "Backend stack: nestjs", "nestjs")
  .option("--db <type>", "Database type: postgresql | sqlite", "postgresql")
  .option("--port <port>", "Backend API port", String(DEFAULT_BACKEND_PORT))
  .option("--no-swagger", "Disable Swagger UI")
  .option("--no-cors", "Disable CORS")
  .option("--cors-origin <origin>", "CORS allowed origin")
  .option("--force", "Overwrite existing output directory")
  .action(async (options) => {
    console.log("\n🚀 Generating Backend...\n");

    try {
      await runCheckerFixer(resolvePath(options.input), false);
      const { entities, relationships } = await parseFile(options.input);
      const outputDir = resolvePath(options.output);

      const hasContent = await outputDirHasContent(outputDir);
      if (hasContent && !options.force) {
        throw new Error(`Output dir "${outputDir}" already has content. Use --force to overwrite.`);
      }
      await fs.mkdir(outputDir, { recursive: true });

      if (options.stack === "nestjs") {
        const generator = new NestJsBackendGenerator({
          projectName: options.name,
          projectVersion: "1.0.0",
          projectDescription: "Generated NestJS backend",
          databaseType: options.db,
          port: parseInt(options.port, 10),
          enableSwagger: options.swagger !== false,
          enableCors: options.cors !== false,
        });
        await generator.generate(entities, relationships, outputDir);
      } else {
        throw new Error('Invalid backend stack. Use "nestjs"');
      }

      console.log(`\n✅ Backend generated at: ${outputDir}\n`);
    } catch (error: unknown) {
      console.error("\n❌ Error:", error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// generate:frontend — frontend-only generation
// ---------------------------------------------------------------------------

program
  .command("generate:frontend")
  .description("Generate frontend only")
  .requiredOption("-i, --input <file>", "Input Mermaid ERD file")
  .requiredOption("-o, --output <dir>", "Output directory")
  .option("-n, --name <name>", "Project name", "my-frontend")
  .option("-s, --stack <stack>", "Frontend stack: tanstack", "tanstack")
  .option("--api-url <url>", "Backend API URL", "http://localhost:3000")
  .option("--dark-mode", "Enable dark mode")
  .option("--force", "Overwrite existing output directory")
  .action(async (options) => {
    console.log("\n🚀 Generating Frontend...\n");

    try {
      await runCheckerFixer(resolvePath(options.input), false);
      const { entities, relationships } = await parseFile(options.input);
      const outputDir = resolvePath(options.output);

      const hasContent = await outputDirHasContent(outputDir);
      if (hasContent && !options.force) {
        throw new Error(`Output dir "${outputDir}" already has content. Use --force to overwrite.`);
      }
      await fs.mkdir(outputDir, { recursive: true });

      if (options.stack === "tanstack") {
        const generator = new TanStackStartFrontendGenerator({
          projectName: options.name,
          projectVersion: "1.0.0",
          projectDescription: "Generated TanStack Start frontend",
          apiBaseUrl: options.apiUrl,
          enableDarkMode: !!options.darkMode,
        });
        await generator.generate(entities, relationships, outputDir);
      } else {
        throw new Error('Invalid frontend stack. Use "tanstack"');
      }

      console.log(`\n✅ Frontend generated at: ${outputDir}\n`);
    } catch (error: unknown) {
      console.error("\n❌ Error:", error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// wizard — interactive project generation wizard
// ---------------------------------------------------------------------------

program
  .command("wizard")
  .description("Interactive guided project generation wizard")
  .action(async () => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (prompt: string): Promise<string> =>
      new Promise((resolve) => rl.question(prompt, resolve));

    console.log("\n🧙 APPWITHAI Project Wizard");
    console.log("═══════════════════════════════════════════\n");

    try {
      const name = (await ask("Project name [my-app]: ")) || "my-app";
      const description =
        (await ask("Description [Generated application]: ")) || "Generated application";
      const inputFile = await ask("ERD / EML file path: ");
      if (!inputFile) throw new Error("ERD file path is required.");
      const outputDir = (await ask("Output directory [./generated]: ")) || "./generated";

      console.log("\nSelect database:");
      console.log("  1. PostgreSQL (recommended for production)");
      console.log("  2. SQLite (for development / testing)");
      const dbChoice = (await ask("Choice [1]: ")) || "1";
      const db = dbChoice === "2" ? "sqlite" : "postgresql";

      const portStr =
        (await ask(`Backend API port [${DEFAULT_BACKEND_PORT}]: `)) || String(DEFAULT_BACKEND_PORT);
      const frontendPortStr =
        (await ask(`Frontend port [${DEFAULT_FRONTEND_PORT}]: `)) || String(DEFAULT_FRONTEND_PORT);

      const darkModeInput = (await ask("Enable dark mode? [y/N]: ")).toLowerCase();
      const darkMode = darkModeInput === "y" || darkModeInput === "yes";

      const swaggerInput = (await ask("Enable Swagger UI? [Y/n]: ")).toLowerCase();
      const noSwagger = swaggerInput === "n" || swaggerInput === "no";

      console.log("\nSelect package manager:");
      console.log("  1. bun (recommended)");
      console.log("  2. npm");
      console.log("  3. pnpm");
      console.log("  4. yarn");
      const pmChoice = (await ask("Choice [1]: ")) || "1";
      const pmMap: Record<string, string> = { "1": "bun", "2": "npm", "3": "pnpm", "4": "yarn" };
      const packageManager = pmMap[pmChoice] ?? "bun";

      rl.close();
      console.log("\n📦 Generating project...\n");

      const args = [
        "generate",
        "-i",
        inputFile,
        "-o",
        outputDir,
        "-n",
        name,
        "-d",
        description,
        "--db",
        db,
        "--port",
        portStr,
        "--frontend-port",
        frontendPortStr,
        "--package-manager",
        packageManager,
        "--force",
      ];
      if (darkMode) args.push("--dark-mode");
      if (noSwagger) args.push("--no-swagger");

      await program.parseAsync(["node", "appwithai", ...args]);
    } catch (error: unknown) {
      rl.close();
      console.error("\n❌ Error:", error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// list — show available stacks and features
// ---------------------------------------------------------------------------

program
  .command("list")
  .description("List available stacks, themes and options")
  .action(() => {
    console.log("\n📋 APPWITHAI — Available Options\n");
    console.log("═══════════════════════════════════════════\n");

    console.log("🔷 Stack\n");
    console.log("  tanstackjs-nestjs   Modern Web Stack");
    console.log("    Backend:   NestJS 10 + Fastify + Kysely + PostgreSQL/SQLite");
    console.log("    Frontend:  TanStack Start v1 + Shadcn UI + TanStack Query/Table");
    console.log("    Auth:      better-auth (session-based)");
    console.log("    Best for:  Modern web apps, SPAs, real-time dashboards\n");

    console.log("🗄️  Databases\n");
    console.log("  postgresql     — Production-grade (default)");
    console.log("  sqlite         — Zero-config for development\n");

    console.log("📦 Package Managers\n");
    console.log("  bun (default), npm, pnpm, yarn\n");

    console.log("🔑 Key Features\n");
    console.log("  • Compiere-style Application Dictionary (sys_ tables)");
    console.log("  • Business entities with bus_ prefix");
    console.log("  • Runtime UI configuration via sys_field.seq_no");
    console.log("  • GoRules JDM decision-table business rules engine");
    console.log("  • Workflow definitions + BPMN executor");
    console.log("  • Audit trail (ImmuDB-backed)");
    console.log("  • Role-based access control (RBAC)");
    console.log("  • Optimistic locking (ETag / If-Match, 409 on a stale save)");
    console.log("  • E2E test suite (bun:test) — CRUD, rules, workflows, faker volume data\n");

    console.log("🛠️  CLI Commands\n");
    console.log("  generate          Full-stack generation");
    console.log("  generate:backend  Backend only");
    console.log("  generate:frontend Frontend only");
    console.log("  inspect <file>    Parse & display ERD");
    console.log("  validate <file>   Validate ERD for errors");
    console.log("  diff <a> <b>      Compare two ERD files");
    console.log("  info <dir>        Show generated project metadata");
    console.log("  wizard            Interactive guided wizard");
    console.log("  deploy <dir>      Deploy project to Hostinger/VPS via SSH\n");
  });

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

function padRow(cols: string[]): string {
  const widths = [22, 26, 8, 12, 6, 8];
  return cols.map((c, i) => c.padEnd(widths[i] ?? 10)).join(" ");
}

function cardinalityLabel(c: string): string {
  const map: Record<string, string> = {
    oneToOne: "||--||",
    oneToMany: "||--o{",
    manyToOne: "}o--||",
    manyToMany: "}o--o{",
  };
  return map[c] ?? c;
}

function diffAttributes(from: Entity, to: Entity): string[] {
  const fromMap = new Map(from.attributes.map((a) => [a.name, a]));
  const toMap = new Map(to.attributes.map((a) => [a.name, a]));
  const diffs: string[] = [];
  for (const [name, attr] of toMap) {
    if (!fromMap.has(name)) diffs.push(`    + ${name}: ${attr.type}`);
    else if (fromMap.get(name)!.type !== attr.type)
      diffs.push(`    ~ ${name}: ${fromMap.get(name)!.type} → ${attr.type}`);
  }
  for (const name of fromMap.keys()) {
    if (!toMap.has(name)) diffs.push(`    - ${name}`);
  }
  return diffs;
}

async function listTemplateFiles(
  dir: string,
  prefix: string,
  skipFrontend?: boolean,
  skipBackend?: boolean
): Promise<void> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (skipFrontend && rel.startsWith("frontend")) continue;
      if (skipBackend && rel.startsWith("backend")) continue;
      if (entry.isDirectory()) {
        console.log(`  📁 ${rel}/`);
        await listTemplateFiles(path.join(dir, entry.name), rel, skipFrontend, skipBackend);
      } else {
        const displayName = entry.name.endsWith(".hbs") ? entry.name.slice(0, -4) : entry.name;
        console.log(`     ${displayName}`);
      }
    }
  } catch {
    // directory may not exist for this stack variant
  }
}

// ---------------------------------------------------------------------------
// deploy — build Docker images and deploy to a remote host via SSH
// ---------------------------------------------------------------------------

program
  .command("deploy <project-dir>")
  .description("Deploy a generated project to a remote host (e.g. Hostinger VPS) via SSH")
  .option("--host <host>", "SSH host (IP or hostname)")
  .option("--user <user>", "SSH username", "root")
  .option("--password <password>", "SSH password")
  .option("--port <port>", "SSH port", "22")
  .option("--remote-dir <dir>", "Remote directory to deploy into", "/opt/appwithai")
  .option("--image-tag <tag>", "Docker image tag", "latest")
  .option("--skip-build", "Skip docker build, only sync files and restart")
  .option(
    "--env-file <file>",
    "Path to .env file to upload (default: <project-dir>/.env.production)"
  )
  .option("--provision-db", "Run migrations and seeds after containers start")
  .option("--migrate-only", "Run migrations only (no seeds) after containers start")
  .action(
    async (
      projectDir: string,
      opts: {
        host?: string;
        user: string;
        password?: string;
        port: string;
        remoteDir: string;
        imageTag: string;
        skipBuild?: boolean;
        envFile?: string;
        provisionDb?: boolean;
        migrateOnly?: boolean;
      }
    ) => {
      const { NodeSSH } = await import("node-ssh");

      const absProjectDir = resolvePath(projectDir);

      // ── Read project manifest ──────────────────────────────────────────────
      const manifestPath = path.join(absProjectDir, ".appwithai.json");
      let manifest: Record<string, unknown>;
      try {
        manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
      } catch {
        console.error(`✗ No .appwithai.json found in ${absProjectDir}`);
        console.error("  Run 'appwithai generate' first to create the project.");
        process.exit(1);
      }

      const projectName = String(manifest.name ?? path.basename(absProjectDir));
      const remoteProjectDir = path.posix.join(opts.remoteDir, projectName);

      // ── Prompt for missing credentials ────────────────────────────────────
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const askInput = (q: string) => new Promise<string>((res) => rl.question(q, res));

      if (!opts.host) {
        opts.host = await askInput("SSH host (IP or hostname): ");
      }
      // Only prompt for password if not provided AND no local SSH key exists
      const os2 = await import("node:os");
      const earlyKeyCheck = [
        path.join(os2.homedir(), ".ssh", "id_ed25519"),
        path.join(os2.homedir(), ".ssh", "id_rsa"),
        path.join(os2.homedir(), ".ssh", "id_ecdsa"),
      ];
      let hasLocalKey = false;
      for (const k of earlyKeyCheck) {
        try {
          await fs.access(k);
          hasLocalKey = true;
          break;
        } catch {
          /* none */
        }
      }

      if (!opts.password && !hasLocalKey) {
        opts.password = await askInput(`SSH password for ${opts.user}@${opts.host}: `);
      }
      rl.close();

      console.log(
        `\n🚀 Deploying ${projectName} → ${opts.user}@${opts.host}:${remoteProjectDir}\n`
      );

      // ── Determine env file ─────────────────────────────────────────────────
      const envFilePath = opts.envFile
        ? resolvePath(opts.envFile)
        : path.join(absProjectDir, ".env.production");
      let hasEnvFile = false;
      try {
        await fs.access(envFilePath);
        hasEnvFile = true;
      } catch {
        // no env file — user must configure env vars on the server
      }

      // ── Connect via SSH ────────────────────────────────────────────────────
      const ssh = new NodeSSH();
      const os = await import("node:os");
      const sshKeyPaths = [
        path.join(os.homedir(), ".ssh", "id_ed25519"),
        path.join(os.homedir(), ".ssh", "id_rsa"),
        path.join(os.homedir(), ".ssh", "id_ecdsa"),
      ];
      const availableKeys: string[] = [];
      for (const keyPath of sshKeyPaths) {
        try {
          await fs.access(keyPath);
          availableKeys.push(keyPath);
        } catch {
          /* not found */
        }
      }

      try {
        const connectOpts: Record<string, unknown> = {
          host: opts.host,
          username: opts.user,
          port: parseInt(opts.port, 10),
          readyTimeout: 30_000,
          tryKeyboard: false,
        };
        if (opts.password) {
          connectOpts.password = opts.password;
        } else if (availableKeys.length > 0) {
          connectOpts.privateKeyPath = availableKeys[0];
        } else {
          opts.password = await askInput(`SSH password for ${opts.user}@${opts.host}: `);
          connectOpts.password = opts.password;
        }
        await ssh.connect(connectOpts as Parameters<typeof ssh.connect>[0]);
      } catch (err) {
        // Try other available keys before giving up
        let connected = false;
        for (const keyPath of availableKeys.slice(1)) {
          try {
            await ssh.connect({
              host: opts.host!,
              username: opts.user,
              port: parseInt(opts.port, 10),
              privateKeyPath: keyPath,
              readyTimeout: 15_000,
            });
            connected = true;
            break;
          } catch {
            /* try next */
          }
        }
        if (!connected) {
          console.error(`✗ SSH connection failed: ${err instanceof Error ? err.message : err}`);
          process.exit(1);
        }
      }

      console.log(`✓ Connected to ${opts.host}\n`);

      // Helper: run a command on the remote server via SSH
      const sshExec = async (cmd: string, label?: string) => {
        if (label) process.stdout.write(`  ${label}... `);
        const result = await ssh.execCommand(cmd, { cwd: remoteProjectDir });
        if (result.code !== 0) {
          if (label) console.log("✗");
          console.error(`\nRemote command failed on ${opts.host}`);
          if (result.stderr) console.error(result.stderr);
          ssh.dispose();
          process.exit(1);
        }
        if (label) console.log("✓");
        return result.stdout;
      };

      try {
        // ── Ensure remote directory exists ───────────────────────────────────
        await ssh.execCommand(`mkdir -p ${remoteProjectDir}`);

        // ── Upload files via SFTP ────────────────────────────────────────────
        console.log("📦 Uploading project files...");

        const excludes = new Set(["node_modules", "dist", ".output", ".git"]);
        const uploadDir = async (localDir: string, remoteBase: string) => {
          await ssh.execCommand(`mkdir -p ${remoteBase}`);
          const entries = await fs.readdir(localDir, { withFileTypes: true });
          for (const entry of entries) {
            if (excludes.has(entry.name)) continue;
            if (entry.name.startsWith(".") && !entry.name.startsWith(".env")) continue;
            const localPath = path.join(localDir, entry.name);
            const remotePath = path.posix.join(remoteBase, entry.name);
            if (entry.isDirectory()) {
              await uploadDir(localPath, remotePath);
            } else {
              await ssh.putFile(localPath, remotePath);
            }
          }
        };

        await uploadDir(
          path.join(absProjectDir, "backend"),
          path.posix.join(remoteProjectDir, "backend")
        );
        console.log("  ✓ backend/");
        await uploadDir(
          path.join(absProjectDir, "frontend"),
          path.posix.join(remoteProjectDir, "frontend")
        );
        console.log("  ✓ frontend/");

        // Upload root files
        for (const f of [
          ".appwithai.json",
          "package.json",
          "bun.lock",
          "bun.lockb",
          "docker-compose.yml",
        ]) {
          const localFile = path.join(absProjectDir, f);
          try {
            await fs.access(localFile);
            await ssh.putFile(localFile, path.posix.join(remoteProjectDir, f));
          } catch {
            /* optional */
          }
        }

        if (hasEnvFile) {
          await ssh.putFile(envFilePath, path.posix.join(remoteProjectDir, ".env"));
          console.log("  ✓ .env");
        } else {
          console.log("  ⚠  No .env.production found — make sure env vars are set on the server.");
        }

        // ── Ensure Docker is available ───────────────────────────────────────
        console.log("\n🐳 Checking Docker on server...");
        const dockerCheck = await ssh.execCommand("docker --version 2>/dev/null || echo MISSING");
        if (dockerCheck.stdout.includes("MISSING")) {
          console.log("  Installing Docker...");
          await sshExec("curl -fsSL https://get.docker.com | sh", "docker install");
        } else {
          console.log(`  ✓ ${dockerCheck.stdout.trim()}`);
        }

        const composeCheck = await ssh.execCommand(
          "docker compose version 2>/dev/null || echo MISSING"
        );
        if (composeCheck.stdout.includes("MISSING")) {
          await sshExec(
            "apt-get install -y docker-compose-plugin 2>/dev/null || true",
            "compose install"
          );
        } else {
          console.log(`  ✓ ${composeCheck.stdout.trim()}`);
        }

        // ── Build & start containers ─────────────────────────────────────────
        console.log("\n🏗  Building and starting containers...");

        if (!opts.skipBuild) {
          await sshExec("docker compose build --parallel 2>&1", "docker build");
        }

        await sshExec("docker compose up -d --remove-orphans 2>&1", "docker compose up");

        // ── DB provisioning ──────────────────────────────────────────────────
        if (opts.provisionDb || opts.migrateOnly) {
          console.log("\n🗄  Provisioning database...");

          // Wait for postgres to be healthy
          process.stdout.write("  waiting for postgres... ");
          for (let i = 0; i < 30; i++) {
            const check = await ssh.execCommand(
              // ${DB_USER:-app} is shell parameter expansion, evaluated on the remote
              // host by docker compose — not a JS template placeholder.
              // shell expansion.
              "docker compose exec -T postgres pg_isready -U ${DB_USER:-app} 2>/dev/null",
              { cwd: remoteProjectDir }
            );
            if (check.code === 0) break;
            await new Promise((r) => setTimeout(r, 2000));
          }
          console.log("✓");

          await sshExec("docker compose exec -T backend bun run migrate 2>&1", "run migrations");

          if (opts.provisionDb && !opts.migrateOnly) {
            await sshExec("docker compose exec -T backend bun run seed 2>&1", "run seeds");
          }
        }

        // ── Show status ──────────────────────────────────────────────────────
        const ps = await ssh.execCommand("docker compose ps --format table 2>&1", {
          cwd: remoteProjectDir,
        });
        console.log("\n📊 Running containers:\n");
        console.log(ps.stdout);

        const backendPort = manifest.backendPort ?? 3001;
        const frontendPort = manifest.frontendPort ?? 3002;
        console.log(`\n✅ ${projectName} deployed successfully!`);
        console.log(`   Frontend: http://${opts.host}:${frontendPort}`);
        console.log(`   Backend:  http://${opts.host}:${backendPort}/api`);
        if (!opts.provisionDb && !opts.migrateOnly) {
          console.log(`\n   Tip: add --provision-db to run migrations and seeds on first deploy.`);
        }
      } finally {
        ssh.dispose();
      }
    }
  );

// ---------------------------------------------------------------------------
program.parse();

export { program };
