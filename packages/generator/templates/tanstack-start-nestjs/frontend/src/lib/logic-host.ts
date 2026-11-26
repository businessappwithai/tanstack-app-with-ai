/**
 * The generated application's side of the rules & workflows screen.
 *
 * `LogicWorkbench` (vendored from `@appwithai/editors`, the same source the modelling
 * tool's Logic step renders) owns everything an author does on the screen. It owns no I/O:
 * it is handed the rules and workflows as editable objects and a `save` that is told the
 * whole list. This file is that I/O for a running application — rules in `sys_rule_definitions`
 * through `/api/rules`, processes, hook workflows and status machines in
 * `sys_workflow_definitions` through `/api/workflow-definitions`.
 *
 * Saving diffs against what was loaded, so an edit writes the rows that changed and nothing
 * else. What the model declares (`RULE_MODEL`) decides what a rule may name.
 *
 * A status flow is editable whether the model declared it or it was drawn here: the API runs
 * the stored one (`kind = 'state'`) in place of the model's, so an edit changes how records
 * move. A declared flow nobody has changed has no row; editing it writes one, and deleting
 * that row puts the model's flow back. The model's hook and saga workflows stay read-only.
 */

import type { ConstraintWorkflow, WorkbenchSave } from "@/editors/components/LogicWorkbench";
import { slugifyRuleName } from "@/editors/components/eml/RuleEditor";
import type { EditableRule } from "@/editors/components/eml/RuleEditor";
import {
  type EditableWorkflow,
  emitWorkflowDiagram,
  pascalWorkflowName,
} from "@/editors/components/eml/WorkflowEditor";
import {
  type Automation,
  parseAutomation,
  serializeAutomation,
  TRIGGER_HOOKS,
} from "@/editors/lib/automation/model";
import { asDecisionTable } from "@/editors/lib/automation/rule-content";
import type { DryRunResult, RuleDryRun } from "@/editors/lib/eml/dry-run-types";
import { describeOutcome } from "@/editors/lib/eml/rule-outcome";
import type { RuleConstraints } from "@/editors/lib/eml/rule-constraints";
import { parseStateFlow } from "@/editors/lib/eml/workflow-flow";
import {
  eventForOperation,
  operationForEvent,
  statusFromOperation,
  statusOperation,
} from "@/editors/lib/eml/workflow-hooks";
import { type StoredWorkflow, toEditableWorkflow } from "@/editors/lib/eml/workflow-model";
import { apiClient } from "@/lib/api-client";
import { MODEL_WORKFLOWS } from "@/lib/model-logic";
import { RULE_MODEL, type RuleModelEntity } from "@/lib/rule-model";

type Operation = "CREATE" | "UPDATE" | "DELETE" | "ALL";

interface RuleRow {
  id: string;
  ruleName?: string;
  title?: string | null;
  entityName?: string;
  operation?: string;
  jdmContent?: unknown;
  isActive?: boolean;
  rule_name?: string;
  entity_name?: string;
  jdm_content?: unknown;
  is_active?: boolean;
}

interface WorkflowRow {
  id: string;
  name: string;
  entity_name: string;
  kind: string;
  operation?: string;
  trigger_type?: string;
  mermaid_code?: string | null;
}

const entityByName = (name: string): RuleModelEntity | undefined =>
  RULE_MODEL.find((entity) => entity.name === name || entity.table === name);

/** The model's name for a stored entity, which may be a table (`bus_student`) or already a name. */
const entityNameOf = (stored: string): string => entityByName(stored)?.name ?? stored;

async function readJson<T>(path: string): Promise<T | null> {
  const response = await fetch(`/api${path}`);
  return response.ok ? ((await response.json()) as T) : null;
}

async function write(method: string, path: string, body?: unknown): Promise<unknown> {
  // A Content-Type only with a body: Fastify refuses `application/json` with nothing after it
  // ("Body cannot be empty when content-type is set to 'application/json'"), which made every
  // DELETE from this screen a 500 — no rule or workflow could be removed.
  const response = await fetch(`/api${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
  // Removing what is already gone is the outcome that was asked for.
  if (method === "DELETE" && response.status === 404) return data;
  if (!response.ok) {
    const message = [data.message ?? `The server refused the change (${response.status}).`].flat();
    throw new Error(message.join(" "));
  }
  return data;
}

/** Run a rule's graph against a record, on the server that will run it for real. */
export const simulateRule: RuleDryRun = async ({ graph, record, entity }) => {
  const data = await apiClient.post<{
    ok: boolean;
    result?: unknown;
    trace?: Array<{ node: string; output: unknown }>;
    problems?: string[];
  }>("/rules/simulate", { jdmContent: graph, testData: record, entityName: entity });
  if (!data.ok) return { ok: false, problems: data.problems ?? ["The rule did not run."] };
  const answer: DryRunResult = {
    ok: true,
    result: data.result,
    trace: data.trace ?? [],
    outcomes: describeOutcome(data.result),
  };
  return answer;
};

/** What the model says each record type may name — the Logic step reads the same from the ERD. */
export const logicEntities = RULE_MODEL.map((entity) => ({
  name: entity.name,
  attributes: entity.fields.map((field) => field.name),
}));

/** The column a status machine moves: the one whose declared values its states overlap. */
function statusColumnFor(entity: RuleModelEntity | undefined, states: string[]): string {
  const wanted = new Set(states);
  let column: string | undefined;
  let best = 0;
  for (const [field, allowed] of Object.entries(entity?.values ?? {})) {
    const overlap = allowed.filter((value) => wanted.has(value)).length;
    if (overlap > best) {
      best = overlap;
      column = field;
    }
  }
  return column ?? "status";
}

/** Per entity: its fields, the values a closed field allows, and the processes it has. */
export function logicConstraints(
  workflows: readonly ConstraintWorkflow[]
): Record<string, RuleConstraints> {
  const result: Record<string, RuleConstraints> = {};
  for (const entity of RULE_MODEL) {
    const values: Record<string, string[]> = { ...entity.values };
    const machine = workflows.find((w) => w.entity === entity.name && w.kind === "state");
    if (machine?.stateNames?.length) {
      values[statusColumnFor(entity, machine.stateNames)] = machine.stateNames;
    }
    const names = new Set([
      ...entity.processes,
      ...workflows.filter((w) => w.entity === entity.name).map((w) => w.name),
    ]);
    result[entity.name] = {
      fields: entity.fields.map((field) => field.name),
      fieldTypes: Object.fromEntries(entity.fields.map((field) => [field.name, field.type])),
      values,
      workflowNames: [...names].filter(Boolean),
    };
  }
  return result;
}

/** The write a stored hook workflow runs on, recomputed on every save. */
function operationOf(automation: Automation): string {
  // Bound to a status: stored as ENTER:<STATE>, which the workflow runner selects when a
  // button moves a record into that state, and never on a plain save.
  if (automation.onStatus && automation.kind !== "automation") {
    return statusOperation(automation.onStatus);
  }
  if (automation.kind === "saga") return automation.sagaOperation ?? "CREATE";
  const events =
    automation.kind === "hook"
      ? automation.hooks.map((hook) => hook.event as string)
      : [TRIGGER_HOOKS[automation.trigger.event]];
  const operations = new Set(events.map(operationForEvent));
  return operations.size === 1 ? [...operations][0]! : events.length === 0 ? "CREATE" : "ALL";
}

function toEditableRule(row: RuleRow): EditableRule {
  const content = row.jdmContent ?? row.jdm_content;
  const table = asDecisionTable(content);
  let jdmGraph: string | undefined;
  try {
    const parsed = (typeof content === "string" ? JSON.parse(content) : content) as {
      nodes?: Array<{ type?: string }>;
    };
    // Any stored graph opens as that graph, including one that is only a table: reading it
    // back as a bare table and rebuilding the graph renames its nodes and loses cells.
    if (Array.isArray(parsed?.nodes)) {
      jdmGraph = typeof content === "string" ? content : JSON.stringify(content);
    }
  } catch {
    // not JSON: the table above is empty, which is what the editor opens
  }
  const operation = row.operation ?? "CREATE";
  return {
    key: row.id,
    name: row.ruleName ?? row.rule_name ?? "Untitled rule",
    ...(row.title ? { title: row.title } : {}),
    entity: entityNameOf(row.entityName ?? row.entity_name ?? ""),
    event: eventForOperation(operation),
    table,
    ...(jdmGraph ? { jdmGraph } : {}),
    sourceKind: "decision-table",
  };
}

function toStoredWorkflow(row: WorkflowRow): StoredWorkflow {
  const entity = entityNameOf(row.entity_name);
  const diagram = row.mermaid_code ?? "";
  const kind =
    row.kind === "state"
      ? "state"
      : parseAutomation(diagram, entity).kind === "saga"
        ? "saga"
        : "hook";
  // A binding is stored in the operation; the editor holds it as a status beside the
  // write it belongs to (an update, because a move is one).
  const status = kind === "state" ? undefined : statusFromOperation(row.operation);
  return {
    // As the model stores one: an identifier, with the name people read beside it as the title.
    name: pascalWorkflowName(row.name),
    entity,
    kind,
    title: row.name,
    diagram,
    ...(status ? { status } : {}),
    ...(kind === "saga"
      ? {
          trigger: row.trigger_type === "rule" ? ("rule" as const) : ("automatic" as const),
          operation: status ? ("UPDATE" as const) : ((row.operation as Operation | undefined) ?? "CREATE"),
        }
      : {}),
  };
}

export interface LoadedLogic {
  rules: EditableRule[];
  workflows: EditableWorkflow[];
  /** The hook and saga workflows the model declares: shown, never saved, changed in the model. */
  locked: ReadonlySet<string>;
}

/**
 * Rules and workflows for the screen, and the `save` that writes them back.
 * One host per screen: it remembers which stored row each editor key stands for.
 */
export function createLogicHost() {
  const ruleIds = new Map<string, string>();
  const ruleSnapshots = new Map<string, string>();
  // The name each stored rule is filed under. A rule the model seeded is called "Fee Invoice
  // validation", not `feeInvoiceValidation`: it keeps that name unless it is renamed, because
  // a process looks a rule up by its stored name.
  const ruleNames = new Map<string, string>();
  const workflowIds = new Map<string, string>();
  const modelKeys = new Set<string>();
  const workflowSnapshots = new Map<string, string>();
  // A status flow the model declares and nobody has changed: no stored row, so its
  // snapshot here is what decides whether a save has anything to write.
  const declaredSnapshots = new Map<string, string>();

  const ruleBody = (rule: EditableRule, names: ReadonlyMap<string, string> = ruleNames) => {
    const wanted = slugifyRuleName(rule.title ?? rule.name);
    const kept = names.get(rule.key);
    return {
      entityName: entityByName(rule.entity)?.table ?? rule.entity,
      ruleName: kept && slugifyRuleName(kept) === wanted ? kept : wanted,
      title: rule.title ?? null,
      operation: operationForEvent(rule.event),
      jdmContent: rule.jdmGraph ?? JSON.stringify(rule.table),
    };
  };

  const workflowBody = (workflow: EditableWorkflow) => {
    const name = workflow.title ?? workflow.name;
    if (workflow.kind === "state") {
      const diagram = emitWorkflowDiagram(workflow);
      const flow = parseStateFlow(diagram);
      return {
        kind: "state",
        name,
        entityName: workflow.entity,
        mermaid: diagram,
        statusField: statusColumnFor(
          entityByName(workflow.entity),
          flow.states.map((state) => state.name)
        ),
        transitions: flow.transitions.map((edge) => ({
          from: edge.from,
          to: edge.to,
          ...(edge.label ? { name: edge.label } : {}),
        })),
      };
    }
    const automation: Automation = {
      ...(workflow.automation as Automation),
      name,
      kind: workflow.kind,
    };
    return {
      kind: "automation",
      name,
      entityName: automation.trigger.entity || workflow.entity,
      operation: operationOf(automation),
      triggerType:
        automation.kind === "saga" && automation.sagaTrigger === "rule" ? "rule" : "automatic",
      mermaid: serializeAutomation(automation),
      isActive: true,
    };
  };

  // Which load is the latest. React's StrictMode runs the screen's effect twice in development,
  // so two loads overlap on one host; each mints new editor keys for the same stored rows.
  let loads = 0;

  async function load(): Promise<LoadedLogic> {
    const generation = ++loads;
    const [ruleData, automationData, stateData] = await Promise.all([
      readJson<RuleRow[] | { rules?: RuleRow[]; items?: RuleRow[] }>("/rules?limit=200"),
      readJson<{ items?: WorkflowRow[] }>("/workflow-definitions?kind=automation&limit=200"),
      readJson<{ items?: WorkflowRow[] }>("/workflow-definitions?kind=state&limit=200"),
    ]);
    if (!ruleData && !automationData) throw new Error("Could not load the rules and workflows.");

    const ruleRows = Array.isArray(ruleData) ? ruleData : (ruleData?.rules ?? ruleData?.items ?? []);
    const rules = ruleRows.filter((row) => (row.isActive ?? row.is_active) !== false).map(toEditableRule);

    // What this load read, kept aside until it is known to be the latest. The maps tie each
    // editor key to its stored row; a stale load writing into them left two keys on one row,
    // and the next save deleted the row through the key the screen no longer showed and then
    // updated it through the other — a 404, so no saved workflow could ever be changed.
    const read = {
      ruleIds: new Map<string, string>(),
      ruleNames: new Map<string, string>(),
      ruleSnapshots: new Map<string, string>(),
      workflowIds: new Map<string, string>(),
      workflowSnapshots: new Map<string, string>(),
      modelKeys: new Set<string>(),
      declaredSnapshots: new Map<string, string>(),
    };
    for (const rule of rules) {
      read.ruleIds.set(rule.key, rule.key);
      read.ruleNames.set(rule.key, rule.name);
      // Against the names this load read: the shared map is not this load's until it commits.
      read.ruleSnapshots.set(rule.key, JSON.stringify(ruleBody(rule, read.ruleNames)));
    }

    const rows = [...(automationData?.items ?? []), ...(stateData?.items ?? [])];
    const workflows = rows.map((row) => {
      const workflow = toEditableWorkflow(toStoredWorkflow(row));
      read.workflowIds.set(workflow.key, row.id);
      read.workflowSnapshots.set(workflow.key, JSON.stringify(workflowBody(workflow)));
      return workflow;
    });

    // What the model declares, drawn as the author drew it. A workflow built here under the same
    // name wins: it is the one that runs, and listing both would show one process twice. So does
    // a stored status flow for the same record type, since a record type has one flow.
    const built = new Set(workflows.map((workflow) => workflow.name));
    const flowed = new Set(workflows.filter((workflow) => workflow.kind === "state").map((workflow) => workflow.entity));
    for (const declared of MODEL_WORKFLOWS) {
      const workflow = toEditableWorkflow({
        ...declared,
        entity: entityNameOf(declared.entity),
        title: declared.title ?? declared.name,
      });
      if (built.has(workflow.name)) continue;
      if (workflow.kind === "state") {
        if (flowed.has(workflow.entity)) continue;
        read.declaredSnapshots.set(workflow.key, JSON.stringify(workflowBody(workflow)));
      } else {
        read.modelKeys.add(workflow.key);
      }
      workflows.push(workflow);
    }

    // Only the latest load says which stored row each key on screen stands for. An older one
    // still answers — its caller has gone and ignores it — but records nothing.
    if (generation === loads) {
      const replace = <K, V>(target: Map<K, V>, source: Map<K, V>) => {
        target.clear();
        for (const [key, value] of source) target.set(key, value);
      };
      replace(ruleIds, read.ruleIds);
      replace(ruleNames, read.ruleNames);
      replace(ruleSnapshots, read.ruleSnapshots);
      replace(workflowIds, read.workflowIds);
      replace(workflowSnapshots, read.workflowSnapshots);
      modelKeys.clear();
      for (const key of read.modelKeys) modelKeys.add(key);
      replace(declaredSnapshots, read.declaredSnapshots);
    }
    return { rules, workflows, locked: read.modelKeys };
  }

  // One save at a time: two overlapping saves read the same snapshot and write it twice.
  let queue: Promise<unknown> = Promise.resolve();
  const save = (payload: WorkbenchSave): Promise<void> => {
    const run = queue.then(() => writeChanges(payload));
    queue = run.catch(() => undefined);
    return run;
  };

  /** Write what changed: new rows created, edited rows updated, removed rows deleted. */
  async function writeChanges({ rules, workflows: all }: WorkbenchSave): Promise<void> {
    // The model's own hook and saga workflows are read-only on screen and never written from it.
    const workflows = all.filter((workflow) => !modelKeys.has(workflow.key));
    const keptRules = new Set(rules.map((rule) => rule.key));
    for (const [key, id] of [...ruleIds]) {
      if (keptRules.has(key)) continue;
      await write("DELETE", `/rules/${id}`);
      await write("DELETE", `/rules/${id}?permanent=true`);
      ruleIds.delete(key);
      ruleNames.delete(key);
      ruleSnapshots.delete(key);
    }
    for (const rule of rules) {
      const body = ruleBody(rule);
      const snapshot = JSON.stringify(body);
      const id = ruleIds.get(rule.key);
      if (id && ruleSnapshots.get(rule.key) === snapshot) continue;
      const before = id ? (JSON.parse(ruleSnapshots.get(rule.key) ?? "{}") as typeof body) : null;
      // A stored rule keeps the name and record type it was filed under, so a rename or a
      // move is a new rule and the old one goes.
      const refiled = before && (before.ruleName !== body.ruleName || before.entityName !== body.entityName);
      if (id && !refiled) {
        await write("PUT", `/rules/${id}`, {
          jdmContent: body.jdmContent,
          operation: body.operation,
          title: body.title,
        });
      } else {
        const created = (await write("POST", "/rules", body)) as { id?: string };
        if (id) {
          await write("DELETE", `/rules/${id}`);
          await write("DELETE", `/rules/${id}?permanent=true`);
        }
        if (created.id) ruleIds.set(rule.key, created.id);
        ruleNames.set(rule.key, body.ruleName);
      }
      ruleSnapshots.set(rule.key, snapshot);
    }

    const keptWorkflows = new Set(workflows.map((workflow) => workflow.key));
    for (const [key, id] of [...workflowIds]) {
      if (keptWorkflows.has(key)) continue;
      await write("DELETE", `/workflow-definitions/${id}`);
      workflowIds.delete(key);
      workflowSnapshots.delete(key);
    }
    // A status flow goes first: a workflow bound to one of its states is refused until the
    // flow it names exists.
    const flowsFirst = [...workflows].sort(
      (a, b) => Number(b.kind === "state") - Number(a.kind === "state")
    );
    for (const workflow of flowsFirst) {
      const body = workflowBody(workflow);
      const snapshot = JSON.stringify(body);
      const id = workflowIds.get(workflow.key);
      if (id && workflowSnapshots.get(workflow.key) === snapshot) continue;
      // The model's flow, as declared: nothing to store, and storing it would only pin it.
      if (!id && declaredSnapshots.get(workflow.key) === snapshot) continue;
      if (id) {
        await write("PUT", `/workflow-definitions/${id}`, body);
      } else {
        const created = (await write("POST", "/workflow-definitions", body)) as { id?: string };
        if (created.id) workflowIds.set(workflow.key, created.id);
        declaredSnapshots.delete(workflow.key);
      }
      workflowSnapshots.set(workflow.key, snapshot);
    }
  }

  return { load, save };
}
