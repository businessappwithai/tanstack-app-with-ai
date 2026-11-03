#!/usr/bin/env bun

/**
 * Business rule and workflow editor E2E — the runner.
 *
 *   bun scripts/e2e-rules-workflows/run.ts                 # the modelling tool (01–05)
 *   bun scripts/e2e-rules-workflows/run.ts --generated     # also generate, boot and test the app (06)
 *   bun scripts/e2e-rules-workflows/run.ts --model path/to/model.eml.mmd --generated
 *   bun scripts/e2e-rules-workflows/run.ts -- --grep "Report Designs"   # anything after -- goes to Playwright
 *   bun scripts/e2e-rules-workflows/run.ts --generated --drive-generated -- specs/14-crud-rules-and-workflows.spec.ts
 *   bun scripts/e2e-rules-workflows/run.ts --generated --from-zip --drive-generated -- specs/14-crud-rules-and-workflows.spec.ts
 *
 * --generated generates the model with the real pipeline, creates a fresh
 * database beside DATABASE_URL's (<name>_rules_workflows_e2e), migrates and
 * seeds it, starts the generated backend and front end, runs the suite with
 * GENERATED_APP_URL pointing at it, and stops both whatever happens.
 *
 * --from-zip builds the application the way the downloadable archive is built
 * instead of with the CLI: the published bundle (`html/assets/appwithai-fullstack.js`,
 * `generateFullStack({ overlay: false })`) over the vendored stack templates, every
 * file written into a real .zip, and the .zip extracted where the app then runs —
 * on the ports its own `.env` files name (4001/4000), untouched.
 *
 * --drive-generated points the specs at the generated application's Admin → Rules and
 * workflows screen (LOGIC_TARGET=generated) instead of the modelling tool's Logic step,
 * and needs no modelling tool running.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { type Subprocess, spawn } from "bun";
import pg from "pg";

const ROOT = path.resolve(import.meta.dir, "../..");
const HERE = import.meta.dir;
const args = process.argv.slice(2);
const passthrough = args.includes("--") ? args.slice(args.indexOf("--") + 1) : [];
const own = args.includes("--") ? args.slice(0, args.indexOf("--")) : args;
const flag = (name: string) => own.includes(name);
const option = (name: string) => {
  const i = own.indexOf(name);
  return i >= 0 ? own[i + 1] : undefined;
};

const model = path.resolve(
  option("--model") ??
    path.join(ROOT, "docs/eml-sessions/education-management-system/education-management-system.mmd")
);
if (!existsSync(model)) {
  console.error(`No model at ${model}`);
  process.exit(2);
}

const children: Subprocess[] = [];
const stop = () => {
  for (const child of children) child.kill();
};
process.on("SIGINT", () => {
  stop();
  process.exit(130);
});

/**
 * The environment a generated application runs in: this process's, minus
 * everything that configures the modelling tool. Run from a shell that has
 * sourced the tool's `.env`, the app inherited `VITE_API_URL` pointing at the
 * tool (:3000) — Vite prefers a process variable to the app's own `.env` — so
 * every dictionary call went to the wrong server and the rule editor offered
 * no entities. `DATABASE_URL` and the ports are the app's own, in its `.env`.
 */
function appEnv(): Record<string, string | undefined> {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      key.startsWith("VITE_") ||
      key.startsWith("BETTER_AUTH_") ||
      key.startsWith("PG") ||
      ["DATABASE_URL", "PORT", "HOST", "BACKEND_URL", "CORS_ORIGIN", "NODE_ENV"].includes(key)
    ) {
      delete env[key];
    }
  }
  return env;
}

async function run(
  cmd: string[],
  cwd: string,
  env: Record<string, string | undefined> = process.env
): Promise<void> {
  const child = spawn(cmd, {
    cwd,
    env,
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await child.exited;
  if (code !== 0) throw new Error(`${cmd.join(" ")} exited with ${code}`);
}

async function waitFor(url: string, seconds: number): Promise<void> {
  for (let i = 0; i < seconds; i++) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      /* not up yet */
    }
    await Bun.sleep(1000);
  }
  throw new Error(`${url} did not answer within ${seconds}s`);
}

async function freshDatabase(): Promise<string> {
  const base = process.env.DATABASE_URL;
  if (!base)
    throw new Error("--generated needs DATABASE_URL (the tool's own database is not touched)");
  const url = new URL(base);
  // One database per way of building, so a CLI run and an archive run can go side by side.
  const name = `${url.pathname.slice(1) || "appwithai"}_rules_workflows_e2e${flag("--from-zip") ? "_zip" : ""}`;
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();
  url.pathname = `/${name}`;
  const created = new pg.Client({ connectionString: url.toString() });
  await created.connect();
  await created.query("CREATE EXTENSION IF NOT EXISTS vector").catch(() => undefined);
  await created.end();
  return url.toString();
}

/**
 * Put the author's hook handlers in place.
 *
 * The generator writes `backend/src/modules/hooks/handlers/<Entity>.ts` as stubs
 * and never overwrites them — the bodies are the author's. A model with a
 * `<model>.handlers/` directory beside it (`rule-kinds.handlers/Ticket.ts`)
 * supplies those bodies, so a run can observe what a hook did to a write.
 */
function installHandlers(modelPath: string, appDir: string): void {
  const dir = modelPath.replace(/\.eml\.mmd$|\.mmd$/, ".handlers");
  if (!existsSync(dir)) return;
  const target = path.join(appDir, "backend/src/modules/hooks/handlers");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
    copyFileSync(path.join(dir, file), path.join(target, file));
    console.log(`▸ Installed hook handlers: ${file}`);
  }
}

/**
 * The application as the downloadable archive carries it: generated in memory by the
 * published browser bundle, zipped, and extracted into `out`.
 */
async function generateFromZip(out: string): Promise<void> {
  console.log("\n▸ Building the archive with html/assets/appwithai-fullstack.js");
  await run(["bun", "run", "build:stack-templates"], ROOT);
  const bundle = path.join(ROOT, "html/assets/appwithai-fullstack.js");
  const { generateFullStack } = (await import(bundle)) as {
    generateFullStack: (options: {
      source: string;
      templates: Record<string, string>;
      name?: string;
      overlay?: boolean;
    }) => Promise<{ files: Record<string, string> }>;
  };
  const templates = JSON.parse(
    readFileSync(path.join(ROOT, "html/assets/stack-templates.json"), "utf8")
  ) as Record<string, string>;
  const { files } = await generateFullStack({
    source: readFileSync(model, "utf8"),
    templates,
    name: "rules-workflows-e2e",
    overlay: false,
  });
  const staging = mkdtempSync(path.join(tmpdir(), "appwithai-zip-staging-"));
  for (const [file, contents] of Object.entries(files)) {
    const target = path.join(staging, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  const archive = `${out}.zip`;
  await run(["zip", "-qr", archive, "."], staging);
  await run(["unzip", "-q", archive, "-d", out], ROOT);
  rmSync(staging, { recursive: true, force: true });
  console.log(`▸ ${Object.keys(files).length} files, zipped to ${archive} and extracted`);
}

async function bootGeneratedApp(): Promise<Record<string, string>> {
  const out = mkdtempSync(path.join(tmpdir(), "appwithai-rules-workflows-"));
  const fromZip = flag("--from-zip");
  // The archive's own .env files name 4001/4000; the CLI is told its ports.
  const backendPort = process.env.GENERATED_BACKEND_PORT ?? (fromZip ? "4001" : "4701");
  const frontendPort = process.env.GENERATED_FRONTEND_PORT ?? (fromZip ? "4000" : "4700");
  if (fromZip) await generateFromZip(out);
  else await generateWithCli(out, backendPort, frontendPort);
  return startGeneratedApp(out, backendPort, frontendPort);
}

async function generateWithCli(out: string, backendPort: string, frontendPort: string) {
  console.log(`\n▸ Generating ${path.basename(model)} into ${out}`);
  // From a copy: the generator's checker writes a `.error` report beside the model it reads,
  // which left the repository's own model dirty after every run.
  const input = path.join(
    mkdtempSync(path.join(tmpdir(), "appwithai-model-")),
    path.basename(model)
  );
  copyFileSync(model, input);
  await run(
    [
      "bun",
      "packages/generator/src/cli/generate.ts",
      "generate",
      "--input",
      input,
      "--output",
      out,
      "--name",
      "rules-workflows-e2e",
      "--port",
      backendPort,
      "--frontend-port",
      frontendPort,
      "--records-per-entity",
      "25",
      "--force",
      "--no-setup",
    ],
    ROOT
  );
}

async function startGeneratedApp(
  out: string,
  backendPort: string,
  frontendPort: string
): Promise<Record<string, string>> {
  installHandlers(model, out);
  const hookTrace = path.join(out, "hook-trace.log");
  await run(["bun", "install"], out, appEnv());

  const databaseUrl = await freshDatabase();
  const password = "admin123";
  writeFileSync(
    path.join(out, "backend/.env"),
    [
      `PORT=${backendPort}`,
      "HOST=127.0.0.1",
      "NODE_ENV=development",
      `DATABASE_URL=${databaseUrl}`,
      `CORS_ORIGIN=http://localhost:${frontendPort}`,
      `BETTER_AUTH_URL=http://localhost:${backendPort}`,
      `BETTER_AUTH_SECRET=${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`,
      "ADMIN_EMAIL=admin@admin.com",
      `ADMIN_PASSWORD=${password}`,
      "THROTTLE_TTL=60000",
      "THROTTLE_LIMIT=1000000",
      // Every spec signs in from one address; better-auth counts session reads per address.
      "AUTH_RATE_MAX=100000",
      "AUTH_SIGNIN_MAX=100000",
      "IMMUDB_ENABLED=false",
      "",
    ].join("\n")
  );
  console.log("\n▸ Migrating and seeding");
  await run(["bun", "run", "migrate"], path.join(out, "backend"), appEnv());

  console.log("\n▸ Starting the generated backend and front end");
  children.push(
    spawn(["bun", "run", "start"], {
      cwd: path.join(out, "backend"),
      env: { ...appEnv(), HOOK_TRACE_FILE: hookTrace },
      stdout: "ignore",
      stderr: "inherit",
    })
  );
  children.push(
    spawn(["bun", "run", "dev"], {
      cwd: path.join(out, "frontend"),
      env: appEnv(),
      stdout: "ignore",
      stderr: "inherit",
    })
  );
  await waitFor(`http://127.0.0.1:${backendPort}/api/me/health`, 120);
  await waitFor(`http://localhost:${frontendPort}/login`, 180);

  if (!flag("--keep")) {
    process.on("exit", () => {
      rmSync(out, { recursive: true, force: true });
      rmSync(`${out}.zip`, { force: true });
    });
  }
  return {
    // Specs 10 and 11 read what the generator wrote (`lib/rule-model.ts`) and default
    // to a path nothing creates; handing them the real directory is what lets them run
    // through this runner at all.
    GEN_DIR: out,
    GENERATED_APP_URL: `http://localhost:${frontendPort}`,
    GENERATED_ADMIN_EMAIL: "admin@admin.com",
    GENERATED_ADMIN_PASSWORD: password,
    HOOK_TRACE_FILE: hookTrace,
  };
}

let code = 1;
try {
  const env: Record<string, string> = { RULES_WORKFLOWS_MODEL: model };
  if (flag("--generated")) Object.assign(env, await bootGeneratedApp());
  if (flag("--no-server")) env.E2E_NO_SERVER = "1";
  if (flag("--drive-generated")) {
    if (!env.GENERATED_APP_URL) throw new Error("--drive-generated needs --generated");
    Object.assign(env, {
      LOGIC_TARGET: "generated",
      E2E_BASE_URL: env.GENERATED_APP_URL,
      E2E_NO_SERVER: "1",
    });
  }
  console.log("\n▸ Running the rules and workflows editor suite");
  const child = spawn(
    // `--bun`: the runner on Bun's runtime, not the Node its shebang names.
    ["bunx", "--bun", "playwright", "test", "-c", "playwright.config.ts", ...passthrough],
    {
      cwd: HERE,
      env: { ...process.env, ...env },
      stdout: "inherit",
      stderr: "inherit",
    }
  );
  code = await child.exited;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
} finally {
  stop();
}
process.exit(code);
