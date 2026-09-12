'use strict';

// 从 imageClient 拆出的 OpenAI 兼容图生请求拼装与解析，保持原语义；不是新增真实接入。

const { summarizeProviderResponse } = require('../providerErrorSanitizer');
const {
  IMAGE_HTTP_TIMEOUT_MS,
  postJSONWithTimeout,
  imageProviderFailure,
  imageProviderCaughtError,
} = require('./runtime');
const {
  fixSeedreamSize,
  fixAgnesImageSize,
  isAgnesImageConfig,
} = require('./sizeAdapters');
const { resolveImageRef } = require('./referenceUtils');
const { buildImageUrl } = require('./config');

function parseOpenAiCompatibleImageUrl(data) {
  const item = data.data && data.data[0];
  let imageUrl = item && (item.url || item.image_url);
  if (!imageUrl && item?.b64_json) {
    imageUrl = `data:image/png;base64,${String(item.b64_json).replace(/\s/g, '')}`;
  }
  if (!imageUrl && Array.isArray(data.images) && data.images.length > 0) {
    const first = data.images[0];
    if (typeof first === 'string' && first.length > 0) {
      imageUrl = first.startsWith('data:') ? first : `data:image/png;base64,${first.replace(/\s/g, '')}`;
    }
  }
  return imageUrl || null;
}

async function callOpenAiCompatibleImageApi(config, log, opts) {
  const {
    protocol,
    prompt,
    model,
    size,
    quality,
    image_gen_id,
    reference_image_urls,
    files_base_url,
    storage_local_path,
    negative_prompt,
    signal,
  } = opts;
  const url = buildImageUrl(config);
  const isVolc = protocol === 'volcengine';
  const isAgnes = isAgnesImageConfig(config, model);
  // doubao-seedream 系列模型（含通过自定义代理使用的场景）：使用 volcengine 图片 API 规范
  const isSeedream = isVolc || /seedream|doubao/i.test(model);
  // 解析参考图：本地路径/localhost URL → base64，公网 URL → 直接传
  const rawRefs = reference_image_urls;
  const resolvedRefs = rawRefs.map((r) => resolveImageRef(r, files_base_url, storage_local_path)).filter(Boolean);
  if (resolvedRefs.length > 0) {
    log.info('Image API request with reference images', {
      url: url.slice(0, 60), model, image_gen_id,
      ref_count: resolvedRefs.length,
      ref_types: resolvedRefs.map((r) => (r.startsWith('data:') ? 'base64' : 'url')),
    });
  }

  // doubao-seedream-4-5+ 要求最低 3686400 像素，不足时等比放大；Agnes 需映射到官方支持尺寸
  let effectiveSize = size;
  if (isSeedream && size) effectiveSize = fixSeedreamSize(size);
  else if (isAgnes && size) effectiveSize = fixAgnesImageSize(size);

  const body = {
    model,
    prompt,
    // doubao-seedream API 不使用 n，其他 OpenAI 兼容接口保留
    ...(!isSeedream ? { n: 1 } : {}),
    ...(effectiveSize ? { size: effectiveSize } : {}),
    ...(quality ? { quality } : {}),
    // volcengine 原生或 doubao-seedream 模型均需关闭水印（默认为 true）
    ...((isVolc || isSeedream) ? { watermark: false } : {}),
    // 多张参考图时加 negative_prompt，防止模型把参考图拼成左右分割的合图
    // Doubao/Seedream 原生支持；通用 OpenAI-compat 接口大多也会接受该字段（不支持的会忽略）
    ...(negative_prompt ? { negative_prompt } : {}),
    // 参考图字段：volcengine doubao-seedream API 规范使用 image（数组），见官方文档
    ...(resolvedRefs.length > 0 && !isAgnes ? { image: resolvedRefs } : {}),
    // Agnes Image 2.x：参考图放在 extra_body.image
    ...(isAgnes && resolvedRefs.length > 0 ? { extra_body: { image: resolvedRefs, response_format: 'url' } } : {}),
  };
  log.info('Image API request', {
    url: url.slice(0, 60),
    model,
    image_gen_id,
    has_ref_images: resolvedRefs.length > 0,
    size: effectiveSize,
    original_size: size !== effectiveSize ? size : undefined,
    is_agnes: isAgnes,
  });
  const openaiCompatHeaders = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + (config.api_key || ''),
  };
  let raw;
  let httpStatus;
  try {
    const out = await postJSONWithTimeout(url, openaiCompatHeaders, body, IMAGE_HTTP_TIMEOUT_MS, {
      signal,
    });
    httpStatus = out.statusCode;
    raw = out.raw;
  } catch (e) {
    log.error('Image API network error', { image_gen_id, error: e, url });
    return imageProviderCaughtError(e, '图片服务', 'image request', signal);
  }
  if (httpStatus < 200 || httpStatus >= 300) {
    log.error('Image API failed', { status: httpStatus, ...summarizeProviderResponse(raw) });
    return imageProviderFailure('图片服务', 'image request', httpStatus, raw);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    log.warn('Image API response parse error', { image_gen_id, ...summarizeProviderResponse(raw) });
    return { error: '图片生成返回格式异常' };
  }
  // 兼容多种返回格式：OpenAI 风格 data[].url / b64_json，部分厂商 data[].image_url 或 data.output 等
  // Stable Diffusion WebUI（/sdapi/v1/txt2img|img2img）：顶层 images 为 PNG base64 字符串数组，无 data 数组
  const imageUrl = parseOpenAiCompatibleImageUrl(data);
  if (!imageUrl) {
    log.warn('Image API no image URL in response', {
      image_gen_id,
      model,
      response_keys: data ? Object.keys(data) : [],
      has_data_array: !!(data.data && Array.isArray(data.data)),
      first_item_keys: (data.data && data.data[0]) ? Object.keys(data.data[0]) : [],
      ...summarizeProviderResponse(data),
    });
    return { error: '未返回图片地址' };
  }
  return { image_url: imageUrl };
}

module.exports = {
  parseOpenAiCompatibleImageUrl,
  callOpenAiCompatibleImageApi,
};
