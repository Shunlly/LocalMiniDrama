ALTER TABLE image_generations ADD COLUMN idempotency_key TEXT;
ALTER TABLE video_generations ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_image_generations_idempotency
  ON image_generations(idempotency_key)
  WHERE idempotency_key IS NOT NULL AND idempotency_key != '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_video_generations_idempotency
  ON video_generations(idempotency_key)
  WHERE idempotency_key IS NOT NULL AND idempotency_key != '';
