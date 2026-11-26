import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { type Kysely, sql } from "kysely";
import { KYSELY_CONNECTION } from "../../database/database.constants";
import { parseLevel } from "../../common/logging/level-control";
import { applyStoredLevels, getLogger } from "../../common/logging/logger.service";

/** How often another instance's change is picked up. */
const REFRESH_MS = 30_000;

/**
 * Where persisted log levels live, and the loop that applies them.
 *
 * Read at start-up and every thirty seconds: a restart keeps an override, and so does a second
 * instance behind the same database. A database that cannot be read (the table is missing in an
 * application that has not been migrated, the connection is down) never stops the application:
 * the levels simply stay as they are, and one warning says so.
 */
@Injectable()
export class LogLevelStore implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | undefined;
  private reportedFailure = false;

  constructor(@Inject(KYSELY_CONNECTION) private readonly db: Kysely<any>) {}

  async onModuleInit(): Promise<void> {
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Apply what the table says. */
  async refresh(): Promise<void> {
    try {
      const result = await sql<{ channel: string; level: string }>`
        SELECT channel, level FROM sys_log_level_override
      `.execute(this.db);
      this.reportedFailure = false;
      applyStoredLevels(
        result.rows.flatMap((row) => {
          const level = parseLevel(row.level);
          return level ? [{ channel: row.channel, level }] : [];
        }),
      );
    } catch (err) {
      if (!this.reportedFailure) {
        this.reportedFailure = true;
        getLogger("logging").event("logging.overrides.unavailable", { err });
      }
    }
  }

  /** Keep a level across restarts. Returns false when it could not be stored. */
  async save(channel: string, level: string, by: string): Promise<boolean> {
    try {
      await sql`
        INSERT INTO sys_log_level_override (channel, level, updated_by, updated_at)
        VALUES (${channel}, ${level}, ${by}, now())
        ON CONFLICT (channel) DO UPDATE
          SET level = EXCLUDED.level, updated_by = EXCLUDED.updated_by, updated_at = now()
      `.execute(this.db);
      return true;
    } catch (err) {
      getLogger("logging").event("logging.overrides.unavailable", { err });
      return false;
    }
  }

  async remove(channel: string): Promise<boolean> {
    try {
      await sql`DELETE FROM sys_log_level_override WHERE channel = ${channel}`.execute(this.db);
      return true;
    } catch (err) {
      getLogger("logging").event("logging.overrides.unavailable", { err });
      return false;
    }
  }
}
