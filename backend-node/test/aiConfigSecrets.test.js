const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const aiConfigService = require('../src/services/aiConfigService');
const aiConfigRoutes = require('../src/routes/aiConfig');

const log = {
  info() {},
  warn() {},
  error() {},
  errorw() {},
};

function mockResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function createDb() {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  return db;
}

describe('aiConfigService secret handling', () => {
  it('masks api_key and sensitive settings in API responses', () => {
    const config = {
      id: 1,
      api_key: 'sk-real-secret',
      settings: JSON.stringify({
        access_key_id: 'ak-real',
        secret_access_key: 'sk-real',
        max_tokens: 2048,
        nested: { token: 'token-real', safe: 'visible' },
      }),
    };

    const masked = aiConfigService.configForResponse(config);

    assert.equal(masked.api_key, '********');
    assert.equal(masked.api_key_set, true);
    const settings = JSON.parse(masked.settings);
    assert.equal(settings.access_key_id, '********');
    assert.equal(settings.secret_access_key, '********');
    assert.equal(settings.max_tokens, 2048);
    assert.equal(settings.nested.token, '********');
    assert.equal(settings.nested.safe, 'visible');
  });

  it('masks secret-like values even when stored settings are malformed text', () => {
    const masked = aiConfigService.configForResponse({
      id: 1,
      api_key: '',
      settings: 'api_key=sk-malformed-value secret_access_key:secret-value safe=visible',
    });

    assert.equal(masked.settings.includes('sk-malformed-value'), false);
    assert.equal(masked.settings.includes('secret-value'), false);
    assert.equal(masked.settings.includes('safe=visible'), true);
  });

  it('does not overwrite stored api_key or settings secrets with masked placeholders', () => {
    const db = createDb();
    const created = aiConfigService.createConfig(db, log, {
      service_type: 'model_ark_asset',
      provider: 'model_ark',
      name: 'ModelArk',
      base_url: 'https://ark.example.com/api/v3',
      api_key: 'bearer-real',
      model: ['-'],
      default_model: '-',
      settings: JSON.stringify({
        auth_mode: 'volc_sign',
        access_key_id: 'ak-real',
        secret_access_key: 'sk-real',
        project_name: 'old-project',
      }),
    });

    const updated = aiConfigService.updateConfig(db, log, created.id, {
      api_key: '********',
      settings: JSON.stringify({
        auth_mode: 'volc_sign',
        access_key_id: '********',
        secret_access_key: '********',
        project_name: 'new-project',
      }),
    });

    assert.equal(updated.api_key, 'bearer-real');
    const settings = JSON.parse(updated.settings);
    assert.equal(settings.access_key_id, 'ak-real');
    assert.equal(settings.secret_access_key, 'sk-real');
    assert.equal(settings.project_name, 'new-project');
  });

  it('test connection handler reuses saved secrets when only config id and mask are sent', async () => {
    const db = createDb();
    const created = aiConfigService.createConfig(db, log, {
      service_type: 'text',
      provider: 'openai-compatible',
      name: 'Saved Provider',
      base_url: 'https://provider.example.com/v1',
      api_key: 'saved-secret',
      model: ['model-a'],
      default_model: 'model-a',
      settings: JSON.stringify({ timeout: 1000 }),
    });
    const original = aiConfigService.testConnection;
    let captured = null;
    aiConfigService.testConnection = async (opts) => {
      captured = opts;
      return true;
    };

    try {
      const routes = aiConfigRoutes(db, log, { ai: {} });
      const res = mockResponse();
      await routes.testConnection({
        body: {
          id: created.id,
          api_key: '********',
          model: 'model-a',
        },
      }, res);

      assert.equal(res.statusCode, 200);
      assert.equal(captured.api_key, 'saved-secret');
      assert.equal(captured.base_url, 'https://provider.example.com/v1');
      assert.equal(captured.model, 'model-a');
    } finally {
      aiConfigService.testConnection = original;
    }
  });
});
