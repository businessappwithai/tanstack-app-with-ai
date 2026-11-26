/**
 * `%%section` — the form's layout, read for the generator.
 *
 * The reading of the directive is `language/sections.ts`, the same module the
 * checker uses, so a model the checker accepts lays out exactly as it was
 * checked. This file only attaches the sections to their entities and turns
 * them into what both stacks' dictionaries store:
 *
 *   section             → sys_field_group (columns = 2, description = help)
 *   the right of a pair → sys_field.is_same_line = true (it sits beside the left)
 *   a row of one        → sys_field.column_span = 2 (the full width)
 *   order on the form   → sys_field.seq_no, section by section, row by row
 *
 * An entity with no sections gets no layout, and is generated as it always was:
 * one flat list in declared order. A column no row places goes into a trailing
 * collapsed `Other` section (the checker reports it as EML172), so a sectioned
 * form never drops a field.
 */

import type { Entity, EntityFormSection } from "@appwithai/core/types";
import {
  parseSectionDirectives,
  placeFields,
  sectionsByEntity,
  UNPLACED_SECTION,
} from "../../../../language/sections";

/** Attach every entity's `%%section` declarations to it, in place. */
export function attachFormSections(source: string, entities: Entity[]): void {
  const byEntity = sectionsByEntity(parseSectionDirectives(source));
  for (const entity of entities) {
    const sections = byEntity.get(entity.name);
    if (!sections || sections.length === 0) continue;
    entity.formSections = sections.map(
      (section): EntityFormSection => ({
        name: section.name,
        help: section.help,
        collapsed: section.collapsed,
        rows: section.rows.map((row) => [...row]),
      })
    );
  }
}

/** A section as a dictionary group. */
export interface LayoutGroup {
  name: string;
  description?: string;
  collapsed: boolean;
  /** sys_field_group.seq_no — declaration order, in tens. */
  seqNo: number;
  /** Always 2: the form is a two-column grid. */
  columns: 2;
}

/** Where one field sits on the form. */
export interface LayoutField {
  group: string;
  seqNo: number;
  sameLine: boolean;
  columnSpan: 1 | 2;
}

/** An entity's form, ready for a dictionary seed. */
export interface EntityFormLayout {
  groups: LayoutGroup[];
  /** Keyed by attribute name (which is also the column name). */
  fields: Map<string, LayoutField>;
}

/**
 * The layout of an entity's form, or `undefined` when it declares no sections.
 *
 * `fields` covers every attribute but the primary key. The key is left out on
 * purpose: no form shows it, and both stacks already hide it.
 */
export function formLayoutFor(entity: Entity): EntityFormLayout | undefined {
  const sections = entity.formSections;
  if (!sections || sections.length === 0) return undefined;

  const columns = entity.attributes
    .map((attribute) => attribute.name)
    .filter((name) => name !== entity.primaryKey);
  const placements = placeFields(
    sections.map((section) => ({ ...section, lines: [] })),
    new Set(columns)
  );

  const groups: LayoutGroup[] = sections.map((section, index) => ({
    name: section.name,
    description: section.help,
    collapsed: section.collapsed,
    seqNo: (index + 1) * 10,
    columns: 2,
  }));

  const fields = new Map<string, LayoutField>();
  let order = 0;
  const ordered = [...placements.entries()].sort((a, b) => a[1].order - b[1].order);
  for (const [column, placement] of ordered) {
    order = placement.order;
    fields.set(column, {
      group: groups[placement.section]?.name ?? UNPLACED_SECTION,
      seqNo: placement.order * 10,
      sameLine: placement.sameLine,
      columnSpan: placement.span,
    });
  }

  /* Columns no row placed: a trailing collapsed section, two per row, so the
     field is still on the form and the checker's EML172 names it. */
  const unplaced = columns.filter((column) => !fields.has(column));
  if (unplaced.length > 0) {
    let name = UNPLACED_SECTION;
    while (groups.some((group) => group.name.toLowerCase() === name.toLowerCase())) name += " fields";
    groups.push({
      name,
      description: "Fields the model did not place in a section.",
      collapsed: true,
      seqNo: (groups.length + 1) * 10,
      columns: 2,
    });
    unplaced.forEach((column, index) => {
      const right = index % 2 === 1;
      const alone = !right && index === unplaced.length - 1;
      fields.set(column, {
        group: name,
        seqNo: (++order) * 10,
        sameLine: right,
        columnSpan: alone ? 2 : 1,
      });
    });
  }

  return { groups, fields };
}
