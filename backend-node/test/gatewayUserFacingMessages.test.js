'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildProviderErrorMessage,
  createProviderHttpError,
  toSafeProviderErrorMessage,
  toUserFacingGatewayError,
  toUserFacingProcessError,
} = require('../src/services/providerErrorSanitizer');
const {
  classifyHttpFailure,
  normalizeProviderRequestError,
  requestTimeoutError,
} = require('../src/services/imageGateway/requestError');
const { imageProviderFailure } = require('../src/services/imageGateway/runtime');
const { videoProviderFailure } = require('../src/services/videoGateway/helpers');

const SECRET = 'Bearer sk-provider-secret-123456';
const LEAK = /sk-provider-secret|Bearer |response_bytes=|\bHTTP\s+\d+|Unauthorized|Forbidden|Internal Server Error/i;

function hasCjk(value) {
  return /[\u4e00-\u9fff]/.test(String(value || ''));
}

describe('图片/视频 gateway 用户错误为简体中文', () => {
  it('HTTP 401 走 sanitizer，不回传状态原文和密钥', () => {
    const body = JSON.stringify({ code: 'AUTH_DENIED', error: SECRET });
    const error = classifyHttpFailure({
      provider: 'Kling',
      operation: 'image request',
      status: 401,
      code: 'AUTH_DENIED',
      responseBody: body,
    });
    const message = toUserFacingGatewayError(error, { provider: 'Kling', operation: 'image request' });
    assert.equal(hasCjk(message), true);
    assert.match(message, /认证失败/);
    assert.doesNotMatch(message, LEAK);
    assert.doesNotMatch(message, /AUTH_DENIED/);
    assert.equal(error.status, 401);
    assert.equal(error.providerCode, 'AUTH_DENIED');

    const imageResult = imageProviderFailure('Kling', 'image request', 401, body, 'AUTH_DENIED');
    assert.match(imageResult.error, /认证失败/);
    assert.doesNotMatch(imageResult.error, LEAK);

    const videoResult = videoProviderFailure('Kling', 'video request', 401, body, 'AUTH_DENIED');
    assert.equal(typeof videoResult.error, 'string');
    assert.match(videoResult.error, /认证失败/);
    assert.doesNotMatch(videoResult.error, LEAK);
  });

  it('英文超时、取消和网络错误映射为中文', () => {
    const timeout = Object.assign(new Error('Image generation HTTP timeout after 15ms'), {
      name: 'AbortError',
      isTimeout: true,
      code: 'ETIMEDOUT',
    });
    const timeoutMessage = toUserFacingGatewayError(timeout, { provider: 'Kling', operation: 'image request' });
    assert.match(timeoutMessage, /超时/);
    assert.doesNotMatch(timeoutMessage, /timeout after|HTTP timeout/i);

    const classifiedTimeout = requestTimeoutError(timeout, { provider: 'Kling', operation: 'image request' });
    assert.match(classifiedTimeout.message, /超时/);
    assert.doesNotMatch(classifiedTimeout.message, LEAK);

    const canceled = normalizeProviderRequestError(
      Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }),
      { provider: 'Kling', operation: 'image request' }
    );
    assert.match(canceled.message, /取消/);
    assert.doesNotMatch(canceled.message, /aborted/i);

    const network = normalizeProviderRequestError(
      Object.assign(new Error('fetch failed'), { code: 'ECONNREFUSED' }),
      { provider: 'Kling', operation: 'video request' }
    );
    assert.match(network.message, /网络连接失败/);
    assert.doesNotMatch(network.message, /ECONNREFUSED|fetch failed|code /i);
    assert.equal(network.code, 'ECONNREFUSED');
  });

  it('sanitizer 用户文案不含 HTTP 状态原文，且密钥不回传', () => {
    const built = buildProviderErrorMessage({
      provider: 'OpenAI',
      operation: '连接测试',
      status: 401,
      responseBody: JSON.stringify({ error: SECRET }),
    });
    assert.match(built, /认证失败/);
    assert.doesNotMatch(built, LEAK);

    const created = createProviderHttpError({
      provider: 'AI 服务',
      operation: '视觉请求',
      status: 403,
      responseBody: JSON.stringify({ error: SECRET }),
    });
    const processMessage = toUserFacingProcessError(created, '操作失败，请稍后重试');
    assert.match(processMessage, /请求被禁止|失败/);
    assert.doesNotMatch(processMessage, LEAK);
    assert.doesNotMatch(toSafeProviderErrorMessage(created), LEAK);
  });

  it('gateway 源码不再拼接 HTTP 状态原文给用户', () => {
    const files = [
      path.join(__dirname, '../src/services/imageGateway/requestError.js'),
      path.join(__dirname, '../src/services/imageGateway/runtime.js'),
      path.join(__dirname, '../src/services/videoGateway/helpers.js'),
      path.join(__dirname, '../src/services/videoGateway/jimengVideoAdapter.js'),
      path.join(__dirname, '../src/services/providerErrorSanitizer.js'),
    ];
    const forbidden = [
      'HTTP ${status}',
      "HTTP ' + res.status",
      'Image generation HTTP timeout after',
      'The operation was aborted.',
      'authentication rejected',
    ];
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      for (const phrase of forbidden) {
        assert.equal(source.includes(phrase), false, `${path.basename(file)} 仍包含：${phrase}`);
      }
    }
  });
});
