import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AppWindow,
  ArrowRight,
  BarChart3,
  Columns,
  Database,
  FileText,
  Hash,
  Home,
  Layers,
  LayoutList,
  Printer,
  RefreshCw,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Table2,
} from "lucide-react";
import { ADSidebar } from "@/components/admin/ad-sidebar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiClient, type PaginatedResponse } from "@/lib/api-client";

export const Route = createFileRoute("/admin/")({
  component: AdminDashboardPage,
});

interface CountResponse {
  meta: { total: number };
}

function AdminDashboardPage() {
  const {
    data: tablesRes,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["admin", "tables-count"],
    queryFn: () => apiClient.get<CountResponse>("/sys/tables", { limit: 1 }),
  });
  const { data: columnsRes } = useQuery({
    queryKey: ["admin", "columns-count"],
    queryFn: () => apiClient.get<CountResponse>("/sys/columns", { limit: 1 }),
  });
  const { data: windowsRes } = useQuery({
    queryKey: ["admin", "windows-count"],
    queryFn: () => apiClient.get<CountResponse>("/sys/windows", { limit: 1 }),
  });
  const { data: tabsRes } = useQuery({
    queryKey: ["admin", "tabs-count"],
    queryFn: () => apiClient.get<CountResponse>("/sys/tabs", { limit: 1 }),
  });
  const { data: fieldsRes } = useQuery({
    queryKey: ["admin", "fields-count"],
    queryFn: () => apiClient.get<CountResponse>("/sys/fields", { limit: 1 }),
  });
  const { data: refsRes } = useQuery({
    queryKey: ["admin", "references-count"],
    queryFn: () => apiClient.get<CountResponse>("/sys/references", { limit: 1 }),
  });

  const stats = [
    { label: "Tables", count: tablesRes?.meta?.total || 0, icon: Table2, color: "text-blue-600 dark:text-blue-400" },
    {
      label: "Columns",
      count: columnsRes?.meta?.total || 0,
      icon: Columns,
      color: "text-indigo-600 dark:text-indigo-400",
    },
    {
      label: "Windows",
      count: windowsRes?.meta?.total || 0,
      icon: AppWindow,
      color: "text-violet-600 dark:text-violet-400",
    },
    { label: "Tabs", count: tabsRes?.meta?.total || 0, icon: Layers, color: "text-purple-600 dark:text-purple-400" },
    {
      label: "Fields",
      count: fieldsRes?.meta?.total || 0,
      icon: LayoutList,
      color: "text-pink-600 dark:text-pink-400",
    },
    {
      label: "References",
      count: refsRes?.meta?.total || 0,
      icon: Hash,
      color: "text-emerald-600 dark:text-emerald-400",
    },
  ];

  const windows = [
    {
      title: "Table and Column",
      description: "Browse database tables and their column definitions in master/detail view",
      icon: Database,
      to: "/admin/tables" as const,
    },
    {
      title: "Window, Tab and Field",
      description: "Manage application windows with nested tabs and field configurations",
      icon: AppWindow,
      to: "/admin/windows" as const,
    },
    {
      title: "Element",
      description: "Manage system elements — column names, print names, and descriptions",
      icon: FileText,
      to: "/admin/elements" as const,
    },
    {
      title: "Reference",
      description: "Manage data types, validation rules, and lookup definitions",
      icon: Hash,
      to: "/admin/references" as const,
    },
    {
      title: "Field Layout Manager",
      description: "Customize field order, visibility, and grouping with drag-and-drop",
      icon: LayoutList,
      to: "/admin/fields" as const,
    },
    {
      title: "Rules & workflows",
      description: "Write the rules that judge a write, and the lifecycles, processes and status machines around it",
      icon: Settings,
      to: "/admin/automations" as const,
    },
    {
      title: "Audit Log",
      description: "Immutable tamper-proof audit trail of all user and system actions",
      icon: ShieldCheck,
      to: "/admin/audit" as const,
    },
    {
      title: "Report Designs",
      description: "Design printable document reports for each entity; users get a Print button on their records",
      icon: Printer,
      to: "/admin/reports" as const,
    },
    {
      title: "Analysis",
      description:
        "The questions this model declared with %%report, answered against this database",
      icon: BarChart3,
      to: "/admin/analysis" as const,
    },
    {
      title: "System Configuration",
      description: "Runtime settings: AI endpoints, feature toggles, rate limits, and application identity",
      icon: SlidersHorizontal,
      to: "/admin/system-config" as const,
    },
  ];

  return (
    <ADSidebar>
      <div className="flex flex-col h-full">
        {/* Header */}
        <header className="border-b border-border bg-card px-8 py-8">
          <div className="flex items-start justify-between">
            <div>
              <Link
                to="/dashboard"
                className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary transition-colors mb-3"
              >
                <Home className="h-3.5 w-3.5" />
                Back to Dashboard
              </Link>
              <h1 className="text-4xl font-bold tracking-tight text-foreground font-display">
                Application Dictionary
              </h1>
              <p className="text-muted-foreground mt-2 max-w-xl">
                Manage entities, field layouts, and application configuration
              </p>
            </div>
            <Button variant="outline" size="default" onClick={() => refetch()} disabled={isLoading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </header>

        <div className="flex-1 overflow-auto px-8 py-8 space-y-8">
          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {stats.map((stat) => (
              <div key={stat.label} className="border border-border rounded-lg p-4 bg-card">
                <div className="flex items-center gap-2 mb-2">
                  <stat.icon className={`h-4 w-4 ${stat.color}`} />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {stat.label}
                  </span>
                </div>
                <p className="text-3xl font-bold text-foreground tabular-nums">{stat.count}</p>
              </div>
            ))}
          </div>

          {/* Window Cards */}
          <div>
            <h2 className="text-lg font-semibold mb-4">Dictionary Windows</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {windows.map((win) => (
                <Link key={win.to} to={win.to}>
                  <Card className="group hover:border-primary/50 transition-all cursor-pointer h-full">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <win.icon className="h-6 w-6 text-primary" />
                        <ArrowRight className="h-4 w-4 text-primary opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                      <CardTitle className="text-lg">{win.title}</CardTitle>
                      <CardDescription>{win.description}</CardDescription>
                    </CardHeader>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </ADSidebar>
  );
}
