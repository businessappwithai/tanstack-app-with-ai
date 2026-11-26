import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { appError } from "../../common/errors/app-error";
import { getLogger } from "../../common/logging/logger.service";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard";
import { admit, CLIENT_LOG_LIMITS, pathOf, text } from "./client-log-rules";

const LEVELS = ["error", "warn", "info"] as const;
type ClientLevel = (typeof LEVELS)[number];

interface ClientLogBody {
  level?: unknown;
  message?: unknown;
  source?: unknown;
  url?: unknown;
  stack?: unknown;
  component?: unknown;
  code?: unknown;
  category?: unknown;
  ref?: unknown;
}

/**
 * What the browser reports about itself.
 *
 * Signed-in callers only, bounded in size and rate, and reported to the log and
 * nowhere else: nothing here is stored. The fields are a fixed list rather than
 * free-form metadata, because a browser can be made to say anything and the log
 * must not become a place where it can write business data.
 */
@ApiTags("client-logs")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller("client-logs")
export class ClientLogsController {
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Report an error or message from the browser" })
  report(@Body() body: ClientLogBody, @Req() req: any): void {
    if (JSON.stringify(body ?? {}).length > CLIENT_LOG_LIMITS.bodyChars) {
      throw new HttpException("Log entry too large", HttpStatus.PAYLOAD_TOO_LARGE);
    }

    const level = body?.level as ClientLevel;
    const message = text(body?.message, CLIENT_LOG_LIMITS.messageChars);
    if (!LEVELS.includes(level) || !message) {
      throw appError("VALIDATION_FAILED", { message: "A report needs a level and a message." });
    }

    const userId = String(req?.user?.id ?? "unknown");
    if (!admit(userId)) throw appError("RATE_LIMITED");

    const log = getLogger("client");
    const short = (value: unknown) => text(value, CLIENT_LOG_LIMITS.shortChars);
    const common = {
      source: short(body.source) ?? "unknown",
      message,
      url: pathOf(body.url),
      component: short(body.component),
      userId,
    };

    if (level === "error") {
      log.event("client.error.reported", {
        ...common,
        code: short(body.code),
        ref: short(body.ref),
        stack: text(body.stack, CLIENT_LOG_LIMITS.stackChars),
      });
    } else {
      log.event("client.report.received", { ...common, level });
    }
  }
}
