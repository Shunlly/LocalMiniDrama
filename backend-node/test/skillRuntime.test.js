const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const skillRegistryService = require('../src/services/skillRegistryService');

function createDb(t) {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  t.after(() => db.close());
  return db;
}

function createTemplateRoot(t, content) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-skill-runtime-'));
  const directory = path.join(root, 'prompts', 'skills');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'script-adapter.md'), content, 'utf8');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function createWorkflowContext(db, runId, stepId) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO dramas (id, title, status, created_at, updated_at)
     VALUES (1, 'Skill runtime', 'draft', ?, ?)`
  ).run(now, now);
  db.prepare(
    `INSERT INTO workflow_runs (id, drama_id, type, status, created_at, updated_at)
     VALUES (?, 1, 'novel2anime', 'processing', ?, ?)`
  ).run(runId, now, now);
  db.prepare(
    `INSERT INTO workflow_steps (id, run_id, step_key, status, created_at, updated_at)
     VALUES (?, ?, 'adaptation_plan', 'processing', ?, ?)`
  ).run(stepId, runId, now, now);
}

test('skill runtime loads templates, validates schemas, and records version plus template SHA-256', (t) => {
  const db = createDb(t);
  createWorkflowContext(db, 'run-1', 'step-1');
  const root = createTemplateRoot(t, '# adapter v1\nUse the source trace.');
  const input = { source_id: 7, adaptation_plan_id: 9 };
  const output = { adaptation_plan_id: 9, episode_count: 2 };
  const rendered = skillRegistryService.renderSkillPrompt(
    db,
    'localminidrama-script-adapter',
    input,
    { template_root: root }
  );

  assert.match(rendered.system_prompt, /adapter v1/);
  assert.deepEqual(JSON.parse(rendered.user_prompt), input);
  assert.match(rendered.template_sha256, /^[a-f0-9]{64}$/);

  const invocationId = skillRegistryService.recordSkillInvocation(db, {
    run_id: 'run-1',
    workflow_step_id: 'step-1',
    skill_name: 'localminidrama-script-adapter',
    input,
    output,
    runtime_options: { template_root: root },
  });
  const row = db.prepare(
    'SELECT skill_version, template_sha256, status FROM skill_invocations WHERE id = ?'
  ).get(invocationId);
  assert.equal(row.skill_version, '1.0.0');
  assert.equal(row.template_sha256, rendered.template_sha256);
  assert.equal(row.status, 'success');

  assert.throws(
    () => skillRegistryService.recordSkillInvocation(db, {
      skill_name: 'localminidrama-script-adapter',
      input: {},
      output,
      runtime_options: { template_root: root },
    }),
    (error) => error.code === 'SKILL_SCHEMA_VALIDATION_FAILED' && error.direction === 'input'
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM skill_invocations').get().count, 1);
});

test('replacing a skill template changes rendered provider prompt and audit evidence', (t) => {
  const db = createDb(t);
  const firstRoot = createTemplateRoot(t, '# adapter A\nPreserve every source beat.');
  const secondRoot = createTemplateRoot(t, '# adapter B\nPrioritize the episode hook.');
  const input = { source_id: 5, adaptation_plan_id: 8 };

  const first = skillRegistryService.renderSkillPrompt(
    db,
    'localminidrama-script-adapter',
    input,
    { template_root: firstRoot }
  );
  const second = skillRegistryService.renderSkillPrompt(
    db,
    'localminidrama-script-adapter',
    input,
    { template_root: secondRoot }
  );

  assert.notEqual(first.system_prompt, second.system_prompt);
  assert.notEqual(first.template_sha256, second.template_sha256);
  assert.match(first.system_prompt, /adapter A/);
  assert.match(second.system_prompt, /adapter B/);
});
