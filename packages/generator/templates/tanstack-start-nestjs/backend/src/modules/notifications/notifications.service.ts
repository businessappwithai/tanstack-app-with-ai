import { Inject, Injectable, } from "@nestjs/common";
import { type Kysely, sql } from "kysely";
import { KYSELY_CONNECTION } from "../../database/database.constants";
import { TRANSACTION_ACTIONS } from "../audit/audit.types";
import type {
  NotificationPage,
  TransactionNotification,
  TransactionOutcome,
} from "./notifications.types";
import { getLogger } from "../../common/logging/logger.service";

/**
 * A user's own record transactions, read out of the audit trail.
 *
 * Every write to a business entity is two transactions — the save that commits
 * the row as a draft, and the background one that finalises it or explains why
 * it could not — and both are recorded in `audit_log` against the user who
 * made them. This service reads those rows back for one user and turns them
 * into sentences.
 *
 * It reads the trail and nothing else. There is no notification table to fall
 * out of step with what happened, no second copy of a failure message, and
 * nothing to reconcile: if the trail does not say it, the user is not told it.
 * The only thing stored alongside is a read mark per (user, row).
 */
@Injectable()
export class NotificationsService {

  /** table_name → display name, from the Application Dictionary. */
  private entityLabels: Map<string, string> | null = null;

  constructor(@Inject(KYSELY_CONNECTION) private readonly kysely: Kysely<any>) {}

  /**
   * One page of this user's transactions, newest first.
   *
   * Paged on the timestamp rather than an offset: the trail is append-only and
   * grows while a user is scrolling, and an offset would show them the same row
   * twice as new ones arrive above it.
   */
  async list(userId: string, limit = 30, before?: string): Promise<NotificationPage> {
    const pageSize = Math.min(100, Math.max(1, limit));

    let query = this.kysely
      .selectFrom("audit_log as a")
      .leftJoin("sys_notification_read as r", (join) =>
        join.onRef("r.audit_id", "=", "a.id").on("r.user_id", "=", userId as any)
      )
      .select([
        "a.id as id",
        "a.timestamp as timestamp",
        "a.action as action",
        "a.entity_type as entity_type",
        "a.entity_id as entity_id",
        "a.after_value as after_value",
        "a.before_value as before_value",
        "a.changed_fields as changed_fields",
        "a.success as success",
        "a.error_message as error_message",
        "r.read_at as read_at",
      ])
      .where("a.user_id", "=", userId)
      .where("a.action", "in", TRANSACTION_ACTIONS as string[])
      .orderBy("a.timestamp", "desc")
      // The trail can record two rows in the same millisecond — the draft and a
      // finalisation that needed no work. Without a tiebreaker the cursor can
      // loop on them; with one the order is total.
      .orderBy("a.id", "desc")
      .limit(pageSize + 1);

    if (before) {
      query = query.where("a.timestamp", "<", before);
    }

    const [rows, unread, labels] = await Promise.all([
      query.execute(),
      this.unreadCount(userId),
      this.labels(),
    ]);

    const hasMore = rows.length > pageSize;
    const page = hasMore ? rows.slice(0, pageSize) : rows;
    const last = page[page.length - 1] as any;

    return {
      data: page.map((row) => this.present(row as any, labels)),
      meta: {
        unread,
        limit: pageSize,
        nextCursor: hasMore && last ? new Date(last.timestamp).toISOString() : null,
      },
    };
  }

  /** How many of this user's transactions they have not opened yet. */
  async unreadCount(userId: string): Promise<number> {
    const row = await this.kysely
      .selectFrom("audit_log as a")
      .leftJoin("sys_notification_read as r", (join) =>
        join.onRef("r.audit_id", "=", "a.id").on("r.user_id", "=", userId as any)
      )
      .select((eb) => eb.fn.countAll<string>().as("total"))
      .where("a.user_id", "=", userId)
      .where("a.action", "in", TRANSACTION_ACTIONS as string[])
      .where("r.audit_id", "is", null)
      .executeTakeFirst();

    return Number.parseInt(String((row as any)?.total ?? 0), 10);
  }

  /**
   * Mark specific notifications read.
   *
   * Scoped to the caller's own rows in the same statement that writes the mark,
   * so a caller cannot mark another user's notification read by guessing its id
   * — the insert selects from the trail rather than trusting the request.
   */
  async markRead(userId: string, auditIds: string[]): Promise<{ marked: number }> {
    if (auditIds.length === 0) return { marked: 0 };

    const result = await sql<{ audit_id: string }>`
      INSERT INTO sys_notification_read (user_id, audit_id)
      SELECT ${userId}, a.id
        FROM audit_log a
       WHERE a.id = ANY(${auditIds}::uuid[])
         AND a.user_id = ${userId}
      ON CONFLICT (user_id, audit_id) DO NOTHING
      RETURNING audit_id
    `.execute(this.kysely);

    return { marked: result.rows.length };
  }

  /** Mark every transaction this user has as read. */
  async markAllRead(userId: string): Promise<{ marked: number }> {
    const result = await sql<{ audit_id: string }>`
      INSERT INTO sys_notification_read (user_id, audit_id)
      SELECT ${userId}, a.id
        FROM audit_log a
       WHERE a.user_id = ${userId}
         AND a.action = ANY(${TRANSACTION_ACTIONS as string[]})
      ON CONFLICT (user_id, audit_id) DO NOTHING
      RETURNING audit_id
    `.execute(this.kysely);

    return { marked: result.rows.length };
  }

  /* ------------------------------------------------------------------------ */
  /*  Presentation                                                             */
  /* ------------------------------------------------------------------------ */

  /**
   * Entity display names, read once per process.
   *
   * `bus_opportunity_line_item` is not what anybody calls it. The dictionary
   * already holds the name an administrator gave the table, and it is the same
   * name every screen shows, so the notification list uses that rather than
   * inventing a second way of writing entity names.
   */
  private async labels(): Promise<Map<string, string>> {
    if (this.entityLabels) return this.entityLabels;

    const map = new Map<string, string>();
    try {
      const rows = await this.kysely
        .selectFrom("sys_table")
        .select(["table_name", "name"])
        .execute();
      for (const row of rows as Array<{ table_name: string; name: string }>) {
        if (row.table_name && row.name) map.set(row.table_name, row.name);
      }
    } catch (err) {
      getLogger("notifications").event("notifications.send.failed", { step: "reading entity names from the dictionary", err });
    }

    this.entityLabels = map;
    return map;
  }

  /** Columns that name a record, in the order a reader would recognise it by. */
  private static readonly LABEL_COLUMNS = [
    "name",
    "title",
    "subject",
    "label",
    "code",
    "reference",
    "number",
    "email",
    "description",
  ];

  private recordLabel(after: Record<string, unknown> | null, recordId: string | null): string {
    if (after) {
      for (const column of NotificationsService.LABEL_COLUMNS) {
        const value = after[column];
        if (typeof value === "string" && value.trim()) return value.trim();
      }
      // A `*_name` or `*_number` column is just as good a name and is what most
      // generated schemas actually carry — `account_name`, `case_number`.
      for (const [key, value] of Object.entries(after)) {
        if (!/(_name|_number|_code|_title)$/.test(key)) continue;
        if (typeof value === "string" && value.trim()) return value.trim();
      }
    }
    return recordId ? `#${recordId.slice(0, 8)}` : "a record";
  }

  private entitySlug(table: string): string {
    return table.replace(/^bus_/, "").replace(/_/g, "-");
  }

  private present(
    row: {
      id: string;
      timestamp: string | Date;
      action: string;
      entity_type: string | null;
      entity_id: string | null;
      after_value: unknown;
      before_value: unknown;
      changed_fields: string[] | null;
      success: boolean;
      error_message: string | null;
      read_at: string | Date | null;
    },
    labels: Map<string, string>
  ): TransactionNotification {
    const table = row.entity_type ?? "";
    const entityLabel = labels.get(table) ?? this.titleCase(this.entitySlug(table));
    // A delete keeps the record on the `before` side, so the name has to be
    // read from whichever side the transaction actually populated.
    const record = (row.after_value ?? row.before_value ?? null) as Record<
      string,
      unknown
    > | null;
    const recordLabel = this.recordLabel(record, row.entity_id);

    const operation = this.operationOf(row.changed_fields);
    const phase = row.action === "ENTITY_DRAFT" ? "draft" : "finalize";
    const outcome: TransactionOutcome =
      phase === "draft" ? "pending" : row.success ? "succeeded" : "failed";

    // A deleted record has no page left to open, and neither has a record whose
    // table we could not identify.
    const isGone = operation === "delete" && outcome === "succeeded";
    const href =
      table.startsWith("bus_") && row.entity_id && !isGone
        ? `/${this.entitySlug(table)}/${row.entity_id}`
        : null;

    return {
      id: row.id,
      at: new Date(row.timestamp).toISOString(),
      read: row.read_at !== null && row.read_at !== undefined,
      outcome,
      phase,
      operation,
      entityTable: table,
      entityLabel,
      recordId: row.entity_id,
      recordLabel,
      title: this.title(entityLabel, recordLabel, phase, operation, outcome),
      detail: this.detail(phase, operation, outcome, row.error_message),
      href,
    };
  }

  /** The operation is stored in `changed_fields`, which the two writers set to it. */
  private operationOf(changedFields: string[] | null): TransactionNotification["operation"] {
    const first = changedFields?.[0];
    return first === "create" || first === "update" || first === "delete" ? first : "save";
  }

  private title(
    entityLabel: string,
    recordLabel: string,
    phase: "draft" | "finalize",
    operation: TransactionNotification["operation"],
    outcome: TransactionOutcome
  ): string {
    const subject = `${entityLabel} “${recordLabel}”`;

    if (phase === "draft") {
      if (operation === "delete") return `${subject} — delete in progress`;
      return `${subject} saved as a draft`;
    }

    if (outcome === "succeeded") {
      if (operation === "delete") return `${subject} was deleted`;
      return `${subject} is now final`;
    }

    if (operation === "delete") return `${subject} could not be deleted`;
    return `${subject} could not be finalised`;
  }

  private detail(
    phase: "draft" | "finalize",
    operation: TransactionNotification["operation"],
    outcome: TransactionOutcome,
    errorMessage: string | null
  ): string {
    if (phase === "draft") {
      if (operation === "delete") {
        return "The delete was accepted. Its workflows are running now — the record is removed once they finish.";
      }
      return (
        "Your changes are saved. The record's business rules and workflows are running now, " +
        "and it becomes final once they all pass."
      );
    }

    if (outcome === "succeeded") {
      if (operation === "delete") return "Every workflow the delete had to run completed.";
      return "Every business rule and workflow passed, so the record is final.";
    }

    return (
      errorMessage?.trim() ||
      "The record was kept as a draft. Open it to see what needs correcting, then save again."
    );
  }

  private titleCase(slug: string): string {
    return slug
      .split("-")
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }
}
