/**
 * System Dictionary Types (sys_ prefix)
 * Compiere-style Application Dictionary for metadata-driven architecture
 *
 * These types define the Application Dictionary tables that control:
 * - Table and column metadata (sys_table, sys_column)
 * - UI window and tab structure (sys_window, sys_tab)
 * - Field layout and display (sys_field, sys_field_group)
 * - Reference types and validation (sys_reference, sys_val_rule)
 * - User and role management (sys_user, sys_role, sys_access)
 */

import { z } from "zod";

// ============================================================================
// Enums and Constants
// ============================================================================

export const SYS_TABLE_PREFIX = "sys_";
export const BUS_TABLE_PREFIX = "bus_";

export const AccessLevel = {
  SYSTEM: "S", // System only
  CLIENT: "C", // Client (tenant)
  ORGANIZATION: "O", // Organization within client
  CLIENT_ORG: "CO", // Client + Organization
  ALL: "A", // All levels
} as const;

export type AccessLevelType = (typeof AccessLevel)[keyof typeof AccessLevel];

export const WindowType = {
  MAINTAIN: "M", // Maintain (master data)
  TRANSACTION: "T", // Transaction (documents)
  QUERY: "Q", // Query only
} as const;

export type WindowTypeType = (typeof WindowType)[keyof typeof WindowType];

export const ValidationType = {
  SQL: "S", // SQL validation
  LIST: "L", // List validation
  TABLE: "T", // Table validation
  RANGE: "R", // Range validation
} as const;

export type ValidationTypeType = (typeof ValidationType)[keyof typeof ValidationType];

// Standard Reference Types (sys_reference_id values)
export const ReferenceType = {
  STRING: 10, // String/Varchar
  INTEGER: 11, // Integer
  AMOUNT: 12, // Decimal/Amount
  ID: 13, // ID (UUID or auto-increment)
  TEXT: 14, // Text/Memo (long text)
  DATE: 15, // Date only
  DATETIME: 16, // Date + Time
  LIST: 17, // List (dropdown)
  TABLE: 18, // Table reference (foreign key)
  TABLE_DIRECT: 19, // Direct table reference
  YES_NO: 20, // Boolean (Yes/No)
  LOCATION: 21, // Location/Address
  LOCATOR: 22, // Locator (warehouse)
  ACCOUNT: 23, // Account
  URL: 24, // URL
  IMAGE: 25, // Image
  FILE: 26, // File/Attachment
  COLOR: 27, // Color picker
  JSON: 28, // JSON data
  PASSWORD: 29, // Password (masked)
  EMAIL: 30, // Email address
  PHONE: 31, // Phone number
} as const;

export type ReferenceTypeType = (typeof ReferenceType)[keyof typeof ReferenceType];

// ============================================================================
// Core Interfaces - sys_ Tables
// ============================================================================

/**
 * sys_table - Table metadata
 * Defines all tables in the system (both sys_ and bus_ prefixed)
 */
export interface SysTable {
  sys_table_id: string;
  table_name: string; // Physical table name (e.g., 'bus_customer', 'sys_user')
  name: string; // Display name (e.g., 'Customer', 'User')
  description?: string;
  icon?: string; // Icon name (lucide-react) or emoji for UI
  access_level: AccessLevelType;
  is_view: boolean; // Is this a view?
  is_document: boolean; // Is this a document table?
  is_high_volume: boolean; // Large data volume expected?
  is_changelog: boolean; // Track changes?
  replication_type?: string; // Replication strategy
  sys_window_id?: string; // Default window for this table
  po_window_id?: string; // Purchase order window (if applicable)
  entity_type: string; // Entity type for extensibility
  is_active: boolean;
  created_by: string;
  updated_by: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * sys_column - Column metadata
 * Defines all columns for tables in the system
 */
export interface SysColumn {
  sys_column_id: string;
  sys_table_id: string; // FK to sys_table
  column_name: string; // Physical column name
  name: string; // Display name
  description?: string;
  sys_reference_id: number; // FK to sys_reference (data type)
  sys_val_rule_id?: string; // FK to sys_val_rule (validation)
  field_length?: number; // Max length for string fields
  default_value?: string; // Default value expression
  value_min?: string; // Minimum value
  value_max?: string; // Maximum value
  is_key: boolean; // Is primary key?
  is_parent: boolean; // Is parent link?
  is_mandatory: boolean; // Required field?
  is_updateable: boolean; // Can be updated after creation?
  is_identifier: boolean; // Part of record identifier?
  is_selection_column: boolean; // Show in search?
  is_translated: boolean; // Supports translation?
  is_encrypted: boolean; // Encrypted storage?
  is_allow_logging: boolean; // Log changes?
  is_allow_copy: boolean; // Allow copy value?
  seq_no: number; // Column order in table definition
  callout?: string; // Callout function name
  read_only_logic?: string; // Dynamic read-only condition
  mandatory_logic?: string; // Dynamic mandatory condition
  format_pattern?: string; // Display format pattern
  entity_type: string;
  is_active: boolean;
  created_by: string;
  updated_by: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * sys_window - Window metadata
 * Defines UI windows/screens for entity management
 */
export interface SysWindow {
  sys_window_id: string;
  name: string; // Window name
  description?: string;
  help?: string; // Help text
  window_type: WindowTypeType; // M=Maintain, T=Transaction, Q=Query
  is_sales_transaction: boolean; // Sales related?
  is_default: boolean; // Default window?
  entity_type: string;
  is_active: boolean;
  created_by: string;
  updated_by: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * sys_tab - Tab metadata
 * Defines tabs within windows (master-detail hierarchy)
 */
export interface SysTab {
  sys_tab_id: string;
  sys_window_id: string; // FK to sys_window
  sys_table_id: string; // FK to sys_table
  name: string; // Tab name
  description?: string;
  help?: string;
  tab_level: number; // 0=master, 1+=detail levels
  seq_no: number; // Tab order within window
  is_single_row: boolean; // Single record view?
  has_tree: boolean; // Show tree structure?
  is_info_tab: boolean; // Information only?
  is_translation_tab: boolean; // Translation tab?
  is_read_only: boolean; // Read-only tab?
  is_insert_record: boolean; // Allow insert?
  is_advanced_tab: boolean; // Advanced tab (hidden by default)?
  parent_column_id?: string; // FK to sys_column (parent link)
  link_column_id?: string; // FK to sys_column (detail link)
  order_by_clause?: string; // Default ordering
  where_clause?: string; // Filter condition
  display_logic?: string; // Show/hide condition
  read_only_logic?: string; // Dynamic read-only condition
  commit_warning?: string; // Warning before save
  entity_type: string;
  is_active: boolean;
  created_by: string;
  updated_by: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * sys_field_group - Field group metadata
 * Groups fields within a tab for organization
 */
export interface SysFieldGroup {
  sys_field_group_id: string;
  name: string; // Group name
  description?: string;
  field_group_type: "C" | "L" | "T"; // Collapsible, Label, Tab
  is_collapsed_by_default: boolean;
  entity_type: string;
  is_active: boolean;
  created_by: string;
  updated_by: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * sys_field - Field metadata
 * Defines field layout and behavior within tabs
 * CRITICAL: seq_no controls the field order in UI
 */
export interface SysField {
  sys_field_id: string;
  sys_tab_id: string; // FK to sys_tab
  sys_column_id: string; // FK to sys_column
  sys_field_group_id?: string; // FK to sys_field_group
  name: string; // Field label
  description?: string;
  help?: string; // Field help text

  // Layout properties - controlled at runtime by admin
  seq_no: number; // Field order in form (runtime modifiable!)
  seq_no_grid: number; // Column order in grid/table view
  display_length?: number; // Display width
  column_span?: number; // Columns to span
  num_lines?: number; // Lines for text areas

  // Display properties
  is_displayed: boolean; // Show in form?
  is_displayed_grid: boolean; // Show in grid/table?
  is_read_only: boolean; // Read-only field?
  is_encrypted: boolean; // Masked input?
  is_same_line: boolean; // Same line as previous?
  is_heading: boolean; // Section heading?
  is_field_only: boolean; // Field without label?

  // Dynamic logic
  display_logic?: string; // Show/hide condition
  read_only_logic?: string; // Dynamic read-only condition
  mandatory_logic?: string; // Dynamic mandatory condition
  obscure_type?: string; // Obscure type for sensitive data

  // Related components
  included_tab_id?: string; // FK for embedded tab
  default_value?: string; // Default value override
  sort_no?: number; // Sort order

  entity_type: string;
  is_active: boolean;
  created_by: string;
  updated_by: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * sys_reference - Reference/Data type metadata
 * Defines data types and reference lookups
 */
export interface SysReference {
  sys_reference_id: number; // Using number for standard types
  name: string; // Reference type name
  description?: string;
  validation_type: ValidationTypeType;
  vformat?: string; // Value format (e.g., phone format)
  entity_type: string;
  is_active: boolean;
  created_by: string;
  updated_by: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * sys_ref_list - Reference list values
 * Defines list values for LIST type references
 */
export interface SysRefList {
  sys_ref_list_id: string;
  sys_reference_id: number; // FK to sys_reference
  value: string; // Stored value
  name: string; // Display name
  description?: string;
  valid_from?: Date;
  valid_to?: Date;
  entity_type: string;
  is_active: boolean;
  created_by: string;
  updated_by: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * sys_ref_table - Reference table configuration
 * Defines how TABLE type references work
 */
export interface SysRefTable {
  sys_ref_table_id: string;
  sys_reference_id: number; // FK to sys_reference
  sys_table_id: string; // FK to sys_table (referenced table)
  key_column_id: string; // FK to sys_column (key column)
  display_column_id: string; // FK to sys_column (display column)
  is_value_displayed: boolean;
  order_by_clause?: string;
  where_clause?: string;
  entity_type: string;
  is_active: boolean;
  created_by: string;
  updated_by: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * sys_val_rule - Validation rule metadata
 * Defines validation rules for columns
 */
export interface SysValRule {
  sys_val_rule_id: string;
  name: string; // Rule name
  description?: string;
  type: ValidationTypeType; // S=SQL, L=List, T=Table
  code: string; // Validation code/expression
  error_msg?: string; // Error message
  entity_type: string;
  is_active: boolean;
  created_by: string;
  updated_by: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * sys_user - User account
 * System user for authentication and authorization
 */
export interface SysUser {
  sys_user_id: string;
  name: string; // Full name
  email: string; // Email address (unique)
  password_hash: string; // Hashed password
  description?: string;
  is_system_user: boolean; // System administrator?
  is_sales_rep: boolean; // Sales representative?
  login_date?: Date; // Last login
  login_failure_count: number; // Failed login attempts
  is_locked: boolean; // Account locked?
  is_account_verified: boolean; // Email verified?
  notification_type?: string; // Notification preference
  supervisor_id?: string; // FK to sys_user (supervisor)
  default_sys_role_id?: string; // FK to sys_role (default role)
  entity_type: string;
  is_active: boolean;
  created_by: string;
  updated_by: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * sys_role - Role definition
 * Defines roles for authorization
 */
export interface SysRole {
  sys_role_id: string;
  name: string; // Role name
  description?: string;
  user_level: string; // User level access
  is_master_role: boolean; // Master role?
  is_can_export: boolean; // Can export data?
  is_can_report: boolean; // Can run reports?
  is_personal_lock: boolean; // Personal record locking?
  is_personal_access: boolean; // Personal data access only?
  max_query_records: number; // Max query results
  connection_profile?: string;
  preference_type?: string;
  is_show_accounting: boolean;
  entity_type: string;
  is_active: boolean;
  created_by: string;
  updated_by: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * sys_user_roles - User-role assignment
 * Links users to roles
 */
export interface SysUserRoles {
  sys_user_roles_id: string;
  sys_user_id: string; // FK to sys_user
  sys_role_id: string; // FK to sys_role
  entity_type: string;
  is_active: boolean;
  created_by: string;
  updated_by: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * sys_access - Access control
 * Defines what windows/tables a role can access
 */
export interface SysAccess {
  sys_access_id: string;
  sys_role_id: string; // FK to sys_role
  sys_table_id?: string; // FK to sys_table (table access)
  sys_window_id?: string; // FK to sys_window (window access)
  access_type_table: "R" | "W" | "N"; // Read, Write, None (for tables)
  is_read_only: boolean; // Read-only access?
  is_exclude: boolean; // Exclude (deny) access?
  entity_type: string;
  is_active: boolean;
  created_by: string;
  updated_by: string;
  created_at: Date;
  updated_at: Date;
}

// ============================================================================
// Zod Schemas for Validation
// ============================================================================

export const SysTableSchema = z.object({
  sys_table_id: z.string().uuid(),
  table_name: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  icon: z.string().max(100).optional(),
  access_level: z.enum(["S", "C", "O", "CO", "A"]),
  is_view: z.boolean(),
  is_document: z.boolean(),
  is_high_volume: z.boolean(),
  is_changelog: z.boolean(),
  replication_type: z.string().optional(),
  sys_window_id: z.string().uuid().optional(),
  po_window_id: z.string().uuid().optional(),
  entity_type: z.string(),
  is_active: z.boolean(),
  created_by: z.string(),
  updated_by: z.string(),
  created_at: z.date(),
  updated_at: z.date(),
});

export const SysColumnSchema = z.object({
  sys_column_id: z.string().uuid(),
  sys_table_id: z.string().uuid(),
  column_name: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  sys_reference_id: z.number(),
  sys_val_rule_id: z.string().uuid().optional(),
  field_length: z.number().optional(),
  default_value: z.string().optional(),
  value_min: z.string().optional(),
  value_max: z.string().optional(),
  is_key: z.boolean(),
  is_parent: z.boolean(),
  is_mandatory: z.boolean(),
  is_updateable: z.boolean(),
  is_identifier: z.boolean(),
  is_selection_column: z.boolean(),
  is_translated: z.boolean(),
  is_encrypted: z.boolean(),
  is_allow_logging: z.boolean(),
  is_allow_copy: z.boolean(),
  seq_no: z.number(),
  callout: z.string().optional(),
  read_only_logic: z.string().optional(),
  mandatory_logic: z.string().optional(),
  format_pattern: z.string().optional(),
  entity_type: z.string(),
  is_active: z.boolean(),
  created_by: z.string(),
  updated_by: z.string(),
  created_at: z.date(),
  updated_at: z.date(),
});

export const SysFieldSchema = z.object({
  sys_field_id: z.string().uuid(),
  sys_tab_id: z.string().uuid(),
  sys_column_id: z.string().uuid(),
  sys_field_group_id: z.string().uuid().optional(),
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  help: z.string().optional(),
  seq_no: z.number(),
  seq_no_grid: z.number(),
  display_length: z.number().optional(),
  column_span: z.number().optional(),
  num_lines: z.number().optional(),
  is_displayed: z.boolean(),
  is_displayed_grid: z.boolean(),
  is_read_only: z.boolean(),
  is_encrypted: z.boolean(),
  is_same_line: z.boolean(),
  is_heading: z.boolean(),
  is_field_only: z.boolean(),
  display_logic: z.string().optional(),
  read_only_logic: z.string().optional(),
  mandatory_logic: z.string().optional(),
  obscure_type: z.string().optional(),
  included_tab_id: z.string().uuid().optional(),
  default_value: z.string().optional(),
  sort_no: z.number().optional(),
  entity_type: z.string(),
  is_active: z.boolean(),
  created_by: z.string(),
  updated_by: z.string(),
  created_at: z.date(),
  updated_at: z.date(),
});

export const SysWindowSchema = z.object({
  sys_window_id: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  help: z.string().optional(),
  window_type: z.enum(["M", "T", "Q"]),
  is_sales_transaction: z.boolean(),
  is_default: z.boolean(),
  entity_type: z.string(),
  is_active: z.boolean(),
  created_by: z.string(),
  updated_by: z.string(),
  created_at: z.date(),
  updated_at: z.date(),
});

export const SysTabSchema = z.object({
  sys_tab_id: z.string().uuid(),
  sys_window_id: z.string().uuid(),
  sys_table_id: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  help: z.string().optional(),
  tab_level: z.number(),
  seq_no: z.number(),
  is_single_row: z.boolean(),
  has_tree: z.boolean(),
  is_info_tab: z.boolean(),
  is_translation_tab: z.boolean(),
  is_read_only: z.boolean(),
  is_insert_record: z.boolean(),
  is_advanced_tab: z.boolean(),
  parent_column_id: z.string().uuid().optional(),
  link_column_id: z.string().uuid().optional(),
  order_by_clause: z.string().optional(),
  where_clause: z.string().optional(),
  display_logic: z.string().optional(),
  read_only_logic: z.string().optional(),
  commit_warning: z.string().optional(),
  entity_type: z.string(),
  is_active: z.boolean(),
  created_by: z.string(),
  updated_by: z.string(),
  created_at: z.date(),
  updated_at: z.date(),
});

export const SysUserSchema = z.object({
  sys_user_id: z.string().uuid(),
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password_hash: z.string(),
  description: z.string().optional(),
  is_system_user: z.boolean(),
  is_sales_rep: z.boolean(),
  login_date: z.date().optional(),
  login_failure_count: z.number(),
  is_locked: z.boolean(),
  is_account_verified: z.boolean(),
  notification_type: z.string().optional(),
  supervisor_id: z.string().uuid().optional(),
  default_sys_role_id: z.string().uuid().optional(),
  entity_type: z.string(),
  is_active: z.boolean(),
  created_by: z.string(),
  updated_by: z.string(),
  created_at: z.date(),
  updated_at: z.date(),
});

export const SysRoleSchema = z.object({
  sys_role_id: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  user_level: z.string(),
  is_master_role: z.boolean(),
  is_can_export: z.boolean(),
  is_can_report: z.boolean(),
  is_personal_lock: z.boolean(),
  is_personal_access: z.boolean(),
  max_query_records: z.number(),
  connection_profile: z.string().optional(),
  preference_type: z.string().optional(),
  is_show_accounting: z.boolean(),
  entity_type: z.string(),
  is_active: z.boolean(),
  created_by: z.string(),
  updated_by: z.string(),
  created_at: z.date(),
  updated_at: z.date(),
});

export const SysReferenceSchema = z.object({
  sys_reference_id: z.number(),
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  validation_type: z.enum(["S", "L", "T", "R"]),
  vformat: z.string().optional(),
  entity_type: z.string(),
  is_active: z.boolean(),
  created_by: z.string(),
  updated_by: z.string(),
  created_at: z.date(),
  updated_at: z.date(),
});

// ============================================================================
// Type Guards
// ============================================================================

export function isSystemTable(tableName: string): boolean {
  return tableName.startsWith(SYS_TABLE_PREFIX);
}

export function isBusinessTable(tableName: string): boolean {
  return tableName.startsWith(BUS_TABLE_PREFIX);
}

// ============================================================================
// Helper Types for Template Context
// ============================================================================

/**
 * Extended field metadata combining sys_field and sys_column
 * Used in template rendering for forms and grids
 */
export interface ResolvedField {
  field: SysField;
  column: SysColumn;
  reference: SysReference;
  fieldGroup?: SysFieldGroup;
}

/**
 * Resolved tab with all field information
 */
export interface ResolvedTab {
  tab: SysTab;
  table: SysTable;
  fields: ResolvedField[];
  childTabs: ResolvedTab[];
}

/**
 * Resolved window with complete structure
 */
export interface ResolvedWindow {
  window: SysWindow;
  tabs: ResolvedTab[];
}

/**
 * Complete dictionary context for an entity
 */
export interface EntityDictionaryContext {
  table: SysTable;
  columns: SysColumn[];
  window?: ResolvedWindow;
  references: Map<number, SysReference>;
  validationRules: Map<string, SysValRule>;
}
