import { Controller, Get, UseGuards } from "@nestjs/common";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard";
import { LifecycleStore } from "./lifecycle-store.service";

/**
 * `GET /api/lifecycles` — every status flow as the application runs it now,
 * keyed by table: the model's, or the one an administrator redrew. The front
 * end's badge, list and form read lifecycles from its compiled
 * `lib/lifecycle.ts`; this is what it overlays so they follow an edit too.
 * Any signed-in user: it says where a record can go, never who may move it.
 */
@UseGuards(SessionAuthGuard)
@Controller("lifecycles")
export class LifecyclesController {
  constructor(private readonly store: LifecycleStore) {}

  @Get()
  findAll() {
    return this.store.effective();
  }
}
