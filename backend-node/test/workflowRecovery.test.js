const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const workflowService = require('../src/services/workflowService');

const log = { info() {}, warn() {}, error() {} };

function createDb(t) {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO dramas (id, title, description, style, status, created_at, updated_at)
     VALUES (1, 'Recovery', 'Recovery fixture', 'anime', 'draft', ?, ?)`
  ).run(now, now);
  t.after(() => db.close());
  return db;
}

function insertSourcePlan(db, episodeCount = 1) {
  const now = new Date().toISOString();
  const source = db.prepare(
    `INSERT INTO story_sources (drama_id, source_type, title, content_hash, metadata, created_at)
     VALUES (1, 'storyboard', 'Recovery source', 'fixture-hash', '{}', ?)`
  ).run(now);
  const sourceId = Number(source.lastInsertRowid);
  const item = db.prepare(
    `INSERT INTO source_items (source_id, item_type, item_no, title, raw_text, summary, status, created_at, updated_at)
     VALUES (?, 'storyboard', 1, 'Gate', 'Aria enters the Gate.', 'Aria enters the Gate.', 'ready', ?, ?)`
  ).run(sourceId, now, now);
  db.prepare(
    `INSERT INTO story_events
     (drama_id, source_item_id, event_no, title, detail, characters, location, tension, hook_score, created_at)
     VALUES (1, ?, 1, 'Gate', 'Aria enters the Gate.', '["Aria"]', 'Gate', 2, 2, ?)`
  ).run(Number(item.lastInsertRowid), now);
  const episodes = Array.from({ length: episodeCount }, (_, index) => ({
    episode_number: index + 1,
    title: `Episode ${index + 1}`,
    beat_summary: `Aria enters the Gate in episode ${index + 1}.`,
    hook: `Hook ${index + 1}`,
    beats: [{ beat_no: 1, summary: 'Aria enters the Gate.' }],
    continuity_notes: { characters: ['Aria'], locations: ['Gate'] },
  }));
  const plan = db.prepare(
    `INSERT INTO adaptation_plans
     (drama_id, source_id, target_episode_count, style, plan_json, status, created_at, updated_at)
     VALUES (1, ?, ?, 'anime', ?, 'draft', ?, ?)`
  ).run(sourceId, episodeCount, JSON.stringify({ episodes }), now, now);
  return { sourceId, planId: Number(plan.lastInsertRowid) };
}

function crashAfter(stepKey) {
  return ({ phase, step }) => {
    if (phase !== 'after_step_checkpoint' || step.step_key !== stepKey) return;
    const error = new Error(`simulated process crash after ${stepKey}`);
    error.workflow_process_crash = true;
    throw error;
  };
}

function crashBeforeCheckpoint(stepKey) {
  return ({ phase, step }) => {
    if (phase !== 'after_step_execute_before_checkpoint' || step.step_key !== stepKey) return;
    const error = new Error(`simulated process crash before checkpoint for ${stepKey}`);
    error.workflow_process_crash = true;
    throw error;
  };
}

async function waitForTerminal(db, runId, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = workflowService.getWorkflowRunDetail(db, runId);
    if (run && ['completed', 'failed', 'cancelled'].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return workflowService.getWorkflowRunDetail(db, runId);
}

async function startTextProvider(t, requests, options = {}) {
  const processedKeys = options.processedKeys;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const idempotencyKey = req.headers['idempotency-key'];
      requests.push({
        path: req.url,
        idempotencyKey,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      });
      if (processedKeys && idempotencyKey) processedKeys.add(idempotencyKey);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: '{"approved":true}' } }],
      }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}/v1`;
}

test('production adaptation calls the text provider from skill templates and recovery does not call it twice', async (t) => {
  const db = createDb(t);
  const { sourceId, planId } = insertSourcePlan(db);
  const requests = [];
  const baseUrl = await startTextProvider(t, requests);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO ai_service_configs
     (service_type, provider, api_protocol, name, base_url, api_key, model, default_model, endpoint, is_default, is_active, settings, created_at, updated_at)
     VALUES ('text', 'openai_compatible', 'openai', 'Recovery text', ?, 'token', '["text-model"]', 'text-model', '/chat/completions', 1, 1, '{"allow_local_http":true}', ?, ?)`
  ).run(baseUrl, now, now);
  const run = workflowService.createWorkflowRun(db, log, {
    drama_id: 1,
    qa_mode: 'production',
    source_id: sourceId,
    adaptation_plan_id: planId,
    text_model: 'text-model',
    text_provider: 'openai_compatible',
    steps: [
      { key: 'source_intake', label: 'Source intake' },
      { key: 'adaptation_plan', label: 'Adaptation plan' },
    ],
  });

  await assert.rejects(
    workflowService.processWorkflowRun(db, log, run.id, { faultInjector: crashAfter('adaptation_plan') }),
    /simulated process crash/
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, '/v1/chat/completions');
  assert.equal(requests[0].idempotencyKey, `workflow:${run.id}:step:adaptation_plan:v1`);
  assert.match(requests[0].body.messages[0].content, /localminidrama-source-intake/);
  assert.match(requests[0].body.messages[0].content, /localminidrama-script-adapter/);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM provider_invocations WHERE run_id = ? AND provider_type = 'text'").get(run.id).count, 1);

  assert.equal(workflowService.resumeActiveWorkflowRunsOnStartup(db, log), 1);
  const completed = await waitForTerminal(db, run.id);
  assert.equal(completed.status, 'completed');
  assert.equal(requests.length, 1, 'durable checkpoint must suppress a second paid text call');
  const adaptation = completed.steps.find((step) => step.step_key === 'adaptation_plan');
  assert.equal(adaptation.output_json.mode, 'production');
  assert.match(adaptation.output_json.text_provider.prompt_evidence.source.template_sha256, /^[a-f0-9]{64}$/);
  const skillAudit = db.prepare(
    `SELECT skill_version, template_sha256 FROM skill_invocations
      WHERE run_id = ? AND skill_name = 'localminidrama-script-adapter' ORDER BY id DESC LIMIT 1`
  ).get(run.id);
  assert.equal(skillAudit.skill_version, '1.0.0');
  assert.match(skillAudit.template_sha256, /^[a-f0-9]{64}$/);
});

test('production text retry before checkpoint keeps one provider side effect and one audit record', async (t) => {
  const db = createDb(t);
  const { sourceId, planId } = insertSourcePlan(db);
  const requests = [];
  const processedKeys = new Set();
  const baseUrl = await startTextProvider(t, requests, { processedKeys });
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO ai_service_configs
     (service_type, provider, api_protocol, name, base_url, api_key, model, default_model, endpoint, is_default, is_active, settings, created_at, updated_at)
     VALUES ('text', 'openai_compatible', 'openai', 'Recovery text', ?, 'token', '["text-model"]', 'text-model', '/chat/completions', 1, 1, '{"allow_local_http":true}', ?, ?)`
  ).run(baseUrl, now, now);
  const run = workflowService.createWorkflowRun(db, log, {
    drama_id: 1,
    qa_mode: 'production',
    source_id: sourceId,
    adaptation_plan_id: planId,
    text_model: 'text-model',
    text_provider: 'openai_compatible',
    steps: [
      { key: 'source_intake', label: 'Source intake' },
      { key: 'adaptation_plan', label: 'Adaptation plan' },
    ],
  });

  await assert.rejects(
    workflowService.processWorkflowRun(db, log, run.id, {
      faultInjector: crashBeforeCheckpoint('adaptation_plan'),
    }),
    /simulated process crash before checkpoint/
  );
  const callKey = `workflow:${run.id}:step:adaptation_plan:v1`;
  assert.equal(requests.length, 1);
  assert.equal(requests[0].idempotencyKey, callKey);
  assert.equal(processedKeys.size, 1);

  assert.equal(workflowService.resumeActiveWorkflowRunsOnStartup(db, log), 1);
  const completed = await waitForTerminal(db, run.id);
  assert.equal(completed.status, 'completed');
  assert.equal(requests.length, 2, 'the uncheckpointed provider step must be retried');
  assert.deepEqual(requests.map((request) => request.idempotencyKey), [callKey, callKey]);
  assert.equal(processedKeys.size, 1, 'the provider must deduplicate the stable request key');
  assert.equal(db.prepare(
    "SELECT COUNT(*) AS count FROM provider_invocations WHERE run_id = ? AND provider_type = 'text'"
  ).get(run.id).count, 1);
  assert.equal(db.prepare(
    "SELECT COUNT(*) AS count FROM skill_invocations WHERE run_id = ? AND skill_name = 'localminidrama-script-adapter'"
  ).get(run.id).count, 1);
  assert.equal(db.prepare(
    "SELECT COUNT(*) AS count FROM creative_reviews WHERE run_id = ? AND target_type = 'adaptation_plan'"
  ).get(run.id).count, 1);
});

test('restart recovery does not append adaptation episodes twice', async (t) => {
  const db = createDb(t);
  const { sourceId, planId } = insertSourcePlan(db, 2);
  const run = workflowService.createWorkflowRun(db, log, {
    drama_id: 1,
    source_id: sourceId,
    adaptation_plan_id: planId,
    steps: [
      { key: 'source_intake', label: 'Source intake' },
      { key: 'adaptation_plan', label: 'Adaptation plan' },
      { key: 'apply_episodes', label: 'Apply episodes' },
    ],
  });

  await assert.rejects(
    workflowService.processWorkflowRun(db, log, run.id, { faultInjector: crashBeforeCheckpoint('apply_episodes') }),
    /simulated process crash/
  );
  const countAfterCrash = db.prepare('SELECT COUNT(*) AS count FROM episodes WHERE drama_id = 1 AND deleted_at IS NULL').get().count;
  assert.equal(countAfterCrash, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM workflow_step_effects WHERE call_key = ?').get(
    `workflow:${run.id}:step:apply_episodes:v1`
  ).count, 1);
  workflowService.resumeActiveWorkflowRunsOnStartup(db, log);
  const completed = await waitForTerminal(db, run.id);
  assert.equal(completed.status, 'completed');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM episodes WHERE drama_id = 1 AND deleted_at IS NULL').get().count, 2);
  const applyStep = completed.steps.find((step) => step.step_key === 'apply_episodes');
  assert.equal(applyStep.attempts, 2);
  assert.equal(db.prepare(
    `SELECT COUNT(*) AS count FROM skill_invocations
      WHERE workflow_step_id = ? AND skill_name = 'localminidrama-script-adapter'`
  ).get(applyStep.id).count, 1);
});

test('restart recovery reuses provider side effects after image generation checkpoint', async (t) => {
  const db = createDb(t);
  const { sourceId, planId } = insertSourcePlan(db);
  const run = workflowService.createWorkflowRun(db, log, {
    drama_id: 1,
    source_id: sourceId,
    adaptation_plan_id: planId,
    steps: workflowService.NOVEL2ANIME_STEPS,
  });

  await assert.rejects(
    workflowService.processWorkflowRun(db, log, run.id, { faultInjector: crashAfter('image_generation') }),
    /simulated process crash/
  );
  const generationCount = db.prepare('SELECT COUNT(*) AS count FROM image_generations').get().count;
  const invocationCount = db.prepare(
    "SELECT COUNT(*) AS count FROM provider_invocations WHERE run_id = ? AND provider_type = 'image'"
  ).get(run.id).count;
  assert.ok(generationCount > 0);

  workflowService.resumeActiveWorkflowRunsOnStartup(db, log);
  const completed = await waitForTerminal(db, run.id);
  assert.equal(completed.status, 'completed');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM image_generations').get().count, generationCount);
  assert.equal(db.prepare(
    "SELECT COUNT(*) AS count FROM provider_invocations WHERE run_id = ? AND provider_type = 'image'"
  ).get(run.id).count, invocationCount);
});
