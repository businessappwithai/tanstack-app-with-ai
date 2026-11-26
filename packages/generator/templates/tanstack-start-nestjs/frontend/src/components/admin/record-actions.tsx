import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, ChevronDown, Loader2, RotateCcw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiClient } from "@/lib/api-client";
import { lifecycleOf } from "@/lib/lifecycle";
import { useLifecycles } from "@/lib/use-lifecycles";
import { ifMatchHeader } from "@/lib/version-conflict";

/** One move the server offers this caller from where the record is. */
interface AvailableAction {
  event: string;
  to: string;
  label: string;
  kind: "move" | "reopen";
  restricted: boolean;
  roles: string[];
}

interface RecordActionsProps {
  /** The record's endpoint, e.g. `/bus/opportunity`. */
  endpoint: string;
  /** The record's table, e.g. `bus_opportunity`. */
  tableName: string;
  record?: Record<string, unknown> | null;
  /** Something else is busy with the record (a save in flight): the buttons wait. */
  disabled?: boolean;
  /**
   * The form as it stands, when it has unsaved changes. A press saves it first,
   * in the status the record is in, and then moves the record: two transactions,
   * so a workflow that refuses the move cannot take the typing with it.
   */
  formValues?: Record<string, unknown> | null;
  /** Called after a move — or after a refusal, so the record is read afresh. */
  onMoved: (record?: Record<string, unknown>) => void;
  /** Called when the form was saved by the press, whether or not the move went through. */
  onSaved?: () => void;
}

/** What the last press came to, kept on the record until the next one. */
type Outcome =
  | { kind: "moved"; label: string }
  | {
      kind: "refused";
      label: string;
      message: string;
      /** The form was saved before the move was refused. */
      saved: boolean;
      workflow?: string;
      reason?: string;
    };

/**
 * The record's action buttons — the only way its status changes.
 *
 * The server says which moves this person may make from where the record is
 * (`GET …/:id/actions`): a move only some roles may make is offered only to
 * them. One move is a button; several are a menu to choose from; Reopen, on a
 * record at the end of its flow, sits apart. A press names the version the
 * record was read at, so a move against a record someone else has just moved is
 * refused rather than made twice.
 */
export function RecordActions({
  endpoint,
  tableName,
  record,
  disabled,
  formValues,
  onMoved,
  onSaved,
}: RecordActionsProps) {
  useLifecycles();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const lifecycle = lifecycleOf(tableName);
  const id = record?.id ? String(record.id) : "";
  const at = lifecycle && record ? String(record[lifecycle.column] ?? "") : "";

  const { data: actions = [], isLoading } = useQuery({
    queryKey: ["record-actions", endpoint, id, at, record?.version],
    queryFn: () => apiClient.get<AvailableAction[]>(`${endpoint}/${id}/actions`),
    enabled: !!id && !!lifecycle,
    retry: false,
  });

  const unsaved = formValues && Object.keys(formValues).length > 0 ? formValues : undefined;

  const press = useMutation({
    mutationFn: (action: AvailableAction) =>
      apiClient.post<Record<string, unknown>>(
        `${endpoint}/${id}/transition`,
        {
          event: action.event || undefined,
          to: action.to,
          // Reopen is not a save: the form it would discard is left alone.
          ...(unsaved && action.kind === "move" ? { data: unsaved } : {}),
        },
        { headers: ifMatchHeader(record?.version) }
      ),
    onMutate: () => setOutcome(null),
    onSuccess: (moved, action) => {
      if (unsaved && action.kind === "move") onSaved?.();
      if (action.kind === "reopen") {
        toast.success("Reopened — the record is a draft again.");
      } else {
        setOutcome({ kind: "moved", label: action.label });
      }
      onMoved(moved);
    },
    onError: (err: any, action) => {
      // A refusal says why — a rule, a role, someone else's move, a workflow — and
      // the record is read again so the buttons match where it really is. It stays
      // on the record, not in a toast that goes: the person has to act on it.
      const details = (err?.details ?? {}) as {
        phase?: string;
        saved?: boolean;
        workflow?: string;
        reason?: string;
      };
      const saved = details.phase === "workflow" && !!unsaved;
      if (saved) onSaved?.();
      setOutcome({
        kind: "refused",
        label: action.label,
        message: err?.message ?? "The move was refused.",
        saved,
        workflow: details.workflow,
        reason: details.reason,
      });
      onMoved();
    },
  });

  if (!lifecycle || !id || isLoading) return null;
  const moves = actions.filter((action) => action.kind === "move");
  const reopen = actions.find((action) => action.kind === "reopen");
  if (moves.length === 0 && !reopen) return null;
  const busy = press.isPending || disabled;

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="record-actions">
      {outcome && <PressOutcome outcome={outcome} />}
      {moves.length === 1 && (
        <Button
          size="sm"
          disabled={busy}
          onClick={() => press.mutate(moves[0]!)}
          data-testid={`record-action-${moves[0]!.event || moves[0]!.to}`}
        >
          {press.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
          {moves[0]!.label}
        </Button>
      )}
      {moves.length > 1 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" disabled={busy} data-testid="record-actions-menu">
              {press.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Move to…
              <ChevronDown className="ml-1 h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Choose where this record goes next
            </DropdownMenuLabel>
            {moves.map((move) => (
              <DropdownMenuItem
                key={`${move.event}:${move.to}`}
                onSelect={() => press.mutate(move)}
                data-testid={`record-action-${move.event || move.to}`}
              >
                {move.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {reopen && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => press.mutate(reopen)}
          data-testid="record-action-reopen"
        >
          <RotateCcw className="mr-1 h-3 w-3" />
          Reopen
        </Button>
      )}
    </div>
  );
}

/**
 * What the last press came to. A refusal names the workflow that refused it and
 * says what was kept — the typing, which was saved first, and the status, which
 * did not move — and links to Run History, where the failed run is recorded.
 */
function PressOutcome({ outcome }: { outcome: Outcome }) {
  if (outcome.kind === "moved") {
    return (
      <p
        role="status"
        data-testid="press-moved"
        className="flex basis-full items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300"
      >
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
        Moved to {outcome.label}
      </p>
    );
  }
  return (
    <div
      role="alert"
      data-testid="press-refused"
      className="basis-full rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <p className="flex items-center gap-1.5 font-semibold">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
        {outcome.label} did not go through
      </p>
      <p className="mt-1">
        {outcome.saved ? "Your changes were saved. " : ""}
        {outcome.workflow ? `Workflow "${outcome.workflow}" failed: ${outcome.reason ?? outcome.message}. ` : `${outcome.message} `}
        The status did not change. Fix it and press the button again.
      </p>
      {outcome.workflow && (
        <Link to="/admin/workflows" className="mt-1 inline-block underline">
          Open run history
        </Link>
      )}
    </div>
  );
}
