import { AlertCircle, Code2, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import {
  type Automation,
  emptyAutomation,
  serializeAutomation,
  validateAutomation,
} from "../../lib/automation/model";
import {
  emitHookWorkflow,
  emitSagaFlow,
  emitStateFlow,
  emptySagaFlow,
  HOOK_HINTS,
  HOOK_TYPES,
  type SagaFlow,
  type StateFlow,
  validateHookWorkflow,
  validateSagaFlow,
  validateStateFlow,
  type WorkflowHook,
} from "../../lib/eml/workflow-flow";
import { LadderCard, LadderRung } from "../automation/LadderCard";
import { SagaLadder } from "./SagaLadder";
import { emptyStateFlow, StateFlowCanvas } from "./StateFlowCanvas";

/**
 * One workflow.
 *
 * Lifted out of the workflows step so it can sit beside the rule editor. A rule
 * decides and a process acts on what it decided; keeping them on separate
 * screens made that look like two unrelated pieces of work.
 */

export type WorkflowKind = "hook" | "state" | "saga";

export interface EditableWorkflow {
  /** Stable across renames, so React keeps the row it is editing. */
  key: string;
  name: string;
  entity: string;
  kind: WorkflowKind;
  title?: string;
  hooks: WorkflowHook[];
  states: StateFlow;
  saga: SagaFlow;
  /**
   * Set for `hook` and `saga` workflows, which are edited in the automation
   * ladder — the same builder the generated application ships. A hook workflow
   * is a list of handlers on different lifecycle events, which is the
   * multi-trigger case the ladder gained; a saga is the ordered steps it always
   * had, started by a rule rather than by an event. `hooks` and `saga` above
   * are kept only so a workflow loaded before this existed still renders.
   */
  automation?: Automation;
}

export function pascalWorkflowName(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9]+/g, " ").trim();
  if (!cleaned) return "Workflow";
  return cleaned
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

export function emptyWorkflow(kind: WorkflowKind, key: string, entity: string): EditableWorkflow {
  return {
    key,
    name: kind === "hook" ? "NewLifecycle" : kind === "saga" ? "NewProcess" : "NewStatus",
    entity,
    kind,
    hooks: [],
    states: emptyStateFlow(),
    saga: emptySagaFlow(),
    ...(kind === "hook" || kind === "saga" ? { automation: emptyAutomation(entity, kind) } : {}),
  };
}

/** The diagram a workflow serialises to, whichever kind it is. */
export function emitWorkflowDiagram(workflow: EditableWorkflow): string {
  if (workflow.kind === "hook") {
    // The ladder owns hook workflows now. `serializeAutomation` writes the
    // same `%%hook` directives `emitHookWorkflow` does, so the artifact the
    // generator reads is unchanged; the fallback covers a workflow loaded
    // before the ladder existed.
    if (workflow.automation) return serializeAutomation(workflow.automation);
    return emitHookWorkflow(workflow.entity || "Entity", workflow.hooks);
  }
  if (workflow.kind === "saga") {
    // Body only: the wizard sends name, entity, kind, trigger and operation as
    // fields, and language/composer.ts writes the %%workflow directive from
    // them. Emitting it here too would write the header twice.
    if (workflow.automation) return serializeAutomation(workflow.automation, { header: false });
    return emitSagaFlow(workflow.saga);
  }
  return emitStateFlow(workflow.states, workflow.entity || workflow.states.entity);
}

export function validateWorkflow(workflow: EditableWorkflow): string[] {
  if (workflow.kind === "hook") {
    if (workflow.automation) {
      return validateAutomation(workflow.automation).map((problem) => problem.message);
    }
    return validateHookWorkflow(workflow.entity, workflow.hooks);
  }
  if (workflow.kind === "saga") {
    if (workflow.automation) {
      return validateAutomation(workflow.automation).map((problem) => problem.message);
    }
    return validateSagaFlow(workflow.saga);
  }
  return validateStateFlow(workflow.states);
}

let hookCounter = 0;

export interface WorkflowEditorProps {
  workflow: EditableWorkflow;
  entityNames: string[];
  /** Rules the model declares, for a Decision step that names one. */
  ruleNames: string[];
  columnsFor: (entity: string) => string[];
  onChange: (patch: Partial<EditableWorkflow>) => void;
  /**
   * For a status machine: the workflows bound to each state, keyed by the
   * state's name in the machine's own spelling. Shown read-only, because what
   * runs on entering a state is chosen on the workflow, not here.
   */
  boundWorkflows?: Record<string, string[]>;
}

export function WorkflowEditor({
  workflow,
  entityNames,
  ruleNames,
  columnsFor,
  onChange,
  boundWorkflows,
}: WorkflowEditorProps) {
  const [showSource, setShowSource] = useState(false);
  const [selectedHookId, setSelectedHookId] = useState<string | null>(
    workflow.hooks[0]?.id ?? null
  );
  const problems = useMemo(() => validateWorkflow(workflow), [workflow]);
  const pascal = pascalWorkflowName;

  const selectedHook = workflow.hooks.find((h) => h.id === selectedHookId) ?? null;

  const addHook = () => {
    const hook = {
      id: `h${hookCounter++}`,
      type: "beforeCreate",
      handler: `handler${workflow.hooks.length + 1}`,
    };
    onChange({ hooks: [...workflow.hooks, hook] });
    setSelectedHookId(hook.id);
  };

  const patchHook = (id: string, patch: Partial<WorkflowHook>) =>
    onChange({ hooks: workflow.hooks.map((h) => (h.id === id ? { ...h, ...patch } : h)) });

  const removeHook = (id: string) => {
    onChange({ hooks: workflow.hooks.filter((h) => h.id !== id) });
    if (selectedHookId === id) setSelectedHookId(null);
  };

  return (
    <>
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium">Name</span>
          <input
            className="w-full rounded-md border border-border px-2 py-1.5 text-sm"
            value={workflow.title ?? workflow.name}
            onChange={(event) =>
              onChange({
                title: event.target.value,
                name: pascal(event.target.value),
              })
            }
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium">Entity</span>
          <select
            className="w-full rounded-md border border-border px-2 py-1.5 text-sm"
            value={workflow.entity}
            onChange={(event) => onChange({ entity: event.target.value })}
          >
            <option value="">Choose…</option>
            {entityNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <div>
          <span className="mb-1 block text-xs font-medium">Kind</span>
          <p className="rounded-md border border-border bg-muted/40 px-2 py-1.5 text-sm">
            {workflow.kind === "hook"
              ? "Lifecycle handlers"
              : workflow.kind === "saga"
                ? "Multi-step process"
                : "Status state machine"}
          </p>
        </div>
      </div>

      {workflow.kind === "hook" ? (
        <div className="flex min-h-[460px] gap-4">
          {/* Jira-style ladder */}
          <div className="flex flex-1 flex-col items-center overflow-y-auto rounded-xl border border-border bg-muted/30 px-5 py-5">
            <div className="w-full max-w-[520px]">
              {workflow.hooks.length === 0 && (
                <p className="rounded-md border border-dashed border-border bg-card px-3 py-6 text-center text-xs text-muted-foreground">
                  No steps yet. Add one to run a handler on this entity&apos;s lifecycle.
                </p>
              )}

              {workflow.hooks.map((hook, index) => (
                <div key={hook.id} className="flex flex-col items-center">
                  {index > 0 && <LadderRung onAdd={addHook} />}
                  <LadderCard
                    kind="when"
                    glyph="⚡"
                    ordinal={`· step ${index + 1}`}
                    title={`${hook.type} → ${hook.handler}${hook.field ? ` · ${hook.field}` : ""}`}
                    selected={selectedHookId === hook.id}
                    onSelect={() => setSelectedHookId(hook.id)}
                    onRemove={() => removeHook(hook.id)}
                  />
                </div>
              ))}

              <div className="flex flex-col items-center">
                <LadderRung onAdd={addHook} />
              </div>
            </div>
          </div>

          {/* Inspector */}
          <div className="flex w-60 shrink-0 flex-col gap-3 rounded-xl border border-border bg-card p-4">
            {selectedHook ? (
              <>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Step
                </p>

                <label className="block">
                  <span className="mb-1 block text-xs font-medium">When</span>
                  <select
                    className="w-full rounded-md border border-border px-2 py-1.5 text-sm"
                    value={selectedHook.type}
                    onChange={(event) => patchHook(selectedHook.id, { type: event.target.value })}
                  >
                    {HOOK_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-medium">Handler</span>
                  <input
                    className="w-full rounded-md border border-border px-2 py-1.5 font-mono text-sm"
                    value={selectedHook.handler}
                    onChange={(event) =>
                      patchHook(selectedHook.id, { handler: event.target.value })
                    }
                    placeholder="hashPassword"
                  />
                  <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">
                    {HOOK_HINTS[selectedHook.type] ?? ""}
                  </span>
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-medium">Field (optional)</span>
                  <input
                    className="w-full rounded-md border border-border px-2 py-1.5 font-mono text-sm"
                    value={selectedHook.field ?? ""}
                    onChange={(event) =>
                      patchHook(selectedHook.id, { field: event.target.value || undefined })
                    }
                    placeholder="password"
                  />
                </label>

                <button
                  type="button"
                  className="mt-auto flex items-center gap-1.5 rounded-md border border-destructive/40 px-2 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
                  onClick={() => removeHook(selectedHook.id)}
                >
                  <Trash2 className="h-3 w-3" />
                  Remove step
                </button>
              </>
            ) : (
              <p className="text-center text-xs text-muted-foreground">
                {workflow.hooks.length > 0
                  ? "Select a step to edit it"
                  : "Add a step to get started"}
              </p>
            )}
          </div>
        </div>
      ) : workflow.kind === "saga" ? (
        <SagaLadder
          key={workflow.key}
          flow={workflow.saga}
          entityNames={entityNames}
          entityColumns={columnsFor(workflow.entity)}
          ruleNames={ruleNames}
          columnsFor={columnsFor}
          onChange={(saga) => onChange({ saga })}
        />
      ) : (
        <div className="h-[460px]">
          <StateFlowCanvas flow={workflow.states} onChange={(states) => onChange({ states })} boundWorkflows={boundWorkflows} />
        </div>
      )}

      {workflow.kind === "state" && boundWorkflows && Object.keys(boundWorkflows).length > 0 && (
        <section
          aria-label="Runs when a state is entered"
          className="mt-3 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs"
        >
          <h4 className="mb-1 font-semibold">Runs when a state is entered</h4>
          <ul className="space-y-0.5">
            {Object.entries(boundWorkflows).map(([state, names]) => (
              <li key={state}>
                <span className="font-medium">{state.replace(/_/g, " ")}</span>
                <span className="text-muted-foreground"> — {names.join(", ")}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-muted-foreground">
            The button saves the form, then these run in another transaction. The status moves only
            if they all succeed.
          </p>
        </section>
      )}

      {problems.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {problems.map((problem) => (
            <li key={problem} className="flex items-start gap-1.5">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              {problem}
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => setShowSource((current) => !current)}
        className="mt-3 flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium"
      >
        <Code2 className="h-3.5 w-3.5" />
        {showSource ? "Hide" : "Show"} EML
      </button>

      {showSource && (
        <pre className="mt-2 max-h-56 overflow-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
          {`%%workflow ${pascal(workflow.title ?? workflow.name)} entity: ${
            workflow.entity || "<entity>"
          } kind: ${workflow.kind}${
            workflow.kind === "saga"
              ? `${workflow.saga.trigger === "rule" ? " trigger: rule" : ""}${
                  workflow.saga.operation !== "CREATE"
                    ? ` operation: ${workflow.saga.operation}`
                    : ""
                }`
              : ""
          }${
            workflow.kind !== "state" && workflow.automation?.onStatus
              ? ` status: ${workflow.automation.onStatus}`
              : ""
          }\n${
            workflow.kind === "hook"
              ? emitHookWorkflow(workflow.entity || "Entity", workflow.hooks)
              : workflow.kind === "saga"
                ? emitSagaFlow(workflow.saga)
                : emitStateFlow(workflow.states, workflow.entity || workflow.states.entity)
          }`}
        </pre>
      )}
    </>
  );
}
