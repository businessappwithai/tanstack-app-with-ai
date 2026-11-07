import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Put, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { appError } from "../../common/errors/app-error";
import { parseLevel } from "../../common/logging/level-control";
import {
  getChannelLevels,
  getLogger,
  resetChannelLevel,
  setChannelLevel,
} from "../../common/logging/logger.service";
import { AdminOnlyGuard } from "../auth/guards/admin-only.guard";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard";

/**
 * Turn a channel up or down on a running process.
 *
 * For the night something is wrong in one subsystem and a restart would lose the state that
 * shows why. An override lives in this process's memory and is gone when it restarts, which
 * returns the application to what `log-spec.json` and the environment say. Every change is
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
  @Get("levels")
  @ApiOperation({ summary: "Every channel's declared and effective log level" })
  levels() {
    return { data: getChannelLevels() };
  }

  @Put("levels/:channel")
  @ApiOperation({ summary: "Set a channel's log level until the process restarts" })
  set(@Param("channel") channel: string, @Body() body: { level?: unknown }, @Req() req: any) {
    const level = parseLevel(body?.level);
    if (!level) {
      throw appError("VALIDATION_FAILED", {
        message: "level must be one of fatal, error, warn, info, debug, trace, silent.",
      });
    }
    const change = setChannelLevel(channel, level);
    if (!change) throw appError("NOT_FOUND", { message: `There is no log channel "${channel}".` });
    getLogger("logging").event("logging.level.changed", {
      channel,
      from: change.from,
      to: change.to,
      by: String(req?.user?.id ?? "unknown"),
    });
    return { data: change };
  }

  @Delete("levels/:channel")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Remove a channel's override" })
  reset(@Param("channel") channel: string, @Req() req: any) {
    const change = resetChannelLevel(channel);
    if (!change) throw appError("NOT_FOUND", { message: `There is no log channel "${channel}".` });
    getLogger("logging").event("logging.level.changed", {
      channel,
      from: change.from,
      to: change.to,
      by: String(req?.user?.id ?? "unknown"),
    });
    return { data: change };
  }
}
