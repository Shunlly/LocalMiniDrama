const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const sharp = require('sharp');

const videoClient = require('../src/services/videoClient');
const aiConfigService = require('../src/services/aiConfigService');
const providerDnsLookup = async () => [{ address: '93.184.216.34', family: 4 }];

function createCapturingLogger() {
  const entries = [];
  const logger = { entries };
  for (const level of ['debug', 'info', 'warn', 'error']) {
    logger[level] = (message, meta) => entries.push({ level, message, meta });
  }
  return logger;
}

describe('video provider protocol resolution', () => {
  it('keeps unknown providers on OpenAI-compatible protocol without throwing', () => {
    assert.equal(
      videoClient.resolveVideoProtocol({
        provider: 'custom-provider',
        base_url: 'https://video.example.com/v1',
      }),
      'openai'
    );
  });

  it('infers Agnes from an Agnes endpoint when no protocol is explicit', () => {
    assert.equal(
      videoClient.resolveVideoProtocol({
        provider: 'custom-provider',
        base_url: 'https://apihub.agnes-ai.com/v1',
      }),
      'agnes'
    );
  });

  it('infers the dedicated MiniMax adapter protocol', () => {
    assert.equal(
      videoClient.resolveVideoProtocol({
        provider: 'minimax',
        base_url: 'https://api.minimax.example/v1',
      }),
      'minimax'
    );
  });
});

describe('dedicated video adapter delegation', () => {
  it('routes a Sora reference through target-size normalization before multipart upload', async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-sora-reference-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const source = await sharp({
      create: { width: 40, height: 30, channels: 3, background: '#336699' },
    }).png().toBuffer();
    fs.writeFileSync(path.join(root, 'reference.png'), source);
    const config = {
      provider: 'openai', api_protocol: 'sora', base_url: 'https://api.openai.example/v1',
      api_key: 'sora-key', endpoint: '/v1/videos', is_active: 1, is_default: 1,
      model: ['sora-2'], default_model: 'sora-2',
    };
    t.mock.method(aiConfigService, 'listConfigs', () => [config]);
    let uploadedMetadata;
    const result = await videoClient.callVideoApi(null, createCapturingLogger(), {
      prompt: 'resize reference', model: 'sora-2', aspect_ratio: '16:9',
      image_url: 'reference.png', storage_local_path: root,
      provider_dns_lookup: providerDnsLookup,
      fetch_impl: async (_url, options) => {
        const file = options.body.get('input_reference');
        uploadedMetadata = await sharp(Buffer.from(await file.arrayBuffer())).metadata();
        assert.equal(file.type, 'image/jpeg');
        return new Response(JSON.stringify({ id: 'sora-resized', status: 'queued' }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      },
    });
    assert.deepEqual(result, { status: 'queued', task_id: 'sora-resized' });
    assert.deepEqual(
      { width: uploadedMetadata.width, height: uploadedMetadata.height },
      { width: 1280, height: 720 }
    );
  });

  it('routes Sora polling through the adapter and exposes remote cancellation', async () => {
    let remoteCancel;
    const calls = [];
    const config = {
      provider: 'openai',
      api_protocol: 'sora',
      base_url: 'https://api.openai.example/v1',
      api_key: 'sora-key',
      endpoint: '/v1/videos',
      cancel_endpoint: '/v1/videos/{taskId}',
      register_remote_cancel: (callback) => { remoteCancel = callback; },
      provider_dns_lookup: providerDnsLookup,
      fetch_impl: async (url, options) => {
        calls.push({ url, method: options.method });
        if (options.method === 'DELETE') {
          return new Response(JSON.stringify({ status: 'cancelled' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ status: 'processing' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    };

    const result = await videoClient.pollVideoTask(
      null,
      createCapturingLogger(),
      45,
      'video_delegate_task',
      config,
      1,
      0
    );

    assert.equal(typeof result.error, 'string');
    assert.ok(result.error.length > 0);
    assert.equal(typeof remoteCancel, 'function');
    assert.deepEqual(await remoteCancel(), { confirmed: true });
    assert.deepEqual(calls, [
      { url: 'https://api.openai.example/v1/videos/video_delegate_task', method: 'GET' },
      { url: 'https://api.openai.example/v1/videos/video_delegate_task', method: 'DELETE' },
    ]);
  });

  it('accepts one Sora first-frame or reference-list image without dropping it', async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-sora-field-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.writeFileSync(path.join(root, 'first.png'), await sharp({
      create: { width: 24, height: 32, channels: 3, background: '#224466' },
    }).png().toBuffer());
    const config = {
      provider: 'openai', api_protocol: 'sora', base_url: 'https://api.openai.example/v1',
      api_key: 'sora-key', endpoint: '/v1/videos', is_active: 1, is_default: 1,
      model: ['sora-2'], default_model: 'sora-2',
    };
    t.mock.method(aiConfigService, 'listConfigs', () => [config]);
    for (const fields of [{ first_frame_url: 'first.png' }, { reference_urls: ['first.png'] }]) {
      let uploaded = false;
      await videoClient.callVideoApi(null, createCapturingLogger(), {
        prompt: 'field selection', model: 'sora-2', aspect_ratio: '9:16',
        storage_local_path: root, ...fields,
        provider_dns_lookup: providerDnsLookup,
        fetch_impl: async (_url, options) => {
          uploaded = options.body.get('input_reference') instanceof Blob;
          return new Response(JSON.stringify({ id: 'sora-field', status: 'queued' }), {
            status: 200, headers: { 'content-type': 'application/json' },
          });
        },
      });
      assert.equal(uploaded, true);
    }
  });

  it('rejects unsupported Sora ratios, ambiguous references, tail frames and corrupt images', async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-sora-invalid-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.writeFileSync(path.join(root, 'bad.png'), Buffer.from('not-an-image'));
    fs.writeFileSync(path.join(root, 'other.png'), await sharp({
      create: { width: 20, height: 20, channels: 3, background: '#335577' },
    }).png().toBuffer());
    const config = {
      provider: 'openai', api_protocol: 'sora', base_url: 'https://api.openai.example/v1',
      api_key: 'sora-key', endpoint: '/v1/videos', is_active: 1, is_default: 1,
      model: ['sora-2'], default_model: 'sora-2',
    };
    t.mock.method(aiConfigService, 'listConfigs', () => [config]);
    let dispatches = 0;
    const base = {
      prompt: 'invalid', model: 'sora-2', aspect_ratio: '16:9', storage_local_path: root,
      provider_dns_lookup: providerDnsLookup,
      fetch_impl: async () => { dispatches += 1; return new Response('{}'); },
    };
    await assert.rejects(videoClient.callVideoApi(null, createCapturingLogger(), {
      ...base, aspect_ratio: '1:1',
    }), /请选择 16:9 或 9:16/);
    await assert.rejects(videoClient.callVideoApi(null, createCapturingLogger(), {
      ...base, image_url: 'bad.png', first_frame_url: 'other.png',
    }), /只支持一张参考图/);
    await assert.rejects(videoClient.callVideoApi(null, createCapturingLogger(), {
      ...base, last_frame_url: 'bad.png',
    }), /不支持尾帧参考/);
    await assert.rejects(videoClient.callVideoApi(null, createCapturingLogger(), {
      ...base, image_url: 'bad.png',
    }), /无法解码或归一化/);
    assert.equal(dispatches, 0);
  });
});

describe('bounded provider requests', () => {
  it('passes an AbortSignal to fetch and rejects a hung request on timeout', async () => {
    const originalFetch = globalThis.fetch;
    let observedSignal;
    globalThis.fetch = (_url, options) => new Promise((_resolve, reject) => {
      observedSignal = options.signal;
      const keepAlive = setTimeout(
        () => reject(new Error('timeout signal did not abort the request')),
        1000
      );
      options.signal.addEventListener('abort', () => {
        clearTimeout(keepAlive);
        reject(options.signal.reason);
      }, { once: true });
    });

    try {
      await assert.rejects(
        videoClient.fetchVideoWithTimeout('https://video.example.com/hang', {}, 15, {
          fetchImpl: globalThis.fetch,
          lookup: providerDnsLookup,
          trustedOrigins: ['https://video.example.com'],
          allowPrivateOrigins: [],
          requireHttpsForPublic: true,
        }),
        (error) => error && (error.name === 'TimeoutError' || error.name === 'AbortError')
      );
      assert.ok(observedSignal, 'fetch must receive an AbortSignal');
      assert.equal(observedSignal.aborted, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('does not leave direct unbounded fetch calls in videoClient', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../src/services/videoClient.js'),
      'utf8'
    );
    assert.doesNotMatch(source, /\bfetch\s*\(/);
  });
});

describe('video provider network policy', () => {
  it('rejects public HTTP before DNS or credential-bearing fetch even with an injected fetch', async () => {
    let dnsCalls = 0;
    let fetchCalls = 0;
    await assert.rejects(
      videoClient.fetchVideoWithTimeout(
        'http://93.184.216.34/v1/videos',
        { headers: { Authorization: 'Bearer must-not-leave-process' } },
        100,
        {
          fetchImpl: async () => {
            fetchCalls += 1;
            return new Response('{}');
          },
          lookup: async () => {
            dnsCalls += 1;
            return [{ address: '93.184.216.34', family: 4 }];
          },
          trustedOrigins: ['http://93.184.216.34'],
          allowPrivateOrigins: [],
          requireHttpsForPublic: true,
        }
      ),
      /must use HTTPS/i
    );
    assert.equal(dnsCalls, 0);
    assert.equal(fetchCalls, 0);
  });

  it('blocks historical public HTTP configs for Sora and MiniMax creation and polling before dispatch', async (t) => {
    let currentConfig;
    t.mock.method(aiConfigService, 'listConfigs', () => [currentConfig]);

    for (const providerCase of [
      { provider: 'openai', protocol: 'sora', model: 'sora-2', endpoint: '/v1/videos' },
      { provider: 'minimax', protocol: 'minimax', model: 'MiniMax-Hailuo-2.3', endpoint: '/video_generation' },
    ]) {
      let dnsCalls = 0;
      let fetchCalls = 0;
      let remoteCancel;
      const lookup = async () => {
        dnsCalls += 1;
        return [{ address: '93.184.216.34', family: 4 }];
      };
      const fetchImpl = async (_url, options) => {
        fetchCalls += 1;
        assert.equal(options.headers.Authorization, 'Bearer historical-secret');
        return new Response('{}');
      };
      currentConfig = {
        provider: providerCase.provider,
        api_protocol: providerCase.protocol,
        base_url: 'http://public-video.example/v1',
        api_key: 'historical-secret',
        endpoint: providerCase.endpoint,
        model: [providerCase.model],
        default_model: providerCase.model,
        is_active: 1,
        is_default: 1,
        provider_dns_lookup: lookup,
        fetch_impl: fetchImpl,
        register_remote_cancel: (callback) => { remoteCancel = callback; },
      };

      await assert.rejects(
        videoClient.callVideoApi(null, createCapturingLogger(), {
          prompt: '不得发送',
          model: providerCase.model,
          preferred_provider: providerCase.provider,
          provider_dns_lookup: lookup,
          fetch_impl: fetchImpl,
          register_remote_cancel: currentConfig.register_remote_cancel,
        })
      );
      await assert.rejects(
        videoClient.pollVideoTask(
          null,
          createCapturingLogger(),
          99,
          'historical_task',
          currentConfig,
          1,
          0
        )
      );

      assert.equal(remoteCancel, undefined);
      assert.equal(dnsCalls, 0);
      assert.equal(fetchCalls, 0);
    }
  });
});

describe('poll termination and privacy', () => {
  it('terminates immediately on provider 401 and redacts response secrets', async () => {
    const originalFetch = globalThis.fetch;
    const log = createCapturingLogger();
    let fetchCalls = 0;
    globalThis.fetch = async (_url, options) => {
      fetchCalls += 1;
      assert.ok(options.signal, 'poll requests must be bounded');
      return new Response(JSON.stringify({
        code: 'AUTH_DENIED',
        error: 'Bearer sk-provider-secret',
        video_url: 'https://cdn.example.com/out.mp4?X-Amz-Signature=signed-secret',
        prompt: 'private polling prompt',
      }), { status: 401, headers: { 'content-type': 'application/json' } });
    };

    try {
      const result = await videoClient.pollVideoTask(
        null,
        log,
        41,
        'task-private-id',
        {
          provider: 'custom-provider',
          api_protocol: 'openai',
          base_url: 'https://video.example.com/v1',
          query_endpoint: '/videos/{taskId}',
          api_key: 'sk-config-secret',
          provider_dns_lookup: providerDnsLookup,
          fetch_impl: globalThis.fetch,
        },
        4,
        0
      );

      assert.equal(fetchCalls, 1);
      assert.match(result.error, /401/);
      assert.match(result.error, /AUTH_DENIED/);
      assert.match(result.error, /response_bytes=/);
      assert.doesNotMatch(result.error, /sk-provider-secret|signed-secret|private polling prompt/);
      const serializedLogs = JSON.stringify(log.entries);
      assert.doesNotMatch(
        serializedLogs,
        /sk-provider-secret|signed-secret|private polling prompt|sk-config-secret/
      );
      assert.match(serializedLogs, /REDACTED/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('terminates other terminal 4xx statuses without retrying', async () => {
    const originalFetch = globalThis.fetch;
    const log = createCapturingLogger();

    try {
      for (const status of [400, 403, 404]) {
        let fetchCalls = 0;
        globalThis.fetch = async () => {
          fetchCalls += 1;
          return new Response(JSON.stringify({ message: `provider rejected ${status}` }), {
            status,
            headers: { 'content-type': 'application/json' },
          });
        };

        const result = await videoClient.pollVideoTask(
          null,
          log,
          42,
          `task-${status}`,
          {
            provider: 'custom-provider',
            api_protocol: 'openai',
            base_url: 'https://video.example.com/v1',
            api_key: 'secret',
            provider_dns_lookup: providerDnsLookup,
            fetch_impl: globalThis.fetch,
          },
          3,
          0
        );
        assert.equal(fetchCalls, 1, `HTTP ${status} must stop after one request`);
        assert.match(result.error, new RegExp(String(status)));
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('keeps retrying transient 5xx responses', async () => {
    const originalFetch = globalThis.fetch;
    const log = createCapturingLogger();
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) return new Response('temporarily unavailable', { status: 503 });
      return new Response(JSON.stringify({
        status: 'completed',
        video_url: 'https://cdn.example.com/result.mp4',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    try {
      const result = await videoClient.pollVideoTask(
        null,
        log,
        43,
        'task-retry',
        {
          provider: 'custom-provider',
          api_protocol: 'openai',
          base_url: 'https://video.example.com/v1',
          api_key: 'secret',
          provider_dns_lookup: providerDnsLookup,
          fetch_impl: globalThis.fetch,
        },
        3,
        0
      );
      assert.equal(fetchCalls, 2);
      assert.equal(result.video_url, 'https://cdn.example.com/result.mp4');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('redacts credentials, signed URL queries, prompts, and oversized fields', () => {
    const target = createCapturingLogger();
    const safeLog = videoClient.createSafeVideoLogger(target);
    safeLog.info('provider request', {
      Authorization: 'Bearer sk-live-secret-prefix',
      apiKey: 'sk-camel-case-secret',
      url: 'https://cdn.example.com/video.mp4?token=signed-url-secret',
      prompt: 'complete private story prompt',
      error: 'provider rejected sk-plain-message-secret',
      raw_text: 'opaque response echoed the complete private story prompt',
      raw: JSON.stringify({
        output: 'x'.repeat(10000),
        url: 'https://cdn.example.com/result.mp4?sig=response-secret',
      }),
    });

    const serialized = JSON.stringify(target.entries);
    assert.doesNotMatch(
      serialized,
      /sk-live-secret-prefix|sk-camel-case-secret|sk-plain-message-secret|signed-url-secret|complete private story prompt|response-secret/
    );
    assert.match(serialized, /REDACTED/);
    assert.ok(serialized.length < 6000, 'sanitized log entry must remain bounded');
  });
});
