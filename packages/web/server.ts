#!/usr/bin/env bun

/**
 * Production server for the generator app.
 *
 * `vite build` emits two halves: a request handler in `dist/server`, and the
 * client bundle in `dist/client`. The handler renders and answers API routes but
 * knows nothing about the second half — nothing in it serves a `.js` or a font.
 * In development Vite does that job; in production this does.
 *
 * Static files are tried first and the handler gets everything else, because a
 * built asset path is always a real file and an app route never is. Assets carry
 * a content hash in their name, so they are safe to cache indefinitely; anything
 * else (`favicon.ico`, `robots.txt`) is not, and is not told to be.
 *
 * Run with `bun run start` after `bun run build`.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { getLogger, installProcessLogging } from "@appwithai/core/logging";
import { file } from "bun";

/**
 * Load the repository's `.env`, without overriding what is already set.
 *
 * `bun run start` runs with cwd `packages/web`, and Bun's automatic `.env`
 * loading is per-process at cwd: it looks for `packages/web/.env`, which does
 * not exist, and never sees the root file the README tells you to create. So a
 * local `bun run build && bun run start` came up with no `DATABASE_URL` and
 * answered every database request with "no PostgreSQL user name specified in
 * startup packet" — the same trap `vite.config.ts` already documents and solves
 * with `loadEnv` for the dev server.
 *
 * Real environment variables win. In a deployment there is no `.env` file and
 * the orchestrator supplies everything, so this is a no-op there; where both
 * exist, the process environment is the one that was chosen deliberately.
 */
function loadRootEnv(): void {
  let dir = import.meta.dir;
  for (let depth = 0; depth < 5; depth++) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      for (const line of readFileSync(candidate, "utf-8").split("\n")) {
        const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
        if (!match) continue;
        const [, key, rawValue] = match;
        if (!key || process.env[key] !== undefined) continue;
        process.env[key] = (rawValue ?? "").trim().replace(/^["'](.*)["']$/, "$1");
      }
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

loadRootEnv();

const log = getLogger("app");

// Registered before anything can fail. An exception escaping an async boundary
// used to take this process down with whatever Bun printed and nothing else;
// now the reason is a `fatal` line with the error serialized, and SIGTERM —
// which is how every orchestrator asks a container to stop — is recorded rather
// than silent.
installProcessLogging();

log.event("app.starting", {
  name: "appwithai-generator",
  version: process.env.npm_package_version ?? "unknown",
  env: process.env.NODE_ENV ?? "development",
  nodeVersion: process.version,
});

/**
 * Configuration that is optional, and what is off without it.
 *
 * Reported at boot rather than at first use. A feature that is quietly absent
 * because a variable was never set is the single most common deployment
 * mistake, and it usually presents as "the button does nothing".
 */
for (const [key, feature] of [
  ["DATABASE_URL", "project persistence"],
  ["VITE_MASTRA_URL", "the AI assistant"],
  ["SESSION_SECRET", "signed sessions"],
] as const) {
  if (!process.env[key]) log.event("app.config.missing", { key, feature });
}

const handler = (await import("./dist/server/server.js")) as {
  default: { fetch: (request: Request) => Promise<Response> };
};

const port = Number(process.env.PORT ?? 3000);
const clientDir = join(import.meta.dir, "dist", "client");

/**
 * Resolve a URL path to a file inside the client bundle, or null.
 *
 * The normalise-and-prefix check is what stops `/../../etc/passwd` from
 * escaping: a path that does not still start with the client directory after
 * normalisation is not served, whatever it looked like before.
 */
function staticFile(pathname: string): string | null {
  if (pathname === "/") return null;
  const candidate = normalize(join(clientDir, decodeURIComponent(pathname)));
  if (!candidate.startsWith(clientDir)) return null;
  return existsSync(candidate) && !candidate.endsWith("/") ? candidate : null;
}

const server = Bun.serve({
  port,
  // The longest Bun allows. Generation and image builds stream progress for
  // minutes and can go quiet for a while inside one slow step — a 120-second
  // idle timeout cut those responses off mid-build. The routes that stream also
  // send heartbeats, so this is the backstop rather than the mechanism.
  idleTimeout: 255,
  async fetch(request) {
    const { pathname } = new URL(request.url);

    const asset = staticFile(pathname);
    if (asset) {
      return new Response(file(asset), {
        headers: {
          "Cache-Control": pathname.startsWith("/assets/")
            ? "public, max-age=31536000, immutable"
            : "public, max-age=0, must-revalidate",
        },
      });
    }

    try {
      return await handler.default.fetch(request);
    } catch (error) {
      // A handler that throws would otherwise take the whole server down and
      // leave the container in a crash loop with no useful log line.
      log.event("http.request.failed", {
        method: request.method,
        path: pathname,
        status: 500,
        durationMs: null,
        requestId: request.headers.get("x-request-id"),
        err: error,
        errorCategory: "internal",
        errorCode: "INTERNAL_ERROR",
      });
      return new Response("Internal Server Error", { status: 500 });
    }
  },
});

log.event("app.started", {
  url: `http://localhost:${server.port}`,
  port: server.port,
  env: process.env.NODE_ENV ?? "development",
});
