import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { Kysely } from "kysely";
import { InjectDatabase } from "../../database/database.service.decorator";
import {
  applyLifecycleOverrides,
  LIFECYCLES,
  lifecycleFromDiagram,
  lifecycleOf,
  type Lifecycle,
} from "../../common/lifecycle";
import { getLogger } from "../../common/logging/logger.service";

/**
 * The status flows an administrator redrew, loaded into `common/lifecycle.ts`.
 *
 * Every reader of a lifecycle — the transition service and its action buttons,
 * the bus service's save pipeline, promotion, the workflow engine, the access
 * guard — asks `lifecycleOf`. This service is what makes that answer the
 * administrator's: at start, on `pg_notify('lifecycle_changed')` from any
 * instance, and straight after a save on this one. A table with no stored flow,
 * a stored flow that no longer compiles, or a database that cannot be read all
 * leave the model's flow in force — never no flow at all.
 */
@Injectable()
export class LifecycleStore implements OnModuleInit, OnModuleDestroy {
  private listener: { end(): Promise<void> } | null = null;
  private stopped = false;

  constructor(@InjectDatabase() private readonly db: Kysely<any>) {}

  async onModuleInit(): Promise<void> {
    await this.reload();
    await this.listen();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    await this.listener?.end().catch(() => undefined);
  }

  /** Every table with a status flow, as the application runs it now. */
  effective(): Record<string, Lifecycle> {
    const result: Record<string, Lifecycle> = {};
    for (const tableName of Object.keys(LIFECYCLES)) {
      if (!LIFECYCLES[tableName]?.hasMachine) continue;
      const lifecycle = lifecycleOf(tableName);
      if (lifecycle) result[tableName] = lifecycle;
    }
    return result;
  }

  /** Read every stored flow and run them. */
  async reload(): Promise<void> {
    let rows: Array<{ entity_name: string; mermaid_code: string | null; lifecycle: unknown }>;
    try {
      rows = (await this.db
        .selectFrom("sys_workflow_definitions")
        .select(["entity_name", "mermaid_code", "lifecycle"] as any)
        .where("kind", "=", "state")
        .where("is_active", "=", true)
        .orderBy("updated_at", "asc")
        .execute()) as any;
    } catch (error: any) {
      getLogger("workflow").event("workflow.lifecycle.unavailable", { reason: error?.message ?? String(error) });
      return;
    }
    const next: Record<string, Lifecycle> = {};
    for (const row of rows) {
      // The diagram is the source; the stored compilation is what it compiled to
      // when saved. Recompiling here means a flow written by an older build, or
      // by hand, runs exactly as this build reads it.
      const { lifecycle, problems } = lifecycleFromDiagram(row.entity_name, row.mermaid_code ?? "");
      if (!lifecycle) {
        getLogger("workflow").event("workflow.lifecycle.ignored", {
          entity: row.entity_name,
          reason: problems.join(" "),
        });
        continue;
      }
      next[row.entity_name] = lifecycle;
    }
    applyLifecycleOverrides(next);
  }

  /** Listen on a connection of its own. Best-effort, like CapabilityService's. */
  private async listen(): Promise<void> {
    const url = process.env.DATABASE_URL;
    if (!url || this.stopped) return;
    try {
      const pg: any = await import("pg");
      const Client = pg.Client ?? pg.default?.Client;
      if (!Client) return;
      const client = new Client({ connectionString: url });
      await client.connect();
      client.on?.("notification", () => void this.reload());
      const reconnect = () => {
        this.listener = null;
        if (!this.stopped) setTimeout(() => void this.reload().then(() => this.listen()), 5000).unref?.();
      };
      client.on?.("error", reconnect);
      client.on?.("end", () => {
        if (!this.stopped) reconnect();
      });
      await client.query("LISTEN lifecycle_changed");
      this.listener = client;
    } catch (error: any) {
      getLogger("workflow").event("workflow.lifecycle.unavailable", {
        reason: `not listening for status flow changes (${error?.message ?? error}); another instance's edit is picked up on restart`,
      });
    }
  }
}
