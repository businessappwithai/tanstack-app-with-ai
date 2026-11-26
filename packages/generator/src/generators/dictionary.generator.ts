/**
 * Dictionary Generator
 *
 * Generates Application Dictionary metadata for sys_ tables.
 * Creates sys_table, sys_column, sys_window, sys_tab, sys_field entries
 * for each business entity, plus sys_reference seed data.
 *
 * This is shared infrastructure used by both stack options.
 */

import {
  attributeToBusAttribute,
  type BusEntity,
  type BusEntityAttribute,
  type DictionaryGenerationConfig,
  declaredEntityNames,
  defaultDictionaryConfig,
  type Entity,
  entityToBusEntity,
  generateSysFieldGroups,
  generateSysFields,
  generateSysTab,
  generateSysTable,
  generateSysWindow,
  identifierColumnNames,
  ReferenceType,
  type Relationship,
  type SysColumn,
  type SysField,
  type SysFieldGroup,
  type SysTab,
  type SysTable,
  type SysWindow,
} from "@appwithai/core/types";
import { formLayoutFor } from "../parsers/section.parser";

export interface DictionaryGeneratorOptions {
  databaseType: "postgresql" | "mysql" | "sqlite";
  includeRbac: boolean;
  randomizeFieldOrder: boolean;
}

export interface DictionaryContext {
  entities: BusEntity[];
  busAttributes: Map<string, BusEntityAttribute[]>;
  sysTables: Array<
    Omit<SysTable, "sys_table_id" | "created_at" | "updated_at"> & { _tempId: string }
  >;
  sysColumns: Array<
    Omit<SysColumn, "sys_column_id" | "created_at" | "updated_at"> & {
      _tempId: string;
      _tableRef: string;
    }
  >;
  sysWindows: Array<
    Omit<SysWindow, "sys_window_id" | "created_at" | "updated_at"> & {
      _tempId: string;
      _tableRef: string;
    }
  >;
  sysTabs: Array<
    Omit<SysTab, "sys_tab_id" | "created_at" | "updated_at"> & {
      _tempId: string;
      _windowRef: string;
      _tableRef: string;
    }
  >;
  sysFields: Array<
    Omit<SysField, "sys_field_id" | "created_at" | "updated_at"> & {
      _tempId: string;
      _tabRef: string;
      _columnRef: string;
      /** The `%%section` group this field sits in, when the entity declares sections. */
      _groupRef?: string;
    }
  >;
  sysFieldGroups: Array<
    Omit<SysFieldGroup, "sys_field_group_id" | "created_at" | "updated_at"> & {
      _tempId: string;
      /** The tab a `%%section` group belongs to. Unset on the generic groups. */
      _tabRef?: string;
      /** Grid columns: 2 for every `%%section`. */
      columns?: number;
      seq_no?: number;
    }
  >;
  references: typeof ReferenceType;
  relationships: Relationship[];
}

/**
 * Generates complete Application Dictionary metadata for all entities.
 * Shared by every generator that needs Application Dictionary entries.
 */
export class DictionaryGenerator {
  private config: DictionaryGenerationConfig;

  constructor(options: DictionaryGeneratorOptions) {
    this.config = {
      ...defaultDictionaryConfig,
      randomizeFieldOrder: options.randomizeFieldOrder,
    };
  }

  /**
   * Generate complete dictionary context from entities and relationships
   */
  generateDictionaryContext(entities: Entity[], relationships: Relationship[]): DictionaryContext {
    const busEntities: BusEntity[] = [];
    const busAttributesMap = new Map<string, BusEntityAttribute[]>();
    const sysTables: DictionaryContext["sysTables"] = [];
    const sysColumns: DictionaryContext["sysColumns"] = [];
    const sysWindows: DictionaryContext["sysWindows"] = [];
    const sysTabs: DictionaryContext["sysTabs"] = [];
    const sysFields: DictionaryContext["sysFields"] = [];
    const sysFieldGroups: DictionaryContext["sysFieldGroups"] = [];

    let tableCounter = 0;
    let columnCounter = 0;
    let windowCounter = 0;
    let tabCounter = 0;
    let fieldCounter = 0;
    let fieldGroupCounter = 0;

    /** Window per top-level entity, so a child tab can find its parent's. */
    const windowByEntity = new Map<string, string>();
    /** Child tabs, re-pointed at the parent's window once all windows exist. */
    const childTabs: Array<{
      tab: { _windowRef: string; sys_window_id: string; link_column_id?: string; seq_no: number };
      table: { sys_window_id?: string };
      parentEntity: string;
      linkColumnRef?: string;
    }> = [];

    // Generate dictionary entries for each entity
    const declared = declaredEntityNames(entities);
    for (const entity of entities) {
      const busEntity = entityToBusEntity(entity, declared);
      busEntities.push(busEntity);

      // Generate bus_ attributes
      const busAttrs = entity.attributes.map((attr, index) => attributeToBusAttribute(attr, index));
      busAttributesMap.set(busEntity.tableName, busAttrs);

      // Generate sys_table entry
      const tableId = `table_${++tableCounter}`;
      const sysTable = {
        ...generateSysTable(busEntity, this.config),
        _tempId: tableId,
      };
      sysTables.push(sysTable);

      // Generate sys_column entries. Which columns identify a record is the
      // dictionary's own question, answered once for the whole table.
      const identifiers = new Set(identifierColumnNames(busAttrs, entity.primaryKey, entity.name));
      const columnEntries = busAttrs.map((attr, _index) => {
        const colId = `col_${++columnCounter}`;
        return {
          sys_table_id: tableId,
          column_name: attr.columnName,
          name: attr.displayName,
          /* `%%field <E>.<c> help:` — the modeller's sentence about the
             column, shown under the control in the generated form and beside
             the column in the Application Dictionary. */
          description: attr.description,
          sys_reference_id: attr.referenceId,
          sys_val_rule_id: undefined,
          field_length: attr.maxLength,
          default_value: attr.default?.toString(),
          value_min: undefined,
          value_max: undefined,
          is_key: attr.name === entity.primaryKey,
          is_parent: false,
          is_mandatory: attr.required,
          is_updateable: attr.name !== entity.primaryKey,
          is_identifier: identifiers.has(attr.name),
          is_selection_column:
            ["name", "email", "title", "description", "status"].includes(attr.name) ||
            attr.unique === true,
          is_translated: false,
          is_encrypted: false,
          is_allow_logging: true,
          is_allow_copy: attr.name !== entity.primaryKey,
          seq_no: attr.seqNo,
          callout: undefined,
          /* `%%field <E>.<c> readonly: | mandatory:` — Compiere's column
             logic, inherited by every window over this table. */
          read_only_logic: attr.readOnlyLogic,
          mandatory_logic: attr.mandatoryLogic,
          format_pattern: undefined,
          entity_type: this.config.defaultEntityType,
          is_active: true,
          created_by: this.config.createdBy,
          updated_by: this.config.createdBy,
          _tempId: colId,
          _tableRef: tableId,
        };
      });
      sysColumns.push(...columnEntries);

      /*
       * A line item gets no window of its own.
       *
       * `%%entity InvoiceLine parent: Invoice` says the child has no life away
       * from its parent, and the dictionary is where that stops being a comment
       * and starts being the application: no window means no card on the
       * dashboard and nothing to navigate to, and the tab created below is
       * attached to the *parent's* window instead — which is what puts the
       * lines under the invoice you opened.
       *
       * The parent's window may not exist yet (entities arrive in declaration
       * order), so the tab is created now with its own id and re-pointed once
       * every window is known.
       */
      const isChild = !!entity.parentEntity;
      const windowId = `win_${++windowCounter}`;
      if (!isChild) {
        sysWindows.push({
          ...generateSysWindow(busEntity, this.config),
          _tempId: windowId,
          _tableRef: tableId,
        });
      }

      // Generate sys_tab
      const tabId = `tab_${++tabCounter}`;
      const sysTab = {
        ...generateSysTab(windowId, tableId, busEntity, isChild ? 1 : 0, this.config),
        _tempId: tabId,
        _windowRef: windowId,
        _tableRef: tableId,
      };
      sysTabs.push(sysTab);

      if (isChild) {
        const link = columnEntries.find((col) => col.column_name === entity.parentLinkColumn);
        // Compiere's own marking: the column that ties a detail row to its
        // master is `is_parent`, and the tab links on it.
        if (link) link.is_parent = true;
        childTabs.push({
          tab: sysTab,
          table: sysTable,
          parentEntity: entity.parentEntity as string,
          linkColumnRef: link?._tempId,
        });
      } else {
        windowByEntity.set(entity.name, windowId);
      }

      // Generate sys_field_group entries
      const groups = generateSysFieldGroups(busEntity.displayName, this.config);
      const groupEntries = groups.map((group) => ({
        ...group,
        _tempId: `fg_${++fieldGroupCounter}`,
      }));
      sysFieldGroups.push(...groupEntries);

      // Generate sys_field entries
      const columnRefs = columnEntries.map((col) => ({
        sys_column_id: col._tempId,
        column_name: col.column_name,
        name: col.name,
        description: col.description,
      }));
      const fields = generateSysFields(tabId, columnRefs, this.config);
      const fieldEntries: DictionaryContext["sysFields"] = fields.map((field, idx) => ({
        ...field,
        _tempId: `field_${++fieldCounter}`,
        _tabRef: tabId,
        _columnRef: columnEntries[idx]?._tempId ?? "",
        /* Field logic: display belongs to the field alone; read-only and
           mandatory are the column's, repeated on the field so this window
           states what it does without a join (see fieldLogic.columnAndField). */
        display_logic: busAttrs[idx]?.displayLogic,
        read_only_logic: busAttrs[idx]?.readOnlyLogic,
        mandatory_logic: busAttrs[idx]?.mandatoryLogic,
      }));

      /*
       * `%%section` — the model's own form layout. One group per section on
       * this tab, and each field placed in its row: the order on the form, the
       * column it sits in, whether it shares the row, and whether it spans it.
       * The key stays outside every group, as it is outside every form.
       */
      const layout = formLayoutFor(entity);
      if (layout) {
        const groupIds = new Map<string, string>();
        for (const group of layout.groups) {
          const groupId = `fg_${++fieldGroupCounter}`;
          groupIds.set(group.name, groupId);
          sysFieldGroups.push({
            name: group.name,
            description: group.description,
            field_group_type: "C",
            is_collapsed_by_default: group.collapsed,
            entity_type: this.config.defaultEntityType,
            is_active: true,
            created_by: this.config.createdBy,
            updated_by: this.config.createdBy,
            _tempId: groupId,
            _tabRef: tabId,
            columns: group.columns,
            seq_no: group.seqNo,
          });
        }
        const keyed = new Map(busAttrs.map((attr, idx) => [attr.columnName, fieldEntries[idx]]));
        for (const [column, place] of layout.fields) {
          const field = keyed.get(column);
          if (!field) continue;
          field._groupRef = groupIds.get(place.group);
          field.seq_no = place.seqNo;
          field.is_same_line = place.sameLine;
          field.column_span = place.columnSpan;
        }
        /* The key is on no form; ordering it first keeps it out of the way of
           the first section's opening field rather than sharing its seq_no. */
        const key = keyed.get(entity.primaryKey);
        if (key) key.seq_no = 0;
      }
      sysFields.push(...fieldEntries);
    }

    /*
     * Re-point each child tab at its parent's window, now that every window is
     * known. A child whose parent has no window of its own — a line item of a
     * line item, or a parent that does not exist — keeps the window it was
     * given rather than being dropped: an orphaned tab is visible and fixable,
     * where a silently discarded entity is neither.
     */
    let childSeq = 20;
    for (const child of childTabs) {
      const parentWindow = windowByEntity.get(child.parentEntity);
      if (!parentWindow) continue;
      child.tab._windowRef = parentWindow;
      child.tab.sys_window_id = parentWindow;
      child.tab.seq_no = childSeq;
      childSeq += 10;
      if (child.linkColumnRef) child.tab.link_column_id = child.linkColumnRef;
      // The table points at the window its records are actually reached through.
      child.table.sys_window_id = parentWindow;
    }

    return {
      entities: busEntities,
      busAttributes: busAttributesMap,
      sysTables,
      sysColumns,
      sysWindows,
      sysTabs,
      sysFields,
      sysFieldGroups,
      references: ReferenceType,
      relationships,
    };
  }

  /**
   * Get standard system table names for sys_ tables
   */
  getSystemTableNames(): string[] {
    return [
      "sys_table",
      "sys_column",
      "sys_window",
      "sys_tab",
      "sys_field",
      "sys_field_group",
      "sys_reference",
      "sys_ref_list",
      "sys_ref_table",
      "sys_val_rule",
      "sys_user",
      "sys_role",
      "sys_user_roles",
      "sys_access",
    ];
  }

  /**
   * Get standard reference types for seeding
   */
  getStandardReferences(): Array<{ id: number; name: string; description: string }> {
    return [
      { id: ReferenceType.STRING, name: "String", description: "String/Varchar field" },
      { id: ReferenceType.INTEGER, name: "Integer", description: "Integer number" },
      { id: ReferenceType.AMOUNT, name: "Amount", description: "Decimal/Amount" },
      { id: ReferenceType.ID, name: "ID", description: "Identifier (UUID)" },
      { id: ReferenceType.TEXT, name: "Text", description: "Long text/memo" },
      { id: ReferenceType.DATE, name: "Date", description: "Date only" },
      { id: ReferenceType.DATETIME, name: "DateTime", description: "Date and time" },
      { id: ReferenceType.LIST, name: "List", description: "Dropdown list" },
      { id: ReferenceType.TABLE, name: "Table", description: "Table reference" },
      {
        id: ReferenceType.TABLE_DIRECT,
        name: "Table Direct",
        description: "Direct table reference",
      },
      { id: ReferenceType.YES_NO, name: "Yes-No", description: "Boolean (Yes/No)" },
      { id: ReferenceType.LOCATION, name: "Location", description: "Location/Address" },
      { id: ReferenceType.LOCATOR, name: "Locator", description: "Warehouse locator" },
      { id: ReferenceType.ACCOUNT, name: "Account", description: "Account reference" },
      { id: ReferenceType.URL, name: "URL", description: "URL/Web address" },
      { id: ReferenceType.IMAGE, name: "Image", description: "Image file" },
      { id: ReferenceType.FILE, name: "File", description: "File attachment" },
      { id: ReferenceType.COLOR, name: "Color", description: "Color picker" },
      { id: ReferenceType.JSON, name: "JSON", description: "JSON data" },
      { id: ReferenceType.PASSWORD, name: "Password", description: "Masked password" },
      { id: ReferenceType.EMAIL, name: "Email", description: "Email address" },
      { id: ReferenceType.PHONE, name: "Phone", description: "Phone number" },
    ];
  }
}
