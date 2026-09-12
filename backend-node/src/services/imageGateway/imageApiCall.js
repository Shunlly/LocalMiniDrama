'use strict';

// 从 imageClient 拆出的图生 API 调用编排。只搬家，不改取消/超时语义。
// 空厂商名保持「图片服务」，不得改成「视频服务」，也不得把 Image 原文交给用户。

const {
  sanitizeProviderException,
  sanitizeProviderResult,
} = require('../providerErrorSanitizer');
const {
  imageRequestContext,
  normalizeIdempotencyKey,
  operationCancelledError,
  throwIfAborted,
  isOperationCancelled,
} = require('./runtime');
const { dispatchImageProtocol } = require('./protocolDispatch');
const { assembleImageApiCall } = require('./imageApiAssembly');

/**
 * 调用提供商图片生成 API（OpenAI /images/generations 风格 或 通义万象 multimodal-generation）
 * @param {object} db - database
 * @param {object} log - logger
 * @param {object} opts - { prompt, model?, size?, quality?, drama_id, preferred_provider?, character_id?, image_type?, image_gen_id, user_negative_prompt? }
 * @returns {Promise<{ image_url?: string, error?: string }>}
 */
async function callImageApiInternal(db, log, opts) {
  const assembled = await assembleImageApiCall(db, log, opts);
  assembled.log.info('[图生] callImageApi 路由', assembled.routeLog);
  return dispatchImageProtocol(db, assembled.config, assembled.log, assembled.dispatchCtx);
}

async function callImageApi(db, log, opts = {}) {
  const imageGenId = opts.image_gen_id;
  const idempotencyKey = normalizeIdempotencyKey(
    opts.idempotency_key
    || (imageGenId != null && String(imageGenId).trim() !== ''
      ? `image-generation-${imageGenId}`
      : '')
  );
  return imageRequestContext.run({
    idempotencyKey,
    networkOptions: {
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...((opts.fetch_impl || opts.fetchImpl) ? { fetchImpl: opts.fetch_impl || opts.fetchImpl } : {}),
    },
  }, async () => {
    const provider = opts.preferred_provider || opts.preferredProvider || '图片服务';
    try {
      throwIfAborted(opts.signal);
      const result = await callImageApiInternal(db, log, opts);
      throwIfAborted(opts.signal);
      return sanitizeProviderResult(result, { provider, operation: '图片生成' });
    } catch (error) {
      if (isOperationCancelled(error, opts.signal)) {
        throw operationCancelledError(opts.signal?.reason || error);
      }
      throw sanitizeProviderException(error, { provider, operation: '图片生成' });
    }
  });
}

module.exports = {
  callImageApi,
};
