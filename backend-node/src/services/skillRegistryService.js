const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_SKILLS = [
  ['localminidrama-source-intake', '1.0.0', 'writer', 'source_intake', 'mock', 'prompts/skills/source-intake.md'],
  ['localminidrama-script-adapter', '1.0.0', 'writer', 'adaptation_plan', 'mock', 'prompts/skills/script-adapter.md'],
  ['localminidrama-continuity-qa', '1.0.0', 'director', 'qa_audit', 'mock', 'prompts/skills/continuity-qa.md'],
  ['localminidrama-workflow-auditor', '1.0.0', 'director', 'qa_audit', 'mock', 'prompts/skills/continuity-qa.md'],
  ['localminidrama-provider-sdk', '1.0.0', 'system', 'provider_generation', 'mock', 'prompts/skills/timeline-plan.md'],
  ['art-direction', 'external', 'art_designer', 'art_bible', 'assist', 'prompts/skills/asset-bible.md'],
  ['character-design-sheet', 'external', 'art_designer', 'art_bible', 'assist', 'prompts/skills/asset-bible.md'],
  ['video-storyboard', 'external', 'animator', 'storyboard_draft', 'assist', 'prompts/skills/storyboard-draft.md'],
  ['image-generation', 'external', 'art_designer', 'image_generation', 'assist', 'prompts/skills/storyboard-draft.md'],
  ['video-prompting', 'external', 'animator', 'video_generation', 'assist', 'prompts/skills/storyboard-draft.md'],
  ['seedance-prompt-zh', 'external', 'animator', 'video_generation', 'assist', 'prompts/skills/storyboard-draft.md'],
  ['video-use', 'external', 'system', 'post_composite', 'assist', 'prompts/skills/timeline-plan.md'],
];

function nowIso() {
  return new Date().toISOString();
}

function toJson(value) {
  return JSON.stringify(value == null ? {} : value);
}

function hashJson(value) {
  return crypto.createHash('sha256').update(toJson(value), 'utf8').digest('hex');
}

function ensureDefaultSkills(db) {
  const now = nowIso();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO skill_registry
     (skill_name, skill_version, owner_role, workflow_node, enabled, mode, input_schema_json, output_schema_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, '{}', '{}', ?, ?)`
  );
  for (const skill of DEFAULT_SKILLS) {
    insert.run(skill[0], skill[1], skill[2], skill[3], skill[4], now, now);
  }
  return db.prepare('SELECT * FROM skill_registry WHERE enabled = 1 ORDER BY id ASC').all();
}

function getSkillTemplates() {
  const root = path.resolve(__dirname, '..', '..');
  return DEFAULT_SKILLS.map((skill) => ({
    skill_name: skill[0],
    skill_version: skill[1],
    owner_role: skill[2],
    workflow_node: skill[3],
    mode: skill[4],
    template_path: skill[5],
    exists: !!skill[5] && fs.existsSync(path.join(root, skill[5])),
  }));
}

function recordSkillInvocation(db, params) {
  ensureDefaultSkills(db);
  const inputHash = hashJson(params.input || {});
  const outputHash = hashJson(params.output || {});
  const createdAt = nowIso();
  const info = db.prepare(
    `INSERT INTO skill_invocations
     (workflow_step_id, run_id, skill_name, input_hash, output_hash, status, cost_estimate, error_message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.workflow_step_id || null,
    params.run_id || null,
    params.skill_name,
    inputHash,
    outputHash,
    params.status || 'success',
    Number(params.cost_estimate) || 0,
    params.error_message || null,
    createdAt
  );
  return Number(info.lastInsertRowid);
}

module.exports = {
  DEFAULT_SKILLS,
  ensureDefaultSkills,
  getSkillTemplates,
  recordSkillInvocation,
};
