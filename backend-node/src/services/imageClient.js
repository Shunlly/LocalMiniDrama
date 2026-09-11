// 与 Go pkg/image + ImageGenerationService 对齐：调用图片生成 API，更新 image_generations 与角色头像
const {
  sanitizeProviderException,
  sanitizeProviderResult,
} = require('./providerErrorSanitizer');
const {
  imageRequestContext,
  normalizeIdempotencyKey,
  operationCancelledError,
  throwIfAborted,
  isOperationCancelled,
} = require('./imageGateway/runtime');
const {
  fixAgnesImageSize,
  isAgnesImageConfig,
} = require('./imageGateway/sizeAdapters');
const {
  getStoryboardReferenceLimits,
  canAddStoryboardCharacterRef,
  canAddStoryboardObjectRef,
  refListHasCanonical,
} = require('./imageGateway/referenceUtils');
const {
  getProxyCache,
  getProxyCacheValidated,
  deleteProxyCache,
  isProxyUrlAlive,
  setProxyCache,
} = require('./imageGateway/proxyCache');
const {
  downloadImageToLocalAbortable,
  removeDownloadedImage,
} = require('./imageGateway/download');
const {
  resolveAssetUserNegativeForApi,
  getDefaultImageConfig,
  getModelFromConfig,
} = require('./imageGateway/config');
const { dispatchImageProtocol } = require('./imageGateway/protocolDispatch');
const { assembleImageApiCall } = require('./imageGateway/imageApiAssembly');
const { createAndGenerateImage: createAndGenerateImageWithApi } = require('./imageGateway/createAndGenerateImage');

function createAndGenerateImage(db, log, opts) {
  return createAndGenerateImageWithApi(db, log, opts, module.exports);
}

// 厂商适配、纯工具与 createAndGenerateImage 编排已拆到 imageGateway/，本文件负责 API 调用编排与稳定导出。

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
  getDefaultImageConfig,
  callImageApi,
  createAndGenerateImage,
  downloadImageToLocalAbortable,
  removeDownloadedImage,
  resolveAssetUserNegativeForApi,
  getStoryboardReferenceLimits,
  canAddStoryboardCharacterRef,
  canAddStoryboardObjectRef,
  refListHasCanonical,
  fixAgnesImageSize,
  isAgnesImageConfig,
  /** 图床 URL 缓存（image_proxy_cache），供 SD2 认证等复用 */
  getProxyCache,
  getProxyCacheValidated,
  deleteProxyCache,
  isProxyUrlAlive,
  setProxyCache,
};
