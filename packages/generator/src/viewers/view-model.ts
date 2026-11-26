/**
 * One reading of a model, for the viewers to draw.
 *
 * `website/viewers/` renders an `.eml.mmd` while a language model is still
 * writing it: the entities and their links, the state machines, the sagas and
 * the decision flows. What it must never do is read the document its own way.
 * A viewer with its own parser is a viewer that shows an application nobody is
 * going to get — it would disagree with the generator about which columns are
 * foreign keys, which enum binding took, which transition is legal, and the
 * author would find out only after generating.
 *
 * So this composes the real ones. `parseModel` is the pipeline's own reading;
 * the section extractors and the flowchart parser are the ones the rule
 * compiler uses; `deriveAccess` is what both stacks seed their roles from.
 * Everything here beyond that is arrangement: pairing a compiled rule back to
 * the flowchart it came from, resolving which column a state machine drives,
 * counting. Nothing is re-derived.
 *
 * It is bundled to `website/viewers/eml-model.js` by `scripts/build-viewers.ts`,
 * which is why it may not touch the filesystem — see `parse-model.ts` for the
 * same constraint and the same reason.
 */

import type { Entity, EntityEnum, Relationship } from "@appwithai/core/types";
import {
  type EmlRuleSection,
  type EmlWorkflowSection,
  extractRuleSections,
  extractWorkflowSections,
} from "../eml";
import type { CompiledHook } from "../hooks";
import type { EntityCategory } from "../parsers/category.parser";
import { type ParsedModel, parseModel } from "../pipeline/parse-model";
import type { CompiledRbac } from "../rbac";
import { type DerivedAccess, deriveAccess } from "../rbac/roles";
import { type CompiledRuleAction, parseRuleActions } from "../rules";
import { type NodeShape, parseMermaidFlowchart } from "../rules/flowchart-parser";
import type { CompiledSaga, CompiledStep, CompiledWorkflow } from "../workflows";
import { STEP_CONTRACTS } from "../workflows";

/* -------------------------------------------------------------------------- */
/*  What a viewer is handed                                                    */
/* -------------------------------------------------------------------------- */

/** `%%meta` keys from the document header. */
export interface ViewMeta {
  name?: string;
  version?: string;
  description?: string;
}

/**
 * A node of a decision flow, in the vocabulary the generator's own rule canvas
 * uses. The role comes from the Mermaid *shape*, which is where EML puts it —
 * `roleFromShape` here is the same reading `packages/web/src/lib/eml/rule-flow.ts`
 * performs, so a rule looks the same in the viewer as in the design tool.
 */
export type RuleNodeRole = "start" | "end" | "decision" | "action" | "compute";

export interface ViewFlowNode {
  id: string;
  label: string;
  role: RuleNodeRole;
}

export interface ViewFlowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

/** A `%%rule` section: what it compiled to, and the flowchart it was drawn as. */
export interface ViewRule {
  name: string;
  /** `%%meta name:` above the section, when it carries one. */
  title?: string;
  entity: string;
  event: string;
  /** CRUD operation the rules engine keys on, from the compiler. */
  operation: "CREATE" | "UPDATE" | "DELETE" | "ALL";
  priority: number;
  tableName: string;
  nodes: ViewFlowNode[];
  edges: ViewFlowEdge[];
  /** `%%action` directives — the side effects the rule emits. */
  actions: CompiledRuleAction[];
  /** True when the section compiled; a section that did not is drawn greyed. */
  compiled: boolean;
}

/** A `kind: state` workflow, with the column its states are written to. */
export interface ViewStateMachine extends CompiledWorkflow {
  title?: string;
  /**
   * The column the machine drives, when the entity declares one.
   *
   * Resolved from the entity's own attributes rather than assumed to be
   * `status`: the guard matches on whichever column carries the enum the
   * states belong to, and a model is free to call it `stage` or `state`.
   */
  statusColumn?: string;
  /** Values the bound enum declares, so a state with no value is visible. */
  declaredValues?: string[];
  /** States the machine names that the enum does not declare. */
  undeclaredStates: string[];
  /**
   * The sagas whose UpdateEntity step writes each state, keyed by state.
   *
   * A record moves by its action buttons; a saga that writes a state moves it
   * too, along a drawn edge. This is that second kind: who besides the buttons
   * puts a record in each state. The initial state is the system's to set and
   * never appears.
   */
  stateWriters: Record<string, string[]>;
}

/** One step of a saga, with what it needs and whether the model supplied it. */
export interface ViewSagaStep extends CompiledStep {
  /** Properties the step type cannot run without that this step is missing. */
  missing: string[];
  /** Context variables the step publishes for later steps to read. */
  publishes: string[];
}

export interface ViewSaga extends Omit<CompiledSaga, "steps"> {
  title?: string;
  steps: ViewSagaStep[];
}

/** An entity, plus the things the ERD viewer draws that the ERD does not say. */
export interface ViewEntity extends Entity {
  /** Category the entity belongs to, when `%%category` assigns it one. */
  category?: string;
  /** Roles admitted by the entity's `%%rbac … .read` rule; empty = everyone. */
  readableBy: string[];
  /** Number of relationships touching this entity, in either direction. */
  degree: number;
}

export interface ViewModel {
  meta: ViewMeta;
  entities: ViewEntity[];
  relationships: Relationship[];
  categories: EntityCategory[];
  enums: EntityEnum[];
  rules: ViewRule[];
  workflows: ViewStateMachine[];
  sagas: ViewSaga[];
  hooks: CompiledHook[];
  rbac: CompiledRbac;
  access: DerivedAccess;
  /** Warnings the compilers raised while reading the document. */
  warnings: string[];
  stats: {
    entities: number;
    fields: number;
    relationships: number;
    enums: number;
    rules: number;
    hooks: number;
    stateMachines: number;
    sagas: number;
    roles: number;
    accessRules: number;
  };
}

/* -------------------------------------------------------------------------- */
/*  Reading                                                                    */
/* -------------------------------------------------------------------------- */

const META = /^%%meta\s+(name|version|description)\s*:\s*(.+)$/;

/**
 * The document's own `%%meta` header.
 *
 * Only the first of each key is taken: every rule and workflow section opens
 * with a `%%meta name:` of its own, and reading the last one would title the
 * whole model after whichever section happened to come last.
 */
export function readMeta(source: string): ViewMeta {
  const meta: ViewMeta = {};
  for (const rawLine of (source ?? "").split("\n")) {
    const match = rawLine.trim().match(META);
    if (!match?.[1] || !match[2]) continue;
    const key = match[1] as keyof ViewMeta;
    if (meta[key] === undefined) meta[key] = match[2].trim();
  }
  return meta;
}

/**
 * Which role a flowchart node plays.
 *
 * A stadium node is Start or End depending on direction — `[*]` has no
 * equivalent in a flowchart, so EML distinguishes the two ends by whether
 * anything leaves the node. Same reading as the design tool's canvas.
 */
function roleFromShape(shape: NodeShape, hasOutgoing: boolean): RuleNodeRole {
  switch (shape) {
    case "stadium":
      return hasOutgoing ? "start" : "end";
    case "diamond":
      return "decision";
    case "circle":
    case "round":
      return "compute";
    default:
      return "action";
  }
}

function readFlow(flowchart: string): { nodes: ViewFlowNode[]; edges: ViewFlowEdge[] } {
  const ast = parseMermaidFlowchart(flowchart ?? "");
  const withOutgoing = new Set(ast.edges.map((edge) => edge.source));

  const nodes: ViewFlowNode[] = [...ast.nodes.values()].map((node) => ({
    id: node.id,
    label: node.label,
    role: roleFromShape(node.shape, withOutgoing.has(node.id)),
  }));

  const edges: ViewFlowEdge[] = ast.edges.map((edge, index) => ({
    id: `e${index}_${edge.source}_${edge.target}`,
    source: edge.source,
    target: edge.target,
    label: edge.label,
  }));

  return { nodes, edges };
}

/**
 * The column a state machine writes to.
 *
 * Found by the enum, not by the name: the states are the values of some enum,
 * and the column bound to that enum is the one the guard checks. A machine
 * whose states match no declared enum returns nothing, which is what makes
 * `undeclaredStates` worth showing — those states are moves the generated
 * application will refuse.
 */
function resolveStatusColumn(
  workflow: CompiledWorkflow,
  entity: Entity | undefined
): { column?: string; values?: string[] } {
  if (!entity) return {};
  const states = new Set(workflow.states.map((state) => state.name));
  if (states.size === 0) return {};

  let best: { column: string; values: string[]; overlap: number } | undefined;
  for (const attribute of entity.attributes) {
    if (!attribute.enumValues?.length) continue;
    const overlap = attribute.enumValues.filter((value) => states.has(value)).length;
    if (overlap === 0) continue;
    if (!best || overlap > best.overlap) {
      best = { column: attribute.name, values: attribute.enumValues, overlap };
    }
  }
  return best ? { column: best.column, values: best.values } : {};
}

/** `Sample` → `bus_sample`, the spelling the compiled rules and rbac carry. */
function toTableName(entity: string): string {
  const snake = entity
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
  return snake.startsWith("bus_") || snake.startsWith("sys_") ? snake : `bus_${snake}`;
}

/** Properties a step declares that its type cannot run without. */
function missingProperties(step: CompiledStep): string[] {
  const contract = STEP_CONTRACTS[step.type];
  if (!contract) return [];
  const missing = contract.required.filter((key) => !step.props[key]?.trim());
  for (const group of contract.oneOf ?? []) {
    if (!group.some((key) => step.props[key]?.trim())) missing.push(group.join(" or "));
  }
  return missing;
}

/**
 * Read a document into everything the viewers draw.
 *
 * Tolerant by design: a half-written model is the normal case here, because the
 * whole point is watching one being written. Nothing throws — a section that
 * does not compile is reported through `warnings` and drawn as what it is.
 */
export function readModel(source: string): ViewModel {
  const text = source ?? "";
  const warnings: string[] = [];
  const parsed: ParsedModel = parseModelQuietly(text, warnings);

  const meta = readMeta(text);
  const entityByName = new Map(parsed.entities.map((entity) => [entity.name, entity]));

  const categoryOf = new Map<string, string>();
  for (const category of parsed.categories) {
    for (const name of category.entities) categoryOf.set(name, category.name);
  }

  const readableBy = new Map<string, string[]>();
  for (const rule of parsed.rbac.operations) {
    if (rule.operation === "read") readableBy.set(rule.entity, rule.roles);
  }

  const degree = new Map<string, number>();
  for (const relationship of parsed.relationships) {
    degree.set(relationship.sourceEntity, (degree.get(relationship.sourceEntity) ?? 0) + 1);
    degree.set(relationship.targetEntity, (degree.get(relationship.targetEntity) ?? 0) + 1);
  }

  const entities: ViewEntity[] = parsed.entities.map((entity) => ({
    ...entity,
    category: categoryOf.get(entity.name),
    readableBy: readableBy.get(entity.name) ?? [],
    degree: degree.get(entity.name) ?? 0,
  }));

  /* Rules: the compiler says what a section became, the section says how it was
     drawn. Paired by name, which is the section's identity in the document. */
  const sections: EmlRuleSection[] = extractRuleSections(text);
  const compiledByName = new Map(parsed.rules.map((rule) => [rule.name, rule]));
  const rules: ViewRule[] = sections.map((section) => {
    const compiled = compiledByName.get(section.name);
    const { nodes, edges } = readFlow(section.flowchart);
    return {
      name: section.name,
      title: section.title,
      entity: section.entity,
      event: section.event,
      operation: compiled?.operation ?? eventOperation(section.event),
      priority: compiled?.priority ?? section.priority ?? 100,
      tableName: compiled?.tableName ?? toTableName(section.entity),
      nodes,
      edges,
      actions: parseRuleActions(section.flowchart),
      compiled: Boolean(compiled),
    };
  });

  /* Workflows: titles live on the section, the machine on the compiler. */
  const workflowSections: EmlWorkflowSection[] = extractWorkflowSections(text);
  const titleOf = new Map(workflowSections.map((section) => [section.name, section.title]));

  /** `Entity.field=value` → the sagas whose UpdateEntity step writes it. */
  const sagaWrites = new Map<string, string[]>();
  for (const saga of parsed.sagas) {
    for (const step of saga.steps) {
      if (step.type !== "UpdateEntity" || !step.props.field || step.props.value === undefined) continue;
      const target = (step.props.entity ?? saga.entity).trim();
      const key = `${target}.${step.props.field.trim()}=${step.props.value.trim()}`;
      sagaWrites.set(key, [...(sagaWrites.get(key) ?? []), saga.name]);
    }
  }

  const workflows: ViewStateMachine[] = parsed.workflows.map((workflow) => {
    const entity = entityByName.get(workflow.entity);
    const { column, values } = resolveStatusColumn(workflow, entity);
    const declared = new Set(values ?? []);
    return {
      ...workflow,
      title: titleOf.get(workflow.name),
      statusColumn: column,
      declaredValues: values,
      undeclaredStates: declared.size
        ? workflow.states.map((state) => state.name).filter((name) => !declared.has(name))
        : [],
      stateWriters: Object.fromEntries(
        workflow.states
          .map((state): [string, string[]] => [
            state.name,
            column ? (sagaWrites.get(`${workflow.entity}.${column}=${state.name}`) ?? []) : [],
          ])
          .filter(([, writers]) => writers.length > 0)
      ),
    };
  });

  const sagas: ViewSaga[] = parsed.sagas.map((saga) => ({
    ...saga,
    title: titleOf.get(saga.name),
    steps: saga.steps.map((step) => ({
      ...step,
      missing: missingProperties(step),
      publishes: STEP_CONTRACTS[step.type]?.publishes?.(step.props) ?? [],
    })),
  }));

  const access = deriveAccess(parsed.rbac, {
    projectId: slug(meta.name ?? "model"),
    entities: parsed.entities.map((entity) => entity.name),
  });

  return {
    meta,
    entities,
    relationships: parsed.relationships,
    categories: parsed.categories,
    enums: parsed.enums,
    rules,
    workflows,
    sagas,
    hooks: parsed.hooks,
    rbac: parsed.rbac,
    access,
    warnings,
    stats: {
      entities: entities.length,
      fields: entities.reduce((total, entity) => total + entity.attributes.length, 0),
      relationships: parsed.relationships.length,
      enums: parsed.enums.length,
      rules: rules.length,
      hooks: parsed.hooks.length,
      stateMachines: workflows.length,
      sagas: sagas.length,
      roles: access.roles.length,
      accessRules: parsed.rbac.operations.length + parsed.rbac.transitions.length,
    },
  };
}

/**
 * `parseModel` reports what it could not read through `console.warn`.
 *
 * A viewer needs those on screen rather than in a console nobody has open —
 * "workflow X targets unknown entity Y" is exactly the mistake a half-written
 * model makes, and it is the reason a section the author just wrote is not
 * drawn. Captured rather than silenced: the console line still happens for
 * anyone who is watching it.
 */
function parseModelQuietly(source: string, into: string[]): ParsedModel {
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    into.push(
      args
        .map(String)
        .join(" ")
        .replace(/^\s*⚠️\s*/u, "")
        .trim()
    );
    original.apply(console, args as []);
  };
  try {
    return parseModel(source);
  } finally {
    console.warn = original;
  }
}

/** The operation a lifecycle event keys on, when nothing compiled to say so. */
function eventOperation(event: string): ViewRule["operation"] {
  const normalized = (event ?? "").toLowerCase();
  if (normalized.includes("create")) return "CREATE";
  if (normalized.includes("update")) return "UPDATE";
  if (normalized.includes("delete")) return "DELETE";
  return "ALL";
}

function slug(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "model"
  );
}
