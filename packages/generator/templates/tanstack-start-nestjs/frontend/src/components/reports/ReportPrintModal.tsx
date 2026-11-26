import { useQueries } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Printer, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { FieldMetadata } from "@/hooks/use-entities";
import { apiClient } from "@/lib/api-client";
import { referenceLabel } from "@/lib/utils";
// AnkaReport ships its stylesheet as a separate file rather than inlining it in
// the bundle, so importing the module alone gives an unstyled document.
import "ankareport/dist/ankareport.css";

interface ReportPrintModalProps {
  open: boolean;
  onClose: () => void;
  layout: object;
  /** The record data to render into the report */
  data: Record<string, unknown>;
  entityLabel?: string;
  /**
   * The entity's dictionary columns.
   *
   * Without them the report prints what is stored — a foreign key as a uuid, a
   * list value as its stored key — which is not a document anybody would hand
   * to a customer. With them each value is resolved the same way the screen
   * resolves it, through the same queries, so the printed page and the record
   * in front of the user say the same thing.
   */
  fields?: FieldMetadata[];
}

interface AnkaRenderer {
  exportToPdf?: (name: string) => Promise<void>;
  exportToXlsx?: (name: string) => Promise<void>;
}

interface AnkaModule {
  render: (options: { element: HTMLDivElement; layout: object; data: unknown }) => AnkaRenderer;
}

/** The library's API, whether the bundler gave us its namespace or its default. */
function resolveAnka(module: unknown): AnkaModule {
  const candidate = (module as { default?: unknown }).default ?? module;
  return candidate as AnkaModule;
}

/** Columns that describe the row's bookkeeping rather than its content. */
const HIDDEN_COLUMNS = new Set(["deleted_at", "version"]);

/**
 * What a bound field shows.
 *
 * The renderer prints a bound item's raw value, and falls back to the literal
 * `[column_name]` when that value is empty — so a null column in a record
 * renders as its own name in the middle of a document. Every value is
 * therefore resolved to something a reader can read: dates as dates, booleans
 * as words, and an absent value as a dash.
 */
function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value instanceof Date) return value.toLocaleString();
  if (typeof value === "string") {
    // An ISO timestamp is the common case and reads badly unformatted.
    const asDate = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) ? new Date(value) : null;
    if (asDate && !Number.isNaN(asDate.getTime())) return asDate.toLocaleString();
    return value;
  }
  if (typeof value === "number") return String(value);
  return JSON.stringify(value);
}

/** Dictionary reference ids: 15 a date, 16 a date and time, 11 an integer, 12 a number. */
function typedDisplay(referenceId: number): ((value: unknown) => string | null) | null {
  if (referenceId === 15) {
    return (value) => {
      const date = new Date(String(value));
      // A date has no time zone; read it in UTC, which is how it was stored.
      return Number.isNaN(date.getTime())
        ? null
        : date.toLocaleDateString(undefined, { timeZone: "UTC", dateStyle: "medium" });
    };
  }
  if (referenceId === 16) {
    return (value) => {
      const date = new Date(String(value));
      return Number.isNaN(date.getTime())
        ? null
        : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    };
  }
  if (referenceId === 11 || referenceId === 12) {
    return (value) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return null;
      return referenceId === 11
        ? n.toLocaleString()
        : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
    };
  }
  return null;
}

/** A column pointing at another table — its value is an id, not a word. */
function isTableReference(field: FieldMetadata): boolean {
  return Boolean(field.ref_table_name || field.ref_endpoint);
}

/** A column drawing from a reference list — its value is a stored key. */
function isListReference(field: FieldMetadata): boolean {
  return !isTableReference(field) && Number(field.sys_reference_id) >= 1000;
}

function labelFieldsOf(field: FieldMetadata): string[] {
  const declared = (field as { ref_label_fields?: string[] }).ref_label_fields;
  if (declared?.length) return declared;
  return field.ref_label_field ? [field.ref_label_field] : ["name"];
}

/** One fetch per referenced table, however many columns point at it. */
function referenceEndpoint(field: FieldMetadata): string | null {
  if (field.ref_endpoint) return field.ref_endpoint;
  if (field.ref_table_name) return `/bus/${field.ref_table_name.replace(/^bus_/, "")}`;
  return null;
}

interface RefListValue {
  value: string;
  name: string;
}

function printableRecord(
  data: Record<string, unknown>,
  resolve: (column: string, value: unknown) => string | null
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (HIDDEN_COLUMNS.has(key)) continue;
    out[key] = resolve(key, value) ?? displayValue(value);
  }
  return out;
}

export function ReportPrintModal({
  open,
  onClose,
  layout,
  data,
  entityLabel,
  fields = [],
}: ReportPrintModalProps) {
  /**
   * A callback ref, not `useRef`.
   *
   * The dialog renders through a portal that mounts on a later commit than the
   * one that flipped `open` to true, so an effect keyed on `open` alone runs
   * while `ref.current` is still null and returns early every time. The report
   * never rendered and nothing reported an error, because "no container yet"
   * is not an error. Keying the effect on the element itself means it runs
   * exactly when there is somewhere to render into.
   */
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const rendererRef = useRef<AnkaRenderer | null>(null);
  const [error, setError] = useState<string | null>(null);

  /*
   * Resolve the record's stored values into the words the screen shows.
   *
   * Two kinds of column need it, and the queries are the ones the list and the
   * form already make — same paths, same shapes — so on a record the user has
   * open these are cache hits rather than new traffic.
   */
  const tableSources = useMemo(() => {
    const byEndpoint = new Map<string, FieldMetadata>();
    for (const field of fields) {
      if (!isTableReference(field)) continue;
      if (data[field.column_name] == null) continue;
      const endpoint = referenceEndpoint(field);
      if (endpoint && !byEndpoint.has(endpoint)) byEndpoint.set(endpoint, field);
    }
    return [...byEndpoint].map(([endpoint, field]) => ({ endpoint, field }));
  }, [fields, data]);

  const listSources = useMemo(() => {
    const ids = new Set<number>();
    for (const field of fields) {
      if (isListReference(field) && data[field.column_name] != null) {
        ids.add(Number(field.sys_reference_id));
      }
    }
    return [...ids];
  }, [fields, data]);

  const tableResults = useQueries({
    queries: tableSources.map(({ endpoint }) => ({
      // The same key `dynamic-table` uses, so the two share one cached fetch.
      queryKey: ["lookup", endpoint, endpoint],
      queryFn: () =>
        apiClient.get<{ data: Array<Record<string, unknown>> }>(endpoint, { limit: 500 }),
      enabled: open,
      staleTime: 60_000,
    })),
  });

  const listResults = useQueries({
    queries: listSources.map((sysReferenceId) => ({
      queryKey: ["ref-list", sysReferenceId],
      queryFn: async () => {
        const response = await apiClient.get<{ data: RefListValue[] }>(
          `/sys/ref-list?sys_reference_id=${sysReferenceId}`
        );
        return response.data;
      },
      enabled: open,
      staleTime: 60 * 60 * 1000,
    })),
  });

  /** column name → stored value → what to print. */
  const resolved = useMemo(() => {
    const byEndpoint = new Map<string, Record<string, string>>();
    tableSources.forEach(({ endpoint, field }, index) => {
      const payload = tableResults[index]?.data;
      if (!payload) return;
      const records = Array.isArray(payload) ? payload : (payload.data ?? []);
      const idField = field.ref_id_field ?? "id";
      const labelFields = labelFieldsOf(field);
      const map: Record<string, string> = {};
      for (const record of records) {
        const id = String(record[idField] ?? "");
        if (id) map[id] = referenceLabel(record, labelFields, id);
      }
      byEndpoint.set(endpoint, map);
    });

    const byReferenceId = new Map<number, Record<string, string>>();
    listSources.forEach((sysReferenceId, index) => {
      const values = listResults[index]?.data;
      if (!values) return;
      const map: Record<string, string> = {};
      for (const value of values) map[String(value.value)] = value.name;
      byReferenceId.set(sysReferenceId, map);
    });

    const byColumn = new Map<string, (value: unknown) => string | null>();
    for (const field of fields) {
      // The column's declared type decides how its value reads on paper. A
      // date column came back as a midnight timestamp ("2/15/2001, 12:00:00
      // AM", and a day early west of UTC), and a NUMERIC as PostgreSQL's
      // padded string ("1.500000").
      const typed = typedDisplay(Number(field.sys_reference_id));
      if (typed) {
        byColumn.set(field.column_name, typed);
        continue;
      }
      if (isTableReference(field)) {
        const endpoint = referenceEndpoint(field);
        if (!endpoint) continue;
        byColumn.set(field.column_name, (value) => {
          const map = byEndpoint.get(endpoint);
          return map?.[String(value)] ?? null;
        });
      } else if (isListReference(field)) {
        const sysReferenceId = Number(field.sys_reference_id);
        byColumn.set(field.column_name, (value) => {
          const map = byReferenceId.get(sysReferenceId);
          return map?.[String(value)] ?? null;
        });
      }
    }
    return byColumn;
  }, [fields, tableSources, tableResults, listSources, listResults]);

  const printable = useMemo(
    () =>
      printableRecord(data, (column, value) => {
        if (value == null || value === "") return null;
        return resolved.get(column)?.(value) ?? null;
      }),
    [data, resolved]
  );

  useEffect(() => {
    if (!open || !container) return;

    const el = container;
    let cancelled = false;
    setError(null);

    import("ankareport")
      .then((module) => {
        if (cancelled) return;
        // AnkaReport declares a `browser` entry pointing at its UMD build, so
        // the bundler hands back an interop namespace whose only key is
        // `default`. Reading `render` straight off the namespace finds nothing
        // and the document silently never renders — the modal opens on a blank
        // page. `default ?? module` covers both resolutions.
        const anka = resolveAnka(module);
        rendererRef.current = anka.render({
          element: el,
          layout,
          // The content section repeats over `records`; the flat copy is kept
          // beside it so header and footer items can bind to the same record.
          data: { ...printable, records: [printable] },
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
      rendererRef.current = null;
      while (el.firstChild) {
        el.removeChild(el.firstChild);
      }
    };
  }, [open, container, layout, printable]);

  const fileStem = (entityLabel ?? "report").toLowerCase().replace(/[^a-z0-9]+/g, "-");

  const handleExportPdf = () => {
    rendererRef.current?.exportToPdf?.(`${fileStem}.pdf`)?.catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err));
    });
  };

  const handleExportXlsx = () => {
    rendererRef.current?.exportToXlsx?.(`${fileStem}.xlsx`)?.catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err));
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-4xl w-full h-[90vh] flex flex-col p-0">
        <DialogHeader className="flex flex-row items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <DialogTitle className="text-base font-semibold">
            {entityLabel ? `Print — ${entityLabel}` : "Print Report"}
          </DialogTitle>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleExportPdf}>
              <Printer className="h-4 w-4 mr-2" />
              Export PDF
            </Button>
            <Button size="sm" variant="outline" onClick={handleExportXlsx}>
              Export Excel
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>
        <div className="flex-1 overflow-auto p-6 bg-muted/30">
          {error && (
            <p className="mb-4 text-sm text-destructive">
              The document could not be rendered: {error}
            </p>
          )}
          <div ref={setContainer} className="mx-auto bg-card shadow-sm" />
        </div>
      </DialogContent>
    </Dialog>
  );
}
