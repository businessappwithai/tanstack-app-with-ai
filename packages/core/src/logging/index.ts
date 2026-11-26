/**
 * Structured logging, specified once in `log-spec.json`.
 *
 * Server-side only. Pino writes to a file descriptor, so importing this from a
 * browser bundle pulls in `node:` builtins that are not there — in
 * `packages/web` that means a server handler may import it and a client
 * component may not.
 */

export {
  type ChannelLogger,
  clearLoggerCache,
  getLogger,
  installProcessLogging,
  type LogFields,
  resetLoggerForTesting,
} from "./logger";

export {
  categoryForStatus,
  type ConfiguredLevel,
  channelNames,
  type ErrorCategory,
  type ErrorDefinition,
  type ErrorExposure,
  errorCodes,
  eventIds,
  findChannel,
  findError,
  findErrorCategory,
  findEvent,
  LEVELS,
  type LogChannel,
  type LogEvent,
  type LogLevel,
  type LogSpec,
  logSpec,
  profileFor,
  resolveLevel,
} from "./spec";
