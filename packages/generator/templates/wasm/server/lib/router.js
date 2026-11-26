/**
 * A pattern router over Web `Request`.
 *
 * Route patterns use `:param` segments and an optional trailing `*`. There is
 * no dependency here on purpose: a router is thirty lines, and the alternative
 * — Express or Fastify — is the one part of the NestJS stack that cannot follow
 * the application into a browser tab, since both are built on `node:http`
 * internals rather than on the fetch types the Service Worker hands us.
 *
 * Matching is longest-static-prefix first, so `/sys/fields/form` wins over
 * `/sys/fields/:id` regardless of the order routes were registered in. Relying
 * on registration order is how `/bus/:entity/meta` ends up being read as a
 * record whose id is "meta".
 */

import { errorResponse, notFound } from "./http.js";

/**
 * A handler that runs a sub-router's middleware first.
 *
 * Returned unchanged when there is none, so a mounted router without
 * middleware costs no extra frame per request.
 */
function guarded(middleware, handler) {
  if (!middleware || middleware.length === 0) return handler;
  return async (request, ctx) => {
    for (const fn of middleware) {
      const early = await fn(request, ctx);
      if (early instanceof Response) return early;
    }
    return handler(request, ctx);
  };
}

function compile(pattern) {
  const parts = pattern.split("/").filter(Boolean);
  const keys = [];
  let statics = 0;
  let wildcard = false;
  const matchers = parts.map((part) => {
    if (part === "*") {
      wildcard = true;
      return null;
    }
    if (part.startsWith(":")) {
      keys.push(part.slice(1));
      return null;
    }
    statics += 1;
    return part;
  });
  return { parts, matchers, keys, statics, wildcard, length: parts.length };
}

export class Router {
  constructor() {
    this.routes = [];
    this.middleware = [];
  }

  /** Runs before every handler; may return a Response to short-circuit. */
  use(fn) {
    this.middleware.push(fn);
    return this;
  }

  add(method, pattern, handler) {
    this.routes.push({ method: method.toUpperCase(), handler, ...compile(pattern) });
    this.routes.sort((a, b) => b.statics - a.statics || a.length - b.length);
    return this;
  }

  get(p, h) { return this.add("GET", p, h); }
  post(p, h) { return this.add("POST", p, h); }
  put(p, h) { return this.add("PUT", p, h); }
  patch(p, h) { return this.add("PATCH", p, h); }
  delete(p, h) { return this.add("DELETE", p, h); }

  /**
   * Mount another router under a prefix, middleware included.
   *
   * The middleware is the point of this being more than a loop. It used to copy
   * `router.routes` and nothing else, and every module in this runtime declares
   * its authentication as `router.use(… requireUser(user))` — so mounting one
   * dropped its guard. `/api/sys`, `/api/rules`, `/api/workflows`, `/api/model`
   * and `/api/reports` all answered a caller with no session: the Application
   * Dictionary, the compiled business rules, the workflow definitions, the
   * model and every report the model declares, to anybody who asked. Nothing
   * looked wrong from the UI, which always has a session by the time it calls.
   *
   * Each mounted route is wrapped rather than the middleware being added to
   * *this* router, because it belongs to the sub-router: `sys.routes.js`
   * requires an administrator for any non-GET, and promoting that to the parent
   * would apply it to every other module mounted beside it.
   */
  mount(prefix, router) {
    for (const route of router.routes) {
      const pattern = `${prefix}/${route.parts.join("/")}`.replace(/\/+/g, "/");
      this.add(route.method, pattern, guarded(router.middleware, route.handler));
    }
    return this;
  }

  match(method, pathname) {
    const segments = pathname.split("/").filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method && route.method !== "ALL") continue;
      if (route.wildcard ? segments.length < route.length - 1 : segments.length !== route.length) {
        continue;
      }
      const params = {};
      let ok = true;
      for (let i = 0; i < route.matchers.length; i++) {
        const matcher = route.matchers[i];
        if (matcher === null) {
          if (route.wildcard && i === route.length - 1) {
            params["*"] = segments.slice(i).join("/");
          } else if (route.keys.length) {
            const key = route.parts[i].slice(1);
            if (route.parts[i].startsWith(":")) params[key] = decodeURIComponent(segments[i]);
          }
          continue;
        }
        if (matcher !== segments[i]) { ok = false; break; }
      }
      if (ok) return { route, params };
    }
    return null;
  }

  /** Handle one request. Never throws: everything becomes a Response. */
  async handle(request, context = {}) {
    try {
      const url = new URL(request.url);
      const ctx = { ...context, url, query: url.searchParams };

      for (const fn of this.middleware) {
        const early = await fn(request, ctx);
        if (early instanceof Response) return early;
      }

      const matched = this.match(request.method, url.pathname);
      if (!matched) throw notFound(`No route for ${request.method} ${url.pathname}`);

      ctx.params = matched.params;
      const result = await matched.route.handler(request, ctx);
      return result instanceof Response ? result : errorResponse(new Error("Handler returned no Response"));
    } catch (error) {
      return errorResponse(error, request.method);
    }
  }
}
