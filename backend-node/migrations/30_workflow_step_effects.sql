CREATE TABLE IF NOT EXISTS workflow_step_effects (
  call_key TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  workflow_step_id TEXT NOT NULL,
  step_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'succeeded',
  output_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workflow_step_effects_run
  ON workflow_step_effects(run_id, workflow_step_id, status);
