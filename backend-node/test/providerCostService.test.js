const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const aiConfigService = require('../src/services/aiConfigService');
const workflowService = require('../src/services/workflowService');
const {
  estimateTextTokens,
  estimateCost,
  resolveInvocationCost,
  resolveInvocationCostAudit,
} = require('../src/services/providerCostService');

const log = { info() {}, warn() {}, error() {} };

test('estimates each provider unit without rounding away small charges', () => {
  const inputText = 'A short production prompt';
  const outputText = 'A concise result';
  const expectedText = Number((
    (estimateTextTokens(inputText) * 2 + estimateTextTokens(outputText) * 8) / 1_000_000
  ).toFixed(8));

  assert.equal(estimateCost('text', {
    input_per_million_tokens: 2,
    output_per_million_tokens: 8,
  }, { input_text: inputText, output_text: outputText }), expectedText);
  assert.equal(estimateCost('image', { per_image: 0.04 }, { count: 3 }), 0.12);
  assert.equal(estimateCost('asset_image', { per_image: 0.04 }, { count: 2 }), 0.08);
  assert.equal(estimateCost('video', { per_second: 0.15 }, { duration_seconds: 8 }), 1.2);
  assert.equal(estimateCost('tts', { per_1000_characters: 0.02 }, { characters: 2500 }), 0.05);
  assert.equal(estimateCost('compositor', { per_minute: 0.6 }, { duration_seconds: 90 }), 0.9);
});

test('resolves pricing from the matching AI provider configuration', () => {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  test.after(() => db.close());
  aiConfigService.createConfig(db, log, {
    service_type: 'video',
    provider: 'openai',
    name: 'priced video',
    base_url: 'https://provider.example/v1',
    api_key: 'test-only',
    model: ['video-v1'],
    default_model: 'video-v1',
    is_default: true,
    settings: JSON.stringify({ pricing: { per_second: 0.25 } }),
  });

  assert.equal(resolveInvocationCost(db, {
    provider_type: 'video',
    provider_name: 'openai',
    model: 'video-v1',
    mode: 'production',
    status: 'success',
    usage: { duration_seconds: 6 },
  }), 1.5);

  const config = aiConfigService.listConfigs(db, 'video')[0];
  aiConfigService.updateConfig(db, log, config.id, { settings: null });
  assert.equal(aiConfigService.getConfig(db, config.id).settings, null);
});

test('distinguishes unconfigured pricing from non-billable reuse and draft work', () => {
  assert.equal(resolveInvocationCost(null, {
    provider_type: 'video',
    mode: 'production',
    status: 'success',
    usage: { duration_seconds: 6 },
  }), null);
  assert.equal(resolveInvocationCost(null, {
    provider_type: 'video',
    mode: 'production',
    billable: false,
  }), 0);
  assert.equal(resolveInvocationCost(null, {
    provider_type: 'image',
    mode: 'mock',
  }), 0);
  assert.equal(resolveInvocationCost(null, {
    provider_type: 'text',
    mode: 'production',
    status: 'failed',
  }), null);
  assert.deepEqual(resolveInvocationCostAudit(null, {
    provider_type: 'video',
    mode: 'production',
    status: 'success',
    usage: { duration_seconds: 6 },
  }), { cost_estimate: null, cost_kind: 'unknown' });
  assert.deepEqual(resolveInvocationCostAudit(null, {
    provider_type: 'video',
    mode: 'production',
    status: 'success',
    pricing: { per_second: 0 },
    usage: { duration_seconds: 6 },
  }), { cost_estimate: 0, cost_kind: 'estimated' });
  assert.deepEqual(resolveInvocationCostAudit(null, {
    provider_type: 'video',
    mode: 'production',
    status: 'success',
    billable: false,
  }), { cost_estimate: 0, cost_kind: 'non_billable' });
});

test('workflow details expose auditable provider costs without converting unknown cost to zero', () => {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  test.after(() => db.close());
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO dramas (id, title, status, created_at, updated_at) VALUES (1, ?, ?, ?, ?)'
  ).run('Cost summary fixture', 'draft', now, now);
  db.prepare(
    `INSERT INTO workflow_runs
     (id, drama_id, type, status, progress, created_at, updated_at)
     VALUES (?, 1, 'novel2anime', 'completed', 100, ?, ?)`
  ).run('cost-summary-run', now, now);
  const insertInvocation = db.prepare(
    `INSERT INTO provider_invocations
     (run_id, provider_type, provider_name, model, mode, status, cost_estimate, created_at)
     VALUES (?, ?, 'openai', 'test-model', 'production', 'success', ?, ?)`
  );
  insertInvocation.run('cost-summary-run', 'text', 0.00003, now);
  insertInvocation.run('cost-summary-run', 'video', null, now);
  insertInvocation.run('cost-summary-run', 'tts', 0, now);

  const detail = workflowService.getWorkflowRunDetail(db, 'cost-summary-run');
  assert.equal(detail.provider_invocations[0].cost_estimate, 0.00003);
  assert.equal(detail.provider_invocations[0].cost_kind, 'estimated');
  assert.equal(detail.provider_invocations[1].cost_estimate, null);
  assert.equal(detail.provider_invocations[1].cost_kind, 'unknown');
  assert.equal(detail.provider_invocations[2].cost_estimate, null);
  assert.equal(detail.provider_invocations[2].cost_kind, 'unknown');
});
