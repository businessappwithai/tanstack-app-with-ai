/**
 * The bell beside Log out.
 *
 * Every write to a business entity is two transactions — the save that commits
 * the record as a draft, and the background one that finalises it or explains
 * why it could not — and this is where a user finds out how theirs ended. The
 * list is read from `/notifications`, which serves that user's own rows of the
 * audit trail and nothing else.
 *
 * Three behaviours are the point of it and are easy to lose in a refactor:
 *
 *   - newest first, because the transaction a user is waiting on is the one
 *     they just started;
 *   - unread items look different from read ones — a tinted row, a solid dot
 *     and a heavier title, not a subtler shade of the same thing;
 *   - opening the panel marks what it shows as read, so the badge means
 *     "things you have not seen" rather than "things that have ever happened".
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AlertCircle, Bell, CheckCircle2, Clock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { apiClient } from "@/lib/api-client";

export type TransactionOutcome = "pending" | "succeeded" | "failed";

export interface TransactionNotification {
  id: string;
  at: string;
  read: boolean;
  outcome: TransactionOutcome;
  phase: "draft" | "finalize";
  operation: "create" | "update" | "delete" | "save";
  entityTable: string;
  entityLabel: string;
  recordId: string | null;
  recordLabel: string;
  title: string;
  detail: string;
  href: string | null;
}

interface NotificationPage {
  data: TransactionNotification[];
  meta: { unread: number; limit: number; nextCursor: string | null };
}

/** "just now", "4 min ago", "2 h ago", then the date. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(iso).toLocaleDateString();
}

function OutcomeIcon({ outcome }: { outcome: TransactionOutcome }) {
  if (outcome === "succeeded") {
    return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />;
  }
  if (outcome === "failed") {
    return <AlertCircle className="h-4 w-4 shrink-0 text-destructive" aria-hidden />;
  }
  return <Clock className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />;
}

const OUTCOME_LABEL: Record<TransactionOutcome, string> = {
  pending: "In progress",
  succeeded: "Succeeded",
  failed: "Failed",
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiClient.get<NotificationPage>("/notifications", { limit: 30 }),
    // The finalising transaction runs in the background and finishes without
    // the browser being told, so the list has to look again rather than wait
    // for a user action that will never come.
    refetchInterval: open ? 5_000 : 30_000,
    refetchOnWindowFocus: true,
  });

  const markRead = useMutation({
    mutationFn: (ids: string[]) => apiClient.post("/notifications/read", { ids }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markAllRead = useMutation({
    mutationFn: () => apiClient.post("/notifications/read-all", {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const items = data?.data ?? [];
  const unread = data?.meta.unread ?? 0;

  // Close on an outside click or Escape — the panel is a plain popover rather
  // than a menu, because its rows contain a title, a body and a timestamp and
  // a menu item is a single line.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Opening the panel reads what it shows. Marking on the *shown* ids rather
  // than "all" keeps a notification that arrives while the panel is open
  // unread until the user has actually had it in front of them.
  useEffect(() => {
    if (!open || items.length === 0) return;
    const unreadIds = items.filter((item) => !item.read).map((item) => item.id);
    if (unreadIds.length === 0) return;
    markRead.mutate(unreadIds);
    // `markRead` is a stable mutation object; re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, items]);

  const openRecord = (item: TransactionNotification) => {
    if (!item.href) return;
    setOpen(false);
    navigate({ to: item.href as never });
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        title="Notifications"
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-foreground">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 z-50 mt-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-card shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Your transactions</p>
              <p className="text-xs text-muted-foreground">
                {unread > 0 ? `${unread} unread` : "All caught up"}
              </p>
            </div>
            {items.length > 0 && (
              <button
                type="button"
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending || unread === 0}
                className="text-xs font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[26rem] overflow-y-auto">
            {/* A refresh that fails keeps what was last loaded on screen. React
                Query holds the previous data and sets `isError` for a failed
                refetch, and the panel refetches every five seconds while open:
                one dropped request used to replace a list the reader already
                had with an error. Only a panel with nothing to show says so. */}
            {isError && data && (
              <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
                Could not refresh — showing what was last loaded.
              </p>
            )}
            {isLoading ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p>
            ) : isError && !data ? (
              <p className="px-4 py-6 text-sm text-destructive">
                Your transactions could not be loaded.
              </p>
            ) : items.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                Nothing yet. Saving or updating a record will show its progress here.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => openRecord(item)}
                      disabled={!item.href}
                      className={[
                        "flex w-full gap-3 px-4 py-3 text-left transition-colors",
                        item.href ? "hover:bg-muted/60 cursor-pointer" : "cursor-default",
                        // Read and unread are deliberately far apart: an unread
                        // row is tinted and its title is heavier, so the two
                        // are distinguishable at a glance and without colour
                        // alone doing the work.
                        item.read ? "bg-card" : "bg-primary/5",
                      ].join(" ")}
                    >
                      <span className="pt-0.5">
                        <OutcomeIcon outcome={item.outcome} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span
                            className={[
                              "truncate text-sm text-foreground",
                              item.read ? "font-normal" : "font-semibold",
                            ].join(" ")}
                          >
                            {item.title}
                          </span>
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            {relativeTime(item.at)}
                          </span>
                        </span>
                        <span className="mt-1 block text-xs leading-snug text-muted-foreground">
                          {item.detail}
                        </span>
                        <span className="mt-1.5 flex items-center gap-2">
                          <span
                            className={[
                              "rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                              item.outcome === "succeeded"
                                ? "border-emerald-200/60 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300"
                                : item.outcome === "failed"
                                  ? "border-destructive/30 bg-destructive/10 text-destructive"
                                  : "border-amber-200/60 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300",
                            ].join(" ")}
                          >
                            {OUTCOME_LABEL[item.outcome]}
                          </span>
                          {!item.read && (
                            <span
                              className="h-1.5 w-1.5 rounded-full bg-primary"
                              aria-label="Unread"
                            />
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
