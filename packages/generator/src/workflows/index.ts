/**
 * `%%workflow ... kind: state` → seeded workflow definitions.
 *
 * The generated backend already seeds a `trigger-workflow` rule per entity that
 * fires on create and update and asks the workflow service for a definition
 * named `<table>-on-create-workflow`. Nothing ever created those definitions,
 * so every write logged "No active workflow named … — nothing to trigger" and
 * the state machines an author drew in the model reached nothing.
 *
 * This module reads the state sections and emits the BPMN the generated
 * executor runs, so a status lifecycle declared in EML is a lifecycle the
 * application actually applies.
 */

import { lifecycleValuesFor, RESERVED_STATE_NAMES } from "../../../../language/state-field";
import { extractWorkflowSections } from "../eml";
import { type CompiledSaga, compileSagas } from "./steps";

export * from "./steps";

/** Read the saga workflows a document declares. */
export function compileSagaWorkflows(
  source: string,
  knownEntities: string[] = [],
  onWarn: (message: string) => void = () => {}
): CompiledSaga[] {
  return compileSagas(extractWorkflowSections(source ?? ""), knownEntities, onWarn);
}

export interface WorkflowState {
  name: string;
}

export interface WorkflowTransition {
  from: string;
  to: string;
  trigger?: string;
}

export interface CompiledWorkflow {
  /** Workflow name as written in the model. */
  name: string;
  /** Entity the workflow belongs to, as the model spells it. */
  entity: string;
  states: WorkflowState[];
  transitions: WorkflowTransition[];
  /** The state a record starts in — the `[*] --> x` edge. */
  initial?: string;
  /** The states the diagram ends (`x --> [*]`). Each one is Final: the record is locked. */
  terminal: string[];
  /**
   * Every value the lifecycle column may hold: `draft`, the machine's states, and
   * `error` (`lifecycleValuesFor` in language/state-field.ts — the one statement).
   */
  lifecycleValues: string[];
}

const START_MARKER = "[*]";
const TRANSITION = /^(\[\*\]|[A-Za-z_]\w*)\s*-->\s*(\[\*\]|[A-Za-z_]\w*)\s*(?::\s*(.+))?$/;

/** Read the state machines a document declares. */
export function compileWorkflows(
  source: string,
  knownEntities: string[] = [],
  onWarn: (message: string) => void = () => {}
): CompiledWorkflow[] {
  const known = new Set(knownEntities);
  const compiled: CompiledWorkflow[] = [];

  for (const section of extractWorkflowSections(source ?? "")) {
    if (section.kind !== "state") continue;

    if (known.size && !known.has(section.entity)) {
      onWarn(`Workflow "${section.name}" targets unknown entity "${section.entity}" — skipped.`);
      continue;
    }

    const states = new Map<string, WorkflowState>();
    const transitions: WorkflowTransition[] = [];
    const terminal: string[] = [];
    let initial: string | undefined;

    for (const rawLine of (section.diagram ?? "").split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("%%")) continue;

      const match = line.match(TRANSITION);
      if (!match) continue;

      const [, from, to, trigger] = match as unknown as [
        string,
        string,
        string,
        string | undefined,
      ];

      for (const name of [from, to]) {
        if (name !== START_MARKER && !states.has(name)) states.set(name, { name });
      }

      if (from === START_MARKER) {
        initial = to;
        continue;
      }
      if (to === START_MARKER) {
        terminal.push(from);
        continue;
      }
      transitions.push({ from, to, trigger: trigger?.trim() });
    }

    if (!states.size) {
      onWarn(`Workflow "${section.name}" declares no states — skipped.`);
      continue;
    }
    if (!initial) {
      onWarn(`Workflow "${section.name}" has no starting state — records will not be stamped.`);
    }
    for (const reserved of RESERVED_STATE_NAMES) {
      if (states.has(reserved)) {
        onWarn(
          `Workflow "${section.name}" draws a state named "${reserved}", which the record ` +
            `lifecycle reserves (checker EML509).`
        );
      }
    }
    if (terminal.length === 0) {
      onWarn(
        `Workflow "${section.name}" ends nowhere: no state reaches [*], so no record of ` +
          `${section.entity} can become Final (checker EML422).`
      );
    }

    const machine = { states: [...states.values()], initial, terminal };
    compiled.push({
      name: section.name,
      entity: section.entity,
      ...machine,
      transitions,
      lifecycleValues: lifecycleValuesFor(machine),
    });
  }

  return compiled;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * BPMN for the create-time step of a state machine: put the record into the
 * state the model says it starts in.
 *
 * The generated executor runs a linear chain of service tasks, so this is one
 * `UpdateEntity` node rather than an attempt to encode every transition — the
 * transitions constrain what a later update may do, and are recorded in the
 * definition's description so the Workflow Designer shows the whole machine.
 */
export function buildStateEntryBpmn(
  workflow: CompiledWorkflow,
  tableName: string,
  statusField: string
): string {
  const processId = `${tableName}_lifecycle`;
  const taskId = "task_enter_initial";

  const task = workflow.initial
    ? `    <bpmn:serviceTask id="${taskId}" name="Enter ${escapeXml(workflow.initial)}">
      <bpmn:extensionElements>
        <appwithai:properties xmlns:appwithai="http://appwithai.dev/bpmn">
          <appwithai:property name="nodeType" value="UpdateEntity" />
          <appwithai:property name="entity" value="${escapeXml(tableName)}" />
          <appwithai:property name="field" value="${escapeXml(statusField)}" />
          <appwithai:property name="value" value="${escapeXml(workflow.initial)}" />
        </appwithai:properties>
      </bpmn:extensionElements>
    </bpmn:serviceTask>
`
    : "";

  const flows = workflow.initial
    ? `    <bpmn:sequenceFlow id="flow_1" sourceRef="start" targetRef="${taskId}" />
    <bpmn:sequenceFlow id="flow_2" sourceRef="${taskId}" targetRef="end" />
`
    : `    <bpmn:sequenceFlow id="flow_1" sourceRef="start" targetRef="end" />
`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="defs_${processId}" targetNamespace="http://appwithai.dev/bpmn">
  <bpmn:process id="${processId}" isExecutable="true">
    <bpmn:startEvent id="start" name="Record written" />
${task}${flows}    <bpmn:endEvent id="end" name="Done" />
  </bpmn:process>
</bpmn:definitions>
`;
}

/**
 * BPMN for an entity with no state machine in the model.
 *
 * The trigger rule exists for every entity, so a definition has to exist for
 * every entity too — otherwise each write logs a warning about a workflow that
 * was never going to be there. This one runs a single no-op so the run is
 * created, completes, and is visible in the run list.
 */
export function buildPassThroughBpmn(tableName: string): string {
  const processId = `${tableName}_passthrough`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="defs_${processId}" targetNamespace="http://appwithai.dev/bpmn">
  <bpmn:process id="${processId}" isExecutable="true">
    <bpmn:startEvent id="start" name="Record written" />
    <bpmn:serviceTask id="task_noop" name="No workflow declared">
      <bpmn:extensionElements>
        <appwithai:properties xmlns:appwithai="http://appwithai.dev/bpmn">
          <appwithai:property name="nodeType" value="Formula" />
          <appwithai:property name="target" value="acknowledged" />
          <appwithai:property name="expression" value="true" />
        </appwithai:properties>
      </bpmn:extensionElements>
    </bpmn:serviceTask>
    <bpmn:sequenceFlow id="flow_1" sourceRef="start" targetRef="task_noop" />
    <bpmn:sequenceFlow id="flow_2" sourceRef="task_noop" targetRef="end" />
    <bpmn:endEvent id="end" name="Done" />
  </bpmn:process>
</bpmn:definitions>
`;
}

/** A human-readable summary of the machine, shown in the Workflow Designer. */
export function describeWorkflow(workflow: CompiledWorkflow): string {
  const moves = workflow.transitions
    .map((t) => `${t.from} → ${t.to}${t.trigger ? ` (${t.trigger})` : ""}`)
    .join(", ");

  return [
    `${workflow.name}: ${workflow.states.length} states`,
    workflow.initial ? `starts in ${workflow.initial}` : null,
    workflow.terminal.length ? `ends in ${workflow.terminal.join(" or ")}` : null,
    moves ? `transitions: ${moves}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
