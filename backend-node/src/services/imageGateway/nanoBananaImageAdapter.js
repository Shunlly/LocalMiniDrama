'use strict';

// 从 imageClient 拆出的 NanoBanana 图生请求拼装与轮询，保持原语义；不是新增真实接入。

const uploadService = require('../uploadService');
const { summarizeProviderResponse } = require('../providerErrorSanitizer');
const {
  IMAGE_HTTP_TIMEOUT_MS,
  IMAGE_POLL_RESPONSE_MAX_BYTES,
  abortableDelay,
  postJSONWithTimeout,
  imageProviderFailure,
  imageProviderException,
  rethrowIfRequestCanceled,
} = require('./runtime');
const { nanoBananaAspectRatio } = require('./sizeAdapters');
const { resolveImageRef } = require('./referenceUtils');

/**
 * 调用 NanoBanana 图片生成 API（异步任务轮询）
 * 模型 → 端点：
 *   nano-banana-2   → POST /api/v1/nanobanana/generate-2
 *   nano-banana-pro → POST /api/v1/nanobanana/generate-pro
 *   nano-banana     → POST /api/v1/nanobanana/generate（需 callBackUrl，用占位符）
 * 结果轮询：GET /api/v1/nanobanana/record-info?taskId=xxx
 */
async function callNanoBananaImageApi(config, log, opts) {
  const { prompt, model, size, image_gen_id, reference_image_urls, files_base_url, storage_local_path } = opts;
  const base = (config.base_url || 'https://api.nanobananaapi.ai').replace(/\/$/, '');
  const apiKey = config.api_key || '';
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + apiKey,
  };
  // 解析参考图：本地路径 / localhost URL → base64，确保外部 API 可访问
  const rawRefs = Array.isArray(reference_image_urls) ? reference_image_urls.filter(Boolean) : [];
  const refs = rawRefs.map((r) => resolveImageRef(r, files_base_url, storage_local_path)).filter(Boolean);
  const aspectRatio = nanoBananaAspectRatio(size);
  const m = (model || 'nano-banana-2').toLowerCase();

  // 标准 nano-banana 原生端点；若 config.endpoint 与这些不同，视为代理模式，直接使用配置的端点
  const NATIVE_ENDPOINTS = new Set([
    '/api/v1/nanobanana/generate-2',
    '/api/v1/nanobanana/generate-pro',
    '/api/v1/nanobanana/generate',
  ]);
  const cfgEp = config.endpoint ? (config.endpoint.startsWith('/') ? config.endpoint : '/' + config.endpoint) : '';
  const isProxyMode = cfgEp && !NATIVE_ENDPOINTS.has(cfgEp);

  let submitUrl;
  let body;
  if (isProxyMode) {
    submitUrl = base + cfgEp;
    const isNativeBananaModel = m.startsWith('nano-banana');
    if (isNativeBananaModel) {
      // FAL 代理等：转发 nano-banana 模型，使用 camelCase 字段
      body = {
        prompt: prompt || '',
        imageUrls: refs,
        aspectRatio: aspectRatio === 'auto' ? '16:9' : aspectRatio,
        resolution: '1K',
      };
    } else {
      // 通用代理（如 dmiapi）：模型名直接透传，使用 snake_case 字段
      body = {
        model: model || '',
        prompt: prompt || '',
        aspect_ratio: aspectRatio === 'auto' ? '16:9' : (aspectRatio || ''),
        image_size: '1K',
        ...(refs.length > 0 ? { imageUrls: refs } : {}),
      };
    }
  } else if (m === 'nano-banana-2') {
    submitUrl = base + '/api/v1/nanobanana/generate-2';
    body = {
      prompt: prompt || '',
      imageUrls: refs,
      aspectRatio,
      resolution: '1K',
      outputFormat: 'jpg',
    };
  } else if (m === 'nano-banana-pro') {
    submitUrl = base + '/api/v1/nanobanana/generate-pro';
    body = {
      prompt: prompt || '',
      imageUrls: refs,
      aspectRatio: aspectRatio === 'auto' ? '16:9' : aspectRatio,
      resolution: '2K',
    };
  } else {
    // nano-banana 基础模型：callBackUrl 为必填，提供占位 URL（服务端轮询结果）
    submitUrl = base + '/api/v1/nanobanana/generate';
    body = {
      prompt: prompt || '',
      type: refs.length > 0 ? 'IMAGETOIAMGE' : 'TEXTTOIAMGE',
      imageUrls: refs,
      image_size: (aspectRatio === 'auto' ? '16:9' : aspectRatio),
      numImages: 1,
      callBackUrl: 'https://placeholder.no-op/callback',
    };
  }

  log.info('NanoBanana Image API request', {
    url: submitUrl,
    model: m,
    image_gen_id,
    proxy_mode: isProxyMode,
    body_keys: Object.keys(body),
    prompt_length: String(prompt || '').length,
    reference_count: refs.length,
  });
  let submitRaw;
  let submitStatus;
  try {
    const out = await postJSONWithTimeout(submitUrl, headers, body, IMAGE_HTTP_TIMEOUT_MS);
    submitStatus = out.statusCode;
    submitRaw = out.raw;
  } catch (e) {
    const safeError = imageProviderException(e, 'NanoBanana', 'image request', opts.signal);
    log.error('NanoBanana submit network error', { image_gen_id, error: safeError });
    return { error: safeError };
  }
  if (submitStatus < 200 || submitStatus >= 300) {
    log.error('NanoBanana submit failed', {
      status: submitStatus,
      image_gen_id,
      submit_url: submitUrl,
      ...summarizeProviderResponse(submitRaw),
    });
    return imageProviderFailure('NanoBanana', 'image request', submitStatus, submitRaw);
  }
  let submitData;
  try {
    submitData = JSON.parse(submitRaw);
  } catch (e) {
    return { error: 'NanoBanana 返回格式异常' };
  }

  // 兼容同步代理响应：部分代理直接返回图片 URL，无需轮询
  // 也兼容提交即完成的响应（state=succeeded + data.data.images[0].url）
  const sdTopImages = submitData?.images;
  const sd0 = Array.isArray(sdTopImages) ? sdTopImages[0] : null;
  const sdTopFirst = typeof sd0 === 'string' && sd0 && !/^https?:\/\//i.test(sd0) && !sdTopImages[0]?.url
    ? (sd0.startsWith('data:') ? sd0 : `data:image/png;base64,${sd0.replace(/\s/g, '')}`)
    : null;
  const directImageUrl = submitData?.images?.[0]?.url
    || sdTopFirst
    || submitData?.image?.url
    || submitData?.image_url
    || submitData?.data?.url
    || submitData?.url
    || (submitData?.data?.state === 'succeeded' ? submitData?.data?.data?.images?.[0]?.url : null);
  if (directImageUrl) {
    log.info('NanoBanana image (synchronous proxy response)', { image_gen_id });
    return { image_url: directImageUrl };
  }

  // task_id 兼容驼峰（taskId）和下划线（task_id）两种格式
  const taskId = submitData?.data?.taskId || submitData?.data?.task_id || submitData?.request_id || submitData?.taskId;
  if (!taskId) {
    log.warn('NanoBanana no taskId in response', { image_gen_id, ...summarizeProviderResponse(submitData) });
    return imageProviderFailure('NanoBanana', 'image response', submitStatus, submitData);
  }

  // 构建轮询 URL：优先用配置的 query_endpoint，否则用默认
  // 支持占位符 {taskId} / {taskid} / {task_id} / {id}（大小写不敏感）
  const DEFAULT_QUERY_EP = '/api/v1/nanobanana/record-info';
  const cfgQEp = config.query_endpoint
    ? (config.query_endpoint.startsWith('/') ? config.query_endpoint : '/' + config.query_endpoint)
    : '';
  const useQueryEp = cfgQEp && cfgQEp !== DEFAULT_QUERY_EP ? cfgQEp : DEFAULT_QUERY_EP;
  function buildQueryUrl(tid) {
    // 大小写不敏感替换所有常见占位符：{taskId} / {taskid} / {task_id} / {id}
    if (/\{(taskId|taskid|task_id|id)\}/i.test(useQueryEp)) {
      return base + useQueryEp
        .replace(/\{taskId\}/gi, encodeURIComponent(tid))
        .replace(/\{task_id\}/gi, encodeURIComponent(tid))
        .replace(/\{id\}/gi, encodeURIComponent(tid));
    }
    return base + useQueryEp + '?taskId=' + encodeURIComponent(tid);
  }

  const firstQueryUrl = buildQueryUrl(taskId);
  log.info('NanoBanana task submitted, polling…', {
    image_gen_id, task_id: taskId,
    query_ep: useQueryEp,
    first_query_url: firstQueryUrl,
    config_query_endpoint: config.query_endpoint || '(not set)',
  });
  const maxAttempts = 60;
  const intervalMs = 3000;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await abortableDelay(intervalMs, opts.signal);
    const pollUrl = buildQueryUrl(taskId);
    try {
      const queryRes = await uploadService.downloadBufferViaNodeHttp(pollUrl, 30000, 0, {
        headers,
        accept: 'application/json',
        maxBytes: IMAGE_POLL_RESPONSE_MAX_BYTES,
        maxRedirects: 2,
        trustedOrigins: opts.provider_network_policy?.trustedOrigins,
        allowPrivateOrigins: opts.provider_network_policy?.allowPrivateOrigins,
        lookup: opts.provider_network_policy?.lookup,
        requireHttpsForPublic: opts.provider_network_policy?.requireHttpsForPublic,
        signal: opts.signal,
      });
      const queryRaw = queryRes.buffer.toString('utf8');
      let queryData;
      try {
        queryData = JSON.parse(queryRaw);
      } catch (parseErr) {
        log.warn('NanoBanana poll JSON parse error', {
          image_gen_id, task_id: taskId, attempt,
          poll_url: pollUrl,
          ...summarizeProviderResponse(queryRaw),
        });
        continue;
      }
      const successFlag = queryData?.data?.successFlag;
      const state = queryData?.data?.state;
      const status = queryData?.data?.status;
      log.info('NanoBanana poll status', {
        image_gen_id, task_id: taskId, attempt,
        code: queryData?.code, successFlag, state, status,
      });
      if (successFlag === 1 || state === 'succeeded' || status === '3') {
        const respImgs = queryData?.data?.response?.images;
        const fromSdWrapped = Array.isArray(respImgs) && typeof respImgs[0] === 'string' && respImgs[0].length > 0
          ? (respImgs[0].startsWith('data:') ? respImgs[0] : `data:image/png;base64,${respImgs[0].replace(/\s/g, '')}`)
          : null;
        const imageUrl = queryData?.data?.response?.resultImageUrl
          || queryData?.data?.response?.originImageUrl
          || queryData?.data?.data?.images?.[0]?.url
          || fromSdWrapped;
        if (imageUrl) {
          log.info('NanoBanana image completed', { image_gen_id, task_id: taskId, image_url: imageUrl.slice(0, 120) });
          return { image_url: imageUrl };
        }
        log.warn('NanoBanana succeeded but no image URL found', {
          image_gen_id, task_id: taskId,
          data_keys: queryData?.data ? Object.keys(queryData.data) : [],
          nested_data_keys: queryData?.data?.data ? Object.keys(queryData.data.data) : [],
          response_keys: queryData?.data?.response ? Object.keys(queryData.data.response) : [],
          ...summarizeProviderResponse(queryData),
        });
        return { error: '未返回图片地址' };
      }
      if (successFlag === 2 || successFlag === 3 || state === 'failed') {
        log.warn('NanoBanana task failed', {
          image_gen_id,
          task_id: taskId,
          successFlag,
          state,
          ...summarizeProviderResponse(queryData),
        });
        return imageProviderFailure('NanoBanana', 'image task', null, queryData, queryData?.code);
      }
    } catch (e) {
      const classified = rethrowIfRequestCanceled(e, opts.signal);
      log.warn('NanoBanana poll request failed', { attempt, error: classified.message, image_gen_id, poll_url: pollUrl });
    }
  }
  return { error: 'NanoBanana 图片生成超时' };
}

module.exports = {
  callNanoBananaImageApi,
};
