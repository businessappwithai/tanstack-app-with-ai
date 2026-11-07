import { Module } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { DatabaseModule } from "../../database/database.module";
import { ClientLogsController } from "./client-logs.controller";

/**
 * `Reflector` and `DatabaseModule` are what SessionAuthGuard resolves against —
 * the same pair the notifications module provides, for the same reason.
 */
@Module({
  imports: [DatabaseModule],
  providers: [Reflector],
  controllers: [ClientLogsController],
})
export class ClientLogsModule {}
