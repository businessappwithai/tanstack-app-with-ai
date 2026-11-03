/**
 * Business Entity Types (bus_ prefix)
 * Types for handling business entities generated from ERD
 *
 * Business tables use the bus_ prefix to distinguish them from
 * system/dictionary tables (sys_ prefix)
 */

import { z } from "zod";
import type { Entity, EntityAttribute, EntityIndex, Relationship } from "./entity.types";
import {
  AccessLevel,
  BUS_TABLE_PREFIX,
  ReferenceType,
  type SysColumn,
  type SysField,
  type SysFieldGroup,
  type SysTab,
  type SysTable,
  type SysWindow,
  WindowType,
} from "./sys-dictionary.types";

// ============================================================================
// Business Entity Conversion Types
// ============================================================================

/**
 * Converts EntityAttribute type to sys_reference_id
 */
export function attributeTypeToReferenceId(type: EntityAttribute["type"]): number {
  const typeMapping: Record<EntityAttribute["type"], number> = {
    string: ReferenceType.STRING,
    integer: ReferenceType.INTEGER,
    decimal: ReferenceType.AMOUNT,
    boolean: ReferenceType.YES_NO,
    date: ReferenceType.DATE,
    datetime: ReferenceType.DATETIME,
    text: ReferenceType.TEXT,
    json: ReferenceType.JSON,
  };
  return typeMapping[type];
}

/**
 * Converts sys_reference_id back to EntityAttribute type
 */
export function referenceIdToAttributeType(refId: number): EntityAttribute["type"] {
  const reverseMapping: Record<number, EntityAttribute["type"]> = {
    [ReferenceType.STRING]: "string",
    [ReferenceType.INTEGER]: "integer",
    [ReferenceType.AMOUNT]: "decimal",
    [ReferenceType.ID]: "string",
    [ReferenceType.TEXT]: "text",
    [ReferenceType.DATE]: "date",
    [ReferenceType.DATETIME]: "datetime",
    [ReferenceType.YES_NO]: "boolean",
    [ReferenceType.JSON]: "json",
    [ReferenceType.LIST]: "string",
    [ReferenceType.TABLE]: "string",
    [ReferenceType.TABLE_DIRECT]: "string",
    [ReferenceType.URL]: "string",
    [ReferenceType.IMAGE]: "string",
    [ReferenceType.FILE]: "string",
    [ReferenceType.EMAIL]: "string",
    [ReferenceType.PHONE]: "string",
    [ReferenceType.PASSWORD]: "string",
    [ReferenceType.COLOR]: "string",
    [ReferenceType.LOCATION]: "string",
    [ReferenceType.LOCATOR]: "string",
    [ReferenceType.ACCOUNT]: "string",
  };
  return reverseMapping[refId] || "string";
}

// ============================================================================
// Business Entity Interfaces
// ============================================================================

/**
 * Business entity with bus_ prefix applied
 */
export interface BusEntity extends Omit<Entity, "tableName"> {
  tableName: string; // Will have bus_ prefix
  originalName: string; // Original entity name from ERD
  displayName: string; // Human-readable name
  /** The entity whose window holds this one's tab — itself, or its `parent:`. */
  windowOwner: string;
}

/**
 * Business entity attribute with additional metadata
 */
export interface BusEntityAttribute extends EntityAttribute {
  columnName: string; // Physical column name
  displayName: string; // Human-readable name
  referenceId: number; // sys_reference_id
  seqNo: number; // Column sequence
  /**
   * Part of the record's display value — `sys_column.is_identifier`.
   *
   * Decided across the whole attribute list rather than per attribute (a
   * surname only identifies a person alongside a forename), so it is set in
   * `entityToBusEntity` and carried here for every template and generator that
   * needs it. One answer, in one place: the alternative was each template
   * deciding in its own way, which is how the stacks came to disagree about
   * what a record is called.
   */
  isIdentifier: boolean;
}

/**
 * Business relationship with bus_ prefix awareness
 */
export interface BusRelationship extends Relationship {
  sourceTableName: string; // bus_ prefixed
  targetTableName: string; // bus_ prefixed
}

// ============================================================================
// Conversion Functions - Entity to Dictionary
// ============================================================================

/**
 * Converts an Entity to a BusEntity with bus_ prefix
 */
export function entityToBusEntity(entity: Entity, declared?: Map<string, string>): BusEntity {
  const tableName = entity.tableName.startsWith(BUS_TABLE_PREFIX)
    ? entity.tableName
    : `${BUS_TABLE_PREFIX}${entity.tableName}`;

  return {
    ...entity,
    tableName,
    originalName: entity.name,
    displayName: formatDisplayName(entity.name),
    /*
     * Whose window this entity's records are reached through.
     *
     * Itself, unless `%%entity <E> parent: <P>` made it a line item — in which
     * case the parent's, because a child has no window of its own. Computed
     * here rather than in each template so the seed can name one variable
     * whichever order the two entities were declared in.
     */
    windowOwner: entity.parentEntity ?? entity.name,
    indexes: mergeIndexes(entity),
    attributes: withIdentifiers(
      entity.attributes.map((attr, index) =>
        attributeToBusAttribute(attr, index, entity.primaryKey, declared)
      ),
      entity.primaryKey
    ),
  };
}

/** Mark the columns that make up the record's display value. */
function withIdentifiers(
  attributes: BusEntityAttribute[],
  primaryKey?: string
): BusEntityAttribute[] {
  const identifiers = new Set(identifierColumnNames(attributes, primaryKey));
  return attributes.map((attribute) => ({
    ...attribute,
    isIdentifier: identifiers.has(attribute.name),
  }));
}

/**
 * The indexes a table actually gets: what the model asked for, plus the
 * conventional single-column ones, minus the overlap.
 *
 * Both sources name an index after its columns, so an explicit
 * `%%index Compound(smiles) unique` and the convention that indexes every `UK`
 * column both want `idx_bus_compound_smiles`. Emitted separately the second
 * `CREATE INDEX IF NOT EXISTS` is a silent no-op, and since the conventional
 * one is written first, the author's `unique` is the half that gets dropped —
 * the model asks for a constraint and the database quietly does not have it.
 *
 * Merging here rather than in the template means every stack's migration gets
 * the same answer from one place, and the explicit declaration wins on overlap
 * because it is the one carrying intent.
 */
function mergeIndexes(entity: Entity): EntityIndex[] {
  const merged = [...(entity.indexes ?? [])];
  const claimed = new Set(merged.map((index) => index.columns.join(",")));

  for (const attribute of entity.attributes) {
    // The convention: a column called `name` is what people search by, and a
    // unique column needs the index to enforce itself.
    if (attribute.name !== "name" && !attribute.unique) continue;
    if (claimed.has(attribute.name)) continue;
    claimed.add(attribute.name);
    merged.push({ columns: [attribute.name], unique: Boolean(attribute.unique) });
  }

  return merged;
}

/**
 * Resolves the sys_reference_id for an attribute. The generated physical
 * schema uses UUID primary keys and UUID foreign keys for *_id columns
 * regardless of the scalar type declared in the ERD, so key columns must map
 * to ID/TABLE_DIRECT references rather than the declared type.
 *
 * PK fields (matched by entityPrimaryKey) get ReferenceType.ID so they render
 * as read-only UUID displays, not FK dropdowns.
 */
/** The reference each semantic type alias asks for. */
const SEMANTIC_REFERENCE = {
  email: ReferenceType.EMAIL,
  url: ReferenceType.URL,
  phone: ReferenceType.PHONE,
  password: ReferenceType.PASSWORD,
  color: ReferenceType.COLOR,
} as const;

/**
 * The columns that say what a record *is*, in the Application Dictionary's own
 * terms.
 *
 * `sys_column.is_identifier` is the dictionary's answer to "what is this record
 * called": the identifier columns, concatenated in `seq_no` order, are a
 * record's display value — what a lookup lists, and what a grid shows in place
 * of a foreign key. The rule is the classic one, and the generated NestJS
 * backend already reads it that way.
 *
 * The derivation used to be `name`, plus the primary key. Both halves were
 * wrong. A table with `first_name` and `last_name` and no `name` column got no
 * identifier at all, so every screen fell back to printing its uuid — which is
 * exactly what a person cannot read. And marking the *key* an identifier means
 * a display value built from identifier columns begins with a uuid, which is
 * why every consumer had grown its own `!== "id"` filter.
 *
 * Returns the names in the order they should be concatenated.
 */
export function identifierColumnNames(
  attributes: Array<{
    name: string;
    type?: string;
    unique?: boolean;
    isForeignKey?: boolean;
    enumReferenceId?: number;
  }>,
  primaryKey?: string
): string[] {
  const names = new Set(attributes.map((attribute) => attribute.name));
  const has = (name: string) => names.has(name);

  /* One column that names the record outright. */
  for (const candidate of ["name", "full_name", "display_name", "title", "label", "subject"]) {
    if (has(candidate)) return [candidate];
  }

  /* A person: two columns that only mean anything together. This is the case
     the concatenation exists for, and the one the old rule could not express. */
  if (has("first_name") && has("last_name")) return ["first_name", "last_name"];

  /* A code or reference is not a name, but it is what people quote at each
     other, and it beats a uuid. */
  for (const candidate of ["code", "reference", "number"]) {
    if (has(candidate)) return [candidate];
  }

  /* A join entity, whose identity is the pair of records it joins.
     `CampaignMember` is a campaign and a contact; nothing else about it names
     it, and the first readable column below would offer `member_status` —
     which says what the record *is doing*, not which record it is. Two or more
     references and no name of its own is the shape, and the first two are the
     pair: a label built from more than two parents stops being readable. The
     columns hold uuids, so whoever renders this resolves each one through the
     parent's own label — see `labelFor` in the generated server. */
  const references = attributes.filter(
    (attribute) =>
      attribute.name !== primaryKey &&
      attribute.isForeignKey &&
      isForeignKeyColumnName(attribute.name)
  );
  if (references.length >= 2) return references.slice(0, 2).map((attribute) => attribute.name);

  /* Failing all of that, the first plain text column the model declared that is
     neither the key, a pointer at another record, nor a closed vocabulary. A column
     bound to a `%%enum` (a `status`, a `stage`) says what the record is *doing*, not
     which record it is: every pack read "active", and a lifecycle owns the column, so
     no form even offers it. */
  const readable = attributes.find(
    (attribute) =>
      attribute.name !== primaryKey &&
      !attribute.isForeignKey &&
      !attribute.enumReferenceId &&
      !attribute.name.endsWith("_id") &&
      (attribute.type === "string" || attribute.type === "text")
  );
  if (readable) return [readable.name];

  /* No text of its own: a record with one parent and a date is told apart by whose
     it is and when — a class pack is "Dennis Lindgren · 2026-08-26". The reference
     holds a uuid, so whoever renders this resolves it through the parent's own label,
     as for a join entity above. */
  const parent = attributes.find(
    (attribute) =>
      attribute.name !== primaryKey &&
      attribute.isForeignKey &&
      isForeignKeyColumnName(attribute.name)
  );
  const when = attributes.find(
    (attribute) => attribute.type === "date" || attribute.type === "datetime"
  );
  return parent && when ? [parent.name, when.name] : [];
}

export function attributeReferenceId(attr: EntityAttribute, entityPrimaryKey?: string): number {
  if (attr.name === "id") return ReferenceType.ID;
  if (entityPrimaryKey && attr.name === entityPrimaryKey) return ReferenceType.ID;
  if (attr.isForeignKey && isForeignKeyColumnName(attr.name)) return ReferenceType.TABLE_DIRECT;
  // A column bound to a `%%enum` points at that enum's own list reference. The
  // generated forms render any reference at or above 1000 as a dropdown fed by
  // /sys/ref-list, so this is what stops a modelled status being a text box the
  // user can type anything into — including values the state machine cannot act
  // on.
  if (attr.enumReferenceId) return attr.enumReferenceId;
  // `email`, `url`, `phone`, `password` and `color` all normalise to `string`,
  // so the alias the modeller wrote is the only record that the column is an
  // address rather than a name. Read before the canonical type, which by this
  // point cannot tell them apart.
  if (attr.semanticType) return SEMANTIC_REFERENCE[attr.semanticType];
  const byName = referenceFromColumnName(attr);
  if (byName !== undefined) return byName;
  return attributeTypeToReferenceId(attr.type);
}

/**
 * Failing an alias, the column's name — for the model that wrote `string email`
 * rather than `email email`.
 *
 * The browser stack has had this since it was written and core did not, so the
 * same model rendered an email input in one application and a plain text box in
 * the other. Both read this now.
 *
 * Guarded to a column that could plausibly hold an address, a number or a link:
 * `boolean email_opt_out` is a checkbox that happens to have "email" in its
 * name, and giving it the EMAIL reference put an email input in front of a
 * true/false column.
 */
export function referenceFromColumnName(attr: EntityAttribute): number | undefined {
  if (attr.type !== "string" && attr.type !== "text") return undefined;
  if (/email/i.test(attr.name)) return ReferenceType.EMAIL;
  if (/phone|mobile|tel/i.test(attr.name)) return ReferenceType.PHONE;
  if (/url|website|link/i.test(attr.name)) return ReferenceType.URL;
  return undefined;
}

/**
 * Whether an FK-marked column name is one the generator can resolve to a table.
 *
 * `<entity>_id` is the convention. A bare `_by` column is accepted too: it names
 * a person by the role they played (`reported_by`, `approved_by`) and resolves
 * to the user entity. Without this it would fall through to the declared scalar
 * type and render as a plain string — the raw UUID, no lookup — which is what
 * the EML checker reports as EML114 and the fixer repairs by appending `_id`.
 * Accepting both spellings means a model that has not been through the fixer
 * still gets a working lookup.
 */
export function isForeignKeyColumnName(columnName: string): boolean {
  return columnName.endsWith("_id") || columnName.endsWith("_by");
}

/**
 * The stem a column's label is built from.
 *
 * A Table Direct column stores a uuid and *shows* the referenced record — so
 * "Class Session Id" over a column reading "Ballet, Studio 2" names the wrong
 * thing. Strip the `_id` suffix so the label names the record, which is what
 * the reader sees in it.
 *
 * Only for a resolved foreign key: the primary key stays "Id", and a `_by`
 * column keeps its suffix because "Created By" is the label and "Created" is
 * not.
 */
function foreignKeyLabelStem(attr: EntityAttribute, entityPrimaryKey?: string): string {
  const isTableDirect = attributeReferenceId(attr, entityPrimaryKey) === ReferenceType.TABLE_DIRECT;
  if (isTableDirect && attr.name.endsWith("_id") && !attr.name.endsWith("_by_id")) {
    return attr.name.slice(0, -"_id".length);
  }
  return attr.name;
}

/**
 * Every entity name, keyed by itself with separators and case removed.
 *
 * `kyc_record` and `KYCRecord` both squash to `kycrecord`, which is what lets a
 * column find the entity it points at. Case is the thing being recovered, so it
 * cannot also be the thing being matched on.
 */
export function declaredEntityNames(entities: { name: string }[]): Map<string, string> {
  return new Map(
    entities.map((entity) => [entity.name.toLowerCase().replace(/_/g, ""), entity.name])
  );
}

/**
 * The label a column carries on screen.
 *
 * A resolved foreign key is labelled by the thing it points at rather than by
 * the column that points: `kyc_record_id` reads `KYC Record`. Two steps, and
 * each was missing on one side. The NestJS dictionary stripped the suffix but
 * had only the column to work from, so the acronym was already gone — `Kyc
 * Record`. The browser bundle labelled the raw column and kept the suffix too —
 * `Kyc Record Id`. One model, one column, two different words on screen.
 *
 * `declared` is what recovers the case: a column is lower-case by the time it
 * reaches here, and the entity's own name is the only place the acronym still
 * exists. Without the map this degrades to what core did before, which is why
 * it is optional rather than required — a caller that has no entity list is
 * better off with `Kyc Record` than with a crash.
 */
export function attributeDisplayName(
  attr: EntityAttribute,
  entityPrimaryKey?: string,
  declared?: Map<string, string>
): string {
  const stem = foreignKeyLabelStem(attr, entityPrimaryKey);
  if (stem !== attr.name) {
    const resolved = declared?.get(stem.toLowerCase().replace(/_/g, ""));
    if (resolved) return formatDisplayName(resolved);
  }
  return formatDisplayName(stem);
}

/**
 * Converts an EntityAttribute to BusEntityAttribute
 */
export function attributeToBusAttribute(
  attr: EntityAttribute,
  index: number,
  entityPrimaryKey?: string,
  declared?: Map<string, string>
): BusEntityAttribute {
  return {
    ...attr,
    columnName: attr.name,
    displayName: attributeDisplayName(attr, entityPrimaryKey, declared),
    referenceId: attributeReferenceId(attr, entityPrimaryKey),
    seqNo: (index + 1) * 10,
    // Set across the whole list by `withIdentifiers`; one attribute on its own
    // cannot tell whether it identifies the record.
    isIdentifier: false,
  };
}

/**
 * Converts a Relationship to BusRelationship
 */
export function relationshipToBusRelationship(rel: Relationship): BusRelationship {
  return {
    ...rel,
    sourceTableName: `${BUS_TABLE_PREFIX}${rel.sourceEntity.toLowerCase()}`,
    targetTableName: `${BUS_TABLE_PREFIX}${rel.targetEntity.toLowerCase()}`,
  };
}

// ============================================================================
// Dictionary Entry Generation
// ============================================================================

/**
 * Configuration for dictionary entry generation
 */
export interface DictionaryGenerationConfig {
  defaultEntityType: string;
  createdBy: string;
  randomizeFieldOrder: boolean;
  includeFieldGroups: boolean;
  defaultAccessLevel: (typeof AccessLevel)[keyof typeof AccessLevel];
}

export const defaultDictionaryConfig: DictionaryGenerationConfig = {
  defaultEntityType: "U",
  createdBy: "System",
  randomizeFieldOrder: true,
  includeFieldGroups: true,
  defaultAccessLevel: AccessLevel.ALL,
};

/**
 * Get default icon for an entity based on its name pattern
 * Returns lucide-react icon names or emoji
 */
function getEntityIcon(name: string, tableName: string): string {
  const lowerName = name.toLowerCase();
  const lowerTableName = tableName.toLowerCase();

  // Person/Human related
  if (
    lowerName.includes("patient") ||
    lowerName.includes("person") ||
    lowerName.includes("customer")
  ) {
    return "User";
  }
  if (
    lowerName.includes("staff") ||
    lowerName.includes("employee") ||
    lowerName.includes("provider")
  ) {
    return "UserCircle";
  }
  if (lowerName.includes("user") || lowerName.includes("admin")) {
    return "Users";
  }

  // Health/Medical specific
  if (lowerName.includes("appointment") || lowerName.includes("schedule")) {
    return "Calendar";
  }
  if (lowerName.includes("allergy")) {
    return "ShieldAlert";
  }
  if (lowerName.includes("encounter") || lowerName.includes("visit")) {
    return "Stethoscope";
  }
  if (lowerName.includes("insurance")) {
    return "Shield";
  }
  if (lowerName.includes("department") || lowerName.includes("ward")) {
    return "Building2";
  }
  if (lowerName.includes("bed") || lowerName.includes("room")) {
    return "BedDouble";
  }
  if (lowerName.includes("prescription") || lowerName.includes("medication")) {
    return "Pill";
  }
  if (lowerName.includes("diagnosis") || lowerName.includes("condition")) {
    return "Activity";
  }

  // Document/File related
  if (
    lowerName.includes("document") ||
    lowerName.includes("file") ||
    lowerName.includes("attachment")
  ) {
    return "FileText";
  }

  // Time/Date related
  if (lowerName.includes("date") || lowerName.includes("time") || lowerName.includes("shift")) {
    return "Clock";
  }

  // Location/Place related
  if (lowerName.includes("location") || lowerName.includes("address")) {
    return "MapPin";
  }
  if (lowerName.includes("warehouse") || lowerName.includes("inventory")) {
    return "Package";
  }

  // Order/Transaction related
  if (
    lowerName.includes("order") ||
    lowerName.includes("invoice") ||
    lowerName.includes("receipt")
  ) {
    return "Receipt";
  }
  if (lowerName.includes("payment") || lowerName.includes("transaction")) {
    return "CreditCard";
  }
  if (lowerName.includes("quote") || lowerName.includes("proposal")) {
    return "FileText";
  }

  // Product/Item related
  if (lowerName.includes("product") || lowerName.includes("item")) {
    return "Package";
  }
  if (lowerName.includes("category") || lowerName.includes("group")) {
    return "FolderTree";
  }
  if (lowerName.includes("price") || lowerName.includes("cost")) {
    return "DollarSign";
  }

  // Account/Finance related
  if (lowerName.includes("account") || lowerName.includes("ledger")) {
    return "Wallet";
  }
  if (lowerName.includes("budget")) {
    return "PieChart";
  }

  // Communication related
  if (
    lowerName.includes("email") ||
    lowerName.includes("message") ||
    lowerName.includes("notification")
  ) {
    return "Mail";
  }
  if (lowerName.includes("phone") || lowerName.includes("call")) {
    return "Phone";
  }

  // Status/State related
  if (lowerName.includes("status") || lowerName.includes("state")) {
    return "Status";
  }

  // Configuration/Settings related
  if (
    lowerName.includes("config") ||
    lowerName.includes("setting") ||
    lowerName.includes("preference")
  ) {
    return "Settings";
  }

  // Security/Access related
  if (
    lowerName.includes("role") ||
    lowerName.includes("permission") ||
    lowerName.includes("access")
  ) {
    return "Lock";
  }

  // Data/Analytics related
  if (
    lowerName.includes("report") ||
    lowerName.includes("analytics") ||
    lowerName.includes("chart")
  ) {
    return "BarChart";
  }
  if (lowerName.includes("log") || lowerName.includes("audit") || lowerName.includes("history")) {
    return "History";
  }

  // Default icon based on table type
  if (lowerTableName.includes("sys_")) {
    return "Settings"; // System tables
  }

  return "Table"; // Default generic table icon
}

/**
 * Generates sys_table entry from BusEntity
 */
export function generateSysTable(
  entity: BusEntity,
  config: DictionaryGenerationConfig = defaultDictionaryConfig
): Omit<SysTable, "sys_table_id" | "created_at" | "updated_at"> {
  return {
    table_name: entity.tableName,
    name: entity.displayName,
    description: entity.description,
    icon: getEntityIcon(entity.displayName, entity.tableName),
    access_level: config.defaultAccessLevel,
    is_view: false,
    is_document: false,
    is_high_volume: false,
    is_changelog: true,
    entity_type: config.defaultEntityType,
    is_active: true,
    created_by: config.createdBy,
    updated_by: config.createdBy,
  };
}

/**
 * Generates sys_column entries from BusEntity attributes
 */
export function generateSysColumns(
  tableId: string,
  attributes: BusEntityAttribute[],
  primaryKey: string,
  config: DictionaryGenerationConfig = defaultDictionaryConfig
): Array<Omit<SysColumn, "sys_column_id" | "created_at" | "updated_at">> {
  /* `entityToBusEntity` has already decided this for the whole list; falling
     back to deriving it again covers a caller that built attributes by hand. */
  const identifiers = attributes.some((attribute) => attribute.isIdentifier)
    ? new Set(attributes.filter((a) => a.isIdentifier).map((a) => a.name))
    : new Set(identifierColumnNames(attributes, primaryKey));
  return attributes.map((attr, _index) => ({
    sys_table_id: tableId,
    column_name: attr.columnName,
    name: attr.displayName,
    description: undefined,
    sys_reference_id: attr.referenceId,
    sys_val_rule_id: undefined,
    field_length: attr.maxLength,
    default_value: attr.default?.toString(),
    value_min: undefined,
    value_max: undefined,
    is_key: attr.name === primaryKey,
    is_parent: false,
    is_mandatory: attr.required,
    is_updateable: attr.name !== primaryKey,
    is_identifier: identifiers.has(attr.name),
    is_selection_column: attr.name === "name" || attr.unique === true,
    is_translated: false,
    is_encrypted: false,
    is_allow_logging: true,
    is_allow_copy: attr.name !== primaryKey,
    seq_no: attr.seqNo,
    callout: undefined,
    read_only_logic: undefined,
    mandatory_logic: undefined,
    format_pattern: undefined,
    entity_type: config.defaultEntityType,
    is_active: true,
    created_by: config.createdBy,
    updated_by: config.createdBy,
  }));
}

/**
 * Generates sys_window entry for a BusEntity
 */
export function generateSysWindow(
  entity: BusEntity,
  config: DictionaryGenerationConfig = defaultDictionaryConfig
): Omit<SysWindow, "sys_window_id" | "created_at" | "updated_at"> {
  return {
    name: entity.displayName,
    description: `Maintain ${entity.displayName} records`,
    help: undefined,
    window_type: WindowType.MAINTAIN,
    is_sales_transaction: false,
    is_default: true,
    entity_type: config.defaultEntityType,
    is_active: true,
    created_by: config.createdBy,
    updated_by: config.createdBy,
  };
}

/**
 * Generates sys_tab entry for a BusEntity
 */
export function generateSysTab(
  windowId: string,
  tableId: string,
  entity: BusEntity,
  tabLevel: number = 0,
  config: DictionaryGenerationConfig = defaultDictionaryConfig
): Omit<SysTab, "sys_tab_id" | "created_at" | "updated_at"> {
  return {
    sys_window_id: windowId,
    sys_table_id: tableId,
    name: entity.displayName,
    description: undefined,
    help: undefined,
    tab_level: tabLevel,
    seq_no: (tabLevel + 1) * 10,
    is_single_row: tabLevel === 0,
    has_tree: false,
    is_info_tab: false,
    is_translation_tab: false,
    is_read_only: false,
    is_insert_record: true,
    is_advanced_tab: false,
    parent_column_id: undefined,
    link_column_id: undefined,
    order_by_clause: undefined,
    where_clause: undefined,
    display_logic: undefined,
    read_only_logic: undefined,
    commit_warning: undefined,
    entity_type: config.defaultEntityType,
    is_active: true,
    created_by: config.createdBy,
    updated_by: config.createdBy,
  };
}

/**
 * Generates sys_field entries for a BusEntity
 * Field order (seq_no) is randomized by default for runtime modification demo
 */
export function generateSysFields(
  tabId: string,
  columns: Array<{
    sys_column_id: string;
    column_name: string;
    name: string;
    /** `%%field <E>.<c> help:` — carried onto the field so a screen shows it. */
    description?: string;
  }>,
  config: DictionaryGenerationConfig = defaultDictionaryConfig
): Array<Omit<SysField, "sys_field_id" | "created_at" | "updated_at">> {
  // Create base sequence numbers
  const seqNumbers = columns.map((_, index) => (index + 1) * 10);

  // Optionally randomize the order
  if (config.randomizeFieldOrder) {
    shuffleArray(seqNumbers);
  }

  return columns.map((col, index) => ({
    sys_tab_id: tabId,
    sys_column_id: col.sys_column_id,
    sys_field_group_id: undefined,
    name: col.name,
    description: col.description,
    help: undefined,
    seq_no: seqNumbers[index] ?? (index + 1) * 10,
    seq_no_grid: (index + 1) * 10,
    display_length: undefined,
    column_span: undefined,
    num_lines: undefined,
    is_displayed: true,
    is_displayed_grid: true,
    is_read_only: false,
    is_encrypted: false,
    is_same_line: false,
    is_heading: false,
    is_field_only: false,
    display_logic: undefined,
    read_only_logic: undefined,
    mandatory_logic: undefined,
    obscure_type: undefined,
    included_tab_id: undefined,
    default_value: undefined,
    sort_no: undefined,
    entity_type: config.defaultEntityType,
    is_active: true,
    created_by: config.createdBy,
    updated_by: config.createdBy,
  }));
}

/**
 * Generates sys_field_group entries for organizing fields
 */
export function generateSysFieldGroups(
  entityName: string,
  config: DictionaryGenerationConfig = defaultDictionaryConfig
): Array<Omit<SysFieldGroup, "sys_field_group_id" | "created_at" | "updated_at">> {
  if (!config.includeFieldGroups) {
    return [];
  }

  return [
    {
      name: "General",
      description: `General information for ${entityName}`,
      field_group_type: "C",
      is_collapsed_by_default: false,
      entity_type: config.defaultEntityType,
      is_active: true,
      created_by: config.createdBy,
      updated_by: config.createdBy,
    },
    {
      name: "Details",
      description: `Detailed information for ${entityName}`,
      field_group_type: "C",
      is_collapsed_by_default: true,
      entity_type: config.defaultEntityType,
      is_active: true,
      created_by: config.createdBy,
      updated_by: config.createdBy,
    },
  ];
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Formats a name for display (camelCase/snake_case to Title Case)
 */
export function formatDisplayName(name: string): string {
  return splitWords(name).map(titleWord).join(" ");
}

/**
 * A name, as the words it is made of.
 *
 * Two boundaries, and the second is the one that matters: `fooBar` splits on
 * the lower-to-upper step, and a run of capitals splits *before its last
 * letter* when a lowercase follows, because that last capital starts the next
 * word. `KYCRecord` is `KYC` + `Record`, not `KYCR` + `ecord`.
 */
function splitWords(name: string): string[] {
  return name
    .replace(/[_\s-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Capitalise a word, unless it is already an acronym.
 *
 * A model that declares `KYCRecord` or `CAPA` means the acronym, and lowering
 * it renames the entity on screen: `Kyc Record`, `Capa`. Nothing downstream
 * reads these — they are labels — so the failure is silent and permanent, and
 * a reader comparing the screen to their own model finds the two disagree.
 */
function titleWord(word: string): string {
  return /^[A-Z0-9]+$/.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Fisher-Yates shuffle algorithm for randomizing array
 */
function shuffleArray<T>(array: T[]): void {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = array[i] as T;
    array[i] = array[j] as T;
    array[j] = temp;
  }
}

// ============================================================================
// Complete Entity Dictionary Generation
// ============================================================================

/**
 * Complete dictionary metadata for a business entity
 */
export interface EntityDictionaryMetadata {
  table: Omit<SysTable, "sys_table_id" | "created_at" | "updated_at">;
  columns: Array<Omit<SysColumn, "sys_column_id" | "created_at" | "updated_at">>;
  window: Omit<SysWindow, "sys_window_id" | "created_at" | "updated_at">;
  tab: Omit<SysTab, "sys_tab_id" | "created_at" | "updated_at">;
  fields: Array<Omit<SysField, "sys_field_id" | "created_at" | "updated_at">>;
  fieldGroups: Array<Omit<SysFieldGroup, "sys_field_group_id" | "created_at" | "updated_at">>;
}

/**
 * Generates complete dictionary metadata for an entity
 * Note: IDs are placeholders and should be generated at seed time
 */
export function generateEntityDictionary(
  entity: Entity,
  config: DictionaryGenerationConfig = defaultDictionaryConfig
): {
  busEntity: BusEntity;
  busAttributes: BusEntityAttribute[];
  dictionaryPlaceholders: {
    table: ReturnType<typeof generateSysTable>;
    window: ReturnType<typeof generateSysWindow>;
    fieldGroups: ReturnType<typeof generateSysFieldGroups>;
  };
} {
  const busEntity = entityToBusEntity(entity);
  const busAttributes = entity.attributes.map((attr, index) =>
    attributeToBusAttribute(attr, index, entity.primaryKey)
  );

  return {
    busEntity,
    busAttributes,
    dictionaryPlaceholders: {
      table: generateSysTable(busEntity, config),
      window: generateSysWindow(busEntity, config),
      fieldGroups: generateSysFieldGroups(busEntity.displayName, config),
    },
  };
}

// ============================================================================
// Zod Schemas
// ============================================================================

export const BusEntitySchema = z.object({
  name: z.string(),
  tableName: z.string().regex(/^bus_/, "Table name must start with bus_"),
  originalName: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
  attributes: z.array(z.any()),
  primaryKey: z.string(),
  timestamps: z.boolean(),
});

export const DictionaryGenerationConfigSchema = z.object({
  defaultEntityType: z.string(),
  createdBy: z.string(),
  randomizeFieldOrder: z.boolean(),
  includeFieldGroups: z.boolean(),
  defaultAccessLevel: z.enum(["S", "C", "O", "CO", "A"]),
});
