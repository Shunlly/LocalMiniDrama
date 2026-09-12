'use strict';

// 从 imageClient 拆出的 API 调用装配：配置、网络策略、参考图与协议请求。
// 保持原语义，不是新增真实接入。

const aiConfigService = require('../aiConfigService');
const { createSafeProviderLogger } = require('../providerErrorSanitizer');
const { imageRequestContext } = require('./runtime');
const { prepareImageReferences } = require('./referenceUtils');
const { getDefaultImageConfig, getModelFromConfig } = require('./config');
const { assembleImageProtocolRequest } = require('./requestAssembly');

async function assembleImageApiCall(db, log, opts) {
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
    throw new Error('未配置图片模型，请在「AI 配置」中添加图片类型且已启用的配置');
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

  return {
    log,
    config,
    model,
    provider,
    protocol,
    effectivePrompt,
    mergedNegativePrompt,
    refLabelInjected,
    safeReferenceImageUrls,
    providerNetworkPolicy,
    routeLog: {
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
    },
    dispatchCtx: {
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
    },
  };
}

module.exports = {
  assembleImageApiCall,
};
