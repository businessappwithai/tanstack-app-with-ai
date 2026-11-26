/**
 * The WASM overlay.
 *
 * `appwithai-wasm` does not have a stack of its own. It runs the same pipeline
 * `appwithai` runs — the same NestJS backend, the same TanStack Start front
 * end, the same migrations, guards, rules engine and dictionary — and then
 * changes the two things that stop that application running without a server:
 *
 *   the database   `pg` is replaced by a package of the same name backed by
 *                  PostgreSQL compiled to WebAssembly. Not one line of the
 *                  backend's own source changes, because none of it ever knew
 *                  what was on the far side of a `Pool`.
 *
 *   the runtime    every script that said `bun` says `node`, so the generated
 *                  application runs on the Node build that a browser's
 *                  Node-in-WASM runtime provides.
 *
 * One file is genuinely replaced rather than substituted: the audit ledger.
 * immudb is not a driver behind an interface, it is a second server, and there
 * is nowhere to put one. The replacement keeps the class, its methods and its
 * signatures, so `audit.service.ts` and `audit.controller.ts` are untouched.
 *
 * Everything here is deliberately additive or a whole-file write. Nothing
 * pattern-matches the generated source, because a rewrite that silently stops
 * matching produces an application that still dials TCP and says nothing.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { OVERLAY_ASSETS } from "./overlay-assets.generated";

export interface WasmOverlayOptions {
  /** The directory `generateApplication` wrote the stack into. */
  outputDir: string;
  /** Where PGlite keeps its files, relative to the backend. */
  dataDir?: string;
  /** Version of `@electric-sql/pglite` to depend on. */
  pgliteVersion?: string;
  log?: (message: string) => void;
}

export const DEFAULT_PGLITE_VERSION = "^0.5.5";

export interface WasmOverlayResult {
  /** Files the overlay added, relative to the output directory. */
  added: string[];
  /** Files it rewrote. */
  rewritten: string[];
  /** Scripts it moved off Bun, as `file: script` labels. */
  debunned: string[];
}

/**
 * Turn `bun` into `node`.
 *
 * The generated backend runs TypeScript directly under Bun. Node cannot, so a
 * script that ran a `.ts` file becomes a build followed by the built `.js` —
 * `nest build` is already a dependency of the project, so this adds nothing to
 * install. `bunx` becomes `npx`, and `bun test` becomes the test runner the
 * project already declares.
 */
function nodeify(_name: string, script: string): string {
  // Compound scripts are converted a clause at a time. Doing it in one pass
  // let the `bun run src/x.ts` rule swallow ` latest && bun run src/seed.ts`
  // through its trailing-arguments group, and the leftover half came out as
  // `npm run src/seed.ts` — a script that runs nothing, silently.
  if (script.includes("&&")) {
    return (
      script
        .split("&&")
        .map((clause) => nodeify(_name, clause.trim()))
        .join(" && ")
        // `nest build && … && nest build && …` is what composing two converted
        // clauses produces. Building twice only wastes time, but it reads as a
        // mistake, which costs more than the time does.
        .replace(/nest build && (.+?) && nest build && /, "nest build && $1 && ")
    );
  }

  let result = script;

  // Whole-script forms first: these change what the script *does*, not just
  // which binary runs it. Node cannot execute TypeScript, so a script that ran
  // a `.ts` file becomes a build followed by the built `.js` — `nest build` is
  // already a dependency, so this adds nothing to install.
  const wholeScript: Array<[RegExp, string]> = [
    // `dist/src/…`, not `dist/…`. The backend compiles `seeds/` alongside
    // `src/`, so TypeScript's inferred rootDir is the package root and the
    // build mirrors it. Writing `dist/migrate.js` gives a MODULE_NOT_FOUND that
    // reads like a missing file rather than a wrong path.
    // `-r dotenv/config` is not decoration. The backend finds its `.env` by
    // walking up from `__dirname`, which is `src/` when Bun runs the
    // TypeScript and `dist/src/` once it is built — so `../.env` lands on
    // `dist/.env`, which does not exist, and the first thing that needs a
    // secret fails with "BETTER_AUTH_SECRET is required" as though the file
    // were missing. Preloading dotenv reads it from the working directory,
    // which npm sets to the package root.
    [/^bun run src\/([\w.-]+)\.ts(\s.*)?$/, "nest build && node -r dotenv/config dist/src/$1.js$2"],
    [/^bun run dist\/([\w.-]+)$/, "node -r dotenv/config dist/src/$1.js"],
    [/^bun test --watch$/, "vitest"],
    [/^bun test$/, "vitest run"],
  ];
  for (const [pattern, replacement] of wholeScript) {
    if (pattern.test(result)) {
      result = result.replace(pattern, replacement).replace(/\s+$/, "");
      break;
    }
  }

  // Then the substitutions that can appear anywhere, including inside the
  // quoted arguments of a `concurrently` invocation — which is where the first
  // version of this left `bun run dev:backend` sitting untouched, because it
  // only ever looked at the start of the string.
  result = result
    // `bun check` is Bun's own type checker; the browser application has no Bun,
    // so it type-checks with the TypeScript compiler, as it always did. Before the
    // bare-`bun` rule below, which would make it `node check`.
    .replace(/\bbun check\b/g, "tsc --noEmit")
    // `bun --bun <bin>` runs a package's bin on Bun's runtime instead of the Node its
    // shebang names; on Node that is just the bin. First, before the bare-`bun` rule
    // below turns it into `node --bun <bin>`, which Node refuses. The dev server's
    // `HOST=127.0.0.1` goes with it: it is there because Bun, unlike Node, will not fall
    // back to IPv4 when `::` cannot be bound, and a WebContainer keeps its own address.
    .replace(/\bHOST=127\.0\.0\.1 bun --bun /g, "")
    .replace(/\bbun --bun /g, "")
    .replace(/\bbunx --bun /g, "npx ")
    .replace(/\bbunx /g, "npx ")
    .replace(/\bbun x /g, "npx ")
    .replace(/\bbun install\b/g, "npm install")
    .replace(/\bbun run /g, "npm run ")
    .replace(/\bbun --filter /g, "npm run --workspace ")
    .replace(/\bbun test\b/g, "npm test")
    .replace(/(^|[\s"'])bun(?=\s)/g, "$1node");

  return result;
}

async function readJson(file: string): Promise<Record<string, any> | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf-8"));
  } catch {
    return null;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

export async function applyWasmOverlay(options: WasmOverlayOptions): Promise<WasmOverlayResult> {
  const { outputDir } = options;
  const log = options.log ?? (() => {});
  const pgliteVersion = options.pgliteVersion ?? DEFAULT_PGLITE_VERSION;
  const dataDir = options.dataDir ?? "./pgdata";

  const added: string[] = [];
  const rewritten: string[] = [];
  const debunned: string[] = [];

  // ---------------------------------------------------------------- files ---

  for (const [name, contents] of Object.entries(OVERLAY_ASSETS)) {
    const target = path.join(outputDir, name);
    const existed = await fs
      .access(target)
      .then(() => true)
      .catch(() => false);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents, "utf-8");
    (existed ? rewritten : added).push(name);
  }

  // ------------------------------------------------------------- backend ----

  const backendManifest = path.join(outputDir, "backend/package.json");
  const backend = await readJson(backendManifest);
  if (backend) {
    // `pg` resolves to the local WebAssembly driver. Same specifier everywhere
    // it is imported, so nothing that imports it changes.
    backend.dependencies = {
      ...backend.dependencies,
      pg: "file:./pg-wasm",
      "@electric-sql/pglite": pgliteVersion,
    };
    // immudb-node dialled a server that no longer exists in this build; the
    // ledger it fed is now a table.
    delete backend.dependencies["immudb-node"];
    delete backend.optionalDependencies?.["immudb-node"];
    if (backend.devDependencies) delete backend.devDependencies["@types/pg"];

    for (const [name, script] of Object.entries(backend.scripts ?? {})) {
      const next = nodeify(name, String(script));
      if (next !== script) {
        backend.scripts[name] = next;
        debunned.push(`backend: ${name}`);
      }
    }
    // Bun in `engines` would have npm refuse to install under Node.
    if (backend.engines?.bun) {
      delete backend.engines.bun;
      backend.engines.node = backend.engines.node ?? ">=20";
    }
    backend.packageManager = undefined;

    await writeJson(backendManifest, backend);
    rewritten.push("backend/package.json");
  }

  // ------------------------------------------------------------ frontend ----

  const frontendManifest = path.join(outputDir, "frontend/package.json");
  const frontend = await readJson(frontendManifest);
  if (frontend) {
    for (const [name, script] of Object.entries(frontend.scripts ?? {})) {
      const next = nodeify(name, String(script));
      if (next !== script) {
        frontend.scripts[name] = next;
        debunned.push(`frontend: ${name}`);
      }
    }
    if (frontend.engines?.bun) {
      delete frontend.engines.bun;
      frontend.engines.node = frontend.engines.node ?? ">=20";
    }
    frontend.packageManager = undefined;
    await writeJson(frontendManifest, frontend);
    rewritten.push("frontend/package.json");
  }

  // ---------------------------------------------------------------- root ----

  const rootManifest = path.join(outputDir, "package.json");
  const root = await readJson(rootManifest);
  if (root) {
    for (const [name, script] of Object.entries(root.scripts ?? {})) {
      const next = nodeify(name, String(script));
      if (next !== script) {
        root.scripts[name] = next;
        debunned.push(`root: ${name}`);
      }
    }
    if (root.engines?.bun) {
      delete root.engines.bun;
      root.engines.node = root.engines.node ?? ">=20";
    }
    root.packageManager = undefined;

    /**
     * One override, and it is not optional.
     *
     * The stack's own dependency graph contains two versions of `jose`, and Bun
     * resolved better-auth's copy while npm hoists the other one. The result is
     * a migration that fails with "the requested module 'jose' does not provide
     * an export named 'customFetch'" — which reads like a bug in the migration
     * and is a bug in the install.
     *
     * Pinned to a major rather than an exact version so a patch release still
     * resolves. If better-auth moves to jose 7 this becomes wrong, and it
     * becomes wrong loudly, at install time, which is the right place.
     */
    root.overrides = { ...(root.overrides ?? {}), jose: "^6.0.0" };

    await writeJson(rootManifest, root);
    rewritten.push("package.json");
  }

  // Shell scripts the generator writes for a human to run.
  for (const script of ["run-app.sh", "backend/run-app.sh", "docker-start.sh"]) {
    const file = path.join(outputDir, script);
    try {
      const source = await fs.readFile(file, "utf-8");
      const next = source
        .replace(/\bbunx --bun /g, "npx ")
        .replace(/\bbunx /g, "npx ")
        .replace(/\bbun install\b/g, "npm install")
        .replace(/\bbun run /g, "npm run ")
        .replace(/\bbun test\b/g, "npm test")
        .replace(/\bbun\b(?! install)/g, "node");
      if (next !== source) {
        await fs.writeFile(file, next, "utf-8");
        rewritten.push(script);
        debunned.push(script);
      }
    } catch {
      // Not every stack writes every script.
    }
  }

  // ------------------------------------------------------------------ env ---

  for (const envFile of ["backend/.env", "backend/.env.example", ".env"]) {
    const file = path.join(outputDir, envFile);
    try {
      const source = await fs.readFile(file, "utf-8");
      let next = source
        // The backend reads DATABASE_URL. Pointing it at a directory rather
        // than a server is what the WebAssembly driver expects, and it keeps
        // the variable meaningful instead of leaving a dead connection string.
        .replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${dataDir}`)
        // The audit ledger is a table in this database now, so it can be on by
        // default — the server build left it off because immudb had to be
        // installed and running first.
        .replace(/^IMMUDB_ENABLED=.*$/m, "IMMUDB_ENABLED=true")
        .replace(
          /^IMMUDB_HOST=.*$/m,
          "# IMMUDB_HOST: unused — the ledger is a table in this database"
        )
        .replace(/^IMMUDB_PORT=.*$/m, "")
        .replace(/^IMMUDB_(USER|PASSWORD|DATABASE)=.*$/gm, "");

      const notes: string[] = [];
      if (!/^PGLITE_DATA_DIR=/m.test(next)) {
        notes.push(
          "",
          "# PostgreSQL runs inside this process, compiled to WebAssembly.",
          "# This is a directory, not a server: there is nothing to start.",
          `PGLITE_DATA_DIR=${dataDir}`
        );
      }
      if (!/^IMMUDB_ENABLED=/m.test(next)) {
        notes.push("", "# The tamper-evident audit ledger, as a table.", "IMMUDB_ENABLED=true");
      }
      notes.push(
        "",
        "# Retrieval over the application's own model needs pgvector, which the",
        "# WebAssembly build of Postgres does not carry. The backend logs one",
        "# warning and runs without it; everything else is unaffected.",
        "ENABLE_MODEL_CONTEXT=false"
      );

      next = /^ENABLE_MODEL_CONTEXT=/m.test(next)
        ? next
        : `${next.trimEnd()}\n${notes.join("\n")}\n`;
      await fs.writeFile(file, next, "utf-8");
      rewritten.push(envFile);
    } catch {
      // The file is optional.
    }
  }

  log(
    `WASM overlay: ${added.length} files added, ${rewritten.length} rewritten, ` +
      `${debunned.length} scripts moved off Bun`
  );

  return { added, rewritten, debunned };
}
