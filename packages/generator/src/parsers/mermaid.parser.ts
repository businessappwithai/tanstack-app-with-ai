/**
 * Mermaid ERD Parser
 *
 * Parses Mermaid ER diagram syntax and extracts entities and relationships.
 * Supports standard Mermaid ERD notation including:
 * - Entity definitions with attributes
 * - Relationship cardinalities (||--||, ||--o{, }o--||, }o--o{)
 * - Attribute types (string, integer, boolean, date, etc.)
 * - Attribute modifiers (PK, FK, UK, OPTIONAL)
 *
 * @example
 * ```mermaid
 * erDiagram
 *   Customer {
 *     string id PK
 *     string name
 *     string email UK
 *     date created_at
 *   }
 *   Order ||--o{ OrderItem : contains
 * ```
 */

import type {
  Entity,
  EntityAttribute,
  EntityEnum,
  EntityIndex,
  Relationship,
} from "@appwithai/core/types";
import { snakeCase } from "@appwithai/core/utils";
import { getCardinalityKind, getDefaultType, getTypeMap } from "./language-maps";

type FieldLogicKey = "display" | "readonly" | "mandatory";

// Type mapping from Mermaid types to our standard types.
// Sourced from language/appwithai-language.json at runtime (with a built-in
// fallback) so the parser stays in lockstep with the EML language definition.
const TYPE_MAP: Record<string, EntityAttribute["type"]> = getTypeMap();

/**
 * The aliases that mean something the canonical type does not.
 *
 * All five normalise to `string`, so by the time an attribute reaches the
 * dictionary the word the modeller wrote is the only thing that separates an
 * e-mail address from a password from a colour. Keeping it is what makes
 * `email contact_email` render as an e-mail control rather than being inferred
 * from the column's name — an inference that reads `boolean email_opt_out` as
 * an address.
 */
const SEMANTIC_TYPES = new Set(["email", "url", "phone", "password", "color"]);

/**
 * Collapse a column declared more than once into a single attribute.
 *
 * A duplicate is a mistake, and `EML112` says so — but it reached the generated
 * schema as a `CREATE TABLE` naming the column twice, which PostgreSQL refuses
 * outright, so the application never opened and the message named no model
 * line. It reached the Application Dictionary as two `sys_column` rows for one
 * column as well, which is a form with the field on it twice.
 *
 * The first declaration keeps its place and its type: it is where the author
 * was describing this column, and the later line is the accident. The
 * *constraints* merge the other way — the strongest of them wins:
 *
 * - **required**, if any declaration is required. `string title` followed by
 *   `string title OPTIONAL` must not quietly relax a mandatory column into a
 *   nullable one; the loosening is invisible in the diagram and shows up as
 *   missing data much later.
 * - **unique** and **FK** likewise, because each of them is a promise something
 *   downstream relies on — a lookup, an index, a key. (`PK` arrives as
 *   `unique`, and the entity's primary key is picked from the merged list.)
 *
 * The result is the column the author most plausibly meant, and never fewer
 * guarantees than they wrote down.
 */
function mergeDuplicateAttributes(attributes: EntityAttribute[]): EntityAttribute[] {
  const byName = new Map<string, EntityAttribute>();

  for (const attribute of attributes) {
    const existing = byName.get(attribute.name);
    if (!existing) {
      byName.set(attribute.name, { ...attribute });
      continue;
    }

    existing.required = existing.required || attribute.required;
    if (attribute.unique) existing.unique = true;
    if (attribute.isForeignKey) existing.isForeignKey = true;
    // Anything the first line did not say, a later one may still supply.
    if (existing.maxLength === undefined && attribute.maxLength !== undefined) {
      existing.maxLength = attribute.maxLength;
    }
    if (existing.semanticType === undefined && attribute.semanticType !== undefined) {
      existing.semanticType = attribute.semanticType;
    }
    if (existing.description === undefined && attribute.description !== undefined) {
      existing.description = attribute.description;
    }
  }

  return [...byName.values()];
}

export class MermaidParser {
  /**
   * Parse Mermaid ERD syntax
   * @param mermaidSyntax - Raw Mermaid ERD content
   * @returns Parsed entities and relationships
   */
  parse(mermaidSyntax: string): {
    entities: Entity[];
    relationships: Relationship[];
    enums: EntityEnum[];
  } {
    const entities: Entity[] = [];
    const relationships: Relationship[] = [];

    // Normalize line endings
    const normalizedContent = mermaidSyntax.replace(/\r\n/g, "\n");
    const lines = normalizedContent.split("\n");

    let currentEntity: Partial<Entity> | null = null;
    let currentAttributes: EntityAttribute[] = [];
    let inEntityBlock = false;

    /**
     * `%%index` names its entity, so declarations are collected as they appear
     * and attached at the end. Binding them as we go would depend on the
     * directive following the entity block it refers to, which the language
     * does not require.
     */
    const declaredIndexes: Array<{ entity: string } & EntityIndex> = [];

    /**
     * `%%enum Name: a, b, c` and the `%%field Entity.column enum: Name` lines
     * that bind columns to it. Both are collected as they appear and resolved
     * at the end, for the same reason as `%%index`: the language does not say
     * a directive has to follow the block it refers to.
     */
    const declaredEnums = new Map<string, string[]>();
    const enumBindings: Array<{ entity: string; column: string; enumName: string }> = [];
    const fieldHelpText: Array<{ entity: string; column: string; help: string }> = [];
    const fieldLogic: Array<{ entity: string; column: string; kind: FieldLogicKey; logic: string }> =
      [];
    const entityHelpText = new Map<string, string>();
    const entityIcons = new Map<string, string>();
    const entityParents = new Map<string, string>();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const trimmed = line.trim();

      // Skip empty lines, comments, and erDiagram declaration. `%%index` is the
      // exception: it is a directive, not prose, and is read before the blanket
      // comment skip that would otherwise swallow it.
      if (!trimmed || trimmed === "erDiagram") {
        continue;
      }
      if (trimmed.startsWith("%%")) {
        const index = this.parseIndexDirective(trimmed);
        if (index) declaredIndexes.push(index);
        const declaredEnum = this.parseEnumDirective(trimmed);
        if (declaredEnum && !declaredEnums.has(declaredEnum.name)) {
          declaredEnums.set(declaredEnum.name, declaredEnum.values);
        }
        const binding = this.parseFieldEnumDirective(trimmed);
        if (binding) enumBindings.push(binding);
        const fieldHelp = this.parseFieldHelpDirective(trimmed);
        if (fieldHelp) fieldHelpText.push(fieldHelp);
        const logic = this.parseFieldLogicDirective(trimmed);
        if (logic) fieldLogic.push(logic);
        const entityHelp = this.parseEntityHelpDirective(trimmed);
        if (entityHelp) entityHelpText.set(entityHelp.entity, entityHelp.help);
        const entityIcon = this.parseEntityIconDirective(trimmed);
        if (entityIcon) entityIcons.set(entityIcon.entity, entityIcon.icon);
        const entityParent = this.parseEntityParentDirective(trimmed);
        if (entityParent) entityParents.set(entityParent.entity, entityParent.parent);
        continue;
      }

      // Parse relationship (can appear before or after entity definitions)
      const relationship = this.parseRelationship(trimmed);
      if (relationship) {
        relationships.push(relationship);
        continue;
      }

      // Parse entity start: "EntityName {", "entity_name {", or "bus_entity {"
      const entityStartMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9_]*)\s*\{$/);
      if (entityStartMatch?.[1]) {
        // Save previous entity if exists
        if (currentEntity && currentAttributes.length > 0) {
          entities.push(this.completeEntity(currentEntity, currentAttributes));
        }

        currentEntity = {
          name: entityStartMatch[1],
        };
        currentAttributes = [];
        inEntityBlock = true;
        continue;
      }

      // Parse entity end
      if (trimmed === "}") {
        if (currentEntity) {
          entities.push(this.completeEntity(currentEntity, currentAttributes));
          currentEntity = null;
          currentAttributes = [];
        }
        inEntityBlock = false;
        continue;
      }

      // Parse attribute (only if inside entity block)
      if (inEntityBlock && currentEntity) {
        const attr = this.parseAttribute(trimmed);
        if (attr) {
          currentAttributes.push(attr);
        }
      }
    }

    // Handle entity without closing brace (edge case)
    if (currentEntity && currentAttributes.length > 0) {
      entities.push(this.completeEntity(currentEntity, currentAttributes));
    }

    this.attachIndexes(entities, declaredIndexes);
    this.attachHelp(entities, fieldHelpText, entityHelpText);
    this.attachFieldLogic(entities, fieldLogic);
    this.attachIcons(entities, entityIcons);
    this.attachParents(entities, entityParents);
    const enums = this.attachEnums(entities, declaredEnums, enumBindings);

    return { entities, relationships, enums };
  }

  /**
   * Hang the help text on the entities and columns it names.
   *
   * A directive naming something the document does not declare is dropped
   * here rather than invented: the checker reports it as EML141 or EML142, and
   * a column conjured out of a help line would be a column the schema has no
   * place for.
   */
  private attachHelp(
    entities: Entity[],
    fieldHelp: Array<{ entity: string; column: string; help: string }>,
    entityHelp: Map<string, string>
  ): void {
    for (const [name, help] of entityHelp) {
      const entity = entities.find((candidate) => candidate.name === name);
      if (entity) entity.description = help;
    }
    for (const { entity: name, column, help } of fieldHelp) {
      const attribute = entities
        .find((candidate) => candidate.name === name)
        ?.attributes.find((candidate) => candidate.name === column);
      if (attribute) attribute.description = help;
    }
  }

  /**
   * Hang each `%%entity <E> icon: <name>` on the entity it names.
   *
   * A directive naming an entity the document does not declare is dropped, the
   * way help text is: the checker reports it (EML141) and an entity conjured
   * out of an icon line would be a table the schema has no place for.
   */
  private attachIcons(entities: Entity[], icons: Map<string, string>): void {
    for (const [name, icon] of icons) {
      const entity = entities.find((candidate) => candidate.name === name);
      if (entity) entity.icon = icon;
    }
  }

  /**
   * Bind each `%%entity <Child> parent: <Parent>` to the column that links them.
   *
   * The link is the child's own foreign key to the parent — the modeller has
   * already drawn it, so asking for it again would be a second way to say one
   * thing. It is found by the ordinary rule, `<parent>_id`, and failing that by
   * any FK column whose name carries the parent's snake_case name.
   *
   * A parent that does not exist, or a child with no key back to it, is left
   * unlinked rather than guessed at: the checker reports both (EML147, EML148),
   * and a child tab keyed on the wrong column would silently show one invoice's
   * lines under another's.
   */
  private attachParents(entities: Entity[], parents: Map<string, string>): void {
    for (const [childName, parentName] of parents) {
      const child = entities.find((candidate) => candidate.name === childName);
      const parent = entities.find((candidate) => candidate.name === parentName);
      if (!child || !parent) continue;

      /* The shared snake-caser, not a local one. Its own copy dropped the
         acronym rule, so `KYCRecord` came out `kycrecord`: a model declaring
         `kyc_record_id` — the column the migration actually emits — found no
         link, and the child silently kept its own window and gained no tab.
         Nothing reported it, because the parser is what the checker's own
         EML148 was comparing against. */
      const snake = snakeCase(parent.name);
      const link =
        child.attributes.find((a) => a.isForeignKey && a.name === `${snake}_id`) ??
        child.attributes.find((a) => a.isForeignKey && a.name.startsWith(`${snake}_`));
      if (!link) continue;

      child.parentEntity = parent.name;
      child.parentLinkColumn = link.name;
    }

    this.flattenNestedLineItems(entities);
  }

  /**
   * A line item of a line item stands on its own.
   *
   * A child has no window: its tab lives in its parent's, one level down, and
   * the window the front end opens is the one a top-level entity owns. A child
   * whose parent is itself a child therefore names a window that was never
   * created — the dictionary seed referenced `cargoItemWindowId` for
   * `DangerousGoods parent: CargoItem` while `CargoItem parent: Shipment`, and
   * the generated backend failed to compile. The tab model has two levels, so
   * the deeper entity keeps its foreign key and gets a window of its own, the
   * way an entity that declared no `parent:` does. Entities are taken
   * shallowest first, so in a chain of three the third is a child of the second
   * once the second has been made top-level.
   */
  private flattenNestedLineItems(entities: Entity[]): void {
    const byName = new Map(entities.map((entity) => [entity.name, entity]));
    const depth = (entity: Entity): number => {
      let levels = 0;
      const seen = new Set<string>();
      for (
        let current = entity.parentEntity ? byName.get(entity.parentEntity) : undefined;
        current && !seen.has(current.name);
        current = current.parentEntity ? byName.get(current.parentEntity) : undefined
      ) {
        seen.add(current.name);
        levels++;
      }
      return levels;
    };

    const nested = entities
      .filter((entity) => entity.parentEntity)
      .map((entity) => ({ entity, levels: depth(entity) }))
      .sort((a, b) => a.levels - b.levels);

    for (const { entity } of nested) {
      const parent = entity.parentEntity ? byName.get(entity.parentEntity) : undefined;
      if (!parent?.parentEntity) continue;
      entity.parentEntity = undefined;
      entity.parentLinkColumn = undefined;
    }
  }

  /**
   * `%%index Entity(col)` or `%%index Entity(a, b) unique`.
   *
   * Returns null for any other `%%` line, which is how the caller tells a
   * directive from a comment.
   */
  private parseIndexDirective(line: string): ({ entity: string } & EntityIndex) | null {
    const match = line.match(/^%%index\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(unique)?\s*$/i);
    if (!match?.[1]) return null;

    const columns = (match[2] ?? "")
      .split(",")
      .map((column) => column.trim())
      .filter(Boolean);
    if (columns.length === 0) return null;

    return { entity: match[1], columns, unique: Boolean(match[3]) };
  }

  /**
   * Bind each declaration to the entity it names.
   *
   * A declaration naming an unknown entity, or a column the entity does not
   * have, is dropped rather than emitted: the migration would fail at run time
   * on a column that does not exist, and a migration that cannot apply is worse
   * than a missing index. The checker is what reports these to the author.
   */
  private attachIndexes(
    entities: Entity[],
    declared: Array<{ entity: string } & EntityIndex>
  ): void {
    for (const { entity: entityName, columns, unique } of declared) {
      const entity = entities.find((candidate) => candidate.name === entityName);
      if (!entity) continue;

      const known = new Set(entity.attributes.map((attribute) => attribute.name));
      if (!columns.every((column) => known.has(column))) continue;

      entity.indexes = entity.indexes ?? [];
      entity.indexes.push({ columns, unique });
    }
  }

  /** `%%enum OrderStatus: draft, submitted, approved` */
  private parseEnumDirective(line: string): { name: string; values: string[] } | null {
    const match = line.match(/^%%enum\s+([A-Za-z_]\w*)\s*:\s*(.+)$/);
    if (!match?.[1] || !match[2]) return null;
    const values = match[2]
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    return values.length > 0 ? { name: match[1], values } : null;
  }

  /** `%%field Order.status enum: OrderStatus` — the binding that makes a list. */
  private parseFieldEnumDirective(
    line: string
  ): { entity: string; column: string; enumName: string } | null {
    const match = line.match(
      /^%%field\s+([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s+enum\s*:\s*([A-Za-z_]\w*)\s*$/
    );
    if (!match?.[1] || !match[2] || !match[3]) return null;
    return { entity: match[1], column: match[2], enumName: match[3] };
  }

  /**
   * `%%field Order.total_amount help: What the customer is charged, before tax.`
   *
   * The text runs to the end of the line, punctuation and all: it is prose for
   * a person filling in the form, not an identifier. It becomes
   * sys_column.description, which the generated form renders under the control.
   */
  private parseFieldHelpDirective(
    line: string
  ): { entity: string; column: string; help: string } | null {
    const match = line.match(/^%%field\s+([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s+help\s*:\s*(.+)$/);
    if (!match?.[1] || !match[2] || !match[3]) return null;
    const help = match[3].trim();
    return help ? { entity: match[1], column: match[2], help } : null;
  }

  /**
   * `%%field Opportunity.loss_reason display: @stage@=closed_lost` — and
   * `readonly:` and `mandatory:` the same way. The expression is kept as
   * written: the checker validates it (EML156) and the runtimes evaluate it.
   */
  private parseFieldLogicDirective(
    line: string
  ): { entity: string; column: string; kind: FieldLogicKey; logic: string } | null {
    const match = line.match(
      /^%%field\s+([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s+(display|readonly|mandatory)\s*:\s*(.+)$/
    );
    if (!match?.[1] || !match[2] || !match[3] || !match[4]) return null;
    const logic = match[4].trim();
    return logic
      ? { entity: match[1], column: match[2], kind: match[3] as FieldLogicKey, logic }
      : null;
  }

  /** Hang field logic on the columns it names; an unknown column is EML142. */
  private attachFieldLogic(
    entities: Entity[],
    logic: Array<{ entity: string; column: string; kind: FieldLogicKey; logic: string }>
  ): void {
    for (const { entity: name, column, kind, logic: expression } of logic) {
      const attribute = entities
        .find((candidate) => candidate.name === name)
        ?.attributes.find((candidate) => candidate.name === column);
      if (!attribute) continue;
      if (kind === "display") attribute.displayLogic = expression;
      else if (kind === "readonly") attribute.readOnlyLogic = expression;
      else attribute.mandatoryLogic = expression;
    }
  }

  /** `%%entity Order help: One purchase, from raising to closing.` */
  private parseEntityHelpDirective(line: string): { entity: string; help: string } | null {
    const match = line.match(/^%%entity\s+([A-Za-z_]\w*)\s+(?:help|description)\s*:\s*(.+)$/);
    if (!match?.[1] || !match[2]) return null;
    const help = match[2].trim();
    return help ? { entity: match[1], help } : null;
  }

  /**
   * `%%entity Patient icon: stethoscope` — what the entity looks like.
   *
   * A lucide icon id, landing in `sys_table.icon`, which the dashboard card,
   * the navigation and the window heading all read. The same key the
   * Application Dictionary's upload field writes, so a model can set an icon
   * and an administrator can change it afterwards without the two disagreeing
   * about where an icon lives.
   *
   * Deliberately not validated against a catalogue: the checker does not carry
   * lucide's 1401 ids and a name it does not know renders a placeholder rather
   * than failing. `icon: flask` is the trap — lucide has `flask-conical` — and
   * the specification names it, because nothing else can.
   */
  private parseEntityIconDirective(line: string): { entity: string; icon: string } | null {
    const match = line.match(/^%%entity\s+([A-Za-z_]\w*)\s+icon\s*:\s*(.+)$/);
    if (!match?.[1] || !match[2]) return null;
    const icon = match[2].trim();
    return icon ? { entity: match[1], icon } : null;
  }

  /**
   * `%%entity InvoiceLine parent: Invoice` — a line item, not a reference.
   *
   * The ERD alone cannot tell the two apart. `InvoiceLine.invoice_id` and
   * `Invoice.patient_id` are both a foreign key with a relationship behind it,
   * and nothing in Mermaid says that a line has no life of its own while a
   * patient plainly does. This key says it, and the Application Dictionary
   * turns it into the arrangement the distinction was always about: the child
   * becomes a tab *inside* the parent's window rather than a window of its own,
   * linked on the foreign key it already declared.
   */
  private parseEntityParentDirective(line: string): { entity: string; parent: string } | null {
    const match = line.match(/^%%entity\s+([A-Za-z_]\w*)\s+parent\s*:\s*([A-Za-z_]\w*)\s*$/);
    if (!match?.[1] || !match[2]) return null;
    return { entity: match[1], parent: match[2] };
  }

  /**
   * Bind columns to their enums and allocate a sys_reference_id per enum.
   *
   * Ids run from 1000 up in sorted name order, which keeps them stable for a
   * given model: the generated forms render any reference at or above 1000 as a
   * dropdown fed by /sys/ref-list, so this allocation is what turns a modelled
   * enum into a select rather than a free-text box.
   *
   * Only enums something actually binds to get an id. A declared-but-unused
   * enum is documentation, and seeding a reference nothing points at would put
   * a dropdown in the dictionary that no field can ever show.
   */
  private attachEnums(
    entities: Entity[],
    declared: Map<string, string[]>,
    bindings: Array<{ entity: string; column: string; enumName: string }>
  ): EntityEnum[] {
    const used = new Set<string>();
    for (const binding of bindings) {
      if (!declared.has(binding.enumName)) continue;
      const entity = entities.find((candidate) => candidate.name === binding.entity);
      const attribute = entity?.attributes.find((candidate) => candidate.name === binding.column);
      if (attribute) used.add(binding.enumName);
    }

    const referenceIds = new Map<string, number>();
    let nextId = 1000;
    for (const name of [...used].sort()) {
      referenceIds.set(name, nextId++);
    }

    for (const binding of bindings) {
      const values = declared.get(binding.enumName);
      const referenceId = referenceIds.get(binding.enumName);
      if (!values || !referenceId) continue;
      const entity = entities.find((candidate) => candidate.name === binding.entity);
      const attribute = entity?.attributes.find((candidate) => candidate.name === binding.column);
      if (!attribute) continue;
      attribute.enumRef = binding.enumName;
      attribute.enumValues = values;
      attribute.enumReferenceId = referenceId;
    }

    return [...referenceIds.entries()].map(([name, referenceId]) => ({
      name,
      values: declared.get(name) ?? [],
      referenceId,
    }));
  }

  /**
   * Parse a relationship line.
   *
   * Supports all 8 Mermaid ER cardinality operators defined in the EML language
   * spec by delegating operator→kind resolution to getCardinalityKind() so the
   * parser stays in lockstep with appwithai-language.json.
   *
   * Left side glyphs:  ||  |o  }o  }|
   * Right side glyphs: ||  o|  o{  |{
   */
  private parseRelationship(line: string): Relationship | null {
    // Captures: entity  left--right  entity  optional-label
    const rel =
      /^([a-zA-Z_][a-zA-Z0-9_]*)\s+(\|[|o]|\}[o|])--(o[|{]|\|[|{])\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*:\s*"?([^"]*)"?)?$/;
    const match = line.match(rel);
    if (!match?.[1] || !match[4]) return null;

    const [, sourceEntity, left, right, targetEntity, rawLabel] = match;
    const operator = `${left}--${right}`;
    const cardinality = getCardinalityKind(operator);
    if (!cardinality) return null;

    const name = rawLabel?.trim()
      ? this.normalizeRelationshipName(rawLabel.trim())
      : `${sourceEntity.toLowerCase()}_${targetEntity.toLowerCase()}`;

    return {
      name,
      sourceEntity: sourceEntity!,
      targetEntity: targetEntity!,
      cardinality,
      foreignKey: this.generateForeignKey(sourceEntity!, targetEntity!, cardinality),
    };
  }

  /**
   * Parse an attribute line
   *
   * Format: type name [modifiers]
   * Examples:
   *   string name
   *   integer id PK
   *   string email UK
   *   decimal price OPTIONAL
   *   string customer_id FK
   */
  private parseAttribute(line: string): EntityAttribute | null {
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) return null;

    // Split into parts (type, name, modifiers...)
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) return null;

    const rawType = (parts[0] ?? "").toLowerCase();
    const baseType = rawType.replace(/\(\d+\)$/, "");
    const name = parts[1];
    if (!name) return null;
    const modifiers = parts.slice(2).map((m) => m.toUpperCase());

    // Map type to standard type (unknown aliases fall back to the language default)
    const type = TYPE_MAP[rawType] || getDefaultType();

    // Parse modifiers
    const isPrimaryKey = modifiers.includes("PK");
    const isForeignKey = modifiers.includes("FK");
    const isUnique = modifiers.includes("UK") || modifiers.includes("UNIQUE");
    const isOptional = modifiers.includes("OPTIONAL") || modifiers.includes("NULL");

    // Extract max length if specified (e.g., string(255))
    const lengthMatch = (parts[0] ?? "").match(/\((\d+)\)/);
    const maxLength = lengthMatch?.[1] ? parseInt(lengthMatch[1], 10) : undefined;

    return {
      name,
      type,
      required: !isOptional && !isPrimaryKey, // PK is auto-generated
      unique: isUnique || isPrimaryKey,
      maxLength,
      ...(isForeignKey && { isForeignKey: true }),
      ...(SEMANTIC_TYPES.has(baseType) && {
        semanticType: baseType as NonNullable<EntityAttribute["semanticType"]>,
      }),
    };
  }

  /**
   * Complete entity with default values
   */
  private completeEntity(partial: Partial<Entity>, declaredAttributes: EntityAttribute[]): Entity {
    const name = partial.name ?? "";
    if (!name) {
      throw new Error("Entity name is required");
    }

    const attributes = mergeDuplicateAttributes(declaredAttributes);

    // Convert PascalCase to snake_case for table name
    const tableName = this.toSnakeCase(name);

    // Check if id attribute exists, otherwise auto-add
    const hasIdAttribute = attributes.some(
      (a) => a.name === "id" || (a.unique && a.name.endsWith("_id"))
    );

    if (!hasIdAttribute) {
      // Add id as first attribute
      attributes.unshift({
        name: "id",
        type: "string", // UUID
        required: true,
        unique: true,
      });
    }

    // Find primary key (look for PK modifier or 'id' field)
    const pkAttribute = attributes.find((a) => a.unique && a.name === "id");
    const primaryKey = pkAttribute?.name || "id";

    return {
      name,
      tableName,
      description: ``,
      attributes,
      primaryKey,
      timestamps: true,
    };
  }

  /**
   * Convert PascalCase to snake_case
   * Handles:
   * - PascalCase: PascalCase → pascal_case
   * - camelCase: camelCase → camel_case
   * - CONSTANT_CASE: CONSTANT_CASE → constant_case
   * - snake_case: snake_case → snake_case
   */
  /**
   * One snake-caser, in core.
   *
   * This was a second implementation, and the two disagreed on a name that
   * begins with an acronym: `SIPInstruction` became `s_i_p_instruction` here
   * and `sip_instruction` everywhere that reads the same model, so the
   * generated application carried tables nothing else could name. A parser that
   * decides identifiers its own way is a parser that can be wrong on its own.
   */
  private toSnakeCase(str: string): string {
    return snakeCase(str);
  }

  /**
   * Normalize relationship name
   */
  private normalizeRelationshipName(name: string): string {
    return name.trim().replace(/\s+/g, "_").toLowerCase();
  }

  /**
   * Generate foreign key name based on relationship
   * Removes bus_ prefix if present to match actual database schema
   */
  /**
   * The foreign key column a relationship is carried by.
   *
   * The column lives on the *many* side and is named after the entity it points
   * at — the *one* side. This used to be derived from the target regardless of
   * direction, so `ClassOffering ||--o{ ClassSession` reported
   * `class_session_id`: a column named after the table it sits on, which is not
   * a foreign key name and is not what the model declares
   * (`class_offering_id`). `inspect` printed it verbatim, and
   * `generators/wasm/model-bundle.ts` had to carry a workaround that guesses
   * the parent-derived name first and treats this value as a fallback.
   *
   * A many-to-many has no such column at all; the target-derived name is kept
   * there as the least surprising placeholder.
   */
  private generateForeignKey(
    sourceEntity: string,
    targetEntity: string,
    cardinality: Relationship["cardinality"]
  ): string {
    const referenced = cardinality === "oneToMany" ? sourceEntity : targetEntity;
    const snakeName = this.toSnakeCase(referenced);
    // Remove bus_ prefix if present to match actual database schema
    const cleanName = snakeName.replace(/^bus_/, "");
    return `${cleanName}_id`;
  }
}

export default MermaidParser;
