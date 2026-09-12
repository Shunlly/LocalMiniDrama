ALTER TABLE async_tasks ADD COLUMN cancel_context TEXT;
ALTER TABLE async_tasks ADD COLUMN cancel_operation_id TEXT;
ALTER TABLE async_tasks ADD COLUMN cancel_state TEXT;
ALTER TABLE async_tasks ADD COLUMN cancel_attempt INTEGER DEFAULT 0;
ALTER TABLE async_tasks ADD COLUMN cancel_next_retry_at TEXT;
ALTER TABLE async_tasks ADD COLUMN cancel_requested_at TEXT;
ALTER TABLE async_tasks ADD COLUMN cancel_confirmed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_async_tasks_cancel_retry
  ON async_tasks(status, cancel_state, cancel_next_retry_at);

CREATE INDEX IF NOT EXISTS idx_async_tasks_cancel_operation
  ON async_tasks(cancel_operation_id, cancel_state);
