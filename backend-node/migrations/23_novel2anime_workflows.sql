CREATE TABLE IF NOT EXISTS story_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drama_id INTEGER NOT NULL,
  source_type TEXT NOT NULL,
  title TEXT,
  raw_text_path TEXT,
  content_hash TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_story_sources_drama ON story_sources(drama_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_story_sources_hash ON story_sources(content_hash);

CREATE TABLE IF NOT EXISTS source_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL,
  item_type TEXT NOT NULL,
  item_no INTEGER DEFAULT 0,
  title TEXT,
  raw_text TEXT,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'ready',
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_source_items_source ON source_items(source_id, item_no);

CREATE TABLE IF NOT EXISTS story_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drama_id INTEGER NOT NULL,
  source_item_id INTEGER,
  event_no INTEGER DEFAULT 0,
  title TEXT,
  detail TEXT,
  characters TEXT,
  location TEXT,
  tension INTEGER DEFAULT 1,
  hook_score INTEGER DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_story_events_drama ON story_events(drama_id, event_no);

CREATE TABLE IF NOT EXISTS adaptation_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drama_id INTEGER NOT NULL,
  source_id INTEGER NOT NULL,
  target_episode_count INTEGER DEFAULT 1,
  style TEXT,
  plan_json TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_adaptation_plans_source ON adaptation_plans(source_id, status);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  drama_id INTEGER NOT NULL,
  episode_id INTEGER,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  progress INTEGER DEFAULT 0,
  current_step TEXT,
  input_json TEXT,
  output_json TEXT,
  error TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_drama ON workflow_runs(drama_id, created_at);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status, updated_at);

CREATE TABLE IF NOT EXISTS workflow_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  step_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  input_json TEXT,
  output_json TEXT,
  error TEXT,
  sort_order INTEGER DEFAULT 0,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workflow_steps_run ON workflow_steps(run_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_workflow_steps_status ON workflow_steps(status, updated_at);

CREATE TABLE IF NOT EXISTS qa_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drama_id INTEGER NOT NULL,
  episode_id INTEGER,
  run_id TEXT,
  score INTEGER DEFAULT 0,
  passed INTEGER DEFAULT 0,
  report_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_qa_reports_drama ON qa_reports(drama_id, created_at);

CREATE TABLE IF NOT EXISTS creative_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drama_id INTEGER,
  run_id TEXT,
  source_id INTEGER,
  role TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  findings_json TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_creative_reviews_run ON creative_reviews(run_id, status);

CREATE TABLE IF NOT EXISTS timeline_tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  name TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_timeline_tracks_episode ON timeline_tracks(episode_id, sort_order);

CREATE TABLE IF NOT EXISTS timeline_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id INTEGER NOT NULL,
  storyboard_id INTEGER,
  start_sec REAL DEFAULT 0,
  end_sec REAL DEFAULT 0,
  source_path TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_timeline_items_track ON timeline_items(track_id, start_sec);
