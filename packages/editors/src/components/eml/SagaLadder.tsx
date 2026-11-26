/**
 * An EML saga, drawn as the automation ladder.
 *
 * A saga is already an ordered list of steps — the `%%step` directives run in
 * the order the document gives them — so it gets the same top-to-bottom card
 * ladder as an automation rather than a canvas whose layout carries no meaning.
 *
 * What it does not share is the property vocabulary. A saga step's fields come
 * from `SAGA_STEP_FIELDS` and are what the EML document declares (`rule`,
 * `publish`, `as`, `targetSource` …), not the automation model's. Mapping one
 * onto the other would quietly drop the fields that do not correspond, so this
 * drives its own inspector off the EML field list and shares only the visual
 * language.
 */

import { useState } from "react";
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
import { cn } from "../../lib/utils";
import { LadderCard, LadderRung } from "../automation/LadderCard";

/** The same glyphs the automation ladder uses, so a step reads alike in both. */
const STEP_GLYPHS: Record<SagaStepType, string> = {
  Decision: "▤",
  Formula: "ƒ",
  CreateEntity: "✚",
  UpdateEntity: "✎",
  DeleteEntity: "✕",
  REST: "↗",
};

const STEP_LABELS: Record<SagaStepType, string> = {
  Decision: "Look up a rule table",
  Formula: "Work out a value",
  CreateEntity: "Create a record",
  UpdateEntity: "Update a column",
  DeleteEntity: "Delete a record",
  REST: "Call a web service",
};

/** Fields that read better as a picker than as free text. */
const CHOICES: Record<string, readonly string[]> = {
  operation: FORMULA_OPERATIONS,
  method: ["POST", "PUT", "PATCH", "GET", "DELETE"],
  hard: ["false", "true"],
};

/** Fields whose value is JSON, so they get a textarea rather than one line. */
const MULTILINE = new Set(["decisionTable", "fields", "bodyTemplate", "publish"]);

const inputClass =
  "w-full rounded-lg border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/10";

let counter = 0;
function newStepId(): string {
  counter += 1;
  return `s${counter.toString(36)}${Date.now().toString(36)}`;
}

/** How a step reads on its card. Falls back to the type when nothing is set. */
function describeSagaStep(step: SagaStep): string {
  const p = step.props;
  switch (step.type) {
    case "Decision":
      return `Look up ${p.rule || "a rule"}`;
    case "Formula":
      return `${p.operation || "set"} ${p.target || "a variable"}${
        p.value ? ` to ${p.value}` : p.source ? ` from ${p.source}` : ""
      }`;
    case "CreateEntity":
      return `Create ${p.entity || "a record"}${p.as ? ` → ${p.as}` : ""}`;
    case "UpdateEntity":
      return `Set ${p.entity && p.field ? `${p.entity}.${p.field}` : p.field || "a column"}${
        p.value ? ` to ${p.value}` : ""
      }`;
    case "DeleteEntity":
      return `Delete ${p.entity || "a record"}`;
    case "REST":
      return `${p.method || "POST"} to ${p.url || "a URL"}`;
    default:
      return STEP_LABELS[step.type] ?? step.type;
  }
}

export interface SagaLadderProps {
  flow: SagaFlow;
  /** Entity names from the ERD, for the entity pickers. */
  entityNames: string[];
  /** Columns of the entity this workflow is triggered by. */
  entityColumns?: string[];
  /** Rules the model declares, for a Decision step that names one. */
  ruleNames?: string[];
  /** Columns per entity, so a step acting on another one still gets pickers. */
  columnsFor?: (entity: string) => string[];
  onChange: (flow: SagaFlow) => void;
}

export function SagaLadder({
  flow,
  entityNames,
  entityColumns = [],
  ruleNames = [],
  columnsFor,
  onChange,
}: SagaLadderProps) {
  const [selectedId, setSelectedId] = useState<string | null>(flow.steps[0]?.id ?? null);
  const [addingAt, setAddingAt] = useState<number | null>(null);

  const selected = flow.steps.find((s) => s.id === selectedId);
  const selectedIndex = flow.steps.findIndex((s) => s.id === selectedId);

  const setSteps = (steps: SagaStep[]) => onChange({ ...flow, steps });

  const addStep = (type: SagaStepType, at: number) => {
    const step: SagaStep = { id: newStepId(), type, label: STEP_LABELS[type], props: {} };
    const steps = [...flow.steps];
    steps.splice(at, 0, step);
    setSteps(steps);
    setSelectedId(step.id);
    setAddingAt(null);
  };

  const updateStep = (next: SagaStep) =>
    setSteps(flow.steps.map((s) => (s.id === next.id ? next : s)));

  const removeStep = (id: string) => {
    setSteps(flow.steps.filter((s) => s.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const moveStep = (index: number, delta: number) => {
    const to = index + delta;
    if (to < 0 || to >= flow.steps.length) return;
    const steps = [...flow.steps];
    const [moved] = steps.splice(index, 1);
    if (moved) steps.splice(to, 0, moved);
    setSteps(steps);
  };

  const columnsForEntity = (entity: string) =>
    entity && columnsFor ? columnsFor(entity) : entityColumns;

  return (
    <div className="flex min-h-[460px] gap-4">
      {/* the ladder */}
      <div className="flex flex-1 flex-col items-center overflow-y-auto rounded-xl border border-border bg-muted/30 px-5 py-5">
        <div className="w-full max-w-[520px]">
          {flow.steps.length === 0 ? (
            <p className="mb-3 rounded-md border border-dashed border-border bg-card px-3 py-6 text-center text-xs text-muted-foreground">
              No steps yet. Add the first thing this saga should do.
            </p>
          ) : null}

          {flow.steps.map((step, i) => (
            <div key={step.id} className="flex flex-col items-center">
              {i > 0 ? (
                <LadderRung
                  onAdd={() => setAddingAt(addingAt === i ? null : i)}
                  active={addingAt === i}
                />
              ) : null}

              {addingAt === i ? (
                <AddMenu onPick={(type) => addStep(type, i)} onCancel={() => setAddingAt(null)} />
              ) : null}

              <LadderCard
                kind="action"
                glyph={STEP_GLYPHS[step.type]}
                ordinal={`· step ${i + 1}`}
                title={describeSagaStep(step)}
                selected={selectedId === step.id}
                onSelect={() => setSelectedId(step.id)}
                onRemove={() => removeStep(step.id)}
              />
            </div>
          ))}

          <div className="flex flex-col items-center">
            {flow.steps.length > 0 ? (
              <LadderRung
                onAdd={() => setAddingAt(addingAt === flow.steps.length ? null : flow.steps.length)}
                active={addingAt === flow.steps.length}
              />
            ) : null}

            {addingAt === flow.steps.length ? (
              <AddMenu
                onPick={(type) => addStep(type, flow.steps.length)}
                onCancel={() => setAddingAt(null)}
              />
            ) : (
              <button
                type="button"
                onClick={() => setAddingAt(flow.steps.length)}
                className="w-full rounded-xl border border-dashed border-border bg-card py-2.5 text-sm font-semibold text-muted-foreground hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                ＋ <span className="text-primary">Add a step</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* the inspector */}
      <aside className="w-[340px] shrink-0 overflow-y-auto rounded-xl border border-border bg-card p-4">
        {selected ? (
          <>
            <header className="mb-3 flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className="grid h-[28px] w-[28px] shrink-0 place-items-center rounded-lg border border-primary/30 bg-primary/10 text-sm text-primary"
              >
                {STEP_GLYPHS[selected.type]}
              </span>
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-[0.1em] text-primary">
                  Step {selectedIndex + 1}
                </span>
                <h3 className="text-[15px] font-bold">{STEP_LABELS[selected.type]}</h3>
              </div>
            </header>

            <p className="mb-4 text-xs leading-snug text-muted-foreground">
              {SAGA_STEP_HINTS[selected.type]}
            </p>

            <div className="mb-4 flex gap-2">
              <button
                type="button"
                onClick={() => moveStep(selectedIndex, -1)}
                disabled={selectedIndex <= 0}
                className="flex-1 rounded-lg border border-border py-1.5 text-xs font-semibold disabled:opacity-40 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                ↑ Move up
              </button>
              <button
                type="button"
                onClick={() => moveStep(selectedIndex, 1)}
                disabled={selectedIndex < 0 || selectedIndex >= flow.steps.length - 1}
                className="flex-1 rounded-lg border border-border py-1.5 text-xs font-semibold disabled:opacity-40 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                ↓ Move down
              </button>
            </div>

            {(SAGA_STEP_FIELDS[selected.type] ?? []).map((field) => (
              <SagaField
                key={field}
                field={field}
                value={selected.props[field] ?? ""}
                entityNames={entityNames}
                columns={columnsForEntity(selected.props.entity ?? "")}
                ruleNames={ruleNames}
                onChange={(value) =>
                  updateStep({ ...selected, props: { ...selected.props, [field]: value } })
                }
              />
            ))}
          </>
        ) : (
          <p className="grid h-full place-items-center text-center text-sm text-muted-foreground">
            Pick a step on the left to set it up.
          </p>
        )}
      </aside>
    </div>
  );
}

function SagaField({
  field,
  value,
  entityNames,
  columns,
  ruleNames,
  onChange,
}: {
  field: string;
  value: string;
  entityNames: string[];
  columns: string[];
  ruleNames: string[];
  onChange: (value: string) => void;
}) {
  const label = SAGA_FIELD_LABELS[field] ?? field;

  const options =
    field === "entity"
      ? entityNames
      : field === "rule"
        ? ruleNames
        : field === "field" || field === "targetField"
          ? columns
          : CHOICES[field];

  return (
    // the select/input is nested in the label, behind a conditional.
    <label className="mb-3.5 block">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </span>

      {options ? (
        <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : MULTILINE.has(field) ? (
        <textarea
          className={cn(inputClass, "min-h-[76px] font-mono text-xs")}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input className={inputClass} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}

function AddMenu({
  onPick,
  onCancel,
}: {
  onPick: (type: SagaStepType) => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="mb-2 w-full rounded-xl border border-primary/40 bg-card p-3 shadow-lg"
      role="menu"
      aria-label="Add a step"
    >
      <div className="mb-2 flex items-center">
        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
          Add here
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="ml-auto rounded px-1.5 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          ✕
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {SAGA_STEP_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            role="menuitem"
            onClick={() => onPick(type)}
            className="flex items-start gap-2.5 rounded-lg border border-border p-2.5 text-left hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span
              aria-hidden="true"
              className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-md border border-primary/30 bg-primary/10 text-xs text-primary"
            >
              {STEP_GLYPHS[type]}
            </span>
            <span className="min-w-0">
              <strong className="block text-[12.5px]">{STEP_LABELS[type]}</strong>
              <span className="text-[11.5px] leading-snug text-muted-foreground">
                {SAGA_STEP_HINTS[type]}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
