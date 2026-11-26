import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet, useChildMatches } from "@tanstack/react-router";
import { ArrowRight, FileText, Home, Plus } from "lucide-react";
import { useMemo } from "react";
import { ADSidebar } from "@/components/admin/ad-sidebar";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api-client";
import { useDictionaryTabs } from "@/hooks/use-dictionary-windows";

export const Route = createFileRoute("/admin/reports")({
  component: ReportsRoute,
});

/**
 * The list, or the designer beneath it.
 *
 * `reports.$tableName.tsx` is this route's child, and a parent that renders no
 * `<Outlet />` renders only itself — so every "Edit Design" link changed the
 * address and left the list on screen, and no administrator could open the
 * designer for any entity. A wrapper rather than an early return inside the
 * list, whose hooks would then run on one render and not the next.
 */
function ReportsRoute() {
  const children = useChildMatches();
  return children.length > 0 ? <Outlet /> : <ReportsListPage />;
}

interface ReportDesign {
  id: string;
  table_name: string;
  name: string;
  updated_at: string;
}

function ReportsListPage() {
  // One card per record type, named as its window names it. The designs are
  // filed under the storage key, which is the link's value and nothing more.
  const { data: dictionary } = useDictionaryTabs();

  const { data: designs } = useQuery({
    queryKey: ["report-designs-list"],
    queryFn: () => apiClient.get<ReportDesign[]>("/sys/report-designs"),
  });

  const tables = useMemo(() => {
    const seen = new Set<string>();
    return [...(dictionary ?? [])]
      .sort((a, b) => a.level - b.level)
      .filter((tab) => (seen.has(tab.tableName) ? false : (seen.add(tab.tableName), true)))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [dictionary]);
  const designMap = new Map<string, ReportDesign>(
    (designs ?? []).map((d) => [d.table_name, d])
  );

  return (
    <ADSidebar>
      <div className="flex flex-col h-full">
        <header className="border-b border-border bg-card px-8 py-8">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
            <Link
              to="/dashboard"
              className="flex items-center gap-1 hover:text-primary transition-colors"
            >
              <Home className="h-3.5 w-3.5" />
              Dashboard
            </Link>
            <span>/</span>
            <Link to="/admin" className="hover:text-primary transition-colors">
              Admin
            </Link>
            <span>/</span>
            <span className="text-foreground">Report Designs</span>
          </div>
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-4xl font-bold tracking-tight text-foreground font-display flex items-center gap-3">
                <FileText className="h-8 w-8 text-primary" />
                Report Designs
              </h1>
              <p className="text-muted-foreground mt-2 max-w-xl">
                Design document reports for each entity. Once designed, users see a Print button when viewing records.
              </p>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-auto px-8 py-8">
          {tables.length === 0 ? (
            <p className="text-muted-foreground">No windows found.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {tables.map((table) => {
                const design = designMap.get(table.tableName);
                return (
                  <Link
                    key={table.tabId}
                    to={`/admin/reports/${table.tableName}` as never}
                    className="group relative rounded-xl border border-border bg-card p-6 hover:border-primary/50 hover:shadow-md transition-all"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <FileText className="h-6 w-6 text-muted-foreground group-hover:text-primary transition-colors" />
                      {design ? (
                        <span className="text-xs bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800 rounded-full px-2 py-0.5 font-medium">
                          Designed
                        </span>
                      ) : (
                        <span className="text-xs bg-muted text-muted-foreground border border-border rounded-full px-2 py-0.5 flex items-center gap-1">
                          <Plus className="h-3 w-3" />
                          New
                        </span>
                      )}
                    </div>
                    <h3 className="font-semibold text-foreground mb-1">{table.label}</h3>
                    {table.help && (
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {table.help.split("\n")[0]}
                      </p>
                    )}
                    {design && (
                      <p className="text-xs text-muted-foreground mt-2">
                        Last updated: {new Date(design.updated_at).toLocaleDateString()}
                      </p>
                    )}
                    <div className="mt-4 flex items-center gap-1 text-sm font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                      {design ? "Edit Design" : "Create Design"}
                      <ArrowRight className="h-4 w-4" />
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </ADSidebar>
  );
}
