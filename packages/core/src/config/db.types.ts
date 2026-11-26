import type { ColumnType } from "kysely";

/**
 * A column the database fills in when an insert omits it (it has a DEFAULT).
 * Present on select, optional on insert.
 */
type Defaulted<T> = ColumnType<T, T | undefined, T>;

/**
 * A nullable column with no default. Optional on insert; null when unset.
 *
 * Declaring these as a plain `T | null` is what made Kysely demand every one of
 * them on every insert, which is why call sites reached for `as any` instead.
 */
type Nullable<T> = ColumnType<T | null, T | null | undefined, T | null>;

/** Kysely table interfaces — shared by db.config and database.service */

export interface ProjectsTable {
  id: string;
  name: string;
  description: Nullable<string>;
  icon: Defaulted<string>;
  icon_color: Defaulted<string>;
  status: Defaulted<string>;
  is_deleted: Defaulted<boolean>;
  stack_type: Defaulted<string>;
  stack_version: Defaulted<string>;
  port: Defaulted<number>;
  base_url: Nullable<string>;
  database_url: Nullable<string>;
  database_type: Defaulted<string>;
  database_schema: Nullable<string>;
  environment_variables: Nullable<string>;
  secrets: Nullable<string>;
  generated_path: Nullable<string>;
  output_directory: Nullable<string>;
  build_config: Nullable<string>;
  is_typescript: Defaulted<boolean>;
  is_tailwind: Defaulted<boolean>;
  deployment_status: Nullable<string>;
  deployment_url: Nullable<string>;
  uptime: Nullable<string>;
  owner_user_id: Nullable<string>;
  target_db_connection: Nullable<string>;
  created_at: Defaulted<string>;
  updated_at: Defaulted<string>;
}

export interface ProjectMembersTable {
  id: string;
  project_id: string;
  user_id: string;
  permission: string;
  created_at: string;
}

export interface ErdVersionsTable {
  git_commit: Nullable<string>;
  id: string;
  project_id: string;
  version_number: number;
  mermaid_code: string;
  description: string | null;
  is_current: boolean;
  validation_errors: string | null;
  parsed_schema: string | null;
  entity_count: number;
  relationship_count: number;
  ai_suggestions: string | null;
  ai_enhanced: boolean;
  import_source: string | null;
  import_metadata: string | null;
  created_by: string | null;
  commit_message: string | null;
  change_summary: string | null;
  created_at: string;
}

export interface WorkflowsTable {
  id: string;
  project_id: string;
  name: string;
  service_name: string;
  workflow_type: string;
  mermaid_code: string;
  description: string | null;
  extension_points: string | null;
  config: string | null;
  triggers: string | null;
  conditions: string | null;
  generated_code: string | null;
  code_language: string;
  status: string;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
  last_executed_at: string | null;
  hook_definitions: string | null;
  flowchart_code: string | null;
  generated_hook_code: string | null;
  is_draft: boolean;
}

export interface GenerationHistoryTable {
  id: string;
  project_id: string;
  stack_type: string;
  stack_version: string | null;
  generation_options: string | null;
  status: string;
  progress: number;
  current_step: string | null;
  generated_path: string | null;
  output_structure: string | null;
  port: number | null;
  file_manifest: string | null;
  entry_points: string | null;
  build_command: string | null;
  start_command: string | null;
  install_command: string | null;
  dependencies: string | null;
  dev_dependencies: string | null;
  environment_config: string | null;
  docker_config: string | null;
  logs: string | null;
  error_message: string | null;
  warnings: string | null;
  files_generated: number;
  total_size_bytes: number;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
}

export interface DeploymentsTable {
  id: string;
  project_id: string;
  status: string;
  environment: string;
  deployment_url: string | null;
  port: number;
  host: string;
  process_id: string | null;
  process_command: string | null;
  uptime: string | null;
  uptime_seconds: number | null;
  last_health_check: string | null;
  health_status: string | null;
  resource_usage: string | null;
  deployment_config: string | null;
  auto_restart: boolean;
  restart_count: number;
  stdout_log: string | null;
  stderr_log: string | null;
  started_at: string | null;
  stopped_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EntitiesTable {
  id: string;
  project_id: string;
  erd_version_id: string | null;
  name: string;
  display_name: string | null;
  type: string;
  description: string | null;
  schema: string | null;
  fields: string | null;
  relationships: string | null;
  generate_api: boolean;
  generate_ui: boolean;
  generate_crud: boolean;
  created_at: string;
  updated_at: string;
}

export interface SettingsTable {
  key: string;
  value: string | null;
  type: string;
  description: string | null;
  updated_at: string;
}

export interface AuthUsersTable {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  emailVerified: boolean;
  status: string;
  role: string;
  /** Added by runMigrations(); bcrypt hash, null for OAuth-only accounts. */
  passwordHash: Nullable<string>;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSessionsTable {
  id: string;
  userId: string;
  token: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthAccountsTable {
  id: string;
  userId: string;
  provider: string;
  providerAccountId: string;
  refreshToken: string | null;
  accessToken: string | null;
  expiresAt: number | null;
  createdAt: string;
}

export interface AuthVerificationTokensTable {
  token: string;
  email: string;
  expires: string;
  createdAt: string;
}

export interface RulesTable {
  id: string;
  entity_name: string;
  rule_name: string;
  operation: string;
  jdm_content: string;
  created_at: string;
  updated_at: string;
}

export interface Database {
  project_git_state: ProjectGitStateTable;
  project_git_operations: ProjectGitOperationTable;
  projects: ProjectsTable;
  project_members: ProjectMembersTable;
  erd_versions: ErdVersionsTable;
  workflows: WorkflowsTable;
  generation_history: GenerationHistoryTable;
  deployments: DeploymentsTable;
  entities: EntitiesTable;
  settings: SettingsTable;
  rules: RulesTable;
  auth_users: AuthUsersTable;
  auth_sessions: AuthSessionsTable;
  auth_accounts: AuthAccountsTable;
  auth_verification_tokens: AuthVerificationTokensTable;
}

export interface ProjectGitStateTable {
  project_id: string;
  model_code: string;
  model_commit: string;
  generation_commit: Nullable<string>;
  generation_model_commit: Nullable<string>;
  updated_at: string;
}

export interface ProjectGitOperationTable {
  id: string;
  project_id: string;
  request_id: string;
  fingerprint: string;
  kind: string;
  status: string;
  payload: string;
  result: Nullable<string>;
  created_at: string;
}
