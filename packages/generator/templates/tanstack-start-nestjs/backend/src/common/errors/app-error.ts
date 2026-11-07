/**
 * The error this application throws on purpose.
 *
 * `appError("VERSION_CONFLICT", { details })` names a code the catalogue
 * declares, and the catalogue (`./catalogue`, generated from the log
 * specification) says which category it belongs to, which HTTP status it
 * answers and what a caller is told when the error may not describe itself.
 * Because `ErrorCode` is a union, a mistyped code fails `bun check` instead of
 * becoming an anonymous 500 in production.
 *
 * It extends `HttpException`, so everything Nest does with an exception —
 * guards, pipes, the global filter — treats it as it treats `ConflictException`.
 * Nothing that throws a plain Nest exception has to change: the classifier in
 * `./classify` reads those by status.
 */

import { HttpException } from '@nestjs/common';

import {
  ERROR_CATALOGUE,
  ERROR_CATEGORIES,
  type ErrorCategory,
  type ErrorCode,
} from './catalogue';

export interface AppErrorOptions {
  /**
   * Written for a person. Shown to the caller only when the category exposes
   * its message (validation, not_found, conflict, business_rule, workflow,
   * rate_limit); otherwise the catalogue's own message is.
   */
  message?: string;
  /** Machine-readable context. `code` and `category` are added to it. */
  details?: Record<string, unknown>;
  /** What actually went wrong underneath. Logged, never sent. */
  cause?: unknown;
}

const REASON_PHRASES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  428: 'Precondition Required',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

export function reasonPhrase(status: number): string {
  return REASON_PHRASES[status] ?? (status >= 500 ? 'Server Error' : 'Client Error');
}

export class AppError extends HttpException {
  readonly code: ErrorCode;
  readonly category: ErrorCategory;
  readonly details: Record<string, unknown>;

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    const definition = ERROR_CATALOGUE[code];
    const message = options.message ?? definition.message;
    const details = { ...options.details, code, category: definition.category };

    super(
      { statusCode: definition.status, error: reasonPhrase(definition.status), message, details },
      definition.status,
      options.cause === undefined ? undefined : { cause: options.cause },
    );

    this.name = 'AppError';
    this.code = code;
    this.category = definition.category;
    this.details = details;
  }
}

/** Build an `AppError`. Throw it: `throw appError('RECORD_FINAL', { details: { entity } })`. */
export function appError(code: ErrorCode, options?: AppErrorOptions): AppError {
  return new AppError(code, options);
}

/**
 * The category a bare HTTP status falls in, for an exception that carries no
 * code. The first declared category that allows the status wins, which is why
 * `validation` is declared before `business_rule` for 422.
 */
export function categoryForStatus(status: number): ErrorCategory {
  for (const name of Object.keys(ERROR_CATEGORIES) as ErrorCategory[]) {
    if (ERROR_CATEGORIES[name].statuses.includes(status)) return name;
  }
  return status >= 500 ? 'internal' : 'validation';
}

/** The code used when an exception names none: one per category. */
export const FALLBACK_CODE: Record<ErrorCategory, ErrorCode> = {
  validation: 'VALIDATION_FAILED',
  authentication: 'UNAUTHENTICATED',
  authorization: 'FORBIDDEN',
  not_found: 'NOT_FOUND',
  conflict: 'CONFLICT',
  business_rule: 'RULE_REFUSED',
  workflow: 'WORKFLOW_FAILED',
  rate_limit: 'RATE_LIMITED',
  integration: 'INTEGRATION_FAILED',
  database: 'DATABASE_ERROR',
  configuration: 'CONFIGURATION_ERROR',
  internal: 'INTERNAL_ERROR',
};

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ERROR_CATALOGUE, value);
}
