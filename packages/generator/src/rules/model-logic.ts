/**
 * The workflows a model declares, for the generated application's Rules & workflows screen.
 *
 * The modelling tool reads these straight out of the EML document it is editing. A generated
 * application has no document to read, and the rows it seeds for them are compiled for the
 * engine (BPMN, edges) — the diagram an author drew is not among them. So the same sections
 * are written into the front end once, at generation time, by the same reader the modelling
 * tool uses, and the screen shows them beside the ones built in the application.
 *
 * They are the model's: the next generation rewrites them, so the screen opens the hook and
 * saga workflows read-only. A status flow opens editable: saving it stores a flow the
 * application runs in place of this one (the API's LifecycleStore).
 */

import { type EmlWorkflowSection, extractWorkflowSections } from "../eml";

export type ModelWorkflow = Pick<
  EmlWorkflowSection,
  "name" | "entity" | "kind" | "trigger" | "operation" | "status" | "title" | "diagram"
>;

/** Every `%%workflow` section of the document(s) the application was generated from. */
export function buildModelLogic(sources: string | string[]): ModelWorkflow[] {
  const document = (Array.isArray(sources) ? sources : [sources]).filter(Boolean).join("\n\n");
  if (!document.trim()) return [];
  return extractWorkflowSections(document).map((workflow) => ({
    name: workflow.name,
    entity: workflow.entity,
    kind: workflow.kind,
    ...(workflow.trigger ? { trigger: workflow.trigger } : {}),
    ...(workflow.operation ? { operation: workflow.operation } : {}),
    ...(workflow.status ? { status: workflow.status } : {}),
    ...(workflow.title ? { title: workflow.title } : {}),
    diagram: workflow.diagram,
  }));
}

/** The generated frontend's `lib/model-logic.ts`. */
export function renderModelLogic(workflows: ModelWorkflow[]): string {
  return `/**
 * The workflows this application's model declares, as the author drew them — written when
 * the application was generated. The Rules & workflows screen lists the hook and saga
 * workflows read-only: the next generation rewrites them, so they are changed in the model.
 * A status flow is editable there: the one saved is what records follow from then on.
 */

export interface ModelWorkflow {
  name: string;
  entity: string;
  kind: "hook" | "state" | "saga";
  trigger?: "automatic" | "rule";
  operation?: "CREATE" | "UPDATE" | "DELETE" | "ALL";
  /** The state whose entering move starts it. */
  status?: string;
  title?: string;
  diagram: string;
}

export const MODEL_WORKFLOWS: ModelWorkflow[] = ${JSON.stringify(workflows, null, 2)};
`;
}
