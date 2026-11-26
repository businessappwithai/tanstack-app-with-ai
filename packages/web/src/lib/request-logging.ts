/**
 * One line per request, without writing one in every route.
 *
 * TanStack Start's server handlers are plain `Request → Response` functions, so
 * there is no middleware chain to hang a logger on. `withRequestLogging` wraps a
 * handler instead: same signature in, same signature out, so a route adopts it
 * by wrapping the function it already had.
 *
 *     GET: withRequestLogging("/api/projects/$id", async ({ request, params }) => …)
 *
 * The route pattern is passed rather than read off the URL on purpose. Logging
 * the concrete path puts the id in the message, which means a thousand distinct
 * "messages" for one endpoint and no way to aggregate by route — the id belongs
 * in a field, and it is already in `path`.
 *
 * What a wrapped handler guarantees, which the routes did not:
 *
 *   - Every response is reported, at a level that matches its status: 5xx is an
 *     error, 4xx a warning, everything else info.
 *   - A handler that *throws* becomes a logged 500 rather than an unhandled
 *     rejection, so the caller gets JSON instead of a hung socket.
 *   - Every request gets an id, echoed back as `x-request-id`, so a line in a
 *     log aggregator and a failure a user is describing can be joined up.
 */

import { categoryForStatus, getLogger } from "@appwithai/core/logging";

/** Anything slower than this is worth a warning of its own. */
const LATENCY_BUDGET_MS = 1_000;

type Handler<Context> = (context: Context) => Promise<Response> | Response;

/**
 * Exported because the wrapper's return type mentions it, and a route's own
 * `Route` export is public: an unexported constraint here fails declaration
 * emit at every call site with TS4023 rather than in this file.
 */
export interface RequestBearing {
  request: Request;
}

function requestIdOf(request: Request): string {
  return request.headers.get("x-request-id") ?? crypto.randomUUID();
}

/**
 * A response carrying the request id, without discarding what the handler set.
 *
 * `Response` headers are immutable once constructed, so the header is added by
 * rebuilding around the same body rather than by mutating in place — which
 * fails silently on a frozen instance.
 */
function withRequestId(response: Response, requestId: string): Response {
  if (response.headers.get("x-request-id") === requestId) return response;

  const headers = new Headers(response.headers);
  headers.set("x-request-id", requestId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function withRequestLogging<Context extends RequestBearing>(
  routePattern: string,
  handler: Handler<Context>
): Handler<Context> {
  return async (context: Context): Promise<Response> => {
    const log = getLogger("http");
    const { request } = context;
    const requestId = requestIdOf(request);
    const startedAt = Date.now();

    const base = { method: request.method, path: routePattern, requestId };

    try {
      const response = await handler(context);
      const durationMs = Date.now() - startedAt;

      if (response.status >= 500) {
        log.event("http.request.failed", {
          ...base,
          status: response.status,
          durationMs,
          err: null,
          errorCategory: categoryForStatus(response.status).name,
          errorCode: null,
        });
      } else if (response.status >= 400) {
        log.event("http.request.client_error", {
          ...base,
          status: response.status,
          durationMs,
          reason: response.statusText || `HTTP ${response.status}`,
          errorCategory: categoryForStatus(response.status).name,
          errorCode: null,
        });
      } else {
        log.event("http.request.completed", { ...base, status: response.status, durationMs });
      }

      // Reported separately from the completion line rather than as a field on
      // it, so "what is slow" is a query for one event id rather than a filter
      // over every request that ever succeeded.
      if (durationMs > LATENCY_BUDGET_MS) {
        log.event("http.request.slow", { ...base, durationMs, budgetMs: LATENCY_BUDGET_MS });
      }

      return withRequestId(response, requestId);
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      log.event("http.request.failed", {
        ...base,
        status: 500,
        durationMs,
        err,
        errorCategory: "internal",
        errorCode: "INTERNAL_ERROR",
      });

      // The handler threw, so it produced nothing to return. Answering with
      // JSON keeps the failure the same shape as every other error this API
      // returns; the request id is what ties it to the line just logged.
      return new Response(
        JSON.stringify({ error: "INTERNAL_ERROR", message: "Request failed", requestId }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", "x-request-id": requestId },
        }
      );
    }
  };
}
