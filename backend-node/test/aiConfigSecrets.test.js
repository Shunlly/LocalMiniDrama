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
  it('rejects credential-bearing base URLs and sanitizes legacy rows in responses', () => {
    assert.throws(
      () => aiConfigService.normalizeProviderBaseUrl('https://user:pass@provider.example/v1'),
      (error) => error.code === 'INVALID_PROVIDER_URL' && error.status === 400
    );
    assert.throws(
      () => aiConfigService.normalizeProviderBaseUrl('https://provider.example/v1?token=private-value'),
      (error) => error.code === 'INVALID_PROVIDER_URL'
    );
    const responseConfig = aiConfigService.configForResponse({
      base_url: 'https://user:pass@provider.example/v1?token=private-value#fragment',
      api_key: '',
    });
    assert.equal(responseConfig.base_url, 'https://provider.example/v1');
    assert.equal(JSON.stringify(responseConfig).includes('private-value'), false);
  });

  it('rejects endpoint credentials and sanitizes legacy endpoint and settings URLs', () => {
    for (const endpoint of [
      'https://provider.example/v1/chat',
      '//provider.example/v1/chat',
      '/chat/completions?api_key=private-value',
      '/chat/completions?sig=private-value',
      '/chat/completions?unknown=private-value',
      '/tasks/{taskId}?X-Amz-Signature=private-value',
      '/safe/../admin',
    ]) {
      assert.throws(
        () => aiConfigService.normalizeProviderEndpoint(endpoint),
        (error) => error.code === 'INVALID_PROVIDER_URL' && error.status === 400,
        endpoint
      );
    }
    assert.equal(
      aiConfigService.normalizeProviderEndpoint('/chat/completions?api-version=2026-01-01'),
      '/chat/completions?api-version=2026-01-01'
    );

    const marker = 'fixture-endpoint-secret';
    const responseConfig = aiConfigService.configForResponse({
      endpoint: `/chat/completions?api_key=${marker}&api-version=1`,
      query_endpoint: `/tasks/{taskId}?signature=${marker}&view=summary`,
      api_key: '',
      settings: JSON.stringify({
        callback_url: `https://callback.example/result?token=${marker}`,
        relative_url: `/events?authorization=${marker}&view=summary`,
        protocol_relative_url: `//user:pass@callback.example/result?sig=${marker}#fragment`,
        bare_relative_url: `v1/events?sig=${marker}&view=summary`,
        embedded_url: `callback=v1/events?sig=${marker}&view=summary`,
        sig: marker,
        signature: marker,
        safe: 'visible',
      }),
    });
    assert.equal(responseConfig.endpoint, '/chat/completions?api-version=1');
    assert.equal(responseConfig.query_endpoint, '/tasks/{taskId}?view=summary');
    const settings = JSON.parse(responseConfig.settings);
    assert.equal(settings.callback_url, 'https://callback.example/result');
    assert.equal(settings.relative_url, '/events?view=summary');
    assert.equal(settings.protocol_relative_url, '//callback.example/result');
    assert.equal(settings.bare_relative_url, 'v1/events?view=summary');
    assert.equal(settings.embedded_url, 'callback=v1/events?view=summary');
    assert.equal(settings.sig, '********');
    assert.equal(settings.signature, '********');
    assert.equal(settings.safe, 'visible');
    assert.equal(JSON.stringify(responseConfig).includes(marker), false);
  });

  it('rejects credential-bearing endpoints on create and update', () => {
    const db = createDb();
    const base = {
      service_type: 'text',
      provider: 'openai_compatible',
      name: 'Endpoint policy',
      base_url: 'https://provider.example/v1',
      api_key: 'fixture-secret',
      model: ['model-a'],
    };
    assert.throws(
      () => aiConfigService.createConfig(db, log, { ...base, endpoint: '/chat?token=fixture-secret' }),
      (error) => error.code === 'INVALID_PROVIDER_URL'
    );
    assert.throws(
      () => aiConfigService.createConfig(db, log, { ...base, endpoint: '/chat?sig=fixture-secret' }),
      (error) => error.code === 'INVALID_PROVIDER_URL'
    );
    assert.throws(
      () => aiConfigService.createConfig(db, log, { ...base, endpoint: '/chat?unknown=fixture-secret' }),
      (error) => error.code === 'INVALID_PROVIDER_URL'
    );
    const created = aiConfigService.createConfig(db, log, { ...base, endpoint: '/chat' });
    assert.throws(
      () => aiConfigService.updateConfig(db, log, created.id, { query_endpoint: '/tasks/{taskId}?signature=fixture-secret' }),
      (error) => error.code === 'INVALID_PROVIDER_URL'
    );
    assert.equal(aiConfigService.getConfig(db, created.id).query_endpoint, '');
  });

  it('requires a recognized local provider and explicit allow_local_http switch', () => {
    const db = createDb();
    const baseConfig = {
      service_type: 'text',
      name: 'Local Provider',
      base_url: 'http://127.0.0.1:11434/v1',
      api_key: 'stored-secret',
      model: ['local-model'],
    };

    assert.throws(
      () => aiConfigService.createConfig(db, log, { ...baseConfig, provider: 'ollama' }),
      (error) => error.code === 'INVALID_PROVIDER_URL'
    );
    assert.throws(
      () => aiConfigService.createConfig(db, log, {
        ...baseConfig,
        provider: 'openai',
        settings: JSON.stringify({ allow_local_http: true }),
      }),
      (error) => error.code === 'INVALID_PROVIDER_URL'
    );
    assert.throws(
      () => aiConfigService.createConfig(db, log, {
        ...baseConfig,
        provider: 'ollama',
        base_url: 'https://169.254.169.254/latest',
        settings: JSON.stringify({ allow_local_http: true }),
      }),
      (error) => error.code === 'INVALID_PROVIDER_URL'
    );

    const created = aiConfigService.createConfig(db, log, {
      ...baseConfig,
      provider: 'ollama',
      settings: JSON.stringify({ allow_local_http: true }),
    });
    assert.equal(created.base_url, 'http://127.0.0.1:11434/v1');
  });

  it('rejects public HTTP on create and preserves credentials when an unsafe update fails', () => {
    const db = createDb();
    const request = {
      service_type: 'text',
      provider: 'openai_compatible',
      name: 'Cloud Provider',
      base_url: 'http://provider.example/v1',
      api_key: 'stored-secret',
      model: ['model-a'],
    };
    assert.throws(
      () => aiConfigService.createConfig(db, log, request),
      (error) => error.code === 'INVALID_PROVIDER_URL' && /HTTPS/.test(error.message)
    );

    const created = aiConfigService.createConfig(db, log, {
      ...request,
      base_url: 'https://provider.example/v1',
    });
    assert.throws(
      () => aiConfigService.updateConfig(db, log, created.id, {
        base_url: 'http://new-provider.example/v1',
        api_key: '********',
      }),
      (error) => error.code === 'INVALID_PROVIDER_URL'
    );
    assert.throws(
      () => aiConfigService.updateConfig(db, log, created.id, {
        provider: 'openai_compatible',
        base_url: 'http://127.0.0.1:8080/v1',
        api_key: '********',
        settings: JSON.stringify({ allow_local_http: true }),
      }),
      (error) => error.code === 'INVALID_PROVIDER_URL' && /已保存的凭据/.test(error.message)
    );
    const unchanged = aiConfigService.getConfig(db, created.id);
    assert.equal(unchanged.base_url, 'https://provider.example/v1');
    assert.equal(unchanged.api_key, 'stored-secret');
  });

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
    assert.equal(masked.credential_set, true);
    const settings = JSON.parse(masked.settings);
    assert.equal(settings.access_key_id, '********');
    assert.equal(settings.secret_access_key, '********');
    assert.equal(settings.max_tokens, 2048);
    assert.equal(settings.nested.token, '********');
    assert.equal(settings.nested.safe, 'visible');
  });

  it('does not treat the UI mask sentinel as a stored credential', () => {
    const masked = aiConfigService.configForResponse({
      api_key: '********',
      settings: JSON.stringify({
        kling_access_key: '********',
        kling_secret_key: '********',
      }),
    });

    assert.equal(masked.api_key_set, false);
    assert.equal(masked.credential_set, false);
    assert.equal(aiConfigService.hasStoredCredentials({
      api_key: '',
      settings: JSON.stringify({
        kling_access_key: 'synthetic-ak',
        kling_secret_key: 'synthetic-sk',
      }),
    }), true);
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

  it('masks custom authorization and credential fields while preserving token budgets', () => {
    const masked = aiConfigService.configForResponse({
      id: 1,
      api_key: 'fixture-api-value',
      proxyAuthorization: 'fixture-proxy-value',
      clientCredential: 'fixture-client-value',
      settings: JSON.stringify({
        headers: {
          Authorization: 'Bearer fixture-auth-value',
          'X-Auth': 'fixture-x-auth-value',
          Authentication: 'fixture-authentication-value',
          Cookie: 'session=fixture-cookie-value',
          'Proxy-Authorization': 'Basic fixture-proxy-header',
          'X-Api-Key': 'fixture-header-key',
          'X-Client-Credential': 'fixture-header-credential',
          Accept: 'application/json',
        },
        password: 'fixture-password',
        refreshToken: 'fixture-refresh-token',
        signingSecret: 'fixture-signing-secret',
        privateKey: 'fixture-private-key',
        apikey: 'fixture-compact-api-key',
        clientcredential: 'fixture-compact-client-credential',
        maxTokens: 4096,
        max_tokens: 2048,
        maxcompletiontokens: 3072,
        tokenBudget: 8192,
        keyframes: true,
        key_frame_mode: 'first-last',
        scene_key: 'image-polish',
        nested: [{ sessionToken: 'fixture-session-token', outputTokens: 512 }],
        header_list: [
          { name: 'X-Custom-Auth', value: 'fixture-header-list-secret' },
          { name: 'Accept', value: 'application/json' },
        ],
      }),
    });

    assert.equal(masked.proxyAuthorization, '********');
    assert.equal(masked.clientCredential, '********');
    const settings = JSON.parse(masked.settings);
    assert.equal(settings.headers.Authorization, '********');
    assert.equal(settings.headers['X-Auth'], '********');
    assert.equal(settings.headers.Authentication, '********');
    assert.equal(settings.headers.Cookie, '********');
    assert.equal(settings.headers['Proxy-Authorization'], '********');
    assert.equal(settings.headers['X-Api-Key'], '********');
    assert.equal(settings.headers['X-Client-Credential'], '********');
    assert.equal(settings.headers.Accept, 'application/json');
    assert.equal(settings.password, '********');
    assert.equal(settings.refreshToken, '********');
    assert.equal(settings.signingSecret, '********');
    assert.equal(settings.privateKey, '********');
    assert.equal(settings.apikey, '********');
    assert.equal(settings.clientcredential, '********');
    assert.equal(settings.maxTokens, 4096);
    assert.equal(settings.max_tokens, 2048);
    assert.equal(settings.maxcompletiontokens, 3072);
    assert.equal(settings.tokenBudget, 8192);
    assert.equal(settings.keyframes, true);
    assert.equal(settings.key_frame_mode, 'first-last');
    assert.equal(settings.scene_key, 'image-polish');
    assert.equal(settings.nested[0].sessionToken, '********');
    assert.equal(settings.nested[0].outputTokens, 512);
    assert.equal(settings.header_list[0].name, 'X-Custom-Auth');
    assert.equal(settings.header_list[0].value, '********');
    assert.equal(settings.header_list[1].value, 'application/json');
  });

  it('removes credentials from bare and embedded relative URL variants', () => {
    const marker = 'LMD_SYNTHETIC_URL_BYPASS_MARKER';
    const masked = aiConfigService.configForResponse({
      id: 1,
      settings: JSON.stringify({
        bare_query: `events?sig=${marker}`,
        assignment: `callback=events?unknown=${marker}`,
        bracketed_protocol_relative: `note:[//user:pass@host.example/path?sig=${marker}]`,
        colon_prefixed_path: `note:v1/path?sig=${marker}`,
        allowed_query: `events?version=1&sig=${marker}`,
      }),
    });

    const settings = JSON.parse(masked.settings);
    assert.equal(settings.bare_query, 'events');
    assert.equal(settings.assignment, 'callback=events');
    assert.equal(settings.bracketed_protocol_relative, 'note:[//host.example/path]');
    assert.equal(settings.colon_prefixed_path, 'note:v1/path');
    assert.equal(settings.allowed_query, 'events?version=1');
    assert.equal(masked.settings.includes(marker), false);
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

  it('keeps reads side-effect free and enforces a single default in write transactions', () => {
    const db = createDb();
    const create = (name, priority) => aiConfigService.createConfig(db, log, {
      service_type: 'text',
      provider: 'openai_compatible',
      name,
      base_url: 'https://provider.example/v1',
      api_key: 'fixture-secret',
      model: ['model-a'],
      priority,
      is_default: true,
    });
    const first = create('First', 1);
    const second = create('Second', 2);
    assert.deepEqual(
      db.prepare('SELECT id FROM ai_service_configs WHERE deleted_at IS NULL AND is_default = 1').all(),
      [{ id: second.id }]
    );

    aiConfigService.updateConfig(db, log, first.id, { is_default: true });
    assert.deepEqual(
      db.prepare('SELECT id FROM ai_service_configs WHERE deleted_at IS NULL AND is_default = 1').all(),
      [{ id: first.id }]
    );

    db.exec(`
      CREATE TRIGGER reject_default_update
      BEFORE UPDATE ON ai_service_configs
      WHEN NEW.name = 'forced-update-failure'
      BEGIN
        SELECT RAISE(ABORT, 'forced update failure');
      END;
    `);
    assert.throws(
      () => aiConfigService.updateConfig(db, log, second.id, {
        name: 'forced-update-failure',
        is_default: true,
      }),
      /forced update failure/
    );
    db.exec('DROP TRIGGER reject_default_update');
    assert.deepEqual(
      db.prepare('SELECT id FROM ai_service_configs WHERE deleted_at IS NULL AND is_default = 1').all(),
      [{ id: first.id }]
    );
    assert.equal(db.prepare('SELECT is_default FROM ai_service_configs WHERE id = ?').get(second.id).is_default, 0);

    assert.throws(
      () => db.prepare('UPDATE ai_service_configs SET is_default = 1 WHERE id = ?').run(second.id),
      /UNIQUE constraint failed/
    );

    const changesBefore = db.prepare('SELECT total_changes() AS count').get().count;
    aiConfigService.listConfigs(db);
    aiConfigService.getConfig(db, first.id);
    const changesAfter = db.prepare('SELECT total_changes() AS count').get().count;
    assert.equal(changesAfter, changesBefore);
  });

  it('preserves masked custom headers when an API response is saved again', () => {
    const db = createDb();
    const created = aiConfigService.createConfig(db, log, {
      service_type: 'image',
      provider: 'comfyui',
      name: 'ComfyUI',
      base_url: 'http://127.0.0.1:8188',
      api_key: '',
      model: ['workflow'],
      settings: JSON.stringify({
        allow_local_http: true,
        headers: {
          Authorization: 'Bearer fixture-auth-value',
          Cookie: 'session=fixture-cookie-value',
          'X-Client-Credential': 'fixture-client-value',
        },
        maxTokens: 1024,
      }),
    });
    const responseSettings = JSON.parse(aiConfigService.configForResponse(created).settings);
    responseSettings.maxTokens = 2048;

    const updated = aiConfigService.updateConfig(db, log, created.id, {
      settings: JSON.stringify(responseSettings),
    });
    const settings = JSON.parse(updated.settings);
    assert.equal(settings.headers.Authorization, 'Bearer fixture-auth-value');
    assert.equal(settings.headers.Cookie, 'session=fixture-cookie-value');
    assert.equal(settings.headers['X-Client-Credential'], 'fixture-client-value');
    assert.equal(settings.maxTokens, 2048);
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
      assert.deepEqual(captured.model, ['model-a']);
      assert.equal(captured.default_model, 'model-a');
    } finally {
      aiConfigService.testConnection = original;
    }
  });
});
