const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const aiConfigRoutes = require('../src/routes/aiConfig');
const sceneModelMapRoutes = require('../src/routes/sceneModelMap');
const aiConfigService = require('../src/services/aiConfigService');
const videoClient = require('../src/services/videoClient');

const log = {
  info() {},
  warn() {},
  error() {},
  errorw() {},
};

function createDb(t) {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  t.after(() => db.close());
  return db;
}

function response() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function configRequest(overrides = {}) {
  return {
    service_type: 'video',
    name: '写后确认测试',
    provider: 'minimax',
    api_protocol: 'minimax',
    base_url: 'https://api.minimaxi.com/v1',
    api_key: 'fixture-key-original',
    endpoint: '/video_generation',
    query_endpoint: '/query/video_generation/{taskId}',
    model: ['MiniMax-Hailuo-2.3'],
    default_model: 'MiniMax-Hailuo-2.3',
    is_default: true,
    ...overrides,
  };
}

test('single AI config update returns a persisted snapshot and rejects stale overwrites', (t) => {
  const db = createDb(t);
  const routes = aiConfigRoutes(db, log, {});
  const createdResponse = response();
  routes.create({ body: configRequest() }, createdResponse);
  assert.equal(createdResponse.statusCode, 201);
  const created = createdResponse.body.data;
  assert.equal(created.provider, 'minimax');
  assert.deepEqual(created.model, ['MiniMax-Hailuo-2.3']);
  assert.equal(created.api_key, '********');
  assert.equal(created.api_key_set, true);
  assert.ok(created.updated_at);

  const updateResponse = response();
  routes.update({
    params: { id: String(created.id) },
    body: {
      expected_updated_at: created.updated_at,
      provider: 'minimax',
      api_protocol: 'minimax',
      model: ['MiniMax-Hailuo-2.3', 'MiniMax-Hailuo-2.3-Fast'],
      default_model: 'MiniMax-Hailuo-2.3-Fast',
      api_key: 'fixture-key-updated',
    },
  }, updateResponse);
  assert.equal(updateResponse.statusCode, 200);
  const updated = updateResponse.body.data;
  assert.notEqual(updated.updated_at, created.updated_at);
  assert.equal(updated.provider, 'minimax');
  assert.deepEqual(updated.model, ['MiniMax-Hailuo-2.3', 'MiniMax-Hailuo-2.3-Fast']);
  assert.equal(updated.default_model, 'MiniMax-Hailuo-2.3-Fast');
  assert.equal(updated.api_key, '********');
  assert.equal(updated.api_key_set, true);

  const staleResponse = response();
  routes.update({
    params: { id: String(created.id) },
    body: {
      expected_updated_at: created.updated_at,
      provider: 'openai',
      api_protocol: 'sora',
      model: ['sora-2'],
      default_model: 'sora-2',
      api_key: 'fixture-key-stale',
    },
  }, staleResponse);
  assert.equal(staleResponse.statusCode, 409);
  assert.equal(staleResponse.body.error.code, 'AI_CONFIG_CONFLICT');
  const persisted = aiConfigService.getConfig(db, created.id);
  assert.equal(persisted.provider, 'minimax');
  assert.equal(persisted.api_key, 'fixture-key-updated');

  const typeChangeResponse = response();
  routes.update({
    params: { id: String(created.id) },
    body: {
      expected_updated_at: updated.updated_at,
      service_type: 'text',
      provider: 'openai_compatible',
      model: ['model-a'],
      default_model: 'model-a',
    },
  }, typeChangeResponse);
  assert.equal(typeChangeResponse.statusCode, 400);
  assert.deepEqual(typeChangeResponse.body.error.details, {
    field: 'service_type',
    issue: 'immutable',
  });
});

test('bulk key update returns per-config persisted revisions without returning key material', (t) => {
  const db = createDb(t);
  aiConfigService.createConfig(db, log, configRequest({ name: '一号配置' }));
  aiConfigService.createConfig(db, log, configRequest({
    name: '二号配置',
    provider: 'openai',
    api_protocol: 'sora',
    base_url: 'https://api.openai.example/v1',
    api_key: 'fixture-key-two',
    model: ['sora-2'],
    default_model: 'sora-2',
  }));
  const routes = aiConfigRoutes(db, log, { vendor_lock: { enabled: true } });
  const bulkResponse = response();
  routes.bulkUpdateKey({ body: { api_key: 'fixture-key-bulk' } }, bulkResponse);
  assert.equal(bulkResponse.statusCode, 200);
  const result = bulkResponse.body.data;
  assert.equal(result.updated, 2);
  assert.equal(result.confirmations.length, 2);
  assert.ok(result.confirmations.every((item) => item.api_key_set && item.updated_at));
  assert.equal(JSON.stringify(result).includes('fixture-key-bulk'), false);

  const rows = db.prepare(
    'SELECT id, api_key, updated_at FROM ai_service_configs WHERE deleted_at IS NULL ORDER BY id'
  ).all();
  assert.deepEqual(rows.map((row) => row.api_key), ['fixture-key-bulk', 'fixture-key-bulk']);
  assert.deepEqual(
    rows.map((row) => ({ id: row.id, updated_at: row.updated_at })),
    result.confirmations.map(({ id, updated_at }) => ({ id, updated_at })),
  );
});

test('scene model mappings reject cross-service and ambiguous provider/model bindings', (t) => {
  const db = createDb(t);
  const textOne = aiConfigService.createConfig(db, log, configRequest({
    service_type: 'text',
    name: '文本一',
    provider: 'openai_compatible',
    api_protocol: 'openai',
    base_url: 'https://text-one.example/v1',
    model: ['shared-model'],
    default_model: 'shared-model',
  }));
  aiConfigService.createConfig(db, log, configRequest({
    service_type: 'text',
    name: '文本二',
    provider: 'openrouter',
    api_protocol: 'openai',
    base_url: 'https://text-two.example/v1',
    model: ['shared-model'],
    default_model: 'shared-model',
  }));
  const image = aiConfigService.createConfig(db, log, configRequest({
    service_type: 'image',
    name: '图片配置',
    provider: 'openai',
    api_protocol: 'openai',
    base_url: 'https://image.example/v1',
    model: ['image-model'],
    default_model: 'image-model',
  }));
  const routes = sceneModelMapRoutes(db, log);

  const crossService = response();
  routes.create({
    body: { key: 'cross-service', service_type: 'text', config_id: image.id, model_override: 'image-model' },
  }, crossService);
  assert.equal(crossService.statusCode, 400);
  assert.equal(crossService.body.error.details.issue, 'service_type_mismatch');

  const wrongModel = response();
  routes.create({
    body: { key: 'wrong-model', service_type: 'text', config_id: textOne.id, model_override: 'not-listed' },
  }, wrongModel);
  assert.equal(wrongModel.statusCode, 400);
  assert.equal(wrongModel.body.error.details.issue, 'not_in_config_model_list');

  const ambiguous = response();
  routes.create({
    body: { key: 'ambiguous-model', service_type: 'text', model_override: 'shared-model' },
  }, ambiguous);
  assert.equal(ambiguous.statusCode, 400);
  assert.equal(ambiguous.body.error.details.issue, 'ambiguous_model_provider');
});

test('persisted AI config fields feed the same provider protocol used at runtime', (t) => {
  const db = createDb(t);
  const routes = aiConfigRoutes(db, log, {});
  const createdResponse = response();
  routes.create({
    body: configRequest({
      name: '历史 Sora 配置',
      provider: 'openai',
      api_protocol: '',
      base_url: 'https://api.openai.com/v1',
      endpoint: '/videos',
      query_endpoint: '/videos/{taskId}',
      model: ['sora-2'],
      default_model: 'sora-2',
    }),
  }, createdResponse);
  assert.equal(createdResponse.statusCode, 201);
  const saved = aiConfigService.getConfig(db, createdResponse.body.data.id);
  assert.equal(videoClient.resolveVideoProtocol(saved), 'sora');
  assert.equal(videoClient.resolveVideoProtocol({
    ...saved,
    provider: 'openai_compatible',
    base_url: 'https://gateway.example/v1',
    api_protocol: '',
  }), 'openai');
});
