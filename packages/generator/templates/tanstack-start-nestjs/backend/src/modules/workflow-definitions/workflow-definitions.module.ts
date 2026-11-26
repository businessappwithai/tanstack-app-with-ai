import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { LifecycleStore } from "./lifecycle-store.service";
import { LifecyclesController } from "./lifecycles.controller";
import { WorkflowDefinitionsController } from "./workflow-definitions.controller";
import { WorkflowDefinitionsService } from "./workflow-definitions.service";

@Module({
  imports: [DatabaseModule],
  controllers: [WorkflowDefinitionsController, LifecyclesController],
  providers: [WorkflowDefinitionsService, LifecycleStore],
  exports: [WorkflowDefinitionsService, LifecycleStore],
})
export class WorkflowDefinitionsModule {}
