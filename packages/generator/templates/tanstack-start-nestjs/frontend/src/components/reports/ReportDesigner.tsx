import { useEffect, useState } from "react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
// The designer is almost entirely CSS — panels, the property grid, the ruler.
// AnkaReport keeps its stylesheet out of the JS bundle, so without this import
// the designer mounts as a stack of unstyled divs.
import "ankareport/dist/ankareport.css";

interface ReportDesignerProps {
  /** The storage key the design is filed under. Never shown. */
  tableName: string;
  /**
   * The data-source tree: the window's fields under their own labels, bound by
   * the key the record carries. Labels used to be guessed from column names
   * (`balance_due` → "Balance Due"), which is right until a field is renamed.
   */
  fields: Array<{ label: string; field: string }>;
  onSaved?: () => void;
}

export function ReportDesigner({ tableName, fields, onSaved }: ReportDesignerProps) {
  // A callback ref rather than `useRef`: the effect then runs when the element
  // exists rather than on the render that asked for it, which is the difference
  // wherever the mount is deferred — a portal, a tab, a suspended boundary.
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!container) return;

    const el = container;
    let cancelled = false;
    let instance: { dispose?: () => void } | undefined;

    const dataSource = fields;

    const start = async () => {
      // AnkaReport's `browser` entry is its UMD build, so the bundler hands
      // back an interop namespace whose only key is `default`. Reading
      // `designer` off the namespace itself finds nothing and the designer
      // never mounts. `default ?? module` covers both resolutions.
      const module = await import("ankareport");
      const anka = ((module as { default?: unknown }).default ?? module) as {
        designer: (options: {
          element: HTMLDivElement;
          dataSource?: Array<{ label: string; field: string }>;
          layout?: object;
          onSaveButtonClick?: (layout: object) => void;
        }) => { dispose?: () => void };
      };

      let existingLayout: object | undefined;
      try {
        const design = await apiClient.get<{ layout?: object } | null>(
          `/sys/report-designs/${tableName}`
        );
        existingLayout = design?.layout ?? undefined;
      } catch {
        // No design stored yet — the designer opens on a blank page.
      }

      if (cancelled) return;

      instance = anka.designer({
        element: el,
        dataSource,
        layout: existingLayout,
        onSaveButtonClick: (layout: object) => {
          setIsSaving(true);
          apiClient
            .put(`/sys/report-designs/${tableName}`, { layout })
            .then(() => {
              toast.success("Report design saved");
              onSaved?.();
            })
            .catch((err: unknown) => {
              toast.error(err instanceof Error ? err.message : "Failed to save report design");
            })
            .finally(() => setIsSaving(false));
        },
      });
    };

    start().catch((err: unknown) => {
      if (cancelled) return;
      setError(err instanceof Error ? err.message : String(err));
    });

    return () => {
      cancelled = true;
      if (instance && typeof instance.dispose === "function") {
        instance.dispose();
      }
      // Remove all child nodes without setting innerHTML
      while (el.firstChild) {
        el.removeChild(el.firstChild);
      }
    };
  }, [container, tableName, fields, onSaved]);

  return (
    <div className="flex flex-col h-full">
      {isSaving && (
        <div className="px-4 py-2 text-sm text-muted-foreground border-b border-border">
          Saving report design…
        </div>
      )}
      {error && (
        <div className="px-4 py-2 text-sm text-destructive border-b border-border">
          The designer could not be loaded: {error}
        </div>
      )}
      <div ref={setContainer} className="flex-1 w-full" style={{ minHeight: 600 }} />
    </div>
  );
}
