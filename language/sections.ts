/**
 * `%%section` — how an entity's form is laid out.
 *
 *   %%section entity: Order; name: Delivery; help: Where the goods go.; rows: address | carrier, tracking_number
 *
 * One directive is one section of one entity: a heading, the sentence under it,
 * and rows of one or two columns (`|` between rows, `,` within one). Repeating
 * an entity and section name continues the section, so a long one can be
 * written over several lines; its help is read from the first.
 *
 * This is the only reading of the directive. The checker (`checker.ts`) and the
 * generator (`packages/generator/src/parsers/section.parser.ts`) both call it,
 * because a checker and a compiler that split a line differently is how a model
 * comes to check clean and lay out wrong. Pure — no `node:` imports — so the
 * browser bundles carry it too.
 */

/** One `%%section` line, as written. */
export interface SectionDirective {
  /** 1-based line in the source. */
  line: number;
  entity?: string;
  name?: string;
  help?: string;
  collapsed: boolean;
  /** `undefined` when the line carries no `rows:` key at all. */
  rows?: string[][];
  /** The required keys this line does not carry: entity, name, rows. */
  missing: string[];
}

/** A section of one entity, with every continuation line folded in. */
export interface FormSection {
  name: string;
  help?: string;
  collapsed: boolean;
  /** Rows in order; each holds one or two column names as written. */
  rows: string[][];
  /** The lines the section was declared on, first to last. */
  lines: number[];
}

const KEYS = new Set(["entity", "name", "help", "rows", "collapsed"]);
const REQUIRED = ["entity", "name", "rows"] as const;
const DIRECTIVE = /^\s*%%section\b\s*(.*)$/i;

/**
 * Split `a: 1; b: 2` into keys and values.
 *
 * A segment that does not open with a known key belongs to the value before it,
 * so help may contain a semicolon (`help: Price and terms; both are agreed
 * once.`) without the rest of the sentence becoming a key nobody declared.
 */
function parseKeys(body: string): Map<string, string> {
  const keys = new Map<string, string>();
  let last: string | undefined;
  for (const segment of body.split(";")) {
    const match = segment.match(/^\s*([A-Za-z]+)\s*:(.*)$/);
    const key = match?.[1]?.toLowerCase();
    if (match && key && KEYS.has(key)) {
      keys.set(key, (match[2] ?? "").trim());
      last = key;
    } else if (last && segment.trim()) {
      keys.set(last, `${keys.get(last) ?? ""}; ${segment.trim()}`.trim());
    }
  }
  return keys;
}

/** `a, b | c` → `[["a", "b"], ["c"]]`. Empty rows and empty names are dropped. */
export function parseRows(text: string): string[][] {
  return text
    .split("|")
    .map((row) =>
      row
        .split(",")
        .map((column) => column.trim())
        .filter(Boolean)
    )
    .filter((row) => row.length > 0);
}

/** The inverse of `parseRows`, in the spacing the language documents. */
export function formatRows(rows: string[][]): string {
  return rows.map((row) => row.join(", ")).join(" | ");
}

/** Every `%%section` line in a document, in order. */
export function parseSectionDirectives(source: string): SectionDirective[] {
  const found: SectionDirective[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  lines.forEach((text, index) => {
    const match = text.match(DIRECTIVE);
    if (!match) return;
    const keys = parseKeys(match[1] ?? "");
    const rowsText = keys.get("rows");
    found.push({
      line: index + 1,
      entity: keys.get("entity") || undefined,
      name: keys.get("name") || undefined,
      help: keys.get("help") || undefined,
      collapsed: /^(true|yes)$/i.test(keys.get("collapsed") ?? ""),
      rows: rowsText === undefined ? undefined : parseRows(rowsText),
      missing: REQUIRED.filter((key) => !keys.get(key)),
    });
  });
  return found;
}

/**
 * The sections of each entity, in declaration order, continuations merged.
 *
 * Lines missing a required key are skipped — the checker reports them (EML171)
 * and the generator has nothing it could place.
 */
export function sectionsByEntity(directives: SectionDirective[]): Map<string, FormSection[]> {
  const byEntity = new Map<string, FormSection[]>();
  for (const directive of directives) {
    if (directive.missing.length > 0 || !directive.entity || !directive.name) continue;
    const sections = byEntity.get(directive.entity) ?? [];
    const existing = sections.find(
      (section) => section.name.toLowerCase() === directive.name?.toLowerCase()
    );
    if (existing) {
      existing.rows.push(...(directive.rows ?? []));
      existing.lines.push(directive.line);
      if (!existing.help && directive.help) existing.help = directive.help;
      existing.collapsed = existing.collapsed || directive.collapsed;
    } else {
      sections.push({
        name: directive.name,
        help: directive.help,
        collapsed: directive.collapsed,
        rows: [...(directive.rows ?? [])],
        lines: [directive.line],
      });
    }
    byEntity.set(directive.entity, sections);
  }
  return byEntity;
}

/** A field's place on the form, as the dictionary stores it. */
export interface FieldPlacement {
  /** Index into the entity's sections. */
  section: number;
  /** 1-based row within the section. */
  row: number;
  /** 1 for the left column, 2 for the right. */
  column: 1 | 2;
  /** True when the field shares its row with the one before it. */
  sameLine: boolean;
  /** 2 when the field is alone on its row and spans both columns. */
  span: 1 | 2;
  /** Position over the whole form, for sys_field.seq_no. */
  order: number;
}

/**
 * Where each of an entity's columns goes, keyed by column name.
 *
 * Only the first placement of a column counts (a second is EML175), and only
 * the first two columns of a row (a third is EML174). Columns the entity does
 * not declare are kept out by the caller passing `declared`.
 */
export function placeFields(
  sections: FormSection[],
  declared?: Set<string>
): Map<string, FieldPlacement> {
  const placed = new Map<string, FieldPlacement>();
  let order = 0;
  sections.forEach((section, sectionIndex) => {
    let rowNo = 0;
    for (const raw of section.rows) {
      const row = raw.filter((column) => (!declared || declared.has(column)) && !placed.has(column));
      if (row.length === 0) continue;
      rowNo++;
      const pair = row.slice(0, 2);
      pair.forEach((column, position) => {
        placed.set(column, {
          section: sectionIndex,
          row: rowNo,
          column: position === 0 ? 1 : 2,
          sameLine: position === 1,
          span: pair.length === 1 ? 2 : 1,
          order: ++order,
        });
      });
      /* A third column is an error the checker reports; the generator still
         keeps it on the form, on a row of its own, rather than dropping it. */
      for (const column of row.slice(2)) {
        rowNo++;
        placed.set(column, {
          section: sectionIndex,
          row: rowNo,
          column: 1,
          sameLine: false,
          span: 2,
          order: ++order,
        });
      }
    }
  });
  return placed;
}

/** The name the generator gives the section holding columns no row placed. */
export const UNPLACED_SECTION = "Other";
