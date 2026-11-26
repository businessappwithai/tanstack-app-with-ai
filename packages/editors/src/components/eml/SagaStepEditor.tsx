import { ArrowDown, GripVertical, Plus, Trash2 } from "lucide-react";
import {
  FORMULA_OPERATIONS,
  SAGA_FIELD_LABELS,
  SAGA_STEP_FIELDS,
  SAGA_STEP_HINTS,
  SAGA_STEP_TYPES,
  type SagaFlow,
  type SagaStep,
  type SagaStepType,
} from "../../lib/eml/workflow-flow";

/**
 * The step list of a saga workflow.
 *
 * Steps are an ordered list rather than a free canvas because the generated
 * executor runs a linear chain: letting someone draw a branch here would
 * promise something the runtime does not do. The flowchart and its node ids are
 * emitted from this order, so the author never has to hold an id in their head.
 */
export interface SagaStepEditorProps {
  flow: SagaFlow;
  /** Entity names from the ERD, for the entity pickers. */
  entityNames: string[];
  onChange: (flow: SagaFlow) => void;
}

let stepCounter = 0;
const nextId = () => `st${(stepCounter++).toString(36)}${Date.now().toString(36)}`;

/** Sensible starting properties, so a new step is never blank and invalid. */
function defaultsFor(type: SagaStepType, entityNames: string[]): Record<string, string> {
  if (type === "Formula") return { operation: "set", target: "", value: "" };
  if (type === "CreateEntity") return { entity: entityNames[0] ?? "", fields: "{}" };
  if (type === "UpdateEntity") return { field: "", value: "" };
  if (type === "DeleteEntity") return { hard: "false" };
  return { method: "POST", url: "" };
}

/** Which property fields this step actually shows, given its own values. */
function visibleFields(step: SagaStep): string[] {
  const fields = SAGA_STEP_FIELDS[step.type] ?? [];
  if (step.type !== "Formula") return fields;

  // The arithmetic operations read source + operand; `set` reads a literal and
  // `copy` reads a variable. Showing all five at once invited filling in the
  // three that the chosen operation ignores.
  const operation = (step.props.operation ?? "set").trim();
  if (operation === "set") return ["target", "operation", "value"];
  if (operation === "copy") return ["target", "operation", "source"];
  return ["target", "operation", "source", "operand"];
}

export function SagaStepEditor({ flow, entityNames, onChange }: SagaStepEditorProps) {
  const patchStep = (index: number, patch: Partial<SagaStep>) => {
    onChange({
      ...flow,
      steps: flow.steps.map((step, position) =>
        position === index ? { ...step, ...patch } : step
      ),
    });
  };

  const patchProp = (index: number, key: string, value: string) => {
    const step = flow.steps[index];
    if (!step) return;
    patchStep(index, { props: { ...step.props, [key]: value } });
  };

  const addStep = (type: SagaStepType) => {
    onChange({
      ...flow,
      steps: [
        ...flow.steps,
        { id: nextId(), type, label: type, props: defaultsFor(type, entityNames) },
      ],
    });
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= flow.steps.length) return;
    const steps = [...flow.steps];
    const [moved] = steps.splice(index, 1);
    steps.splice(target, 0, moved!);
    onChange({ ...flow, steps });
  };

  /** Variables an earlier step publishes — what a later one may read. */
  const publishedBefore = (index: number): string[] => {
    const names: string[] = [];
    for (const step of flow.steps.slice(0, index)) {
      if (step.type === "Formula" && step.props.target?.trim()) {
        names.push(step.props.target.trim());
      }
      if (step.type === "CreateEntity") {
        const bound =
          step.props.as?.trim() ||
          (step.props.entity?.trim() ? `${step.props.entity.trim().replace(/^bus_/, "")}Id` : "");
        if (bound) names.push(bound);
      }
    }
    return names;
  };

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="mb-3 grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium">Runs when</span>
          <select
            className="w-full rounded-md border border-border px-2 py-1.5 text-sm"
            value={flow.trigger}
            onChange={(event) =>
              onChange({ ...flow, trigger: event.target.value as SagaFlow["trigger"] })
            }
          >
            <option value="rule">Only when a business rule triggers it</option>
            <option value="automatic">On every matching write</option>
          </select>
          <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">
            {flow.trigger === "rule"
              ? "The rule's condition decides. Use this when the process should not run on every save."
              : "Runs on every write of the chosen operation, whatever the record says."}
          </span>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium">On</span>
          <select
            className="w-full rounded-md border border-border px-2 py-1.5 text-sm disabled:opacity-50"
            value={flow.operation}
            disabled={flow.trigger === "rule"}
            onChange={(event) =>
              onChange({ ...flow, operation: event.target.value as SagaFlow["operation"] })
            }
          >
            {["CREATE", "UPDATE", "DELETE", "ALL"].map((operation) => (
              <option key={operation} value={operation}>
                {operation}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">
            {flow.trigger === "rule"
              ? "Not used — a rule-triggered workflow is resolved by name."
              : "Which write starts the process."}
          </span>
        </label>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-1">
        <span className="mr-1 text-xs font-medium text-muted-foreground">Add step:</span>
        {SAGA_STEP_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => addStep(type)}
            title={SAGA_STEP_HINTS[type]}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-muted"
          >
            <Plus className="h-3 w-3" />
            {type}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {flow.steps.map((step, index) => {
          const available = publishedBefore(index);
          return (
            <div key={step.id} className="rounded-md border border-border p-2">
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted text-[11px] font-semibold">
                  {index + 1}
                </span>
                <select
                  className="rounded-md border border-border px-2 py-1 text-xs font-medium"
                  value={step.type}
                  onChange={(event) => {
                    const type = event.target.value as SagaStepType;
                    patchStep(index, { type, props: defaultsFor(type, entityNames) });
                  }}
                >
                  {SAGA_STEP_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
                <input
                  className="min-w-0 flex-1 rounded-md border border-border px-2 py-1 text-xs"
                  value={step.label}
                  placeholder="What this step does"
                  onChange={(event) => patchStep(index, { label: event.target.value })}
                />
                <button
                  type="button"
                  aria-label={`Move step ${index + 1} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  className="disabled:opacity-30"
                >
                  <GripVertical className="h-3.5 w-3.5 rotate-90 text-muted-foreground" />
                </button>
                <button
                  type="button"
                  aria-label={`Move step ${index + 1} down`}
                  disabled={index === flow.steps.length - 1}
                  onClick={() => move(index, 1)}
                  className="disabled:opacity-30"
                >
                  <ArrowDown className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
                <button
                  type="button"
                  aria-label={`Delete step ${index + 1}`}
                  onClick={() =>
                    onChange({
                      ...flow,
                      steps: flow.steps.filter((_step, position) => position !== index),
                    })
                  }
                >
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                </button>
              </div>

              <p className="mb-2 text-[11px] leading-snug text-muted-foreground">
                {SAGA_STEP_HINTS[step.type]}
              </p>

              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                {visibleFields(step).map((key) => (
                  // the control is nested in the label, behind a per-field conditional.
                  <label key={key} className="block">
                    <span className="mb-1 block text-[11px] font-medium">
                      {SAGA_FIELD_LABELS[key] ?? key}
                    </span>

                    {key === "entity" ? (
                      <select
                        className="w-full rounded-md border border-border px-2 py-1.5 text-sm"
                        value={step.props.entity ?? ""}
                        onChange={(event) => patchProp(index, "entity", event.target.value)}
                      >
                        <option value="">
                          {step.type === "CreateEntity" ? "Choose…" : "This record"}
                        </option>
                        {entityNames.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    ) : key === "operation" ? (
                      <select
                        className="w-full rounded-md border border-border px-2 py-1.5 text-sm"
                        value={step.props.operation ?? "set"}
                        onChange={(event) => patchProp(index, "operation", event.target.value)}
                      >
                        {FORMULA_OPERATIONS.map((operation) => (
                          <option key={operation} value={operation}>
                            {operation}
                          </option>
                        ))}
                      </select>
                    ) : key === "hard" ? (
                      <select
                        className="w-full rounded-md border border-border px-2 py-1.5 text-sm"
                        value={step.props.hard ?? "false"}
                        onChange={(event) => patchProp(index, "hard", event.target.value)}
                      >
                        <option value="false">Soft — stamp deleted_at</option>
                        <option value="true">Hard — remove the row</option>
                      </select>
                    ) : key === "method" ? (
                      <select
                        className="w-full rounded-md border border-border px-2 py-1.5 text-sm"
                        value={step.props.method ?? "POST"}
                        onChange={(event) => patchProp(index, "method", event.target.value)}
                      >
                        {["POST", "PUT", "PATCH", "GET"].map((method) => (
                          <option key={method} value={method}>
                            {method}
                          </option>
                        ))}
                      </select>
                    ) : key === "targetSource" || key === "source" ? (
                      <>
                        <input
                          list={`${step.id}-${key}-vars`}
                          className="w-full rounded-md border border-border px-2 py-1.5 font-mono text-sm"
                          value={step.props[key] ?? ""}
                          placeholder={available[0] ?? "variable or column"}
                          onChange={(event) => patchProp(index, key, event.target.value)}
                        />
                        <datalist id={`${step.id}-${key}-vars`}>
                          {available.map((name) => (
                            <option key={name} value={name} />
                          ))}
                        </datalist>
                      </>
                    ) : key === "fields" ? (
                      <textarea
                        className="h-16 w-full resize-none rounded-md border border-border px-2 py-1.5 font-mono text-[11px]"
                        value={step.props.fields ?? "{}"}
                        placeholder={'{"status":"open"}'}
                        onChange={(event) => patchProp(index, "fields", event.target.value)}
                      />
                    ) : (
                      <input
                        className="w-full rounded-md border border-border px-2 py-1.5 font-mono text-sm"
                        value={step.props[key] ?? ""}
                        onChange={(event) => patchProp(index, key, event.target.value)}
                      />
                    )}
                  </label>
                ))}
              </div>

              {step.type === "CreateEntity" && (
                <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
                  Later steps reach this row through the variable its id is bound to
                  {step.props.as?.trim() ? (
                    <>
                      {" "}
                      — <code className="font-mono">{step.props.as.trim()}</code>.
                    </>
                  ) : (
                    ". Name one, or it defaults to the entity name plus Id."
                  )}
                </p>
              )}
            </div>
          );
        })}

        {!flow.steps.length && (
          <p className="rounded-md border border-dashed border-border px-2 py-6 text-center text-xs text-muted-foreground">
            No steps yet. Add one to build the process.
          </p>
        )}
      </div>
    </div>
  );
}
