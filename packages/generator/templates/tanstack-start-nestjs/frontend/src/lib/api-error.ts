/**
 * Reading what the API said went wrong.
 *
 * The backend answers every failure with one envelope — `statusCode`, `message`,
 * `details.code`, `details.category` and `ref` — and the API client throws that
 * object as it arrived. These helpers read it so a screen branches on what the
 * error *is* (a conflict, a refusal, a server failure) rather than on a status
 * number or on the wording of a message.
 *
 * Pure, with no imports, so it can be tested without a browser.
 */

export type ErrorCategory =
  | "validation"
  | "authentication"
  | "authorization"
  | "not_found"
  | "conflict"
  | "business_rule"
  | "workflow"
  | "rate_limit"
  | "integration"
  | "database"
  | "configuration"
  | "internal";

interface ErrorEnvelope {
  statusCode?: number;
  message?: string | string[];
  requestId?: string;
  ref?: string;
  details?: { code?: unknown; category?: unknown } & Record<string, unknown>;
}

function envelope(error: unknown): ErrorEnvelope {
  return error && typeof error === "object" ? (error as ErrorEnvelope) : {};
}

/** The catalogue code, when the server named one: `VERSION_CONFLICT`, `RECORD_FINAL`… */
export function errorCode(error: unknown): string | undefined {
  const code = envelope(error).details?.code;
  return typeof code === "string" ? code : undefined;
}

export function errorCategory(error: unknown): ErrorCategory | undefined {
  const category = envelope(error).details?.category;
  return typeof category === "string" ? (category as ErrorCategory) : undefined;
}

/** The request id: quote it to find this request in the server's log. */
export function errorRef(error: unknown): string | undefined {
  const { ref, requestId } = envelope(error);
  return ref ?? requestId;
}

export function errorStatus(error: unknown): number | undefined {
  const status = envelope(error).statusCode;
  return typeof status === "number" ? status : undefined;
}

export function isCategory(error: unknown, ...categories: ErrorCategory[]): boolean {
  const category = errorCategory(error);
  return category !== undefined && categories.includes(category);
}

/** The server failed, as opposed to the caller asking for something it cannot have. */
export function isServerFailure(error: unknown): boolean {
  const status = errorStatus(error);
  return status !== undefined && status >= 500;
}

/** Add the reference to a message when the server failed, so support can find the line. */
export function withReference(message: string, error: unknown): string {
  const ref = errorRef(error);
  return isServerFailure(error) && ref ? `${message} (Reference: ${ref})` : message;
}

/**
 * A sentence for a person. The server's own message where it is meant to be
 * read; for a server failure, that message is already a fixed one that says
 * nothing of the cause, and the reference is added so support can find the line.
 */
export function describeError(error: unknown, fallback = "Something went wrong."): string {
  const { message } = envelope(error);
  const text = Array.isArray(message) ? message[0] : message;
  const base = text && text.trim() ? text : error instanceof Error && error.message ? error.message : fallback;
  return withReference(base, error);
}
