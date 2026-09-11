'use strict';

// 视频生成客户端：协议路由、轮询与公开 API。厂商请求实现位于 videoGateway。
const {
  sanitizeProviderException,
  sanitizeProviderResult,
} = require('./providerErrorSanitizer');
const {
  createSafeVideoLogger,
  videoProviderLabel,
  videoRequestContext,
  normalizeIdempotencyKey,
  fetchVideoWithTimeout,
  resolveVideoProtocol,
  getModelFromConfig,
  isPlausibleHttpVideoUrl,
  pickProxyVideoUrl,
  formatVideoPostBodyForLog,
  normalizeAspectRatioForApi,
} = require('./videoGateway/helpers');
const {
  validateVideoMediaReferences,
  validateProviderDispatch,
  validateProviderRequestUrl,
  loadReferenceImageBuffer,
} = require('./videoGateway/mediaRefs');
const {
  buildAgnesVideoImagePayload,
} = require('./videoGateway/agnesVideoAdapter');
const {
  resolveJimengApiImageBuffer,
} = require('./videoGateway/jimengVideoAdapter');
const { getDefaultVideoConfig } = require('./videoGateway/config');
const { assembleVideoApiCall, toVideoProtocolDispatchArgs } = require('./videoGateway/videoApiAssembly');
const {
  dispatchVideoProtocol,
} = require('./videoGateway/protocolDispatch');
const { pollVideoTask } = require('./videoClientPoll');
const {
  isRequestCanceled,
  operationCancelledError,
  throwIfAborted,
} = require('./videoGateway/requestError');

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
  getDefaultVideoConfig,
  callVideoApi,
  pollVideoTask,
  normalizeAspectRatioForApi,
  isPlausibleHttpVideoUrl,
  pickProxyVideoUrl,
  buildAgnesVideoImagePayload,
  formatVideoPostBodyForLog,
  resolveVideoProtocol,
  fetchVideoWithTimeout,
  createSafeVideoLogger,
  loadReferenceImageBuffer,
  resolveJimengApiImageBuffer,
  validateProviderDispatch,
  validateProviderRequestUrl,
  validateVideoMediaReferences,
};
