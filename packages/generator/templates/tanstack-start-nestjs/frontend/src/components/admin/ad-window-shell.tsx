import { RecordLoadError } from "./record-load-error";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Home, Plus, Search, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { DynamicForm } from "@/components/forms/dynamic-form";
import { DynamicTable } from "@/components/tables/dynamic-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { FieldMetadata } from "@/hooks/use-entities";
import { apiClient, type PaginatedResponse } from "@/lib/api-client";
import { ADBreadcrumb, type BreadcrumbLevel } from "./ad-breadcrumb";
import { ADRecordNav } from "./ad-record-nav";
import { ADToolbar } from "./ad-toolbar";
import type { ADChildTabConfig, ADLevel, ADWindowConfig } from "./ad-window-configs";

// ============================================================================
// URL helpers — encode/decode drill state as ?l0=id&l1=id&l2=id search params
// ============================================================================

function readUrlLevels(): string[] {
  const params = new URLSearchParams(window.location.search);
  const levels: string[] = [];
  for (let i = 0; i < 10; i++) {
    const v = params.get(`l${i}`);
    if (!v) break;
    levels.push(v);
  }
  return levels;
}

function writeUrlLevels(ids: string[]) {
  const url = new URL(window.location.href);
  // Rebuild params without any l* keys, then re-add with new values
  const next = new URLSearchParams();
  url.searchParams.forEach((value, key) => {
    if (!/^l\d+$/.test(key)) next.set(key, value);
  });
  ids.forEach((id, i) => next.set(`l${i}`, id));
  url.search = next.toString();
  window.history.replaceState(null, "", url.toString());
}

// ============================================================================
// Types
// ============================================================================

type AnyRecord = Record<string, unknown>;

interface DrillState {
  levelIndex: number;
  parentId: string;
  parentName: string;
}

// ---------------------------------------------------------------------------
// Filter builder types & helpers
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

function getFilterCategory(sysReferenceId: number): FilterCategory {
  if (sysReferenceId === 11 || sysReferenceId === 12) return "number";
  if (sysReferenceId === 15 || sysReferenceId === 16) return "date";
  if (sysReferenceId === 20) return "boolean";
  if (sysReferenceId === 17 || sysReferenceId === 18 || sysReferenceId === 19) return "lookup";
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
  const cat = field ? getFilterCategory(field.sys_reference_id) : "text";
  const refId = field?.sys_reference_id ?? 10;

  if (cat === "boolean") {
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
  }
  if (cat === "date") {
    return (
      <input
        type={refId === 16 ? "datetime-local" : "date"}
        value={row.value}
        onChange={(e) => onChange(e.target.value)}
        className={cls}
      />
    );
  }
  if (cat === "number") {
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
  }
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
  const searchableFields = fields.filter((f) => f.is_displayed_grid);

  const addRow = () => {
    const first = searchableFields[0];
    if (!first) return;
    const cat = getFilterCategory(first.sys_reference_id);
    onChange([
      ...rows,
      {
        id: crypto.randomUUID(),
        column: first.column_name,
        operator: FILTER_OPERATORS[cat][0].value,
        value: "",
      },
    ]);
  };

  const updateRow = (id: string, patch: Partial<FilterRow>) => {
    onChange(
      rows.map((r) => {
        if (r.id !== id) return r;
        const updated = { ...r, ...patch };
        if (patch.column && patch.column !== r.column) {
          const f = searchableFields.find((f) => f.column_name === patch.column);
          const cat = f ? getFilterCategory(f.sys_reference_id) : "text";
          updated.operator = FILTER_OPERATORS[cat][0].value;
          updated.value = "";
        }
        return updated;
      })
    );
  };

  const removeRow = (id: string) => onChange(rows.filter((r) => r.id !== id));

  const selectCls =
    "h-8 text-sm border border-input rounded-md px-2 bg-background focus:outline-none focus:ring-1 focus:ring-ring";

  return (
    <div className="border-b border-border bg-muted/10 px-4 py-3 space-y-2">
      {rows.length === 0 && (
        <p className="text-xs text-muted-foreground italic py-1">
          No filters — click Add Filter to narrow results.
        </p>
      )}
      {rows.map((row) => {
        const field = searchableFields.find((f) => f.column_name === row.column);
        const cat = field ? getFilterCategory(field.sys_reference_id) : "text";
        const ops = FILTER_OPERATORS[cat] as readonly { value: string; label: string }[];
        return (
          <div key={row.id} className="flex items-center gap-2 flex-wrap">
            <select
              value={row.column}
              onChange={(e) => updateRow(row.id, { column: e.target.value })}
              className={`${selectCls} min-w-[140px]`}
            >
              {searchableFields.map((f) => (
                <option key={f.column_name} value={f.column_name}>
                  {f.name}
                </option>
              ))}
            </select>
            <select
              value={row.operator}
              onChange={(e) => updateRow(row.id, { operator: e.target.value })}
              className={`${selectCls} min-w-[110px]`}
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
              className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex-shrink-0"
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
          disabled={searchableFields.length === 0}
        >
          <Plus className="h-3 w-3" />
          Add Filter
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-7 text-xs gap-1"
          onClick={onApply}
          disabled={rows.length === 0}
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

// ============================================================================
// Child Tab Panel
// ============================================================================

interface ChildTabPanelProps {
  tab: ADChildTabConfig;
  parentId: string;
  parentIdField: string;
  onDrillDown: (childRecord: AnyRecord, childLevel: ADLevel) => void;
}

function ChildTabPanel({ tab, parentId, parentIdField, onDrillDown }: ChildTabPanelProps) {
  const [page, setPage] = useState(1);
  const level = tab.level;

  const params: Record<string, unknown> = { page, limit: 50 };
  if (level.parentField) {
    params[level.parentField] = parentId;
  }

  const { data, isLoading } = useQuery({
    queryKey: ["ad-child", level.endpoint, parentId, page],
    queryFn: () => apiClient.get<PaginatedResponse<AnyRecord>>(level.endpoint, params),
    enabled: !!parentId,
  });

  const records = data?.data || [];
  const totalCount = data?.meta?.total || 0;

  return (
    <div className="p-4">
      <DynamicTable
        tableName={level.id}
        fields={level.gridFields}
        data={records}
        isLoading={isLoading}
        totalCount={totalCount}
        page={page}
        pageSize={50}
        onPageChange={setPage}
        onRowClick={(row) => onDrillDown(row, level)}
      />
    </div>
  );
}

// ============================================================================
// AD Window Shell
// ============================================================================

interface ADWindowShellProps {
  config: ADWindowConfig;
}

export function ADWindowShell({ config }: ADWindowShellProps) {
  const queryClient = useQueryClient();
  const rootLevel = config.levels[0];

  // Read URL on first render only — used to restore root-level position
  const [initUrlLevels] = useState(() => readUrlLevels());

  // Navigation state
  const [viewMode, setViewMode] = useState<"list" | "detail">(() =>
    readUrlLevels().length > 0 ? "detail" : "list"
  );
  const [drillStack, setDrillStack] = useState<DrillState[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [page, setPage] = useState(1);
  const [formData, setFormData] = useState<AnyRecord>({});
  const [hasChanges, setHasChanges] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [activeChildTab, setActiveChildTab] = useState<string>("");
  // ID of record to select after records load (used for drill-down targeting & URL restore)
  const [pendingSelectId, setPendingSelectId] = useState<string | null>(() =>
    initUrlLevels.length > 0 ? initUrlLevels[0] : null
  );

  // Filter builder state
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [pendingRows, setPendingRows] = useState<FilterRow[]>([]);
  const [appliedRows, setAppliedRows] = useState<FilterRow[]>([]);

  const currentLevel =
    drillStack.length > 0 ? config.levels[drillStack[drillStack.length - 1].levelIndex] : rootLevel;

  const parentDrill = drillStack.length > 0 ? drillStack[drillStack.length - 1] : null;

  // Fetch records for current level with server-side filters
  const fetchParams: Record<string, unknown> = { page, limit: 100 };
  if (parentDrill && currentLevel.parentField) {
    fetchParams[currentLevel.parentField] = parentDrill.parentId;
  }
  // Add server-side filter params (same format as bus endpoints: filter.column=operator:value)
  for (const row of appliedRows) {
    if (row.column && row.operator && row.value !== "") {
      fetchParams[`filter.${row.column}`] = `${row.operator}:${row.value}`;
    }
  }

  const {
    data: recordsData,
    isError,
    error,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["ad-records", currentLevel.endpoint, fetchParams],
    queryFn: () => apiClient.get<PaginatedResponse<AnyRecord>>(currentLevel.endpoint, fetchParams),
  });

  const records = recordsData?.data || [];
  const totalCount = recordsData?.meta?.total || 0;
  const totalPages = recordsData?.meta?.totalPages || 1;

  const currentRecord = isCreating ? null : records[currentIndex] || null;
  const currentRecordId = currentRecord?.[currentLevel.idField] as string | undefined;
  const currentRecordName = currentRecord?.[currentLevel.nameField] as string | undefined;

  // Set first child tab as active when level changes
  useEffect(() => {
    if (currentLevel.childTabs && currentLevel.childTabs.length > 0) {
      setActiveChildTab(currentLevel.childTabs[0].id);
    }
  }, [currentLevel]);

  // Reset form data when current record changes
  useEffect(() => {
    if (currentRecord && !isCreating) {
      setFormData(currentRecord);
      setHasChanges(false);
    }
  }, [currentRecord, isCreating]);

  // Reset filters when level changes (e.g. drill down)
  useEffect(() => {
    setPendingRows([]);
    setAppliedRows([]);
    setIsSearchOpen(false);
  }, [currentLevel.id]);

  // Resolve pendingSelectId → currentIndex once records load
  useEffect(() => {
    if (!pendingSelectId || records.length === 0) return;
    const idx = records.findIndex((r) => r[currentLevel.idField] === pendingSelectId);
    if (idx !== -1) {
      setCurrentIndex(idx);
      setViewMode("detail");
    }
    setPendingSelectId(null);
  }, [pendingSelectId, records, currentLevel.idField]);

  // Sync drill state → URL (l0=rootId, l1=childId, l2=grandchildId …)
  useEffect(() => {
    if (viewMode === "detail" && currentRecordId) {
      const ids = drillStack.map((d) => d.parentId);
      ids.push(currentRecordId);
      writeUrlLevels(ids);
    } else if (viewMode === "list" && drillStack.length === 0) {
      writeUrlLevels([]);
    }
  }, [viewMode, drillStack, currentRecordId]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (data: AnyRecord) => {
      if (isCreating) {
        const createData = { ...data };
        if (parentDrill && currentLevel.parentField) {
          createData[
            currentLevel.parentField
              .replace("Id", "_id")
              .replace(/([A-Z])/g, "_$1")
              .toLowerCase()
          ] = parentDrill.parentId;
          createData["sys_" + currentLevel.parentField.replace("Id", "_id")] = parentDrill.parentId;
        }
        return apiClient.post(currentLevel.endpoint, createData);
      }
      return apiClient.patch(`${currentLevel.endpoint}/${currentRecordId}`, data);
    },
    onSuccess: () => {
      toast.success(isCreating ? "Record created" : "Record saved");
      setHasChanges(false);
      setIsCreating(false);
      queryClient.invalidateQueries({ queryKey: ["ad-records", currentLevel.endpoint] });
      refetch();
    },
    onError: (error: any) => {
      const msg = error?.message || "Save failed";
      toast.error(Array.isArray(msg) ? msg.join(", ") : msg);
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!currentRecordId) throw new Error("No record selected");
      return apiClient.patch(`${currentLevel.endpoint}/${currentRecordId}`, { is_active: false });
    },
    onSuccess: () => {
      toast.success("Record deactivated");
      queryClient.invalidateQueries({ queryKey: ["ad-records", currentLevel.endpoint] });
      refetch();
    },
    onError: (error: any) => {
      toast.error(error?.message || "Delete failed");
    },
  });

  // Navigation
  const globalIndex = (page - 1) * 100 + currentIndex;
  const canGoPrev = globalIndex > 0;
  const canGoNext = globalIndex < totalCount - 1;

  const goFirst = useCallback(() => {
    setPage(1);
    setCurrentIndex(0);
    setIsCreating(false);
  }, []);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    } else if (page > 1) {
      setPage(page - 1);
      setCurrentIndex(99);
    }
    setIsCreating(false);
  }, [currentIndex, page]);

  const goNext = useCallback(() => {
    if (currentIndex < records.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else if (page < totalPages) {
      setPage(page + 1);
      setCurrentIndex(0);
    }
    setIsCreating(false);
  }, [currentIndex, records.length, page, totalPages]);

  const goLast = useCallback(() => {
    setPage(totalPages);
    setCurrentIndex(0);
    setIsCreating(false);
  }, [totalPages]);

  // Drill down into child record — stores the child's ID so it's selected once records load
  const handleDrillDown = useCallback(
    (childRecord: AnyRecord, childLevel: ADLevel) => {
      const levelIndex = config.levels.findIndex((l) => l.id === childLevel.id);
      if (levelIndex === -1) return;

      const childRecordId = childRecord[childLevel.idField] as string;

      setDrillStack((prev) => [
        ...prev,
        {
          levelIndex,
          parentId: currentRecordId!,
          parentName: currentRecordName || "",
        },
      ]);
      setPendingSelectId(childRecordId);
      setCurrentIndex(0);
      setPage(1);
      setIsCreating(false);
      setHasChanges(false);
    },
    [config.levels, currentRecordId, currentRecordName]
  );

  // Navigate back up the breadcrumb
  const navigateToLevel = useCallback((targetStackIndex: number) => {
    if (targetStackIndex < 0) {
      setDrillStack([]);
      setViewMode("list");
      writeUrlLevels([]);
    } else {
      setDrillStack((prev) => prev.slice(0, targetStackIndex + 1));
    }
    setCurrentIndex(0);
    setPage(1);
    setIsCreating(false);
    setHasChanges(false);
    setPendingSelectId(null);
  }, []);

  // Build breadcrumb levels — always start with Dashboard link
  const breadcrumbLevels: BreadcrumbLevel[] = [
    {
      label: "Dashboard",
      onClick: undefined, // rendered as Link separately
    },
    {
      label: rootLevel.label,
      recordName: drillStack.length > 0 ? undefined : currentRecordName,
      onClick: drillStack.length > 0 ? () => navigateToLevel(-1) : undefined,
    },
  ];

  drillStack.forEach((drill, idx) => {
    const level = config.levels[drill.levelIndex];
    const isLast = idx === drillStack.length - 1;
    breadcrumbLevels.push({
      label: level.label,
      recordName: isLast ? currentRecordName : drill.parentName,
      onClick: isLast ? undefined : () => navigateToLevel(idx),
    });
  });

  // Switch to detail view when clicking a row in list mode
  const handleRowSelect = useCallback(
    (row: AnyRecord) => {
      const idx = records.findIndex((r) => r[currentLevel.idField] === row[currentLevel.idField]);
      if (idx !== -1) setCurrentIndex(idx);
      setViewMode("detail");
    },
    [records, currentLevel.idField]
  );

  // Toolbar handlers
  const handleNew = () => {
    setIsCreating(true);
    setViewMode("detail");
    setFormData({});
    setHasChanges(false);
  };

  const handleSave = () => {
    saveMutation.mutate(formData);
  };

  const handleUndo = () => {
    if (currentRecord) {
      setFormData(currentRecord);
    } else {
      setFormData({});
    }
    setHasChanges(false);
    setIsCreating(false);
  };

  const handleFormSubmit = async (data: AnyRecord) => {
    setFormData(data);
    saveMutation.mutate(data);
  };

  const handleSearchToggle = () => {
    setIsSearchOpen((prev) => !prev);
    if (isSearchOpen) {
      setPendingRows([...appliedRows]);
    }
  };

  const handleApplyFilters = () => {
    setAppliedRows([...pendingRows]);
    setCurrentIndex(0);
  };

  const handleClearFilters = () => {
    setPendingRows([]);
    setAppliedRows([]);
    setCurrentIndex(0);
  };

  if (isError) return <RecordLoadError error={error} onRetry={() => { void refetch(); }} />;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <ADToolbar
        onNew={handleNew}
        onSave={handleSave}
        onDelete={() => deleteMutation.mutate()}
        onUndo={handleUndo}
        onRefresh={() => refetch()}
        onAdvancedSearchToggle={handleSearchToggle}
        isAdvancedSearchOpen={isSearchOpen}
        advancedFilterCount={appliedRows.filter((r) => r.value !== "").length}
        isSaving={saveMutation.isPending}
        isDeleting={deleteMutation.isPending}
        hasChanges={hasChanges || isCreating}
        canDelete={!!currentRecordId && !isCreating}
      />

      {/* Filter Builder Panel */}
      {isSearchOpen && (
        <FilterBuilder
          fields={currentLevel.gridFields}
          rows={pendingRows}
          onChange={setPendingRows}
          onApply={handleApplyFilters}
          onClear={handleClearFilters}
        />
      )}

      {/* Breadcrumb + Record Nav */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-background">
        <div className="flex items-center gap-2">
          {viewMode === "detail" && (
            <button
              onClick={() => {
                setViewMode("list");
                setIsCreating(false);
                setHasChanges(false);
                if (drillStack.length === 0) writeUrlLevels([]);
              }}
              className="text-sm text-primary hover:underline font-medium"
            >
              ← Back to List
            </button>
          )}
          {/* Dashboard home link */}
          <Link
            to="/dashboard"
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary transition-colors"
          >
            <Home className="h-3.5 w-3.5" />
            <span>Dashboard</span>
          </Link>
          <span className="text-muted-foreground text-sm">/</span>
          <ADBreadcrumb levels={breadcrumbLevels.slice(1)} />
          {appliedRows.filter((r) => r.value !== "").length > 0 && (
            <span className="text-xs text-muted-foreground ml-2">({totalCount} filtered)</span>
          )}
        </div>
        {viewMode === "detail" && !isCreating && (
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
        )}
      </div>

      {/* Content Area */}
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
        ) : viewMode === "list" ? (
          /* ===== LIST VIEW ===== */
          records.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <p className="text-lg">
                {appliedRows.filter((r) => r.value !== "").length > 0
                  ? "No records match your filters"
                  : "No records found"}
              </p>
              <p className="text-sm mt-1">
                {appliedRows.filter((r) => r.value !== "").length > 0
                  ? "Try adjusting your filters"
                  : `Click + to create a new ${currentLevel.label.toLowerCase()}`}
              </p>
            </div>
          ) : (
            <div className="p-4">
              <DynamicTable
                tableName={currentLevel.id}
                fields={currentLevel.gridFields || currentLevel.formFields}
                data={records}
                isLoading={isLoading}
                totalCount={totalCount}
                page={page}
                pageSize={100}
                onPageChange={setPage}
                onRowClick={handleRowSelect}
              />
            </div>
          )
        ) : /* ===== DETAIL VIEW ===== */
        records.length === 0 && !isCreating ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <p className="text-lg">No records found</p>
            <p className="text-sm mt-1">
              Click + to create a new {currentLevel.label.toLowerCase()}
            </p>
          </div>
        ) : (
          <>
            {/* Form Panel */}
            <div className="p-6 border-b border-border">
              <DynamicForm
                tableName={currentLevel.id}
                fields={currentLevel.formFields}
                initialData={isCreating ? {} : currentRecord || {}}
                onSubmit={handleFormSubmit}
                mode={isCreating ? "create" : "edit"}
                isSaving={saveMutation.isPending}
              />
            </div>

            {/* Child Tabs */}
            {currentLevel.childTabs &&
              currentLevel.childTabs.length > 0 &&
              currentRecordId &&
              !isCreating && (
                <div className="border-t border-border">
                  <Tabs value={activeChildTab} onValueChange={setActiveChildTab}>
                    <div className="border-b border-border bg-muted/30">
                      <TabsList className="h-auto p-0 bg-transparent rounded-none">
                        {currentLevel.childTabs.map((tab) => (
                          <ChildTabTrigger
                            key={tab.id}
                            tab={tab}
                            parentId={currentRecordId}
                            isActive={activeChildTab === tab.id}
                          />
                        ))}
                      </TabsList>
                    </div>
                    {currentLevel.childTabs.map((tab) => (
                      <TabsContent key={tab.id} value={tab.id} className="m-0">
                        <ChildTabPanel
                          tab={tab}
                          parentId={currentRecordId}
                          parentIdField={currentLevel.idField}
                          onDrillDown={handleDrillDown}
                        />
                      </TabsContent>
                    ))}
                  </Tabs>
                </div>
              )}
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Child Tab Trigger with count badge
// ============================================================================

function ChildTabTrigger({
  tab,
  parentId,
  isActive,
}: {
  tab: ADChildTabConfig;
  parentId: string;
  isActive: boolean;
}) {
  const level = tab.level;
  const params: Record<string, unknown> = { limit: 1 };
  if (level.parentField) {
    params[level.parentField] = parentId;
  }

  const { data } = useQuery({
    queryKey: ["ad-child-count", level.endpoint, parentId],
    queryFn: () => apiClient.get<PaginatedResponse<AnyRecord>>(level.endpoint, params),
    enabled: !!parentId && tab.badge === "count",
  });

  const count = data?.meta?.total;

  return (
    <TabsTrigger
      value={tab.id}
      className={`rounded-none border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
        isActive
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {tab.label}
      {count !== undefined && (
        <Badge variant="secondary" className="ml-2 h-5 min-w-[20px] px-1.5 text-xs">
          {count}
        </Badge>
      )}
    </TabsTrigger>
  );
}
