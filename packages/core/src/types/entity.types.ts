export interface EntityAttribute {
  name: string;
  type: "string" | "integer" | "decimal" | "boolean" | "date" | "datetime" | "text" | "json";
  required: boolean;
  /**
   * Help text for the column, written as `%%field <Entity>.<column> help: ...`.
   *
   * It becomes `sys_column.description`, which the generated form renders under
   * the control and the Application Dictionary shows beside the column — the
   * one place a modeller can explain a field to whoever fills it in.
   */
  description?: string;
  /**
   * The type the modeller actually wrote, when it was one of the five aliases
   * that carry a meaning the canonical type cannot: `email`, `url`, `phone`,
   * `password`, `color`. All five normalise to `string` for SQL and TypeScript,
   * and the difference between them is the whole of what the Application
   * Dictionary needs to choose a control — so the word is kept rather than the
   * column being guessed at by name later on.
   */
  semanticType?: "email" | "url" | "phone" | "password" | "color";
  unique?: boolean;
  default?: unknown;
  maxLength?: number;
  minLength?: number;
  pattern?: string;
  isForeignKey?: boolean;
  /** Name of the `%%enum` this column is bound to, via `%%field E.c enum: N`. */
  enumRef?: string;
  /** The enum's values, in declaration order. */
  enumValues?: string[];
  /**
   * sys_reference_id allocated to this column's enum. Ids from 1000 up are the
   * per-model list references — the generated forms already render anything at
   * or above 1000 as a dropdown fed by /sys/ref-list, so binding the column to
   * one is what turns a modelled enum into a select instead of a text box.
   */
  enumReferenceId?: number;
  /**
   * Compiere's field logic, from `%%field <E>.<c> display: | readonly: |
   * mandatory: <logic>` — `@column@=value` conditions over the record being
   * edited, joined by `&` and `|` (language/field-logic.ts is the one reading).
   * Display logic lands on `sys_field.display_logic`; read-only and mandatory
   * logic on both `sys_column` and `sys_field`.
   */
  displayLogic?: string;
  readOnlyLogic?: string;
  mandatoryLogic?: string;
}

/** A `%%enum Name: a, b, c` declaration, with the reference id it was given. */
export interface EntityEnum {
  name: string;
  values: string[];
  /** Allocated from 1000 up, stable for a given set of enum names. */
  referenceId: number;
}

/**
 * An index the model asked for explicitly, via `%%index Entity(a, b) [unique]`.
 *
 * Separate from the single-column indexes derived from `UK` and from a column
 * called `name`: those are conventions the generator applies, this is a request
 * the author wrote down, and it is the only way to express a composite one.
 */
export interface EntityIndex {
  /** Columns in the order given, which is the order the index is useful in. */
  columns: string[];
  unique: boolean;
}

export interface Entity {
  name: string;
  tableName: string;
  description?: string;
  attributes: EntityAttribute[];
  primaryKey: string;
  timestamps: boolean;
  /** Explicit `%%index` declarations bound to this entity. */
  indexes?: EntityIndex[];
  /**
   * What this entity looks like, from `%%entity <E> icon: <name>`.
   *
   * A lucide icon id — the same vocabulary `%%category icon:` uses and the
   * same one the Application Dictionary's upload field writes into
   * `sys_table.icon`, which is where this lands. Undefined when the model says
   * nothing, and then the column keeps its default: an entity is never
   * withheld from a screen for want of an icon.
   *
   * The name is not validated here and cannot be. The checker does not carry
   * lucide's catalogue, so an unknown name is silent by construction — it
   * renders the placeholder. That is what the specification warns about rather
   * than something a diagnostic can catch.
   */
  icon?: string;
  /**
   * The entity this one is a line item of, from `%%entity <E> parent: <P>`.
   *
   * A child is not a thing you navigate to. It has no window of its own and no
   * card on the dashboard; it appears as a tab inside its parent's window,
   * linked on the foreign key it already declared. An invoice line away from
   * its invoice is not a record anyone wants a list of.
   */
  parentEntity?: string;
  /** The child's foreign key back to `parentEntity`, resolved at parse time. */
  parentLinkColumn?: string;
  /**
   * `%%section` — the form's layout: headed sections of rows of one or two
   * columns, in declaration order. Absent when the model declares none, which
   * leaves the form one flat list in column order.
   */
  formSections?: EntityFormSection[];
}

/** One `%%section` of an entity's form. Mirrors `FormSection` in language/sections.ts. */
export interface EntityFormSection {
  name: string;
  help?: string;
  collapsed: boolean;
  /** Rows in order, each one or two attribute names. */
  rows: string[][];
}

export interface Relationship {
  name: string;
  sourceEntity: string;
  targetEntity: string;
  cardinality: "oneToOne" | "oneToMany" | "manyToOne" | "manyToMany";
  foreignKey?: string;
  inverseForeignKey?: string;
  onDelete?: "CASCADE" | "SET NULL" | "RESTRICT";
  onUpdate?: "CASCADE" | "SET NULL" | "RESTRICT";
}

// EntityDefinition is an alias for Entity for service layer compatibility
export type EntityDefinition = Entity;

// Zod schema for entity validation
import { z } from "zod";

export const EntityAttributeSchema = z.object({
  name: z.string(),
  type: z.enum(["string", "integer", "decimal", "boolean", "date", "datetime", "text", "json"]),
  required: z.boolean(),
  /** Help text for the column, from `%%field <E>.<c> help:`. */
  description: z.string().optional(),
  /** The alias the modeller wrote, when it decides the reference type. */
  semanticType: z.enum(["email", "url", "phone", "password", "color"]).optional(),
  unique: z.boolean().optional(),
  default: z.any().optional(),
  maxLength: z.number().optional(),
  minLength: z.number().optional(),
  pattern: z.string().optional(),
});

export const EntitySchema = z.object({
  name: z.string(),
  tableName: z.string(),
  description: z.string().optional(),
  attributes: z.array(EntityAttributeSchema),
  primaryKey: z.string(),
  timestamps: z.boolean(),
  /** A lucide icon id from `%%entity <E> icon:`. */
  icon: z.string().optional(),
});
