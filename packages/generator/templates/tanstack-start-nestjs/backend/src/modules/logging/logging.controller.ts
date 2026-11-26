import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Put, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { appError } from "../../common/errors/app-error";
import { parseLevel } from "../../common/logging/level-control";
import {
  getChannelLevels,
  getLogger,
  markPersisted,
  resetChannelLevel,
  setChannelLevel,
} from "../../common/logging/logger.service";
import { LogLevelStore } from "./log-level-store.service";
import { AdminOnlyGuard } from "../auth/guards/admin-only.guard";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard";

/**
 * Turn a channel up or down on a running process.
 *
 * For the night something is wrong in one subsystem and a restart would lose the state that
 * shows why. An override is kept in the database and applied at start-up (and every half minute, so a
 * second instance follows), unless it is set with `{ "persist": false }`, in which case it lives
 * in this process's memory and is gone when it restarts. Every change is
 * itself logged, with who made it.
 *
 * Administrators only, **reads included**: which subsystems are being watched is not for
 * everyone, and the dictionary guard (reads open, writes closed) is the wrong shape for it.
 */
@ApiTags("logging")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, AdminOnlyGuard)
@Controller("logging")
export class LoggingController {
  constructor(private readonly store: LogLevelStore) {}

  @Get("levels")
  @ApiOperation({ summary: "Every channel's declared and effective log level" })
  levels() {
    return { data: getChannelLevels() };
  }

  @Put("levels/:channel")
  @ApiOperation({ summary: "Set a channel's log level until the process restarts" })
  async set(
    @Param("channel") channel: string,
    @Body() body: { level?: unknown; persist?: unknown },
    @Req() req: any,
  ) {
    const level = parseLevel(body?.level);
    if (!level) {
      throw appError("VALIDATION_FAILED", {
        message: "level must be one of fatal, error, warn, info, debug, trace, silent.",
      });
    }
    const change = setChannelLevel(channel, level);
    if (!change) throw appError("NOT_FOUND", { message: `There is no log channel "${channel}".` });
    const by = String(req?.user?.id ?? "unknown");

    // Kept across restarts unless the caller says it is temporary ({ "persist": false }).
    const persist = body?.persist !== false;
    const persisted = persist ? await this.store.save(channel, level, by) : false;
    markPersisted(channel, persisted);

    getLogger("logging").event("logging.level.changed", { channel, from: change.from, to: change.to, by });
    return { data: { ...change, persisted } };
  }

  @Delete("levels/:channel")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Remove a channel's override" })
  async reset(@Param("channel") channel: string, @Req() req: any) {
    const change = resetChannelLevel(channel);
    if (!change) throw appError("NOT_FOUND", { message: `There is no log channel "${channel}".` });
    await this.store.remove(channel);
    markPersisted(channel, false);
    getLogger("logging").event("logging.level.changed", {
      channel,
      from: change.from,
      to: change.to,
      by: String(req?.user?.id ?? "unknown"),
    });
    return { data: change };
  }
}
