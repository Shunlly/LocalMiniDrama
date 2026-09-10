'use strict';

const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const {
  fetchWithLimits,
  generateComfyUiImage,
} = require('../src/services/comfyUiClient');

const SOURCE = fs.readFileSync(path.join(__dirname, '../src/services/comfyUiClient.js'), 'utf8');
const LEAK = /sk-comfy-super-secret|Bearer |\bHTTP\s*\d+|redirect limit|has no Location|write request redirect|size limit/i;
const leftoverEnglish = [
  'ComfyUI redirect limit exceeded',
  'ComfyUI redirect has no Location',
  'ComfyUI write request redirect rejected',
  'ComfyUI local reference exceeds the size limit',
  'HTTP ${response.status}',
  '(HTTP ${',
];

const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

function hasCjk(value) {
  return /[\u4e00-\u9fff]/.test(String(value || ''));
}

async function startServer(handler) {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function json(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': data.length,
  });
  res.end(data);
}

function localNetworkPolicy(baseUrl) {
  return {
    trustedOrigins: [baseUrl],
    allowPrivateOrigins: [baseUrl],
    requireHttpsForPublic: true,
    lookup: async () => [{ address: '127.0.0.1', family: 4 }],
  };
}

function requestContext(overrides = {}) {
  return {
    fetchImpl: global.fetch,
    useSecureFetch: false,
    deadline: Date.now() + 5000,
    requestTimeoutMs: 5000,
    maxResponseBytes: 1024,
    secrets: [],
    trustedOrigins: ['https://comfy.example', 'https://cdn.example'],
    allowPrivateOrigins: [],
    networkLookup: async () => [{ address: '93.184.216.34', family: 4 }],
    requireHttpsForPublic: true,
    ...overrides,
  };
}

describe('ComfyUI 用户可见错误为简体中文', () => {
  it('源码不再拼接 HTTP 状态原文，也不再包含旧英文句', () => {
    for (const phrase of leftoverEnglish) {
      assert.equal(SOURCE.includes(phrase), false, `仍包含：${phrase}`);
    }
    assert.equal(SOURCE.includes('HTTP ${response.status}'), false);
  });

  it('HTTP 500 走中文映射，状态留在 error.status，密钥不回传', async () => {
    const secret = 'sk-comfy-super-secret';
    const baseUrl = await startServer(async (req, res) => {
      const url = new URL(req.url, 'http://fake.local');
      if (req.method === 'POST' && url.pathname === '/prompt') {
        await readBody(req);
        return json(res, 500, {
          error: { message: `upstream rejected Bearer ${secret} at https://vendor.invalid/run?token=${secret}` },
        });
      }
      return json(res, 404, {});
    });

    await assert.rejects(
      generateComfyUiImage({
        base_url: baseUrl,
        api_key: secret,
        settings: {
          workflow: { 1: { class_type: 'EmptyLatentImage', inputs: {} } },
          poll_interval_ms: 5,
          request_timeout_ms: 1000,
        },
      }, null, { prompt: 'error', provider_network_policy: localNetworkPolicy(baseUrl) }),
      (error) => {
        assert.equal(hasCjk(error.message), true);
        assert.match(error.message, /失败|不可用|稍后重试/);
        assert.doesNotMatch(error.message, LEAK);
        assert.doesNotMatch(error.message, /\?token=/);
        assert.equal(error.status, 500);
        assert.equal(error.code, 'COMFYUI_PROVIDER');
        return true;
      }
    );
  });

  it('重定向错误为中文', async () => {
    await assert.rejects(
      fetchWithLimits('https://comfy.example/view', { method: 'GET' }, requestContext({
        fetchImpl: async () => new Response(null, {
          status: 302,
          headers: { Location: 'https://comfy.example/view' },
        }),
      })),
      (error) => {
        assert.equal(error.code, 'COMFYUI_REDIRECT');
        assert.match(error.message, /重定向次数过多/);
        assert.doesNotMatch(error.message, /redirect limit/i);
        assert.equal(hasCjk(error.message), true);
        return true;
      }
    );

    await assert.rejects(
      fetchWithLimits('https://comfy.example/view', { method: 'GET' }, requestContext({
        fetchImpl: async () => new Response(null, { status: 302 }),
      })),
      (error) => {
        assert.equal(error.code, 'COMFYUI_REDIRECT');
        assert.match(error.message, /缺少目标地址/);
        assert.doesNotMatch(error.message, /Location/i);
        return true;
      }
    );

    await assert.rejects(
      fetchWithLimits('https://comfy.example/prompt', { method: 'POST', body: '{}' }, requestContext({
        fetchImpl: async () => new Response(null, {
          status: 307,
          headers: { Location: 'https://cdn.example/prompt' },
        }),
      })),
      (error) => {
        assert.equal(error.code, 'COMFYUI_REDIRECT');
        assert.match(error.message, /跨源重定向/);
        assert.doesNotMatch(error.message, /write request redirect/i);
        return true;
      }
    );
  });

  it('本地参考图超过大小限制为中文', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comfy-ref-'));
    fs.writeFileSync(path.join(dir, 'ref.png'), Buffer.alloc(64));
    const baseUrl = 'http://127.0.0.1:9';
    try {
      await assert.rejects(
        generateComfyUiImage({
          base_url: baseUrl,
          settings: {
            workflow: { 1: { class_type: 'LoadImage', inputs: { image: '{{reference_image_1}}' } } },
            max_reference_bytes: 8,
            poll_interval_ms: 5,
            request_timeout_ms: 1000,
          },
        }, null, {
          prompt: 'error',
          storage_local_path: dir,
          reference_image_urls: ['/static/ref.png'],
          provider_network_policy: localNetworkPolicy(baseUrl),
        }),
        (error) => {
          assert.equal(error.code, 'REFERENCE_TOO_LARGE');
          assert.match(error.message, /超过大小限制/);
          assert.doesNotMatch(error.message, /size limit/i);
          assert.equal(hasCjk(error.message), true);
          return true;
        }
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
