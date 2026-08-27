ALTER TABLE dramas ADD COLUMN trash_state TEXT;
ALTER TABLE dramas ADD COLUMN recycle_operation_id TEXT;
ALTER TABLE dramas ADD COLUMN recycle_phase TEXT;
ALTER TABLE dramas ADD COLUMN recycle_started_at TEXT;

CREATE INDEX IF NOT EXISTS idx_dramas_trash_state
  ON dramas(trash_state, deleted_at);
