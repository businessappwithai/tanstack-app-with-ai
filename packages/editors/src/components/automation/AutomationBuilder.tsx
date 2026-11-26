/**
 * The automation builder.
 *
 * Three columns: the automations you have, the one you are editing drawn as a
 * ladder, and a panel for whatever is selected. The ladder reads top to bottom
 * in the order the executor runs, so what you see is the run.
 *
 * The `+` between cards is the only way to add anything. There is no palette to
 * learn and no canvas to arrange, because the model is a list — offering a
 * canvas would mean asking authors to lay out a graph that has only one shape.
 */

import { Fragment, useCallback, useMemo, useState } from "react";
import {
  type Automation,
  type AutomationHook,
  type AutomationStep,
  type Condition,
  describeCondition,
  describeStep,
  HOOK_EVENT_HINTS,
  HOOK_EVENTS,
  type HookEvent,
  type Loop,
  loopsOf,
  newCondition,
  newHook,
  newLoop,
  newStep,
  type Problem,
  type SagaOperation,
  type SagaTrigger,
  STEP_GLYPHS,
  STEP_HINTS,
  STEP_LABELS,
  STEP_TYPES,
  type StepType,
  TRIGGER_EVENTS,
  TRIGGER_HINTS,
  TRIGGER_LABELS,
  type Trigger,
  validateAutomation,
  valuesAvailableAt,
} from "../../lib/automation/model";
import { statusLabel, type StatusChoices } from "../../lib/eml/workflow-hooks";
import { cn } from "../../lib/utils";
import { LadderCard, LadderRung, LoopFrame, Token } from "./LadderCard";
import {
  ConditionInspector,
  LoopInspector,
  StepInspector,
  type StepRunResult,
} from "./StepInspector";

/* -------------------------------------------------------------------------- */
/*  Trigger inspector                                                          */
/* -------------------------------------------------------------------------- */

function TriggerInspector({
  trigger,
  entities,
  onChange,
  /**
   * A hook workflow has no single trigger: every rung carries its own event,
   * and `trigger.event` is never serialised for one. Showing the event picker
   * there offers a control that changes nothing, under copy ("one per
   * automation") that contradicts the seven cards next to it. The record type
   * still applies, because every hook binds to the same entity.
   */
  hookMode = false,
  saga,
  status,
}: {
  trigger: Trigger;
  entities: string[];
  hookMode?: boolean;
  /** Bind the workflow to a move; drawn only for a start an update makes. */
  status?: {
    value: string | undefined;
    choices: StatusChoices;
    onChange: (next: string | undefined) => void;
  };
  /** Present for a saga, whose start is a rule or an operation, not an event. */
  saga?: {
    sagaTrigger: SagaTrigger;
    sagaOperation: SagaOperation;
    onChange: (next: { sagaTrigger: SagaTrigger; sagaOperation: SagaOperation }) => void;
  };
  onChange: (next: Trigger) => void;
}) {
  const inputClass =
    "w-full rounded-lg border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/10";

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 px-4 py-3.5">
        <span
          aria-hidden="true"
          className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
        >
          ⚡
        </span>
        <div>
          <span className="block text-[10px] font-bold uppercase tracking-[0.1em] text-amber-700 dark:text-amber-300">
            When this happens
          </span>
          <h3 className="text-[15px] font-bold">
            {hookMode || saga ? "This process" : "The trigger"}
          </h3>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4">
        <p className="mb-4 text-xs leading-snug text-muted-foreground">
          {hookMode
            ? "Every step below runs on this record type. Each step says when it runs."
            : saga
              ? "The steps below run in order, on this record type."
              : "The event that starts the run. One per automation."}
        </p>

        <label className="mb-3.5 block">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Record type
          </span>
          <select
            className={inputClass}
            value={trigger.entity}
            onChange={(e) => onChange({ ...trigger, entity: e.target.value })}
          >
            <option value="">Choose a record type…</option>
            {entities.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>

        {saga ? (
          <>
            <label className="mb-3.5 block">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                What starts it
              </span>
              <select
                className={inputClass}
                value={saga.sagaTrigger}
                onChange={(e) =>
                  saga.onChange({
                    sagaTrigger: e.target.value as SagaTrigger,
                    sagaOperation: saga.sagaOperation,
                  })
                }
              >
                <option value="rule">A business rule decides</option>
                <option value="automatic">The record's own lifecycle</option>
              </select>
              <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">
                {saga.sagaTrigger === "rule"
                  ? "Runs only when a rule's action names this process."
                  : "Runs on every write of the kind chosen below."}
              </p>
            </label>

            {saga.sagaTrigger === "automatic" ? (
              <label className="mb-3.5 block">
                <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  On which write
                </span>
                <select
                  className={inputClass}
                  value={saga.sagaOperation}
                  onChange={(e) =>
                    saga.onChange({
                      sagaTrigger: saga.sagaTrigger,
                      sagaOperation: e.target.value as SagaOperation,
                    })
                  }
                >
                  <option value="CREATE">Created</option>
                  <option value="UPDATE">Updated</option>
                  <option value="DELETE">Deleted</option>
                  <option value="ALL">Any write</option>
                </select>
              </label>
            ) : null}
          </>
        ) : null}

        {status ? <StatusPicker {...status} entity={trigger.entity} inputClass={inputClass} /> : null}

        {hookMode || saga ? null : (
          <label className="mb-3.5 block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              What happens to it
            </span>
            <select
              className={inputClass}
              value={trigger.event}
              onChange={(e) => onChange({ ...trigger, event: e.target.value as Trigger["event"] })}
            >
              {TRIGGER_EVENTS.map((ev) => (
                <option key={ev} value={ev}>
                  {TRIGGER_LABELS[ev]}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">
              {TRIGGER_HINTS[trigger.event]}
            </p>
          </label>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Add menu                                                                   */
/* -------------------------------------------------------------------------- */

function AddMenu({
  onAddCondition,
  onAddLoop,
  onAddStep,
  onCancel,
}: {
  onAddCondition: () => void;
  onAddLoop: () => void;
  onAddStep: (type: StepType) => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="w-full rounded-xl border border-primary/40 bg-card p-3 shadow-lg"
      role="menu"
      aria-label="Add a condition or an action"
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

      <button
        type="button"
        role="menuitem"
        onClick={onAddCondition}
        className="mb-2 flex w-full items-start gap-2.5 rounded-lg border border-border p-2.5 text-left hover:border-blue-300 hover:bg-blue-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:hover:border-blue-800 dark:hover:bg-blue-950/40"
      >
        <span
          aria-hidden="true"
          className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-md border border-blue-200 bg-blue-50 text-xs text-blue-600 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-400"
        >
          ◇
        </span>
        <span>
          <strong className="block text-[12.5px]">A check</strong>
          <span className="text-[11.5px] leading-snug text-muted-foreground">
            Only carry on when something is true.
          </span>
        </span>
      </button>

      <button
        type="button"
        role="menuitem"
        onClick={onAddLoop}
        className="mb-2 flex w-full items-start gap-2.5 rounded-lg border border-border p-2.5 text-left hover:border-teal-300 hover:bg-teal-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:hover:border-teal-800 dark:hover:bg-teal-950/40"
      >
        <span
          aria-hidden="true"
          className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-md border border-teal-200 bg-teal-50 text-xs text-teal-700 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-300"
        >
          ↻
        </span>
        <span>
          <strong className="block text-[12.5px]">A repeat</strong>
          <span className="text-[11.5px] leading-snug text-muted-foreground">
            Do the same steps over and over while something stays true.
          </span>
        </span>
      </button>

      <div className="grid grid-cols-2 gap-2">
        {STEP_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            role="menuitem"
            onClick={() => onAddStep(type)}
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
                {STEP_HINTS[type]}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Selection                                                                  */
/* -------------------------------------------------------------------------- */

type Selection =
  | { kind: "trigger" }
  | { kind: "condition"; id: string }
  | { kind: "loop"; id: string }
  | { kind: "step"; id: string }
  | { kind: "hook"; id: string }
  | null;

export interface RuleTableSummary {
  id: string;
  name: string;
  rowCount: number;
  outputs: string[];
}

export interface AutomationBuilderProps {
  automation: Automation;
  onChange: (next: Automation) => void;
  entities: string[];
  /**
   * What the record type can be bound to. Omitted means the host has no status
   * flows to offer, and the "When the status becomes" picker is not drawn.
   */
  statusChoices?: StatusChoices;
  /** Field names per entity, used to offer real references rather than free text. */
  entityFields?: Record<string, string[]>;
  ruleTables?: RuleTableSummary[];
  /** Last test run, keyed by step id. */
  runResults?: Record<string, StepRunResult>;
  onTestRun?: () => void;
  onRerunStep?: (stepId: string) => void;
  onOpenRuleTable?: (name: string) => void;
  onOpenHelp?: () => void;
  onPublish?: () => void;
  /**
   * Edit a single lifecycle step and nothing else.
   *
   * The enhance page selects one hook and opens it here: the rung is fixed (no
   * add, move or remove) and its event reads as chosen on the hooks list rather
   * than as another picker.
   */
  lockHook?: boolean;
}

export function AutomationBuilder({
  automation,
  onChange,
  entities,
  statusChoices,
  entityFields = {},
  ruleTables = [],
  runResults = {},
  onTestRun,
  onRerunStep,
  onOpenRuleTable,
  onOpenHelp,
  onPublish,
  lockHook = false,
}: AutomationBuilderProps) {
  const [selection, setSelection] = useState<Selection>(() =>
    lockHook && automation.hooks[0]
      ? { kind: "hook", id: automation.hooks[0].id }
      : { kind: "trigger" }
  );
  /** Index in the steps list the add menu is open above, or null when closed. */
  const [addingAt, setAddingAt] = useState<number | null>(null);

  const problems = useMemo(() => validateAutomation(automation), [automation]);
  const problemFor = useCallback(
    (target: string) => problems.find((p: Problem) => p.target === target)?.message,
    [problems]
  );

  const fieldsFor = useCallback((entity: string) => entityFields[entity] ?? [], [entityFields]);

  const updateCondition = (next: Condition) =>
    onChange({
      ...automation,
      conditions: automation.conditions.map((c) => (c.id === next.id ? next : c)),
    });

  const updateStep = (next: AutomationStep) =>
    onChange({
      ...automation,
      steps: automation.steps.map((s) => (s.id === next.id ? next : s)),
    });

  const removeCondition = (id: string) => {
    onChange({ ...automation, conditions: automation.conditions.filter((c) => c.id !== id) });
    setSelection((s) => (s?.kind === "condition" && s.id === id ? null : s));
  };

  const removeStep = (id: string) => {
    onChange({ ...automation, steps: automation.steps.filter((s) => s.id !== id) });
    setSelection((s) => (s?.kind === "step" && s.id === id ? null : s));
  };

  const addCondition = () => {
    const c = newCondition();
    onChange({ ...automation, conditions: [...automation.conditions, c] });
    setSelection({ kind: "condition", id: c.id });
    setAddingAt(null);
  };

  const addStep = (type: StepType, at: number) => {
    const step = newStep(type);
    const steps = [...automation.steps];
    // A step lands inside a repeat only when it is dropped strictly between two
    // of its members. Inserting at the boundary goes outside, which is the
    // reading that matches where the click was; the frame carries its own
    // "add inside" button for the other case.
    const before = steps[at - 1];
    const after = steps[at];
    if (before?.loopId && before.loopId === after?.loopId) step.loopId = before.loopId;
    steps.splice(at, 0, step);
    onChange({ ...automation, steps });
    setSelection({ kind: "step", id: step.id });
    setAddingAt(null);
  };

  /**
   * A repeat arrives with one step already in it.
   *
   * An empty repeat is invalid the moment it exists, so offering one would mean
   * every author sees an error before they have done anything wrong. Starting
   * with an UpdateEntity is also the nudge the loop needs: the check can only
   * stop the loop if something inside it writes that field.
   */
  const addLoop = (at: number) => {
    const loop = newLoop(loopsOf(automation));
    const step = newStep("UpdateEntity");
    step.loopId = loop.id;
    const steps = [...automation.steps];
    steps.splice(at, 0, step);
    onChange({ ...automation, loops: [...loopsOf(automation), loop], steps });
    setSelection({ kind: "loop", id: loop.id });
    setAddingAt(null);
  };

  const updateLoop = (next: Loop) =>
    onChange({
      ...automation,
      loops: loopsOf(automation).map((l) => (l.id === next.id ? next : l)),
    });

  /** Removing a repeat keeps its steps — they stop repeating, they do not vanish. */
  const removeLoop = (id: string) => {
    onChange({
      ...automation,
      loops: loopsOf(automation).filter((l) => l.id !== id),
      steps: automation.steps.map((s) => (s.loopId === id ? { ...s, loopId: undefined } : s)),
    });
    setSelection((s) => (s?.kind === "loop" && s.id === id ? null : s));
  };

  /**
   * The flat step list grouped into consecutive runs, so each repeat can be
   * drawn as one frame around its members while the list itself stays flat.
   */
  const runs = useMemo(() => {
    const out: Array<{ loop?: Loop; steps: Array<{ step: AutomationStep; index: number }> }> = [];
    automation.steps.forEach((step, index) => {
      const last = out[out.length - 1];
      if (last && last.loop?.id === step.loopId) {
        last.steps.push({ step, index });
        return;
      }
      out.push({
        loop: step.loopId ? loopsOf(automation).find((l) => l.id === step.loopId) : undefined,
        steps: [{ step, index }],
      });
    });
    return out;
  }, [automation]);

  const selectedStepIndex =
    selection?.kind === "step" ? automation.steps.findIndex((s) => s.id === selection.id) : -1;

  /**
   * The conditions and steps, shared by every workflow kind.
   *
   * A hook workflow used to stop at its rungs, so the steps an author had
   * already built vanished the moment a hook was added. Its trigger is the
   * hook; what happens after it is the same ladder an automation uses.
   */
  const stepsLadder = (
    <>
      {automation.conditions.map((c) => (
        <ConditionRow
          key={c.id}
          condition={c}
          selected={selection?.kind === "condition" && selection.id === c.id}
          problem={problemFor(c.id)}
          onSelect={() => setSelection({ kind: "condition", id: c.id })}
          onRemove={() => removeCondition(c.id)}
          onAddAbove={() => setAddingAt(0)}
        />
      ))}

      {runs.map((run) => {
        const rows = run.steps.map(({ step, index }) => (
          <StepRow
            key={step.id}
            step={step}
            index={index}
            selected={selection?.kind === "step" && selection.id === step.id}
            problem={problemFor(step.id)}
            adding={addingAt === index}
            onSelect={() => setSelection({ kind: "step", id: step.id })}
            onRemove={() => removeStep(step.id)}
            onOpenAdd={() => setAddingAt(index)}
            onCancelAdd={() => setAddingAt(null)}
            onAddCondition={addCondition}
            onAddLoop={() => addLoop(index)}
            onAddStep={(type) => addStep(type, index)}
          />
        ));

        if (!run.loop) return rows;

        const last = run.steps[run.steps.length - 1];
        return (
          <div key={run.loop.id} className="w-full">
            <LadderRung onAdd={() => setAddingAt(run.steps[0]?.index ?? 0)} />
            <LadderCard
              kind="loop"
              glyph="↻"
              title={<LoopTitle loop={run.loop} />}
              selected={selection?.kind === "loop" && selection.id === run.loop.id}
              problem={problemFor(run.loop.id)}
              onSelect={() => setSelection({ kind: "loop", id: run.loop?.id as string })}
              onRemove={() => removeLoop(run.loop?.id as string)}
            />
            <LoopFrame stepCount={run.steps.length} problem={Boolean(problemFor(run.loop.id))}>
              {rows}
              <div className="mt-1 flex flex-col items-center">
                <LadderRung onAdd={() => setAddingAt(last ? last.index + 1 : 0)} />
                <button
                  type="button"
                  onClick={() => setAddingAt(last ? last.index + 1 : 0)}
                  className="w-full rounded-lg border border-dashed border-teal-300 bg-card py-2 text-xs font-semibold text-teal-700 hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-teal-800 dark:text-teal-300 dark:hover:bg-teal-950/40"
                >
                  ＋ Add a step inside this repeat
                </button>
              </div>
            </LoopFrame>
          </div>
        );
      })}

      {addingAt === automation.steps.length ? (
        <>
          <LadderRung onAdd={() => setAddingAt(null)} active />
          <AddMenu
            onAddCondition={addCondition}
            onAddLoop={() => addLoop(automation.steps.length)}
            onAddStep={(type) => addStep(type, automation.steps.length)}
            onCancel={() => setAddingAt(null)}
          />
        </>
      ) : (
        <>
          <LadderRung onAdd={() => setAddingAt(automation.steps.length)} />
          <button
            type="button"
            onClick={() => setAddingAt(automation.steps.length)}
            className="w-full rounded-xl border border-dashed border-border bg-card py-3 text-sm font-semibold text-muted-foreground hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            ＋ <span className="text-primary">Add a condition or an action</span>
          </button>
        </>
      )}

      {problemFor("steps") ? (
        <p className="mt-3 w-full text-xs text-amber-700 dark:text-amber-300">
          {problemFor("steps")}
        </p>
      ) : null}
    </>
  );

  /* ---- hook workflows ---------------------------------------------------- */

  const selectedHook =
    selection?.kind === "hook"
      ? (automation.hooks.find((h) => h.id === selection.id) ?? null)
      : null;

  const updateHook = (next: AutomationHook) =>
    onChange({
      ...automation,
      hooks: automation.hooks.map((h) => (h.id === next.id ? next : h)),
    });

  const addHookAt = (index: number) => {
    const hook = newHook();
    const hooks = [...automation.hooks];
    hooks.splice(index, 0, hook);
    onChange({ ...automation, hooks });
    setSelection({ kind: "hook", id: hook.id });
  };

  const removeHook = (id: string) => {
    onChange({ ...automation, hooks: automation.hooks.filter((h) => h.id !== id) });
    setSelection((s) => (s?.kind === "hook" && s.id === id ? null : s));
  };

  /** Order is run order, so moving a rung is a real edit, not presentation. */
  const moveHook = (id: string, delta: number) => {
    const index = automation.hooks.findIndex((h) => h.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= automation.hooks.length) return;
    const hooks = [...automation.hooks];
    const [moved] = hooks.splice(index, 1);
    if (moved) hooks.splice(target, 0, moved);
    onChange({ ...automation, hooks });
  };

  return (
    <div className="flex h-full min-h-0 flex-1">
      {/* ---------------------------------------------------------------- */}
      {/* ladder                                                            */}
      {/* ---------------------------------------------------------------- */}
      <div className="flex flex-1 flex-col items-center overflow-y-auto bg-muted/30 px-6 pt-6 pb-10">
        <div className="w-full max-w-[604px]">
          {/* The name is the heading and is edited in place, so there is no
              separate title field to go looking for — the same move Jira makes
              on an automation rule. */}
          <input
            aria-label="Name"
            className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-0.5 -ml-1.5 text-xl font-bold tracking-tight hover:border-border focus-visible:border-primary focus-visible:bg-card focus-visible:outline-none disabled:cursor-default disabled:hover:border-transparent"
            value={automation.name}
            placeholder="Name this process"
            disabled={lockHook}
            readOnly={lockHook}
            onChange={
              lockHook ? undefined : (e) => onChange({ ...automation, name: e.target.value })
            }
          />
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            {runsWhen(automation)}
            {problems.length > 0 ? (
              <span className="text-amber-700 dark:text-amber-300">
                {" · "}
                {problems.length} thing{problems.length === 1 ? "" : "s"} to fix before publishing
              </span>
            ) : null}
          </p>
        </div>

        <div className="mt-4 flex w-full max-w-[604px] flex-col items-center">
          {automation.kind === "hook" ? (
            <>
              {statusChoices ? (
                <div className="mb-3 w-full rounded-xl border border-border bg-card p-3">
                  <StatusPicker
                    value={automation.onStatus}
                    choices={statusChoices}
                    entity={automation.trigger.entity}
                    onChange={(onStatus) => onChange({ ...automation, onStatus })}
                    inputClass="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/10"
                  />
                </div>
              ) : null}

              {/* Every rung is its own trigger, so each one is a "when" card.
                  The order is the order the backend runs them in. */}
              {automation.hooks.map((hook, index) => (
                <Fragment key={hook.id}>
                  {!lockHook && index > 0 ? (
                    <LadderRung onAdd={() => addHookAt(index)} label="Add a lifecycle step here" />
                  ) : null}
                  <LadderCard
                    kind="when"
                    glyph="⚡"
                    title={<HookTitle hook={hook} entity={automation.trigger.entity} />}
                    selected={selection?.kind === "hook" && selection.id === hook.id}
                    problem={problemFor(hook.id)}
                    onSelect={() => setSelection({ kind: "hook", id: hook.id })}
                    onRemove={lockHook ? undefined : () => removeHook(hook.id)}
                  />
                </Fragment>
              ))}

              {lockHook ? null : (
                <>
                  <LadderRung
                    onAdd={() => addHookAt(automation.hooks.length)}
                    label="Add a lifecycle step here"
                  />
                  <button
                    type="button"
                    onClick={() => addHookAt(automation.hooks.length)}
                    className="w-full rounded-xl border border-dashed border-border bg-card py-3 text-sm font-semibold text-muted-foreground hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  >
                    ＋ <span className="text-primary">Add a lifecycle step</span>
                  </button>
                </>
              )}

              {problemFor("hooks") ? (
                <p className="mt-3 w-full text-xs text-amber-700 dark:text-amber-300">
                  {problemFor("hooks")}
                </p>
              ) : null}
            </>
          ) : (
            <>
              <LadderCard
                kind="when"
                glyph="⚡"
                title={
                  <TriggerTitle
                    trigger={automation.trigger}
                    saga={
                      automation.kind === "saga"
                        ? {
                            sagaTrigger: automation.sagaTrigger ?? "rule",
                            sagaOperation: automation.sagaOperation ?? "CREATE",
                          }
                        : undefined
                    }
                    onStatus={automation.onStatus}
                  />
                }
                selected={selection?.kind === "trigger"}
                problem={problemFor("trigger")}
                onSelect={() => setSelection({ kind: "trigger" })}
              />
            </>
          )}
          {stepsLadder}
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* inspector                                                         */}
      {/* ---------------------------------------------------------------- */}
      <aside className="flex w-[404px] shrink-0 flex-col border-l border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-4 py-2">
          {onOpenHelp ? (
            <button
              type="button"
              onClick={onOpenHelp}
              className="rounded-md px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              ? Help
            </button>
          ) : null}
          <div className="flex-1" />
          {onTestRun ? (
            <button
              type="button"
              onClick={onTestRun}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Test run
            </button>
          ) : null}
          {onPublish ? (
            <button
              type="button"
              onClick={onPublish}
              disabled={problems.length > 0}
              title={
                problems.length > 0
                  ? `Fix ${problems.length} thing${problems.length === 1 ? "" : "s"} first`
                  : undefined
              }
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              Publish
            </button>
          ) : null}
        </div>

        <div className="min-h-0 flex-1">
          {selection?.kind === "trigger" ? (
            <TriggerInspector
              trigger={automation.trigger}
              entities={entities}
              hookMode={automation.kind === "hook"}
              saga={
                automation.kind === "saga"
                  ? {
                      sagaTrigger: automation.sagaTrigger ?? "rule",
                      sagaOperation: automation.sagaOperation ?? "CREATE",
                      onChange: (next) => onChange({ ...automation, ...next }),
                    }
                  : undefined
              }
              status={
                statusChoices &&
                automation.kind === "saga" &&
                automation.sagaTrigger === "automatic" &&
                automation.sagaOperation === "UPDATE"
                  ? {
                      value: automation.onStatus,
                      choices: statusChoices,
                      onChange: (onStatus) => onChange({ ...automation, onStatus }),
                    }
                  : undefined
              }
              onChange={(trigger) => onChange({ ...automation, trigger })}
            />
          ) : null}

          {selection?.kind === "condition"
            ? (() => {
                const c = automation.conditions.find((x) => x.id === selection.id);
                if (!c) return <EmptyInspector />;
                return (
                  <ConditionInspector
                    condition={c}
                    available={valuesAvailableAt(automation, 0, entityFields)}
                    onChange={updateCondition}
                  />
                );
              })()
            : null}

          {selection?.kind === "loop"
            ? (() => {
                const loop = loopsOf(automation).find((l) => l.id === selection.id);
                if (!loop) return <EmptyInspector />;
                // The check reads values as they stand at the top of a pass, so
                // it is offered the same list a step in the loop would see.
                const firstMember = automation.steps.findIndex((s) => s.loopId === loop.id);
                return (
                  <LoopInspector
                    loop={loop}
                    stepCount={automation.steps.filter((s) => s.loopId === loop.id).length}
                    available={valuesAvailableAt(
                      automation,
                      firstMember < 0 ? 0 : firstMember,
                      entityFields
                    )}
                    onChange={updateLoop}
                  />
                );
              })()
            : null}

          {selection?.kind === "step" && selectedStepIndex >= 0 ? (
            <StepInspector
              step={automation.steps[selectedStepIndex] as AutomationStep}
              index={selectedStepIndex}
              available={valuesAvailableAt(automation, selectedStepIndex, entityFields)}
              ruleTables={ruleTables}
              entities={entities}
              fieldsFor={fieldsFor}
              run={runResults[selection.id]}
              onChange={updateStep}
              onRerun={onRerunStep ? () => onRerunStep(selection.id) : undefined}
              onOpenRuleTable={onOpenRuleTable}
              ownEntity={automation.trigger.entity}
            />
          ) : null}

          {selectedHook ? (
            <HookInspector
              hook={selectedHook}
              index={automation.hooks.findIndex((h) => h.id === selectedHook.id)}
              count={automation.hooks.length}
              fields={fieldsFor(automation.trigger.entity)}
              problem={problemFor(selectedHook.id)}
              locked={lockHook}
              onChange={updateHook}
              onMove={(delta) => moveHook(selectedHook.id, delta)}
              onRemove={() => removeHook(selectedHook.id)}
            />
          ) : null}

          {selection === null ? <EmptyInspector /> : null}
        </div>
      </aside>
    </div>
  );
}

/**
 * One lifecycle rung, read as a sentence.
 *
 * The event leads because that is what decides when the handler runs; the
 * field, when present, is what the handler is scoped to.
 */
function HookTitle({ hook, entity }: { hook: AutomationHook; entity: string }) {
  return (
    <span>
      <Token>{hook.event}</Token> on {entity || "record"} →{" "}
      <Token>{hook.handler || "(unnamed)"}</Token>
      {hook.field ? (
        <>
          {" · "}
          <Token>{hook.field}</Token>
        </>
      ) : null}
    </span>
  );
}

function HookInspector({
  hook,
  index,
  count,
  fields,
  problem,
  locked = false,
  onChange,
  onMove,
  onRemove,
}: {
  hook: AutomationHook;
  index: number;
  count: number;
  fields: string[];
  problem?: string;
  /** Chosen on the hooks list, not here: no picker, no move, no remove. */
  locked?: boolean;
  onChange: (next: AutomationHook) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-4 p-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {locked ? "Lifecycle step" : `Step ${index + 1} of ${count}`}
        </p>
        <h2 className="text-base font-bold tracking-tight">Lifecycle step</h2>
        <p className="mt-1 text-[12.5px] text-muted-foreground">{HOOK_EVENT_HINTS[hook.event]}</p>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-medium">When</span>
        <select
          className="w-full rounded-md border border-border px-2 py-1.5 text-sm disabled:bg-muted disabled:text-muted-foreground"
          value={hook.event}
          disabled={locked}
          onChange={(e) => onChange({ ...hook, event: e.target.value as HookEvent })}
        >
          {HOOK_EVENTS.map((event) => (
            <option key={event} value={event}>
              {event}
            </option>
          ))}
        </select>
        {locked ? (
          <span className="mt-1 block text-[11.5px] text-muted-foreground">
            Set by the hook selected on the hooks list.
          </span>
        ) : null}
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium">Handler</span>
        <input
          className="w-full rounded-md border border-border px-2 py-1.5 font-mono text-sm disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
          value={hook.handler}
          disabled={locked}
          readOnly={locked}
          onChange={locked ? undefined : (e) => onChange({ ...hook, handler: e.target.value })}
          placeholder="normalizeAccountName"
        />
        <span className="mt-1 block text-[11.5px] text-muted-foreground">
          {locked
            ? "Set by the entity and hook type."
            : "The function the generated backend will call."}
        </span>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium">Field (optional)</span>
        <select
          className="w-full rounded-md border border-border px-2 py-1.5 text-sm"
          value={hook.field ?? ""}
          onChange={(e) => onChange({ ...hook, field: e.target.value || undefined })}
        >
          <option value="">— whole record —</option>
          {fields.map((field) => (
            <option key={field} value={field}>
              {field}
            </option>
          ))}
        </select>
      </label>

      {problem ? <p className="text-xs text-amber-700 dark:text-amber-300">{problem}</p> : null}

      {locked ? null : (
        <>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={index <= 0}
              onClick={() => onMove(-1)}
              className="flex-1 rounded-md border border-border px-3 py-1.5 text-sm font-medium disabled:opacity-40"
            >
              ↑ Move up
            </button>
            <button
              type="button"
              disabled={index >= count - 1}
              onClick={() => onMove(1)}
              className="flex-1 rounded-md border border-border px-3 py-1.5 text-sm font-medium disabled:opacity-40"
            >
              ↓ Move down
            </button>
          </div>

          <button
            type="button"
            onClick={onRemove}
            className="w-full rounded-md border border-border px-3 py-1.5 text-sm font-medium text-destructive"
          >
            Remove step
          </button>
        </>
      )}
    </div>
  );
}

function EmptyInspector() {
  return (
    <div className="grid h-full place-items-center px-8 text-center">
      <p className="text-sm text-muted-foreground">Pick a card on the left to set it up.</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Rows                                                                       */
/* -------------------------------------------------------------------------- */

function TriggerTitle({
  trigger,
  saga,
  onStatus,
}: {
  trigger: Trigger;
  /** The state whose entering move starts it, when bound to one. */
  onStatus?: string;
  /** A saga starts from a rule or an operation, never from `trigger.event`. */
  saga?: { sagaTrigger: SagaTrigger; sagaOperation: SagaOperation };
}) {
  if (!trigger.entity) return <span className="text-muted-foreground">Pick a record type…</span>;
  // "An Compound" read as a typo on every card that was not a vowel-initial
  // entity; the article has to follow the name the author actually picked.
  const article = /^[aeiou]/i.test(trigger.entity) ? "An" : "A";

  if (saga) {
    // Not the `{article} {entity} {predicate}` shape the other cards use: a
    // rule-triggered saga has no lifecycle event, and forcing it into that
    // frame reads as "A Lead a rule has decided on".
    return saga.sagaTrigger === "rule" ? (
      <>
        When a rule decides about {article.toLowerCase()} <Token>{trigger.entity}</Token>
      </>
    ) : (
      <>
        {article} <Token>{trigger.entity}</Token> {SAGA_OPERATION_TITLES[saga.sagaOperation]}
        {onStatus ? (
          <>
            {" "}
            and its status becomes <Token>{statusLabel(onStatus)}</Token>
          </>
        ) : null}
      </>
    );
  }

  return (
    <>
      {article} <Token>{trigger.entity}</Token> {TRIGGER_LABELS[trigger.event]}
    </>
  );
}

/**
 * "When the status becomes": bind a workflow to the move into a state. The
 * button first saves the form in its current status; this workflow then runs in
 * a second transaction, and the status moves only if it succeeds.
 */
function StatusPicker({
  value,
  choices,
  entity,
  onChange,
  inputClass,
}: {
  value: string | undefined;
  choices: StatusChoices;
  entity: string;
  onChange: (next: string | undefined) => void;
  inputClass: string;
}) {
  return (
    <label className="mb-3.5 block">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        When the status becomes
      </span>
      {choices.kind === "machine" ? (
        <select
          aria-label="Status"
          className={inputClass}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value || undefined)}
        >
          <option value="">Any update (no status)</option>
          {choices.states.map((state) => (
            <option key={state.value} value={state.value}>
              {state.label}
            </option>
          ))}
        </select>
      ) : (
        <select aria-label="Status" disabled className={`${inputClass} opacity-70`} value="final">
          <option value="final">Final</option>
        </select>
      )}
      <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">
        {choices.kind === "machine"
          ? "The button saves the form first, in its current status. This workflow then runs in another transaction and, if it succeeds, the status moves on. If a step fails the move is undone and the record stays where it was."
          : `${entity || "This record"} has no status flow, so it has two statuses, Draft and Final. The button saves it; another transaction then runs this workflow and moves the status to Final.`}
      </p>
    </label>
  );
}

const SAGA_OPERATION_TITLES: Record<SagaOperation, string> = {
  CREATE: "is created",
  UPDATE: "is updated",
  DELETE: "is deleted",
  ALL: "is written",
};

function ConditionRow({
  condition,
  selected,
  problem,
  onSelect,
  onRemove,
  onAddAbove,
}: {
  condition: Condition;
  selected: boolean;
  problem?: string;
  onSelect: () => void;
  onRemove: () => void;
  onAddAbove: () => void;
}) {
  return (
    <>
      <LadderRung onAdd={onAddAbove} />
      <LadderCard
        kind="if"
        glyph="◇"
        title={describeCondition(condition)}
        selected={selected}
        problem={problem}
        onSelect={onSelect}
        onRemove={onRemove}
      />
    </>
  );
}

/**
 * The clause on a repeat's card.
 *
 * Worded as the continuing rule and then the stopping one. It used to read
 * "until X stops being true", which is a double negative the moment X is
 * itself a negation — "until status is not paid stops being true". "While"
 * is also the word the saved EML uses (`Repeat while …`), and the stopping
 * clause still puts the end condition, the part that goes wrong, in view.
 */
/**
 * The line under a process's name. It said "Runs on every Payment" for every
 * process, including one a business rule starts — which runs on none of them
 * by itself — contradicting "What starts it" beside it.
 */
function runsWhen(automation: Automation): string {
  const entity = automation.trigger.entity || "record";
  if (automation.kind !== "saga") return `Runs on every ${entity}`;
  if (automation.sagaTrigger === "rule")
    return `Runs when a business rule starts it, on a ${entity}`;
  const write: Record<string, string> = {
    CREATE: "created",
    UPDATE: "updated",
    DELETE: "deleted",
  };
  const when = write[automation.sagaOperation ?? ""];
  return when ? `Runs every time a ${entity} is ${when}` : `Runs on every write to a ${entity}`;
}

function LoopTitle({ loop }: { loop: Loop }) {
  if (!loop.condition.field) {
    return <span className="text-muted-foreground">Say what to check, or this never stops.</span>;
  }
  return (
    <>
      while <Token value>{describeCondition(loop.condition)}</Token>, and stops once that is no
      longer true
    </>
  );
}

function StepRow({
  step,
  index,
  selected,
  problem,
  adding,
  onSelect,
  onRemove,
  onOpenAdd,
  onCancelAdd,
  onAddCondition,
  onAddLoop,
  onAddStep,
}: {
  step: AutomationStep;
  index: number;
  selected: boolean;
  problem?: string;
  adding: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onOpenAdd: () => void;
  onCancelAdd: () => void;
  onAddCondition: () => void;
  onAddLoop: () => void;
  onAddStep: (type: StepType) => void;
}) {
  return (
    <>
      <LadderRung onAdd={adding ? onCancelAdd : onOpenAdd} active={adding} />
      {adding ? (
        <div className={cn("mb-2 w-full")}>
          <AddMenu
            onAddCondition={onAddCondition}
            onAddLoop={onAddLoop}
            onAddStep={onAddStep}
            onCancel={onCancelAdd}
          />
        </div>
      ) : null}
      <LadderCard
        kind="action"
        glyph={STEP_GLYPHS[step.type]}
        ordinal={`· step ${index + 1}`}
        title={describeStep(step)}
        selected={selected}
        problem={problem}
        onSelect={onSelect}
        onRemove={onRemove}
      />
    </>
  );
}
