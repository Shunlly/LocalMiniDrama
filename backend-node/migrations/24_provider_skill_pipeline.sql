CREATE TABLE IF NOT EXISTS provider_invocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_step_id TEXT,
  run_id TEXT,
  provider_type TEXT NOT NULL,
  provider_name TEXT NOT NULL DEFAULT 'mock',
  model TEXT,
  mode TEXT NOT NULL DEFAULT 'mock',
  input_hash TEXT,
  output_json TEXT,
  status TEXT NOT NULL DEFAULT 'success',
  cost_estimate REAL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_provider_invocations_run ON provider_invocations(run_id, provider_type, created_at);

CREATE TABLE IF NOT EXISTS skill_registry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_name TEXT NOT NULL UNIQUE,
  skill_version TEXT,
  owner_role TEXT,
  workflow_node TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  mode TEXT NOT NULL DEFAULT 'mock',
  input_schema_json TEXT,
  output_schema_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_invocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_step_id TEXT,
  run_id TEXT,
  skill_name TEXT NOT NULL,
  input_hash TEXT,
  output_hash TEXT,
  status TEXT NOT NULL DEFAULT 'success',
  cost_estimate REAL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_skill_invocations_run ON skill_invocations(run_id, skill_name, created_at);

CREATE TABLE IF NOT EXISTS story_event_edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drama_id INTEGER NOT NULL,
  source_id INTEGER,
  from_event_id INTEGER NOT NULL,
  to_event_id INTEGER NOT NULL,
  relation_type TEXT NOT NULL DEFAULT 'next',
  description TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_story_event_edges_source ON story_event_edges(source_id, from_event_id, to_event_id);

INSERT OR IGNORE INTO skill_registry
  (skill_name, skill_version, owner_role, workflow_node, enabled, mode, input_schema_json, output_schema_json, created_at, updated_at)
VALUES
  ('localminidrama-source-intake', '1.0.0', 'writer', 'source_intake', 1, 'mock', '{}', '{}', datetime('now'), datetime('now')),
  ('localminidrama-script-adapter', '1.0.0', 'writer', 'adaptation_plan', 1, 'mock', '{}', '{}', datetime('now'), datetime('now')),
  ('localminidrama-continuity-qa', '1.0.0', 'director', 'qa_audit', 1, 'mock', '{}', '{}', datetime('now'), datetime('now')),
  ('localminidrama-workflow-auditor', '1.0.0', 'director', 'qa_audit', 1, 'mock', '{}', '{}', datetime('now'), datetime('now')),
  ('localminidrama-provider-sdk', '1.0.0', 'system', 'provider_generation', 1, 'mock', '{}', '{}', datetime('now'), datetime('now')),
  ('art-direction', 'external', 'art_designer', 'art_bible', 1, 'assist', '{}', '{}', datetime('now'), datetime('now')),
  ('character-design-sheet', 'external', 'art_designer', 'art_bible', 1, 'assist', '{}', '{}', datetime('now'), datetime('now')),
  ('video-storyboard', 'external', 'animator', 'storyboard_draft', 1, 'assist', '{}', '{}', datetime('now'), datetime('now')),
  ('image-generation', 'external', 'art_designer', 'image_generation', 1, 'assist', '{}', '{}', datetime('now'), datetime('now')),
  ('video-prompting', 'external', 'animator', 'video_generation', 1, 'assist', '{}', '{}', datetime('now'), datetime('now')),
  ('seedance-prompt-zh', 'external', 'animator', 'video_generation', 1, 'assist', '{}', '{}', datetime('now'), datetime('now')),
  ('video-use', 'external', 'system', 'post_composite', 1, 'assist', '{}', '{}', datetime('now'), datetime('now'));
