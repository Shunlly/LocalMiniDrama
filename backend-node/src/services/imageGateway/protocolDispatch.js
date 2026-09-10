'use strict';

// 从 imageClient 拆出的专用协议分发，保持原语义；不是新增真实接入。

const { generateComfyUiImage } = require('../comfyUiClient');
const { imageProviderCaughtError } = require('./runtime');
const { callKlingImageApi } = require('./klingImageAdapter');
const { callNanoBananaImageApi } = require('./nanoBananaImageAdapter');
const { callDashScopeImageApi } = require('./dashScopeImageAdapter');
const { callGeminiImageApi } = require('./geminiImageAdapter');
const { callOpenAiCompatibleImageApi } = require('./openAiCompatibleImageApi');

async function dispatchImageProtocol(db, config, log, ctx) {
  const {
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
  } = ctx;

  if (protocol === 'dashscope') {
    return callDashScopeImageApi(config, log, {
      prompt: effectivePrompt, model, size, image_gen_id,
      reference_image_urls: safeReferenceImageUrls,
      files_base_url: opts.files_base_url,
      storage_local_path: opts.storage_local_path,
      negative_prompt: mergedNegativePrompt,
      signal: opts.signal,
    });
  }

  if (protocol === 'nano_banana') {
    return callNanoBananaImageApi(config, log, {
      prompt: effectivePrompt, model, size, image_gen_id,
      reference_image_urls: safeReferenceImageUrls,
      files_base_url: opts.files_base_url,
      storage_local_path: opts.storage_local_path,
      provider_network_policy: providerNetworkPolicy,
      signal: opts.signal,
    });
  }

  if (protocol === 'kling') {
    return callKlingImageApi(config, log, {
      prompt: effectivePrompt, model, size, image_gen_id,
      reference_image_urls: safeReferenceImageUrls,
      files_base_url: opts.files_base_url,
      storage_local_path: opts.storage_local_path,
      provider_network_policy: providerNetworkPolicy,
      signal: opts.signal,
    });
  }

  if (protocol === 'gemini') {
    return callGeminiImageApi(db, config, log, {
      prompt, model, size, image_gen_id,          // Gemini 用原始 prompt，不注入文字标签
      reference_image_urls: safeReferenceImageUrls,
      files_base_url: opts.files_base_url,
      storage_local_path: opts.storage_local_path,
      system_prompt: opts.system_prompt,
      signal: opts.signal,
    });
  }

  if (protocol === 'comfyui') {
    try {
      return await generateComfyUiImage(config, log, {
        prompt: effectivePrompt,
        negative_prompt: mergedNegativePrompt,
        model,
        size,
        quality,
        image_gen_id,
        reference_image_urls: safeReferenceImageUrls,
        storage_local_path,
        signal: opts.signal,
        timeout_ms: opts.timeout_ms,
        poll_interval_ms: opts.poll_interval_ms,
        workflow_variables: opts.workflow_variables,
        idempotency_key: opts.idempotency_key,
        fetch_impl: opts.fetch_impl,
        provider_network_policy: providerNetworkPolicy,
      });
    } catch (error) {
      return imageProviderCaughtError(error, 'ComfyUI', 'image request', opts.signal);
    }
  }

  return callOpenAiCompatibleImageApi(config, log, {
    protocol,
    prompt: effectivePrompt,
    model,
    size,
    quality,
    image_gen_id,
    reference_image_urls: safeReferenceImageUrls,
    files_base_url,
    storage_local_path,
    negative_prompt: mergedNegativePrompt,
    signal: opts.signal,
  });
}

module.exports = {
  dispatchImageProtocol,
};
