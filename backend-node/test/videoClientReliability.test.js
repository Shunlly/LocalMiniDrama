const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const videoClient = require('../src/services/videoClient');
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
