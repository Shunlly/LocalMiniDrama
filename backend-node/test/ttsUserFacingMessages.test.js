
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const aiConfigService = require('../src/services/aiConfigService');
const {
  isTrustedChineseUserError,
  ttsBusinessFailureMessage,
  ttsHttpFailureMessage,
  toUserFacingTtsMessage,
} = require('../src/services/providerErrorSanitizer');
const {
  synthesizeWithMinimax,
  synthesizeWithOpenai,
  toUserFacingTtsError,
} = require('../src/services/ttsService');

const SECRET = 'Bearer sk-provider-secret-123456';
const LEAK = /sk-provider-secret|Bearer |response_bytes=|\bHTTP\s*[:=]?\s*\d{3}\b|Unauthorized|Forbidden|Internal Server Error|OpenAI TTS|MiniMax TTS|Redirects are not allowed/i;

function hasCjk(value) {
  return /[\u4e00-\u9fff]/.test(String(value || ''));
}

function assertSafeChinese(message) {
  assert.equal(typeof message, 'string');
  assert.equal(hasCjk(message), true);
  assert.doesNotMatch(message, LEAK);
  assert.equal(isTrustedChineseUserError(message), true);
}

function localProviderNetworkOptions(baseUrl) {
  return aiConfigService.getProviderNetworkOptions({
    base_url: baseUrl,
    provider: 'local_tts',
    service_type: 'tts',
    settings: JSON.stringify({ allow_local_http: true }),
  });
}

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

describe('TTS 用户可见错误为简体中文', () => {
  it('sanitizer 将 HTTP 状态映射为中文，不回传状态原文', () => {
    assert.match(ttsHttpFailureMessage(401), /TTS 认证失败/);
    assert.match(ttsHttpFailureMessage(403), /TTS 认证失败/);
    assert.match(ttsHttpFailureMessage(404), /TTS 接口不存在/);
    assert.match(toUserFacingTtsMessage(Object.assign(new Error('HTTP 404 Invalid Authorization'), { status: 404 })), /TTS 认证失败/);
    assert.doesNotMatch(toUserFacingTtsMessage(Object.assign(new Error('HTTP 404 Invalid Authorization'), { status: 404 })), /HTTP\s*404|Invalid Authorization/i);
    assert.match(ttsHttpFailureMessage(429), /繁忙/);
    assert.match(ttsHttpFailureMessage(500), /配音生成失败/);
    for (const status of [400, 401, 403, 404, 408, 429, 500, 502]) {
      assertSafeChinese(ttsHttpFailureMessage(status));
    }
    assert.match(ttsBusinessFailureMessage(1001), /超时/);
    assert.match(ttsBusinessFailureMessage(1002), /繁忙/);
    assert.match(ttsBusinessFailureMessage(1004), /认证失败/);
    assertSafeChinese(ttsBusinessFailureMessage(1004));
    assertSafeChinese(ttsBusinessFailureMessage(2049));
  });

  it('英文厂商原文、密钥和 HTTP 状态不会进入用户文案', () => {
    const dumped = new Error(`OpenAI TTS 请求失败（HTTP 401）: ${SECRET}`);
    dumped.status = 401;
    const mapped = toUserFacingTtsError(dumped);
    assertSafeChinese(mapped.message);
    assert.match(mapped.message, /TTS 认证失败/);
    assert.equal(mapped.status, 401);

    const mixed = new Error('配音失败 HTTP 401 Unauthorized Bearer sk-provider-secret-123456');
    assertSafeChinese(toUserFacingTtsError(mixed).message);

    assert.match(toUserFacingTtsMessage(new Error('Image generation HTTP timeout after 15ms')), /配音生成超时/);
    const canceled = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
    assert.equal(toUserFacingTtsMessage(canceled), '操作已取消');
    const network = Object.assign(new Error('fetch failed'), { code: 'ECONNREFUSED' });
    assert.match(toUserFacingTtsMessage(network), /连接失败/);
    assert.doesNotMatch(toUserFacingTtsMessage(network), /ECONNREFUSED|fetch failed/);
    assert.match(toUserFacingTtsMessage(new Error('Redirects are not allowed.')), /重定向/);
  });

  it('OpenAI 兼容 401 不回传响应体、密钥和 HTTP 原文', async () => {
    await withServer((_request, response) => {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        error: SECRET,
        input: 'private narration',
      }));
    }, async (baseUrl) => {
      await assert.rejects(
        synthesizeWithOpenai(
          'private narration',
          'alloy',
          'sk-request-secret',
          baseUrl,
          'tts-1',
          1,
          2000,
          undefined,
          localProviderNetworkOptions(baseUrl)
        ),
        (error) => {
          assertSafeChinese(error.message);
          assert.match(error.message, /TTS 认证失败/);
          assert.doesNotMatch(error.message, /sk-request-secret|private narration/i);
          return true;
        }
      );
    });
  });

  it('MiniMax 业务失败不回传 status_msg 和密钥', async () => {
    await withServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        base_resp: { status_code: 1004, status_msg: `invalid api key ${SECRET}` },
        data: {},
      }));
    }, async (baseUrl) => {
      await assert.rejects(
        synthesizeWithMinimax(
          'hello',
          'voice-one',
          'minimax-secret',
          'group-one',
          'speech-test',
          `${baseUrl}/v1`,
          2000,
          undefined,
          localProviderNetworkOptions(`${baseUrl}/v1`)
        ),
        (error) => {
          assertSafeChinese(error.message);
          assert.match(error.message, /TTS 认证失败/);
          assert.doesNotMatch(error.message, /invalid api key|minimax-secret|status_msg/i);
          return true;
        }
      );
    });
  });

  it('MiniMax HTTP 429 使用中文繁忙提示', async () => {
    await withServer((_request, response) => {
      response.writeHead(429, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: SECRET }));
    }, async (baseUrl) => {
      await assert.rejects(
        synthesizeWithMinimax(
          'hello',
          'voice-one',
          'minimax-secret',
          'group-one',
          'speech-test',
          `${baseUrl}/v1`,
          2000,
          undefined,
          localProviderNetworkOptions(`${baseUrl}/v1`)
        ),
        (error) => {
          assertSafeChinese(error.message);
          assert.match(error.message, /繁忙/);
          return true;
        }
      );
    });
  });

  it('TTS 源码不再拼接 HTTP 状态原文给用户', () => {
    const files = [
      path.join(__dirname, '../src/services/ttsService.js'),
      path.join(__dirname, '../src/services/providerErrorSanitizer.js'),
    ];
    const forbidden = [
      'HTTP ${status}',
      'HTTP ${response.status}',
      'OpenAI TTS 请求失败（HTTP',
      'MiniMax TTS 请求失败',
      'Redirects are not allowed.',
      'No TTS provider is configured',
      'text cannot be empty',
    ];
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      for (const phrase of forbidden) {
        assert.equal(source.includes(phrase), false, `${path.basename(file)} 仍包含：${phrase}`);
      }
    }
  });
});
