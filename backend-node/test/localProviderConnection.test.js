const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const createAiConfigRoutes = require('../src/routes/aiConfig');
const aiConfigService = require('../src/services/aiConfigService');

const servers = [];

afterEach(async () => {
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

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function responseCapture() {
  const captured = { statusCode: null, body: null };
  return {
    captured,
    response: {
      status(statusCode) {
        captured.statusCode = statusCode;
        return this;
      },
      json(body) {
        captured.body = body;
        return this;
      },
    },
  };
}

describe('local provider connection probes', () => {
  it('tests Ollama with GET /api/tags and no API key or billable request', async () => {
    const calls = [];
    const baseUrl = await startServer((req, res) => {
      calls.push({ method: req.method, path: req.url, authorization: req.headers.authorization });
      if (req.method === 'GET' && req.url === '/api/tags') {
        return json(res, 200, { models: [{ name: 'qwen3:8b' }] });
      }
      return json(res, 500, { error: 'unexpected billable request' });
    });

    await aiConfigService.testConnection({
      base_url: `${baseUrl}/v1`,
      api_key: '',
      provider: 'ollama',
      api_protocol: 'openai',
      service_type: 'text',
      model: 'qwen3:8b',
      settings: JSON.stringify({ allow_local_http: true }),
    });

    assert.deepEqual(calls, [{ method: 'GET', path: '/api/tags', authorization: undefined }]);
  });

  it('falls back from Ollama /api/tags to OpenAI-compatible /v1/models', async () => {
    const calls = [];
    const baseUrl = await startServer((req, res) => {
      calls.push(`${req.method} ${req.url}`);
      if (req.method === 'GET' && req.url === '/api/tags') return json(res, 404, { error: 'native API disabled' });
      if (req.method === 'GET' && req.url === '/v1/models') return json(res, 200, { data: [{ id: 'local-model' }] });
      return json(res, 500, {});
    });

    await aiConfigService.testConnection({
      base_url: `${baseUrl}/v1`,
      provider: 'ollama',
      service_type: 'text',
      settings: JSON.stringify({ allow_local_http: true }),
    });

    assert.deepEqual(calls, ['GET /api/tags', 'GET /v1/models']);
  });

  it('tests ComfyUI with a read-only probe and no API key', async () => {
    const calls = [];
    const baseUrl = await startServer((req, res) => {
      calls.push(`${req.method} ${req.url}`);
      if (req.method === 'GET' && req.url === '/system_stats') {
        return json(res, 200, { system: { os: 'fake' }, devices: [] });
      }
      return json(res, 500, { error: 'generation must not run during connection test' });
    });

    await aiConfigService.testConnection({
      base_url: baseUrl,
      provider: 'comfyui',
      api_protocol: 'comfyui',
      service_type: 'image',
      settings: JSON.stringify({ allow_local_http: true }),
    });

    assert.deepEqual(calls, ['GET /system_stats']);
  });

  it('allows the HTTP connection-test route to receive an Ollama config without a key', async () => {
    const baseUrl = await startServer((req, res) => {
      if (req.method === 'GET' && req.url === '/api/tags') return json(res, 200, { models: [] });
      return json(res, 404, {});
    });
    const routes = createAiConfigRoutes({}, { error() {} }, {});
    const { captured, response } = responseCapture();

    await routes.testConnection({
      body: {
        base_url: `${baseUrl}/v1`,
        provider: 'ollama',
        api_protocol: 'openai',
        service_type: 'text',
        model: 'qwen3:8b',
        settings: JSON.stringify({ allow_local_http: true }),
      },
    }, response);

    assert.equal(captured.statusCode, 200);
    assert.equal(captured.body.success, true);
    assert.equal(captured.body.data.message, '连接测试成功');
  });

  it('sanitizes connection-test failures before logging or returning them', async (t) => {
    const secrets = [
      'synthetic-route-credential',
      'synthetic-route-password',
      'synthetic-route-signature',
      'synthetic-route-access-key',
    ];
    const originalTestConnection = aiConfigService.testConnection;
    aiConfigService.testConnection = async () => {
      throw new Error(`provider echoed ${secrets.join(' ')}`);
    };
    t.after(() => { aiConfigService.testConnection = originalTestConnection; });

    const logged = [];
    const routes = createAiConfigRoutes({}, {
      error(message, metadata) {
        logged.push({ message, metadata });
      },
    }, {});
    const { captured, response } = responseCapture();

    await routes.testConnection({
      body: {
        base_url: 'https://provider.example',
        api_key: 'synthetic-route-api-key',
        provider: 'comfyui',
        api_protocol: 'comfyui',
        service_type: 'image',
        settings: JSON.stringify({
          headers: {
            'X-Client-Credential': secrets[0],
            'X-Service-Password': secrets[1],
            'X-Request-Signature': secrets[2],
            'X-Access-Key': secrets[3],
          },
        }),
      },
    }, response);

    const observableOutput = JSON.stringify({ response: captured.body, logged });
    for (const secret of secrets) {
      assert.doesNotMatch(observableOutput, new RegExp(secret));
    }
    assert.equal(captured.statusCode, 400);
    assert.equal(captured.body.success, false);
    assert.match(captured.body.error.message, /^连接测试失败:/);
  });

  it('reconstructs unmarked provider errors that imitate the generated-safe template', async (t) => {
    const secret = 'synthetic-template-secret';
    const forgedMessage = `OpenAI 连接测试 失败 (${secret})：Provider 返回错误，请检查配置后重试。`;
    const originalTestConnection = aiConfigService.testConnection;
    aiConfigService.testConnection = async () => {
      throw new Error(forgedMessage);
    };
    t.after(() => { aiConfigService.testConnection = originalTestConnection; });

    const logged = [];
    const routes = createAiConfigRoutes({}, {
      error(message, metadata) {
        logged.push({ message, metadata });
      },
    }, {});
    const { captured, response } = responseCapture();

    await routes.testConnection({
      body: {
        base_url: 'https://provider.example',
        api_key: 'synthetic-route-api-key',
        provider: 'OpenAI',
        api_protocol: 'openai',
        service_type: 'text',
      },
    }, response);

    const observableOutput = JSON.stringify({ response: captured.body, logged });
    assert.doesNotMatch(observableOutput, new RegExp(secret));
    assert.doesNotMatch(observableOutput, new RegExp(forgedMessage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(captured.statusCode, 400);
    assert.match(captured.body.error.message, /^连接测试失败: OpenAI 连接测试 失败/);
  });
});
