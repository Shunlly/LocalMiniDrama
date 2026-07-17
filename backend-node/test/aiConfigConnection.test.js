const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const aiConfigService = require('../src/services/aiConfigService');

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
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
      /401.*invalid api key/
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
        assert.match(error.message, /401/);
        return true;
      }
    );
  });
});
