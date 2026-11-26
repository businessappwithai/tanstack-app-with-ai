import type { FieldMetadata } from "@/hooks/use-entities";

function field(
  column_name: string,
  name: string,
  sys_reference_id: number,
  opts: Partial<FieldMetadata> = {}
): FieldMetadata {
  return {
    sys_field_id: `ad-${column_name}`,
    column_name,
    name,
    sys_reference_id,
    is_mandatory: false,
    is_displayed: true,
    is_displayed_grid: true,
    is_read_only: false,
    seq_no: 0,
    seq_no_grid: 0,
    ...opts,
  };
}

const REF = {
  STRING: 10,
  INTEGER: 11,
  AMOUNT: 12,
  ID: 13,
  TEXT: 14,
  DATE: 15,
  DATETIME: 16,
  LIST: 17,
  TABLE: 18,
  TABLE_DIRECT: 19,
  YES_NO: 20,
  URL: 24,
};

// Extra opts to turn any field into a sys_reference dropdown selector
const SYS_REF_LOOKUP: Partial<FieldMetadata> = {
  ref_endpoint: "/sys/references",
  ref_id_field: "sys_reference_id",
  ref_label_field: "name",
};

// Static option lists for fixed enums
const WINDOW_TYPE_OPTIONS = [
  { value: "M", label: "Maintain" },
  { value: "T", label: "Transaction" },
  { value: "Q", label: "Query" },
];

const ACCESS_LEVEL_OPTIONS = [
  { value: "M", label: "Maintain" },
  { value: "T", label: "Transaction" },
  { value: "Q", label: "Query" },
  { value: "A", label: "Admin Only" },
];

const ENTITY_TYPE_OPTIONS = [
  { value: "D", label: "Dictionary" },
  { value: "S", label: "System" },
  { value: "U", label: "User" },
  { value: "C", label: "Custom" },
];

// AD_Field.ObscureType in iDempiere: how much of a value the field shows.
const OBSCURE_TYPE_OPTIONS = [
  { value: "904", label: "Obscure Digits but last 4" },
  { value: "944", label: "Obscure Digits but first/last 4" },
  { value: "A04", label: "Obscure AlphaNumeric but last 4" },
  { value: "A44", label: "Obscure AlphaNumeric but first/last 4" },
];

/*
 * Compiere's logic syntax, said once and shown under each of the three logic
 * fields (and the column's two). The server refuses an expression that does
 * not parse, with the reason, so this is the grammar the save is held to.
 */
const LOGIC_SYNTAX =
  "@column@=value, @column@!value (not equal), @column@>n, <, >=, <= — joined by & (and) and " +
  "| (or), read left to right with no parentheses. Yes/No is Y or N; empty is ''. " +
  "Example: @IsSOTrx@=Y & @DocStatus@!DR";

const VALIDATION_TYPE_OPTIONS = [
  { value: "S", label: "Simple (no validation)" },
  { value: "L", label: "List (sys_ref_list items)" },
  { value: "T", label: "Table (reference to a table)" },
];

// ============================================================================
// sys_table
// ============================================================================

export const SYS_TABLE_FORM_FIELDS: FieldMetadata[] = [
  field("table_name", "DB Table Name", REF.STRING, {
    is_mandatory: true,
    seq_no: 10,
    field_length: 100,
    is_read_only: true,
  }),
  field("name", "Name", REF.STRING, { is_mandatory: true, seq_no: 20, field_length: 100 }),
  field("description", "Description", REF.TEXT, { seq_no: 30 }),
  field("icon", "Icon", REF.STRING, { seq_no: 40, field_length: 100 }),
  field("access_level", "Access Level", REF.LIST, { seq_no: 50, options: ACCESS_LEVEL_OPTIONS }),
  field("is_active", "Active", REF.YES_NO, { seq_no: 60 }),
  field("is_view", "View", REF.YES_NO, { seq_no: 70 }),
  field("is_document", "Document", REF.YES_NO, { seq_no: 80 }),
  field("is_high_volume", "High Volume", REF.YES_NO, { seq_no: 90 }),
  field("is_changelog", "Maintain Change Log", REF.YES_NO, { seq_no: 100 }),
  field("entity_type", "Entity Type", REF.LIST, {
    seq_no: 110,
    options: ENTITY_TYPE_OPTIONS,
    is_read_only: true,
  }),
];

export const SYS_TABLE_GRID_FIELDS: FieldMetadata[] = [
  field("table_name", "DB Table Name", REF.STRING, { seq_no_grid: 10 }),
  field("name", "Name", REF.STRING, { seq_no_grid: 20 }),
  field("description", "Description", REF.STRING, { seq_no_grid: 30 }),
  field("is_active", "Active", REF.YES_NO, { seq_no_grid: 40 }),
];

// ============================================================================
// sys_column
// ============================================================================

export const SYS_COLUMN_FORM_FIELDS: FieldMetadata[] = [
  field("column_name", "DB Column Name", REF.STRING, {
    is_mandatory: true,
    seq_no: 10,
    field_length: 100,
    is_read_only: true,
  }),
  field("name", "Name", REF.STRING, { is_mandatory: true, seq_no: 20, field_length: 100 }),
  field("description", "Description", REF.TEXT, { seq_no: 30 }),
  field("sys_reference_id", "Reference Type", REF.TABLE, {
    is_mandatory: true,
    seq_no: 40,
    is_read_only: true,
    ...SYS_REF_LOOKUP,
  }),
  field("field_length", "Length", REF.INTEGER, { seq_no: 50 }),
  field("default_value", "Default Value", REF.STRING, { seq_no: 60, field_length: 255 }),
  field("is_key", "Key", REF.YES_NO, { seq_no: 70 }),
  field("is_parent", "Parent Link", REF.YES_NO, { seq_no: 80 }),
  field("is_mandatory", "Mandatory", REF.YES_NO, { seq_no: 90 }),
  field("is_updateable", "Updateable", REF.YES_NO, { seq_no: 100 }),
  field("is_identifier", "Identifier", REF.YES_NO, { seq_no: 110 }),
  field("is_selection_column", "Selection Column", REF.YES_NO, { seq_no: 120 }),
  field("is_encrypted", "Encrypted", REF.YES_NO, { seq_no: 130 }),
  field("seq_no", "Sequence", REF.INTEGER, { seq_no: 140 }),
  // Column logic — inherited by every field over this column, unless the
  // field carries its own.
  field("read_only_logic", "Read Only Logic", REF.TEXT, {
    seq_no: 142,
    help: `The column cannot be changed while this is true. ${LOGIC_SYNTAX}`,
  }),
  field("mandatory_logic", "Mandatory Logic", REF.TEXT, {
    seq_no: 144,
    help: `The column must have a value while this is true. ${LOGIC_SYNTAX}`,
  }),
  field("is_active", "Active", REF.YES_NO, { seq_no: 150 }),
];

export const SYS_COLUMN_GRID_FIELDS: FieldMetadata[] = [
  field("column_name", "DB Column Name", REF.STRING, { seq_no_grid: 10 }),
  field("name", "Name", REF.STRING, { seq_no_grid: 20 }),
  field("sys_reference_id", "Reference Type", REF.TABLE, { seq_no_grid: 30, ...SYS_REF_LOOKUP }),
  field("is_mandatory", "Mandatory", REF.YES_NO, { seq_no_grid: 40 }),
  field("is_key", "Key", REF.YES_NO, { seq_no_grid: 50 }),
  field("is_active", "Active", REF.YES_NO, { seq_no_grid: 60 }),
];

// ============================================================================
// sys_window
// ============================================================================

export const SYS_WINDOW_FORM_FIELDS: FieldMetadata[] = [
  field("name", "Name", REF.STRING, { is_mandatory: true, seq_no: 10, field_length: 100 }),
  field("description", "Description", REF.TEXT, { seq_no: 20 }),
  field("help", "Help", REF.TEXT, { seq_no: 30 }),
  field("window_type", "Window Type", REF.LIST, { seq_no: 40, options: WINDOW_TYPE_OPTIONS }),
  field("is_sales_transaction", "Sales Transaction", REF.YES_NO, { seq_no: 50 }),
  field("is_default", "Default", REF.YES_NO, { seq_no: 60 }),
  // Which rows every list for this window shows, and in what order. Neither
  // holds SQL — see backend/src/modules/bus/window-list-defaults.ts for the two
  // grammars, both parsed against the entity's own columns before a query is
  // built. Left empty, a list is unfiltered and ordered `updated_at DESC`.
  field("where_clause", "Filter", REF.STRING, {
    seq_no: 62,
    field_length: 500,
    description: "column=operator:value, comma-separated. e.g. status=equals:active",
  }),
  field("order_by_clause", "Order By", REF.STRING, {
    seq_no: 64,
    field_length: 255,
    description: "column ASC|DESC, comma-separated. Defaults to updated_at DESC",
  }),
  field("is_active", "Active", REF.YES_NO, { seq_no: 70 }),
  field("entity_type", "Entity Type", REF.LIST, {
    seq_no: 80,
    options: ENTITY_TYPE_OPTIONS,
    is_read_only: true,
  }),
];

export const SYS_WINDOW_GRID_FIELDS: FieldMetadata[] = [
  field("name", "Name", REF.STRING, { seq_no_grid: 10 }),
  field("description", "Description", REF.STRING, { seq_no_grid: 20 }),
  field("window_type", "Type", REF.STRING, { seq_no_grid: 30 }),
  field("order_by_clause", "Order By", REF.STRING, { seq_no_grid: 35 }),
  field("is_active", "Active", REF.YES_NO, { seq_no_grid: 40 }),
];

// ============================================================================
// sys_tab
// ============================================================================

export const SYS_TAB_FORM_FIELDS: FieldMetadata[] = [
  field("name", "Name", REF.STRING, { is_mandatory: true, seq_no: 10, field_length: 100 }),
  field("sys_table_id", "Table", REF.TABLE, {
    is_mandatory: true,
    seq_no: 15,
    ref_endpoint: "/sys/tables",
    ref_id_field: "sys_table_id",
    ref_label_field: "name",
  }),
  field("description", "Description", REF.TEXT, { seq_no: 20 }),
  field("help", "Help", REF.TEXT, { seq_no: 30 }),
  field("tab_level", "Tab Level", REF.INTEGER, { seq_no: 40 }),
  field("seq_no", "Sequence", REF.INTEGER, { seq_no: 50 }),
  field("is_single_row", "Single Row", REF.YES_NO, { seq_no: 60 }),
  field("is_translation_tab", "Translation Tab", REF.YES_NO, { seq_no: 70 }),
  field("is_read_only", "Read Only", REF.YES_NO, { seq_no: 80 }),
  field("is_insert_record", "Insert Record", REF.YES_NO, { seq_no: 90 }),
  field("is_advanced_tab", "Advanced Tab", REF.YES_NO, { seq_no: 100 }),
  field("order_by_clause", "Order By", REF.STRING, { seq_no: 110, field_length: 255 }),
  field("where_clause", "Where Clause", REF.TEXT, { seq_no: 120 }),
  field("is_active", "Active", REF.YES_NO, { seq_no: 130 }),
];

export const SYS_TAB_GRID_FIELDS: FieldMetadata[] = [
  field("name", "Name", REF.STRING, { seq_no_grid: 10 }),
  field("sys_table_id", "Table", REF.TABLE, {
    seq_no_grid: 15,
    ref_endpoint: "/sys/tables",
    ref_id_field: "sys_table_id",
    ref_label_field: "name",
  }),
  field("tab_level", "Level", REF.INTEGER, { seq_no_grid: 20 }),
  field("seq_no", "Sequence", REF.INTEGER, { seq_no_grid: 30 }),
  field("is_read_only", "Read Only", REF.YES_NO, { seq_no_grid: 40 }),
  field("is_active", "Active", REF.YES_NO, { seq_no_grid: 50 }),
];

// ============================================================================
// sys_field
// ============================================================================

export const SYS_FIELD_FORM_FIELDS: FieldMetadata[] = [
  // Core — what the field is, and which column it shows.
  field("sys_column_id", "Column", REF.TABLE, {
    is_mandatory: true,
    seq_no: 5,
    ref_endpoint: "/sys/columns",
    ref_id_field: "sys_column_id",
    ref_label_field: "name",
    ref_filter_param: "tableId",
    ref_filter_source: "sys_table_id",
    help: "The column of this tab's table the field shows. One field per column per tab.",
  }),
  field("name", "Name", REF.STRING, { is_mandatory: true, seq_no: 10, field_length: 100 }),
  field("description", "Description", REF.TEXT, {
    seq_no: 20,
    help: "A short line shown under the field on the form, and as the tooltip of its list heading. Empty: the column's description.",
  }),
  field("help", "Help", REF.TEXT, {
    seq_no: 30,
    help: "Shown behind the ? beside the field on the form.",
  }),
  field("sys_field_group_id", "Field Group", REF.TABLE, {
    seq_no: 32,
    ref_endpoint: "/sys/field-groups",
    ref_id_field: "sys_field_group_id",
    ref_label_field: "name",
    ref_filter_param: "tabId",
    ref_filter_source: "sys_tab_id",
    help: "The section of the form the field sits in. Only this tab's groups are offered.",
  }),
  field("sys_reference_id", "Reference Type Override", REF.TABLE, {
    seq_no: 35,
    ...SYS_REF_LOOKUP,
    help: "Draws the field as another reference type than its column's. Leave empty to use the column's.",
  }),
  field("included_tab_id", "Included Tab", REF.TABLE, {
    seq_no: 37,
    ref_endpoint: "/sys/tabs",
    ref_id_field: "sys_tab_id",
    ref_label_field: "name",
    ref_filter_param: "windowId",
    ref_filter_source: "sys_window_id",
    help: "Another tab of this window drawn inside the form at this field's place: its rows for the record being shown, listed. Rows link by the tab's link column, else by the column naming this table.",
  }),
  // Sequence / layout
  // Sequence, Same Line and Column Span are the whole of a form's layout: there
  // is no X or Y position.
  field("seq_no", "Sequence", REF.INTEGER, {
    seq_no: 40,
    help: "The field's place in the form's order, lowest first.",
  }),
  field("seq_no_grid", "Grid Sequence", REF.INTEGER, {
    seq_no: 50,
    help: "The column's place in the list, lowest first.",
  }),
  field("display_length", "Display Length", REF.INTEGER, {
    seq_no: 60,
    help: "How many characters wide the input and the list column are. Empty: as wide as the space.",
  }),
  field("column_span", "Column Span", REF.INTEGER, {
    seq_no: 70,
    help: "How many of its section's columns the field takes. 2 in a two-column section is the full width.",
  }),
  field("num_lines", "Num Lines", REF.INTEGER, {
    seq_no: 77,
    help: "A text field with more than one line is drawn as a box that many lines tall.",
  }),
  // Display flags
  field("is_displayed", "Displayed", REF.YES_NO, {
    seq_no: 80,
    help: "Whether the field is on the form at all.",
  }),
  field("is_displayed_grid", "Displayed in Grid", REF.YES_NO, {
    seq_no: 90,
    help: "Whether the field is a column of the list.",
  }),
  field("is_read_only", "Read Only", REF.YES_NO, {
    seq_no: 100,
    help: "Filled in when a record is created, never changed afterwards. The API refuses a change.",
  }),
  field("is_same_line", "Same Line", REF.YES_NO, {
    seq_no: 110,
    help: "Sits beside the field before it. Off, the field starts a new row of its section.",
  }),
  field("is_heading", "Heading", REF.YES_NO, {
    seq_no: 120,
    help: "Drawn as a heading across its section, with no input.",
  }),
  field("is_field_only", "Field Only (no label)", REF.YES_NO, {
    seq_no: 125,
    help: "The input is drawn with no label beside it.",
  }),
  field("is_encrypted", "Encrypted", REF.YES_NO, {
    seq_no: 126,
    help: "Typed into a password input and masked wherever it is shown — on the form and in the list.",
  }),
  // Defaults
  field("default_value", "Default Value", REF.STRING, {
    seq_no: 130,
    field_length: 255,
    help: "What a new record starts with: a value, Y or N for a checkbox, or @#Date@ for today. Overrides the column's.",
  }),
  field("sort_no", "Sort Number", REF.INTEGER, {
    seq_no: 140,
    help: "Orders the list by this field when nothing else does: the smallest number first, negative for descending.",
  }),
  field("obscure_type", "Obscure Type", REF.LIST, {
    seq_no: 145,
    options: OBSCURE_TYPE_OPTIONS,
    help: "Masks the value on screen, as iDempiere's AD_Field.ObscureType does.",
  }),
  // Conditional logic — Compiere's three, evaluated as the record is edited
  // and enforced by the API on save.
  field("display_logic", "Display Logic", REF.TEXT, {
    seq_no: 150,
    help: `The field is on the form only while this is true. ${LOGIC_SYNTAX}`,
  }),
  field("read_only_logic", "Read Only Logic", REF.TEXT, {
    seq_no: 160,
    help: `The field cannot be changed while this is true. Overrides the column's. ${LOGIC_SYNTAX}`,
  }),
  field("mandatory_logic", "Mandatory Logic", REF.TEXT, {
    seq_no: 170,
    help: `The field must have a value while this is true and the field is shown. Overrides the column's. ${LOGIC_SYNTAX}`,
  }),
  field("entity_type", "Entity Type", REF.LIST, {
    seq_no: 175,
    options: ENTITY_TYPE_OPTIONS,
    is_read_only: true,
    help: "Who owns this definition — the dictionary or this installation. Recorded; nothing on screen depends on it.",
  }),
  // Active
  field("is_active", "Active", REF.YES_NO, {
    seq_no: 180,
    help: "An inactive field is on no form and in no list. Its column keeps its data.",
  }),
];

export const SYS_FIELD_GRID_FIELDS: FieldMetadata[] = [
  field("name", "Name", REF.STRING, { seq_no_grid: 10 }),
  field("column_name", "DB Column", REF.STRING, { seq_no_grid: 15 }),
  field("seq_no", "Sequence", REF.INTEGER, { seq_no_grid: 20 }),
  field("is_displayed", "Displayed", REF.YES_NO, { seq_no_grid: 30 }),
  field("is_read_only", "Read Only", REF.YES_NO, { seq_no_grid: 40 }),
  field("is_active", "Active", REF.YES_NO, { seq_no_grid: 50 }),
];

// ============================================================================
// sys_reference
// ============================================================================

export const SYS_REFERENCE_FORM_FIELDS: FieldMetadata[] = [
  field("sys_reference_id", "Reference ID", REF.INTEGER, { seq_no: 10, is_read_only: true }),
  field("name", "Name", REF.STRING, { is_mandatory: true, seq_no: 20, field_length: 100 }),
  field("description", "Description", REF.TEXT, { seq_no: 30 }),
  field("validation_type", "Validation Type", REF.LIST, {
    seq_no: 40,
    options: VALIDATION_TYPE_OPTIONS,
  }),
  field("vformat", "Value Format", REF.STRING, { seq_no: 50, field_length: 40 }),
  field("is_active", "Active", REF.YES_NO, { seq_no: 60 }),
  field("entity_type", "Entity Type", REF.LIST, { seq_no: 70, options: ENTITY_TYPE_OPTIONS }),
];

export const SYS_REFERENCE_GRID_FIELDS: FieldMetadata[] = [
  field("sys_reference_id", "ID", REF.INTEGER, { seq_no_grid: 10 }),
  field("name", "Name", REF.STRING, { seq_no_grid: 20 }),
  field("description", "Description", REF.STRING, { seq_no_grid: 30 }),
  field("validation_type", "Type", REF.STRING, { seq_no_grid: 40 }),
  field("is_active", "Active", REF.YES_NO, { seq_no_grid: 50 }),
];

// ============================================================================
// sys_element
// ============================================================================

export const SYS_ELEMENT_FORM_FIELDS: FieldMetadata[] = [
  field("column_name", "DB Column Name", REF.STRING, {
    is_mandatory: true,
    seq_no: 10,
    field_length: 100,
  }),
  field("name", "Name", REF.STRING, { is_mandatory: true, seq_no: 20, field_length: 100 }),
  field("print_name", "Print Name", REF.STRING, { seq_no: 30, field_length: 100 }),
  field("description", "Description", REF.TEXT, { seq_no: 40 }),
  field("help", "Help / Comment", REF.TEXT, { seq_no: 50 }),
  field("po_name", "PO Name", REF.STRING, { seq_no: 60, field_length: 100 }),
  field("po_print_name", "PO Print Name", REF.STRING, { seq_no: 70, field_length: 100 }),
  field("po_description", "PO Description", REF.TEXT, { seq_no: 80 }),
  field("is_active", "Active", REF.YES_NO, { seq_no: 90 }),
];

export const SYS_ELEMENT_GRID_FIELDS: FieldMetadata[] = [
  field("column_name", "DB Column Name", REF.STRING, { seq_no_grid: 10 }),
  field("name", "Name", REF.STRING, { seq_no_grid: 20 }),
  field("print_name", "Print Name", REF.STRING, { seq_no_grid: 30 }),
  field("description", "Description", REF.STRING, { seq_no_grid: 40 }),
  field("is_active", "Active", REF.YES_NO, { seq_no_grid: 50 }),
];
