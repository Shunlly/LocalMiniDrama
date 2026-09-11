'use strict';

// 从 protocolDispatch 拆出的 OpenAI 兼容 / 火山经典视频请求装配。
// 保持原语义，不是新增真实接入。

const { summarizeProviderResponse } = require('../providerErrorSanitizer');
const {
  fetchVideoWithTimeout,
  videoProviderFailure,
  normalizeVolcModel,
  buildVideoUrl,
  pickProxyVideoUrl,
  logVideoPostRequest,
} = require('./helpers');
const { resolveVolcClassicImage } = require('./mediaRefs');
const { normalizeVolcengineDuration } = require('./volcengineVideoAdapter');

function assembleCompatibleVideoRequest({
  log,
  opts,
  config,
  protocol,
  model,
  prompt,
  duration,
  aspect_ratio,
  resolution,
  seed,
  camera_fixed,
  watermark,
  image_url,
  first_frame_url,
  last_frame_url,
  first_frame_local_path,
  last_frame_local_path,
  files_base_url,
  storage_local_path,
  video_gen_id,
}) {
  const url = buildVideoUrl(config);
  const dur = duration ? Number(duration) : 5;
  const ratio = aspect_ratio || '16:9';

  const isVolc = protocol === 'volcengine';
  const finalModel = isVolc ? normalizeVolcModel(model) : model;

  const rawFirst = (first_frame_url || first_frame_local_path || image_url || '').toString().trim();
  const rawLast = (last_frame_url || last_frame_local_path || '').toString().trim();

  const firstForApi = resolveVolcClassicImage(
    rawFirst,
    files_base_url || opts.files_base_url,
    storage_local_path || opts.storage_local_path,
    log,
    video_gen_id,
    'first_frame'
  );
  let lastForApi = null;
  if (rawLast) {
    lastForApi = resolveVolcClassicImage(
      rawLast,
      files_base_url || opts.files_base_url,
      storage_local_path || opts.storage_local_path,
      log,
      video_gen_id,
      'last_frame'
    );
  }

  if (firstForApi && lastForApi && firstForApi === lastForApi) {
    lastForApi = null;
  }

  const hasAnyFrame = !!(firstForApi || lastForApi);
  const volcTaskType = isVolc ? (hasAnyFrame ? 'i2v' : 't2v') : null;

  let effectiveDuration = dur;
  if (isVolc) {
    const rounded = Math.round(dur);
    effectiveDuration = normalizeVolcengineDuration(finalModel, rounded);
    if (effectiveDuration !== rounded) {
      log.info('Adjusted duration for Volcengine', {
        original: dur,
        adjusted: effectiveDuration,
        model: finalModel,
        video_gen_id,
      });
    }
  }

  const body = {
    model: finalModel,
    content: [{ type: 'text', text: prompt || '' }],
    ratio,
    aspect_ratio: ratio,
    duration: effectiveDuration,
    watermark: (watermark != null) ? Boolean(watermark) : false,
  };
  if (resolution) body.resolution = resolution;
  if (seed != null) body.seed = Number(seed);
  if (camera_fixed != null) body.camera_fixed = Boolean(camera_fixed);
  if (volcTaskType) body.task_type = volcTaskType;

  if (firstForApi) {
    const p = { type: 'image_url', image_url: { url: firstForApi } };
    p.role = 'first_frame';
    body.content.push(p);
  }
  if (lastForApi) {
    const p = { type: 'image_url', image_url: { url: lastForApi } };
    p.role = 'last_frame';
    body.content.push(p);
  }

  if (!hasAnyFrame && image_url && image_url.trim()) {
    const legacy = resolveVolcClassicImage(
      image_url,
      files_base_url || opts.files_base_url,
      storage_local_path || opts.storage_local_path,
      log,
      video_gen_id,
      'image_url_fallback'
    );
    if (legacy) {
      const p = { type: 'image_url', image_url: { url: legacy } };
      p.role = 'first_frame';
      body.content.push(p);
      if (!body.task_type) body.task_type = 'i2v';
    }
  }

  if (isVolc) {
    const m = (finalModel || '').toLowerCase();
    const resStr = resolution ? String(resolution).toLowerCase() : '';
    if (m.includes('seedance') && m.includes('1-5') && m.includes('pro') && resStr === '480p') {
      body.draft = true;
      log.info('启用 Seedance 1.5 Pro 草稿模式 (draft=true) 以降低成本并提升速度', { model: finalModel, resolution, video_gen_id });
    }
  }

  return { url, body, firstForApi, lastForApi };
}

async function dispatchCompatibleVideoRequest(ctx) {
  const { log, config, model, video_gen_id } = ctx;
  const assembled = assembleCompatibleVideoRequest(ctx);
  const { url, body, firstForApi, lastForApi } = assembled;
  logVideoPostRequest(log, 'Video', url, body, video_gen_id, {
    model,
    task_type: body.task_type,
    has_first_frame: !!firstForApi,
    has_last_frame: !!lastForApi,
    frame_count: (firstForApi ? 1 : 0) + (lastForApi ? 1 : 0),
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
  log.info('Video API response summary', {
    video_gen_id,
    status: res.status,
    ...summarizeProviderResponse(raw),
  });
  if (!res.ok) {
    log.error('Video API failed', { status: res.status, ...summarizeProviderResponse(raw) });
    return videoProviderFailure('Video provider', 'video request', res.status, raw);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    log.error('Video API response JSON parse failed', {
      video_gen_id,
      ...summarizeProviderResponse(raw),
    });
    return videoProviderFailure('Video provider', 'video response', res.status, raw);
  }
  log.info('Video API parsed response', { video_gen_id, ...summarizeProviderResponse(data) });
  const taskId = data.id || data.task_id || (data.data && data.data.id);
  const status = data.status || (data.data && data.data.status);
  const videoUrl = pickProxyVideoUrl(data);
  if (videoUrl) {
    log.info('Video API returned video_url directly', { video_gen_id, video_url: videoUrl });
    return { video_url: videoUrl };
  }
  if (taskId) {
    log.info('Video API returned task_id', { video_gen_id, task_id: taskId, status });
    return { task_id: taskId, status: status || 'processing' };
  }
  log.error('Video API: no task_id or video_url in response', {
    video_gen_id,
    ...summarizeProviderResponse(data),
  });
  return videoProviderFailure('Video provider', 'video response', res.status, data);
}

module.exports = {
  assembleCompatibleVideoRequest,
  dispatchCompatibleVideoRequest,
};
