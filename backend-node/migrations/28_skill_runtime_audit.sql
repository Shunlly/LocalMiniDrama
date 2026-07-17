ALTER TABLE skill_invocations ADD COLUMN skill_version TEXT;
ALTER TABLE skill_invocations ADD COLUMN template_sha256 TEXT;

CREATE INDEX IF NOT EXISTS idx_skill_invocations_template
  ON skill_invocations(skill_name, skill_version, template_sha256, created_at);
