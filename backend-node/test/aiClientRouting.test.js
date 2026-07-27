const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const http = require('http');
const https = require('https');
const { PassThrough } = require('node:stream');

const aiClient = require('../src/services/aiClient');
const aiConfigService = require('../src/services/aiConfigService');
const imageClient = require('../src/services/imageClient');
const uploadService = require('../src/services/uploadService');

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

  it('does not dispatch a legacy public HTTP OpenAI image config with stored credentials', async (t) => {
    let lookupCalls = 0;
    let transportCalls = 0;
    const originalHttpRequest = http.request;
    http.request = () => {
      transportCalls += 1;
      const error = new Error('synthetic transport observer stopped the request');
      error.code = 'SYNTHETIC_TRANSPORT_OBSERVED';
      throw error;
    };
    t.after(() => { http.request = originalHttpRequest; });
    aiConfigService.listConfigs = () => [config({
      id: 52,
      service_type: 'image',
      provider: 'openai_compatible',
      api_protocol: 'openai',
      base_url: 'http://provider.example/v1',
      endpoint: '/images/generations',
      api_key: 'synthetic-stored-image-credential',
      model: ['image-model'],
      default_model: 'image-model',
      is_default: true,
    })];

    await assert.rejects(
      imageClient.callImageApi(fakeDb(), log, {
        prompt: 'private image prompt',
        model: 'image-model',
        preferred_provider: 'openai_compatible',
        provider_dns_lookup: async () => {
          lookupCalls += 1;
          return [{ address: '93.184.216.34', family: 4 }];
        },
      }),
      (error) => error?.providerCode === 'INVALID_PROVIDER_URL'
    );
    assert.equal(lookupCalls, 0);
    assert.equal(transportCalls, 0);
  });

  it('does not bypass public HTTP rejection when ComfyUI selects the generic image protocol', async (t) => {
    let lookupCalls = 0;
    let transportCalls = 0;
    const originalHttpRequest = http.request;
    http.request = () => {
      transportCalls += 1;
      const error = new Error('synthetic transport observer stopped the request');
      error.code = 'SYNTHETIC_TRANSPORT_OBSERVED';
      throw error;
    };
    t.after(() => { http.request = originalHttpRequest; });
    aiConfigService.listConfigs = () => [config({
      id: 53,
      service_type: 'image',
      provider: 'comfyui',
      api_protocol: 'openai',
      base_url: 'http://provider.example/v1',
      endpoint: '/images/generations',
      api_key: 'synthetic-stored-alternate-protocol-credential',
      model: ['image-model'],
      default_model: 'image-model',
      is_default: true,
    })];

    await assert.rejects(
      imageClient.callImageApi(fakeDb(), log, {
        prompt: 'private image prompt',
        model: 'image-model',
        preferred_provider: 'comfyui',
        provider_dns_lookup: async () => {
          lookupCalls += 1;
          return [{ address: '93.184.216.34', family: 4 }];
        },
      }),
      (error) => error?.providerCode === 'INVALID_PROVIDER_URL'
    );
    assert.equal(lookupCalls, 0);
    assert.equal(transportCalls, 0);
  });

  it('does not dispatch a legacy public HTTP ComfyUI config with stored credentials', async () => {
    let lookupCalls = 0;
    let transportCalls = 0;
    aiConfigService.listConfigs = () => [config({
      id: 51,
      service_type: 'image',
      provider: 'comfyui',
      api_protocol: 'comfyui',
      base_url: 'http://provider.example',
      endpoint: '/prompt',
      api_key: 'synthetic-stored-comfy-credential',
      model: ['workflow-model'],
      default_model: 'workflow-model',
      is_default: true,
      settings: JSON.stringify({
        workflow: { 1: { class_type: 'EmptyLatentImage', inputs: {} } },
      }),
    })];

    await assert.rejects(
      imageClient.callImageApi(fakeDb(), log, {
        prompt: 'private image prompt',
        model: 'workflow-model',
        preferred_provider: 'comfyui',
        provider_dns_lookup: async () => {
          lookupCalls += 1;
          return [{ address: '93.184.216.34', family: 4 }];
        },
        fetch_impl: async () => {
          transportCalls += 1;
          return new Response('{}', { status: 200 });
        },
      }),
      (error) => error?.providerCode === 'INVALID_PROVIDER_URL'
    );
    assert.equal(lookupCalls, 0);
    assert.equal(transportCalls, 0);
  });

  it('routes a loopback ComfyUI image request through submit, poll, and output download', async () => {
    const imageBytes = Buffer.from('synthetic-comfy-image');
    let submitted = null;
    const baseUrl = await startServer(async (req, res) => {
      if (req.method === 'POST' && req.url === '/prompt') {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        submitted = {
          authorization: req.headers.authorization,
          idempotencyKey: req.headers['idempotency-key'],
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ prompt_id: 'route-prompt' }));
        return;
      }
      if (req.method === 'GET' && req.url === '/history/route-prompt') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          'route-prompt': {
            status: { completed: true },
            outputs: {
              9: {
                images: [{ filename: 'route-output.png', subfolder: '', type: 'output' }],
              },
            },
          },
        }));
        return;
      }
      if (req.method === 'GET' && req.url.startsWith('/view?')) {
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Content-Length': imageBytes.length,
        });
        res.end(imageBytes);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
    aiConfigService.listConfigs = () => [config({
      id: 54,
      service_type: 'image',
      provider: 'comfyui',
      api_protocol: 'comfyui',
      base_url: baseUrl,
      endpoint: '/prompt',
      api_key: 'synthetic-local-comfy-key',
      model: ['workflow-model'],
      default_model: 'workflow-model',
      is_default: true,
      settings: JSON.stringify({
        allow_local_http: true,
        output_node_id: 9,
        workflow: {
          1: { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}' } },
          9: { class_type: 'SaveImage', inputs: {} },
        },
      }),
    })];

    const result = await imageClient.callImageApi(fakeDb(), log, {
      prompt: 'render the verified route',
      model: 'workflow-model',
      preferred_provider: 'comfyui',
      idempotency_key: 'image-route-test',
      poll_interval_ms: 1,
      provider_dns_lookup: async () => [{ address: '127.0.0.1', family: 4 }],
    });

    assert.equal(result.image_url, `data:image/png;base64,${imageBytes.toString('base64')}`);
    assert.equal(result.prompt_id, 'route-prompt');
    assert.equal(submitted.authorization, 'Bearer synthetic-local-comfy-key');
    assert.equal(submitted.idempotencyKey, 'image-route-test');
    assert.equal(submitted.body.prompt['1'].inputs.text, 'render the verified route');
  });

  it('dispatches an OpenAI-compatible image request to a validated public HTTPS endpoint', async (t) => {
    const originalHttpsRequest = https.request;
    let lookupCalls = 0;
    let captured = null;
    https.request = (options, callback) => {
      const request = new EventEmitter();
      const chunks = [];
      request.write = (chunk) => chunks.push(Buffer.from(chunk));
      request.destroy = () => {};
      request.end = () => {
        captured = {
          options,
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        };
        const response = new PassThrough();
        response.statusCode = 200;
        response.headers = { 'content-type': 'application/json' };
        callback(response);
        response.end(JSON.stringify({ data: [{ url: 'https://cdn.example/verified.png' }] }));
        request.emit('close');
      };
      return request;
    };
    t.after(() => { https.request = originalHttpsRequest; });
    aiConfigService.listConfigs = () => [config({
      id: 55,
      service_type: 'image',
      provider: 'openai_compatible',
      api_protocol: 'openai',
      base_url: 'https://provider.example/v1',
      endpoint: '/images/generations',
      api_key: 'synthetic-public-image-key',
      model: ['image-model'],
      default_model: 'image-model',
      is_default: true,
    })];

    const result = await imageClient.callImageApi(fakeDb(), log, {
      prompt: 'public HTTPS route',
      model: 'image-model',
      preferred_provider: 'openai_compatible',
      size: '1024x1024',
      provider_dns_lookup: async () => {
        lookupCalls += 1;
        return [{ address: '93.184.216.34', family: 4 }];
      },
    });

    assert.equal(result.image_url, 'https://cdn.example/verified.png');
    assert.equal(lookupCalls, 1);
    assert.equal(captured.options.protocol, 'https:');
    assert.equal(captured.options.hostname, 'provider.example');
    assert.equal(captured.options.path, '/v1/images/generations');
    assert.equal(captured.options.method, 'POST');
    assert.equal(captured.options.headers.Authorization, 'Bearer synthetic-public-image-key');
    assert.deepEqual(captured.body, {
      model: 'image-model',
      prompt: 'public HTTPS route',
      n: 1,
      size: '1024x1024',
    });
  });

  for (const scenario of [
    {
      label: 'Kling',
      protocol: 'kling',
      endpoint: '/v1/images/generations',
      model: 'kling-image',
      submit: { code: 0, data: { task_id: 'kling-task' } },
      poll: {
        data: {
          task_status: 'succeed',
          task_result: { images: [{ url: 'https://images.example/kling.png' }] },
        },
      },
      expectedUrl: 'https://images.example/kling.png',
      pollDelay: 4000,
    },
    {
      label: 'NanoBanana',
      protocol: 'nano_banana',
      endpoint: '/api/v1/nanobanana/generate-2',
      model: 'nano-banana-2',
      submit: { data: { taskId: 'banana-task' } },
      poll: {
        data: {
          successFlag: 1,
          response: { resultImageUrl: 'https://images.example/banana.png' },
        },
      },
      expectedUrl: 'https://images.example/banana.png',
      pollDelay: 3000,
    },
  ]) {
    it(`${scenario.label} polling preserves the complete provider network policy`, async (t) => {
      const baseUrl = await startServer(async (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(scenario.submit));
      });
      const providerLookup = async () => [{ address: '127.0.0.1', family: 4 }];
      aiConfigService.listConfigs = () => [config({
        id: scenario.label === 'Kling' ? 61 : 62,
        service_type: 'image',
        provider: 'openai_compatible',
        api_protocol: scenario.protocol,
        base_url: baseUrl,
        endpoint: scenario.endpoint,
        api_key: 'synthetic-image-key',
        model: [scenario.model],
        default_model: scenario.model,
        is_default: true,
        settings: JSON.stringify({ allow_local_http: true }),
      })];

      const originalDownload = uploadService.downloadBufferViaNodeHttp;
      const originalSetTimeout = global.setTimeout;
      const polls = [];
      uploadService.downloadBufferViaNodeHttp = async (url, _timeout, _redirectCount, options) => {
        polls.push({ url, options });
        return {
          buffer: Buffer.from(JSON.stringify(scenario.poll)),
          contentType: 'application/json',
          finalUrl: url,
        };
      };
      global.setTimeout = (callback, delay, ...args) => originalSetTimeout(
        callback,
        delay === scenario.pollDelay ? 0 : delay,
        ...args
      );
      t.after(() => {
        uploadService.downloadBufferViaNodeHttp = originalDownload;
        global.setTimeout = originalSetTimeout;
      });

      const result = await imageClient.callImageApi(fakeDb(), log, {
        prompt: `${scenario.label} network policy test`,
        model: scenario.model,
        preferred_provider: 'openai_compatible',
        provider_dns_lookup: providerLookup,
      });

      assert.equal(result.image_url, scenario.expectedUrl);
      assert.equal(polls.length, 1);
      assert.deepEqual(polls[0].options.trustedOrigins, [baseUrl]);
      assert.deepEqual(polls[0].options.allowPrivateOrigins, [baseUrl]);
      assert.equal(polls[0].options.lookup, providerLookup);
      assert.equal(polls[0].options.requireHttpsForPublic, true);
    });
  }
});
