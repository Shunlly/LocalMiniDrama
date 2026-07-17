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

const SKILL_SCHEMAS = Object.freeze({
  'localminidrama-source-intake': {
    input: { type: 'object', required: ['drama_id'] },
    output: { type: 'object', required: ['source_id'] },
  },
  'localminidrama-script-adapter': {
    input: {
      type: 'object',
      anyOf: [
        { required: ['source_id'] },
        { required: ['adaptation_plan_id'] },
      ],
    },
    output: {
      type: 'object',
      anyOf: [
        { required: ['adaptation_plan_id'] },
        { required: ['plan_id'] },
      ],
    },
  },
});

function nowIso() {
  return new Date().toISOString();
}

function toJson(value) {
  return JSON.stringify(value == null ? {} : value);
}

function parseJson(value, fallback = {}) {
  if (value && typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

function definitionFor(skillName) {
  const row = DEFAULT_SKILLS.find((skill) => skill[0] === skillName);
  if (!row) return null;
  return {
    skill_name: row[0],
    skill_version: row[1],
    owner_role: row[2],
    workflow_node: row[3],
    mode: row[4],
    template_path: row[5],
  };
}

function schemaFor(skillName, direction) {
  return SKILL_SCHEMAS[skillName]?.[direction] || { type: 'object' };
}

function schemaMatches(schema, value) {
  if (!schema || Object.keys(schema).length === 0) return true;
  if (schema.type === 'object' && (!value || typeof value !== 'object' || Array.isArray(value))) return false;
  if (schema.type === 'array' && !Array.isArray(value)) return false;
  if (schema.type === 'string' && typeof value !== 'string') return false;
  if (Array.isArray(schema.required) && schema.required.some((key) => value?.[key] == null)) return false;
  if (schema.properties && value && typeof value === 'object') {
    for (const [key, childSchema] of Object.entries(schema.properties)) {
      if (value[key] != null && !schemaMatches(childSchema, value[key])) return false;
    }
  }
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some((candidate) => schemaMatches(candidate, value))) return false;
  return true;
}

function validateSkillPayload(skillName, direction, payload, schema) {
  const effectiveSchema = schema || schemaFor(skillName, direction);
  if (schemaMatches(effectiveSchema, payload)) return payload;
  const error = new Error(`${skillName} ${direction} does not satisfy the registered minimum schema`);
  error.code = 'SKILL_SCHEMA_VALIDATION_FAILED';
  error.skill_name = skillName;
  error.direction = direction;
  throw error;
}

function templateRoot(options = {}) {
  return options.template_root
    ? path.resolve(options.template_root)
    : path.resolve(__dirname, '..', '..');
}

function loadSkillRuntime(db, skillName, options = {}) {
  ensureDefaultSkills(db);
  const definition = definitionFor(skillName);
  if (!definition?.template_path) {
    const error = new Error(`Unknown or templated skill not found: ${skillName}`);
    error.code = 'SKILL_NOT_FOUND';
    throw error;
  }
  const absolutePath = path.resolve(templateRoot(options), definition.template_path);
  const root = templateRoot(options);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
    const error = new Error(`Skill template escapes the configured root: ${skillName}`);
    error.code = 'SKILL_TEMPLATE_INVALID';
    throw error;
  }
  const template = fs.readFileSync(absolutePath, 'utf8');
  const registry = db.prepare('SELECT * FROM skill_registry WHERE skill_name = ? AND enabled = 1').get(skillName);
  if (!registry) {
    const error = new Error(`Skill is disabled or missing: ${skillName}`);
    error.code = 'SKILL_NOT_FOUND';
    throw error;
  }
  return {
    ...definition,
    skill_version: registry.skill_version || definition.skill_version,
    template,
    template_sha256: crypto.createHash('sha256').update(template, 'utf8').digest('hex'),
    input_schema: parseJson(registry.input_schema_json, schemaFor(skillName, 'input')),
    output_schema: parseJson(registry.output_schema_json, schemaFor(skillName, 'output')),
  };
}

function renderSkillPrompt(db, skillName, input, options = {}) {
  const runtime = loadSkillRuntime(db, skillName, options);
  validateSkillPayload(skillName, 'input', input, runtime.input_schema);
  return {
    ...runtime,
    system_prompt: runtime.template,
    user_prompt: JSON.stringify(input, null, 2),
  };
}

function hashJson(value) {
  return crypto.createHash('sha256').update(toJson(value), 'utf8').digest('hex');
}

function ensureDefaultSkills(db) {
  const now = nowIso();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO skill_registry
     (skill_name, skill_version, owner_role, workflow_node, enabled, mode, input_schema_json, output_schema_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`
  );
  for (const skill of DEFAULT_SKILLS) {
    insert.run(
      skill[0],
      skill[1],
      skill[2],
      skill[3],
      skill[4],
      toJson(schemaFor(skill[0], 'input')),
      toJson(schemaFor(skill[0], 'output')),
      now,
      now
    );
    db.prepare(
      `UPDATE skill_registry
          SET skill_version = ?, owner_role = ?, workflow_node = ?, mode = ?,
              input_schema_json = ?, output_schema_json = ?, updated_at = ?
        WHERE skill_name = ?`
    ).run(
      skill[1],
      skill[2],
      skill[3],
      skill[4],
      toJson(schemaFor(skill[0], 'input')),
      toJson(schemaFor(skill[0], 'output')),
      now,
      skill[0]
    );
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
    template_sha256: skill[5] && fs.existsSync(path.join(root, skill[5]))
      ? crypto.createHash('sha256').update(fs.readFileSync(path.join(root, skill[5]))).digest('hex')
      : null,
  }));
}

function recordSkillInvocation(db, params) {
  ensureDefaultSkills(db);
  const runtime = loadSkillRuntime(db, params.skill_name, params.runtime_options || {});
  validateSkillPayload(params.skill_name, 'input', params.input || {}, runtime.input_schema);
  validateSkillPayload(params.skill_name, 'output', params.output || {}, runtime.output_schema);
  const inputHash = hashJson(params.input || {});
  const outputHash = hashJson(params.output || {});
  const status = params.status || 'success';
  const existing = db.prepare(
    `SELECT id FROM skill_invocations
      WHERE COALESCE(workflow_step_id, '') = COALESCE(?, '')
        AND skill_name = ?
        AND input_hash = ?
        AND output_hash = ?
        AND status = ?
      ORDER BY id ASC LIMIT 1`
  ).get(
    params.workflow_step_id || null,
    params.skill_name,
    inputHash,
    outputHash,
    status
  );
  if (existing) return Number(existing.id);
  const createdAt = nowIso();
  const info = db.prepare(
    `INSERT INTO skill_invocations
     (workflow_step_id, run_id, skill_name, skill_version, template_sha256, input_hash, output_hash, status, cost_estimate, error_message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.workflow_step_id || null,
    params.run_id || null,
    params.skill_name,
    runtime.skill_version,
    runtime.template_sha256,
    inputHash,
    outputHash,
    status,
    Number(params.cost_estimate) || 0,
    params.error_message || null,
    createdAt
  );
  return Number(info.lastInsertRowid);
}

module.exports = {
  DEFAULT_SKILLS,
  SKILL_SCHEMAS,
  ensureDefaultSkills,
  getSkillTemplates,
  loadSkillRuntime,
  renderSkillPrompt,
  validateSkillPayload,
  recordSkillInvocation,
};
