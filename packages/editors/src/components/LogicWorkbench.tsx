import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  GitBranch,
  ListOrdered,
  Loader2,
  Plus,
  Save,
  Trash2,
  Workflow as WorkflowIcon,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HelpTopicId } from "../content/help";
import { emptyAutomation } from "../lib/automation/model";
import { emptyDecisionTable } from "../lib/eml/decision-table";
import type { RuleDryRun } from "../lib/eml/dry-run-types";
import type { RuleConstraints } from "../lib/eml/rule-constraints";
import { sectionProblems } from "../lib/eml/section-problems";
import { hookFor, statusChoicesFor } from "../lib/eml/workflow-hooks";
import { newEditorKey } from "../lib/eml/workflow-model";
import { AutomationBuilder, type RuleTableSummary } from "./automation/AutomationBuilder";
import { type NewWorkflowDraft, NewWorkflowPanel } from "./eml/NewWorkflowPanel";
import { type EditableRule, RuleEditor, slugifyRuleName } from "./eml/RuleEditor";
import {
  type EditableWorkflow,
  emptyWorkflow,
  pascalWorkflowName,
  WorkflowEditor,
  type WorkflowKind,
} from "./eml/WorkflowEditor";
import { WorkflowRules } from "./eml/WorkflowRules";
import { HelpLink, HelpPanel } from "./help/HelpPanel";

/**
 * Rules and workflows, on one screen — the modelling tool's Logic step and every
 * generated application's Rules & workflows screen.
 *
 * One rail lists both. A rule decides and a process acts on what it decided, so they
 * share a screen, a Save and a vocabulary. This component owns everything an author
 * touches — the rail, creating a rule or a lifecycle, status machine or process, each
 * editor, attaching a rule to a hook, deleting, help — and **no input or output**: the
 * host says where the model comes from, what it declares, how a rule is tried and where
 * a save goes. Two hosts, one behaviour.
 */

/** Everything the screen writes, in one object: the document is edited once. */
export interface WorkbenchSave {
  rules: EditableRule[];
  workflows: EditableWorkflow[];
}

/** What the constraint reader needs to know about each workflow as it stands now. */
export interface ConstraintWorkflow {
  name: string;
  title: string;
  entity: string;
  kind: string;
  stateNames: string[];
}

export interface LogicWorkbenchProps {
  /** The model is still loading. */
  loading: boolean;
  /** Why the model could not be read, if it could not. */
  loadError?: string | null;
  /**
   * The model's rules and workflows, in the shape the editors edit; read once, when they
   * first arrive. Each host turns what it stores into these (and back) — see
   * `lib/eml/workflow-model.ts` for workflows.
   */
  rules: EditableRule[];
  workflows: EditableWorkflow[];
  /** The record types, with the fields each declares. */
  entities: Array<{ name: string; attributes: string[] }>;
  /** What a rule may name, per entity, given the workflows as they stand. */
  constraintsFor: (workflows: ConstraintWorkflow[]) => Record<string, RuleConstraints>;
  /** How this host tries a rule against a sample record. */
  dryRun: RuleDryRun;
  /** Write the model. Throw an `Error` whose message the author should read to refuse. */
  save: (payload: WorkbenchSave) => Promise<void>;
  /** Open on this rule or workflow, by slug (the host's address bar, if it has one). */
  initialSelection?: { rule?: string; workflow?: string };
  /** The author picked something; a host with an address bar records it. */
  onSelectionChange?: (selection: { rule?: string; workflow?: string }) => void;
  /** Where rules are written in full, if the host has a second place for it. */
  enhanceHref?: string;
  /** The host's own heading, shown above the screen. */
  header?: ReactNode;
  /** Buttons before and after Save. They may save first, then leave. */
  footerStart?: (api: { save: () => Promise<boolean>; busy: boolean }) => ReactNode;
  footerEnd?: (api: { save: () => Promise<boolean>; busy: boolean }) => ReactNode;
  /**
   * Workflows the author can read but not change — what a running application's model
   * declares, which its next generation rewrites. Keyed by the workflow's `key`.
   */
  lockedWorkflows?: ReadonlySet<string>;
  /** Whether the host keeps a rule's priority. Off, the field is not offered. Default on. */
  rulesHavePriority?: boolean;
  /** What a locked workflow says about itself. */
  lockedNote?: string;
  /** The names now on screen, for a host that tells an assistant about them. */
  onSummaryChange?: (summary: { ruleNames: string[]; workflowNames: string[] }) => void;
}

const nextKey = newEditorKey;

const workflowSlug = (w: EditableWorkflow) =>
  (w.title ?? w.name)
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");

/** The workflows bound to each state of one status machine, by state. */
function boundWorkflowsFor(
  machine: EditableWorkflow,
  workflows: readonly EditableWorkflow[]
): Record<string, string[]> {
  const bound: Record<string, string[]> = {};
  if (machine.kind !== "state") return bound;
  for (const workflow of workflows) {
    const status = workflow.automation?.onStatus;
    if (workflow.kind === "state" || !status || workflow.entity !== machine.entity) continue;
    (bound[status] ??= []).push(workflow.title ?? workflow.name);
  }
  return bound;
}

export function LogicWorkbench({
  loading,
  loadError,
  rules: storedRules,
  workflows: storedWorkflows,
  entities,
  constraintsFor,
  dryRun,
  save: saveModel,
  initialSelection,
  onSelectionChange,
  enhanceHref,
  header,
  footerStart,
  footerEnd,
  lockedWorkflows,
  lockedNote,
  rulesHavePriority = true,
  onSummaryChange,
}: LogicWorkbenchProps) {
  const [rules, setRules] = useState<EditableRule[]>([]);
  const [workflows, setWorkflows] = useState<EditableWorkflow[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  // A workflow starts from the hooks it attaches to, so with none yet the screen opens on
  // that, not on an empty editor.
  const [creating, setCreating] = useState(false);
  // A rule is edited here too, with no moment of its own: a workflow hook gives it one.
  const [selectedRule, setSelectedRule] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpTopicId, setHelpTopicId] = useState<HelpTopicId>("overview");
  const openHelp = useCallback((topic: HelpTopicId) => {
    setHelpTopicId(topic);
    setHelpOpen(true);
  }, []);
  const closeHelp = useCallback(() => setHelpOpen(false), []);

  // The model arrives once; after that the author's edits are the truth.
  const adopted = useRef(false);
  useEffect(() => {
    if (loading || adopted.current) return;
    adopted.current = true;
    const nextRules = storedRules;
    const nextWorkflows = storedWorkflows;
    setRules(nextRules);
    setWorkflows(nextWorkflows);
    const wanted = initialSelection;
    if (wanted?.rule) {
      const index = nextRules.findIndex((r) => slugifyRuleName(r.title ?? r.name) === wanted.rule);
      if (index >= 0) setSelectedRule(index);
    } else if (wanted?.workflow) {
      const index = nextWorkflows.findIndex((w) => workflowSlug(w) === wanted.workflow);
      if (index >= 0) setSelectedIndex(index);
    }
  }, [loading, storedRules, storedWorkflows, initialSelection]);

  useEffect(() => {
    if (loadError) setError(loadError);
  }, [loadError]);

  const entityNames = useMemo(() => entities.map((entity) => entity.name), [entities]);
  // What a rule may name: the entity's fields, the values its enum or state machine
  // allows, and the processes defined for it.
  const constraints = useMemo(
    () =>
      constraintsFor(
        workflows.map((workflow) => ({
          name: pascalWorkflowName(workflow.title ?? workflow.name),
          title: workflow.title ?? workflow.name,
          entity: workflow.entity,
          kind: workflow.kind,
          stateNames: workflow.kind === "state" ? workflow.states.states.map((s) => s.name) : [],
        }))
      ),
    [constraintsFor, workflows]
  );
  const columnsFor = useCallback(
    (entity: string) => entities.find((candidate) => candidate.name === entity)?.attributes ?? [],
    [entities]
  );
  /** The same fields `columnsFor` gives, in the shape the ladder takes them. */
  const entityFieldMap = useMemo(
    () => Object.fromEntries(entities.map((entity) => [entity.name, entity.attributes])),
    [entities]
  );
  // A Decision step can evaluate a rule declared here rather than carrying its own copy of
  // the same table — which is only offerable because both live on this screen.
  const ruleNames = useMemo(
    () => rules.map((rule) => slugifyRuleName(rule.title ?? rule.name)),
    [rules]
  );
  // What a "Look up a rule table" step picks from.
  const ruleTables: RuleTableSummary[] = useMemo(
    () =>
      rules.map((rule) => ({
        id: rule.key,
        name: slugifyRuleName(rule.title ?? rule.name),
        rowCount: rule.table.rules.length,
        outputs: rule.table.outputs.map((output) => output.field || output.name),
      })),
    [rules]
  );

  const workflowNames = useMemo(
    () => workflows.map((workflow) => pascalWorkflowName(workflow.title ?? workflow.name)),
    [workflows]
  );
  const summaryKey = `${ruleNames.join("|")}#${workflowNames.join("|")}`;
  // the key stands for both lists.
  useEffect(() => {
    onSummaryChange?.({ ruleNames, workflowNames });
  }, [summaryKey]);

  const activeWorkflowLocked = !!(
    !creating &&
    selectedRule === null &&
    workflows[selectedIndex] &&
    lockedWorkflows?.has((workflows[selectedIndex] as EditableWorkflow).key)
  );
  const activeRule = creating || selectedRule === null ? null : (rules[selectedRule] ?? null);
  const activeWorkflow =
    creating || selectedRule !== null ? null : (workflows[selectedIndex] ?? null);

  const patchRule = useCallback(
    (patch: Partial<EditableRule>) => {
      setRules((current) =>
        current.map((rule, index) => (index === selectedRule ? { ...rule, ...patch } : rule))
      );
      setSavedAt(null);
    },
    [selectedRule]
  );

  const addRule = () => {
    const newName = `rule${rules.length + 1}`;
    setRules((current) => [
      ...current,
      {
        key: nextKey(),
        name: newName,
        entity: entityNames[0] ?? "",
        event: "beforeCreate",
        priority: 100,
        table: emptyDecisionTable(),
      },
    ]);
    setSelectedRule(rules.length);
    setCreating(false);
    setSavedAt(null);
    onSelectionChange?.({ rule: newName });
  };

  const removeRule = (index: number) => {
    setRules((current) => current.filter((_r, i) => i !== index));
    setSelectedRule((current) =>
      current === null ? null : current === index ? null : current > index ? current - 1 : current
    );
    setSavedAt(null);
  };

  /**
   * Attaching a rule to a hook gives it that hook's event. The rule's own table is
   * untouched — it is written in the rule editor.
   */
  const attachRule = useCallback((ruleKey: string, event: string) => {
    setRules((current) =>
      current.map((rule) => (rule.key === ruleKey ? { ...rule, event } : rule))
    );
    setSavedAt(null);
  }, []);

  const patchWorkflow = useCallback(
    (patch: Partial<EditableWorkflow>) => {
      setWorkflows((current) =>
        current.map((workflow, index) =>
          index === selectedIndex ? { ...workflow, ...patch } : workflow
        )
      );
      setSavedAt(null);
    },
    [selectedIndex]
  );

  const createWorkflow = (draft: NewWorkflowDraft) => {
    const base = emptyWorkflow("hook", nextKey(), draft.entity);
    const automation = {
      ...emptyAutomation(draft.entity, "hook"),
      name: draft.name,
      hooks: [hookFor(draft.entity, draft.event)],
      ...(draft.status ? { onStatus: draft.status } : {}),
    };
    const newWorkflow = {
      ...base,
      name: pascalWorkflowName(draft.name),
      title: draft.name,
      automation,
    };
    setWorkflows((current) => [...current, newWorkflow]);
    setSelectedIndex(workflows.length);
    setSelectedRule(null);
    setCreating(false);
    setSavedAt(null);
    onSelectionChange?.({ workflow: workflowSlug(newWorkflow) });
  };

  /** A status machine or a process has no hooks to start from, so it opens blank. */
  const addWorkflow = (kind: WorkflowKind) => {
    const newWorkflow = emptyWorkflow(kind, nextKey(), entityNames[0] ?? "");
    setWorkflows((current) => [...current, newWorkflow]);
    setSelectedIndex(workflows.length);
    setSelectedRule(null);
    setCreating(false);
    setSavedAt(null);
    onSelectionChange?.({ workflow: workflowSlug(newWorkflow) });
  };

  const removeWorkflow = (index: number) => {
    const target = workflows[index];
    if (target && lockedWorkflows?.has(target.key)) return;
    setWorkflows((current) => current.filter((_w, i) => i !== index));
    setSelectedIndex((current) => (current >= index ? Math.max(0, current - 1) : current));
    setSavedAt(null);
  };

  /** One write, both halves — the document is edited once. Resolves true when it was saved. */
  const save = async (): Promise<boolean> => {
    const problems = sectionProblems(rules, workflows);
    const first = problems[0];
    if (first) {
      setError(problems.map((p) => p.message).join(" "));
      setCreating(false);
      if (first.kind === "workflow") {
        setSelectedIndex(first.index);
        setSelectedRule(null);
      } else {
        setSelectedRule(first.index);
      }
      return false;
    }
    setIsSaving(true);
    setError(null);
    try {
      await saveModel({ rules, workflows });
      setSavedAt(new Date().toLocaleTimeString());
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save");
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const kindIcon = (kind: WorkflowKind) =>
    kind === "saga" ? ListOrdered : kind === "state" ? GitBranch : WorkflowIcon;

  /** The help page for whatever the editor is showing, and how to ask for it. */
  const editorHelp: { topic: HelpTopicId; label: string } =
    activeWorkflow?.kind === "state"
      ? { topic: "status", label: "How status machines work" }
      : activeWorkflow?.kind === "hook"
        ? { topic: "lifecycle", label: "How lifecycle processes work" }
        : activeWorkflow
          ? { topic: "process", label: "How processes and their steps work" }
          : { topic: "overview", label: "Which one should I use?" };

  return (
    <div>
      {header}

      <div className="-mt-2 mb-4 flex justify-end">
        <button
          type="button"
          onClick={() => openHelp(helpOpen ? helpTopicId : "overview")}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted"
        >
          <BookOpen className="h-4 w-4" />
          Help
        </button>
      </div>

      <HelpPanel
        open={helpOpen}
        topic={helpTopicId}
        onTopicChange={setHelpTopicId}
        onClose={closeHelp}
      />

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading the model…
        </div>
      ) : (
        // Side by side from md up; stacked on a phone, where a 256px rail left the editor a
        // column about 70px wide.
        <div className="flex flex-col gap-4 md:flex-row">
          <aside className="max-h-80 w-full space-y-5 overflow-y-auto md:max-h-none md:w-64 md:shrink-0 md:overflow-visible">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Rules ({rules.length})
                </h2>
                <button
                  type="button"
                  onClick={addRule}
                  className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-muted"
                >
                  <Plus className="h-3 w-3" />
                  New rule
                </button>
              </div>
              <div className="space-y-1">
                {rules.map((rule, index) => (
                  <div
                    key={rule.key}
                    className={`group flex items-center gap-1 rounded-md border px-2 py-1.5 text-left text-sm ${
                      !creating && selectedRule === index
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedRule(index);
                        setCreating(false);
                        onSelectionChange?.({ rule: slugifyRuleName(rule.title ?? rule.name) });
                      }}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate font-medium">{rule.title || rule.name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {rule.entity || "no entity"}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeRule(index)}
                      aria-label={`Delete ${rule.name}`}
                      className="opacity-0 transition group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                    </button>
                  </div>
                ))}
                {!rules.length && (
                  <p className="rounded-md border border-dashed border-border px-2 py-3 text-center text-xs text-muted-foreground">
                    No rules yet.
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Workflows ({workflows.length})
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    setCreating(true);
                    setSelectedRule(null);
                  }}
                  className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-muted"
                >
                  <Plus className="h-3 w-3" />
                  New workflow
                </button>
              </div>

              <div className="space-y-1">
                {workflows.map((workflow, index) => {
                  const Icon = kindIcon(workflow.kind);
                  const hookCount = workflow.automation?.hooks.length ?? 0;
                  return (
                    <div
                      key={workflow.key}
                      className={`group flex items-center gap-1 rounded-md border px-2 py-1.5 text-left text-sm ${
                        !creating && selectedRule === null && selectedIndex === index
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedIndex(index);
                          setSelectedRule(null);
                          setCreating(false);
                          onSelectionChange?.({ workflow: workflowSlug(workflow) });
                        }}
                        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {workflow.title || workflow.name}
                          </span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {workflow.entity || "no entity"} ·{" "}
                            {workflow.kind === "hook"
                              ? `${hookCount} hook${hookCount === 1 ? "" : "s"}`
                              : workflow.kind}
                          </span>
                        </span>
                      </button>
                      {lockedWorkflows?.has(workflow.key) ? (
                        <span
                          title="Declared in the model"
                          className="rounded border border-border px-1 text-[10px] uppercase tracking-wide text-muted-foreground"
                        >
                          model
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => removeWorkflow(index)}
                          aria-label={`Delete ${workflow.name}`}
                          className="opacity-0 transition group-hover:opacity-100"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                        </button>
                      )}
                    </div>
                  );
                })}

                {!workflows.length && (
                  <p className="rounded-md border border-dashed border-border px-2 py-3 text-center text-xs text-muted-foreground">
                    No workflows yet.
                  </p>
                )}
              </div>

              <div className="border-t border-border pt-3 text-[11px] text-muted-foreground">
                Other kinds:{" "}
                <button type="button" className="underline" onClick={() => addWorkflow("state")}>
                  status machine
                </button>
                {" · "}
                <button type="button" className="underline" onClick={() => addWorkflow("saga")}>
                  process
                </button>
              </div>
            </div>
          </aside>

          <div className="min-w-0 flex-1">
            {activeRule ? (
              <>
                <div className="mb-2 flex justify-end">
                  <HelpLink onClick={() => openHelp("rules")}>How business rules work</HelpLink>
                </div>
                <RuleEditor
                  key={activeRule.key}
                  rule={activeRule}
                  entities={entities}
                  dryRun={dryRun}
                  onChange={patchRule}
                  onError={setError}
                  entityEnums={constraints[activeRule.entity]?.values}
                  entityWorkflows={constraints[activeRule.entity]?.workflowNames}
                  fieldTypes={constraints[activeRule.entity]?.fieldTypes}
                  showPriority={rulesHavePriority}
                />
              </>
            ) : creating || (!workflows.length && !activeWorkflow) ? (
              <NewWorkflowPanel
                key="new-workflow"
                entityNames={entityNames}
                statusChoicesFor={(entity) => statusChoicesFor(entity, workflows)}
                onCreate={createWorkflow}
                onCancel={workflows.length ? () => setCreating(false) : undefined}
              />
            ) : (
              <>
                <div className="mb-2 flex justify-end">
                  <HelpLink onClick={() => openHelp(editorHelp.topic)}>{editorHelp.label}</HelpLink>
                </div>
                {activeWorkflowLocked && (
                  <p
                    role="note"
                    className="mb-3 rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground"
                  >
                    {lockedNote ??
                      "This workflow is declared in the model. Edit the model and generate again to change it."}
                  </p>
                )}
                <div
                  // `inert` takes the whole editor out of reach of the pointer and the keyboard
                  // alike; set from a ref because React 18 and 19 spell the attribute differently.
                  ref={(element) => {
                    if (!element) return;
                    if (activeWorkflowLocked) element.setAttribute("inert", "");
                    else element.removeAttribute("inert");
                  }}
                  data-locked={activeWorkflowLocked || undefined}
                >
                  {(activeWorkflow?.kind === "hook" || activeWorkflow?.kind === "saga") &&
                  activeWorkflow.automation ? (
                    <>
                      <div className="min-h-[560px] overflow-hidden rounded-xl border border-border">
                        <AutomationBuilder
                          key={activeWorkflow.key}
                          automation={activeWorkflow.automation}
                          onChange={(automation) =>
                            patchWorkflow({
                              automation,
                              entity: automation.trigger.entity,
                              title: automation.name,
                              name: pascalWorkflowName(automation.name),
                            })
                          }
                          entities={entityNames}
                          statusChoices={statusChoicesFor(activeWorkflow.entity, workflows)}
                          entityFields={entityFieldMap}
                          ruleTables={ruleTables}
                          onOpenRuleTable={(name) => {
                            const index = rules.findIndex(
                              (rule) => slugifyRuleName(rule.title ?? rule.name) === name
                            );
                            if (index >= 0) setSelectedRule(index);
                          }}
                        />
                      </div>
                      {activeWorkflow.kind === "hook" && (
                        <WorkflowRules
                          entity={activeWorkflow.entity}
                          hooks={activeWorkflow.automation.hooks}
                          rules={rules}
                          onAttach={attachRule}
                          enhanceHref={enhanceHref ?? "#"}
                        />
                      )}
                    </>
                  ) : activeWorkflow ? (
                    <WorkflowEditor
                      key={activeWorkflow.key}
                      workflow={activeWorkflow}
                      boundWorkflows={boundWorkflowsFor(activeWorkflow, workflows)}
                      entityNames={entityNames}
                      ruleNames={ruleNames}
                      columnsFor={columnsFor}
                      onChange={patchWorkflow}
                    />
                  ) : null}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {savedAt && (
            <>
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              Saved to the model at {savedAt}
            </>
          )}
        </div>

        <div className="flex gap-2">
          {footerStart?.({ save, busy: isSaving || loading })}
          <button
            type="button"
            onClick={() => void save()}
            disabled={isSaving || loading}
            className="flex items-center gap-1.5 rounded-md border border-border px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </button>
          {footerEnd?.({ save, busy: isSaving || loading })}
        </div>
      </div>
    </div>
  );
}
