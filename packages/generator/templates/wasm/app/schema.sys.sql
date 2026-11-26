-- ---------------------------------------------------------------------------
-- Application Dictionary — the system half of the schema.
--
-- Model-independent, which is why it is a static file rather than something the
-- generator writes: every application produced by cli-wasm has exactly these
-- tables, and only the bus_* half (schema.bus.sql) varies. Keeping the split
-- means a change to the dictionary is reviewed as SQL here instead of as string
-- concatenation in TypeScript.
--
-- The column set mirrors the NestJS stack's migrations 001-011 so the same
-- dictionary-driven screens read the same rows. Anything the browser runtime
-- cannot support (immudb mirroring, pgvector retrieval, Electric sync) is
-- simply absent rather than stubbed: a table nothing writes to is worse than no
-- table, because it reads as a feature.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sys_reference (
  sys_reference_id INTEGER PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  validation_type VARCHAR(1) NOT NULL DEFAULT 'S',
  entity_type VARCHAR(40) NOT NULL DEFAULT 'U',
  validation_regex VARCHAR(500),
  format_pattern VARCHAR(100),
  is_active BOOLEAN DEFAULT true,
  created_by VARCHAR(100) NOT NULL DEFAULT 'system',
  updated_by VARCHAR(100) NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sys_ref_list (
  sys_ref_list_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sys_reference_id INTEGER NOT NULL,
  value VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  seq_no INTEGER DEFAULT 0,
  entity_type VARCHAR(40) NOT NULL DEFAULT 'U',
  is_active BOOLEAN DEFAULT true,
  created_by VARCHAR(100) NOT NULL DEFAULT 'system',
  updated_by VARCHAR(100) NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sys_val_rule (
  sys_val_rule_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  code TEXT,
  error_message VARCHAR(255),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sys_role (
  sys_role_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  is_admin BOOLEAN DEFAULT false,
  user_level VARCHAR(20),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sys_user (
  sys_user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  is_locked BOOLEAN DEFAULT false,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sys_user_roles (
  sys_user_role_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES sys_user(sys_user_id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES sys_role(sys_role_id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, role_id)
);

-- Sessions are a table rather than a signed cookie on purpose: the whole
-- database lives in the browser, so a signing secret stored beside it protects
-- nothing. A row that can be deleted is an honest logout.
CREATE TABLE IF NOT EXISTS sys_session (
  sys_session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token VARCHAR(128) NOT NULL UNIQUE,
  sys_user_id UUID NOT NULL REFERENCES sys_user(sys_user_id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sys_window (
  sys_window_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  window_type VARCHAR(20) DEFAULT 'maintain',
  is_active BOOLEAN DEFAULT true,
  win_height INTEGER DEFAULT 600,
  win_width INTEGER DEFAULT 800,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sys_table (
  sys_table_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name VARCHAR(100) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  entity_type VARCHAR(20) DEFAULT 'bus',
  is_view BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  -- Compiere's access-level code (S/C/O/CO/A), which is what `SysTable` is
  -- typed as and what the dictionary generator emits. The NestJS stack's
  -- migration declares this INTEGER; that column only ever holds a letter.
  access_level VARCHAR(4) DEFAULT 'A',
  sys_window_id UUID REFERENCES sys_window(sys_window_id),
  sys_category_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sys_tab (
  sys_tab_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sys_table_id UUID NOT NULL REFERENCES sys_table(sys_table_id),
  sys_window_id UUID NOT NULL REFERENCES sys_window(sys_window_id),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  seq_no INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  is_single_row BOOLEAN DEFAULT false,
  -- A detail tab sits at level 1 inside its master's window and links to the
  -- open master row on one column. See `%%entity <Child> parent: <Parent>`.
  tab_level INTEGER NOT NULL DEFAULT 0,
  link_column_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sys_column (
  sys_column_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sys_table_id UUID NOT NULL REFERENCES sys_table(sys_table_id),
  column_name VARCHAR(100) NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  sys_reference_id INTEGER,
  is_mandatory BOOLEAN DEFAULT false,
  is_updateable BOOLEAN DEFAULT true,
  is_key BOOLEAN DEFAULT false,
  is_parent BOOLEAN DEFAULT false,
  is_identifier BOOLEAN DEFAULT false,
  is_selection_column BOOLEAN DEFAULT false,
  field_length INTEGER,
  default_value VARCHAR(255),
  ref_table_name VARCHAR(100),
  seq_no INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sys_table_id, column_name)
);

CREATE TABLE IF NOT EXISTS sys_field_group (
  sys_field_group_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sys_tab_id UUID REFERENCES sys_tab(sys_tab_id),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  columns INTEGER DEFAULT 1,
  is_collapsed_by_default BOOLEAN DEFAULT false,
  seq_no INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sys_field (
  sys_field_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sys_tab_id UUID NOT NULL REFERENCES sys_tab(sys_tab_id),
  sys_column_id UUID NOT NULL REFERENCES sys_column(sys_column_id),
  sys_field_group_id UUID REFERENCES sys_field_group(sys_field_group_id),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  is_displayed BOOLEAN DEFAULT true,
  is_displayed_grid BOOLEAN DEFAULT true,
  is_read_only BOOLEAN DEFAULT false,
  is_mandatory BOOLEAN DEFAULT false,
  is_updateable BOOLEAN DEFAULT true,
  is_insertable BOOLEAN DEFAULT true,
  seq_no INTEGER DEFAULT 0,
  seq_no_grid INTEGER DEFAULT 0,
  display_length INTEGER,
  field_type VARCHAR(20),
  sys_reference_id INTEGER REFERENCES sys_reference(sys_reference_id),
  sys_val_rule_id UUID REFERENCES sys_val_rule(sys_val_rule_id),
  default_value VARCHAR(255),
  display_logic TEXT,
  is_key BOOLEAN DEFAULT false,
  is_parent BOOLEAN DEFAULT false,
  is_same_line BOOLEAN DEFAULT false,
  column_span INTEGER,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sys_tab_id, sys_column_id)
);

-- `%%section` layout. In the CREATE above for a new database, and added here
-- for one a tab wrote before sections existed: the schema is re-run on every
-- boot and only ever adds.
ALTER TABLE sys_field_group ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE sys_field_group ADD COLUMN IF NOT EXISTS columns INTEGER DEFAULT 1;
ALTER TABLE sys_field_group ADD COLUMN IF NOT EXISTS is_collapsed_by_default BOOLEAN DEFAULT false;
ALTER TABLE sys_field ADD COLUMN IF NOT EXISTS is_same_line BOOLEAN DEFAULT false;
-- X and Y Position are gone from the dictionary: a form is laid out by Sequence,
-- Same Line and Column Span alone. A database written before that loses them here.
ALTER TABLE sys_field DROP COLUMN IF EXISTS x_position;
ALTER TABLE sys_field DROP COLUMN IF EXISTS y_position;
ALTER TABLE sys_field ADD COLUMN IF NOT EXISTS column_span INTEGER;
-- Field logic: Compiere's Display, Read Only and Mandatory Logic. Display is the
-- field's alone; read-only and mandatory are the column's, repeated on the field.
ALTER TABLE sys_field ADD COLUMN IF NOT EXISTS display_logic TEXT;
ALTER TABLE sys_field ADD COLUMN IF NOT EXISTS read_only_logic TEXT;
ALTER TABLE sys_field ADD COLUMN IF NOT EXISTS mandatory_logic TEXT;
ALTER TABLE sys_column ADD COLUMN IF NOT EXISTS read_only_logic TEXT;
ALTER TABLE sys_column ADD COLUMN IF NOT EXISTS mandatory_logic TEXT;

CREATE TABLE IF NOT EXISTS sys_category (
  sys_category_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  seq_no INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sys_rule_definitions (
  sys_rule_definition_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  description TEXT,
  table_name VARCHAR(100) NOT NULL,
  entity_name VARCHAR(100) NOT NULL,
  event VARCHAR(50) NOT NULL,
  operation VARCHAR(10) NOT NULL DEFAULT 'ALL',
  priority INTEGER DEFAULT 100,
  jdm_content TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sys_workflow_definitions (
  sys_workflow_definition_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  entity_name VARCHAR(100) NOT NULL,
  kind VARCHAR(20) NOT NULL DEFAULT 'state',
  definition JSONB NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sys_workflow_runs (
  sys_workflow_run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_name VARCHAR(200) NOT NULL,
  entity_name VARCHAR(100) NOT NULL,
  record_id UUID,
  from_state VARCHAR(100),
  to_state VARCHAR(100),
  trigger VARCHAR(100),
  status VARCHAR(20) NOT NULL DEFAULT 'completed',
  detail JSONB,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sys_audit_log (
  sys_audit_log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  user_email VARCHAR(255),
  action VARCHAR(50) NOT NULL,
  entity_type VARCHAR(100),
  entity_id VARCHAR(100),
  before_value JSONB,
  after_value JSONB,
  changed_fields JSONB,
  source VARCHAR(30) DEFAULT 'WEB_UI',
  success BOOLEAN DEFAULT true,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- A note somebody left on a record.
--
-- Separate from sys_audit_log on purpose: the trail records what the system
-- observed, and this records what a person wanted to say. Mixing them would
-- make the history editable, which is the one thing an audit trail may not be.
CREATE TABLE IF NOT EXISTS sys_note (
  sys_note_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name VARCHAR(100) NOT NULL,
  record_id VARCHAR(100) NOT NULL,
  note TEXT NOT NULL,
  user_id UUID,
  user_name VARCHAR(200),
  user_email VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sys_note_record ON sys_note (table_name, record_id);

-- Written by the %%rbac compiler. A target with no row here is open to any
-- authenticated caller — the directive restricts, it does not grant.
CREATE TABLE IF NOT EXISTS sys_operation_access (
  sys_operation_access_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name VARCHAR(100) NOT NULL,
  entity_name VARCHAR(100) NOT NULL,
  operation VARCHAR(10) NOT NULL,
  role_name VARCHAR(100) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- A transition has no endpoint of its own: moving a record along an edge is an
-- ordinary status update, so the (from_state, to_state) pair is stored and the
-- guard matches on the states a write crosses.
CREATE TABLE IF NOT EXISTS sys_transition_access (
  sys_transition_access_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name VARCHAR(100) NOT NULL,
  entity_name VARCHAR(100) NOT NULL,
  transition VARCHAR(100) NOT NULL,
  from_state VARCHAR(100) NOT NULL,
  to_state VARCHAR(100) NOT NULL,
  role_name VARCHAR(100) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- The `%%report` questions this application answers about itself.
--
-- These were served from `model.json` in memory until now, which made them the
-- one part of the application that could be read and never changed: no table,
-- so no create, update or delete. The NestJS stack has had `sys_report` since
-- migration 018 and this is the same shape deliberately, down to the column
-- names, so one model produces two applications that agree about what a report
-- is.
--
-- `sql_text` rather than `sql`: the column holds a statement and `sql` is a
-- reserved word in enough dialects that naming it that invites a quoting bug.
-- Every read of it still goes through `assertReadOnly` at run time — the table
-- is ordinary and an administrator can now write to it, so the runtime trusts
-- what it is handed exactly as much as it did before, which is not at all.
CREATE TABLE IF NOT EXISTS sys_report (
  sys_report_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL UNIQUE,
  title VARCHAR(255) NOT NULL,
  entity_name VARCHAR(100),
  table_name VARCHAR(100),
  chart VARCHAR(20),
  x_axis VARCHAR(100),
  y_axis VARCHAR(100),
  help TEXT,
  sql_text TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sys_report_table ON sys_report(table_name, sort_order);
CREATE INDEX IF NOT EXISTS idx_sys_column_table ON sys_column(sys_table_id);
CREATE INDEX IF NOT EXISTS idx_sys_field_tab ON sys_field(sys_tab_id);
CREATE INDEX IF NOT EXISTS idx_sys_session_token ON sys_session(token);
CREATE INDEX IF NOT EXISTS idx_sys_audit_created ON sys_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sys_op_access ON sys_operation_access(table_name, operation);
CREATE INDEX IF NOT EXISTS idx_sys_tr_access ON sys_transition_access(table_name, from_state, to_state);

-- ---------------------------------------------------------------------------
-- The reporting application's own half.
--
-- These are not the application's tables with a different prefix. They are the
-- Enterprise Reporting platform's configuration — its users, its roles, and
-- what each role's queries may read — and the platform keeps them in a
-- database of its own (`enterprise_config`), separate from the application it
-- reports on, so that regenerating the application cannot take the reports
-- with it.
--
-- A browser tab has one database, so the separation here is the closest thing
-- it can be: separate tables, a separate session table and a separate cookie,
-- seeded from the reporting pack rather than from `sys_user`. Nothing joins
-- across the two halves and neither password works on the other side — which
-- is the fact worth being able to see, because it is the fact about the
-- deployed pair as well.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS rpt_role (
  rpt_role_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  -- The spelling the model used, so a reader can match this role to the
  -- `%%rbac` line that shaped it.
  declared_as VARCHAR(100),
  description TEXT,
  is_admin BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Which of the application's tables a reporting role's queries may read.
--
-- Rows are the whole of a role's read access, and an absence of them is not
-- permission: only `rpt_role.is_admin` means "every table". The built-in `User`
-- role — signed in, holding no functional role — genuinely has none, and
-- reading that as unrestricted would make the narrowest account on the system
-- the widest.
CREATE TABLE IF NOT EXISTS rpt_role_tables (
  rpt_role_id UUID NOT NULL REFERENCES rpt_role(rpt_role_id) ON DELETE CASCADE,
  table_name VARCHAR(100) NOT NULL,
  PRIMARY KEY (rpt_role_id, table_name)
);

CREATE TABLE IF NOT EXISTS rpt_user (
  rpt_user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  description TEXT,
  rpt_role_id UUID REFERENCES rpt_role(rpt_role_id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rpt_session (
  token VARCHAR(128) PRIMARY KEY,
  rpt_user_id UUID NOT NULL REFERENCES rpt_user(rpt_user_id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rpt_session_token ON rpt_session(token);
CREATE INDEX IF NOT EXISTS idx_rpt_user_email ON rpt_user(email);

-- What happened in the reporting application: sign-ins, report and chart runs
-- (allowed or refused), and every administrator change to its users, roles and
-- table grants. It is what the reporting side's System Logs screen reads, and
-- the only record of who ran what — a refusal is logged as well as a run,
-- because a role's access is only visible in what it was denied.
CREATE TABLE IF NOT EXISTS rpt_activity_log (
  rpt_activity_log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at TIMESTAMPTZ DEFAULT NOW(),
  rpt_user_id UUID,
  email VARCHAR(255),
  action VARCHAR(50) NOT NULL,
  target VARCHAR(255),
  outcome VARCHAR(20) NOT NULL,
  detail TEXT,
  duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_rpt_activity_log_at ON rpt_activity_log(occurred_at DESC);
