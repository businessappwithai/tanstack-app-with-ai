/**
 * The errors this application can raise, and what each one is worth.
 *
 * Generated from the APPWITHAI log specification — do not edit by hand. A code
 * names its category, its HTTP status and the message a caller is shown when
 * the error may not show its own. The category decides the level the request
 * is logged at and how much of the error leaves the server.
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

export type ErrorExposure = "message" | "code" | "generic";

export const ERROR_CATEGORIES: Record<
  ErrorCategory,
  { level: "warn" | "info" | "error" | "fatal"; expose: ErrorExposure; statuses: number[] }
> = {
  validation: { level: "warn", expose: "message", statuses: [400,422] },
  authentication: { level: "warn", expose: "generic", statuses: [401] },
  authorization: { level: "warn", expose: "code", statuses: [403] },
  not_found: { level: "info", expose: "message", statuses: [404] },
  conflict: { level: "info", expose: "message", statuses: [409,428] },
  business_rule: { level: "info", expose: "message", statuses: [422] },
  workflow: { level: "warn", expose: "message", statuses: [409,422] },
  rate_limit: { level: "warn", expose: "message", statuses: [429] },
  integration: { level: "error", expose: "generic", statuses: [502,503,504] },
  database: { level: "error", expose: "generic", statuses: [500,503] },
  configuration: { level: "error", expose: "generic", statuses: [500] },
  internal: { level: "error", expose: "generic", statuses: [500] },
};

export const ERROR_CATALOGUE = {
  VALIDATION_FAILED: { category: "validation", status: 400, message: "The request data is not valid." },
  FIELD_LOGIC_VIOLATION: { category: "validation", status: 400, message: "A field is required, hidden or read-only under the record's current values." },
  UNAUTHENTICATED: { category: "authentication", status: 401, message: "Sign in to continue." },
  FORBIDDEN: { category: "authorization", status: 403, message: "You do not have permission to do this." },
  ENTITY_ACCESS_DENIED: { category: "authorization", status: 403, message: "You do not have access to this kind of record." },
  TRANSITION_FORBIDDEN: { category: "authorization", status: 403, message: "You may not make this move." },
  STATE_FIELD_SYSTEM_MANAGED: { category: "authorization", status: 403, message: "The status moves only by its action buttons." },
  NOT_FOUND: { category: "not_found", status: 404, message: "Not found." },
  ENTITY_NOT_FOUND: { category: "not_found", status: 404, message: "This kind of record does not exist." },
  CONFLICT: { category: "conflict", status: 409, message: "The request conflicts with the current state." },
  UNIQUE_VIOLATION: { category: "conflict", status: 409, message: "A record with the same value already exists." },
  REFERENCE_VIOLATION: { category: "conflict", status: 409, message: "The record is still referenced by another record." },
  VERSION_CONFLICT: { category: "conflict", status: 409, message: "Someone else saved this record first." },
  RECORD_FINAL: { category: "conflict", status: 409, message: "This record is Final and can no longer be changed." },
  LIFECYCLE_STATES_IN_USE: { category: "conflict", status: 409, message: "Records are still in a status that this change would remove." },
  PRECONDITION_REQUIRED: { category: "conflict", status: 428, message: "This request needs the version it was based on." },
  RULE_REFUSED: { category: "business_rule", status: 422, message: "A business rule refused this change." },
  INVALID_TRANSITION: { category: "workflow", status: 409, message: "This move is not drawn from the record's current status." },
  WORKFLOW_FAILED: { category: "workflow", status: 422, message: "A process bound to this move failed." },
  RATE_LIMITED: { category: "rate_limit", status: 429, message: "Too many requests. Try again shortly." },
  INTEGRATION_FAILED: { category: "integration", status: 502, message: "A service this application depends on failed." },
  SERVICE_UNAVAILABLE: { category: "integration", status: 503, message: "A service this application depends on is unavailable." },
  INTEGRATION_TIMEOUT: { category: "integration", status: 504, message: "A service this application depends on did not answer in time." },
  SESSION_UNAVAILABLE: { category: "database", status: 503, message: "Your sign-in could not be checked. Try again." },
  DATABASE_UNAVAILABLE: { category: "database", status: 503, message: "The database is unavailable. Try again shortly." },
  DATABASE_ERROR: { category: "database", status: 500, message: "Something went wrong. Quote the reference if you ask for help." },
  CONFIGURATION_ERROR: { category: "configuration", status: 500, message: "Something went wrong. Quote the reference if you ask for help." },
  INTERNAL_ERROR: { category: "internal", status: 500, message: "Something went wrong. Quote the reference if you ask for help." },
} as const satisfies Record<string, { category: ErrorCategory; status: number; message: string }>;

export type ErrorCode = keyof typeof ERROR_CATALOGUE;
