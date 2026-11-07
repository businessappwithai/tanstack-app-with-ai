/**
 * Changing a log level on a running process.
 *
 * The decisions, free of Nest and Pino so they are tested with plain values: which levels
 * there are, whether a request names one, and how a channel's declared level, its effective
 * level and an override are reported together. `logger.service` applies them.
 */

export const LEVEL_NAMES = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

export type OverridableLevel = (typeof LEVEL_NAMES)[number];

/** A level a request may set, or null when it names none. */
export function parseLevel(value: unknown): OverridableLevel | null {
  return typeof value === 'string' && (LEVEL_NAMES as readonly string[]).includes(value)
    ? (value as OverridableLevel)
    : null;
}

export interface ChannelLevelReport {
  channel: string;
  /** What log-spec.json declares for the channel. */
  declared: string;
  /** What it logs at now: the override if there is one, otherwise the environment's reading. */
  effective: string;
  /** True when `effective` was set through the endpoint and will not survive a restart. */
  overridden: boolean;
}

export function describeLevels(
  channels: ReadonlyArray<{ name: string; level: string }>,
  effective: (channel: string) => string,
  overrides: ReadonlyMap<string, string>,
): ChannelLevelReport[] {
  return channels.map((channel) => ({
    channel: channel.name,
    declared: channel.level,
    effective: effective(channel.name),
    overridden: overrides.has(channel.name),
  }));
}
