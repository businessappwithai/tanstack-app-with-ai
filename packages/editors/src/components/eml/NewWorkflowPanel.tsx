import { Workflow as WorkflowIcon } from "lucide-react";
import { useState } from "react";
import type { HookEvent } from "../../lib/automation/model";
import {
  canBindStatus,
  HOOK_CHOICES,
  type StatusChoices,
} from "../../lib/eml/workflow-hooks";

export interface NewWorkflowDraft {
  name: string;
  entity: string;
  event: HookEvent;
  /** The state whose entering move runs the workflow; unset runs on every update. */
  status?: string;
}

interface NewWorkflowPanelProps {
  entityNames: string[];
  /** What the chosen record type can be bound to; omitted means no status picker. */
  statusChoicesFor?: (entity: string) => StatusChoices;
  onCreate: (draft: NewWorkflowDraft) => void;
  onCancel?: () => void;
}

/**
 * Where a workflow begins: what it is called, which record type it watches, and
 * which hooks it listens on. The ladder, the steps and the rules attached to
 * each hook all come after, because they all hang off these choices.
 */
export function NewWorkflowPanel({
  entityNames,
  statusChoicesFor,
  onCreate,
  onCancel,
}: NewWorkflowPanelProps) {
  const [name, setName] = useState("");
  const [entity, setEntity] = useState(entityNames[0] ?? "");
  const [event, setEvent] = useState<HookEvent>("beforeCreate");
  const [status, setStatus] = useState("");
  const chosen = HOOK_CHOICES.find((choice) => choice.event === event);
  const choices = statusChoicesFor && entity ? statusChoicesFor(entity) : undefined;
  const bindable = choices !== undefined && canBindStatus(event);
  const boundStatus = bindable && choices.kind === "machine" ? status : "";

  const problem = !name.trim()
    ? "Give the workflow a name."
    : !entity
      ? "Choose the record type it watches."
      : null;

  return (
    <section
      aria-label="Create a workflow"
      className="rounded-xl border border-border bg-card p-6 shadow-sm"
    >
      <div className="mb-5 flex items-start gap-3">
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <WorkflowIcon className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">New workflow</h2>
          <p className="text-sm text-muted-foreground">
            Start with the hook it attaches to. Rules are attached to that hook next, and steps come
            after.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium">Workflow name</span>
          <input
            className="w-full rounded-md border border-border px-2 py-1.5 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Lead intake"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium">Watches</span>
          <select
            className="w-full rounded-md border border-border px-2 py-1.5 text-sm"
            value={entity}
            onChange={(e) => {
              setEntity(e.target.value);
              setStatus("");
            }}
          >
            <option value="">Choose…</option>
            {entityNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="mt-4 block">
        <span className="mb-1 block text-xs font-medium">Attach it to this hook</span>
        <select
          aria-label="Hook"
          className="w-full rounded-md border border-border px-2 py-1.5 text-sm"
          value={event}
          onChange={(e) => setEvent(e.target.value as HookEvent)}
        >
          {(["Writes", "Reads"] as const).map((group) => (
            <optgroup key={group} label={group === "Writes" ? "Write hooks" : "Read hooks"}>
              {HOOK_CHOICES.filter((choice) => choice.group === group).map((choice) => (
                <option key={choice.event} value={choice.event}>
                  {choice.label} ({choice.event})
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {chosen && <span className="mt-1 block text-xs text-muted-foreground">{chosen.hint}</span>}
      </label>

      {bindable && choices && (
        <label className="mt-4 block">
          <span className="mb-1 block text-xs font-medium">When the status becomes</span>
          {choices.kind === "machine" ? (
            <select
              aria-label="Status"
              className="w-full rounded-md border border-border px-2 py-1.5 text-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">Any update (no status)</option>
              {choices.states.map((state) => (
                <option key={state.value} value={state.value}>
                  {state.label}
                </option>
              ))}
            </select>
          ) : (
            <select
              aria-label="Status"
              disabled
              className="w-full rounded-md border border-border px-2 py-1.5 text-sm opacity-70"
              value="final"
            >
              <option value="final">Final</option>
            </select>
          )}
          <span className="mt-1 block text-xs text-muted-foreground">
            {choices.kind === "machine"
              ? `Runs when a ${entity} is moved to this status by its button. The button first saves the form in its current status; then, in another transaction, this workflow runs and, if it succeeds, the status moves on. If any step fails the move is undone and the record stays where it was.`
              : `${entity} has no status flow. By default it has two statuses, Draft and Final. Pressing the button saves the ${entity}; another transaction then runs this workflow, which moves the status to Final. A ${entity} with a status flow works the same way: the button saves the form in its current status, then the workflows attached to the next status run, and if they succeed the status moves on, in a separate transaction.`}
          </span>
        </label>
      )}

      <div className="mt-6 flex items-center justify-end gap-3">
        {problem && <span className="mr-auto text-xs text-muted-foreground">{problem}</span>}
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          disabled={problem !== null}
          onClick={() =>
            onCreate({ name: name.trim(), entity, event, ...(boundStatus ? { status: boundStatus } : {}) })
          }
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          Create workflow
        </button>
      </div>
    </section>
  );
}
