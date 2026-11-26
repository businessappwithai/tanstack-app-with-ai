/**
 * What a rule in the generated application may name — read from the model.
 *
 * The rule editor offers only what exists: an entity's own fields, the values
 * its enum or its state machine allows, and the processes defined for it. The
 * modelling tool reads those from the document it is editing; a generated
 * application has no document, so the same facts are written into it at
 * generation time, once, from the one parsed model.
 */

import type { Entity } from "@appwithai/core/types";
import { declaredEntityNames, entityToBusEntity, formatDisplayName } from "@appwithai/core/types";
import type { CompiledSaga, CompiledWorkflow } from "../workflows";

export interface RuleModelEntity {
  /** The entity as the model names it, e.g. `SupportCase` — what a workflow is filed under. */
  name: string;
  /** The table a rule is filed under, e.g. `bus_student`. */
  table: string;
  label: string;
  /** Declared columns, each with the JSON type the engine sees. */
  fields: Array<{ name: string; type: "string" | "number" | "boolean" }>;
  /** Field → the only values it may hold: its enum, or its state machine's states. */
  values: Record<string, string[]>;
  /** Processes defined for the entity — all an answer naming one may pick from. */
  processes: string[];
}

const jsonType = (type: string): "string" | "number" | "boolean" =>
  type === "integer" || type === "decimal" ? "number" : type === "boolean" ? "boolean" : "string";

export function buildRuleModel(model: {
  entities: Entity[];
  workflows: CompiledWorkflow[];
  sagas: CompiledSaga[];
}): RuleModelEntity[] {
  const declared = declaredEntityNames(model.entities);
  return model.entities.map((entity) => {
    const bus = entityToBusEntity(entity, declared);
    const values: Record<string, string[]> = {};
    for (const attribute of entity.attributes) {
      if (attribute.enumValues?.length) values[attribute.name] = [...attribute.enumValues];
    }
    // A state machine's states win over an enum, and its column is the one whose
    // declared values the states overlap — not whichever is called `status`.
    for (const machine of model.workflows.filter((w) => w.entity === entity.name)) {
      const states = machine.states.map((state) => state.name);
      const column =
        Object.entries(values).find(([, list]) => states.some((s) => list.includes(s)))?.[0] ??
        (entity.attributes.some((a) => a.name === "status") ? "status" : undefined);
      if (column) values[column] = states;
    }
    return {
      name: entity.name,
      table: bus.tableName,
      label: formatDisplayName(entity.name),
      fields: entity.attributes.map((attribute) => ({
        name: attribute.name,
        type: jsonType(attribute.type),
      })),
      values,
      processes: model.sagas.filter((saga) => saga.entity === entity.name).map((saga) => saga.name),
    };
  });
}

/** The generated frontend's `lib/rule-model.ts`. */
export function renderRuleModel(entities: RuleModelEntity[]): string {
  return `/**
 * What a rule in this application may name, written when it was generated from
 * its model: each record type's fields and their types, the values a closed
 * field may hold (its enum, or its state machine's states) and the processes
 * defined for it. The rule editor offers these and nothing else.
 */

export interface RuleModelEntity {
  name: string;
  table: string;
  label: string;
  fields: Array<{ name: string; type: "string" | "number" | "boolean" }>;
  values: Record<string, string[]>;
  processes: string[];
}

export const RULE_MODEL: RuleModelEntity[] = ${JSON.stringify(entities, null, 2)};
`;
}
