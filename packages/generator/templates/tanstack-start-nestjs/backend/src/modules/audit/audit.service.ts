import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { randomUUID } from "crypto";
import { type Kysely, sql } from "kysely";
import { KYSELY_CONNECTION } from "../../database/database.constants";
import type { AuditEvent, AuditSearchParams } from "./audit.types";
import { maskSensitive } from "./audit.types";
import { ImmudbService } from "./immudb.service";
import { getLogger } from "../../common/logging/logger.service";

@Injectable()
export class AuditService implements OnModuleInit {

  constructor(
    @Inject(KYSELY_CONNECTION) private readonly kysely: Kysely<any>,
    private readonly immudb: ImmudbService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureTable();
  }

  /** Ensure audit_log table exists (idempotent). */
  private async ensureTable(): Promise<void> {
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS audit_log (
          id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
          immudb_key        VARCHAR(200),
          timestamp         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          user_id           VARCHAR(200),
          user_name         VARCHAR(200),
          user_email        VARCHAR(200),
          session_id        VARCHAR(200),
          action            VARCHAR(100) NOT NULL,
          entity_type       VARCHAR(100),
          entity_id         VARCHAR(200),
          before_value      JSONB,
          after_value       JSONB,
          changed_fields    TEXT[]       DEFAULT '{}',
          ip_address        VARCHAR(45),
          user_agent        TEXT,
          source            VARCHAR(50)  DEFAULT 'WEB_UI',
          success           BOOLEAN      NOT NULL DEFAULT TRUE,
          error_message     TEXT,
          request_id        VARCHAR(200),
          correlation_id    VARCHAR(200),
          created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )
      `.execute(this.kysely);

      await sql`CREATE INDEX IF NOT EXISTS idx_audit_timestamp   ON audit_log (timestamp DESC)`.execute(
        this.kysely
      );
      await sql`CREATE INDEX IF NOT EXISTS idx_audit_user_id     ON audit_log (user_id)`.execute(
        this.kysely
      );
      await sql`CREATE INDEX IF NOT EXISTS idx_audit_action      ON audit_log (action)`.execute(
        this.kysely
      );
      await sql`CREATE INDEX IF NOT EXISTS idx_audit_entity_type ON audit_log (entity_type)`.execute(
        this.kysely
      );
      await sql`CREATE INDEX IF NOT EXISTS idx_audit_entity_id   ON audit_log (entity_id)`.execute(
        this.kysely
      );
      await sql`CREATE INDEX IF NOT EXISTS idx_audit_success     ON audit_log (success)`.execute(
        this.kysely
      );

      getLogger("audit").event("audit.ready", { store: "audit_log" });
    } catch (err) {
      getLogger("audit").event("audit.write.failed", { store: "audit_log table", err });
    }
  }

  /** Fill in the derived fields every stored event carries. */
  private prepare(event: AuditEvent): AuditEvent & { id: string; immudb_key: string } {
    const id = randomUUID();
    return {
      ...event,
      id,
      timestamp: new Date().toISOString(),
      before_value: maskSensitive(event.before_value ?? null),
      after_value: maskSensitive(event.after_value ?? null),
      changed_fields: event.changed_fields ?? [],
      success: event.success ?? true,
      source: event.source ?? "WEB_UI",
      immudb_key: `audit:${Date.now()}:${id}`,
    } as AuditEvent & { id: string; immudb_key: string };
  }

  /**
   * Log an audit event. Non-blocking — failures are logged but do not
   * throw so they never break the business operation being audited.
   */
  async log(event: AuditEvent): Promise<void> {
    const safeEvent = this.prepare(event);

    // Fire-and-forget immudb write (non-blocking)
    setImmediate(async () => {
      try {
        const txId = await this.immudb.verifiedSet(safeEvent.immudb_key, JSON.stringify(safeEvent));
        const resolvedKey = txId !== safeEvent.immudb_key ? txId : safeEvent.immudb_key;
        await this.insertPostgres({ ...safeEvent, immudb_key: resolvedKey });
      } catch (err) {
        getLogger("audit").event("audit.write.failed", { store: "postgres", err });
        await this.insertPostgres(safeEvent).catch((e) =>
          getLogger("audit").event("audit.write.failed", { store: "postgres fallback", err: e })
        );
      }
    });
  }

  /**
   * Log an audit event and wait for it to be stored.
   *
   * `log` defers its write to `setImmediate`, which is right inside an HTTP
   * request — the response should not wait on the trail — and wrong inside a
   * background task, where the process can be torn down the moment the task
   * returns and take the pending write with it. The record-transaction events
   * are the user's only notification that their save finished, so those are
   * written on this path instead: Postgres first and awaited, then the immudb
   * proof best-effort behind it.
   *
   * Returns the stored row's id so a caller can correlate the two halves of a
   * transaction. Never throws — a trail that breaks the operation it records is
   * worse than a gap in the trail.
   */
  async logAndWait(event: AuditEvent): Promise<string | null> {
    const safeEvent = this.prepare(event);

    try {
      await this.insertPostgres(safeEvent);
    } catch (err) {
      getLogger("audit").event("audit.write.failed", { store: "postgres", err });
      return null;
    }

    setImmediate(async () => {
      try {
        const txId = await this.immudb.verifiedSet(safeEvent.immudb_key, JSON.stringify(safeEvent));
        if (txId && txId !== safeEvent.immudb_key) {
          await this.kysely
            .updateTable("audit_log" as any)
            .set({ immudb_key: txId } as any)
            .where("id" as any, "=", safeEvent.id)
            .execute();
        }
      } catch (err) {
        getLogger("audit").event("audit.immudb.failed", { operation: "proof", err });
      }
    });

    return safeEvent.id;
  }

  private async insertPostgres(
    event: AuditEvent & { id: string; immudb_key?: string }
  ): Promise<void> {
    await this.kysely
      .insertInto("audit_log" as any)
      .values({
        id: event.id,
        immudb_key: event.immudb_key ?? null,
        timestamp: event.timestamp ?? new Date().toISOString(),
        user_id: event.user_id ?? null,
        user_name: event.user_name ?? null,
        user_email: event.user_email ?? null,
        session_id: event.session_id ?? null,
        action: event.action,
        entity_type: event.entity_type ?? null,
        entity_id: event.entity_id ?? null,
        before_value: event.before_value ? JSON.stringify(event.before_value) : null,
        after_value: event.after_value ? JSON.stringify(event.after_value) : null,
        changed_fields: event.changed_fields ?? [],
        ip_address: event.ip_address ?? null,
        user_agent: event.user_agent ?? null,
        source: event.source ?? "WEB_UI",
        success: event.success ?? true,
        error_message: event.error_message ?? null,
        request_id: event.request_id ?? null,
        correlation_id: event.correlation_id ?? null,
      } as any)
      .execute();
  }

  /**
   * Search audit log with filters. Returns paginated results from PostgreSQL.
   */
  async search(
    params: AuditSearchParams
  ): Promise<{ data: AuditEvent[]; meta: { total: number; page: number; limit: number } }> {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(500, Math.max(1, params.limit ?? 50));
    const offset = (page - 1) * limit;

    let query = this.kysely.selectFrom("audit_log" as any).selectAll();
    let countQuery = this.kysely
      .selectFrom("audit_log" as any)
      .select((eb) => eb.fn.countAll<string>().as("total"));

    const applyFilters = (q: any) => {
      if (params.from) q = q.where("timestamp", ">=", params.from);
      if (params.to) q = q.where("timestamp", "<=", params.to);
      if (params.user_id) q = q.where("user_id", "=", params.user_id);
      if (params.user_email) q = q.where("user_email", "ilike", `%${params.user_email}%`);
      if (params.action) q = q.where("action", "=", params.action);
      if (params.entity_type) q = q.where("entity_type", "=", params.entity_type);
      if (params.entity_id) q = q.where("entity_id", "=", params.entity_id);
      if (params.source) q = q.where("source", "=", params.source);
      if (params.success !== undefined) q = q.where("success", "=", params.success);
      if (params.search) {
        const term = `%${params.search}%`;
        q = q.where((eb: any) =>
          eb.or([
            eb("user_email", "ilike", term),
            eb("user_name", "ilike", term),
            eb("entity_type", "ilike", term),
            eb("entity_id", "ilike", term),
            eb("action", "ilike", term),
          ])
        );
      }
      return q;
    };

    query = applyFilters(query).orderBy("timestamp", "desc").limit(limit).offset(offset);
    countQuery = applyFilters(countQuery);

    const [rows, countResult] = await Promise.all([query.execute(), countQuery.executeTakeFirst()]);

    return {
      data: rows as AuditEvent[],
      meta: { total: parseInt(String(countResult?.total ?? 0), 10), page, limit },
    };
  }

  /**
   * Verify a single audit record against immudb.
   * Returns { verified: true } when the stored value matches and proof is valid.
   */
  async verify(id: string): Promise<{
    verified: boolean;
    immudb_key?: string;
    txId?: string | number;
    mismatch?: boolean;
    reason?: string;
  }> {
    const row = await this.kysely
      .selectFrom("audit_log" as any)
      .selectAll()
      .where("id" as any, "=", id)
      .executeTakeFirst();

    if (!row) return { verified: false, reason: "Record not found" };
    if (!(row as any).immudb_key)
      return { verified: false, reason: "No immudb key stored for this record" };

    if (!this.immudb.isConnected) {
      return { verified: false, reason: "immudb not connected" };
    }

    const result = await this.immudb.verifiedGet((row as any).immudb_key);
    if (!result) return { verified: false, reason: "immudb lookup failed" };

    if (!result.verified)
      return {
        verified: false,
        immudb_key: result.key,
        txId: result.txId,
        reason: "Cryptographic proof failed — data may be tampered",
      };

    // Optionally compare stored JSON to what's in PG for a content match
    try {
      const storedEvent = JSON.parse(result.value ?? "{}");
      const pgEvent = row as any;
      if (storedEvent.action !== pgEvent.action || storedEvent.entity_id !== pgEvent.entity_id) {
        return {
          verified: false,
          immudb_key: result.key,
          txId: result.txId,
          mismatch: true,
          reason: "Content mismatch between immudb and PostgreSQL",
        };
      }
    } catch {
      // If parse fails, still return the immudb verification result
    }

    return { verified: true, immudb_key: result.key, txId: result.txId };
  }

  /** Return distinct entity_type values for the filter dropdown. */
  async getEntityTypes(): Promise<string[]> {
    const rows = await this.kysely
      .selectFrom("audit_log" as any)
      .select("entity_type")
      .distinct()
      .where("entity_type", "is not", null)
      .orderBy("entity_type", "asc")
      .execute();
    return rows.map((r: any) => r.entity_type).filter(Boolean);
  }
}
