import { AlertTriangle, CheckCircle, FileEdit, Lock, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { FieldMetadata } from "@/hooks/use-entities";
import { isLocked, lifecycleOf, phaseOf, type LifecyclePhase } from "@/lib/lifecycle";
import { useLifecycles } from "@/lib/use-lifecycles";

interface LifecycleBadgeProps {
  /** The record's table, e.g. `bus_opportunity`. */
  tableName: string;
  /** The entity's fields, for the state's label from the model's enum. */
  fields: FieldMetadata[];
  record?: Record<string, unknown> | null;
  className?: string;
}

const PHASE: Record<
  LifecyclePhase,
  { label: string; className: string; icon: React.ComponentType<{ className?: string }> }
> = {
  draft: {
    label: "Draft",
    className:
      "border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40",
    icon: FileEdit,
  },
  active: {
    label: "In progress",
    className: "border-primary/40 bg-primary/10 text-primary",
    icon: Workflow,
  },
  final: {
    label: "Final",
    className:
      "border-green-300 dark:border-green-800 text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-950/40",
    icon: CheckCircle,
  },
  error: {
    label: "Error",
    className:
      "border-red-300 dark:border-red-800 text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40",
    icon: AlertTriangle,
  },
};

/**
 * Where the record is in its lifecycle (lib/lifecycle.ts), read-only, in the
 * header of its form: Draft, part-way along its flow, Final, or Error — and for
 * a record with a status flow, the status itself, under the label the model's
 * enum gives it ("Final · Closed won"). Nobody types a status: the record's
 * action buttons beside this badge are how it moves.
 */
export function LifecycleBadge({ tableName, fields, record, className = "" }: LifecycleBadgeProps) {
  useLifecycles();
  const lifecycle = lifecycleOf(tableName);
  if (!lifecycle || !record) return null;
  const value = record[lifecycle.column];
  const phase = phaseOf(lifecycle, value);
  const config = PHASE[phase];
  const Icon = isLocked(lifecycle, value) ? Lock : config.icon;
  const field = fields.find((candidate) => candidate.column_name === lifecycle.column);
  const state =
    lifecycle.hasMachine && value !== undefined && value !== null && value !== ""
      ? (field?.options?.find((option) => option.value === String(value))?.label ??
        String(value).replace(/_/g, " "))
      : null;
  const showState = state && phase !== "draft" && phase !== "error";
  const message = typeof record.doc_status_message === "string" ? record.doc_status_message : "";

  const tip =
    phase === "error"
      ? message || "The last save was refused. Fix the record and save it again."
      : phase === "final" && lifecycle.hasMachine
        ? "Final — this record is locked. Reopen it to change it."
        : phase === "final"
          ? "Final — every rule and workflow accepted the last save."
          : phase === "draft"
            ? "Draft — saving it runs its rules and workflows."
            : "Moves only by its action buttons, never by typing.";

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            data-testid="record-lifecycle"
            data-phase={phase}
            className={`${config.className} ${className} inline-flex items-center gap-1 text-xs`}
          >
            <Icon className="h-3 w-3" aria-hidden="true" />
            {!(phase === "active" && showState) && <span>{config.label}</span>}
            {showState && phase !== "active" && <span aria-hidden="true">·</span>}
            {showState && (
              <span data-testid="record-state" aria-label={`${field?.name ?? lifecycle.column}: ${state}`}>
                {state}
              </span>
            )}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-sm">
          {tip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
