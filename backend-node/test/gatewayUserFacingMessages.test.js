'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildProviderErrorMessage,
  createProviderHttpError,
  isTrustedChineseUserError,
  sanitizeProviderException,
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

  it('缺省视频厂商名使用中文，不把 Video provider 原文交给用户', () => {
    const timeout = requestTimeoutError(null, { provider: 'Video provider', operation: 'video request' });
    assert.match(timeout.message, /超时/);
    assert.match(timeout.message, /视频/);
    assert.doesNotMatch(timeout.message, /Video provider|video request|timed out/i);
    const canceled = normalizeProviderRequestError(
      Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }),
      { provider: 'Video provider', operation: 'video request' }
    );
    assert.match(canceled.message, /取消/);
    assert.doesNotMatch(canceled.message, /Video provider|aborted/i);

    const videoAliasTimeout = requestTimeoutError(null, { provider: 'Video', operation: 'video request' });
    assert.match(videoAliasTimeout.message, /视频服务/);
    assert.match(videoAliasTimeout.message, /超时/);
    assert.doesNotMatch(videoAliasTimeout.message, /\bVideo\b|video request|timed out/i);

    const emptyVideo = requestTimeoutError(null, { provider: '', operation: 'video request' });
    assert.match(emptyVideo.message, /视频服务/);
    assert.match(emptyVideo.message, /超时/);
    assert.doesNotMatch(emptyVideo.message, /图片服务|\bVideo\b|\bImage\b|timed out/i);
  });

  it('缺省图片厂商名使用图片服务，不会变成视频服务', () => {
    const emptyImage = requestTimeoutError(null, { provider: '', operation: 'image request' });
    assert.match(emptyImage.message, /图片服务/);
    assert.match(emptyImage.message, /超时/);
    assert.doesNotMatch(emptyImage.message, /视频服务|Image provider|timed out/i);

    const built = buildProviderErrorMessage({
      provider: 'Image',
      operation: 'image request',
      status: 401,
    });
    assert.match(built, /图片服务/);
    assert.match(built, /认证失败/);
    assert.doesNotMatch(built, /\bImage\b|视频服务/);

    const sanitizerEmpty = toUserFacingGatewayError(new Error('timed out'), {
      provider: '',
      operation: 'image request',
    });
    assert.match(sanitizerEmpty, /图片服务/);
    assert.match(sanitizerEmpty, /超时/);
    assert.doesNotMatch(sanitizerEmpty, /视频服务|\bImage\b/i);

    const imageAliasTimeout = requestTimeoutError(null, { provider: 'Image', operation: 'image request' });
    assert.match(imageAliasTimeout.message, /图片服务/);
    assert.match(imageAliasTimeout.message, /超时/);
    assert.doesNotMatch(imageAliasTimeout.message, /\bImage\b|视频服务|timed out/i);
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
      path.join(__dirname, '../src/services/imageGateway/imageApiCall.js'),
      path.join(__dirname, '../src/services/imageGateway/protocol.js'),
      path.join(__dirname, '../src/services/videoGateway/videoApiCall.js'),
      path.join(__dirname, '../src/services/videoGateway/pollTask.js'),
      path.join(__dirname, '../src/services/videoGateway/providerRuntime.js'),
      path.join(__dirname, '../src/services/providerErrorSanitizer.js'),
    ];
    const forbidden = [
      'HTTP ${status}',
      "HTTP ' + res.status",
      'Image generation HTTP timeout after',
      'The operation was aborted.',
      'authentication rejected',
      "provider: 'Video'",
    ];
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      for (const phrase of forbidden) {
        assert.equal(source.includes(phrase), false, `${path.basename(file)} 仍包含：${phrase}`);
      }
    }
  });
});

describe('取消不得被收成超时，axios/network 原文不得出用户文案', () => {
  it('sanitizeProviderException 把 AbortError 当作取消而不是超时', () => {
    const aborted = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
    const classified = sanitizeProviderException(aborted, { provider: 'Kling', operation: 'video request' });
    assert.equal(classified.code, 'OPERATION_CANCELLED');
    assert.equal(classified.retryable, false);
    assert.match(classified.message, /取消/);
    assert.doesNotMatch(classified.message, /timeout|aborted|超时/i);
    assert.match(toUserFacingGatewayError(aborted, { provider: 'Kling', operation: 'video request' }), /取消/);
  });

  it('带 isTimeout 的 AbortError 仍是超时且可重试', () => {
    const timeout = Object.assign(new Error('The operation was aborted.'), {
      name: 'AbortError',
      isTimeout: true,
      code: 'ETIMEDOUT',
    });
    const classified = sanitizeProviderException(timeout, { provider: 'Kling', operation: 'image request' });
    assert.match(classified.message, /超时/);
    assert.equal(classified.retryable, true);
    assert.doesNotMatch(classified.message, /aborted|timeout of/i);
  });

  it('axios 风格超时和网络错误映射为中文', () => {
    const axiosTimeout = Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED' });
    const timeoutMessage = toUserFacingGatewayError(axiosTimeout, { provider: 'OpenAI', operation: 'video request' });
    assert.match(timeoutMessage, /超时/);
    assert.doesNotMatch(timeoutMessage, /timeout of 15000ms|ECONNABORTED/i);

    const axiosNetwork = Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
    const networkMessage = toUserFacingGatewayError(axiosNetwork, { provider: 'OpenAI', operation: 'video request' });
    assert.match(networkMessage, /网络连接失败/);
    assert.doesNotMatch(networkMessage, /Network Error|ERR_NETWORK|fetch failed/i);

    const axiosHttp = Object.assign(new Error('Request failed with status code 401'), {
      response: { status: 401, data: { error: 'Unauthorized Bearer sk-provider-secret-123456' } },
    });
    const httpMessage = toUserFacingGatewayError(axiosHttp, { provider: 'OpenAI', operation: 'image request' });
    assert.match(httpMessage, /认证失败/);
    assert.doesNotMatch(httpMessage, /Request failed|Unauthorized|sk-provider-secret|HTTP\s+401/i);
  });

  it('中英混杂的 fetch failed 不会原样出用户文案', () => {
    const mixed = new Error('图片请求失败: fetch failed');
    mixed.code = 'ECONNREFUSED';
    const classified = normalizeProviderRequestError(mixed, { provider: 'Kling', operation: 'image request' });
    assert.match(classified.message, /网络连接失败/);
    assert.doesNotMatch(classified.message, /fetch failed|ECONNREFUSED/i);
  });

  it('中英混杂的 Image generation 不会原样出用户文案，也不改成视频服务', () => {
    const mixed = new Error('图片生成失败: Image generation did not complete');
    const message = toUserFacingGatewayError(mixed, { provider: 'Image', operation: 'image request' });
    assert.match(message, /[\u4e00-\u9fff]/);
    assert.doesNotMatch(message, /Image generation did not complete|\bImage\b/i);
    assert.doesNotMatch(message, /视频服务/);
    const processMessage = toUserFacingProcessError(mixed, '图片生成失败，请稍后重试');
    assert.equal(processMessage, '图片生成失败，请稍后重试');
  });

  it('中英混杂的 Network Error、Failed to fetch 和堆栈不得当作可信中文', () => {
    const leak = /Network Error|Failed to fetch|TypeError|ECONNREFUSED|fetch failed|sk-provider-secret|Bearer |at ClientRequest\.request/i;
    const samples = [
      '连接失败: Network Error',
      '图片请求失败: Failed to fetch',
      '请求失败: TypeError: Failed to fetch',
      '失败\n    at ClientRequest.request (node:http:1:1)',
      '认证失败 Bearer sk-provider-secret-123456',
    ];
    for (const text of samples) {
      assert.equal(isTrustedChineseUserError(text), false, text);
      const gateway = toUserFacingGatewayError(new Error(text), { provider: 'OpenAI', operation: 'video request' });
      assert.match(gateway, /[\u4e00-\u9fff]/);
      assert.doesNotMatch(gateway, leak);
      const process = toUserFacingProcessError(new Error(text), '处理失败，请稍后重试');
      assert.match(process, /[\u4e00-\u9fff]/);
      assert.doesNotMatch(process, leak);
    }
  });
});
