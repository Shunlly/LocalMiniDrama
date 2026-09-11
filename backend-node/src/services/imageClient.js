// 与 Go pkg/image + ImageGenerationService 对齐：调用图片生成 API，更新 image_generations 与角色头像
const aiConfigService = require('./aiConfigService');
const {
  createSafeProviderLogger,
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
  prepareImageReferences,
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
const { assembleImageProtocolRequest } = require('./imageGateway/requestAssembly');
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
  log = createSafeProviderLogger(log);
  const {
    prompt,
    model: preferredModel,
    size,
    quality,
    drama_id,
    preferred_provider,
    character_id,
    image_type,
    image_gen_id,
    imageServiceType,
    reference_image_urls,
    files_base_url,
    storage_local_path,
    system_prompt,
    user_negative_prompt,
  } = opts;
  const preferredProvider = preferred_provider ?? opts.preferredProvider;
  const config = getDefaultImageConfig(db, preferredModel, preferredProvider, imageServiceType);
  if (!config) {
    throw new Error('未配置图片模型，请在「AI 配置」中添加 image 类型且已启用的配置');
  }
  const model = getModelFromConfig(config, preferredModel);
  const provider = (config.provider || '').toLowerCase();
  const providerNetworkPolicy = aiConfigService.getProviderNetworkOptions(config, {
    lookup: opts.provider_dns_lookup,
    signal: opts.signal,
    fetchImpl: opts.fetch_impl || opts.fetchImpl,
  });
  const requestContext = imageRequestContext.getStore();
  if (requestContext) {
    requestContext.networkOptions = {
      ...(requestContext.networkOptions || {}),
      ...providerNetworkPolicy,
    };
  }
  const safeReferenceImageUrls = await prepareImageReferences(reference_image_urls, opts, config);
  const {
    protocol,
    effectivePrompt,
    mergedNegativePrompt,
    refLabelInjected,
  } = assembleImageProtocolRequest({
    config,
    model,
    prompt,
    systemPrompt: system_prompt,
    referenceUrls: safeReferenceImageUrls,
    userNegativePrompt: user_negative_prompt,
  });

  log.info('[图生] callImageApi 路由', {
    image_gen_id,
    protocol,
    api_protocol_raw: config.api_protocol || '(empty→auto)',
    provider,
    model,
    size,
    imageServiceType,
    ref_count: safeReferenceImageUrls.length,
    ref_label_injected: refLabelInjected,
    prompt_length: String(effectivePrompt).length,
  });

  return dispatchImageProtocol(db, config, log, {
    protocol,
    prompt,
    effectivePrompt,
    model,
    size,
    quality,
    image_gen_id,
    safeReferenceImageUrls,
    files_base_url,
    storage_local_path,
    mergedNegativePrompt,
    providerNetworkPolicy,
    opts,
  });
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
