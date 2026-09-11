const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const aiConfigService = require('../src/services/aiConfigService');
const aiConfigConnection = require('../src/services/aiConfigConnection');
const { isTrustedChineseUserError } = require('../src/services/providerErrorSanitizer');

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

describe('aiConfigConnection 拆分', () => {
  it('公开探测 API 指向新模块，包装函数留在原文件', () => {
    assert.equal(aiConfigService.fetchConnectionProbe, aiConfigConnection.fetchConnectionProbe);
    assert.equal(aiConfigService.probeOpenAICompatibleModels, aiConfigConnection.probeOpenAICompatibleModels);
    assert.equal(aiConfigService.probeOllamaConnection, aiConfigConnection.probeOllamaConnection);
    assert.equal(aiConfigService.ollamaProbeUrls, aiConfigConnection.ollamaProbeUrls);
    assert.equal(aiConfigService.openAiCompatibleModelsUrl, aiConfigConnection.openAiCompatibleModelsUrl);
    assert.equal(aiConfigService.supportsOpenAiCompatibleModelDiscovery, aiConfigConnection.supportsOpenAiCompatibleModelDiscovery);
    assert.equal(aiConfigService.isApiKeyOptionalConnection, aiConfigConnection.isApiKeyOptionalConnection);
    assert.equal(aiConfigService.CONNECTION_TEST_TIMEOUT_MS, aiConfigConnection.CONNECTION_TEST_TIMEOUT_MS);
    assert.equal(aiConfigService.DISCOVER_MODELS_LIMIT, aiConfigConnection.DISCOVER_MODELS_LIMIT);
    assert.equal(aiConfigService.DISCOVER_MODELS_MAX_BYTES, aiConfigConnection.DISCOVER_MODELS_MAX_BYTES);

    const serviceSrc = fs.readFileSync(path.join(__dirname, '../src/services/aiConfigService.js'), 'utf8');
    const connectionSrc = fs.readFileSync(path.join(__dirname, '../src/services/aiConfigConnection.js'), 'utf8');
    assert.match(serviceSrc, /require\('\.\/aiConfigConnection'\)/);
    assert.match(serviceSrc, /async function testConnection\(opts\)/);
    assert.match(serviceSrc, /async function discoverModels\(opts/);
    assert.match(serviceSrc, /testConnectionUnsafe\(opts\)/);
    assert.match(serviceSrc, /discoverModelsUnsafe\(opts\)/);
    assert.doesNotMatch(serviceSrc, /async function testConnectionUnsafe\s*\(/);
    assert.doesNotMatch(serviceSrc, /async function discoverModelsUnsafe\s*\(/);
    assert.doesNotMatch(serviceSrc, /function fetchConnectionProbe\s*\(/);
    assert.doesNotMatch(serviceSrc, /function probeOllamaConnection\s*\(/);
    assert.doesNotMatch(serviceSrc, /function probeOpenAICompatibleModels\s*\(/);
    assert.doesNotMatch(serviceSrc, /function sanitizeDiscoveredModel\s*\(/);
    assert.doesNotMatch(serviceSrc, /function parseDiscoveredModelRows\s*\(/);
    assert.doesNotMatch(serviceSrc, /function openAiCompatibleModelsUrl\s*\(/);
    const discoverSrc = fs.readFileSync(path.join(__dirname, '../src/services/aiConfigConnectionDiscover.js'), 'utf8');
    assert.match(connectionSrc, /async function testConnectionUnsafe\s*\(/);
    assert.match(connectionSrc, /async function discoverModelsUnsafe\s*\(/);
    assert.match(discoverSrc, /function sanitizeDiscoveredModel\s*\(/);
    assert.match(connectionSrc, /function sanitizeDiscoveredModel\s*\(/);
    assert.doesNotMatch(connectionSrc, /async function testConnection\(opts\)/);
    assert.doesNotMatch(connectionSrc, /async function discoverModels\(opts/);
    assert.doesNotMatch(connectionSrc, /function createConfig\s*\(/);
    assert.doesNotMatch(connectionSrc, /function applyVendorLock\s*\(/);
    assert.doesNotMatch(connectionSrc, /function bulkUpdateApiKey\s*\(/);
  });
});

describe('aiConfigConnection 纯函数', () => {
  it('按 base 是否已带 /v1 组装 models 探测地址', () => {
    assert.equal(
      aiConfigConnection.openAiCompatibleModelsUrl('https://provider.example.com/v1'),
      'https://provider.example.com/v1/models',
    );
    assert.equal(
      aiConfigConnection.openAiCompatibleModelsUrl('https://provider.example.com/v1/'),
      'https://provider.example.com/v1/models',
    );
    assert.equal(
      aiConfigConnection.openAiCompatibleModelsUrl('https://provider.example.com'),
      'https://provider.example.com/v1/models',
    );
  });

  it('Ollama 同时探测原生 tags 与 OpenAI 兼容 models', () => {
    assert.deepEqual(
      aiConfigConnection.ollamaProbeUrls('http://127.0.0.1:11434'),
      ['http://127.0.0.1:11434/api/tags', 'http://127.0.0.1:11434/v1/models'],
    );
    assert.deepEqual(
      aiConfigConnection.ollamaProbeUrls('http://127.0.0.1:11434/v1'),
      ['http://127.0.0.1:11434/api/tags', 'http://127.0.0.1:11434/v1/models'],
    );
  });

  it('仅本地 Ollama/ComfyUI 允许无密钥连接', () => {
    assert.equal(aiConfigConnection.isApiKeyOptionalConnection({ provider: 'ollama' }), true);
    assert.equal(aiConfigConnection.isApiKeyOptionalConnection({ provider: 'comfy-ui', api_protocol: 'comfyui' }), true);
    assert.equal(aiConfigConnection.isApiKeyOptionalConnection({ provider: 'openai' }), false);
    assert.equal(aiConfigConnection.isApiKeyOptionalConnection({ provider: 'openai_compatible' }), false);
  });

  it('不支持的厂商 fail-closed，不把目录探测打开', () => {
    assert.equal(aiConfigConnection.supportsOpenAiCompatibleModelDiscovery({
      provider: 'gemini',
      api_protocol: 'gemini',
      service_type: 'image',
    }), false);
    assert.equal(aiConfigConnection.supportsOpenAiCompatibleModelDiscovery({
      provider: 'comfyui',
      api_protocol: 'comfyui',
      service_type: 'image',
    }), false);
    assert.equal(aiConfigConnection.supportsOpenAiCompatibleModelDiscovery({
      provider: 'jimeng_material_api',
      service_type: 'jimeng2_character_auth',
    }), false);
    assert.equal(aiConfigConnection.supportsOpenAiCompatibleModelDiscovery({
      provider: 'openai_compatible',
      service_type: 'text',
    }), true);
    assert.equal(aiConfigConnection.supportsOpenAiCompatibleModelDiscovery({
      provider: 'google',
      api_protocol: 'openai',
      service_type: 'text',
    }), true);
  });

  it('解析模型目录并丢弃空值、越界和密钥样 id', () => {
    assert.deepEqual(
      aiConfigConnection.parseDiscoveredModelRows({ data: [{ id: 'a' }, { id: 'b' }] }).map((row) => row.id),
      ['a', 'b'],
    );
    assert.deepEqual(
      aiConfigConnection.parseDiscoveredModelRows({ models: [{ name: 'qwen3:8b' }] })[0],
      { name: 'qwen3:8b' },
    );
    assert.equal(aiConfigConnection.parseDiscoveredModelRows({ error: 'nope' }), null);
    assert.equal(aiConfigConnection.sanitizeDiscoveredModel({ id: '' }), null);
    assert.equal(aiConfigConnection.sanitizeDiscoveredModel({ id: 'sk-discover-secret-123456' }), null);
    assert.equal(aiConfigConnection.sanitizeDiscoveredModel({ id: 'a'.repeat(200) }), null);
    assert.equal(aiConfigConnection.sanitizeDiscoveredModel({ id: '../etc/passwd' }), null);
    assert.deepEqual(
      aiConfigConnection.sanitizeDiscoveredModel({ id: 'gpt-4o', name: 'GPT-4o' }),
      { id: 'gpt-4o', name: 'GPT-4o' },
    );
  });

  it('把供应商地址错误映射成简体中文，不回传原文细节', () => {
    assert.equal(
      aiConfigConnection.mapProviderUrlDiscoverMessage('公网服务地址必须使用 HTTPS'),
      '公网服务地址必须使用 HTTPS',
    );
    assert.equal(
      aiConfigConnection.mapProviderUrlDiscoverMessage('私有或本地服务地址需要使用已识别的本地厂商模式'),
      '私有或本地服务地址需要使用已识别的本地厂商模式',
    );
    assert.equal(
      aiConfigConnection.mapProviderUrlDiscoverMessage('Internal DNS NXDOMAIN for 169.254.169.254'),
      '接口地址无效，请检查后重试',
    );
  });
});

describe('aiConfigConnection.discoverModelsUnsafe', () => {
  it('用解析/脱敏结果封顶返回，不回退到未清洗目录', async () => {
    const result = await aiConfigConnection.discoverModelsUnsafe({
      base_url: 'https://provider.example.com/v1',
      api_key: 'saved-secret',
      provider: 'openai_compatible',
      service_type: 'text',
      provider_dns_lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      fetch_impl: async () => new Response(JSON.stringify({
        data: [
          { id: 'gpt-4o', name: 'GPT-4o' },
          { id: 'sk-discover-secret-123456' },
          { id: '../etc/passwd' },
          { id: 'gpt-4o' },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    });
    assert.deepEqual(result.models, [{ id: 'gpt-4o', name: 'GPT-4o' }]);
  });

  it('不支持的厂商在发请求前 fail-closed', async () => {
    let probeCalls = 0;
    await assert.rejects(
      aiConfigConnection.discoverModelsUnsafe({
        provider: 'comfyui',
        api_protocol: 'comfyui',
        service_type: 'image',
        base_url: 'http://127.0.0.1:8188',
        api_key: 'sk-should-not-be-sent',
        fetch_impl: async () => {
          probeCalls += 1;
          return new Response('{}', { status: 200 });
        },
      }),
      (error) => error.code === 'UNSUPPORTED_MODEL_DISCOVERY'
        && error.message === '当前厂商不支持自动读取模型目录，请手工填写模型名',
    );
    assert.equal(probeCalls, 0);
  });
});
describe('aiConfigService.testConnection', () => {
  it('rejects public HTTP before invoking a probe with stored credentials', async () => {
    let probeCalls = 0;
    await assert.rejects(
      aiConfigService.testConnection({
        base_url: 'http://provider.example/v1',
        api_key: 'stored-secret-must-not-be-sent',
        provider: 'openai_compatible',
        service_type: 'text',
        model: 'text-model',
        fetch_impl: async () => {
          probeCalls += 1;
          return new Response('{}', { status: 200 });
        },
      }),
      (error) => error?.code === 'INVALID_PROVIDER_URL' && /HTTPS/.test(error.message)
    );
    assert.equal(probeCalls, 0);
  });

  it('rejects a public HTTP ComfyUI probe before DNS or transport', async () => {
    let lookupCalls = 0;
    let transportCalls = 0;

    await assert.rejects(
      aiConfigService.testConnection({
        base_url: 'http://provider.example',
        api_key: 'synthetic-stored-comfy-credential',
        provider: 'comfyui',
        api_protocol: 'comfyui',
        service_type: 'image',
        model: 'workflow-model',
        provider_dns_lookup: async () => {
          lookupCalls += 1;
          return [{ address: '93.184.216.34', family: 4 }];
        },
        fetch_impl: async () => {
          transportCalls += 1;
          return new Response('{}', { status: 200 });
        },
      }),
      (error) => error?.code === 'INVALID_PROVIDER_URL' && /HTTPS/.test(error.message)
    );
    assert.equal(lookupCalls, 0);
    assert.equal(transportCalls, 0);
  });

  it('uses a non-billable models probe for OpenAI-compatible image services', async () => {
    const calls = [];
    global.fetch = async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ data: [{ id: 'image-model' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    await aiConfigService.testConnection({
      base_url: 'https://provider.example.com/v1/',
      api_key: 'saved-secret',
      provider: 'openai-compatible',
      api_protocol: 'openai',
      service_type: 'image',
      model: 'image-model',
      fetch_impl: global.fetch,
      provider_dns_lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://provider.example.com/v1/models');
    assert.equal(calls[0].options.method, 'GET');
    assert.equal(calls[0].options.body, undefined);
    assert.equal(calls[0].options.headers.Authorization, 'Bearer saved-secret');
    assert.ok(calls[0].options.signal instanceof AbortSignal);
  });

  it('uses the requested same-origin path instead of the saved policy path', async () => {
    const calls = [];
    const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
    const fetchImpl = async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ data: [{ id: 'image-model' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    await aiConfigService.testConnection({
      base_url: 'https://provider.example.com/new/v1',
      api_key: 'saved-secret',
      provider: 'openai-compatible',
      api_protocol: 'openai',
      service_type: 'image',
      model: 'image-model',
      fetch_impl: fetchImpl,
      provider_network_policy: {
        baseUrl: 'https://provider.example.com/old/v1',
        trustedOrigins: ['https://provider.example.com/old/v1'],
        allowPrivateOrigins: [],
        requireHttpsForPublic: true,
        lookup,
      },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://provider.example.com/new/v1/models');
  });

  it('rejects failed model probes instead of reporting false success', async () => {
    global.fetch = async () => new Response(
      JSON.stringify({ error: { message: 'invalid api key' } }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );

    await assert.rejects(
      aiConfigService.testConnection({
        base_url: 'https://provider.example.com/v1',
        api_key: 'bad-secret',
        provider: 'openai',
        service_type: 'text',
        model: 'text-model',
        fetch_impl: global.fetch,
        provider_dns_lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      }),
      (error) => {
        assert.equal(error.message, '认证失败，请检查密钥');
        assert.equal(isTrustedChineseUserError(error.message), true);
        assert.doesNotMatch(error.message, /401|invalid api key|API Key/i);
        return true;
      }
    );
  });

  it('redacts provider secrets and signed URLs from connection errors', async () => {
    const secret = 'sk-connection-secret-123456';
    const fetchImpl = async () => new Response(JSON.stringify({
      error: {
        message: `Bearer ${secret} rejected at https://provider.example.com/debug?token=${secret}`,
      },
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });

    await assert.rejects(
      aiConfigService.testConnection({
        base_url: 'https://provider.example.com/v1',
        api_key: secret,
        provider: 'openai',
        service_type: 'text',
        model: 'text-model',
        fetch_impl: fetchImpl,
        provider_dns_lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      }),
      (error) => {
        assert.doesNotMatch(error.message, /sk-connection-secret/);
        assert.doesNotMatch(error.message, /\?token=/);
        assert.doesNotMatch(error.message, /401|API Key/i);
        assert.equal(isTrustedChineseUserError(error.message), true);
        return true;
      }
    );
  });


  it('rejects a stale default model before sending credentials', async () => {
    let probeCalls = 0;
    await assert.rejects(
      aiConfigService.testConnection({
        base_url: 'https://provider.example.com/v1',
        api_key: 'saved-secret',
        provider: 'openai',
        service_type: 'text',
        model: ['current-model'],
        default_model: 'retired-model',
        fetch_impl: async () => {
          probeCalls += 1;
          return new Response('{}', { status: 200 });
        },
        provider_dns_lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      }),
      (error) => error?.code === 'INVALID_AI_CONFIG' && error?.details?.issue === 'not_in_model_list'
    );
    assert.equal(probeCalls, 0);
  });

  it('cancels an in-flight probe when the caller unloads instead of reporting timeout', async () => {
    const controller = new AbortController();
    let sawSignal = false;
    const fetchImpl = (_url, options) => new Promise((_, reject) => {
      sawSignal = options.signal instanceof AbortSignal;
      const onAbort = () => {
        const error = new Error('The operation was aborted.');
        error.name = 'AbortError';
        reject(error);
      };
      if (options.signal?.aborted) onAbort();
      else options.signal.addEventListener('abort', onAbort, { once: true });
    });
    const pending = aiConfigService.testConnection({
      base_url: 'https://provider.example.com/v1',
      api_key: 'saved-secret',
      provider: 'openai',
      service_type: 'text',
      model: 'text-model',
      fetch_impl: fetchImpl,
      provider_dns_lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      signal: controller.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    await assert.rejects(pending, (error) => {
      assert.equal(error.code, 'ERR_CANCELED');
      assert.match(error.message, /取消/);
      assert.doesNotMatch(error.message, /超时/);
      return true;
    });
    assert.equal(sawSignal, true);
  });

  it('network failures return Chinese copy instead of fetch/ECONNREFUSED text', async () => {
    const fetchImpl = async () => {
      const error = new Error('fetch failed');
      error.code = 'ECONNREFUSED';
      throw error;
    };
    await assert.rejects(
      aiConfigService.testConnection({
        base_url: 'https://provider.example.com/v1',
        api_key: 'saved-secret',
        provider: 'openai',
        service_type: 'text',
        model: 'text-model',
        fetch_impl: fetchImpl,
        provider_dns_lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      }),
      (error) => {
        assert.match(String(error.message), /[\u4e00-\u9fff]/);
        assert.doesNotMatch(String(error.message), /fetch failed|ECONNREFUSED|aborted/i);
        assert.equal(error.cause, undefined);
        assert.doesNotMatch(String(error.stack || ''), /fetch failed|ECONNREFUSED/i);
        assert.equal(isTrustedChineseUserError(error.message), true);
        return true;
      }
    );
  });

  it('returns Chinese TTS auth errors without status codes', async () => {
    const secret = 'tts-secret-key-123456';
    const fetchImpl = async () => new Response(JSON.stringify({
      base_resp: { status_msg: `API Key 无效 (401) Bearer ${secret}` },
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });

    await assert.rejects(
      aiConfigService.testConnection({
        base_url: 'https://api.minimaxi.com/v1',
        api_key: secret,
        provider: 'minimax',
        api_protocol: 'minimax',
        service_type: 'tts',
        model: 'speech-02-hd',
        fetch_impl: fetchImpl,
        provider_dns_lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      }),
      (error) => {
        assert.equal(error.message, '认证失败，请检查密钥');
        assert.equal(isTrustedChineseUserError(error.message), true);
        assert.doesNotMatch(error.message, /401|API Key|tts-secret-key/i);
        return true;
      }
    );
  });
});
