/**
 * A slide-over that reads the help Markdown shipped with the application.
 *
 * It sits beside the editor rather than over it: the panel is narrow enough
 * that the table or ladder being explained stays in view, which is the point
 * of help that says "click the card, then fill in the field on the right".
 * No modal and no backdrop for the same reason; Escape or the close button
 * dismisses it.
 */

import { BookOpen, X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { HELP_TOPICS, type HelpTopicId, helpTopic } from "../../content/help";
import { cn } from "../../lib/utils";

/** Markdown elements, in this application's type and colour. */
const MARKDOWN: Components = {
  h1: ({ children }) => <h1 className="mb-3 text-xl font-bold tracking-tight">{children}</h1>,
  h2: ({ children }) => (
    <h2 className="mb-2 mt-6 border-b border-border pb-1 text-base font-semibold">{children}</h2>
  ),
  h3: ({ children }) => <h3 className="mb-1.5 mt-4 text-sm font-semibold">{children}</h3>,
  p: ({ children }) => <p className="mb-3 text-[13.5px] leading-relaxed">{children}</p>,
  ul: ({ children }) => (
    <ul className="mb-3 list-disc space-y-1 pl-5 text-[13.5px] leading-relaxed">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-3 list-decimal space-y-1 pl-5 text-[13.5px] leading-relaxed">{children}</ol>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-3 border-l-2 border-primary/40 bg-primary/5 px-3 py-2 text-[13.5px] [&>p]:mb-0">
      {children}
    </blockquote>
  ),
  code: ({ children, className }) =>
    className ? (
      <code className={cn("font-mono text-[12px]", className)}>{children}</code>
    ) : (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">{children}</code>
    ),
  pre: ({ children }) => (
    <pre className="mb-3 overflow-x-auto rounded-md border border-border bg-muted/50 p-3 text-[12px] leading-relaxed">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="mb-3 overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse text-left text-[12.5px]">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-border bg-muted/50 px-2 py-1.5 font-semibold">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border-b border-border px-2 py-1.5 align-top last:border-b-0">{children}</td>
  ),
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-primary underline">
      {children}
    </a>
  ),
};

export interface HelpPanelProps {
  open: boolean;
  topic: HelpTopicId;
  onTopicChange: (topic: HelpTopicId) => void;
  onClose: () => void;
}

export function HelpPanel({ open, topic, onTopicChange, onClose }: HelpPanelProps) {
  const body = useRef<HTMLDivElement>(null);
  const current = helpTopic(topic);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // A new topic starts at its top, not wherever the last one was scrolled to.
  // the topic is the trigger
  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
  }, [topic]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop — clicking outside closes the panel */}
      <div className="fixed inset-0 z-40 bg-black/20" aria-hidden="true" onClick={onClose} />
      <aside
        aria-label="Help"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[460px] flex-col border-l border-border bg-card shadow-2xl"
      >
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <BookOpen className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Help</span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close help"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div
          role="tablist"
          aria-label="Help topics"
          className="flex flex-wrap gap-1 border-b border-border px-3 py-2"
        >
          {HELP_TOPICS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={entry.id === topic}
              onClick={() => onTopicChange(entry.id)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium",
                entry.id === topic
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div ref={body} role="tabpanel" className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN}>
            {current.markdown}
          </ReactMarkdown>
        </div>
      </aside>
    </>
  );
}

/** The small "How does this work?" link above an editor. */
export function HelpLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
    >
      <BookOpen className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}
