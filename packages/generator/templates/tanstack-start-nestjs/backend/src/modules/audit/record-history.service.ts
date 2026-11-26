import { ForbiddenException, Inject, Injectable, } from "@nestjs/common";
import { type Kysely, sql } from "kysely";
import { KYSELY_CONNECTION } from "../../database/database.constants";
import { getLogger } from "../../common/logging/logger.service";

/**
 * One record's history, and the notes people have left on it.
 *
 * Both surfaces are *per record* and both are scoped to the entity the record
 * belongs to, which is what separates them from `AuditController`. That
 * controller serves the whole log — every table, every sign-in attempt, the
 * before and after of every changed field — and is administrator-only for
 * exactly that reason. Narrowed to one record of one table, the same data is
 * simply what happened to something the caller is already looking at, so the
 * gate is the entity's own `read` rather than an admin role. A trail only
 * administrators can see is a trail nobody consults.
 *
 * Notes are kept in `sys_note` rather than in the audit log. The trail records
 * what the system observed and must not be editable; a note is somebody's
 * sentence about the same record. One table for both would make the history
 * writable, which is the one thing an audit trail may not be.
 */
@Injectable()
export class RecordHistoryService {

  constructor(@Inject(KYSELY_CONNECTION) private readonly kysely: Kysely<any>) {}

  /**
   * Refuse unless the caller's roles may perform `operation` on the entity.
   *
   * Mirrors `EntityAccessGuard`: restrictions live in `sys_operation_access`, a
   * target with no rows is open to any authenticated caller, and a master role
   * bypasses. A failed lookup means "no rules" rather than "deny", so an
   * application whose database predates the table keeps serving.
   */
  async assertAccess(user: any, entity: string, operation: "read" | "update"): Promise<void> {
    const tableName = this.getTableName(entity);

    let allowedRoles: string[];
    try {
      const rows = await this.kysely
        .selectFrom("sys_operation_access")
        .select("role_name")
        .where("table_name", "=", tableName)
        .where("operation", "=", operation)
        .where("is_active", "=", true)
        .execute();
      allowedRoles = rows.map((row: any) => row.role_name);
    } catch (error: any) {
      getLogger("audit").event("audit.history.degraded", {
        reason: `Operation access lookup failed for ${tableName}.${operation}: ${error?.message ?? error}`,
      });
      return;
    }

    if (allowedRoles.length === 0) return;
    if (user?.isMaster === true) return;

    const held = this.rolesOf(user);
    const heldFolded = new Set(held.map((role) => role.toLowerCase()));
    if (allowedRoles.some((role) => heldFolded.has(role.toLowerCase()))) return;

    throw new ForbiddenException(
      `Access denied. "${operation}" on "${tableName}" requires one of: ` +
        `${allowedRoles.join(", ")}. Your roles: ${held.join(", ") || "none"}.`,
    );
  }

  /**
   * What has been done to one record, newest first.
   *
   * `entity_type` in the log is the route segment the interceptor saw, so it is
   * matched against the segment rather than the table name — the two differ
   * (`invoice-line` against `bus_invoice_line`) and matching the wrong one
   * returns an empty trail for every record, forever, with nothing to say so.
   */
  async historyFor(entity: string, recordId: string, limit = 50) {
    const rows = await this.kysely
      .selectFrom("audit_log")
      .select([
        "id",
        "timestamp",
        "user_name",
        "user_email",
        "action",
        "changed_fields",
        "before_value",
        "after_value",
        "success",
        "error_message",
      ])
      .where("entity_type", "=", entity)
      .where("entity_id", "=", String(recordId))
      .orderBy("timestamp", "desc")
      .limit(limit)
      .execute();

    /* Column names, not a re-spelling of them. The one consumer is the trail at
       the foot of the record screen, which was written against `audit_log`; a
       second vocabulary here would buy nothing and cost a rename in the JSX. */
    return rows.map((row: any) => ({
      id: row.id,
      timestamp: row.timestamp,
      user_name: row.user_name,
      user_email: row.user_email,
      action: row.action,
      changed_fields: this.asArray(row.changed_fields),
      before_value: this.asObject(row.before_value),
      after_value: this.asObject(row.after_value),
      success: row.success !== false,
      error_message: row.error_message,
    }));
  }

  async notesFor(entity: string, recordId: string, limit = 100) {
    const rows = await this.kysely
      .selectFrom("sys_note")
      .select(["sys_note_id", "note", "user_name", "user_email", "created_at"])
      .where("table_name", "=", this.getTableName(entity))
      .where("record_id", "=", String(recordId))
      .orderBy("created_at", "desc")
      .limit(limit)
      .execute();

    return rows.map((row: any) => ({
      id: row.sys_note_id,
      note: row.note,
      userName: row.user_name,
      userEmail: row.user_email,
      at: row.created_at,
    }));
  }

  /** Append-only: there is no update path and no delete path, by design. */
  async addNote(entity: string, recordId: string, note: string, user: any) {
    const row = await this.kysely
      .insertInto("sys_note")
      .values({
        table_name: this.getTableName(entity),
        record_id: String(recordId),
        note,
        user_id: user?.id ?? null,
        user_name: user?.name ?? user?.username ?? null,
        user_email: user?.email ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return {
      id: (row as any).sys_note_id,
      note: (row as any).note,
      userName: (row as any).user_name,
      userEmail: (row as any).user_email,
      at: (row as any).created_at,
    };
  }

  /**
   * `changed_fields` is `TEXT[]`, which the driver hands back as an array — but
   * a build that stored it as JSON hands back a string. Accepting both is what
   * stops the list silently arriving empty and every entry reading as though
   * nothing had changed.
   */
  private asArray(value: unknown): string[] {
    if (Array.isArray(value)) return value as string[];
    if (typeof value !== "string") return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private asObject(value: unknown): Record<string, unknown> | null {
    if (value == null) return null;
    if (typeof value === "object") return value as Record<string, unknown>;
    if (typeof value !== "string") return null;
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  private rolesOf(user: any): string[] {
    const roles = user?.roles ?? user?.role ?? [];
    if (Array.isArray(roles)) {
      return roles
        .map((role: any) => (typeof role === "string" ? role : role?.name))
        .filter((role: any): role is string => typeof role === "string");
    }
    return typeof roles === "string" ? [roles] : [];
  }

  /** Deliberate copy of BusService.getTableName — the same rule, stated twice. */
  private getTableName(entity: string): string {
    const normalized = entity.toLowerCase().replace(/-/g, "_");
    if (normalized.startsWith("bus_")) return normalized;
    return `bus_${this.singularize(normalized)}`;
  }

  private singularize(word: string): string {
    if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
    if (
      word.endsWith("ses") ||
      word.endsWith("xes") ||
      word.endsWith("zes") ||
      word.endsWith("ches") ||
      word.endsWith("shes")
    ) {
      return word.slice(0, -2);
    }
    if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
    return word;
  }
}
