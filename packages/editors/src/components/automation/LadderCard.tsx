/**
 * One rung of the ladder.
 *
 * Every part of an automation is the same shape on screen — a coloured glyph, a
 * kicker naming which of the three parts it is, and the clause in plain words.
 * Keeping trigger, check and step identical in form is what lets someone read
 * the whole automation top to bottom without learning three card layouts.
 */

import { cn } from "../../lib/utils";

/**
 * `action` rather than `then` because an object keyed `then` is a thenable, and
 * `await`ing or dynamically importing anything holding it behaves oddly. The
 * label the author reads is still "Then do this".
 */
export type LadderKind = "when" | "if" | "action" | "loop";

const KIND_STYLES: Record<LadderKind, { icon: string; kicker: string; label: string }> = {
  when: {
    icon: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
    kicker: "text-amber-700 dark:text-amber-300",
    label: "When this happens",
  },
  if: {
    icon: "bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800",
    kicker: "text-blue-600 dark:text-blue-400",
    label: "Only continue if",
  },
  action: {
    icon: "bg-primary/10 text-primary border-primary/30",
    kicker: "text-primary",
    label: "Then do this",
  },
  // Teal rather than another shade of the accent: a repeat is control flow, not
  // a fourth kind of action, and it should not read as one at a glance.
  loop: {
    icon: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-800",
    kicker: "text-teal-700 dark:text-teal-300",
    label: "Keep repeating",
  },
};

interface LadderCardProps {
  kind: LadderKind;
  glyph: string;
  /** The clause, already worded. Rendered as-is so the model owns the wording. */
  title: React.ReactNode;
  /** Shown after the kicker, e.g. "· step 2". */
  ordinal?: string;
  selected?: boolean;
  problem?: string;
  onSelect?: () => void;
  onRemove?: () => void;
}

export function LadderCard({
  kind,
  glyph,
  title,
  ordinal,
  selected = false,
  problem,
  onSelect,
  onRemove,
}: LadderCardProps) {
  const style = KIND_STYLES[kind];

  return (
    <div
      className={cn(
        "w-full rounded-xl border bg-card px-4 py-3 text-left shadow-sm transition-colors",
        selected
          ? "border-primary ring-[3px] ring-primary/10"
          : "border-border hover:border-primary/40",
        problem && !selected && "border-amber-300 dark:border-amber-800"
      )}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onSelect}
          aria-current={selected ? "true" : undefined}
          className="flex flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-md"
        >
          <span
            aria-hidden="true"
            className={cn(
              "grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg border text-sm",
              style.icon
            )}
          >
            {glyph}
          </span>
          <span className="min-w-0">
            <span
              className={cn("block text-[10px] font-bold uppercase tracking-[0.1em]", style.kicker)}
            >
              {style.label}
              {ordinal ? <span className="text-muted-foreground"> {ordinal}</span> : null}
            </span>
            <span className="mt-0.5 block text-sm">{title}</span>
          </span>
        </button>

        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove this"
            className="shrink-0 rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            ✕
          </button>
        ) : null}
      </div>

      {problem ? (
        <p className="mt-2 pl-[42px] text-xs text-amber-700 dark:text-amber-300">{problem}</p>
      ) : null}
    </div>
  );
}

/**
 * A token inside a card's clause.
 *
 * `value` tokens are the parts the author chose — a literal, a name they gave a
 * result — and carry the accent so the editable bits of the sentence stand out
 * from the fixed words around them.
 */
export function Token({ children, value = false }: { children: React.ReactNode; value?: boolean }) {
  return (
    <span
      className={cn(
        "mx-0.5 inline-block rounded-md border px-1.5 py-0.5 font-semibold",
        value
          ? "border-primary/30 bg-primary/5 text-primary"
          : "border-border bg-muted text-foreground"
      )}
    >
      {children}
    </span>
  );
}

/**
 * The bracket drawn around the steps a loop repeats.
 *
 * A repeat is the one place the ladder stops being a flat list, so it needs to
 * look like containment rather than another rung: the steps inside are indented
 * behind a rail, and the rail carries the count of what it holds. Without the
 * frame the only clue that three steps repeat would be a word on a card above
 * them, which reads as a sequence, not a cycle.
 */
export function LoopFrame({
  children,
  stepCount,
  problem,
}: {
  children: React.ReactNode;
  stepCount: number;
  problem?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative rounded-xl border-l-[3px] bg-teal-50/30 py-2 pl-4 pr-1 dark:bg-teal-950/40",
        problem ? "border-l-amber-400" : "border-l-teal-300"
      )}
    >
      {children}
      <p className="mt-2 pl-1 text-[11px] text-teal-700 dark:text-teal-300">
        ↻ {stepCount === 1 ? "This step repeats" : `These ${stepCount} steps repeat`} until the
        check above fails
      </p>
    </div>
  );
}

/**
 * The connector between two cards, with the add button on it.
 *
 * The `+` lives on the rung rather than in a toolbar because that is where the
 * thing being added will end up — you point at the gap you want filled.
 */
export function LadderRung({
  onAdd,
  active = false,
  /** Overridden in hook workflows, where a rung adds a lifecycle step. */
  label,
}: {
  onAdd: () => void;
  active?: boolean;
  label?: string;
}) {
  return (
    <div className="relative h-6 w-0.5 bg-border" aria-hidden={false}>
      <button
        type="button"
        onClick={onAdd}
        aria-label={label ?? "Add a condition or an action here"}
        className={cn(
          "absolute left-1/2 top-1/2 grid h-[22px] w-[22px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border text-xs leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
          active
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border bg-card text-muted-foreground hover:border-primary hover:text-primary"
        )}
      >
        +
      </button>
    </div>
  );
}
