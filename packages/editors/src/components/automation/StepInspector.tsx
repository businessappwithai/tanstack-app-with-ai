/**
 * The right-hand panel: how a step is set up, and what it actually did.
 *
 * Putting the last run's input and output directly under the fields that
 * produced them is the one idea worth taking from a canvas-style editor. The
 * question an author has while configuring a step is almost always "did that
 * do what I meant", and answering it in the same panel removes a trip to a
 * separate run view — along with the guessing that happens on the way back.
 */

import { useMemo } from "react";
import {
  type AutomationStep,
  type AvailableValue,
  type Condition,
  LOOP_MIN_PASSES,
  type Loop,
  OPERATORS,
  operatorArity,
  STEP_FIELDS,
  STEP_GLYPHS,
  STEP_HINTS,
  STEP_LABELS,
} from "../../lib/automation/model";
import { cn } from "../../lib/utils";

/* -------------------------------------------------------------------------- */
/*  Run output                                                                 */
/* -------------------------------------------------------------------------- */

export interface StepRunResult {
  status: "ok" | "failed" | "skipped";
  durationMs?: number;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  /** Plain-words summary of why the step produced what it did. */
  note?: string;
  error?: string;
  /** True when the step was edited after this run, so the result is out of date. */
  stale?: boolean;
}

function ValueRows({ values }: { values: Record<string, unknown> }) {
  const entries = Object.entries(values);
  if (entries.length === 0) {
    return <div className="px-3 py-1.5 text-xs text-muted-foreground">Nothing</div>;
  }
  return (
    <>
      {entries.map(([k, v]) => (
        <div
          key={k}
          className="flex gap-3 border-t border-border/60 px-3 py-1.5 text-xs first:border-t-0"
        >
          <span className="font-mono text-[11px] text-muted-foreground">{k}</span>
          <span className="ml-auto font-semibold tabular-nums">{formatValue(v)}</span>
        </div>
      ))}
    </>
  );
}

function formatValue(v: unknown): string {
  if (typeof v === "string") return `"${v}"`;
  if (v === null || v === undefined) return "—";
  return String(v);
}

function RunOutput({
  result,
  resultName,
  onRerun,
}: {
  result: StepRunResult;
  resultName: string;
  onRerun?: () => void;
}) {
  return (
    <section className="-mx-4 mt-1 border-t border-border bg-muted/40 px-4 py-4">
      <div className="mb-3 flex items-center gap-2">
        <span
          aria-hidden="true"
          className={cn(
            "grid h-[22px] w-[22px] place-items-center rounded-md border text-[11px]",
            result.status === "ok"
              ? "border-primary/30 bg-primary/10 text-primary"
              : result.status === "failed"
                ? "border-red-200 bg-red-50 text-red-600 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400"
                : "border-border bg-muted text-muted-foreground"
          )}
        >
          {result.status === "ok" ? "✓" : result.status === "failed" ? "!" : "–"}
        </span>
        <h4 className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
          What this step did
        </h4>
        <span className="ml-auto text-[11px] text-muted-foreground">
          last test run
          {typeof result.durationMs === "number" ? ` · ${result.durationMs} ms` : ""}
        </span>
      </div>

      {result.status === "failed" && result.error ? (
        <p className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
          {result.error}
        </p>
      ) : null}

      {result.input ? (
        <div className="mb-2 overflow-hidden rounded-lg border border-border bg-card">
          <div className="border-b border-border bg-muted/50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
            Went in
          </div>
          <ValueRows values={result.input} />
        </div>
      ) : null}

      {result.note ? (
        <p className="mb-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
          {result.note}
        </p>
      ) : null}

      {result.output ? (
        <div className="mb-2 overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex border-b border-border bg-muted/50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
            Came out
            {resultName ? <span className="ml-auto text-primary">as {resultName}</span> : null}
          </div>
          <ValueRows values={result.output} />
        </div>
      ) : null}

      {onRerun ? (
        <button
          type="button"
          onClick={onRerun}
          className="w-full rounded-lg border border-border bg-card py-2 text-xs font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          Run this step again
        </button>
      ) : null}

      {result.stale ? (
        <p className="mt-2 flex gap-1.5 text-[11.5px] leading-snug text-amber-700 dark:text-amber-300">
          <span aria-hidden="true">⚠</span>
          <span>You changed this step since that run. Re-run to see what it does now.</span>
        </p>
      ) : null}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Field primitives                                                           */
/* -------------------------------------------------------------------------- */

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  // A real <label> wrapping the control, not a styled <span> beside it: without
  // it the selects announce as "combobox" with no name at all, which is the
  // difference between a usable panel and an unusable one on a screen reader.
  return (
    // the control is the `children` this wrapper renders inside the label.
    <label className="mb-3.5 block">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </span>
      {children}
      {hint ? (
        <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">{hint}</p>
      ) : null}
    </label>
  );
}

const inputClass =
  "w-full rounded-lg border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/10";

export function Ref({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[11px] text-primary">
      {children}
    </code>
  );
}

/* -------------------------------------------------------------------------- */
/*  Step inspector                                                             */
/* -------------------------------------------------------------------------- */

interface StepInspectorProps {
  step: AutomationStep;
  index: number;
  available: AvailableValue[];
  ruleTables: { id: string; name: string; rowCount: number; outputs: string[] }[];
  entities: string[];
  fieldsFor: (entity: string) => string[];
  run?: StepRunResult;
  onChange: (next: AutomationStep) => void;
  onRerun?: () => void;
  onOpenRuleTable?: (name: string) => void;
  /** The record type the automation runs on — what a write naming none acts on. */
  ownEntity?: string;
}

export function StepInspector({
  step,
  index,
  available,
  ruleTables,
  entities,
  fieldsFor,
  run,
  onChange,
  onRerun,
  onOpenRuleTable,
  ownEntity = "",
}: StepInspectorProps) {
  const setProp = (key: string, value: string) =>
    onChange({ ...step, props: { ...step.props, [key]: value } });

  // An update or delete that names no record type acts on the record the
  // automation runs on — the executor's reading, the checker's, and the one the
  // model's own sagas are written in. So that is what the picker shows, and
  // choosing it stores no entity: naming it drew EML265 ("targets FeeInvoice
  // without saying which row") for a write that was never ambiguous.
  const writesOwnRecord = step.type === "UpdateEntity" || step.type === "DeleteEntity";
  const shownEntity = step.props.entity || (writesOwnRecord ? ownEntity : "");
  const setEntity = (value: string) => {
    if (writesOwnRecord && value === ownEntity) {
      const props = { ...step.props };
      delete props.entity;
      onChange({ ...step, props });
    } else setProp("entity", value);
  };

  const table = useMemo(
    () => ruleTables.find((t) => t.name === step.props.ruleTable),
    [ruleTables, step.props.ruleTable]
  );

  const fields = STEP_FIELDS[step.type] ?? [];

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 px-4 py-3.5">
        <span
          aria-hidden="true"
          className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg border border-primary/30 bg-primary/10 text-sm text-primary"
        >
          {STEP_GLYPHS[step.type]}
        </span>
        <div>
          <span className="block text-[10px] font-bold uppercase tracking-[0.1em] text-primary">
            Step {index + 1} · Then do this
          </span>
          <h3 className="text-[15px] font-bold">{STEP_LABELS[step.type]}</h3>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4">
        <p className="mb-4 text-xs leading-snug text-muted-foreground">{STEP_HINTS[step.type]}</p>

        {/* One list per step, not per field: every input that offers references
            points at this id, and emitting it only under some fields left the
            others with an autocomplete that quietly did nothing. */}
        <datalist id={`vals-${step.id}`}>
          {available.map((v) => (
            <option key={v.path} value={`{{${v.path}}}`} />
          ))}
        </datalist>

        {fields.includes("ruleTable") ? (
          <Field
            label="Rule table"
            hint={
              table ? (
                <>
                  {table.rowCount} rows · decides{" "}
                  {table.outputs.map((o, i) => (
                    <span key={o}>
                      {i > 0 ? " and " : ""}
                      <Ref>{o}</Ref>
                    </span>
                  ))}
                  .{" "}
                  {onOpenRuleTable ? (
                    <button
                      type="button"
                      onClick={() => onOpenRuleTable(table.name)}
                      className="font-semibold text-primary hover:underline"
                    >
                      Open table →
                    </button>
                  ) : null}
                </>
              ) : (
                "Pick the table this step should ask."
              )
            }
          >
            <select
              className={inputClass}
              value={step.props.ruleTable ?? ""}
              onChange={(e) => setProp("ruleTable", e.target.value)}
            >
              <option value="">Choose a rule table…</option>
              {ruleTables.map((t) => (
                <option key={t.id} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        {fields.includes("entity") ? (
          <Field label="Record type">
            <select
              className={inputClass}
              value={shownEntity}
              onChange={(e) => setEntity(e.target.value)}
            >
              <option value="">Choose a record type…</option>
              {entities.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        {fields.includes("values") ? (
          <Field
            label="Columns to set"
            hint={
              <>
                One <code className="font-mono text-[11px]">column: value</code> per line. A value
                can be a reference to an earlier step, like <Ref>{"{{tier.discount_pct}}"}</Ref>.
              </>
            }
          >
            <textarea
              className={cn(inputClass, "min-h-[76px] font-mono text-xs")}
              value={step.props.values ?? ""}
              onChange={(e) => setProp("values", e.target.value)}
              placeholder={"status: open\nraised_by: {{order.id}}"}
            />
          </Field>
        ) : null}

        {fields.includes("target") ? (
          <Field
            label="Which record"
            hint={
              step.type === "UpdateEntity" ? (
                <>
                  Only for another record type: a reference from an earlier step like{" "}
                  <Ref>{"{{invoiceId}}"}</Ref>, or the column on that record pointing back to this
                  one, like <code className="font-mono text-[11px]">order_id</code>. Leave it empty
                  to write this record.
                </>
              ) : (
                <>
                  The record to delete, usually a reference from an earlier step —{" "}
                  <Ref>{"{{invoiceId}}"}</Ref>.
                </>
              )
            }
          >
            <input
              className={inputClass}
              value={step.props.target ?? ""}
              onChange={(e) => setProp("target", e.target.value)}
              list={`vals-${step.id}`}
            />
          </Field>
        ) : null}

        {fields.includes("field") ? (
          <Field label="Field to write">
            <select
              className={inputClass}
              value={step.props.field ?? ""}
              onChange={(e) => setProp("field", e.target.value)}
            >
              <option value="">Choose a field…</option>
              {fieldsFor(shownEntity).map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        {fields.includes("value") ? (
          <Field
            label="New value"
            hint={
              <>
                A fixed value, or a reference to an earlier step like{" "}
                <Ref>{"{{tier.discount_pct}}"}</Ref>.
              </>
            }
          >
            <input
              className={inputClass}
              value={step.props.value ?? ""}
              onChange={(e) => setProp("value", e.target.value)}
              list={`vals-${step.id}`}
              placeholder="high"
            />
          </Field>
        ) : null}

        {fields.includes("operation") ? (
          <Field label="Operation">
            <select
              className={inputClass}
              value={step.props.operation ?? "set"}
              onChange={(e) => setProp("operation", e.target.value)}
            >
              {["set", "copy", "add", "subtract", "multiply", "divide"].map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        {fields.includes("left") ? (
          <Field label="Value to work from">
            <input
              className={inputClass}
              value={step.props.left ?? ""}
              onChange={(e) => setProp("left", e.target.value)}
              list={`vals-${step.id}`}
            />
          </Field>
        ) : null}

        {fields.includes("right") ? (
          <Field label="And this value" hint="Leave empty when the operation only needs one value.">
            <input
              className={inputClass}
              value={step.props.right ?? ""}
              onChange={(e) => setProp("right", e.target.value)}
              list={`vals-${step.id}`}
            />
          </Field>
        ) : null}

        {fields.includes("method") ? (
          <Field label="Method">
            <select
              className={inputClass}
              value={step.props.method ?? "POST"}
              onChange={(e) => setProp("method", e.target.value)}
            >
              {["POST", "PUT", "PATCH", "GET", "DELETE"].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        {fields.includes("url") ? (
          <Field label="URL">
            <input
              className={inputClass}
              value={step.props.url ?? ""}
              onChange={(e) => setProp("url", e.target.value)}
              placeholder="https://example.com/hooks/orders"
            />
          </Field>
        ) : null}

        {fields.includes("body") ? (
          <Field
            label="Body"
            hint={
              <>
                JSON. References like <Ref>{"{{order.id}}"}</Ref> are filled in before sending.
              </>
            }
          >
            <textarea
              className={cn(inputClass, "min-h-[76px] font-mono text-xs")}
              value={step.props.body ?? ""}
              onChange={(e) => setProp("body", e.target.value)}
            />
          </Field>
        ) : null}

        <Field
          label="Save the answer as"
          hint={
            step.resultName ? (
              <>
                Later steps can use <Ref>{`{{${step.resultName}}}`}</Ref>.
              </>
            ) : (
              "Leave empty if no later step needs this step's result."
            )
          }
        >
          <input
            className={inputClass}
            value={step.resultName}
            onChange={(e) => onChange({ ...step, resultName: e.target.value })}
            placeholder="tier"
          />
        </Field>

        {run ? <RunOutput result={run} resultName={step.resultName} onRerun={onRerun} /> : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Condition inspector                                                        */
/* -------------------------------------------------------------------------- */

export function ConditionInspector({
  condition,
  available,
  onChange,
}: {
  condition: Condition;
  available: AvailableValue[];
  onChange: (next: Condition) => void;
}) {
  const needsValue = operatorArity(condition.operator) === 1;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 px-4 py-3.5">
        <span
          aria-hidden="true"
          className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg border border-blue-200 bg-blue-50 text-sm text-blue-600 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-400"
        >
          ◇
        </span>
        <div>
          <span className="block text-[10px] font-bold uppercase tracking-[0.1em] text-blue-600 dark:text-blue-400">
            Only continue if
          </span>
          <h3 className="text-[15px] font-bold">A check</h3>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4">
        <p className="mb-4 text-xs leading-snug text-muted-foreground">
          Every check must pass. To run on either of two cases, build two automations — each one
          then reports its own run history.
        </p>

        <Field label="Field to look at">
          <select
            className={inputClass}
            value={condition.field}
            onChange={(e) => onChange({ ...condition, field: e.target.value })}
          >
            <option value="">Choose a field…</option>
            {available.map((v) => (
              <option key={v.path} value={v.path}>
                {v.path}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Test">
          <select
            className={inputClass}
            value={condition.operator}
            onChange={(e) => onChange({ ...condition, operator: e.target.value })}
          >
            {OPERATORS.map((op) => (
              <option key={op.id} value={op.id}>
                {op.label}
              </option>
            ))}
          </select>
        </Field>

        {needsValue ? (
          <Field label="Value" hint="A fixed value, or another field to compare against.">
            <input
              className={inputClass}
              value={condition.value}
              onChange={(e) => onChange({ ...condition, value: e.target.value })}
              placeholder="1000"
            />
          </Field>
        ) : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Loop inspector                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The panel for a repeat.
 *
 * It edits one thing — the check that ends the loop — so most of the panel is
 * spent explaining the consequences instead. A repeat is the only construct in
 * the builder that can hang a request, and the place to say so is where someone
 * is deciding what to check, not in help they would have to go looking for.
 */
export function LoopInspector({
  loop,
  stepCount,
  available,
  onChange,
}: {
  loop: Loop;
  stepCount: number;
  available: AvailableValue[];
  onChange: (next: Loop) => void;
}) {
  const needsValue = operatorArity(loop.condition.operator) === 1;
  const set = (patch: Partial<Condition>) =>
    onChange({ ...loop, condition: { ...loop.condition, ...patch } });

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 px-4 py-3.5">
        <span
          aria-hidden="true"
          className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg border border-teal-200 bg-teal-50 text-sm text-teal-700 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-300"
        >
          ↻
        </span>
        <div>
          <span className="block text-[10px] font-bold uppercase tracking-[0.1em] text-teal-700 dark:text-teal-300">
            Keep repeating
          </span>
          <h3 className="text-[15px] font-bold">A repeat</h3>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4">
        <p className="mb-4 text-xs leading-snug text-muted-foreground">
          The {stepCount === 1 ? "step" : `${stepCount} steps`} inside run over and over while this
          check passes. It is re-checked before every pass, so something inside the repeat has to
          change what it looks at — otherwise it never stops.
        </p>

        <Field label="Field to look at">
          <select
            className={inputClass}
            value={loop.condition.field}
            onChange={(e) => set({ field: e.target.value })}
          >
            <option value="">Choose a field…</option>
            {available.map((v) => (
              <option key={v.path} value={v.path}>
                {v.path}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Keep going while">
          <select
            className={inputClass}
            value={loop.condition.operator}
            onChange={(e) => set({ operator: e.target.value })}
          >
            {OPERATORS.map((op) => (
              <option key={op.id} value={op.id}>
                {op.label}
              </option>
            ))}
          </select>
        </Field>

        {needsValue ? (
          <Field label="Value" hint="A fixed value, or another field to compare against.">
            <input
              className={inputClass}
              value={loop.condition.value}
              onChange={(e) => set({ value: e.target.value })}
              placeholder="5"
            />
          </Field>
        ) : null}

        <Field
          label="Give up after (required)"
          hint="How many passes is obviously too many for this loop? There is no default — only you know what this work should cost."
        >
          <input
            className={inputClass}
            inputMode="numeric"
            value={loop.maxPasses}
            onChange={(e) => onChange({ ...loop, maxPasses: e.target.value })}
            placeholder="e.g. 10"
            aria-invalid={!loop.maxPasses.trim() || Number(loop.maxPasses) < LOOP_MIN_PASSES}
          />
        </Field>

        <div className="mb-4 rounded-lg border border-teal-200 bg-teal-50/60 p-3 dark:border-teal-800 dark:bg-teal-950/40">
          <p className="text-[11.5px] font-semibold text-teal-800 dark:text-teal-300">
            Inside the repeat you can use {`{{${loop.id}.iteration}}`}
          </p>
          <p className="mt-1 text-[11.5px] leading-snug text-teal-800/80 dark:text-teal-300">
            The pass number, counting from 1. Handy for writing an attempt count, or for building a
            value that changes each time round.
          </p>
        </div>

        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-800 dark:bg-amber-950/40">
          <p className="text-[11.5px] font-semibold text-amber-900 dark:text-amber-200">
            If the check never fails, the run is stopped at{" "}
            {loop.maxPasses.trim() ? `${loop.maxPasses} passes` : "the limit you set"}
          </p>
          <p className="mt-1 text-[11.5px] leading-snug text-amber-900/80 dark:text-amber-200">
            An automation runs inside the save that triggered it, so a repeat that cannot end holds
            the record open. Hitting the limit marks the whole run failed rather than letting it
            look like it finished.
          </p>
        </div>
      </div>
    </div>
  );
}
