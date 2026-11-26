import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { type Kysely, sql } from "kysely";
import { InjectDatabase } from "../../database/database.service.decorator";
import {
  LIFECYCLES,
  lifecycleFromDiagram,
  lifecycleOf,
  modelLifecycleOf,
  normalizeLifecycleEvent,
  type Lifecycle,
} from "../../common/lifecycle";
import { compileAutomationBpmn, tableForEntity } from "./automation-compiler";
import { LifecycleStore } from "./lifecycle-store.service";

/** Who switched a move grant off because its edge left the flow — and may switch it back on. */
const LIFECYCLE_EDIT = "lifecycle-edit";

/**
 * The table a status flow belongs to, by any spelling of its entity
 * (`BookingChange`, `booking_change`, `bus_booking_change`).
 */
export function lifecycleTableFor(entity: string): string {
  const direct = tableForEntity(entity ?? "");
  if (LIFECYCLES[direct]) return direct;
  const flat = (name: string) => name.toLowerCase().replace(/^bus_/, "").replace(/_/g, "");
  const wanted = flat(entity ?? "");
  return Object.keys(LIFECYCLES).find((table) => flat(table) === wanted) ?? direct;
}

export type WorkflowDefinitionDto = {
  name: string;
  entityName: string;
  /**
   * Which write runs it. `ENTER:<STATE>` binds it to the move into a state of the
   * record type's status flow (and `TRANSITION:<EVENT>` to one drawn move): it
   * runs in the second transaction of the button press, never on a plain save.
   */
  operation: "CREATE" | "UPDATE" | "DELETE" | "ALL" | `ENTER:${string}` | `TRANSITION:${string}`;
  /** BPMN diagrams carry XML; automations carry mermaid. Exactly one is required. */
  bpmnXml?: string;
  /** Mermaid with `%%` directives, as the automation builder writes it. */
  mermaid?: string;
  /**
   * "bpmn", "automation", or "state". Defaults to bpmn, which is what every older row is.
   * A "state" definition is a record type's status flow: saving it is what the
   * application runs from then on (LifecycleStore), in place of the model's.
   */
  kind?: "bpmn" | "automation" | "state";
  /** Ignored for a status flow: its column is the model's (common/lifecycle.ts). */
  statusField?: string;
  /** Ignored for a status flow: `mermaid` is read, the same way the generator reads the model's. */
  transitions?: Array<{ from: string; to: string; name?: string }>;
  description?: string;
  isActive?: boolean;
  /**
   * How the definition is reached.
   *   automatic  run on every write matching entityName + operation
   *   rule       run only when a rule's trigger-workflow action names it
   * Defaults to automatic, which is what an unmarked definition has always done.
   */
  triggerType?: "automatic" | "rule";
};

const OPERATION = /^(CREATE|UPDATE|DELETE|ALL|ENTER:[A-Z0-9_]+|TRANSITION:[A-Z0-9_]+)$/;

/**
 * An operation is one of the four writes, or a binding to a move. A binding has
 * to name something the record type's status flow draws: stored against a state
 * that is not there, it would be accepted, listed in Rules and workflows, and
 * never run.
 */
export function assertOperation(entityName: string, operation: string): void {
  if (!OPERATION.test(operation)) {
    throw new BadRequestException(
      `"${operation}" is not an operation. Use CREATE, UPDATE, DELETE, ALL, ENTER:<STATE> or TRANSITION:<EVENT>.`,
    );
  }
  const [kind, wanted] = operation.split(":");
  if (!wanted) return;
  const lifecycle = lifecycleOf(lifecycleTableFor(entityName));
  if (!lifecycle?.hasMachine) {
    throw new BadRequestException(
      `${entityName} has no status flow, so ${operation} can never run. Draw one, or use UPDATE.`,
    );
  }
  const drawn =
    kind === "ENTER"
      ? lifecycle.edges.some((edge) => normalizeLifecycleEvent(edge.to).toUpperCase() === wanted)
      : lifecycle.edges.some((edge) => edge.event.toUpperCase() === wanted);
  if (!drawn) {
    const names = lifecycle.edges.map((edge) => (kind === "ENTER" ? edge.to : edge.event));
    throw new BadRequestException(
      `${entityName}'s status flow does not draw "${wanted.toLowerCase()}". It draws: ${[...new Set(names)].join(", ")}.`,
    );
  }
}

/**
 * Content fields a model-owned definition will not accept through the API.
 *
 * `isActive` is deliberately absent: switching a workflow off is an operational
 * decision an admin should be able to take without editing the model. The next
 * generation turns it back on, which is the honest outcome — the model says it
 * should be running.
 */
const MODEL_OWNED_FIELDS = [
  "name",
  "entityName",
  "operation",
  "bpmnXml",
  "mermaid",
  "description",
  "triggerType",
  "transitions",
] as const;

@Injectable()
export class WorkflowDefinitionsService {
  constructor(
    @InjectDatabase() private readonly db: Kysely<any>,
    private readonly lifecycles: LifecycleStore,
  ) {}

  /**
   * A page of definitions, newest first.
   *
   * Paged rather than unbounded: an app that has been running a while
   * accumulates definitions faster than anyone deletes them, and a list
   * endpoint that returns all of them eventually times out the page that
   * depends on it. 200 is the default because it fills the longest rail the
   * builder draws without a second request.
   */
  async findAll(filters?: {
    entityName?: string;
    operation?: string;
    isActive?: boolean;
    kind?: string;
    limit?: number;
    offset?: number;
  }) {
    const limit = Math.min(Math.max(filters?.limit ?? 200, 1), 200);
    const offset = Math.max(filters?.offset ?? 0, 0);

    const where = <T extends { where: any }>(q: T): T => {
      let query: any = q;
      if (filters?.entityName) query = query.where("entity_name", "=", filters.entityName);
      if (filters?.operation) query = query.where("operation", "=", filters.operation);
      if (filters?.isActive !== undefined) query = query.where("is_active", "=", filters.isActive);
      if (filters?.kind) query = query.where("kind", "=", filters.kind);
      return query as T;
    };

    const items = await where(this.db.selectFrom("sys_workflow_definitions").selectAll())
      .orderBy("created_at", "desc")
      .limit(limit)
      .offset(offset)
      .execute();

    const counted = await where(
      this.db
        .selectFrom("sys_workflow_definitions")
        .select((eb: any) => eb.fn.countAll().as("total"))
    ).executeTakeFirst();

    const total = Number((counted as { total?: number | string })?.total ?? items.length);
    return { items, total, limit, offset, hasMore: offset + items.length < total };
  }

  async findOne(id: string) {
    const def = await this.db
      .selectFrom("sys_workflow_definitions")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    if (!def) throw new NotFoundException(`Workflow definition ${id} not found`);
    return def;
  }

  async findActiveForEntity(entityName: string, operation: string) {
    // Match definitions stored under either the singular base name (e.g. 'account')
    // or the full bus_ table name (e.g. 'bus_account').
    const flat = entityName.toLowerCase().replace(/^bus_/, "").replace(/_/g, "");
    return this.db
      .selectFrom("sys_workflow_definitions")
      .selectAll()
      .where((eb) => eb(sql<string>`replace(lower(entity_name), '_', '')`, "in", [flat, `bus${flat}`]))
      .where((eb) =>
        eb.or([eb("operation", "=", operation.toUpperCase()), eb("operation", "=", "ALL")])
      )
      .where("is_active", "=", true)
      .orderBy("created_at", "asc")
      .execute();
  }

  async create(dto: WorkflowDefinitionDto, userId?: string) {
    // A definition is either a BPMN diagram or a mermaid automation. Demanding
    // BPMN of both is what stopped the automation builder saving anything.
    const kind = dto.kind ?? (dto.mermaid?.trim() ? "automation" : "bpmn");

    if (kind === "state") return this.createFlow(dto, userId);
    if (kind === "automation") {
      if (!dto.mermaid?.trim()) throw new BadRequestException("mermaid is required");
      if (!/^\s*(flowchart|graph)\b/m.test(dto.mermaid)) {
        throw new BadRequestException("An automation must be a mermaid flowchart");
      }
    } else {
      if (!dto.bpmnXml?.trim()) throw new BadRequestException("bpmnXml is required");
      if (!dto.bpmnXml.includes("<bpmn:")) throw new BadRequestException("Invalid BPMN XML");
    }

    assertOperation(dto.entityName, dto.operation ?? "ALL");

    const [result] = await this.db
      .insertInto("sys_workflow_definitions")
      .values({
        name: dto.name,
        entity_name: dto.entityName,
        operation: dto.operation ?? "ALL",
        // An automation built in the application stores its flowchart; what the
        // executor runs is the BPMN compiled from it, written here so that
        // publishing the automation is what makes it do something.
        bpmn_xml:
          dto.bpmnXml ??
          (kind === "automation" && dto.mermaid
            ? compileAutomationBpmn(dto.mermaid, tableForEntity(dto.entityName), tableForEntity)
            : null),
        mermaid_code: dto.mermaid ?? null,
        kind,
        description: dto.description ?? null,
        trigger_type: dto.triggerType ?? "automatic",
        // Anything created through the API was built in the app, so the model
        // seed leaves it alone.
        source: "designer",
        is_active: dto.isActive ?? true,
        created_by: userId ?? null,
      } as any)
      .returningAll()
      .execute();
    return result;
  }

  async update(id: string, dto: Partial<WorkflowDefinitionDto>) {
    const existing = await this.findOne(id);

    // A definition declared by a %%workflow section belongs to the model. The
    // next generation rewrites it, so accepting an edit here would look like it
    // worked and then quietly vanish.
    if ((existing as any).kind === "state") return this.updateFlow(existing as any, dto);
    if ((existing as any).source === "model") {
      const attempted = MODEL_OWNED_FIELDS.filter((field) => dto[field] !== undefined);
      if (attempted.length > 0) {
        throw new BadRequestException(
          `"${(existing as any).name}" is declared in the model — edit the %%workflow section and regenerate. ` +
            `Rejected: ${attempted.join(", ")}.`,
        );
      }
    }

    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (dto.name !== undefined) updates.name = dto.name;
    if (dto.entityName !== undefined) updates.entity_name = dto.entityName;
    if (dto.operation !== undefined) {
      assertOperation(dto.entityName ?? (existing as any).entity_name, dto.operation);
      updates.operation = dto.operation;
    }
    if (dto.bpmnXml !== undefined) updates.bpmn_xml = dto.bpmnXml;
    // The automation builder's whole document. Leaving it out of the update
    // meant every save — the draft and Publish alike — kept the steps the
    // automation was created with, which for a new one is none at all.
    if (dto.mermaid !== undefined) {
      if (!/^\s*(flowchart|graph)\b/m.test(dto.mermaid)) {
        throw new BadRequestException("An automation must be a mermaid flowchart");
      }
      updates.mermaid_code = dto.mermaid;
      // Recompiled with it, or a saved edit would keep running the steps it was
      // created with. An explicit `bpmnXml` in the same call wins.
      if (dto.bpmnXml === undefined && (existing as any).kind === "automation") {
        updates.bpmn_xml = compileAutomationBpmn(
          dto.mermaid,
          tableForEntity(dto.entityName ?? (existing as any).entity_name),
          tableForEntity,
        );
      }
    }
    if (dto.description !== undefined) updates.description = dto.description;
    if (dto.isActive !== undefined) updates.is_active = dto.isActive;
    if (dto.triggerType !== undefined) updates.trigger_type = dto.triggerType;

    const [result] = await this.db
      .updateTable("sys_workflow_definitions")
      .set(updates as any)
      .where("id", "=", id)
      .returningAll()
      .execute();
    return result;
  }

  async remove(id: string) {
    const existing = await this.findOne(id);
    if ((existing as any).kind === "state") return this.removeFlow(existing as any);
    if ((existing as any).source === "model") {
      throw new BadRequestException(
        `"${(existing as any).name}" is declared in the model — remove the %%workflow section and regenerate. ` +
          "Deactivate it instead if you need it off now.",
      );
    }
    await this.db.deleteFrom("sys_workflow_definitions").where("id", "=", id).execute();
    return { deleted: true };
  }

  // ── Status flows ─────────────────────────────────────────────────────────
  //
  // A kind = 'state' row is the flow of record for its table: LifecycleStore
  // loads it into common/lifecycle.ts, and every reader — the action buttons, the
  // transition API, the save pipeline, the guard — follows it. A table with no
  // row runs the model's flow, so removing the row is how an edited flow goes
  // back. Rows are filed under the table name and always `source = 'designer'`:
  // the seed never writes one, so regenerating never overwrites an edit.

  /** The diagram compiled for its table, or a 400 saying why it cannot be a flow. */
  private compileFlow(table: string, mermaid: string | undefined): Lifecycle {
    if (!mermaid?.trim()) throw new BadRequestException("mermaid is required");
    const { lifecycle, problems } = lifecycleFromDiagram(table, mermaid);
    if (!lifecycle) throw new BadRequestException(problems.join(" "));
    return lifecycle;
  }

  private async createFlow(dto: WorkflowDefinitionDto, userId?: string) {
    const table = lifecycleTableFor(dto.entityName);
    const next = this.compileFlow(table, dto.mermaid);
    const taken = await this.db
      .selectFrom("sys_workflow_definitions")
      .select("id")
      .where("kind", "=", "state")
      .where("entity_name", "in", [table, dto.entityName])
      .executeTakeFirst();
    if (taken) throw new BadRequestException(`${dto.entityName} already has a status flow — edit that one.`);

    const created = await this.db.transaction().execute(async (trx) => {
      await this.moveTo(trx, table, next);
      const [row] = await trx
        .insertInto("sys_workflow_definitions")
        .values({
          name: dto.name,
          entity_name: table,
          operation: "UPDATE",
          bpmn_xml: null,
          mermaid_code: dto.mermaid,
          kind: "state",
          lifecycle: JSON.stringify(next),
          description: dto.description ?? null,
          trigger_type: "automatic",
          source: "designer",
          is_active: dto.isActive ?? true,
          created_by: userId ?? null,
        } as any)
        .returningAll()
        .execute();
      return row;
    });
    await this.lifecycles.reload();
    return created;
  }

  private async updateFlow(existing: Record<string, any>, dto: Partial<WorkflowDefinitionDto>) {
    const table = lifecycleTableFor(existing.entity_name);
    const mermaid = dto.mermaid ?? existing.mermaid_code ?? "";
    const active = dto.isActive ?? existing.is_active !== false;
    // Switched off, the table runs the model's flow again.
    const next = active ? this.compileFlow(table, mermaid) : modelLifecycleOf(table);
    const saved = await this.db.transaction().execute(async (trx) => {
      if (next) await this.moveTo(trx, table, next);
      const [row] = await trx
        .updateTable("sys_workflow_definitions")
        .set({
          updated_at: new Date(),
          entity_name: table,
          mermaid_code: mermaid,
          lifecycle: active && next ? JSON.stringify(next) : null,
          is_active: active,
          source: "designer",
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
        } as any)
        .where("id", "=", existing.id)
        .returningAll()
        .execute();
      return row;
    });
    await this.lifecycles.reload();
    return saved;
  }

  private async removeFlow(existing: Record<string, any>) {
    const table = lifecycleTableFor(existing.entity_name);
    const model = modelLifecycleOf(table);
    await this.db.transaction().execute(async (trx) => {
      if (model?.hasMachine) await this.moveTo(trx, table, model);
      else await sql`DELETE FROM sys_workflow_transitions WHERE table_name = ${table}`.execute(trx);
      await trx.deleteFrom("sys_workflow_definitions").where("id", "=", existing.id).execute();
    });
    await this.lifecycles.reload();
    return { deleted: true, revertedToModel: !!model?.hasMachine };
  }

  /**
   * Everything that has to agree with a table's flow before it runs, in the
   * caller's transaction:
   *
   *   - no record may sit in a state the new flow drops (409 LIFECYCLE_STATES_IN_USE,
   *     naming each state and how many records are in it) — a record must always
   *     have a way out of where it is
   *   - move grants follow the edges: a grant is keyed by from → to, so one on a
   *     kept edge keeps working and takes the edge's new event name; one on an
   *     edge the flow drops is switched off, not deleted, so drawing the edge
   *     again restores the restriction instead of opening the move to everyone
   *     who may update (the change fires `access_changed`)
   *   - `sys_workflow_transitions`, the edges GET /workflows/transitions lists
   */
  private async moveTo(trx: Kysely<any>, table: string, next: Lifecycle) {
    const current = lifecycleOf(table);
    if (current) {
      const dropped = current.values.filter((value) => !next.values.includes(value));
      if (dropped.length > 0) {
        const column = sql.ref(current.column);
        const { rows } = await sql<{ state: string; n: number }>`
          SELECT ${column} AS state, count(*)::int AS n FROM ${sql.table(table)}
          WHERE ${column} IN (${sql.join(dropped)}) AND deleted_at IS NULL
          GROUP BY ${column}`.execute(trx);
        const inUse = rows.filter((row) => row.n > 0);
        if (inUse.length > 0) {
          const listed = inUse.map((row) => `"${row.state}" (${row.n})`).join(", ");
          throw new ConflictException({
            message:
              `Records are still in ${listed}, which this flow no longer has. ` +
              "Move them to a state the flow keeps, then save it again.",
            error: "Conflict",
            details: {
              code: "LIFECYCLE_STATES_IN_USE",
              table,
              states: inUse.map((row) => ({ state: row.state, records: row.n })),
            },
          });
        }
      }
    }

    const grants = (await trx
      .selectFrom("sys_access_grant" as any)
      .select(["sys_access_grant_id", "action", "from_state", "to_state", "role_name", "is_active", "updated_by"] as any)
      .where("kind" as any, "=", "move")
      .where("table_name" as any, "=", table)
      .execute()) as Array<Record<string, any>>;
    for (const grant of grants) {
      const edges = next.edges.filter((edge) => edge.from === grant.from_state && edge.to === grant.to_state);
      if (edges.length === 0) {
        if (grant.is_active) {
          await trx
            .updateTable("sys_access_grant" as any)
            .set({ is_active: false, updated_by: LIFECYCLE_EDIT, updated_at: new Date() } as any)
            .where("sys_access_grant_id" as any, "=", grant.sys_access_grant_id)
            .execute();
        }
        continue;
      }
      const edge = edges.find((candidate) => candidate.event === grant.action) ?? edges[0]!;
      const action = edge.event || `${edge.from}->${edge.to}`;
      const revive = !grant.is_active && grant.updated_by === LIFECYCLE_EDIT;
      if (action === grant.action && !revive) continue;
      const clash = await trx
        .selectFrom("sys_access_grant" as any)
        .select("sys_access_grant_id" as any)
        .where("kind" as any, "=", "move")
        .where("table_name" as any, "=", table)
        .where("action" as any, "=", action)
        .where("from_state" as any, "=", grant.from_state)
        .where("to_state" as any, "=", grant.to_state)
        .where("sys_access_grant_id" as any, "!=", grant.sys_access_grant_id)
        .where("role_name" as any, "=", grant.role_name)
        .executeTakeFirst();
      await trx
        .updateTable("sys_access_grant" as any)
        .set({
          ...(clash ? {} : { action }),
          ...(revive ? { is_active: true } : {}),
          updated_by: LIFECYCLE_EDIT,
          updated_at: new Date(),
        } as any)
        .where("sys_access_grant_id" as any, "=", grant.sys_access_grant_id)
        .execute();
    }

    await sql`DELETE FROM sys_workflow_transitions WHERE table_name = ${table}`.execute(trx);
    for (const edge of next.edges) {
      await sql`
        INSERT INTO sys_workflow_transitions (table_name, status_field, from_state, to_state, transition_name)
        VALUES (${table}, ${next.column}, ${edge.from}, ${edge.to}, ${edge.event || null})
        ON CONFLICT (table_name, status_field, from_state, to_state) DO NOTHING`.execute(trx);
    }
  }
}
