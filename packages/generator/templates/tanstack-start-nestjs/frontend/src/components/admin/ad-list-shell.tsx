import { RecordLoadError } from "./record-load-error";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Home, Inbox, Plus, Search, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DynamicForm } from "@/components/forms/dynamic-form";
import { DynamicTable } from "@/components/tables/dynamic-table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { FieldMetadata } from "@/hooks/use-entities";
import { apiClient, type PaginatedResponse } from "@/lib/api-client";
import { lifecycleOf } from "@/lib/lifecycle";
import { pluralLabel } from "@/lib/plural-label";
import { useLifecycles } from "@/lib/use-lifecycles";
import { ADToolbar } from "./ad-toolbar";
import {
  type ADLevel,
  buildAdminDetailUrl,
  buildAdminListUrl,
  type ParentContext,
} from "./ad-window-configs";
import { helpTableNameFromEndpoint, WindowHelpButton } from "./window-help-button";

type AnyRecord = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Filter builder — operators derived from field metadata (sys_reference_id)
// ---------------------------------------------------------------------------

interface FilterRow {
  id: string;
  column: string;
  operator: string;
  value: string;
}

const FILTER_OPERATORS = {
  text: [
    { value: "contains", label: "contains" },
    { value: "equals", label: "equals" },
    { value: "startsWith", label: "starts with" },
    { value: "endsWith", label: "ends with" },
  ],
  number: [
    { value: "equals", label: "=" },
    { value: "gt", label: ">" },
    { value: "gte", label: ">=" },
    { value: "lt", label: "<" },
    { value: "lte", label: "<=" },
  ],
  date: [
    { value: "equals", label: "on" },
    { value: "gt", label: "after" },
    { value: "gte", label: "on or after" },
    { value: "lt", label: "before" },
    { value: "lte", label: "on or before" },
  ],
  boolean: [{ value: "equals", label: "is" }],
  lookup: [
    { value: "contains", label: "contains" },
    { value: "equals", label: "equals" },
  ],
} as const;

type FilterCategory = keyof typeof FILTER_OPERATORS;

function filterCategory(refId: number): FilterCategory {
  if (refId === 11 || refId === 12) return "number";
  if (refId === 15 || refId === 16) return "date";
  if (refId === 20) return "boolean";
  if (refId === 17 || refId === 18 || refId === 19) return "lookup";
  return "text";
}

function FilterValueInput({
  row,
  field,
  onChange,
}: {
  row: FilterRow;
  field: FieldMetadata | undefined;
  onChange: (v: string) => void;
}) {
  const cls =
    "h-8 text-sm border border-input rounded-md px-2 bg-background focus:outline-none focus:ring-1 focus:ring-ring min-w-[160px]";
  const cat = field ? filterCategory(field.sys_reference_id) : "text";
  if (cat === "boolean")
    return (
      <select
        value={row.value}
        onChange={(e) => onChange(e.target.value)}
        className={cls}
        style={{ minWidth: 100 }}
      >
        <option value="">Any</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  if (cat === "date")
    return (
      <input
        type={field?.sys_reference_id === 16 ? "datetime-local" : "date"}
        value={row.value}
        onChange={(e) => onChange(e.target.value)}
        className={cls}
      />
    );
  if (cat === "number")
    return (
      <input
        type="number"
        value={row.value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Value…"
        className={cls}
        style={{ minWidth: 120 }}
      />
    );
  return (
    <input
      type="text"
      value={row.value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Value…"
      className={cls}
    />
  );
}

function FilterBuilder({
  fields,
  rows,
  onChange,
  onApply,
  onClear,
}: {
  fields: FieldMetadata[];
  rows: FilterRow[];
  onChange: (rows: FilterRow[]) => void;
  onApply: () => void;
  onClear: () => void;
}) {
  const searchable = fields.filter((f) => f.is_displayed_grid);
  const addRow = () => {
    const f = searchable[0];
    if (!f) return;
    const cat = filterCategory(f.sys_reference_id);
    onChange([
      ...rows,
      {
        id: crypto.randomUUID(),
        column: f.column_name,
        operator: FILTER_OPERATORS[cat][0].value,
        value: "",
      },
    ]);
  };
  const updateRow = (id: string, patch: Partial<FilterRow>) =>
    onChange(
      rows.map((r) => {
        if (r.id !== id) return r;
        const u = { ...r, ...patch };
        if (patch.column && patch.column !== r.column) {
          const f2 = searchable.find((f) => f.column_name === patch.column);
          const cat = f2 ? filterCategory(f2.sys_reference_id) : "text";
          u.operator = FILTER_OPERATORS[cat][0].value;
          u.value = "";
        }
        return u;
      })
    );
  const removeRow = (id: string) => onChange(rows.filter((r) => r.id !== id));
  const sel =
    "h-8 text-sm border border-input rounded-md px-2 bg-background focus:outline-none focus:ring-1 focus:ring-ring";
  return (
    <div className="border-b border-border bg-muted/10 px-4 py-3 space-y-2">
      {rows.length === 0 && (
        <p className="text-xs text-muted-foreground italic py-1">
          No filters — click Add Filter to narrow results.
        </p>
      )}
      {rows.map((row) => {
        const field = searchable.find((f) => f.column_name === row.column);
        const cat = field ? filterCategory(field.sys_reference_id) : "text";
        const ops = FILTER_OPERATORS[cat] as readonly { value: string; label: string }[];
        return (
          <div key={row.id} className="flex items-center gap-2 flex-wrap">
            <select
              value={row.column}
              onChange={(e) => updateRow(row.id, { column: e.target.value })}
              className={`${sel} min-w-[140px]`}
            >
              {searchable.map((f) => (
                <option key={f.column_name} value={f.column_name}>
                  {f.name}
                </option>
              ))}
            </select>
            <select
              value={row.operator}
              onChange={(e) => updateRow(row.id, { operator: e.target.value })}
              className={`${sel} min-w-[110px]`}
            >
              {ops.map((op) => (
                <option key={op.value} value={op.value}>
                  {op.label}
                </option>
              ))}
            </select>
            <FilterValueInput
              row={row}
              field={field}
              onChange={(v) => updateRow(row.id, { value: v })}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              onClick={() => removeRow(row.id)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        );
      })}
      <div className="flex items-center gap-2 pt-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={addRow}
          disabled={!searchable.length}
        >
          <Plus className="h-3 w-3" />
          Add Filter
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-7 text-xs gap-1"
          onClick={onApply}
          disabled={!rows.length}
        >
          <Search className="h-3.5 w-3.5" />
          Apply
        </Button>
        {rows.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            onClick={onClear}
          >
            Clear All
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
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

/** Build parent filter params from context — uses level.parentField from metadata */
function parentFilterParams(parentCtx: ParentContext[], level: ADLevel): Record<string, string> {
  if (!parentCtx.length || !level.parentField) return {};
  const { id } = parentCtx[parentCtx.length - 1];
  return { [level.parentField]: id };
}

// ---------------------------------------------------------------------------
// ADListShell
// ---------------------------------------------------------------------------

export interface ADListShellProps {
  level: ADLevel;
  /** Parent levels with their record IDs — drives URL construction and API filtering */
  parentContext: ParentContext[];
  dashboardHref?: string;
  /** If true, inserts an "Admin" breadcrumb link between Dashboard and the entity crumbs */
  showAdminCrumb?: boolean;
  /** If true, hides Create/Edit actions — list is display-only */
  viewOnly?: boolean;
}

export function ADListShell({
  level,
  parentContext,
  dashboardHref = "/dashboard",
  showAdminCrumb = false,
  viewOnly = false,
}: ADListShellProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [searchOpen, setSearchOpen] = useState(false);
  const [pendingRows, setPendingRows] = useState<FilterRow[]>([]);
  const [appliedRows, setAppliedRows] = useState<FilterRow[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  // "Waiting for me": records in a status this person has a move out of,
  // assigned to them or to no one. Offered only where there is a flow to wait in.
  const [waitingForMe, setWaitingForMe] = useState(false);
  useLifecycles();
  const hasFlow = !!lifecycleOf(helpTableNameFromEndpoint(level.endpoint))?.hasMachine;
  const [createErrors, setCreateErrors] = useState<string[]>([]);

  // Fetch each parent record's display name for the breadcrumb.
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
  const parentNames: string[] = parentContext.map((pc, i) => {
    const rec = parentRecordByKey.get(parentKey(pc));
    if (!rec) return parentContext[i].id;
    const pl = parentContext[i].level;
    if (pl.nameField === "first_name" && rec.last_name) {
      return `${rec.first_name ?? ""} ${rec.last_name ?? ""}`.trim();
    }
    return (rec[pl.nameField] as string) ?? parentContext[i].id;
  });

  // Build fetch params: parent filter + pagination + applied search filters
  const fetchParams: Record<string, unknown> = {
    page,
    limit: 100,
    ...parentFilterParams(parentContext, level),
  };
  for (const row of appliedRows) {
    if (row.column && row.operator && row.value !== "") {
      fetchParams[`filter.${row.column}`] = `${row.operator}:${row.value}`;
    }
  }
  if (hasFlow && waitingForMe) fetchParams.awaiting = "me";

  // Filters without the paging — what the CSV export sends, so the download is
  // the list on screen rather than the whole table.
  const { page: _exportPage, limit: _exportLimit, ...exportParams } = fetchParams;

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["ad-list", level.endpoint, fetchParams],
    queryFn: () => apiClient.get<PaginatedResponse<AnyRecord>>(level.endpoint, fetchParams),
  });

  const records = data?.data ?? [];
  const totalCount = data?.meta?.total ?? 0;
  const activeFilterCount = appliedRows.filter((r) => r.value !== "").length;

  const createMutation = useMutation({
    mutationFn: (formData: AnyRecord) =>
      apiClient.post<AnyRecord>(level.endpoint, {
        ...formData,
        ...parentFilterParams(parentContext, level),
      }),
    onSuccess: (newRecord) => {
      const newId = newRecord[level.idField] as string;
      toast.success(`${level.label} created`);
      queryClient.invalidateQueries({ queryKey: ["ad-list", level.endpoint] });
      setIsCreating(false);
      setCreateErrors([]);
      if (newId) navigate({ to: buildAdminDetailUrl(parentContext, level, newId) as never });
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

  // Breadcrumbs built purely from metadata + fetched parent names
  const crumbs: { label: string; href?: string }[] = [];
  for (let i = 0; i < parentContext.length; i++) {
    const { level: pl, id } = parentContext[i];
    const grandParentCtx = parentContext.slice(0, i);
    crumbs.push({ label: pluralLabel(pl.label), href: buildAdminListUrl(grandParentCtx, pl) });
    crumbs.push({ label: parentNames[i] ?? id, href: buildAdminDetailUrl(grandParentCtx, pl, id) });
  }
  crumbs.push({ label: pluralLabel(level.label) }); // current level — no link

  if (isError) return <RecordLoadError error={error} onRetry={() => { void refetch(); }} />;

  return (
    <div className="flex flex-col h-full">
      <h1 className="sr-only">{pluralLabel(level.label)}</h1>
      <ADToolbar
        onNew={
          viewOnly
            ? undefined
            : () => {
                setIsCreating(true);
                setSearchOpen(false);
              }
        }
        onRefresh={() => refetch()}
        onAdvancedSearchToggle={() => {
          setSearchOpen((p) => !p);
          if (searchOpen) setPendingRows([...appliedRows]);
        }}
        isAdvancedSearchOpen={searchOpen}
        advancedFilterCount={activeFilterCount}
        isSaving={createMutation.isPending}
        isDeleting={false}
        hasChanges={isCreating}
        canCreate={!viewOnly}
        canDelete={false}
        isDetailView={false}
      />

      {searchOpen && !isCreating && (
        <FilterBuilder
          fields={level.gridFields}
          rows={pendingRows}
          onChange={setPendingRows}
          onApply={() => {
            setAppliedRows([...pendingRows]);
            setPage(1);
          }}
          onClear={() => {
            setPendingRows([]);
            setAppliedRows([]);
            setPage(1);
          }}
        />
      )}

      {/* Breadcrumb bar */}
      <div className="flex items-center gap-1.5 px-4 py-2 border-b border-border bg-background text-sm flex-wrap">
        <Link
          to={dashboardHref as never}
          className="flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors"
        >
          <Home className="h-3.5 w-3.5" />
          <span>Dashboard</span>
        </Link>
        {showAdminCrumb && (
          <span className="flex items-center gap-1.5">
            <span className="text-muted-foreground">/</span>
            <Link
              to="/admin"
              className="text-muted-foreground hover:text-primary transition-colors"
            >
              Admin
            </Link>
          </span>
        )}
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1.5">
            <span className="text-muted-foreground">/</span>
            {c.href ? (
              <Link
                to={c.href as never}
                className="text-muted-foreground hover:text-primary transition-colors truncate max-w-[180px]"
              >
                {c.label}
              </Link>
            ) : (
              <span className="font-medium text-foreground">{c.label}</span>
            )}
          </span>
        ))}
        {activeFilterCount > 0 && (
          <span className="text-xs text-muted-foreground ml-1">({totalCount} filtered)</span>
        )}
        <WindowHelpButton
          tableName={helpTableNameFromEndpoint(level.endpoint)}
          entityLabel={level.label}
        />
        {hasFlow && (
          <Button
            size="sm"
            variant={waitingForMe ? "default" : "outline"}
            className="ml-auto h-7 gap-1 text-xs"
            aria-pressed={waitingForMe}
            data-testid="waiting-for-me"
            onClick={() => {
              setWaitingForMe((on) => !on);
              setPage(1);
            }}
          >
            <Inbox className="h-3.5 w-3.5" />
            Waiting for me
          </Button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {/* Inline create form */}
        {isCreating && (
          <div className="p-6 border-b border-border bg-muted/10">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">New {level.label}</h3>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setIsCreating(false);
                  setCreateErrors([]);
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <DynamicForm
              tableName={level.id}
              idField={level.idField}
              fields={level.formFields}
              initialData={{}}
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

        {isLoading ? (
          <div className="p-6 space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </div>
        ) : records.length === 0 && !isCreating ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <p className="text-lg">
              {activeFilterCount > 0 ? "No records match your filters" : "No records found"}
            </p>
            <p className="text-sm mt-1">
              {activeFilterCount > 0
                ? "Try adjusting your filters"
                : `Click + to create a new ${level.label.toLowerCase()}`}
            </p>
          </div>
        ) : (
          <div className="p-4">
            <DynamicTable
              tableName={level.id}
              fields={level.gridFields || level.formFields}
              data={records}
              isLoading={isLoading}
              totalCount={totalCount}
              page={page}
              pageSize={100}
              onPageChange={setPage}
              onRowClick={
                viewOnly
                  ? undefined
                  : (row) => {
                      const id = String(row[level.idField]);
                      navigate({ to: buildAdminDetailUrl(parentContext, level, id) as never });
                    }
              }
              exportEndpoint={level.endpoint}
              exportParams={exportParams}
            />
          </div>
        )}
      </div>
    </div>
  );
}
