/**
 * App Layout Component
 *
 * Main layout wrapper for authenticated pages with sidebar and header.
 */

import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Header, Sidebar } from "@/components/layout";
import { useAuth } from "@/contexts/auth-context";

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const [navigationOpen, setNavigationOpen] = useState(false);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate({ to: "/auth/login" });
    }
  }, [isAuthenticated, isLoading, navigate]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <Dialog open={navigationOpen} onOpenChange={setNavigationOpen}>
      <div className="flex h-dvh overflow-hidden">
        <Sidebar />
        <div className="flex min-w-0 flex-col flex-1 overflow-hidden">
          <Header />
          <main className="flex-1 overflow-auto p-3 sm:p-6">{children}</main>
        </div>
      </div>
      <DialogContent
        className="left-0 top-0 h-dvh w-72 max-w-[90vw] translate-x-0 translate-y-0 gap-0 rounded-none p-0 sm:rounded-none"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">Navigation</DialogTitle>
        <Sidebar mobile className="w-full border-r-0" onNavigate={() => setNavigationOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
