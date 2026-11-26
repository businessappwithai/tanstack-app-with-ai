/**
 * The API client.
 *
 * Every call is a relative `/api/…` fetch against the page's own origin, which
 * the Service Worker forwards to the backend Worker.
 *
 * The session travels as a bearer token, not as a cookie, and that is not a
 * style choice. A Service Worker does not see the `Cookie` header on requests it
 * intercepts, and a `Set-Cookie` on a response it synthesises is not stored — so
 * an application hosted this way signs in successfully, gets a session, and then
 * cannot prove it has one. The symptom is a login that works and a first render
 * that bounces straight back to the login screen.
 *
 * The server accepts either, so this same UI works unchanged against the Node
 * host, where cookies are ordinary cookies.
 *
 * The token lives in `sessionStorage`: a reload keeps you signed in, a new tab
 * does not inherit the session, and closing the tab ends it.
 */

const TOKEN_KEY = "appwithai.session";

/**
 * The reporting application's session, kept under a key of its own.
 *
 * Two applications share this tab and a reader can be signed into both at once,
 * so there are two tokens and they must not collide — one storage key would
 * mean signing into the reporting platform silently ended the application's
 * session, which reads as a bug in whichever screen noticed first.
 */
const REPORT_TOKEN_KEY = "appwithai.report-session";

/**
 * The header the reporting token travels in.
 *
 * Not `Authorization`: both sessions are bearer tokens (a Service Worker does
 * not pass cookies through to a request it intercepts), and one header cannot
 * carry two of them. The server reads this one first for `/reporting` and
 * `/report-auth`.
 */
const REPORT_HEADER = "X-Reporting-Authorization";

let base = "/";
let onUnauthorized = () => {};
let onReportUnauthorized = () => {};
let token = null;
let reportToken = null;

try {
  token = sessionStorage.getItem(TOKEN_KEY);
  reportToken = sessionStorage.getItem(REPORT_TOKEN_KEY);
} catch {
  // Storage can be denied outright (a locked-down browser, some private modes).
  // An in-memory session still works for as long as the page is open.
}

export function configure(options) {
  base = options.basePath || "/";
  if (options.onUnauthorized) onUnauthorized = options.onUnauthorized;
  if (options.onReportUnauthorized) onReportUnauthorized = options.onReportUnauthorized;
}

function store(key, value) {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    // See above — memory is enough.
  }
}

export function setToken(value) {
  token = value || null;
  store(TOKEN_KEY, token);
}

export function hasToken() {
  return !!token;
}

export function setReportToken(value) {
  reportToken = value || null;
  store(REPORT_TOKEN_KEY, reportToken);
}

export function hasReportToken() {
  return !!reportToken;
}

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || `Request failed (${status})`);
    this.status = status;
    this.body = body;
    this.detail = body?.detail;
    this.violations = body?.violations;
    this.details = body?.details;
  }
}

/**
 * One request implementation, two audiences.
 *
 * `audience` decides which token is sent and which 401 handler runs — never
 * which URL is called, because both applications are served by the same server
 * under the same `/api`. A single handler would sign the reader out of the
 * application because a reporting call expired, which is the confusion the two
 * sessions exist to prevent.
 */
async function request(method, path, body, audience = "app", extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (audience === "report") {
    if (reportToken) headers[REPORT_HEADER] = `Bearer ${reportToken}`;
  } else if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${base}api${path.startsWith("/") ? path : `/${path}`}`, {
    method,
    credentials: "same-origin",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!response.ok) {
    if (response.status === 401) {
      if (audience === "report") {
        setReportToken(null);
        onReportUnauthorized();
      } else {
        setToken(null);
        onUnauthorized();
      }
    }
    throw new ApiError(response.status, parsed);
  }
  return parsed;
}

export const api = {
  get: (path) => request("GET", path),
  post: (path, body, headers) => request("POST", path, body ?? {}, "app", headers),
  // `headers` is how a save sends If-Match — the version the form opened the
  // record at — so the server can refuse it if someone saved in between.
  put: (path, body, headers) => request("PUT", path, body ?? {}, "app", headers),
  patch: (path, body, headers) => request("PATCH", path, body ?? {}, "app", headers),
  delete: (path) => request("DELETE", path),
};

/** The same client, carrying the reporting application's session. */
export const reportApi = {
  get: (path) => request("GET", path, undefined, "report"),
  post: (path, body) => request("POST", path, body ?? {}, "report"),
  put: (path, body) => request("PUT", path, body ?? {}, "report"),
  patch: (path, body) => request("PATCH", path, body ?? {}, "report"),
  delete: (path) => request("DELETE", path, undefined, "report"),
};

/** `{ a: 1, b: null }` -> `?a=1`, skipping what is not set. */
export function queryString(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value == null || value === "") continue;
    search.set(key, String(value));
  }
  const rendered = search.toString();
  return rendered ? `?${rendered}` : "";
}
