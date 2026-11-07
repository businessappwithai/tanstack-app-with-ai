import { Module } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { DatabaseModule } from "../../database/database.module";
import { AdminOnlyGuard } from "../auth/guards/admin-only.guard";
import { LogLevelStore } from "./log-level-store.service";
import { LoggingController } from "./logging.controller";

/**
 * `Reflector` and `DatabaseModule` are what SessionAuthGuard resolves against — the pair the
 * notifications and client-logs modules provide, for the same reason.
 */
@Module({
  imports: [DatabaseModule],
  providers: [Reflector, AdminOnlyGuard, LogLevelStore],
  controllers: [LoggingController],
})
export class LoggingModule {}
