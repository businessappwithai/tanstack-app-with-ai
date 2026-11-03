import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ExternalLink, FilePlus2, FileX2, History, Home, MessageSquare, Pencil, Star } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ReportPrintModal } from "@/components/reports/ReportPrintModal";
import { toast } from "sonner";
import { DynamicForm } from "@/components/forms/dynamic-form";
import { DynamicTable } from "@/components/tables/dynamic-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type FieldMetadata, useEntityMetadata } from "@/hooks/use-entities";
import { apiClient, type PaginatedResponse } from "@/lib/api-client";
import {
  type AnyRecord as ConflictRecord,
  type ConflictField,
  changedByOthers,
  ifMatchHeader,
  isVersionConflict,
} from "@/lib/version-conflict";
import { ADRecordNav } from "./ad-record-nav";
import { ADToolbar } from "./ad-toolbar";
import {
  type ADChildTabConfig,
  type ADLevel,
  buildAdminDetailUrl,
  buildAdminListUrl,
  type ParentContext,
} from "./ad-window-configs";
import { LifecycleBadge } from "./lifecycle-badge";
import { RecordActions } from "./record-actions";
import { isLocked, lifecycleOf, phaseOf } from "@/lib/lifecycle";
import { pluralLabel } from "@/lib/plural-label";
import { useLifecycles } from "@/lib/use-lifecycles";
import { VersionConflictDialog } from "./version-conflict-dialog";
import { helpTableNameFromEndpoint, WindowHelpButton } from "./window-help-button";
import { format } from "date-fns";

type AnyRecord = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Inline child tab panel
// Row clicks navigate to the child's detail URL (metadata-derived)
// ---------------------------------------------------------------------------

/** Cache identity of a breadcrumb ancestor — one fetch per endpoint+id. */
function parentKey({ level, id }: ParentContext): string {
  return `${level.endpoint}|${id}`;
}

/** Collapse repeated ancestors so useQueries never receives a duplicate key. */
function dedupeParents(parentCtx: ParentContext[]): ParentContext[] {
  const seen = new Set<string>();
  return parentCtx.filter((p) => {
    const key = parentKey(p);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

interface ChildPanelProps {
  childTab: ADChildTabConfig;
  parentRecord: AnyRecord;
  selfLevel: ADLevel;
  parentContext: ParentContext[];
}

function ChildPanel({ childTab, parentRecord, selfLevel, parentContext }: ChildPanelProps) {
  const navigate = useNavigate();
  const childLevel = childTab.level;
  const parentId = parentRecord[selfLevel.idField] as string;

  // Context for child-level URLs includes all ancestors + this record
  const childParentCtx: ParentContext[] = [...parentContext, { level: selfLevel, id: parentId }];

  const params: Record<string, unknown> = { limit: 100 };
  if (childLevel.parentField) params[childLevel.parentField] = parentId;

  const { data, isLoading } = useQuery({
    queryKey: ["ad-child", childLevel.endpoint, parentId],
    queryFn: () => apiClient.get<PaginatedResponse<AnyRecord>>(childLevel.endpoint, params),
    enabled: !!parentId,
  });

  const records = data?.data ?? [];
  const totalCount = data?.meta?.total ?? 0;

  // A line is created where it is read: inside its parent's tab, with the
  // reference to the parent filled in and hidden. The detail toolbar's New
  // belongs to the parent level, so without this a child could only be added
  // by leaving the record for the child's own list.
  const queryClient = useQueryClient();
  const [isCreating, setIsCreating] = useState(false);
  const [createErrors, setCreateErrors] = useState<string[]>([]);
  const parentLink: AnyRecord = childLevel.parentField
    ? { [childLevel.parentField]: parentId }
    : {};

  const createMutation = useMutation({
    mutationFn: (formData: AnyRecord) =>
      apiClient.post<AnyRecord>(childLevel.endpoint, { ...formData, ...parentLink }),
    onSuccess: () => {
      toast.success(`${childLevel.label} created`);
      queryClient.invalidateQueries({ queryKey: ["ad-child", childLevel.endpoint, parentId] });
      queryClient.invalidateQueries({
        queryKey: ["ad-child-count", childLevel.endpoint, parentId],
      });
      queryClient.invalidateQueries({ queryKey: ["ad-list", childLevel.endpoint] });
      setIsCreating(false);
      setCreateErrors([]);
    },
    onError: (err: any) => {
      const specific = Array.isArray(err?.errors) ? (err.errors as string[]) : null;
      const fallback = Array.isArray(err?.message)
        ? err.message.join(", ")
        : (err?.message ?? "Failed to create");
      setCreateErrors(specific ?? [fallback]);
      toast.error(specific?.[0] ?? fallback);
    },
  });

  return (
    <div>
      {/* Child list link */}
      <div className="px-4 pt-3 pb-1 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {totalCount} {childLevel.label}
          {totalCount !== 1 ? "s" : ""}
        </span>
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant={isCreating ? "ghost" : "outline"}
            className="h-7 gap-1 text-xs"
            onClick={() => {
              setIsCreating((open) => !open);
              setCreateErrors([]);
            }}
          >
            {isCreating ? (
              "Cancel"
            ) : (
              <>
                <FilePlus2 className="h-3.5 w-3.5" /> New {childLevel.label}
              </>
            )}
          </Button>
          <Link
            to={buildAdminListUrl(childParentCtx, childLevel) as never}
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            View all <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </div>
      {isCreating && (
        <div className="mx-4 mt-2 rounded-md border border-border bg-muted/20 p-4">
          <DynamicForm
            tableName={childLevel.id}
            idField={childLevel.idField}
            fields={childLevel.formFields}
            initialData={parentLink}
            parentField={childLevel.parentField}
            parentContext={parentRecord}
            onSubmit={(fd) => createMutation.mutate(fd)}
            mode="create"
            isSaving={createMutation.isPending}
          />
          {createErrors.length > 0 && (
            <div className="mt-3 rounded-md border border-destructive/50 bg-destructive/10 p-3">
              <p className="text-sm font-medium text-destructive mb-1">Validation failed</p>
              <ul className="text-xs text-destructive/90 space-y-0.5 list-disc list-inside">
                {createErrors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      <div className="p-4">
        <DynamicTable
          tableName={childLevel.id}
          fields={childLevel.gridFields || childLevel.formFields}
          data={records}
          isLoading={isLoading}
          totalCount={totalCount}
          page={1}
          pageSize={100}
          onPageChange={() => {}}
          onRowClick={(row) => {
            const childId = String(row[childLevel.idField]);
            navigate({ to: buildAdminDetailUrl(childParentCtx, childLevel, childId) as never });
          }}
        />
      </div>
    </div>
  );
}

// Child tab trigger with live count badge
function ChildTabTrigger({
  childTab,
  parentId,
  isActive,
}: {
  childTab: ADChildTabConfig;
  parentId: string;
  isActive: boolean;
}) {
  const childLevel = childTab.level;
  const params: Record<string, unknown> = { limit: 1 };
  if (childLevel.parentField) params[childLevel.parentField] = parentId;

  const { data } = useQuery({
    queryKey: ["ad-child-count", childLevel.endpoint, parentId],
    queryFn: () => apiClient.get<PaginatedResponse<AnyRecord>>(childLevel.endpoint, params),
    enabled: !!parentId && childTab.badge === "count",
  });

  return (
    <TabsTrigger
      value={childTab.id}
      className={`rounded-none border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
        isActive
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {childTab.label}
      {data?.meta?.total !== undefined && (
        <Badge variant="secondary" className="ml-2 h-5 min-w-[20px] px-1.5 text-xs">
          {data.meta.total}
        </Badge>
      )}
    </TabsTrigger>
  );
}

// ---------------------------------------------------------------------------
// ADDetailShell
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Summary Panel — shows highlight fields in the entity detail header
// ---------------------------------------------------------------------------

function SummaryRefValue({ field, id }: { field: FieldMetadata; id: string }) {
  const refTableFull = field.ref_table_name ?? "";
  const entity = refTableFull.startsWith("bus_") ? refTableFull.slice(4) : refTableFull;
  const { data } = useQuery({
    queryKey: ["summary-ref", refTableFull, id],
    queryFn: () => apiClient.get<AnyRecord>(`/bus/${entity}/${id}`),
    enabled: !!entity && !!id,
    staleTime: 30_000,
  });

  if (!data) return <span className="text-muted-foreground/60 text-xs italic">—</span>;

  const displayValue: string = data.first_name
    ? `${String(data.first_name ?? "")} ${String(data.last_name ?? "")}`.trim()
    : data.name != null
      ? String(data.name)
      : id.slice(0, 8) + "…";

  return <span>{displayValue}</span>;
}

function SummaryFieldValue({ field, record }: { field: FieldMetadata; record: AnyRecord }) {
  const value = record[field.column_name];

  if (value === null || value === undefined || value === "") {
    return <span className="text-muted-foreground/60 italic">—</span>;
  }

  if (typeof value === "boolean") return <span>{value ? "Yes" : "No"}</span>;

  // dd/MM/yyyy everywhere, as in the grid and the record form — not
  // `toLocaleDateString`, which follows the runtime's locale and so disagreed
  // with the screen the reader just came from.
  if (field.sys_reference_id === 15) {
    const d = new Date(String(value));
    if (!isNaN(d.getTime())) return <span>{format(d, "dd/MM/yyyy")}</span>;
  }

  if (field.sys_reference_id === 16) {
    const d = new Date(String(value));
    if (!isNaN(d.getTime())) return <span>{format(d, "dd/MM/yyyy HH:mm:ss")}</span>;
  }

  if (field.sys_reference_id === 18 || field.sys_reference_id === 19) {
    return <SummaryRefValue field={field} id={String(value)} />;
  }

  return <span>{String(value)}</span>;
}

function SummaryPanel({ fields, record }: { fields: FieldMetadata[]; record: AnyRecord }) {
  if (!fields.length) return null;
  return (
    <div className="flex-shrink-0 bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200/80 dark:border-amber-800/60 rounded-xl p-3 min-w-[200px] max-w-[340px] self-start">
      <div className="flex items-center gap-1.5 mb-2 pb-1.5 border-b border-amber-200/60 dark:border-amber-800/60">
        <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-400" />
        <span className="text-xs font-semibold text-amber-700 dark:text-amber-300 uppercase tracking-wide">
          Highlights
        </span>
      </div>
      <div className="space-y-1.5">
        {fields.map((f) => (
          <div key={f.sys_field_id} className="flex items-baseline gap-2 min-w-0">
            <span className="text-[10px] text-amber-600/70 dark:text-amber-400 font-medium shrink-0 uppercase tracking-wide">
              {f.name}
            </span>
            <span className="text-sm font-semibold text-foreground truncate flex-1 text-right">
              <SummaryFieldValue field={f} record={record} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Notes on a record — what a person wanted to say about it
// ---------------------------------------------------------------------------

interface RecordNote {
  id: string;
  note: string;
  userName?: string | null;
  userEmail?: string | null;
  at: string;
}

/**
 * Notes sit above the audit trail, and the order is the argument.
 *
 * The trail records what the system observed and must not be editable; a note
 * is somebody's sentence about the same record. Keeping them in one list would
 * make the history writable, which is the one thing an audit trail may not be —
 * so they are two sections, two tables, and only the note is something a person
 * chose to write.
 *
 * A note cannot be edited or deleted once left. That is not an omission: a note
 * somebody can quietly rewrite is worth about as much as a conversation nobody
 * remembers.
 */
function EntityNotes({ entityType, recordId }: { entityType: string; recordId: string }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["entity-notes", entityType, recordId],
    queryFn: () =>
      apiClient.get<{ data: RecordNote[] }>(`/records/${entityType}/${recordId}/notes`),
    staleTime: 30_000,
    retry: false,
  });

  const addNote = useMutation({
    mutationFn: (note: string) =>
      apiClient.post<RecordNote>(`/records/${entityType}/${recordId}/notes`, { note }),
    onSuccess: () => {
      setDraft("");
      queryClient.invalidateQueries({ queryKey: ["entity-notes", entityType, recordId] });
      toast.success("Note added");
    },
    onError: (error: any) => {
      toast.error(error?.message ?? "Could not add the note");
    },
  });

  const notes = data?.data ?? [];
  const trimmed = draft.trim();

  return (
    <div className="px-6 py-4 border-t border-border">
      <div className="flex items-center gap-2 mb-3">
        <MessageSquare className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold">Notes</span>
        {notes.length > 0 && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {notes.length}
          </span>
        )}
      </div>

      <div className="flex items-start gap-2 mb-3">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a note about this record…"
          rows={2}
          maxLength={4000}
          className="flex-1 text-sm"
        />
        <Button
          type="button"
          size="sm"
          disabled={!trimmed || addNote.isPending}
          onClick={() => addNote.mutate(trimmed)}
        >
          {addNote.isPending ? "Adding…" : "Add note"}
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-8 w-full" />
      ) : notes.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No notes yet.</p>
      ) : (
        <ol className="space-y-2">
          {notes.map((note) => (
            <li key={note.id} className="rounded-md border border-border bg-muted/10 px-3 py-2">
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-xs font-medium">
                  {note.userName ?? note.userEmail ?? "unknown"}
                </span>
                <time className="text-[11px] text-muted-foreground ml-auto">
                  {new Date(note.at).toLocaleString()}
                </time>
              </div>
              {/* Plain text: a note is whatever somebody typed. */}
              <p className="text-sm whitespace-pre-wrap">{note.note}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entity-level audit trail — compact timeline of changes for this record
// ---------------------------------------------------------------------------

interface AuditEvent {
  id: string;
  timestamp: string;
  user_name?: string;
  user_email?: string;
  action: string;
  changed_fields?: string[];
  before_value?: Record<string, unknown>;
  after_value?: Record<string, unknown>;
  success: boolean;
}

interface AuditResponse {
  data: AuditEvent[];
  meta: { total: number; page: number; limit: number };
}

function auditActionIcon(action: string) {
  if (action === "ENTITY_CREATE") return <FilePlus2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />;
  if (action === "ENTITY_DELETE") return <FileX2 className="h-3.5 w-3.5 text-red-500" />;
  return <Pencil className="h-3.5 w-3.5 text-blue-500" />;
}

function auditActionLabel(action: string): string {
  if (action === "ENTITY_CREATE") return "Created";
  if (action === "ENTITY_DELETE") return "Deleted";
  if (action === "ENTITY_UPDATE") return "Updated";
  return action.replace(/_/g, " ");
}

function EntityAuditTrail({ entityType, recordId }: { entityType: string; recordId: string }) {
  const [expanded, setExpanded] = React.useState<string | null>(null);

  /*
   * `/records/:entity/:id/history`, not `/audit`.
   *
   * The whole audit log is administrator-only and rightly so — it spans every
   * table and carries the before and after of every changed field. This asks
   * only for the record already on screen, gated on that entity's own `read`,
   * so an ordinary user sees the history of the thing they are looking at. On
   * `/audit` they saw nothing at all, which read as "this record has never been
   * touched" rather than "you may not see this".
   */
  const { data, isLoading } = useQuery({
    queryKey: ["entity-audit", entityType, recordId],
    queryFn: () =>
      apiClient.get<AuditResponse>(`/records/${entityType}/${recordId}/history`),
    staleTime: 30_000,
    retry: false,
  });

  const events = data?.data ?? [];

  if (isLoading) {
    return (
      <div className="px-6 py-4 border-t border-border">
        <div className="flex items-center gap-2 mb-3">
          <History className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-muted-foreground">Audit Trail</span>
        </div>
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (events.length === 0) return null;

  return (
    <div className="px-6 py-4 border-t border-border bg-muted/10">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Audit Trail</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {data?.meta?.total ?? events.length}
          </span>
        </div>
      </div>

      <ol className="relative border-l border-border ml-1.5 space-y-0">
        {events.map((event) => {
          const isOpen = expanded === event.id;
          const changedFields = event.changed_fields ?? [];
          const hasDetail =
            changedFields.length > 0 || event.before_value || event.after_value;

          return (
            <li key={event.id} className="ml-4 pb-4">
              {/* dot on the timeline */}
              <span className="absolute -left-[7px] flex h-3.5 w-3.5 items-center justify-center rounded-full bg-background ring-1 ring-border">
                {auditActionIcon(event.action)}
              </span>

              <div className="flex items-start gap-2 flex-wrap">
                <div className="flex-1 min-w-0">
                  <p className="flex items-center gap-2 text-sm">
                    <span className="font-medium">{auditActionLabel(event.action)}</span>
                    {event.user_name || event.user_email ? (
                      <span className="text-muted-foreground text-xs">
                        by {event.user_name ?? event.user_email}
                      </span>
                    ) : null}
                    <time className="text-xs text-muted-foreground ml-auto">
                      {new Date(event.timestamp).toLocaleString(undefined, {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </time>
                  </p>

                  {changedFields.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Changed: {changedFields.join(", ")}
                    </p>
                  )}
                </div>

                {hasDetail && (
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : event.id)}
                    className="text-[11px] text-primary hover:underline shrink-0"
                  >
                    {isOpen ? "Less" : "Details"}
                  </button>
                )}
              </div>

              {isOpen && (event.before_value || event.after_value) && (
                <div className="mt-2 grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="font-semibold text-muted-foreground mb-1">Before</p>
                    <pre className="bg-red-50 dark:bg-red-950/40 border border-red-100 dark:border-red-900/50 rounded p-2 overflow-auto max-h-36 whitespace-pre-wrap text-red-900 dark:text-red-200 text-[11px]">
                      {event.before_value ? JSON.stringify(event.before_value, null, 2) : "—"}
                    </pre>
                  </div>
                  <div>
                    <p className="font-semibold text-muted-foreground mb-1">After</p>
                    <pre className="bg-green-50 dark:bg-green-950/40 border border-green-100 dark:border-green-900/50 rounded p-2 overflow-auto max-h-36 whitespace-pre-wrap text-green-900 dark:text-green-200 text-[11px]">
                      {event.after_value ? JSON.stringify(event.after_value, null, 2) : "—"}
                    </pre>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export interface ADDetailShellProps {
  level: ADLevel;
  recordId: string;
  /** Ancestor levels with their IDs — drives breadcrumbs, URL construction, and sibling filtering */
  parentContext: ParentContext[];
  dashboardHref?: string;
  /** Whether the detail opens in view-only or edit mode. Defaults to 'edit' (admin behaviour).
   *  Set to 'view' for bus entity pages so users see read-only first, then click Edit. */
  initialMode?: "view" | "edit";
}

export function ADDetailShell({
  level,
  recordId,
  parentContext,
  dashboardHref = "/dashboard",
  initialMode = "view",
}: ADDetailShellProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // The status flow as the API runs it, should an administrator have redrawn it.
  useLifecycles();
  const [page, setPage] = useState(1);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [formData, setFormData] = useState<AnyRecord>({});
  const [hasChanges, setHasChanges] = useState(false);
  const [activeChildTab, setActiveChildTab] = useState(() => level.childTabs?.[0]?.id ?? "");
  // The child tabs arrive with the metadata, usually after the first render, so
  // the initial value above is "" and no tab would open. Select the first one
  // once they exist, and again if the current one is no longer among them.
  useEffect(() => {
    const tabs = level.childTabs ?? [];
    if (tabs.length === 0) return;
    if (!tabs.some((ct) => ct.id === activeChildTab)) setActiveChildTab(tabs[0]!.id);
  }, [level.childTabs, activeChildTab]);
  const [isEditing, setIsEditing] = useState(initialMode === "edit");
  const [saveErrors, setSaveErrors] = useState<string[]>([]);
  const [isPrintOpen, setIsPrintOpen] = useState(false);
  // Optimistic locking. `editBase` is the record as it stood when editing
  // began. The form is drawn from it while editing — DynamicForm rewrites every
  // field whenever its initialData changes, so drawing from the live list let a
  // background refetch replace what the user was typing — and its version is
  // what a save sends as If-Match, so a save made after someone else's is a
  // 409 with a choice instead of a silent overwrite.
  const [editBase, setEditBase] = useState<AnyRecord | null>(null);
  const [conflict, setConflict] = useState<{
    mine: AnyRecord;
    theirs: AnyRecord;
    fields: ConflictField[];
  } | null>(null);
  const [formNonce, setFormNonce] = useState(0);

  // Fetch entity metadata to resolve summary fields — skip for sys-level windows that supply static fields
  const hasDynamicFields = !level.formFields || level.formFields.length === 0;
  const { data: entityMeta } = useEntityMetadata(level.id, hasDynamicFields);

  // Fetch report design to know if a Print button should appear.
  //
  // Designs are stored against the physical table (`bus_account`), which is what
  // the seed writes and what Admin -> Report Designs edits. `level.id` is the
  // route slug (`account`, `opportunity-line-item`), so keying the lookup on it
  // asked for a design that is never stored under that name: the request
  // answered null for every business entity and the Print button never
  // appeared on any of them. The endpoint already carries the table, and
  // `helpTableNameFromEndpoint` is the same reading of it the Help dialog uses.
  const reportTableName = helpTableNameFromEndpoint(level.endpoint);
  const { data: reportDesign } = useQuery({
    queryKey: ["report-design", reportTableName],
    queryFn: () =>
      apiClient.get<{ layout?: object } | null>(`/sys/report-designs/${reportTableName}`),
    enabled: !!reportTableName,
    staleTime: 60_000,
  });
  /*
   * The Highlights panel's fields: the ones whose group is the summary group.
   *
   * `level.formFields` first, and `entityMeta` only as the fallback — the same
   * order, and for the same reason, as the print modal twenty lines below.
   * `entityMeta` is fetched only when a level supplies *no* fields of its own,
   * and every business entity supplies them from the dictionary, so reading
   * `entityMeta` alone meant `summaryFields` was empty for every `bus_` record
   * ever opened: the panel could not render no matter how an administrator
   * arranged the groups. `getFormFields` is `getEntityMetadata`'s own columns
   * filtered by `is_displayed`, so it carries `group_layout_type` too.
   */
  const summaryFields: FieldMetadata[] = ((level.formFields?.length
    ? level.formFields
    : (entityMeta?.columns ?? [])) as FieldMetadata[]
  ).filter((c: any) => c.group_layout_type === "summary" && c.is_displayed);

  // Fetch each parent record's display name for breadcrumbs.
  // A self-referencing hierarchy can put the same record in the trail twice, so
  // fetch each distinct endpoint+id once — duplicate keys in a single
  // useQueries call are dropped by React Query, which would shift every result
  // after the duplicate onto the wrong breadcrumb.
  const uniqueParents = dedupeParents(parentContext);
  const parentNameQueries = useQueries({
    queries: uniqueParents.map(({ level: l, id }) => ({
      queryKey: ["ad-parent-name", l.endpoint, id],
      queryFn: () => apiClient.get<AnyRecord>(`${l.endpoint}/${id}`),
      enabled: !!id,
    })),
  });
  const parentRecordByKey = new Map<string, AnyRecord | undefined>(
    uniqueParents.map((p, i) => [parentKey(p), parentNameQueries[i]?.data as AnyRecord | undefined])
  );
  // Immediate parent record data — used to filter child lookup dropdowns
  const immediateParentData =
    parentContext.length > 0
      ? (parentRecordByKey.get(parentKey(parentContext[parentContext.length - 1])) ?? {})
      : {};
  const parentNames: string[] = parentContext.map((pc, i) => {
    const rec = parentRecordByKey.get(parentKey(pc));
    if (!rec) return parentContext[i].id;
    const pl = parentContext[i].level;
    if (pl.nameField === "first_name" && rec.last_name) {
      return `${rec.first_name ?? ""} ${rec.last_name ?? ""}`.trim();
    }
    return (rec[pl.nameField] as string) ?? parentContext[i].id;
  });

  // Build parent filter from metadata (level.parentField)
  const parentFilter: Record<string, unknown> = {};
  if (parentContext.length && level.parentField) {
    parentFilter[level.parentField] = parentContext[parentContext.length - 1].id;
  }

  const fetchParams = { page, limit: 100, ...parentFilter };

  // Fetch the sibling list for prev/next navigation
  const {
    data: listData,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["ad-detail-list", level.endpoint, fetchParams],
    queryFn: () => apiClient.get<PaginatedResponse<AnyRecord>>(level.endpoint, fetchParams),
  });

  const records = listData?.data ?? [];
  const totalCount = listData?.meta?.total ?? 0;
  const totalPages = listData?.meta?.totalPages ?? 1;

  // Locate current record in the page; if missing, request adjacent page
  // Use String comparison to handle numeric IDs (e.g. sys_reference_id) vs URL string params
  useEffect(() => {
    if (!records.length) return;
    const idx = records.findIndex((r) => String(r[level.idField]) === String(recordId));
    if (idx !== -1) {
      setCurrentIndex(idx);
    }
  }, [records, recordId, level.idField]);

  /*
   * The record itself, read by id.
   *
   * The sibling list is for prev/next, and a list endpoint is free to return a
   * summary of each row — `/sys/fields` returned nine of sys_field's thirty
   * columns, so the Field window showed "—" for Same Line, Heading, Encrypted,
   * Obscure Type and all three logic expressions, and saved them back as
   * nothing. The GET by id is the whole row; the list row is only what shows
   * while it loads.
   */
  const { data: fullRecord } = useQuery({
    queryKey: ["ad-detail-record", level.endpoint, recordId],
    queryFn: () => apiClient.get<AnyRecord>(`${level.endpoint}/${recordId}`),
    enabled: !!recordId,
    retry: false,
  });

  const listRecord = records.find((r) => String(r[level.idField]) === String(recordId)) ?? null;
  const currentRecord = useMemo(() => {
    const full =
      fullRecord && String(fullRecord[level.idField]) === String(recordId) ? fullRecord : null;
    if (!listRecord && !full) return null;
    return { ...(listRecord ?? {}), ...(full ?? {}) } as AnyRecord;
  }, [listRecord, fullRecord, level.idField, recordId]);
  const globalIndex = (page - 1) * 100 + currentIndex;
  const canGoPrev = globalIndex > 0;
  const canGoNext = globalIndex < totalCount - 1;

  // Reset form when record changes — but not mid-edit (see `editBase`).
  useEffect(() => {
    if (currentRecord && !isEditing) {
      setFormData(currentRecord);
      setHasChanges(false);
    }
  }, [currentRecord, isEditing]);

  // A window opened straight into edit mode takes its snapshot once the record
  // arrives.
  useEffect(() => {
    if (isEditing && !editBase && currentRecord) setEditBase(currentRecord);
  }, [isEditing, editBase, currentRecord]);

  const saveMutation = useMutation({
    mutationFn: ({ data, version }: { data: AnyRecord; version?: unknown }) =>
      apiClient.patch<AnyRecord>(`${level.endpoint}/${recordId}`, data, {
        headers: ifMatchHeader(version ?? editBase?.version ?? currentRecord?.version),
      }),
    onSuccess: (saved) => {
      // The save reports where the record ended up: moved on, or refused by a
      // rule or workflow and in Error with the reason — still saved.
      const promotion = (saved as { promotion?: { docStatus?: string; message?: string } } | null)
        ?.promotion;
      if (promotion?.docStatus === "error") {
        toast.error(`Saved — Error: ${promotion.message ?? "a rule or workflow refused it"}`);
      } else if (promotion?.docStatus === "final") {
        toast.success("Saved — Final");
      } else {
        toast.success("Saved");
      }
      setHasChanges(false);
      setSaveErrors([]);
      setConflict(null);
      // Still editing (a window opened in edit mode): continue from the record
      // just saved, whose version is the one the next save must name.
      if (initialMode === "view") {
        setIsEditing(false);
        setEditBase(null);
      } else {
        setEditBase(saved && typeof saved === "object" ? (saved as AnyRecord) : null);
      }
      queryClient.invalidateQueries({ queryKey: ["ad-detail-list", level.endpoint] });
      queryClient.invalidateQueries({ queryKey: ["ad-detail-record", level.endpoint, recordId] });
      refetch();
    },
    onError: async (err: any, variables) => {
      if (isVersionConflict(err)) {
        // Read the record as it stands now, through the GET that applies this
        // user's field access, and show what the other save changed.
        try {
          const theirs = await apiClient.get<AnyRecord>(`${level.endpoint}/${recordId}`);
          const base = editBase ?? currentRecord ?? {};
          const visible = new Set((level.formFields ?? []).map((f) => f.column_name));
          const fields = changedByOthers(
            base as ConflictRecord,
            variables.data as ConflictRecord,
            theirs as ConflictRecord
          ).filter((f) => visible.size === 0 || visible.has(f.field));
          setConflict({ mine: variables.data, theirs, fields });
        } catch {
          toast.error("This record was changed by someone else, and could not be reloaded.");
        }
        return;
      }
      const specific = Array.isArray(err?.errors) ? (err.errors as string[]) : null;
      const fallback = Array.isArray(err?.message)
        ? err.message.join(", ")
        : (err?.message ?? "Save failed");
      setSaveErrors(specific ?? [fallback]);
      toast.error(specific?.[0] ?? fallback);
    },
  });

  const handleConflictReload = () => {
    if (!conflict) return;
    setFormData(conflict.theirs);
    setEditBase(initialMode === "view" ? null : conflict.theirs);
    if (initialMode === "view") setIsEditing(false);
    setHasChanges(false);
    setSaveErrors([]);
    setConflict(null);
    setFormNonce((n) => n + 1);
    queryClient.invalidateQueries({ queryKey: ["ad-detail-list", level.endpoint] });
    refetch();
    toast.info("Showing the record as it was last saved.");
  };

  const handleConflictOverwrite = () => {
    if (!conflict) return;
    // Against the version just read, not the one editing began at: a third save
    // in the meantime is refused again rather than overwritten as well.
    setEditBase(conflict.theirs);
    saveMutation.mutate({ data: conflict.mine, version: conflict.theirs.version });
  };

  const labelOf = (field: string) =>
    (level.formFields ?? []).find((f) => f.column_name === field)?.name ?? field.replace(/_/g, " ");

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.delete(`${level.endpoint}/${recordId}`),
    onSuccess: () => {
      toast.success("Deleted");
      queryClient.invalidateQueries({ queryKey: ["ad-detail-list", level.endpoint] });
      navigate({ to: buildAdminListUrl(parentContext, level) as never });
    },
    onError: (err: any) => toast.error(err?.message ?? "Failed"),
  });

  // Record navigation — URL changes to reflect the selected sibling
  const navigateToIndex = useCallback(
    (idx: number, p: number) => {
      const record = records[idx];
      if (!record) return;
      setPage(p);
      setCurrentIndex(idx);
      navigate({
        to: buildAdminDetailUrl(parentContext, level, String(record[level.idField])) as never,
      });
    },
    [records, level, parentContext, navigate]
  );

  const goFirst = () => {
    setPage(1);
    navigateToIndex(0, 1);
  };
  const goPrev = () =>
    currentIndex > 0
      ? navigateToIndex(currentIndex - 1, page)
      : page > 1 && navigateToIndex(99, page - 1);
  const goNext = () =>
    currentIndex < records.length - 1
      ? navigateToIndex(currentIndex + 1, page)
      : page < totalPages && navigateToIndex(0, page + 1);
  const goLast = () => {
    setPage(totalPages);
    setCurrentIndex(0);
  };

  // Breadcrumbs — entirely from metadata + fetched parent names, zero hardcoded strings
  const crumbs: { label: string; href?: string }[] = [];
  for (let i = 0; i < parentContext.length; i++) {
    const { level: pl, id } = parentContext[i];
    const grandParentCtx = parentContext.slice(0, i);
    crumbs.push({ label: pluralLabel(pl.label), href: buildAdminListUrl(grandParentCtx, pl) });
    crumbs.push({ label: parentNames[i] ?? id, href: buildAdminDetailUrl(grandParentCtx, pl, id) });
  }
  crumbs.push({ label: pluralLabel(level.label), href: buildAdminListUrl(parentContext, level) });
  // The server resolves a record's label (references followed to the names behind
  // them); the name column alone would show a uuid for a record named by its parents.
  const servedLabel =
    currentRecord && typeof currentRecord._label === "string" ? currentRecord._label : "";
  const currentName = servedLabel
    ? servedLabel
    : currentRecord
    ? level.nameField === "first_name" && currentRecord.last_name
      ? `${currentRecord.first_name ?? ""} ${currentRecord.last_name ?? ""}`.trim()
      : ((currentRecord[level.nameField] as string) ?? recordId)
    : recordId;
  crumbs.push({ label: currentName }); // current record — no link

  const listHref = buildAdminListUrl(parentContext, level);

  const hasReportDesign = !!(reportDesign?.layout);

  // The record's lifecycle (lib/lifecycle.ts): its badge, its action buttons,
  // the Error banner, and the end of a flow locked against editing.
  const tableName = helpTableNameFromEndpoint(level.endpoint);
  const lifecycle = lifecycleOf(tableName);
  const lifecycleValue = lifecycle ? currentRecord?.[lifecycle.column] : undefined;
  const locked = !!lifecycle && !!currentRecord && isLocked(lifecycle, lifecycleValue);
  const inError = !!lifecycle && !!currentRecord && phaseOf(lifecycle, lifecycleValue) === "error";
  const onMoved = () => {
    queryClient.invalidateQueries({ queryKey: ["ad-detail-list", level.endpoint] });
    queryClient.invalidateQueries({ queryKey: ["ad-detail-record", level.endpoint, recordId] });
    queryClient.invalidateQueries({ queryKey: ["record-actions", level.endpoint, recordId] });
    refetch();
  };

  return (
    <div className="flex flex-col h-full">
      <ADToolbar
        onSave={() => saveMutation.mutate({ data: formData })}
        onDelete={() => deleteMutation.mutate()}
        onUndo={() => {
          if (currentRecord) {
            setFormData(currentRecord);
            setHasChanges(false);
          }
        }}
        onRefresh={() => refetch()}
        onEdit={() => {
          setEditBase(currentRecord);
          setIsEditing(true);
        }}
        onCancelEdit={() => {
          setIsEditing(false);
          setEditBase(null);
          if (currentRecord) {
            setFormData(currentRecord);
            setHasChanges(false);
          }
        }}
        onPrint={() => setIsPrintOpen(true)}
        isSaving={saveMutation.isPending}
        isDeleting={deleteMutation.isPending}
        hasChanges={hasChanges}
        canDelete={!!recordId && isEditing}
        canCreate={false}
        isEditing={isEditing}
        isDetailView={true}
        canEdit={!locked}
        hasPrintReport={hasReportDesign}
      />

      {/* Header panel — breadcrumb + record identity + nav */}
      <div className="border-b border-border bg-gradient-to-r from-background to-muted/30">
        {/* Top row: breadcrumb trail */}
        <div className="flex items-center gap-1.5 px-6 pt-4 pb-1 text-xs text-muted-foreground">
          <Link
            to={dashboardHref as never}
            className="flex items-center gap-1 hover:text-primary transition-colors"
          >
            <Home className="h-3.5 w-3.5" />
            <span>Dashboard</span>
          </Link>
          {crumbs.slice(0, -1).map((c, i) => (
            <span key={i} className="flex items-center gap-1.5">
              <span aria-hidden="true" className="text-muted-foreground/50">/</span>
              {c.href ? (
                <Link
                  to={c.href as never}
                  className="hover:text-primary transition-colors truncate max-w-[180px]"
                >
                  {c.label}
                </Link>
              ) : (
                <span className="truncate max-w-[240px]">{c.label}</span>
              )}
            </span>
          ))}
        </div>

        {/* Bottom row: record name + status + nav + summary panel */}
        <div className="flex items-start gap-4 px-6 pb-4 pt-1">
          {/* Left: title + nav */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={() => navigate({ to: listHref as never })}
                className="text-xs text-primary hover:underline font-medium flex-shrink-0 flex items-center gap-1"
              >
                ← List
              </button>
              <span aria-hidden="true" className="text-muted-foreground/40">|</span>
              <h1 className="text-xl font-semibold text-foreground truncate">{currentName}</h1>
              <LifecycleBadge
                tableName={tableName}
                fields={
                  // The grid fields always carry the state field; the form
                  // fields never do, because it is not an input.
                  (level.gridFields?.length
                    ? level.gridFields
                    : (entityMeta?.columns ?? [])) as FieldMetadata[]
                }
                record={currentRecord as Record<string, unknown> | null}
              />
              <RecordActions
                endpoint={level.endpoint}
                tableName={tableName}
                record={currentRecord as Record<string, unknown> | null}
                disabled={saveMutation.isPending}
                formValues={isEditing && hasChanges ? formData : null}
                onSaved={() => {
                  // The press saved the form: it is the record now, at its new version.
                  setHasChanges(false);
                  setEditBase(null);
                }}
                onMoved={onMoved}
              />
              <WindowHelpButton
                tableName={helpTableNameFromEndpoint(level.endpoint)}
                entityLabel={level.label}
              />
            </div>
            <div className="mt-1.5">
              <ADRecordNav
                currentIndex={currentIndex}
                totalCount={totalCount}
                page={page}
                pageSize={100}
                canGoPrev={canGoPrev}
                canGoNext={canGoNext}
                onFirst={goFirst}
                onPrev={goPrev}
                onNext={goNext}
                onLast={goLast}
              />
            </div>
          </div>
          {/* Right: Summary Panel */}
          {summaryFields.length > 0 && currentRecord && (
            <SummaryPanel fields={summaryFields} record={currentRecord} />
          )}
        </div>
      </div>

      {inError && (
        <div
          role="alert"
          data-testid="record-error"
          className="mx-6 mt-3 rounded-md border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-800 dark:text-red-200"
        >
          <p className="font-semibold">The last save was refused, so this record is in Error.</p>
          <p className="mt-1">
            {(currentRecord?.doc_status_message as string) ||
              "A rule or workflow refused it. Correct the record and save it again."}
          </p>
          <p className="mt-1 text-xs opacity-80">
            Your changes are saved. Edit the record and save it again to run its rules and workflows.
          </p>
        </div>
      )}

      {/* Print modal — only mounts when a design exists and the user clicks Print */}
      {hasReportDesign && currentRecord && reportDesign?.layout && (
        <ReportPrintModal
          open={isPrintOpen}
          onClose={() => setIsPrintOpen(false)}
          layout={reportDesign.layout}
          data={currentRecord}
          entityLabel={level.label}
          // The dictionary columns, so the printed document resolves a foreign
          // key to the record's name and a list value to its label — the same
          // words the form beside it is showing — instead of printing the uuid
          // and the stored key.
          //
          // `level.formFields` first: that is what the form below is drawn
          // from, and `entityMeta` is deliberately not fetched when a level
          // supplies its own fields, so reading only it would leave every
          // business record printing raw ids.
          fields={
            (level.formFields?.length
              ? level.formFields
              : (entityMeta?.columns ?? [])) as FieldMetadata[]
          }
        />
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-6 space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </div>
        ) : !currentRecord ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <p className="text-lg">Record not found</p>
            <Button variant="link" onClick={() => navigate({ to: listHref as never })}>
              Back to list
            </Button>
          </div>
        ) : (
          <>
            {/* Detail form */}
            <div className="p-6 border-b border-border">
              <DynamicForm
                key={`${recordId}:${formNonce}`}
                tableName={level.id}
                idField={level.idField}
                fields={level.formFields}
                initialData={isEditing && editBase ? editBase : currentRecord}
                onSubmit={(fd) => {
                  setFormData(fd);
                  setHasChanges(false);
                  saveMutation.mutate({ data: fd });
                }}
                onChange={(fd) => {
                  setFormData(fd);
                  setHasChanges(true);
                  setSaveErrors([]);
                }}
                mode={isEditing ? "edit" : "view"}
                readOnly={!isEditing}
                isSaving={saveMutation.isPending}
                parentContext={immediateParentData}
              />
              <VersionConflictDialog
                open={conflict !== null}
                entityLabel={level.label ?? "record"}
                fields={conflict?.fields ?? []}
                labelOf={labelOf}
                theirVersion={Number(conflict?.theirs.version) || undefined}
                isSaving={saveMutation.isPending}
                onReload={handleConflictReload}
                onOverwrite={handleConflictOverwrite}
                onCancel={() => setConflict(null)}
              />
              {saveErrors.length > 0 && (
                <div className="mt-3 rounded-md border border-destructive/50 bg-destructive/10 p-3">
                  <p className="text-sm font-medium text-destructive mb-1">Validation failed</p>
                  <ul className="text-xs text-destructive/90 space-y-0.5 list-disc list-inside">
                    {saveErrors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Inline child tabs — row clicks navigate to child detail URL */}
            {level.childTabs && level.childTabs.length > 0 && (
              <div className="border-t border-border">
                <Tabs value={activeChildTab} onValueChange={setActiveChildTab}>
                  <div className="border-b border-border bg-muted/30">
                    <TabsList className="h-auto p-0 bg-transparent rounded-none">
                      {level.childTabs.map((ct) => (
                        <ChildTabTrigger
                          key={ct.id}
                          childTab={ct}
                          parentId={recordId}
                          isActive={activeChildTab === ct.id}
                        />
                      ))}
                    </TabsList>
                  </div>
                  {level.childTabs.map((ct) => (
                    <TabsContent key={ct.id} value={ct.id} className="m-0">
                      <ChildPanel
                        childTab={ct}
                        parentRecord={currentRecord}
                        selfLevel={level}
                        parentContext={parentContext}
                      />
                    </TabsContent>
                  ))}
                </Tabs>
              </div>
            )}

            {/* Notes first, then the history: what someone chose to say about
                this record, above the account of what was done to it. */}
            <EntityNotes entityType={level.id} recordId={recordId} />
            <EntityAuditTrail entityType={level.id} recordId={recordId} />
          </>
        )}
      </div>
    </div>
  );
}
