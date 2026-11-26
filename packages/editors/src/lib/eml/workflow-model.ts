/**
 * A stored workflow, read into the shape the workflow editors edit — and written back.
 *
 * A workflow is stored as a Mermaid diagram plus the few fields that ride on the
 * `%%workflow` directive. The modelling tool keeps that in the project's EML document; a
 * generated application keeps the same text in its workflow definitions. Either host reads
 * and writes it through these two functions, so a lifecycle, a status machine or a process
 * opens the same way in both and saves the same bytes.
 */

import { emptyStateFlow } from "../../components/eml/StateFlowCanvas";
import {
  type EditableWorkflow,
  emitWorkflowDiagram,
  pascalWorkflowName,
  type WorkflowKind,
} from "../../components/eml/WorkflowEditor";
import { parseAutomation } from "../automation/model";
import { emptySagaFlow, parseHookWorkflow, parseSagaFlow, parseStateFlow } from "./workflow-flow";

/** A workflow as the model stores it. */
export interface StoredWorkflow {
  name: string;
  entity: string;
  kind: string;
  trigger?: "automatic" | "rule";
  operation?: "CREATE" | "UPDATE" | "DELETE" | "ALL";
  /** Hook and saga only: the state whose entering move runs this workflow. */
  status?: string;
  title?: string;
  diagram: string;
}

let counter = 0;
/** A key that stays with an item across renames, so React keeps the row being edited. */
export const newEditorKey = () => `k${(counter++).toString(36)}${Date.now().toString(36)}`;

export function toEditableWorkflow(workflow: StoredWorkflow): EditableWorkflow {
  const kind: WorkflowKind =
    workflow.kind === "state" || workflow.kind === "saga" ? workflow.kind : "hook";
  const saga = kind === "saga" ? parseSagaFlow(workflow.diagram) : emptySagaFlow();
  const parsed =
    kind === "hook" || kind === "saga" ? parseAutomation(workflow.diagram, workflow.entity) : null;
  return {
    key: newEditorKey(),
    name: workflow.name,
    entity: workflow.entity,
    kind,
    title: workflow.title,
    hooks: kind === "hook" ? parseHookWorkflow(workflow.diagram) : [],
    states: kind === "state" ? parseStateFlow(workflow.diagram) : emptyStateFlow(),
    // A hook workflow is many handlers on different events, which is the multi-trigger
    // shape the automation ladder carries. It reads and writes the same `%%hook`
    // directives, so this is a change of editor, not of artifact.
    ...(parsed
      ? {
          automation: {
            ...parsed,
            kind: kind as "hook" | "saga",
            name: workflow.title ?? workflow.name,
            trigger: { ...parsed.trigger, entity: workflow.entity },
            // Carried beside the diagram for a hook (its directive is composed, not drawn)
            // and inside it for a saga; either way one value reaches the editor.
            onStatus: workflow.status ?? parsed.onStatus,
            // For a saga these ride on the %%workflow directive, so they reach us beside
            // the diagram rather than inside it. Absent means automatic: the composer only
            // ever writes the token for `rule`.
            ...(kind === "saga"
              ? {
                  sagaTrigger: workflow.trigger ?? "automatic",
                  sagaOperation: workflow.operation ?? saga.operation,
                }
              : {}),
          },
        }
      : {}),
    saga: {
      ...saga,
      trigger: workflow.trigger ?? saga.trigger,
      operation: workflow.operation ?? saga.operation,
    },
  };
}

/** What a workflow is saved as. */
export function workflowForSave(workflow: EditableWorkflow): StoredWorkflow {
  return {
    name: pascalWorkflowName(workflow.title ?? workflow.name),
    entity: workflow.entity,
    kind: workflow.kind,
    title: workflow.title,
    ...(workflow.kind !== "state" && workflow.automation?.onStatus
      ? { status: workflow.automation.onStatus }
      : {}),
    ...(workflow.kind === "saga"
      ? {
          trigger: workflow.automation?.sagaTrigger ?? workflow.saga.trigger,
          operation: workflow.automation?.sagaOperation ?? workflow.saga.operation,
        }
      : {}),
    diagram: emitWorkflowDiagram(workflow),
  };
}
