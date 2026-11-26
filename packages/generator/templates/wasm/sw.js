/**
 * The Service Worker — this application's HTTP layer.
 *
 * Two jobs, and the second is the one that makes the first worth doing.
 *
 * It serves the application's own files. When the app was written to disk by
 * the CLI they are already on a static server and this passes straight through;
 * when it was generated inside the browser there is no server, and the files
 * arrive here as a message and are served out of Cache Storage. Same app, same
 * URLs, whichever way it was built.
 *
 * And it forwards `/api/…` to the backend Worker. That is what makes the
 * backend a server rather than a library the UI happens to call: the frontend
 * issues ordinary `fetch("/api/bus/order")` requests to its own origin, and
 * something else entirely answers them. Nothing in the UI knows the difference,
 * which is the property that would let this application be pointed at a real
 * server by deleting this file.
 *
 * One worker can host several applications at once, keyed by base path — which
 * is what the hosted generator needs, and costs nothing here.
 */

const CACHE = "appwithai-wasm-vfs-v1";
const MOUNTS_KEY = "/__appwithai_mounts__";

/** MessagePorts to backend workers, keyed by the base path each serves. */
const backends = new Map();
/** Resolvers waiting for a backend that has not attached yet. */
const waiting = new Map();
/** Base paths this worker has files cached for. */
let mounted = [];
/** In-flight forwarded requests, by id. A port per request would cost a clone. */
const inFlight = new Map();

let sequence = 0;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(Promise.all([self.clients.claim(), loadMounts()])));

const normalizeBase = (base) => {
  const value = base || "/";
  return value.endsWith("/") ? value : `${value}/`;
};

self.addEventListener("message", (event) => {
  const message = event.data || {};

  if (message.type === "mount") {
    event.waitUntil(
      mount(message.basePath, message.files).then(
        () => reply(event, { ok: true, files: Object.keys(message.files).length }),
        (error) => reply(event, { ok: false, error: String(error && error.message) })
      )
    );
    return;
  }

  if (message.type === "attach") {
    const base = normalizeBase(message.basePath);
    const port = message.port;
    port.onmessage = (portEvent) => {
      const pending = inFlight.get(portEvent.data.id);
      if (!pending) return;
      inFlight.delete(portEvent.data.id);
      pending(portEvent.data);
    };
    port.start();
    backends.set(base, port);
    for (const resume of waiting.get(base) || []) resume(port);
    waiting.delete(base);
    reply(event, { ok: true });
    return;
  }

  if (message.type === "unmount") {
    const base = normalizeBase(message.basePath);
    backends.delete(base);
    event.waitUntil(unmount(base).then(() => reply(event, { ok: true })));
  }
});

function reply(event, payload) {
  if (event.ports && event.ports[0]) event.ports[0].postMessage(payload);
}

/**
 * Write a generated application into Cache Storage.
 *
 * Cache Storage rather than a Map in memory: a Service Worker is stopped and
 * restarted whenever the browser feels like it, and an application that
 * vanished because the worker idled for thirty seconds would be
 * indistinguishable from one that crashed.
 */
async function mount(basePath, files) {
  const base = normalizeBase(basePath);
  const cache = await caches.open(CACHE);

  await unmount(base, cache);

  await Promise.all(
    Object.entries(files).map(([name, content]) => {
      const url = new URL(base + String(name).replace(/^\/+/, ""), self.location.origin).href;
      return cache.put(
        new Request(url),
        new Response(content, {
          headers: {
            "Content-Type": contentType(name),
            "Cache-Control": "no-cache",
            // Says these are same-origin resources. Without it, a host page
            // that sets COEP refuses to embed the application at all — which is
            // how the generator page's iframe first came up blank.
            "Cross-Origin-Resource-Policy": "same-origin",
          },
        })
      );
    })
  );

  if (!mounted.includes(base)) mounted = [...mounted, base];
  await saveMounts(cache);
}

async function unmount(base, existingCache) {
  const cache = existingCache || (await caches.open(CACHE));
  const keys = await cache.keys();
  await Promise.all(
    keys
      .filter((request) => new URL(request.url).pathname.startsWith(base))
      .map((request) => cache.delete(request))
  );
  mounted = mounted.filter((candidate) => candidate !== base);
  await saveMounts(cache);
}

/**
 * The mount list is stored, not derived.
 *
 * Deriving it from the cached file paths looked simpler and was wrong: every
 * directory of every file reads as a base, so `…/run/server/lib/` shadowed
 * `…/run/` and the longest-prefix match picked the wrong application.
 */
async function saveMounts(cache) {
  await cache.put(
    new Request(new URL(MOUNTS_KEY, self.location.origin).href),
    new Response(JSON.stringify(mounted), { headers: { "Content-Type": "application/json" } })
  );
}

async function loadMounts() {
  try {
    const cache = await caches.open(CACHE);
    const response = await cache.match(new URL(MOUNTS_KEY, self.location.origin).href);
    mounted = response ? await response.json() : [];
  } catch {
    mounted = [];
  }
}

/**
 * Held, not fired and forgotten.
 *
 * A Service Worker is stopped whenever the browser feels like it — around
 * thirty seconds idle — and started again by the next request. `mounted` is
 * rebuilt from the cache at startup, and *that read is asynchronous*, so a
 * worker woken by a request used to answer it while still believing it served
 * nothing. The base then fell back to the registration scope, `run/api/…` no
 * longer looked like an API path, and the sign-in POST was served as though it
 * were a static file: straight past the backend to the network, which answered
 * `405 Not Allowed`. Routing waits for this now.
 */
const mountsReady = loadMounts();

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === MOUNTS_KEY) return;

  /* Scope is known synchronously, and everything this worker could ever answer
     is under it — so the decision to take the request can be made now, and the
     decision about what to do with it deferred until the mount list is in. */
  const scope = normalizeBase(new URL(self.registration.scope).pathname);
  if (!url.pathname.startsWith(scope)) return;

  event.respondWith(route(event.request, scope));
});

async function route(request, scope) {
  await mountsReady;

  const url = new URL(request.url);
  const base = [...new Set([...backends.keys(), ...mounted, scope])]
    .filter((candidate) => url.pathname.startsWith(candidate))
    .sort((a, b) => b.length - a.length)[0];

  if (!base) return fetch(request);

  const rest = url.pathname.slice(base.length);
  return rest.startsWith("api/") ? forward(base, request) : serve(request);
}

/**
 * Serve a mounted file.
 *
 * **Matched on the URL, not on the Request**, and that is the whole of the fix
 * for two failures that looked nothing like each other. A Request carries a
 * method and a cache mode into `caches.match`, and both have hidden a file that
 * this worker was in fact holding:
 *
 *   - The Cache API matches GET only, so the generated application's HEAD
 *     probes for optional files escaped to the network and 404'd.
 *   - WebKit declines to match a request made with `cache: "no-store"`, which
 *     is exactly how `readAsset` used to read the schema files — so chapter 09
 *     died in Safari on `app/schema.sys.sql` while working in Chromium, with a
 *     404 for a file sitting in the cache the whole time.
 *
 * A URL string builds a default GET Request internally and can inherit neither
 * property. The cache is keyed by URL anyway, so nothing is given up. A HEAD
 * still gets headers without a body, the way a real server replies.
 */
async function serve(request) {
  const cached = await caches.match(request.url, { cacheName: CACHE, ignoreSearch: true });
  if (cached) {
    return request.method === "HEAD"
      ? new Response(null, { status: cached.status, headers: cached.headers })
      : cached;
  }
  try {
    return await fetch(request);
  } catch {
    return new Response(`Offline, and not part of the application bundle: ${request.url}`, {
      status: 504,
    });
  }
}

async function forward(base, request) {
  let port = backends.get(base);
  if (!port) {
    /* A restart loses the ports but not the pages. `backends` holds
       MessagePorts, which live only as long as the worker that received them,
       so a woken worker has no way back to a backend that is still running
       happily in a tab. Waiting alone meant a minute of nothing followed by a
       503 for an application that was never down. Asking first costs one
       message and usually answers in a frame. */
    await askClientsToReattach(base);
    port = backends.get(base) || (await waitForBackend(base));
  }
  if (!port) {
    return new Response(
      JSON.stringify({ message: "The application server has not started yet. Reload the page." }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  const body = ["GET", "HEAD"].includes(request.method) ? null : await request.arrayBuffer();
  const headers = [];
  for (const [key, value] of request.headers.entries()) headers.push([key, value]);

  const id = ++sequence;
  const answer = new Promise((resolve) => inFlight.set(id, resolve));

  port.postMessage(
    { id, request: { method: request.method, url: request.url, headers, body } },
    body ? [body] : []
  );

  const result = await answer;
  /* A 204, 205 or 304 may not carry a body, and the constructor throws rather
     than ignoring one. The host answers every request with an ArrayBuffer — a
     zero-byte one for a 204 — which is still a body as far as `new Response`
     is concerned, so passing it through rejected the fetch handler and the
     browser reported `net::ERR_FAILED`: a request that never reached the
     application, on a route that was answering correctly. Every DELETE in the
     administrator section failed this way, and the same routes returned 204
     without complaint over the Node host, which has no such boundary. */
  return new Response(NULL_BODY_STATUS.has(result.status) ? null : result.body, {
    status: result.status,
    headers: result.headers,
  });
}

/** Statuses the Response constructor refuses to pair with a body. */
const NULL_BODY_STATUS = new Set([204, 205, 304]);

/**
 * Ask every page under this scope to hand over a fresh port.
 *
 * `includeUncontrolled` because the page that owns the backend is the one that
 * generated the application, and it sits *outside* this worker's scope — it is
 * the iframe it opened that is controlled, not the page itself.
 */
async function askClientsToReattach(base) {
  try {
    const clients = await self.clients.matchAll({ includeUncontrolled: true, type: "window" });
    for (const client of clients) client.postMessage({ type: "reattach", basePath: base });
  } catch {
    // Nothing to ask, or a browser that will not say: fall through to waiting.
  }
}

/** A reload races the worker's boot; wait rather than 503 on the first paint. */
function waitForBackend(base, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const queue = waiting.get(base) || [];
    queue.push(resolve);
    waiting.set(base, queue);
    setTimeout(() => resolve(backends.get(base) || null), timeoutMs);
  });
}

function contentType(name) {
  const extension = String(name).split(".").pop().toLowerCase();
  return (
    {
      html: "text/html; charset=utf-8",
      js: "text/javascript; charset=utf-8",
      mjs: "text/javascript; charset=utf-8",
      css: "text/css; charset=utf-8",
      json: "application/json; charset=utf-8",
      sql: "text/plain; charset=utf-8",
      mmd: "text/plain; charset=utf-8",
      md: "text/markdown; charset=utf-8",
      svg: "image/svg+xml",
    }[extension] || "application/octet-stream"
  );
}
