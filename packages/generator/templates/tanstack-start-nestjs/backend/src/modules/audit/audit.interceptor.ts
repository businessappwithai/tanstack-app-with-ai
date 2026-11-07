import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import { type Observable, throwError } from "rxjs";
import { catchError, tap } from "rxjs/operators";
import { AuditService } from "./audit.service";
import type { AuditEvent, AuditSource } from "./audit.types";
import { diffFields } from "./audit.types";

/** Methods that mutate data. Always audited. */
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Audit reads as well as writes.
 *
 * Off by default: every list and detail view would land in the table, and on a
 * busy app the reads bury the changes. Turn it on where the regime requires
 * proof of who looked at what (GxP, HIPAA, SOX) and budget for the volume.
 */
const AUDIT_READS = process.env.AUDIT_READS === "true";

/**
 * What each API surface is, for the audit trail.
 *
 * Anything not listed is still audited under its first path segment — a new
 * module is recorded from the day it ships rather than silently missing until
 * someone remembers to add it here. Ordered longest-prefix first so
 * `/sys/roles` does not match as plain `sys`.
 */
const RESOURCES: Array<{ prefix: RegExp; resource: string; subject: string }> = [
  { prefix: /^\/?api\/auth\b/, resource: "auth", subject: "AUTH" },
  { prefix: /^\/?bus\/([^/?]+)/, resource: "", subject: "ENTITY" },
  { prefix: /^\/?sys\/roles\b/, resource: "sys/roles", subject: "ROLE" },
  { prefix: /^\/?sys\/user-roles\b/, resource: "sys/user-roles", subject: "ROLE_ASSIGNMENT" },
  { prefix: /^\/?sys\/users\b/, resource: "sys/users", subject: "USER" },
  { prefix: /^\/?sys\/access\b/, resource: "sys/access", subject: "PERMISSION" },
  { prefix: /^\/?sys\b/, resource: "sys", subject: "DICTIONARY" },
  { prefix: /^\/?rules\b/, resource: "rules", subject: "RULE" },
  { prefix: /^\/?workflow-definitions\b/, resource: "workflow-definitions", subject: "WORKFLOW" },
  { prefix: /^\/?workflows\b/, resource: "workflows", subject: "WORKFLOW_RUN" },
  { prefix: /^\/?jobs\b/, resource: "jobs", subject: "JOB" },
  { prefix: /^\/?api\/ai\b/, resource: "api/ai", subject: "AI" },
  { prefix: /^\/?me\b/, resource: "me", subject: "PROFILE" },
];

/** Paths that would audit themselves into a loop, or say nothing worth keeping. */
const IGNORED = [/^\/?audit\b/, /^\/?health\b/, /^\/?v1\/shape\b/, /^\/?favicon/];

/** Verb suffix for an action name. */
function verbFor(method: string): string {
  if (method === "DELETE") return "DELETE";
  if (method === "POST") return "CREATE";
  if (method === "PUT" || method === "PATCH") return "UPDATE";
  return "READ";
}

export interface AuditTarget {
  /** Recorded as `entity_type` — the thing acted on. */
  entityType: string;
  /** Recorded as `action`, e.g. `RULE_UPDATE`. */
  action: string;
}

/**
 * Classify a request into what the audit page shows.
 *
 * Returns null only for paths in IGNORED. Everything else is recorded: a trail
 * that quietly omits business rule edits, role grants or logins is not an audit
 * trail, and those were exactly the paths the old `/bus/` and `/sys/` match
 * dropped on the floor.
 */
export function classifyRequest(path: string, method: string): AuditTarget | null {
  const clean = (path.split("?")[0] ?? "").replace(/^\/api\//, "/");
  if (IGNORED.some((re) => re.test(clean))) return null;

  const verb = verbFor(method);

  for (const { prefix, resource, subject } of RESOURCES) {
    const match = clean.match(prefix);
    if (!match) continue;
    // `/bus/:entity` records the entity itself, so the trail reads
    // `bus_compound` rather than a uniform `bus`.
    const entityType = resource || match[1] || "bus";
    return { entityType, action: `${subject}_${verb}` };
  }

  // Unknown surface: record it under its first segment rather than lose it.
  const segment = clean.replace(/^\//, "").split("/")[0] || "root";
  return { entityType: segment, action: `${segment.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_${verb}` };
}

function resolveEntityId(params: Record<string, string>): string | null {
  return params?.id ?? params?.entityId ?? null;
}

/**
 * Response envelope keys that describe the request rather than the record.
 * Bus mutations append a `promotion` report from the rules engine; leaving it in
 * makes every update look like it changed a `promotion` column that does not
 * exist, and stores a copy of the report in the audit trail.
 */
const ENVELOPE_KEYS = new Set(["promotion", "meta", "workflow", "rules"]);

/** Strip envelope keys so before/after hold the record and nothing else. */
function recordOnly(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!ENVELOPE_KEYS.has(k)) out[k] = v;
  }
  return out;
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {

  constructor(private readonly auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const req = http.getRequest();
    const method: string = req.method?.toUpperCase() ?? "";

    const mutating = MUTATING_METHODS.has(method);
    if (!mutating && !AUDIT_READS) return next.handle();

    const path: string = req.url ?? req.path ?? "";
    const target = classifyRequest(path, method);
    if (!target) return next.handle();

    const user = req.user;
    const params = req.params ?? {};
    const headers = req.headers ?? {};

    const base: Partial<AuditEvent> = {
      user_id: user?.id ?? null,
      user_name: user?.name ?? null,
      user_email: user?.email ?? null,
      session_id: req.session?.session?.id ?? null,
      entity_type: target.entityType,
      entity_id: resolveEntityId(params),
      action: target.action,
      ip_address:
        (headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
        req.socket?.remoteAddress ??
        null,
      user_agent: (headers["user-agent"] as string) ?? null,
      source: (headers["x-source"] as AuditSource) ?? "WEB_UI",
      request_id: (headers["x-request-id"] as string) ?? null,
    };

    return next.handle().pipe(
      tap((responseData: any) => {
        // Read __auditBefore here (after handler ran) — controller sets it before its mutation
        const beforeValue = recordOnly(req.__auditBefore);
        const after = recordOnly(responseData?.data ?? responseData);
        const changed = diffFields(beforeValue, after);
        // For POST (CREATE), extract entity_id from the response body
        const entityId = base.entity_id ?? (after?.id as string | undefined) ?? null;
        this.auditService.log({
          ...base,
          entity_id: entityId,
          before_value: beforeValue,
          after_value: method === "DELETE" ? null : after,
          changed_fields: changed,
          success: true,
        } as AuditEvent);
      }),
      catchError((err) => {
        const beforeValue = recordOnly(req.__auditBefore);
        this.auditService.log({
          ...base,
          before_value: beforeValue,
          after_value: null,
          changed_fields: [],
          success: false,
          error_message: err?.message ?? String(err),
        } as AuditEvent);
        return throwError(() => err);
      })
    );
  }
}
