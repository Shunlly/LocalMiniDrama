const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const aiClient = require('../src/services/aiClient');
const aiConfigService = require('../src/services/aiConfigService');
const imageClient = require('../src/services/imageClient');

const originalListConfigs = aiConfigService.listConfigs;
const servers = [];

afterEach(async () => {
  aiConfigService.listConfigs = originalListConfigs;
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

async function startServer(handler) {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

function fakeDb(modelMaps = {}) {
  return {
    prepare(sql) {
      assert.match(sql, /ai_model_map/);
      return { get: (key) => modelMaps[key] || null };
    },
  };
}

function config(overrides) {
  return {
    id: 1,
    service_type: 'text',
    provider: 'openai',
    base_url: 'http://unused.invalid/v1',
    endpoint: '/chat/completions',
    api_key: 'cloud-key',
    model: ['cloud-default'],
    default_model: 'cloud-default',
    is_active: true,
    is_default: false,
    ...overrides,
  };
}

const log = {
  info() {},
  warn() {},
  error() {},
};

describe('AI production routing', () => {
  it('uses exact scene service/config routing and deterministic fallbacks', () => {
    const configs = {
      text: [
        config({ id: 10, is_default: true, model: ['shared-model', 'cloud-default'] }),
        config({
          id: 20,
          provider: 'custom-gateway',
          model: ['shared-model', 'custom-model'],
          default_model: 'custom-model',
          api_key: 'custom-key',
        }),
      ],
      image: [config({ id: 30, service_type: 'image', provider: 'image-provider', model: ['image-model'] })],
    };
    aiConfigService.listConfigs = (_db, serviceType) => configs[serviceType] || [];
    const db = fakeDb({
      exact: { key: 'exact', service_type: 'text', config_id: 20, model_override: 'custom-model' },
      missing_config: { key: 'missing_config', service_type: 'text', config_id: 999, model_override: null },
      wrong_type: { key: 'wrong_type', service_type: 'image', config_id: 30, model_override: 'image-model' },
    });

    const exact = aiClient.resolveTextRoute(db, 'text', { scene_key: 'exact' });
    assert.equal(exact.source, 'scene_key');
    assert.equal(exact.config.id, 20);
    assert.equal(aiClient.getModelFromConfig(exact.config, exact.modelOverride), 'custom-model');

    const missingConfig = aiClient.resolveTextRoute(db, 'text', { scene_key: 'missing_config' });
    assert.equal(missingConfig.config.id, 10);
    assert.equal(aiClient.getModelFromConfig(missingConfig.config), 'cloud-default');

    const wrongType = aiClient.resolveTextRoute(db, 'text', { scene_key: 'wrong_type' });
    assert.equal(wrongType.source, 'default');
    assert.equal(wrongType.config.id, 10);

    const duplicateModel = aiClient.resolveTextRoute(db, 'text', { model: 'shared-model' });
    assert.equal(duplicateModel.config.id, 10, 'the active default disambiguates duplicate cloud/custom model names');
  });

  it('does not silently use another provider when an explicit custom provider is absent', () => {
    aiConfigService.listConfigs = () => [config({ id: 10, is_default: true })];
    const db = fakeDb();

    assert.equal(
      aiClient.resolveTextRoute(db, 'text', { provider: 'missing-custom-provider', model: 'cloud-default' }),
      null
    );
    assert.equal(
      imageClient.getDefaultImageConfig(db, null, 'missing-custom-provider', 'image'),
      null
    );
  });

  it('rejects an ambiguous cross-provider model when no default can disambiguate it', () => {
    aiConfigService.listConfigs = () => [
      config({ id: 1, provider: 'cloud-a', model: ['same-name'], is_default: false }),
      config({ id: 2, provider: 'custom-gateway', model: ['same-name'], is_default: false }),
    ];
    assert.equal(aiClient.resolveTextRoute(fakeDb(), 'text', { model: 'same-name' }), null);
    assert.equal(imageClient.getDefaultImageConfig(fakeDb(), 'same-name', null, 'image'), null);
  });

  it('routes Ollama through its OpenAI-compatible /v1 endpoint without an empty Authorization header', async () => {
    let received = null;
    const baseUrl = await startServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      received = {
        method: req.method,
        path: req.url,
        authorization: req.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      };
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end([
        'data: {"choices":[{"delta":{"content":"local "}}]}',
        '',
        'data: {"choices":[{"delta":{"content":"answer"}}]}',
        '',
        'data: [DONE]',
        '',
      ].join('\n'));
    });
    aiConfigService.listConfigs = () => [config({
      id: 40,
      provider: 'ollama',
      base_url: `${baseUrl}/v1`,
      api_key: '',
      model: ['qwen3:8b'],
      default_model: 'qwen3:8b',
      is_default: true,
      settings: JSON.stringify({ allow_local_http: true }),
    })];

    const text = await aiClient.generateText(fakeDb(), log, 'text', 'hello', 'system', {
      model: 'not-installed',
      temperature: 0.2,
    });

    assert.equal(text, 'local answer');
    assert.equal(received.method, 'POST');
    assert.equal(received.path, '/v1/chat/completions');
    assert.equal(received.authorization, undefined);
    assert.equal(received.body.model, 'qwen3:8b', 'an unavailable preferred model falls back to default_model');
    assert.equal(received.body.stream, true);
  });

  it('does not send a stored key from a legacy public HTTP provider config', async () => {
    let lookupCalls = 0;
    aiConfigService.listConfigs = () => [config({
      id: 50,
      provider: 'openai',
      base_url: 'http://provider.example/v1',
      api_key: 'stored-secret-must-not-be-sent',
      is_default: true,
    })];

    await assert.rejects(
      aiClient.generateText(fakeDb(), log, 'text', 'private prompt', 'private system', {
        provider_dns_lookup: async () => {
          lookupCalls += 1;
          return [{ address: '93.184.216.34', family: 4 }];
        },
      }),
      (error) => error?.code === 'INVALID_PROVIDER_URL' && /HTTPS/.test(error.message)
    );
    assert.equal(lookupCalls, 0);
  });
});
