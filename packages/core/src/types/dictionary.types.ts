/**
 * Application Dictionary Types (Compiere-style)
 * Metadata-driven architecture for dynamic application generation
 */

export interface AD_Table {
  ad_table_id: string;
  table_name: string;
  name: string;
  description?: string;
  access_level: "System" | "Organization" | "Client+Organization" | "All";
  is_view: boolean;
  is_document: boolean;
  window_id?: string;
  created_at: Date;
  updated_at: Date;
}

export interface AD_Column {
  ad_column_id: string;
  ad_table_id: string;
  column_name: string;
  name: string;
  description?: string;
  ad_reference_id: string;
  field_length?: number;
  is_mandatory: boolean;
  is_updateable: boolean;
  is_key: boolean;
  is_parent: boolean;
  default_value?: string;
  validation_rule_id?: string;
  created_at: Date;
  updated_at: Date;
}

export interface AD_Window {
  ad_window_id: string;
  name: string;
  description?: string;
  window_type: "M" | "T" | "Q"; // Maintain, Transaction, Query
  entity_type: string;
  created_at: Date;
  updated_at: Date;
}

export interface AD_Tab {
  ad_tab_id: string;
  ad_window_id: string;
  name: string;
  description?: string;
  ad_table_id: string;
  tab_level: number;
  sequence: number;
  is_single_row: boolean;
  has_tree: boolean;
  link_column_id?: string;
  parent_column_id?: string;
  created_at: Date;
  updated_at: Date;
}

export interface AD_Field {
  ad_field_id: string;
  ad_tab_id: string;
  ad_column_id: string;
  name: string;
  description?: string;
  is_displayed: boolean;
  is_readonly: boolean;
  is_mandatory: boolean;
  sequence: number;
  field_group_id?: string;
  display_logic?: string;
  created_at: Date;
  updated_at: Date;
}

export interface AD_Reference {
  ad_reference_id: string;
  name: string;
  description?: string;
  validation_type: string;
  created_at: Date;
  updated_at: Date;
}

export interface AD_Val_Rule {
  ad_val_rule_id: string;
  name: string;
  description?: string;
  type: "S" | "L"; // SQL, List
  code: string;
  ad_table_id?: string;
  created_at: Date;
  updated_at: Date;
}
