import { Link, useRouterState } from "@tanstack/react-router";
import {
  AppWindow,
  Database,
  FileText,
  Hash,
  LayoutList,
  Menu,
  Printer,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Tags,
  X,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MENU_ITEMS = [
  {
    label: "Table and Column",
    to: "/admin/tables",
    icon: Database,
  },
  {
    label: "Window, Tab and Field",
    to: "/admin/windows",
    icon: AppWindow,
  },
  {
    label: "Element",
    to: "/admin/elements",
    icon: FileText,
  },
  {
    label: "Reference",
    to: "/admin/references",
    icon: Hash,
  },
  {
    label: "Entity Categories",
    to: "/admin/categories",
    icon: Tags,
  },
  {
    label: "Field Layout Manager",
    to: "/admin/fields",
    icon: LayoutList,
  },
  {
    label: "Rules & workflows",
    to: "/admin/automations",
    icon: Settings,
  },
  {
    label: "Audit Log",
    to: "/admin/audit",
    icon: ShieldCheck,
  },
  {
    label: "Report Designs",
    to: "/admin/reports",
    icon: Printer,
  },
  {
    label: "System Configuration",
    to: "/admin/system-config",
    icon: SlidersHorizontal,
  },
];

interface ADSidebarProps {
  children: React.ReactNode;
}

export function ADSidebar({ children }: ADSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside
        className={cn(
          "border-r border-border bg-card flex-shrink-0 transition-all duration-200",
          collapsed ? "w-0 overflow-hidden lg:w-12" : "w-64"
        )}
      >
        <div className="flex flex-col h-full">
          {/* Sidebar Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            {!collapsed && (
              <Link to="/admin" className="flex items-center gap-2">
                <Settings className="h-5 w-5 text-primary" />
                <span className="font-semibold text-sm">App Dictionary</span>
              </Link>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCollapsed(!collapsed)}
              className="h-7 w-7 p-0 lg:flex hidden"
            >
              {collapsed ? <Menu className="h-4 w-4" /> : <X className="h-4 w-4" />}
            </Button>
          </div>

          {/* Menu Items */}
          {!collapsed && (
            <nav className="flex-1 py-2">
              {MENU_ITEMS.map((item) => {
                const isActive = currentPath === item.to || currentPath.startsWith(item.to + "/");
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={cn(
                      "flex items-center gap-3 px-4 py-2.5 text-sm transition-colors",
                      isActive
                        ? "bg-primary/10 text-primary font-medium border-r-2 border-primary"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    )}
                  >
                    <item.icon className="h-4 w-4 flex-shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          )}
        </div>
      </aside>

      {/* Mobile toggle */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setCollapsed(!collapsed)}
        className="fixed bottom-4 left-4 z-50 lg:hidden h-10 w-10 p-0 bg-primary text-primary-foreground rounded-full shadow-lg"
      >
        <Menu className="h-5 w-5" />
      </Button>

      {/* Main Content */}
      <div className="flex-1 min-w-0 overflow-auto">{children}</div>
    </div>
  );
}
