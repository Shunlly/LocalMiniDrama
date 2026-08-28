'use strict';

// 从 imageClient 拆出的可灵图生请求拼装与轮询，保持原语义；不是新增真实接入。

const uploadService = require('../uploadService');
const { summarizeProviderResponse } = require('../providerErrorSanitizer');
const {
  IMAGE_HTTP_TIMEOUT_MS,
  IMAGE_POLL_RESPONSE_MAX_BYTES,
  abortableDelay,
  postJSONWithTimeout,
  imageProviderFailure,
  imageProviderException,
} = require('./runtime');
const { klingImageAspectRatio } = require('./sizeAdapters');
const { resolveImageRef } = require('./referenceUtils');

/**
 * 调用可灵（Kling AI）图片生成 API（异步任务轮询）
 * 支持模型：kling-image / kling-omni-image（以及其他 kling-* 模型）
 * 接口规范：POST /v1/images/generations → 轮询 GET /v1/images/generations/{taskId}
 * 认证：Authorization: Bearer {api_key}
 */
async function callKlingImageApi(config, log, opts) {
  const { prompt, model, size, image_gen_id, reference_image_urls, files_base_url, storage_local_path } = opts;
  const base = (config.base_url || 'https://api.klingai.com').replace(/\/$/, '');
  const apiKey = config.api_key || '';
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + apiKey,
  };

  let ep = config.endpoint || '/v1/images/generations';
  if (!ep.startsWith('/')) ep = '/' + ep;
  const submitUrl = base + ep;

  const aspectRatio = klingImageAspectRatio(size);
  const m = model || 'kling-image';

  const rawRefs = Array.isArray(reference_image_urls) ? reference_image_urls.filter(Boolean) : [];
  const resolvedRefs = rawRefs.map((r) => resolveImageRef(r, files_base_url, storage_local_path)).filter(Boolean);

  const body = {
    model: m,
    prompt: prompt || '',
    aspect_ratio: aspectRatio,
    n: 1,
    callback_url: '',
  };

  if (resolvedRefs.length > 0) {
    // 可灵 image_reference 支持 subject（人物/主体）和 face（面部）类型
    body.image_reference = resolvedRefs.slice(0, 1).map((url) => ({ type: 'subject', url }));
    body.image_fidelity = 0.5;
  }

  log.info('[Kling图生] 发送请求', {
    url: submitUrl, model: m, image_gen_id,
    has_ref: resolvedRefs.length > 0,
    aspect_ratio: aspectRatio,
    prompt_length: String(prompt || '').length,
    body_keys: Object.keys(body),
  });

  let submitRaw;
  let submitStatus;
  try {
    const out = await postJSONWithTimeout(submitUrl, headers, body, IMAGE_HTTP_TIMEOUT_MS);
    submitStatus = out.statusCode;
    submitRaw = out.raw;
  } catch (e) {
    const safeError = imageProviderException(e, 'Kling', 'image request');
    log.error('[Kling图生] 网络错误', { image_gen_id, error: safeError });
    return { error: safeError.message };
  }

  if (submitStatus < 200 || submitStatus >= 300) {
    log.error('[Kling图生] 请求失败', {
      status: submitStatus,
      image_gen_id,
      ...summarizeProviderResponse(submitRaw),
    });
    return imageProviderFailure('Kling', 'image request', submitStatus, submitRaw);
  }

  let submitData;
  try {
    submitData = JSON.parse(submitRaw);
  } catch (e) {
    log.warn('[Kling图生] 返回格式异常', { image_gen_id, ...summarizeProviderResponse(submitRaw) });
    return imageProviderFailure('Kling', 'image response', submitStatus, submitRaw);
  }

  if (submitData.code !== undefined && submitData.code !== 0) {
    return imageProviderFailure('Kling', 'image request', submitStatus, submitData, submitData.code);
  }

  // 部分场景可能同步返回图片（兜底）
  const directUrl = submitData?.data?.task_result?.images?.[0]?.url;
  if (directUrl) {
    log.info('[Kling图生] 同步返回图片', { image_gen_id });
    return { image_url: directUrl };
  }

  const taskId = submitData?.data?.task_id;
  if (!taskId) {
    log.warn('[Kling图生] 未返回 task_id', { image_gen_id, ...summarizeProviderResponse(submitData) });
    return imageProviderFailure('Kling', 'image response', submitStatus, submitData);
  }

  // 构建轮询 URL
  const cfgQEp = config.query_endpoint
    ? (config.query_endpoint.startsWith('/') ? config.query_endpoint : '/' + config.query_endpoint)
    : '';
  function buildKlingQueryUrl(tid) {
    if (cfgQEp) return base + cfgQEp.replace(/\{taskId\}/gi, encodeURIComponent(tid)).replace(/\{task_id\}/gi, encodeURIComponent(tid)).replace(/\{id\}/gi, encodeURIComponent(tid));
    return base + ep + '/' + encodeURIComponent(tid);
  }

  log.info('[Kling图生] 任务已提交，开始轮询', { image_gen_id, task_id: taskId });
  const maxAttempts = 60;
  const intervalMs = 4000;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await abortableDelay(intervalMs, opts.signal);
    try {
      const queryRes = await uploadService.downloadBufferViaNodeHttp(
        buildKlingQueryUrl(taskId),
        30000,
        0,
        {
          headers,
          accept: 'application/json',
          maxBytes: IMAGE_POLL_RESPONSE_MAX_BYTES,
          maxRedirects: 2,
          trustedOrigins: opts.provider_network_policy?.trustedOrigins,
          allowPrivateOrigins: opts.provider_network_policy?.allowPrivateOrigins,
          lookup: opts.provider_network_policy?.lookup,
          requireHttpsForPublic: opts.provider_network_policy?.requireHttpsForPublic,
          signal: opts.signal,
        }
      );
      const queryData = JSON.parse(queryRes.buffer.toString('utf8'));
      const status = queryData?.data?.task_status;
      log.info('[Kling图生] 轮询状态', { image_gen_id, task_id: taskId, attempt, status });
      if (status === 'succeed') {
        const imgUrl = queryData?.data?.task_result?.images?.[0]?.url;
        if (imgUrl) {
          log.info('[Kling图生] 生成完成', { image_gen_id, task_id: taskId });
          return { image_url: imgUrl };
        }
        return { error: '可灵未返回图片地址' };
      }
      if (status === 'failed') {
        log.warn('[Kling图生] 任务失败', {
          image_gen_id,
          task_id: taskId,
          ...summarizeProviderResponse(queryData),
        });
        return imageProviderFailure('Kling', 'image task', null, queryData, queryData?.code);
      }
    } catch (e) {
      log.warn('[Kling图生] 轮询请求失败', { attempt, error: e.message, image_gen_id });
    }
  }
  return { error: '可灵图片生成超时' };
}

module.exports = {
  callKlingImageApi,
};
