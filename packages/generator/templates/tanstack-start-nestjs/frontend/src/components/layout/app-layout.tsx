/**
 * App Layout Component
 *
 * Main layout wrapper for authenticated pages with sidebar and header.
 */

import { useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Header, Sidebar } from "@/components/layout";
import { MobileSidebar } from "@/components/ui/mobile-sidebar";
import { useAuth } from "@/contexts/auth-context";
import { isEmbedded } from "@/lib/api-client";
import { APP_NAME } from "@/lib/app-meta";

/**
 * Keeps the document title naming the screen.
 *
 * Every screen used to share the application's name as its title, so a tab, a
 * history entry or a screen reader announcing a page change said the same thing
 * everywhere. The screen already says what it is in its heading, so the title
 * follows that heading — including when it arrives late (a record's name) —
 * instead of every route restating it.
 */
function useHeadingTitle(root: React.RefObject<HTMLElement | null>, ready: boolean) {
  useEffect(() => {
    const node = root.current;
    if (!ready || !node) return;
    const apply = () => {
      const heading = node.querySelector("h1")?.textContent?.trim();
      document.title = heading ? `${heading} · ${APP_NAME}` : APP_NAME;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(node, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [root, ready]);
}

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const mainRef = useRef<HTMLElement>(null);
  const pathname = useLocation({ select: (location) => location.pathname });
  const [isNavigationOpen, setNavigationOpen] = useState(false);

  // Choosing a screen in the drawer navigates; the drawer then has done its job.
  useEffect(() => {
    setNavigationOpen(false);
  }, [pathname]);

  // Inside the chat assistant's frame the assistant is the navigation: the
  // sidebar and header are left out and the page fills the frame. Decided after
  // mount, so the server and the first client render agree.
  const [embedded, setEmbedded] = useState(false);
  useEffect(() => {
    setEmbedded(isEmbedded());
  }, []);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      // A sign-in page inside the assistant's frame would be a second front
      // door; the assistant is told instead (see auth-context).
      if (isEmbedded()) {
        window.parent.postMessage({ type: "app:signed-out" }, window.location.origin);
        return;
      }
      navigate({ to: "/auth/login" });
    }
  }, [isAuthenticated, isLoading, navigate]);

  // Before the early returns: the main element only exists once auth settles.
  useHeadingTitle(mainRef, !isLoading && isAuthenticated);

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

  if (embedded) {
    return (
      <main ref={mainRef} className="h-screen overflow-auto p-4" data-embedded="true">
        {children}
      </main>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      {/* Below `md` the sidebar is hidden; the header's menu button opens it here. */}
      <MobileSidebar open={isNavigationOpen} onOpenChange={setNavigationOpen}>
        <Sidebar inDrawer />
      </MobileSidebar>
      <div className="flex flex-col flex-1 overflow-hidden">
        <Header
          onOpenNavigation={() => setNavigationOpen(true)}
          isNavigationOpen={isNavigationOpen}
        />
        <main ref={mainRef} className="flex-1 overflow-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
