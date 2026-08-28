'use strict';

const { summarizeProviderResponse } = require('../providerErrorSanitizer');
const {
  fetchVideoWithTimeout,
  videoProviderFailure,
  pickProxyVideoUrl,
  normalizeAspectRatioForApi,
} = require('./helpers');
const { resolveVeo3ImageForApi } = require('./mediaRefs');

function resolveXaiVideoResolution(resolution) {
  const s = String(resolution || '').toLowerCase();
  if (s.includes('480')) return '480p';
  if (s.includes('720')) return '720p';
  return '720p';
}

/** grok-video-3 等官方示例：size 为 "720P" / "480P"（大写 P） */
function formatGrokVideo3Size(resolution) {
  const s = resolveXaiVideoResolution(resolution);
  if (String(s).includes('480')) return '480P';
  return '720P';
}

function clampXaiDuration(d) {
  const n = Math.round(Number(d));
  if (!Number.isFinite(n) || n < 1) return 8;
  return Math.min(15, Math.max(1, n));
}

/** 模型名同时含 grok 与 video（不必相邻，如 grok-video-3、grok_imagine_1.0_video_apimart）→ images[] + size */
function isXaiGrokVideoStyleModel(modelName) {
  const m = String(modelName || '').toLowerCase();
  return /grok/.test(m) && /video/.test(m);
}

/** 主图 + reference_urls 去重合并为公网 URL 字符串数组 */
function mergeXaiVideoImageUrls(imageUrlForApi, resolvedRefStrings, max = 10) {
  const images = [];
  if (imageUrlForApi) images.push(imageUrlForApi);
  for (const s of resolvedRefStrings) {
    if (s && !images.includes(s)) images.push(s);
  }
  return images.slice(0, max);
}

/**
 * xAI 视频（官方两套）：
 * - grok + video 模型：images: string[]、size（720P）、aspect_ratio、duration（中转 grok-video-3 等同此）。
 * - 其余 grok-imagine：image.url、resolution、duration、reference_images（主图与额外参考图可同时存在）。
 */
async function callXaiVideoApi(config, log, opts) {
  const {
    prompt,
    model,
    duration,
    aspect_ratio,
    resolution,
    image_url,
    reference_urls,
    files_base_url,
    storage_local_path,
    video_gen_id,
  } = opts;

  const base = (config.base_url || 'https://api.x.ai').replace(/\/$/, '');
  let ep = config.endpoint || '/v1/videos/generations';
  if (!ep.startsWith('/')) ep = '/' + ep;
  const url = base + ep;

  const ratio = normalizeAspectRatioForApi(aspect_ratio) || '16:9';
  const dur = clampXaiDuration(duration != null ? duration : 8);
  const reso = resolveXaiVideoResolution(resolution);
  const modelName = model || 'grok-imagine-video';
  const useGrokVideoImages = isXaiGrokVideoStyleModel(modelName);

  let imageUrlForApi = '';
  const rawMain = (image_url || '').trim();
  if (rawMain) {
    const resolved = await resolveVeo3ImageForApi(rawMain, storage_local_path, log, String(video_gen_id || ''));
    if (resolved?.value) {
      imageUrlForApi = resolved.value;
      log.info('[xAI视频] 参考图已解析', {
        transport: resolved.kind,
        value_head: String(resolved.value).slice(0, 88),
        video_gen_id,
      });
    }
  }

  const resolvedRefStrings = [];
  if (Array.isArray(reference_urls) && reference_urls.length > 0) {
    for (let i = 0; i < reference_urls.length; i++) {
      const u = reference_urls[i] && String(reference_urls[i]).trim();
      if (!u) continue;
      const r = await resolveVeo3ImageForApi(u, storage_local_path, log, `${video_gen_id || 0}_r${i}`);
      if (r?.value) resolvedRefStrings.push(r.value);
    }
  }

  const mergedImages = mergeXaiVideoImageUrls(imageUrlForApi, resolvedRefStrings);

  let body;
  let logExtra = {};

  if (useGrokVideoImages) {
    body = {
      model: modelName,
      prompt: prompt || '',
      aspect_ratio: ratio,
      size: formatGrokVideo3Size(resolution),
      duration: dur,
    };
    if (mergedImages.length) body.images = mergedImages;
    logExtra = {
      body_shape: 'grok-video',
      images_count: body.images?.length || 0,
      size: body.size,
    };
  } else {
    body = {
      model: modelName,
      prompt: prompt || '',
      duration: dur,
      aspect_ratio: ratio,
      resolution: reso,
    };
    if (imageUrlForApi) {
      body.image = { url: imageUrlForApi };
      const extraRefs = mergedImages.filter((u) => u !== imageUrlForApi);
      if (extraRefs.length > 0) {
        body.reference_images = extraRefs.map((u) => ({ url: u }));
      }
    } else if (mergedImages.length > 0) {
      body.reference_images = mergedImages.map((u) => ({ url: u }));
    }
    logExtra = {
      body_shape: 'grok-imagine',
      has_image: !!body.image,
      ref_count: body.reference_images?.length || 0,
      total_unique_images: mergedImages.length,
    };
  }

  const first = mergedImages[0] || '';
  const mainTransport =
    first && String(first).startsWith('data:') ? 'data_url' : first ? 'http_url' : 'none';

  log.info('[xAI视频] 提交', {
    video_gen_id,
    url,
    model: body.model,
    aspect_ratio: ratio,
    duration: body.duration != null ? body.duration : dur,
    resolution: body.resolution != null ? body.resolution : undefined,
    image_transport: mainTransport,
    ...logExtra,
    images: body.images,
    image_url_head: body.image?.url ? String(body.image.url).slice(0, 100) : null,
    reference_images_heads: Array.isArray(body.reference_images)
      ? body.reference_images.map((r) => String(r?.url || '').slice(0, 100))
      : undefined,
  });

  const res = await fetchVideoWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + (config.api_key || ''),
    },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  log.info('[xAI视频] 响应', {
    video_gen_id,
    status: res.status,
    ...summarizeProviderResponse(raw),
  });

  if (!res.ok) {
    return videoProviderFailure('xAI', 'video request', res.status, raw);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return videoProviderFailure('xAI', 'video response', res.status, raw);
  }

  const direct = pickProxyVideoUrl(data);
  if (direct) {
    log.info('[xAI视频] 同步返回地址', { video_gen_id });
    return { video_url: direct };
  }

  const reqId = data.request_id || data.task_id || data.id;
  if (reqId) {
    log.info('[xAI视频] 异步任务', { video_gen_id, request_id: reqId });
    return { task_id: String(reqId), status: 'submitted' };
  }

  return videoProviderFailure('xAI', 'video response', res.status, data);
}

module.exports = {
  callXaiVideoApi,
};
