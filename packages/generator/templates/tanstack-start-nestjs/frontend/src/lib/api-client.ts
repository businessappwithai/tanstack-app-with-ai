/**
 * API Client for Backend Communication
 *
 */

import { getClientLogger } from "./logger";
import { errorCategory, errorCode, errorRef, errorStatus } from "./api-error";
import { BACKEND_PORT } from "./app-meta";

// Empty is the recommended setting, in development and in production alike: it
// makes every call a relative /api/… request against the page's own origin,
// which the front end server forwards to the API (src/routes/api/$.ts in
// production, the Vite proxy in development).
//
// That is what keeps the session cookie working. Pointing this at the API's own
// port instead makes every call cross-origin, and the browser will then only
// store the cookie if the API happens to have been told this exact origin in
// advance — so sign-in succeeds on the wire and fails in the UI the moment the
// application is reached by any name other than the one that was configured.
//
// Set it only to talk to an API somewhere else entirely, and expect to set
// CORS_ORIGIN on that API to match.
const API_BASE_URL = import.meta.env.VITE_API_URL || "";

// ============================================================================
// 401 Unauthorized Interceptor
// ============================================================================

type OnUnauthorized = () => void;
let onUnauthorizedCallback: OnUnauthorized | null = null;

export function setUnauthorizedCallback(cb: OnUnauthorized) {
  onUnauthorizedCallback = cb;
}

// ============================================================================
// Logger Utility
// ============================================================================

/**
 * What the API client says about itself, through the shared client logger so
 * `VITE_LOG_LEVEL` governs it. Method, path, status and duration only: a
 * request body is business data and a header can be a credential, and neither
 * is printed (the old logger printed both at debug).
 */
class Logger {
  private readonly out = getClientLogger("api");

  debug(message: string, context?: unknown) {
    this.out.debug(message, context);
  }

  log(message: string, context?: unknown) {
    this.out.info(message, context);
  }

  warn(message: string, context?: unknown) {
    this.out.warn(message, context);
  }

  error(message: string, context?: unknown) {
    this.out.error(message, context);
  }

  logRequest(method: string, url: string, _options?: unknown) {
    this.debug(`→ ${method} ${pathOf(url)}`);
  }

  /** A response. 4xx is the caller's problem and reads as a warning; 5xx as an error. */
  logResponse(method: string, url: string, response: Response, duration: number) {
    const line = `${method} ${pathOf(url)} - ${response.status} (${duration}ms)`;
    if (response.status >= 500) this.error(line);
    else if (response.status >= 400) this.warn(line);
    else this.debug(line);
  }

  /** A failed call. The envelope's code, category and ref are what to look for in the server log. */
  logError(method: string, url: string, error: unknown, duration?: number) {
    const durationStr = duration ? ` (${duration}ms)` : "";
    if (error instanceof Error) {
      // Network/fetch errors (ERR_CONNECTION_REFUSED, offline) — expected when backend is unavailable
      this.warn(`${method} ${pathOf(url)} - ${error.message}${durationStr}`);
      return;
    }
    this.debug(`${method} ${pathOf(url)} failed${durationStr}`, {
      status: errorStatus(error),
      code: errorCode(error),
      category: errorCategory(error),
      ref: errorRef(error),
    });
  }
}

/** The path of a URL, without its query string: the query can carry what someone searched for. */
function pathOf(url: string): string {
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    return url;
  }
}

// ============================================================================
// Types
// ============================================================================

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface ApiError {
  statusCode: number;
  message: string | string[];
  error: string;
  timestamp: string;
  path: string;
  /** The request id: quote it to find this request in the server's log. */
  ref?: string;
  requestId?: string;
  details?: Record<string, unknown>;
  errors?: Record<string, string[] | string>; // Field-level validation errors from backend
}

export interface RequestOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

// ============================================================================
// API Client
// ============================================================================

class ApiClient {
  private baseUrl: string;
  private authToken: string | null = null;
  private logger: Logger;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    this.logger = new Logger();
    this.logger.debug(`ApiClient initialized with baseUrl: ${baseUrl}`);
  }

  setAuthToken(token: string | null) {
    this.authToken = token;
    this.logger.debug(`Auth token ${token ? "set" : "cleared"}`);
  }

  private getHeaders(customHeaders?: Record<string, string>): HeadersInit {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...customHeaders,
    };

    if (this.authToken) {
      headers["Authorization"] = `Bearer ${this.authToken}`;
    }

    return headers;
  }

  private buildUrl(path: string, params?: Record<string, unknown>): string {
    // A relative path needs an origin to become a URL. In the browser that is
    // the page's own; while rendering on the server there is no page, and the
    // shortest route to the API is straight to it rather than back through our
    // own proxy.
    const origin =
      typeof window !== "undefined"
        ? window.location.origin
        : (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
            ?.BACKEND_URL ?? `http://127.0.0.1:${BACKEND_PORT}`;
    let basePath = this.baseUrl || "/api";

    // If baseUrl is an absolute URL without /api, append /api
    if (basePath.startsWith("http") && !basePath.includes("/api")) {
      basePath = basePath + "/api";
    }

    const fullUrl = basePath.startsWith("http") ? basePath : origin + basePath;
    // Strip leading /api from path if fullUrl already ends with /api to avoid double /api/api
    const normalizedPath = fullUrl.endsWith("/api") && path.startsWith("/api/")
      ? path.slice(4)
      : path;
    const url = new URL(`${fullUrl}${normalizedPath}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
          url.searchParams.append(key, String(value));
        }
      });
    }

    return url.toString();
  }

  private async handleResponse<T>(
    response: Response,
    method: string,
    url: string,
    startTime: number
  ): Promise<T> {
    const duration = Date.now() - startTime;
    const contentType = response.headers.get("content-type");

    // Log response
    this.logger.logResponse(method, url, response, duration);

    // Intercept 401 Unauthorized — trigger auto-logout
    if (response.status === 401) {
      onUnauthorizedCallback?.();
      const error = {
        statusCode: 401,
        message: 'Session expired. Please sign in again.',
        error: 'Unauthorized',
        timestamp: new Date().toISOString(),
        path: response.url,
      } as ApiError;
      this.logger.logError(method, url, error, duration);
      throw error;
    }

    if (response.status === 204) {
      return undefined as T;
    }

    if (contentType?.includes("application/json")) {
      const data = await response.json();

      if (!response.ok) {
        // The header is the request id even when the body is not our envelope
        // (a proxy's own error page, say).
        if (data && typeof data === "object" && !data.ref) {
          data.ref = response.headers.get("x-request-id") ?? data.requestId ?? undefined;
        }
        this.logger.logError(method, url, data, duration);
        throw data as ApiError;
      }

      return data as T;
    }

    if (!response.ok) {
      const error = {
        statusCode: response.status,
        message: response.statusText,
        error: "Request Failed",
        timestamp: new Date().toISOString(),
        path: response.url,
        ref: response.headers.get("x-request-id") ?? undefined,
      } as ApiError;
      this.logger.logError(method, url, error, duration);
      throw error;
    }

    return (await response.text()) as T;
  }

  async get<T>(
    path: string,
    params?: Record<string, unknown>,
    options?: RequestOptions
  ): Promise<T> {
    const startTime = Date.now();
    const url = this.buildUrl(path, params);
    const requestOptions = {
      method: "GET" as const,
      headers: this.getHeaders(options?.headers),
      credentials: "include" as const,
      signal: options?.signal,
    };

    this.logger.logRequest(requestOptions.method, url, requestOptions);

    try {
      const response = await fetch(url, requestOptions);
      return this.handleResponse<T>(response, requestOptions.method, url, startTime);
    } catch (error) {
      this.logger.logError(requestOptions.method, url, error, Date.now() - startTime);
      throw error;
    }
  }

  async post<T>(path: string, data?: unknown, options?: RequestOptions): Promise<T> {
    const startTime = Date.now();
    const url = this.buildUrl(path);
    const requestOptions = {
      method: "POST" as const,
      headers: this.getHeaders(options?.headers),
      credentials: "include" as const,
      body: data ? JSON.stringify(data) : undefined,
      signal: options?.signal,
    };

    this.logger.logRequest(requestOptions.method, url, requestOptions);

    try {
      const response = await fetch(url, requestOptions);
      return this.handleResponse<T>(response, requestOptions.method, url, startTime);
    } catch (error) {
      this.logger.logError(requestOptions.method, url, error, Date.now() - startTime);
      throw error;
    }
  }

  async put<T>(path: string, data?: unknown, options?: RequestOptions): Promise<T> {
    const startTime = Date.now();
    const url = this.buildUrl(path);
    const requestOptions = {
      method: "PUT" as const,
      headers: this.getHeaders(options?.headers),
      credentials: "include" as const,
      body: data ? JSON.stringify(data) : undefined,
      signal: options?.signal,
    };

    this.logger.logRequest(requestOptions.method, url, requestOptions);

    try {
      const response = await fetch(url, requestOptions);
      return this.handleResponse<T>(response, requestOptions.method, url, startTime);
    } catch (error) {
      this.logger.logError(requestOptions.method, url, error, Date.now() - startTime);
      throw error;
    }
  }

  async patch<T>(path: string, data?: unknown, options?: RequestOptions): Promise<T> {
    const startTime = Date.now();
    const url = this.buildUrl(path);
    const requestOptions = {
      method: "PATCH" as const,
      headers: this.getHeaders(options?.headers),
      credentials: "include" as const,
      body: data ? JSON.stringify(data) : undefined,
      signal: options?.signal,
    };

    this.logger.logRequest(requestOptions.method, url, requestOptions);

    try {
      const response = await fetch(url, requestOptions);
      return this.handleResponse<T>(response, requestOptions.method, url, startTime);
    } catch (error) {
      this.logger.logError(requestOptions.method, url, error, Date.now() - startTime);
      throw error;
    }
  }

  async delete<T = void>(path: string, options?: RequestOptions): Promise<T> {
    const startTime = Date.now();
    const url = this.buildUrl(path);
    // DELETE requests have no body — omit Content-Type to avoid Fastify's
    // "body cannot be empty when content-type is application/json" error.
    const { "Content-Type": _ct, ...headersWithoutContentType } = this.getHeaders(options?.headers) as Record<string, string>;
    const requestOptions = {
      method: "DELETE" as const,
      headers: headersWithoutContentType,
      credentials: "include" as const,
      signal: options?.signal,
    };

    this.logger.logRequest(requestOptions.method, url, requestOptions);

    try {
      const response = await fetch(url, requestOptions);
      return this.handleResponse<T>(response, requestOptions.method, url, startTime);
    } catch (error) {
      this.logger.logError(requestOptions.method, url, error, Date.now() - startTime);
      throw error;
    }
  }
}

// Export singleton instance
export const apiClient = new ApiClient(API_BASE_URL);

// ============================================================================
// Error Utilities
// ============================================================================

export function isApiError(error: unknown): error is ApiError {
  return typeof error === "object" && error !== null && "statusCode" in error && "message" in error;
}

export function getErrorMessage(error: unknown): string {
  if (isApiError(error)) {
    // Handle array of validation errors
    if (Array.isArray(error.message)) {
      return error.message.join(", ");
    }
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "An unexpected error occurred";
}

export function getErrorDetails(error: unknown): Record<string, unknown> | undefined {
  if (isApiError(error)) {
    return {
      statusCode: error.statusCode,
      error: error.error,
      timestamp: error.timestamp,
      path: error.path,
      requestId: error.requestId,
      details: error.details,
      errors: error.errors,
    };
  }
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return undefined;
}

/**
 * Format API error for user display
 */
export function formatApiError(error: unknown): {
  title: string;
  message: string;
  details?: string[];
} {
  if (isApiError(error)) {
    // If there are field-level validation errors, format them for display
    if (error.errors) {
      const fieldErrors: string[] = [];
      for (const [field, messages] of Object.entries(error.errors)) {
        const errorMessages = Array.isArray(messages) ? messages : [messages];
        fieldErrors.push(`${field}: ${errorMessages.join(", ")}`);
      }

      return {
        title: error.error || "Validation Error",
        message: (error.message as string) || "Please check the form for errors",
        details: fieldErrors,
      };
    }

    const details = Array.isArray(error.message) ? error.message : [error.message];

    return {
      title: error.error || "Error",
      message: details[0] || "An error occurred",
      details: details.length > 1 ? details.slice(1) : undefined,
    };
  }

  if (error instanceof Error) {
    return {
      title: error.name || "Error",
      message: error.message || "An unexpected error occurred",
    };
  }

  return {
    title: "Error",
    message: "An unexpected error occurred",
  };
}

// Restore auth token persisted across hard navigations (window.location.href)
if (typeof window !== "undefined") {
  const saved = sessionStorage.getItem("auth_token");
  if (saved) apiClient.setAuthToken(saved);
}
