/**
 * Turn anything that was thrown into one description of what went wrong.
 *
 * The exception filter is the only caller that matters: it asks `classify`
 * what the exception is, then builds the response and stashes the answer for
 * the response hook that writes the log line. Keeping the judgement here, free
 * of Fastify, is what lets it be tested with plain objects.
 *
 * Three rules shape every answer:
 *
 *   - A caller's mistake is a 4xx and keeps its message. A server failure is a
 *     5xx and loses it: `message` is the catalogue's fixed text, and the cause
 *     goes to the log, never to the response.
 *   - A database constraint is the caller's problem, not the server's. A
 *     unique key already taken is a conflict; a missing required field is a
 *     validation error. Only a database that is *down* is the server's.
 *   - A code the exception already carries (`details.code`) wins over a guess
 *     from its status, so the throws that predate the catalogue are categorised
 *     without being rewritten.
 */

import { HttpException } from '@nestjs/common';

import {
  AppError,
  FALLBACK_CODE,
  categoryForStatus,
  isErrorCode,
  reasonPhrase,
} from './app-error';
import { ERROR_CATALOGUE, ERROR_CATEGORIES, type ErrorCategory, type ErrorCode } from './catalogue';

export interface Classified {
  status: number;
  category: ErrorCategory;
  code: ErrorCode;
  /** What the caller is told. */
  message: string | string[];
  /** The HTTP reason phrase. */
  error: string;
  /** What the caller may be given besides the message. `code` and `category` are always in it. */
  details: Record<string, unknown>;
  errors?: string[] | Record<string, string[]>;
  /** The level the request is logged at: the category's own. */
  level: 'warn' | 'info' | 'error' | 'fatal';
}

/** A database driver error, as `pg` and the SQLite driver report one. */
export interface DriverError {
  code?: string;
  detail?: string;
  constraint?: string;
  table?: string;
  column?: string;
  message?: string;
}

/** `Key (smiles)=(CC(=O)O) already exists.` → `smiles` */
function columnsFromDetail(detail?: string): string | null {
  const named = /^Key \(([^)]+)\)=/.exec(detail ?? '');
  return named?.[1] ?? null;
}

/** Turn a snake_case column list into something readable. */
function humanize(columns: string): string {
  return columns
    .split(/\s*,\s*/)
    .map((c) => c.trim().replace(/_/g, ' '))
    .join(' and ');
}

/**
 * Map a database constraint violation onto the code it actually deserves.
 *
 * These reach the filter as plain `Error`s, so without this every one of them
 * was reported as a 500 — telling the caller the server broke when in fact
 * their payload conflicted with data that was already there.
 *
 * Values are deliberately never echoed back — only column names — since the
 * conflicting value can be someone else's data.
 */
export function mapDatabaseError(
  error: DriverError,
  method: string,
): { code: ErrorCode; message: string } | null {
  const code = error.code ?? '';
  const columns = columnsFromDetail(error.detail);
  const where = columns ? ` (${humanize(columns)})` : '';

  // Unique violation. SQLite reports the whole family under one code, and the
  // driver only distinguishes them in the message.
  if (
    code === '23505' ||
    code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
    (code === 'SQLITE_CONSTRAINT' && /UNIQUE constraint failed/i.test(error.message ?? ''))
  ) {
    return { code: 'UNIQUE_VIOLATION', message: `A record with the same value${where} already exists.` };
  }

  // Foreign key. Deleting a parent that still has children is a conflict;
  // writing a reference to something that is not there is a bad request. The
  // driver reports both the same way, so the verb is what separates them.
  if (code === '23503' || code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
    return method === 'DELETE'
      ? { code: 'REFERENCE_VIOLATION', message: 'This record is still referenced by other records.' }
      : { code: 'VALIDATION_FAILED', message: `A referenced record${where} does not exist.` };
  }

  if (code === '23502' || code === 'SQLITE_CONSTRAINT_NOTNULL') {
    const field = error.column ? ` (${humanize(error.column)})` : where;
    return { code: 'VALIDATION_FAILED', message: `A required field${field} was missing.` };
  }

  if (code === '23514' || code === 'SQLITE_CONSTRAINT_CHECK') {
    return { code: 'VALIDATION_FAILED', message: `A value${where} failed a database constraint.` };
  }

  if (code === '23P01') {
    return {
      code: 'CONFLICT',
      message: `A record with an overlapping value${where} already exists.`,
    };
  }

  // Value too long for its column.
  if (code === '22001') {
    return { code: 'VALIDATION_FAILED', message: 'A value was too long for its column.' };
  }

  // Malformed input for the column type — a non-uuid where a uuid is expected,
  // a word where a number is expected.
  if (code === '22P02' || code === '22007' || code === '22008') {
    return { code: 'VALIDATION_FAILED', message: 'A value was not valid for its column type.' };
  }

  return null;
}

/**
 * Is this a database that is unreachable or overloaded, as opposed to one that
 * answered and refused? SQLSTATE class 08 is a connection exception, 53 is
 * insufficient resources, 57 is an operator shutdown; the rest are the socket
 * errors Node reports before PostgreSQL gets a word in.
 */
function isDatabaseUnavailable(error: DriverError): boolean {
  const code = error.code ?? '';
  return (
    /^(08|53|57P0)/.test(code) ||
    ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)
  );
}

/** A five-character SQLSTATE: the driver said the database itself refused something. */
function isDatabaseError(error: DriverError): boolean {
  return /^[0-9A-Z]{5}$/.test(error.code ?? '');
}

function describe(
  code: ErrorCode,
  extra: Partial<Pick<Classified, 'message' | 'details' | 'errors'>> = {},
  status?: number,
): Classified {
  const definition = ERROR_CATALOGUE[code];
  const category = definition.category as ErrorCategory;
  const finalStatus = status ?? definition.status;
  return {
    status: finalStatus,
    category,
    code,
    message: extra.message ?? definition.message,
    error: reasonPhrase(finalStatus),
    details: { ...extra.details, code, category },
    ...(extra.errors && { errors: extra.errors }),
    level: ERROR_CATEGORIES[category].level,
  };
}

/** The body of an `HttpException`, as an object whichever way it was thrown. */
function bodyOf(exception: HttpException): Record<string, any> {
  const response = exception.getResponse();
  return typeof response === 'string' ? { message: response } : (response as Record<string, any>);
}

function classifyHttp(exception: HttpException): Classified {
  const status = exception.getStatus();
  const body = bodyOf(exception);
  const named = body.details?.code;

  // A code the exception already carries wins over a guess from its status. It
  // keeps the status the exception was thrown with: the catalogue's category is
  // what is being borrowed, not its number.
  const category: ErrorCategory = isErrorCode(named)
    ? (ERROR_CATALOGUE[named].category as ErrorCategory)
    : categoryForStatus(status);
  const code: ErrorCode = isErrorCode(named) ? named : FALLBACK_CODE[category];

  // A 5xx never describes itself.
  if (status >= 500) return describe(code, {}, status);

  const message = body.message ?? ERROR_CATALOGUE[code].message;
  return describe(
    code,
    {
      message,
      details: { ...body.details },
      errors: body.errors,
    },
    status,
  );
}

/**
 * Anything with a numeric `statusCode` is a framework error rather than ours:
 * Fastify's own "body too large" and "invalid JSON" arrive this way, not as
 * `HttpException`s. Read as a client error of that status, message kept.
 */
function hasClientStatus(value: unknown): value is { statusCode: number; message?: string } {
  const status = (value as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === 'number' && status >= 400 && status < 500;
}

export function classify(exception: unknown, method = 'GET'): Classified {
  if (exception instanceof AppError) {
    const base = classifyHttp(exception);
    const category = exception.category;
    // Only a category that exposes its message may send the one it was given.
    if (ERROR_CATEGORIES[category].expose === 'message') return base;
    return describe(exception.code, { details: exception.details }, base.status);
  }

  if (exception instanceof HttpException) return classifyHttp(exception);

  if (hasClientStatus(exception)) {
    const status = exception.statusCode;
    const category = categoryForStatus(status);
    return describe(
      FALLBACK_CODE[category],
      { message: exception.message ?? ERROR_CATALOGUE[FALLBACK_CODE[category]].message },
      status,
    );
  }

  if (exception instanceof Error) {
    const driver = exception as unknown as DriverError;
    const mapped = mapDatabaseError(driver, method);
    if (mapped) {
      return describe(mapped.code, {
        message: mapped.message,
        details: { constraint: driver.constraint, table: driver.table },
      });
    }
    if (isDatabaseUnavailable(driver)) return describe('DATABASE_UNAVAILABLE');
    if (isDatabaseError(driver)) return describe('DATABASE_ERROR');
  }

  return describe('INTERNAL_ERROR');
}
