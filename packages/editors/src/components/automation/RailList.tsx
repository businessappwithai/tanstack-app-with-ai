/**
 * The left rail, paged.
 *
 * Lists are fetched 200 at a time and the rail asks for the next page only when
 * someone presses for it. Loading every automation up front was fine with a
 * dozen and stopped painting with a few thousand — and the person with the most
 * automations is exactly the one who needs the rail to work.
 *
 * The count is always shown, so "200 of 1,340" tells you there is more without
 * needing to scroll to the bottom to find out.
 */

import { cn } from "../../lib/utils";

export const PAGE_SIZE = 200;

export interface RailItem {
  id: string;
  title: string;
  subtitle: string;
  state: "live" | "draft" | "paused";
}

export interface RailSectionProps {
  heading: string;
  items: RailItem[];
  /** How many exist in total, when the server said. */
  total?: number;
  selectedId?: string;
  onSelect: (id: string) => void;
  onLoadMore?: () => void;
  loadingMore?: boolean;
  emptyText?: string;
}

export function RailSection({
  heading,
  items,
  total,
  selectedId,
  onSelect,
  onLoadMore,
  loadingMore = false,
  emptyText = "None yet.",
}: RailSectionProps) {
  const knownTotal = total ?? items.length;
  const hasMore = items.length < knownTotal;

  return (
    <>
      <h2 className="flex items-baseline gap-2 px-4 pb-1.5 pt-4 text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
        {heading}
        {knownTotal > 0 ? (
          <span className="font-normal tabular-nums">
            {items.length < knownTotal
              ? `${items.length.toLocaleString()} of ${knownTotal.toLocaleString()}`
              : knownTotal.toLocaleString()}
          </span>
        ) : null}
      </h2>

      {items.length === 0 ? (
        <p className="px-4 pb-2 text-xs text-muted-foreground">{emptyText}</p>
      ) : null}

      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onSelect(item.id)}
          aria-current={selectedId === item.id ? "page" : undefined}
          className={cn(
            "mx-2 flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            selectedId === item.id ? "bg-primary/10" : "hover:bg-muted"
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
              item.state === "live"
                ? "bg-emerald-500"
                : item.state === "draft"
                  ? "bg-amber-500"
                  : "bg-neutral-400"
            )}
          />
          <span className="min-w-0">
            <span
              className={cn(
                "block truncate text-[13px]",
                selectedId === item.id && "font-semibold"
              )}
            >
              {item.title}
            </span>
            <span className="block truncate text-[11.5px] text-muted-foreground">
              {item.subtitle}
            </span>
          </span>
        </button>
      ))}

      {hasMore && onLoadMore ? (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loadingMore}
          className="mx-2 mt-1 rounded-lg border border-dashed border-border px-2.5 py-2 text-[12.5px] font-semibold text-muted-foreground hover:border-primary/50 hover:text-primary disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {loadingMore
            ? "Loading…"
            : `Show ${Math.min(PAGE_SIZE, knownTotal - items.length).toLocaleString()} more`}
        </button>
      ) : null}
    </>
  );
}
