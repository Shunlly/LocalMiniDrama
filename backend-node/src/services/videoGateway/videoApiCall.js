'use strict';

// 从 videoClient 拆出的视频 API 调用编排。只搬家，不改取消/超时语义。
// 空厂商名与 Video 别名走视频服务，不得原文泄漏。

const {
  sanitizeProviderException,
  sanitizeProviderResult,
} = require('../providerErrorSanitizer');
const {
  videoProviderLabel,
  videoRequestContext,
  normalizeIdempotencyKey,
} = require('./helpers');
const { assembleVideoApiCall, toVideoProtocolDispatchArgs } = require('./videoApiAssembly');
const {
  dispatchVideoProtocol,
} = require('./protocolDispatch');
const {
  isRequestCanceled,
  operationCancelledError,
  throwIfAborted,
} = require('./requestError');

/**
 * 调用视频生成 API。
 * @returns {Promise<{ task_id?: string, video_url?: string, error?: string }>}
 */
async function callVideoApiInternal(db, log, opts) {
  const assembled = await assembleVideoApiCall(db, log, opts);
  assembled.log.info('[视频] 路由协议', assembled.routeLog);
  return dispatchVideoProtocol(toVideoProtocolDispatchArgs(assembled));
}

async function callVideoApi(db, log, opts = {}) {
  const idempotencyKey = normalizeIdempotencyKey(opts.idempotency_key);
  return videoRequestContext.run({
    idempotencyKey,
    networkOptions: {
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...((opts.fetch_impl || opts.fetchImpl) ? { fetchImpl: opts.fetch_impl || opts.fetchImpl } : {}),
    },
  }, async () => {
    const provider = videoProviderLabel(opts.preferred_provider || opts.preferredProvider || opts.provider);
    try {
      throwIfAborted(opts.signal);
      const result = await callVideoApiInternal(db, log, opts);
      throwIfAborted(opts.signal);
      return sanitizeProviderResult(result, { provider, operation: '视频生成' });
    } catch (error) {
      if (error?.code === 'VIDEO_INPUT_INVALID') throw error;
      if (isRequestCanceled(error, opts.signal)) {
        throw operationCancelledError(opts.signal?.reason || error);
      }
      throw sanitizeProviderException(error, { provider, operation: '视频生成' });
    }
  });
}

module.exports = {
  callVideoApi,
};
