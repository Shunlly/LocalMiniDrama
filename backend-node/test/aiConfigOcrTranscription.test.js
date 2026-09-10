const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const aiConfigService = require('../src/services/aiConfigService');
const aiConfigRoutes = require('../src/routes/aiConfig');
const { isTrustedChineseUserError } = require('../src/services/providerErrorSanitizer');
const { publicErrorMessage } = require('../src/routes/serviceFailure');

const originalFetch = global.fetch;
const UNSUPPORTED_MESSAGE = '当前厂商不支持自动连接测试，请保存后用一张样例图/一段样例音频验证';
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

afterEach(() => {
  global.fetch = originalFetch;
});

function createDb() {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  return db;
}

function createLog() {
  const records = [];
  return {
    records,
    info(message, fields) { records.push({ level: 'info', message, fields }); },
    warn(message, fields) { records.push({ level: 'warn', message, fields }); },
    error(message, fields) { records.push({ level: 'error', message, fields }); },
    errorw(message, fields) { records.push({ level: 'errorw', message, fields }); },
  };
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
      this.writableEnded = true;
      return this;
    },
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function configRequest(serviceType, overrides = {}) {
  return {
    service_type: serviceType,
    name: `${serviceType} 配置`,
    provider: 'openai_compatible',
    api_protocol: 'openai',
    base_url: 'https://provider.example.com/v1',
    api_key: `${serviceType}-secret-key-123456`,
    model: [`${serviceType}-model`],
    default_model: `${serviceType}-model`,
    is_default: true,
    ...overrides,
  };
}

function connectionOpts(serviceType, overrides = {}) {
  return {
    base_url: 'https://provider.example.com/v1',
    api_key: `${serviceType}-secret-key-123456`,
    provider: 'openai_compatible',
    api_protocol: 'openai',
    service_type: serviceType,
    model: `${serviceType}-model`,
    provider_dns_lookup: publicLookup,
    ...overrides,
  };
}

function assertNoMediaPayload(calls) {
  for (const call of calls) {
    const url = String(call.url || '');
    const body = call.options?.body;
    assert.doesNotMatch(url, /audio|transcriptions|vision|ocr/i);
    assert.equal(call.options?.method, 'GET');
    assert.equal(body, undefined);
    if (typeof body === 'string') {
      assert.doesNotMatch(body, /image_url|image\/|audio\/|multipart|data:/i);
    }
  }
}

describe('aiConfigService OCR/transcription createConfig', () => {
  it('saves ocr and transcription configs with OpenAI-compatible endpoints', () => {
    const db = createDb();
    const log = createLog();
    try {
      const ocr = aiConfigService.createConfig(db, log, configRequest('ocr'));
      const transcription = aiConfigService.createConfig(db, log, configRequest('transcription'));

      assert.equal(ocr.service_type, 'ocr');
      assert.equal(ocr.provider, 'openai_compatible');
      assert.equal(ocr.endpoint, '/chat/completions');
      assert.equal(ocr.api_key, 'ocr-secret-key-123456');
      assert.deepEqual(ocr.model, ['ocr-model']);

      assert.equal(transcription.service_type, 'transcription');
      assert.equal(transcription.endpoint, '/audio/transcriptions');
      assert.equal(transcription.api_key, 'transcription-secret-key-123456');

      const listedOcr = aiConfigService.listConfigs(db, 'ocr');
      const listedTranscription = aiConfigService.listConfigs(db, 'transcription');
      assert.equal(listedOcr.length, 1);
      assert.equal(listedOcr[0].id, ocr.id);
      assert.equal(listedTranscription.length, 1);
      assert.equal(listedTranscription[0].id, transcription.id);

      const observable = JSON.stringify(log.records);
      assert.doesNotMatch(observable, /ocr-secret-key-123456|transcription-secret-key-123456/);
    } finally {
      db.close();
    }
  });

  it('creates ocr and transcription through the HTTP route and masks secrets in the response', () => {
    const db = createDb();
    const log = createLog();
    try {
      const routes = aiConfigRoutes(db, log, {});
      const ocrRes = mockResponse();
      routes.create({ body: configRequest('ocr') }, ocrRes);
      assert.equal(ocrRes.statusCode, 201);
      assert.equal(ocrRes.body.success, true);
      assert.equal(ocrRes.body.data.service_type, 'ocr');
      assert.equal(ocrRes.body.data.endpoint, '/chat/completions');
      assert.equal(ocrRes.body.data.api_key, '********');
      assert.equal(ocrRes.body.data.api_key_set, true);

      const transcriptionRes = mockResponse();
      routes.create({ body: configRequest('transcription') }, transcriptionRes);
      assert.equal(transcriptionRes.statusCode, 201);
      assert.equal(transcriptionRes.body.data.service_type, 'transcription');
      assert.equal(transcriptionRes.body.data.endpoint, '/audio/transcriptions');
      assert.equal(transcriptionRes.body.data.api_key, '********');

      const savedOcr = aiConfigService.getConfig(db, ocrRes.body.data.id);
      const savedTranscription = aiConfigService.getConfig(db, transcriptionRes.body.data.id);
      assert.equal(savedOcr.service_type, 'ocr');
      assert.equal(savedTranscription.service_type, 'transcription');

      const observable = JSON.stringify({ ocr: ocrRes.body, transcription: transcriptionRes.body, log: log.records });
      assert.doesNotMatch(observable, /ocr-secret-key-123456|transcription-secret-key-123456/);
    } finally {
      db.close();
    }
  });
});

describe('aiConfigService.testConnection OCR/transcription', () => {
  it('probes /v1/models for OpenAI-compatible OCR and never sends a vision request', async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ data: [{ id: 'ocr-model' }] });
    };

    await aiConfigService.testConnection(connectionOpts('ocr', { fetch_impl: fetchImpl }));

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://provider.example.com/v1/models');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer ocr-secret-key-123456');
    assertNoMediaPayload(calls);
  });

  it('probes /v1/models for OpenAI-compatible transcription and never uploads audio', async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push({ url, options });
      if (String(options?.body || '').includes('FormData') || options?.body instanceof FormData) {
        throw new Error('must not upload audio during connection test');
      }
      return jsonResponse({ data: [{ id: 'whisper-1' }] });
    };

    await aiConfigService.testConnection(connectionOpts('transcription', {
      endpoint: '/audio/transcriptions',
      fetch_impl: fetchImpl,
    }));

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://provider.example.com/v1/models');
    assertNoMediaPayload(calls);
    assert.doesNotMatch(String(calls[0].url), /audio\/transcriptions/);
  });

  it('probes compatible chat for transcription when the vendor is chat-compatible but not marked OpenAI', async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push({ url, options });
      if (options?.body instanceof FormData) {
        throw new Error('must not upload audio during connection test');
      }
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
    };

    await aiConfigService.testConnection(connectionOpts('transcription', {
      provider: 'deepseek',
      api_protocol: '',
      fetch_impl: fetchImpl,
    }));

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://provider.example.com/v1/chat/completions');
    assert.equal(calls[0].options.method, 'POST');
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.max_tokens, 1);
    assert.doesNotMatch(String(calls[0].options.body), /audio|image_url|multipart/i);
  });

  it('returns Chinese guidance for unsupported OCR/transcription protocols without probing', async () => {
    let probeCalls = 0;
    const fetchImpl = async () => {
      probeCalls += 1;
      return jsonResponse({});
    };

    await assert.rejects(
      aiConfigService.testConnection(connectionOpts('ocr', {
        provider: 'gemini',
        api_protocol: 'gemini',
        fetch_impl: fetchImpl,
      })),
      (error) => {
        assert.equal(error.message, UNSUPPORTED_MESSAGE);
        assert.equal(error.code, 'UNSUPPORTED_CONNECTION_TEST');
        assert.equal(isTrustedChineseUserError(error.message), true);
        assert.equal(publicErrorMessage(error, '连接测试失败，请检查接口地址和密钥'), UNSUPPORTED_MESSAGE);
        assert.doesNotMatch(error.message, /401|API Key|HTTP/i);
        return true;
      }
    );
    assert.equal(probeCalls, 0);

    await assert.rejects(
      aiConfigService.testConnection(connectionOpts('transcription', {
        provider: 'comfyui',
        api_protocol: 'comfyui',
        fetch_impl: fetchImpl,
        settings: JSON.stringify({ allow_local_http: true }),
      })),
      (error) => error.message === UNSUPPORTED_MESSAGE
    );
    assert.equal(probeCalls, 0);
  });

  it('returns Chinese auth errors for OCR without leaking keys or status codes', async () => {
    const secret = 'ocr-secret-key-123456';
    const fetchImpl = async () => jsonResponse({
      error: { message: `API Key 无效 (401) Bearer ${secret}` },
    }, 401);

    await assert.rejects(
      aiConfigService.testConnection(connectionOpts('ocr', {
        api_key: secret,
        fetch_impl: fetchImpl,
      })),
      (error) => {
        assert.equal(error.message, '认证失败，请检查密钥');
        assert.equal(isTrustedChineseUserError(error.message), true);
        assert.doesNotMatch(error.message, /401|API Key|ocr-secret-key/i);
        return true;
      }
    );
  });
});

describe('aiConfig routes OCR/transcription connection test', () => {
  it('returns the unsupported Chinese message without logging secrets', async () => {
    const log = createLog();
    const routes = aiConfigRoutes({}, log, {});
    const res = mockResponse();
    await routes.testConnection({
      body: {
        base_url: 'https://generativelanguage.googleapis.com',
        api_key: 'gemini-ocr-secret-key',
        provider: 'gemini',
        api_protocol: 'gemini',
        service_type: 'ocr',
        model: 'gemini-pro',
      },
    }, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.message, UNSUPPORTED_MESSAGE);
    const observable = JSON.stringify({ body: res.body, log: log.records });
    assert.doesNotMatch(observable, /gemini-ocr-secret-key/);
    assert.doesNotMatch(observable, /401|API Key 无效/i);
  });
});
