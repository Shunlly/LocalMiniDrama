const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const aiConfigService = require('../src/services/aiConfigService');
const aiConfigRoutes = require('../src/routes/aiConfig');
const { isTrustedChineseUserError } = require('../src/services/providerErrorSanitizer');

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

const log = {
  info() {},
  warn() {},
  error() {},
  errorw() {},
};

function createDb() {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  return db;
}

function mockResponse() {
  return {
    statusCode: null,
    body: null,
    writableEnded: false,
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

function discoverOpts(overrides = {}) {
  return {
    base_url: 'https://provider.example.com/v1',
    api_key: 'saved-secret',
    provider: 'openai_compatible',
    service_type: 'text',
    provider_dns_lookup: publicLookup,
    ...overrides,
  };
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('aiConfigService.discoverModels', () => {
  it('parses data[] and drops empty, oversized, or secret-like ids', async () => {
    const calls = [];
    const result = await aiConfigService.discoverModels(discoverOpts({
      fetch_impl: async (url, options) => {
        calls.push({ url, method: options.method, authorization: options.headers.Authorization });
        return jsonResponse({
          data: [
            { id: 'gpt-4o', name: 'GPT-4o' },
            { id: '' },
            { id: 'sk-discover-secret-123456' },
            { id: 'a'.repeat(200) },
            { id: '../etc/passwd' },
            { id: 'gpt-4o-mini' },
            { id: 'gpt-4o' },
          ],
        });
      },
    }));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://provider.example.com/v1/models');
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[0].authorization, 'Bearer saved-secret');
    assert.deepEqual(result.models, [
      { id: 'gpt-4o', name: 'GPT-4o' },
      { id: 'gpt-4o-mini' },
    ]);
  });

  it('parses models[] and appends /v1/models when base url has no version suffix', async () => {
    const calls = [];
    const result = await aiConfigService.discoverModels(discoverOpts({
      base_url: 'https://provider.example.com',
      fetch_impl: async (url) => {
        calls.push(url);
        return jsonResponse({
          models: [
            { name: 'qwen3:8b' },
            { id: 'local-model', name: 'Local Model' },
          ],
        });
      },
    }));
    assert.deepEqual(calls, ['https://provider.example.com/v1/models']);
    assert.deepEqual(result.models, [
      { id: 'qwen3:8b' },
      { id: 'local-model', name: 'Local Model' },
    ]);
  });

  it('caps discovered models at 200', async () => {
    const rows = Array.from({ length: 201 }, (_, index) => ({ id: `model-${index}` }));
    const result = await aiConfigService.discoverModels(discoverOpts({
      fetch_impl: async () => jsonResponse({ data: rows }),
    }));
    assert.equal(result.models.length, 200);
    assert.equal(result.models[0].id, 'model-0');
    assert.equal(result.models[199].id, 'model-199');
  });

  it('maps timeout to a trusted Chinese error without leaking the key', async () => {
    const secret = 'sk-discover-timeout-secret';
    await assert.rejects(
      aiConfigService.discoverModels(discoverOpts({
        api_key: secret,
        fetch_impl: async () => {
          const error = new Error(`timeout after using ${secret}`);
          error.code = 'ETIMEDOUT';
          error.isTimeout = true;
          throw error;
        },
      })),
      (error) => {
        assert.equal(error.code, 'ETIMEDOUT');
        assert.match(error.message, /读取模型目录超时/);
        assert.equal(isTrustedChineseUserError(error.message), true);
        assert.doesNotMatch(error.message, /sk-discover-timeout-secret/);
        return true;
      }
    );
  });

  it('maps AbortError timeout to a timeout instead of cancel', async () => {
    await assert.rejects(
      aiConfigService.discoverModels(discoverOpts({
        api_key: 'sk-discover-abort-timeout-secret',
        fetch_impl: async () => {
          const error = new Error('The operation was aborted.');
          error.name = 'AbortError';
          error.code = 'ETIMEDOUT';
          error.isTimeout = true;
          throw error;
        },
      })),
      (error) => {
        assert.match(error.message, /超时/);
        assert.doesNotMatch(error.message, /取消/);
        assert.equal(error.code, 'ETIMEDOUT');
        assert.equal(error.isTimeout, true);
        return true;
      }
    );
  });

  it('maps 401 to a Chinese auth error and strips echoed secrets', async () => {
    const secret = 'sk-discover-401-secret-123456';
    await assert.rejects(
      aiConfigService.discoverModels(discoverOpts({
        api_key: secret,
        fetch_impl: async () => jsonResponse({
          error: { message: `invalid api key ${secret}` },
        }, 401),
      })),
      (error) => {
        assert.match(error.message, /认证失败，请检查密钥/);
        assert.equal(isTrustedChineseUserError(error.message), true);
        assert.doesNotMatch(error.message, /sk-discover-401-secret/);
        assert.doesNotMatch(error.message, /invalid api key/);
        return true;
      }
    );
  });

  it('rejects non-JSON bodies with a Chinese parse error', async () => {
    await assert.rejects(
      aiConfigService.discoverModels(discoverOpts({
        fetch_impl: async () => new Response('<html>nope</html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }),
      })),
      (error) => {
        assert.match(error.message, /不是有效的数据|请手工填写模型名/);
        assert.equal(isTrustedChineseUserError(error.message), true);
        assert.doesNotMatch(error.message, /<html>/);
        return true;
      }
    );
  });

  it('rejects oversized model catalog responses', async () => {
    await assert.rejects(
      aiConfigService.discoverModels(discoverOpts({
        fetch_impl: async () => jsonResponse({ data: [] }, 200, {
          'Content-Length': String(3 * 1024 * 1024),
        }),
      })),
      (error) => {
        assert.match(error.message, /响应过大/);
        assert.equal(isTrustedChineseUserError(error.message), true);
        return true;
      }
    );
  });

  it('rejects intranet addresses before sending credentials', async () => {
    const secret = 'sk-intranet-secret-123456';
    let probeCalls = 0;
    await assert.rejects(
      aiConfigService.discoverModels(discoverOpts({
        base_url: 'http://127.0.0.1:11434/v1',
        api_key: secret,
        fetch_impl: async () => {
          probeCalls += 1;
          return jsonResponse({ data: [] });
        },
      })),
      (error) => {
        assert.match(error.message, /私有或本地|不允许|拦截/);
        assert.equal(isTrustedChineseUserError(error.message), true);
        assert.doesNotMatch(error.message, /sk-intranet-secret/);
        assert.doesNotMatch(error.message, /127\.0\.0\.1/);
        return true;
      }
    );
    assert.equal(probeCalls, 0);
  });

  it('rejects metadata intranet addresses', async () => {
    let probeCalls = 0;
    await assert.rejects(
      aiConfigService.discoverModels(discoverOpts({
        base_url: 'http://169.254.169.254/latest/meta-data',
        fetch_impl: async () => {
          probeCalls += 1;
          return jsonResponse({ data: [] });
        },
      })),
      (error) => {
        assert.match(error.message, /拦截|不允许|无效|合法/);
        assert.equal(isTrustedChineseUserError(error.message), true);
        return true;
      }
    );
    assert.equal(probeCalls, 0);
  });

  it('returns a Chinese unsupported message for Gemini native, ComfyUI and Jimeng', async () => {
    const cases = [
      { provider: 'gemini', api_protocol: 'gemini', service_type: 'image' },
      { provider: 'comfyui', api_protocol: 'comfyui', service_type: 'image' },
      { provider: 'jimeng_material_api', service_type: 'jimeng2_character_auth' },
    ];
    for (const item of cases) {
      let probeCalls = 0;
      await assert.rejects(
        aiConfigService.discoverModels(discoverOpts({
          ...item,
          fetch_impl: async () => {
            probeCalls += 1;
            return jsonResponse({ data: [] });
          },
        })),
        (error) => {
          assert.equal(error.code, 'UNSUPPORTED_MODEL_DISCOVERY');
          assert.equal(error.message, '当前厂商不支持自动读取模型目录，请手工填写模型名');
          assert.equal(isTrustedChineseUserError(error.message), true);
          return true;
        }
      );
      assert.equal(probeCalls, 0, item.provider);
    }
  });

  it('still discovers Gemini OpenAI-compatible catalogs', async () => {
    const result = await aiConfigService.discoverModels(discoverOpts({
      provider: 'gemini',
      api_protocol: 'openai',
      service_type: 'text',
      fetch_impl: async () => jsonResponse({ data: [{ id: 'gemini-2.5-pro' }] }),
    }));
    assert.deepEqual(result.models, [{ id: 'gemini-2.5-pro' }]);
  });
});

describe('aiConfigRoutes discover-models and Chinese validation', () => {
  it('returns Chinese create validation without English field names', () => {
    const db = createDb();
    try {
      const routes = aiConfigRoutes(db, log, {});
      const missing = mockResponse();
      routes.create({ body: {} }, missing);
      assert.equal(missing.statusCode, 400);
      assert.match(missing.body.error.message, /请填写服务类型、名称、厂商和接口地址/);
      assert.doesNotMatch(missing.body.error.message, /service_type|base_url|provider|name/);
      assert.equal(isTrustedChineseUserError(missing.body.error.message), true);

      const missingKey = mockResponse();
      routes.create({
        body: {
          service_type: 'text',
          name: '测试',
          provider: 'openai_compatible',
          base_url: 'https://provider.example.com/v1',
        },
      }, missingKey);
      assert.equal(missingKey.statusCode, 400);
      assert.match(missingKey.body.error.message, /请填写密钥/);
      assert.doesNotMatch(missingKey.body.error.message, /api_key/);
      assert.equal(isTrustedChineseUserError(missingKey.body.error.message), true);
    } finally {
      db.close();
    }
  });

  it('discovers from an unsaved form without requiring a stored config', async () => {
    const db = createDb();
    const original = aiConfigService.discoverModels;
    let captured = null;
    aiConfigService.discoverModels = async (opts) => {
      captured = opts;
      return { models: [{ id: 'gpt-4o' }] };
    };
    try {
      const routes = aiConfigRoutes(db, log, {});
      const res = mockResponse();
      await routes.discoverModels({
        body: {
          service_type: 'text',
          provider: 'openai_compatible',
          base_url: 'https://unsaved.example.com/v1',
          api_key: 'form-secret',
        },
      }, res);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body.data.models, [{ id: 'gpt-4o' }]);
      assert.equal(captured.base_url, 'https://unsaved.example.com/v1');
      assert.equal(captured.api_key, 'form-secret');
      assert.equal(captured.fetch_impl, undefined);
    } finally {
      aiConfigService.discoverModels = original;
      db.close();
    }
  });

  it('vendor lock keeps the saved origin and rejects arbitrary intranet probes', async () => {
    const db = createDb();
    const saved = aiConfigService.createConfig(db, log, {
      service_type: 'text',
      provider: 'openai_compatible',
      name: '锁定配置',
      base_url: 'https://locked.example.com/v1',
      api_key: 'locked-secret',
      model: ['model-a'],
      default_model: 'model-a',
    });
    const original = aiConfigService.discoverModels;
    const captured = [];
    aiConfigService.discoverModels = async (opts) => {
      captured.push(opts);
      return { models: [{ id: 'model-a' }] };
    };
    try {
      const routes = aiConfigRoutes(db, log, { vendor_lock: { enabled: true } });
      const denied = mockResponse();
      await routes.discoverModels({
        body: {
          service_type: 'text',
          provider: 'openai_compatible',
          base_url: 'http://127.0.0.1:11434/v1',
          api_key: 'attacker-key',
          settings: { allow_local_http: true },
        },
      }, denied);
      assert.equal(denied.statusCode, 400);
      assert.match(denied.body.error.message, /厂商锁定模式/);
      assert.equal(isTrustedChineseUserError(denied.body.error.message), true);
      assert.equal(captured.length, 0);

      const allowed = mockResponse();
      await routes.discoverModels({
        body: {
          id: saved.id,
          base_url: 'http://127.0.0.1:11434/v1',
          api_key: '********',
          provider: 'openai_compatible',
          service_type: 'text',
          settings: { allow_local_http: true },
        },
      }, allowed);
      assert.equal(allowed.statusCode, 200);
      assert.equal(captured.length, 1);
      assert.equal(captured[0].base_url, 'https://locked.example.com/v1');
      assert.equal(captured[0].api_key, 'locked-secret');
      assert.equal(JSON.stringify(allowed.body).includes('locked-secret'), false);
    } finally {
      aiConfigService.discoverModels = original;
      db.close();
    }
  });

  it('returns unsupported vendor errors as 400 Chinese without 500', async () => {
    const db = createDb();
    const logged = [];
    const routes = aiConfigRoutes(db, {
      ...log,
      error(message, metadata) {
        logged.push({ message, metadata });
      },
    }, {});
    try {
      const res = mockResponse();
      await routes.discoverModels({
        body: {
          provider: 'comfyui',
          api_protocol: 'comfyui',
          service_type: 'image',
          base_url: 'http://127.0.0.1:8188',
          api_key: 'sk-should-not-appear',
          settings: { allow_local_http: true },
        },
      }, res);
      assert.equal(res.statusCode, 400);
      assert.notEqual(res.statusCode, 500);
      assert.equal(res.body.error.message, '当前厂商不支持自动读取模型目录，请手工填写模型名');
      assert.equal(isTrustedChineseUserError(res.body.error.message), true);
      assert.equal(JSON.stringify({ body: res.body, logged }).includes('sk-should-not-appear'), false);
    } finally {
      db.close();
    }
  });

  it('does not echo provider secrets when discoverModels throws English errors', async () => {
    const db = createDb();
    const secret = ['sk-', 'route-secret-123456'].join('');
    const original = aiConfigService.discoverModels;
    const logged = [];
    aiConfigService.discoverModels = async () => {
      throw new Error(`invalid api key ${secret}`);
    };
    try {
      const routes = aiConfigRoutes(db, {
        ...log,
        error(message, metadata) {
          logged.push({ message, metadata });
        },
      }, {});
      const res = mockResponse();
      await routes.discoverModels({
        body: {
          provider: 'openai_compatible',
          service_type: 'text',
          base_url: 'https://provider.example.com/v1',
          api_key: secret,
        },
      }, res);
      const observable = JSON.stringify({ body: res.body, logged });
      assert.equal(res.statusCode, 400);
      assert.match(res.body.error.message, /读取模型目录失败/);
      assert.doesNotMatch(observable, new RegExp(secret));
      assert.equal(isTrustedChineseUserError(res.body.error.message), true);
    } finally {
      aiConfigService.discoverModels = original;
      db.close();
    }
  });
});
