const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const aiConfigService = require('../src/services/aiConfigService');

const {
  DEFAULT_TTS_TIMEOUT_MS,
  normalizeTtsTimeoutMs,
  synthesize,
  synthesizeWithMinimax,
  synthesizeWithOpenai,
} = require('../src/services/ttsService');

async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function localProviderNetworkOptions(baseUrl, provider = 'local_tts') {
  return aiConfigService.getProviderNetworkOptions({
    base_url: baseUrl,
    provider,
    service_type: 'tts',
    settings: JSON.stringify({ allow_local_http: true }),
  });
}

describe('TTS request reliability', () => {
  it('reports a missing TTS provider as an actionable client error', async () => {
    const db = {
      prepare() {
        return { all: () => [] };
      },
    };
    await assert.rejects(
      synthesize(db, { info() {} }, { text: 'hello', storage_base: '.' }),
      (error) => error?.code === 'BAD_REQUEST' && /No TTS provider/.test(error.message)
    );
  });

  it('normalizes provider timeouts to a bounded range', () => {
    assert.equal(normalizeTtsTimeoutMs(), DEFAULT_TTS_TIMEOUT_MS);
    assert.equal(normalizeTtsTimeoutMs('invalid'), DEFAULT_TTS_TIMEOUT_MS);
    assert.equal(normalizeTtsTimeoutMs(5), 1000);
    assert.equal(normalizeTtsTimeoutMs(1500.4), 1500);
    assert.equal(normalizeTtsTimeoutMs(60 * 60 * 1000), 5 * 60 * 1000);
  });

  it('calls an OpenAI-compatible endpoint without exposing request content', async () => {
    const audio = Buffer.from('fake-mp3');
    await withServer(async (request, response) => {
      assert.equal(request.method, 'POST');
      assert.equal(request.url, '/v1/audio/speech');
      assert.equal(request.headers.authorization, 'Bearer sk-private-test-key');
      assert.equal(request.headers['idempotency-key'], 'workflow:test:tts:openai');
      assert.deepEqual(await readJsonBody(request), {
        model: 'tts-test',
        input: 'private narration',
        voice: 'alloy',
        response_format: 'mp3',
        speed: 1.25,
      });
      response.writeHead(200, { 'content-type': 'audio/mpeg' });
      response.end(audio);
    }, async (baseUrl) => {
      const result = await synthesizeWithOpenai(
        'private narration',
        'alloy',
        'sk-private-test-key',
        `${baseUrl}/v1`,
        'tts-test',
        1.25,
        2000,
        'workflow:test:tts:openai',
        localProviderNetworkOptions(`${baseUrl}/v1`)
      );
      assert.deepEqual(result, audio);
    });
  });

  it('supports a custom MiniMax base URL and encoded group id', async () => {
    await withServer(async (request, response) => {
      assert.equal(request.url, '/v1/t2a_v2?GroupId=group%20one');
      assert.equal(request.headers.authorization, 'Bearer minimax-secret');
      assert.equal(request.headers['idempotency-key'], 'workflow:test:tts:minimax');
      const body = await readJsonBody(request);
      assert.equal(body.model, 'speech-test');
      assert.equal(body.text, 'hello');
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        base_resp: { status_code: 0 },
        data: { audio: Buffer.from('mini-audio').toString('hex') },
      }));
    }, async (baseUrl) => {
      const result = await synthesizeWithMinimax(
        'hello',
        'voice-one',
        'minimax-secret',
        'group one',
        'speech-test',
        `${baseUrl}/v1`,
        2000,
        'workflow:test:tts:minimax',
        localProviderNetworkOptions(`${baseUrl}/v1`)
      );
      assert.deepEqual(result, Buffer.from('mini-audio'));
    });
  });

  it('allows local HTTP only for a recognized TTS provider with the explicit switch', async () => {
    const os = require('node:os');
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-tts-idempotency-'));
    let requests = 0;
    try {
      await withServer((request, response) => {
        requests += 1;
        assert.equal(request.headers['idempotency-key'], 'workflow:test:tts:file');
        response.writeHead(200, { 'content-type': 'audio/mpeg' });
        response.end(Buffer.from('stable-audio'));
      }, async (baseUrl) => {
        const params = {
          text: 'stable narration',
          storyboard_id: 17,
          storage_base: storageRoot,
          idempotency_key: 'workflow:test:tts:file',
          config: {
            provider: 'openai_compatible',
            api_key: 'test-key',
            base_url: `${baseUrl}/v1`,
            model: ['tts-test'],
            default_model: 'tts-test',
            settings: JSON.stringify({ allow_local_http: true }),
          },
        };
        const logger = { info() {} };
        const first = await synthesize(null, logger, params);
        const second = await synthesize(null, logger, params);
        assert.equal(first.local_path, second.local_path);
        assert.equal(second.idempotent_reuse, true);
        assert.equal(requests, 1);
        assert.equal(fs.readFileSync(path.join(storageRoot, first.local_path)).toString(), 'stable-audio');
      });
    } finally {
      fs.rmSync(storageRoot, { recursive: true, force: true });
    }
  });

  it('rejects local TTS when either the provider type or local HTTP switch is missing', async () => {
    let requests = 0;
    await withServer((_request, response) => {
      requests += 1;
      response.end(Buffer.from('must-not-be-called'));
    }, async (baseUrl) => {
      const common = {
        text: 'private narration',
        storage_base: '.',
        config: {
          api_key: 'stored-secret-must-not-be-sent',
          base_url: `${baseUrl}/v1`,
          model: ['tts-test'],
          default_model: 'tts-test',
        },
      };
      await assert.rejects(
        synthesize(null, { info() {} }, {
          ...common,
          config: { ...common.config, provider: 'local_tts', settings: '{}' },
        }),
        (error) => error?.code === 'INVALID_PROVIDER_URL'
      );
      await assert.rejects(
        synthesize(null, { info() {} }, {
          ...common,
          config: {
            ...common.config,
            provider: 'openai',
            settings: JSON.stringify({ allow_local_http: true }),
          },
        }),
        (error) => error?.code === 'INVALID_PROVIDER_URL'
      );
    });
    assert.equal(requests, 0);
  });

  it('rejects DNS rebinding to a private address before opening a TTS socket', async () => {
    let lookupCalls = 0;
    const networkOptions = aiConfigService.getProviderNetworkOptions({
      base_url: 'https://tts-provider.example/v1',
      provider: 'openai_compatible',
      service_type: 'tts',
      settings: '{}',
    }, {
      lookup: async () => {
        lookupCalls += 1;
        return [{ address: '127.0.0.1', family: 4 }];
      },
    });

    await assert.rejects(
      synthesizeWithOpenai(
        'private narration', 'alloy', 'stored-secret', 'https://tts-provider.example/v1',
        'tts-1', 1, 2000, undefined, networkOptions
      ),
      (error) => error?.code === 'UNSAFE_MEDIA_REFERENCE'
    );
    assert.equal(lookupCalls, 1);
  });

  it('rejects TTS redirects without sending credentials or bodies to the target', async () => {
    let targetRequests = 0;
    await withServer((_request, response) => {
      targetRequests += 1;
      response.end(Buffer.from('unexpected'));
    }, async (targetBaseUrl) => {
      await withServer((_request, response) => {
        response.writeHead(307, { Location: `${targetBaseUrl}/collect` });
        response.end();
      }, async (sourceBaseUrl) => {
        await assert.rejects(
          synthesizeWithOpenai(
            'private narration', 'alloy', 'stored-secret', sourceBaseUrl,
            'tts-1', 1, 2000, undefined, localProviderNetworkOptions(sourceBaseUrl)
          ),
          /Redirects are not allowed/
        );
      });
    });
    assert.equal(targetRequests, 0);
  });

  it('times out a hung OpenAI-compatible request', async () => {
    await withServer((_request, _response) => {}, async (baseUrl) => {
      await assert.rejects(
        synthesizeWithOpenai(
          'hello', 'alloy', '', baseUrl, 'tts-1', 1, 1, undefined,
          localProviderNetworkOptions(baseUrl)
        ),
        /OpenAI TTS .*timeout|OpenAI TTS .*超时/i
      );
    });
  });

  it('真实挂起的 TTS 请求取消后及时中止，且不留下目标或临时文件', async () => {
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-tts-abort-'));
    let requestStarted;
    let requestClosed;
    const started = new Promise((resolve) => { requestStarted = resolve; });
    const closed = new Promise((resolve) => { requestClosed = resolve; });
    const controller = new AbortController();
    try {
      await withServer((_request, response) => {
        requestStarted();
        response.once('close', requestClosed);
      }, async (baseUrl) => {
        const pending = synthesize(null, { info() {} }, {
          text: '会被取消的旁白',
          storyboard_id: 88,
          storage_base: storageRoot,
          signal: controller.signal,
          config: {
            provider: 'openai_compatible',
            api_key: 'test-key',
            base_url: `${baseUrl}/v1`,
            model: ['tts-test'],
            default_model: 'tts-test',
            settings: JSON.stringify({ allow_local_http: true }),
          },
        });
        await started;
        const startedAt = Date.now();
        controller.abort(new Error('TTS 请求取消'));
        let timeout;
        try {
          await assert.rejects(
            Promise.race([
              pending,
              new Promise((_, reject) => {
                timeout = setTimeout(() => reject(new Error('TTS 取消未及时收敛')), 750);
              }),
            ]),
            (error) => error?.message === 'TTS 请求取消'
          );
        } finally {
          clearTimeout(timeout);
        }
        assert.ok(Date.now() - startedAt < 750, '挂起请求取消应在有界时间内返回');

        let closeTimeout;
        try {
          await Promise.race([
            closed,
            new Promise((_, reject) => {
              closeTimeout = setTimeout(() => reject(new Error('TTS socket 未及时关闭')), 750);
            }),
          ]);
        } finally {
          clearTimeout(closeTimeout);
        }
      });
      const audioDir = path.join(storageRoot, 'audio');
      assert.equal(fs.existsSync(audioDir), true);
      assert.deepEqual(fs.readdirSync(audioDir), []);
    } finally {
      fs.rmSync(storageRoot, { recursive: true, force: true });
    }
  });

  it('does not include provider response bodies or secrets in errors', async () => {
    await withServer((_request, response) => {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        error: 'Bearer sk-provider-secret',
        input: 'private narration',
      }));
    }, async (baseUrl) => {
      await assert.rejects(
        synthesizeWithOpenai(
          'private narration', 'alloy', 'sk-request-secret', baseUrl,
          undefined, undefined, undefined, undefined,
          localProviderNetworkOptions(baseUrl)
        ),
        (error) => {
          assert.equal(error.message, 'OpenAI TTS HTTP 401');
          assert.doesNotMatch(error.message, /secret|private narration/i);
          return true;
        }
      );
    });
  });

  it('contains no direct console logging in the TTS service', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../src/services/ttsService.js'),
      'utf8'
    );
    assert.doesNotMatch(source, /console\.(?:log|info|warn|error)\s*\(/);
  });
});
