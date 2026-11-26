/**
 * What a rule may name, read from the model rather than typed.
 *
 * A rule's table says which field a check looks at, what a status may be, and
 * which process an answer starts. Each of those is something the model already
 * declares, so the editor offers exactly those and nothing else: the entity's
 * own fields, the values its enum or its state machine allows, and the
 * processes defined for it. A free-text cell lets a rule name a field or a
 * state that does not exist, and such a rule compiles, saves, and never fires.
 */

export interface RuleConstraints {
  /** The entity's own fields — what a check may look at. */
  fields: string[];
  /** Each field's JSON type, so the editor can complete and check what is written. */
  fieldTypes?: Record<string, "string" | "number" | "boolean">;
  /** Field → the only values it may hold: its enum, or its state machine's states. */
  values: Record<string, string[]>;
  /** Processes defined for the entity — what an answer may start. */
  workflowNames: string[];
}

export interface ConstraintWorkflow {
  name: string;
  title?: string;
  entity: string;
  kind: string;
  /** The states of a state machine, when `kind` is `state`. */
  stateNames?: string[];
}

/** Entity names and their attributes, read from the ERD for the pickers. */
export interface ReadEntity {
  name: string;
  attributes: string[];
  types: Record<string, "string" | "number" | "boolean">;
}

const jsonType = (erdType: string): "string" | "number" | "boolean" =>
  /^(int|integer|bigint|smallint|float|double|decimal|numeric|number|money)/i.test(erdType)
    ? "number"
    : /^bool/i.test(erdType)
      ? "boolean"
      : "string";

export function readEntities(erd: string): ReadEntity[] {
  const entities: ReadEntity[] = [];
  let current: ReadEntity | null = null;

  for (const rawLine of (erd ?? "").split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("%%")) continue;

    const open = line.match(/^([A-Za-z][A-Za-z0-9_]*)\s*\{$/);
    if (open?.[1]) {
      current = { name: open[1], attributes: [], types: {} };
      continue;
    }
    if (line === "}" && current) {
      entities.push(current);
      current = null;
      continue;
    }
    if (current) {
      const attribute = line.match(/^([A-Za-z][\w[\]]*)\s+([A-Za-z_]\w*)/);
      if (attribute?.[2]) {
        current.attributes.push(attribute[2]);
        current.types[attribute[2]] = jsonType(attribute[1] ?? "");
      }
    }
  }
  return entities;
}

/** `%%enum` values bound to a field by `%%field Entity.field … enum: Name`, per entity. */
export function readEnumValues(erd: string): Record<string, Record<string, string[]>> {
  const enums: Record<string, string[]> = {};
  const bound: Array<[string, string, string]> = [];

  for (const raw of (erd ?? "").split("\n")) {
    const line = raw.trim();
    const def = line.match(/^%%enum\s+(\w+)\s*:\s*(.+)$/);
    if (def?.[1] && def[2]) {
      enums[def[1]] = def[2]
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      continue;
    }
    const field = line.match(/^%%field\s+(\w+)\.(\w+)\s+.*?enum:\s*(\w+)/);
    if (field?.[1] && field[2] && field[3]) bound.push([field[1], field[2], field[3]]);
  }

  const result: Record<string, Record<string, string[]>> = {};
  for (const [entity, field, name] of bound) {
    const values = enums[name];
    if (!values) continue;
    result[entity] = { ...(result[entity] ?? {}), [field]: values };
  }
  return result;
}

/** The constraints for every entity in the model. */
export function ruleConstraints(
  erd: string,
  workflows: readonly ConstraintWorkflow[]
): Record<string, RuleConstraints> {
  const enums = readEnumValues(erd);
  const result: Record<string, RuleConstraints> = {};

  for (const entity of readEntities(erd)) {
    const values: Record<string, string[]> = { ...(enums[entity.name] ?? {}) };

    // A state machine is stricter than an enum: a status it never draws cannot be
    // reached, so only its states are offered for the status field.
    const machine = workflows.find((w) => w.entity === entity.name && w.kind === "state");
    if (machine?.stateNames?.length) {
      const states = new Set(machine.stateNames);
      // The column a machine writes to is the one whose enum shares its states —
      // `stage` on an Opportunity, not necessarily a column called `status`.
      let column: string | undefined;
      let best = 0;
      for (const [field, allowed] of Object.entries(enums[entity.name] ?? {})) {
        const overlap = allowed.filter((value) => states.has(value)).length;
        if (overlap > best) {
          best = overlap;
          column = field;
        }
      }
      column ??= entity.attributes.includes("status") ? "status" : undefined;
      if (column) values[column] = machine.stateNames;
    }

    result[entity.name] = {
      fields: entity.attributes,
      fieldTypes: entity.types,
      values,
      workflowNames: workflows
        .filter((w) => w.entity === entity.name)
        .map((w) => w.name)
        .filter(Boolean),
    };
  }
  return result;
}
