-- Up Migration
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE person (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  email text NOT NULL UNIQUE,
  avatar_url text,
  jira_account_id text UNIQUE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  lifecycle text NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active', 'done', 'archived')),
  done_at timestamptz,
  archived_at timestamptz
);

CREATE TABLE reference_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('region', 'farm', 'cluster', 'release', 'severity', 'risk', 'scope')),
  label text NOT NULL,
  parent_id uuid REFERENCES reference_item(id) ON DELETE SET NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES person(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES person(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  lifecycle text NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active', 'done', 'archived')),
  done_at timestamptz,
  archived_at timestamptz,
  UNIQUE (kind, label)
);

CREATE TABLE deployment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  category text NOT NULL CHECK (category IN ('infrastructure', 'application')),
  version_label text,
  content text,
  risk_level text,
  risk_notes text,
  rollback_plan text,
  planned_start_date date,
  qa_verified boolean NOT NULL DEFAULT false,
  qa_verified_at timestamptz,
  qa_link text,
  confluence_url text,
  state text NOT NULL DEFAULT 'planned' CHECK (state IN ('planned', 'qa', 'in_rollout', 'done', 'reverted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES person(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES person(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  lifecycle text NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active', 'done', 'archived')),
  done_at timestamptz,
  archived_at timestamptz
);

CREATE TABLE deployment_owner (
  deployment_id uuid NOT NULL REFERENCES deployment(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  PRIMARY KEY (deployment_id, person_id)
);

CREATE TABLE rollout_step (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id uuid NOT NULL REFERENCES deployment(id) ON DELETE CASCADE,
  sort_order integer NOT NULL,
  label text NOT NULL,
  scope_ref_id uuid REFERENCES reference_item(id) ON DELETE SET NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'in_progress', 'done', 'skipped', 'failed')),
  clusters_done integer CHECK (clusters_done IS NULL OR clusters_done >= 0),
  clusters_total integer CHECK (clusters_total IS NULL OR clusters_total >= 0),
  occurred_on date,
  note text,
  CHECK (clusters_done IS NULL OR clusters_total IS NULL OR clusters_done <= clusters_total),
  UNIQUE (deployment_id, sort_order)
);

CREATE TABLE production_issue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  severity text NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  status text NOT NULL CHECK (status IN ('investigation', 'in_progress', 'monitoring', 'resolved')),
  started_on date NOT NULL,
  customer_impact text,
  rca_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES person(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES person(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  lifecycle text NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active', 'done', 'archived')),
  done_at timestamptz,
  archived_at timestamptz
);

CREATE TABLE issue_scope (
  production_issue_id uuid NOT NULL REFERENCES production_issue(id) ON DELETE CASCADE,
  reference_item_id uuid NOT NULL REFERENCES reference_item(id) ON DELETE CASCADE,
  PRIMARY KEY (production_issue_id, reference_item_id)
);

CREATE TABLE action_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_type text NOT NULL CHECK (parent_type IN ('deployment', 'production_issue')),
  parent_id uuid NOT NULL,
  text text NOT NULL,
  owner_id uuid REFERENCES person(id) ON DELETE SET NULL,
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'in_progress', 'done', 'cancelled')),
  eta_date date,
  jira_key text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES person(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES person(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  lifecycle text NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active', 'done', 'archived')),
  done_at timestamptz,
  archived_at timestamptz
);

CREATE TABLE commitment_cache (
  jira_key text PRIMARY KEY,
  customer text NOT NULL,
  summary text NOT NULL,
  status text NOT NULL,
  status_category text NOT NULL,
  assignee_person_id uuid REFERENCES person(id) ON DELETE SET NULL,
  due_date date,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL
);

CREATE TABLE commitment_note (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jira_key text NOT NULL REFERENCES commitment_cache(jira_key) ON DELETE CASCADE,
  body text NOT NULL,
  author_id uuid REFERENCES person(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE jira_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('deployment', 'production_issue')),
  entity_id uuid NOT NULL,
  jira_key text NOT NULL,
  status text,
  status_category text,
  assignee text,
  synced_at timestamptz,
  UNIQUE (entity_type, entity_id, jira_key)
);

CREATE TABLE change_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  field text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  actor_id uuid REFERENCES person(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE meeting (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_date date NOT NULL UNIQUE,
  started_at timestamptz,
  ended_at timestamptz,
  led_by uuid REFERENCES person(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES person(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES person(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  lifecycle text NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active', 'done', 'archived')),
  done_at timestamptz,
  archived_at timestamptz
);

CREATE TABLE meeting_coverage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES meeting(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('deployment', 'production_issue', 'commitment')),
  entity_id text NOT NULL,
  covered_at timestamptz NOT NULL DEFAULT now(),
  note text,
  UNIQUE (meeting_id, entity_type, entity_id)
);

CREATE TABLE meeting_snapshot (
  meeting_id uuid PRIMARY KEY REFERENCES meeting(id) ON DELETE CASCADE,
  payload jsonb NOT NULL
);

CREATE TABLE comment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('deployment', 'production_issue')),
  entity_id uuid NOT NULL,
  body text NOT NULL,
  author_id uuid REFERENCES person(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES person(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES person(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  lifecycle text NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active', 'done', 'archived')),
  done_at timestamptz,
  archived_at timestamptz
);

CREATE INDEX deployment_lifecycle_planned_start_date_idx ON deployment (lifecycle, planned_start_date);
CREATE INDEX action_item_parent_sort_order_idx ON action_item (parent_type, parent_id, sort_order);
CREATE INDEX change_event_entity_occurred_at_idx ON change_event (entity_type, entity_id, occurred_at DESC);
CREATE INDEX rollout_step_deployment_sort_order_idx ON rollout_step (deployment_id, sort_order);
CREATE INDEX reference_item_kind_sort_order_idx ON reference_item (kind, sort_order);
CREATE INDEX issue_scope_reference_item_idx ON issue_scope (reference_item_id, production_issue_id);
CREATE INDEX commitment_note_jira_created_at_idx ON commitment_note (jira_key, created_at DESC);
CREATE INDEX jira_link_key_idx ON jira_link (jira_key);
CREATE INDEX meeting_coverage_entity_idx ON meeting_coverage (entity_type, entity_id);
CREATE INDEX comment_entity_created_at_idx ON comment (entity_type, entity_id, created_at);

-- Down Migration
DROP TABLE IF EXISTS comment;
DROP TABLE IF EXISTS meeting_snapshot;
DROP TABLE IF EXISTS meeting_coverage;
DROP TABLE IF EXISTS meeting;
DROP TABLE IF EXISTS change_event;
DROP TABLE IF EXISTS jira_link;
DROP TABLE IF EXISTS commitment_note;
DROP TABLE IF EXISTS commitment_cache;
DROP TABLE IF EXISTS action_item;
DROP TABLE IF EXISTS issue_scope;
DROP TABLE IF EXISTS production_issue;
DROP TABLE IF EXISTS rollout_step;
DROP TABLE IF EXISTS deployment_owner;
DROP TABLE IF EXISTS deployment;
DROP TABLE IF EXISTS reference_item;
DROP TABLE IF EXISTS person;
DROP EXTENSION IF EXISTS pgcrypto;
