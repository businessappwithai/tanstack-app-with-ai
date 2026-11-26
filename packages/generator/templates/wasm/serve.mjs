/**
 * The application's own static server.
 *
 * A generated application has no dependencies and needs exactly one thing from
 * its host: to be reachable over http, because a Service Worker cannot be
 * registered from a `file://` URL. Telling the reader to `npx serve` makes that
 * one requirement into a network round trip and a package install, so the
 * fifty lines are here instead.
 *
 *   node serve.mjs            # http://localhost:4000
 *   node serve.mjs --port 8080
 *
 * This serves files. The application server is `host/node-host.mjs`, or the
 * browser itself.
 *
 * `vendor/pglite/` is served from the installed `@electric-sql/pglite` when the
 * application was not generated with its own copy — an application downloaded
 * from the in-browser generator, say, which cannot carry 17MB of WebAssembly in
 * a shell script. `npm install` puts it there. Postgres is never fetched from a
 * CDN.
 */

import { createServer } from "node:http";
import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)));
const portIndex = process.argv.indexOf("--port");
const PORT = Number(portIndex >= 0 ? process.argv[portIndex + 1] : process.env.PORT || 4000);

/** The installed PGlite's `dist/`, or null when it is not installed. */
function installedPglite() {
  try {
    return dirname(createRequire(join(ROOT, "package.json")).resolve("@electric-sql/pglite"));
  } catch {
    return null;
  }
}
const PGLITE_DIST = installedPglite();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".data": "application/octet-stream",
  ".sql": "text/plain; charset=utf-8",
  ".mmd": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".gz": "application/gzip",
  ".svg": "image/svg+xml",
};

createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://localhost:${PORT}`);
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
    let target = normalize(join(ROOT, relative));

    // The path arrives from a URL, so `../../etc/passwd` has to be a 404 rather
    // than a file.
    if (!target.startsWith(ROOT)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    if (existsSync(target) && statSync(target).isDirectory()) target = join(target, "index.html");
    if (!existsSync(target) && PGLITE_DIST && relative.startsWith("vendor/pglite/")) {
      const installed = normalize(join(PGLITE_DIST, relative.slice("vendor/pglite/".length)));
      // Inside the package's dist/, the same as the ROOT check above.
      if (installed.startsWith(PGLITE_DIST + sep)) target = installed;
    }
    if (!existsSync(target)) {
      response.writeHead(404).end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": MIME[extname(target)] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
      // Deliberately no COEP: it would buy a faster Postgres where
      // SharedArrayBuffer is available and cost the ability to embed this
      // application in an iframe, which is how it is demonstrated.
      "Cross-Origin-Resource-Policy": "same-origin",
      "Service-Worker-Allowed": "/",
    });
    response.end(await readFile(target));
  } catch (error) {
    response.writeHead(500).end(String(error));
  }
}).listen(PORT, () => {
  console.log(`\n  Serving this application at http://localhost:${PORT}`);
  console.log("  Open it in a browser — Postgres starts inside the tab.\n");
});
