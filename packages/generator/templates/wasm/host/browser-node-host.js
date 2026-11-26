/**
 * The browser host — a Node-shaped runtime for the backend, inside a Worker.
 *
 * This is the counterpart of `node-host.mjs`. It boots the same
 * `server/index.js` against the same PGlite build, on a thread of its own, and
 * answers requests the Service Worker forwards to it. Between the two files
 * there is no second implementation of the application: the backend is one
 * codebase that two hosts can start.
 *
 * A Worker is not Node, so the parts of Node the backend and PGlite reach for
 * are provided here. The list is deliberately short and deliberately honest —
 * `process` (env, argv, versions, platform, cwd, nextTick, hrtime), `Buffer`
 * (the byte-array surface, not the streams one), and a `node:path`/`node:util`
 * subset. Anything outside it throws by name instead of returning undefined,
 * because a missing shim that fails loudly costs an hour and one that returns
 * undefined costs a day.
 *
 * Why a Worker at all: Postgres in WebAssembly does real work, and on the main
 * thread a seed of a few thousand rows freezes the tab it is seeding. The
 * database and the server share this thread; the UI keeps its own.
 */

installNodeCompat();

const state = {
  app: null,
  basePath: "",
  booting: null,
};

self.addEventListener("message", async (event) => {
  const message = event.data || {};

  if (message.type === "boot") {
    state.basePath = message.basePath || "";
    state.booting = state.booting || boot(message);
    try {
      await state.booting;
      self.postMessage({ type: "ready", project: state.app.model.project });
    } catch (error) {
      self.postMessage({ type: "error", message: error.message, stack: error.stack });
    }
    return;
  }

  // The Service Worker's end of the request pipe. One port, many requests,
  // correlated by id — a port per request would cost a structured clone and a
  // GC cycle on every keystroke in a search box.
  if (message.type === "port") {
    message.port.onmessage = (portEvent) => respond(message.port, portEvent.data);
    self.postMessage({ type: "port-attached" });
  }
});

async function boot(message) {
  const base = new URL(state.basePath || "./", self.location.href);
  const log = (line) => self.postMessage({ type: "log", message: line });

  const { PGlite } = await loadPGlite(base, message.pgliteUrl);
  const { createServer } = await import(new URL("server/index.js", base).href);

  /* `binary` keeps the bytes as bytes; see the note on the static route in
     `server/index.js`. */
  /*
   * No `cache: "no-store"`. These files exist only in the Service Worker's
   * cache, so telling the *network* not to store them buys nothing — and it
   * cost the application Safari entirely: WebKit will not match a request
   * carrying that cache mode, so the first schema read 404'd against a file the
   * worker was holding. The mounted responses already carry `Cache-Control:
   * no-cache`, which is the header that actually governs staleness here.
   */
  const readAsset = async (name, encoding = "utf-8") => {
    const response = await fetch(new URL(name, base).href);
    if (!response.ok) throw new Error(`Asset not found: ${name} (${response.status})`);
    return encoding === "binary" ? new Uint8Array(await response.arrayBuffer()) : response.text();
  };

  state.app = await createServer({
    PGlite,
    readAsset,
    // IndexedDB, so the data survives a reload; `auto` lets the server derive
    // the database name from the model, so two applications generated in the
    // same browser do not land in one database. `?ephemeral` opts into
    // memory-only for a clean demonstration.
    dataDir: message.dataDir === null ? undefined : message.dataDir || "auto",
    runtimeName: "worker + Node-API shim + PGlite wasm",
    log,
  });

  return state.app;
}

/**
 * Where PGlite lives when it is not in `vendor/pglite/`: a URL the generator
 * wrote in from `--pglite-url` (or the hosting page's own copy), or nothing.
 */
const PGLITE_URL = "";

/**
 * Resolve PGlite: the vendored copy, then the URL written in above, then the one
 * the page supplied. Never a CDN.
 *
 * `appwithai-wasm generate` vendors PGlite by default, and `serve.mjs` serves
 * `vendor/pglite/` from the installed `@electric-sql/pglite` when it was not.
 * Postgres is the application's database, so it is shipped with the
 * application rather than fetched from a third party at the moment someone
 * opens it — behind a firewall, offline, or on the day that host is down.
 */
async function loadPGlite(base, supplied) {
  const candidates = [new URL("vendor/pglite/index.js", base).href, PGLITE_URL, supplied].filter(
    Boolean
  );

  const failures = [];
  for (const candidate of candidates) {
    try {
      // Probed rather than imported hopefully: a failed dynamic import logs a
      // 404 the reader cannot act on, and the vendored copy is absent by design
      // whenever the application was generated in a browser.
      if (candidate.startsWith(base.origin) || candidate.startsWith("/")) {
        const head = await fetch(candidate, { method: "HEAD" }).catch(() => null);
        if (!head || !head.ok) {
          failures.push(`${candidate}: not present`);
          continue;
        }
      }
      const module = await import(candidate);
      if (module.PGlite) {
        self.postMessage({ type: "log", message: `PostgreSQL (wasm) loaded from ${candidate}` });
        return module;
      }
      failures.push(`${candidate}: no PGlite export`);
    } catch (error) {
      failures.push(`${candidate}: ${error.message}`);
    }
  }
  throw new Error(
    "Could not load PostgreSQL (PGlite). This application does not carry its own copy.\n" +
      "Generate it with `appwithai-wasm generate` (which copies PGlite into vendor/pglite), " +
      "or start it with `npm install && npm start`, which serves the installed package.\n" +
      failures.join("\n")
  );
}

async function respond(port, message) {
  const { id, request } = message;
  try {
    if (state.booting) await state.booting;
    if (!state.app) throw new Error("The server has not booted");

    const response = await state.app.handle(
      new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body || undefined,
      }),
      state.basePath
    );

    const headers = [];
    for (const [key, value] of response.headers.entries()) headers.push([key, value]);
    const body = await response.arrayBuffer();
    port.postMessage({ id, status: response.status, headers, body }, [body]);
  } catch (error) {
    port.postMessage({
      id,
      status: 500,
      headers: [["content-type", "application/json"]],
      body: new TextEncoder().encode(JSON.stringify({ message: error.message })).buffer,
    });
  }
}

/**
 * The Node surface the backend and PGlite actually reach for.
 *
 * One line here is load-bearing and looks like an omission: `process.versions`
 * carries no `node` key. Libraries detect Node by exactly that key, and PGlite
 * does — finding it, it decided it was on a server and reached for
 * `fs/promises` to load its own WebAssembly, which a browser cannot resolve at
 * all. `process.type = "worker"` is the second half of the same answer, the
 * signal Electron-shaped checks look for.
 *
 * The shim exists so that code written against Node's API runs here. It is not
 * here to convince libraries that this is Node — that is a different and much
 * more damaging claim, and the failure it produces (a module specifier that
 * cannot be resolved, four frames deep in minified code) is nobody's idea of a
 * good afternoon.
 */
function installNodeCompat() {
  if (!self.process) {
    self.process = {
      env: { NODE_ENV: "production", TZ: "UTC" },
      argv: ["node", "server"],
      platform: "browser",
      arch: "wasm32",
      type: "worker",
      // Deliberately no `node` key. See above.
      versions: { appwithai: "wasm-browser" },
      pid: 1,
      cwd: () => "/",
      exit: (code) => {
        throw new Error(`process.exit(${code}) in a worker`);
      },
      nextTick: (fn, ...args) => queueMicrotask(() => fn(...args)),
      hrtime: Object.assign(
        (previous) => {
          const now = performance.now() * 1e6;
          const nanoseconds = previous ? now - (previous[0] * 1e9 + previous[1]) : now;
          return [Math.floor(nanoseconds / 1e9), Math.floor(nanoseconds % 1e9)];
        },
        { bigint: () => BigInt(Math.floor(performance.now() * 1e6)) }
      ),
      on: () => {},
      emitWarning: (warning) => console.warn(warning),
    };
  }

  if (!self.global) self.global = self;

  if (!self.Buffer) {
    // Byte arrays, not streams. PGlite's browser build touches `Buffer.from`
    // and `isBuffer`; anything beyond that belongs to the Node build and would
    // be a lie here.
    self.Buffer = {
      from: (value, encoding) =>
        typeof value === "string"
          ? encoding === "hex"
            ? Uint8Array.from(value.match(/.{1,2}/g) || [], (byte) => Number.parseInt(byte, 16))
            : new TextEncoder().encode(value)
          : new Uint8Array(value),
      alloc: (size) => new Uint8Array(size),
      isBuffer: (value) => value instanceof Uint8Array,
      concat: (parts) => {
        const total = parts.reduce((sum, part) => sum + part.length, 0);
        const output = new Uint8Array(total);
        let at = 0;
        for (const part of parts) {
          output.set(part, at);
          at += part.length;
        }
        return output;
      },
    };
  }
}
