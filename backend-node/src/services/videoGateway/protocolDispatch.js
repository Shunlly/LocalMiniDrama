'use strict';

// 从 videoClient 拆出的专用协议创建分发，保持原语义；不是新增真实接入。

let sharp; try { sharp = require('sharp'); } catch (_) { sharp = null; }
const { summarizeProviderResponse } = require('../providerErrorSanitizer');
const {
  createMinimaxVideo,
} = require('./minimaxVideoAdapter');
const {
  createSoraVideo,
} = require('./openAiSoraAdapter');
const {
  videoRequestContext,
  normalizeIdempotencyKey,
  fetchVideoWithTimeout,
  videoProviderFailure,
  normalizeVolcModel,
  buildVideoUrl,
  pickProxyVideoUrl,
  logVideoPostRequest,
} = require('./helpers');
const {
  validateProviderRequestUrl,
  createProviderNetworkOptions,
  loadReferenceImageBuffer,
  resolveVolcClassicImage,
} = require('./mediaRefs');
const {
  callVolcengineOmniVideoApi,
  normalizeVolcengineDuration,
} = require('./volcengineVideoAdapter');
const {
  applyKlingOmniEnvOverrides,
  callKlingOmniVideoApi,
  callKlingVideoApi,
} = require('./klingVideoAdapter');
const { callDashScopeVideoApi } = require('./dashscopeVideoAdapter');
const { callGeminiVideoApi } = require('./geminiVideoAdapter');
const { callViduVideoApi } = require('./viduVideoAdapter');
const { callVeo3VideoApi } = require('./veo3VideoAdapter');
const { callAgnesVideoApi } = require('./agnesVideoAdapter');
const { callJimengAiApiVideo } = require('./jimengVideoAdapter');
const { callXaiVideoApi } = require('./xaiVideoAdapter');

function createAdapterRuntime(config, opts, log) {
  const requestContext = videoRequestContext.getStore();
  const networkOptions = opts.provider_network_policy
    || requestContext?.networkOptions
    || createProviderNetworkOptions(config, opts);
  return {
    signal: opts.signal,
    idempotency_key: normalizeIdempotencyKey(opts.idempotency_key),
    register_remote_cancel: opts.register_remote_cancel,
    logger: log,
    networkOptions,
  };
}

function videoInputError(message) {
  const error = new Error(message);
  error.name = 'VideoInputError';
  error.code = 'VIDEO_INPUT_INVALID';
  return error;
}

async function normalizeSoraInputReference(image, size, log, videoGenId) {
  if (!image || !Buffer.isBuffer(image.buffer)) return null;
  if (!sharp) throw videoInputError('Sora 参考图处理不可用：缺少 Sharp');
  try {
    const [targetWidth, targetHeight] = String(size).split('x').map(Number);
    if (!targetWidth || !targetHeight) return image;
    const metadata = await sharp(image.buffer).metadata();
    if (metadata.width === targetWidth && metadata.height === targetHeight) return image;
    const buffer = await sharp(image.buffer)
      .resize(targetWidth, targetHeight, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 92 })
      .toBuffer();
    log.info('[Sora] 参考图已匹配目标视频尺寸', {
      video_gen_id: videoGenId,
      from: `${metadata.width}x${metadata.height}`,
      to: size,
    });
    return { buffer, mimeType: 'image/jpeg', filename: 'reference.jpg' };
  } catch (error) {
    log.warn('[Sora] 参考图尺寸归一化失败', {
      video_gen_id: videoGenId,
      error: error.message,
    });
    throw videoInputError('Sora 参考图无法解码或归一化');
  }
}

function pickSoraReference(opts) {
  const entries = [
    ['image_url', opts.image_url],
    ['first_frame_url', opts.first_frame_url],
    ...(Array.isArray(opts.reference_urls)
      ? opts.reference_urls.map((value, index) => [`reference_urls[${index}]`, value])
      : []),
  ].filter(([, value]) => String(value || '').trim());
  const unique = new Map();
  for (const [field, value] of entries) {
    const normalized = String(value).trim();
    if (!unique.has(normalized)) unique.set(normalized, field);
  }
  if (String(opts.last_frame_url || '').trim()) {
    throw videoInputError('Sora 当前不支持尾帧参考，请移除尾帧');
  }
  if (unique.size > 1) {
    throw videoInputError('Sora 当前只支持一张参考图，请仅保留主图、首帧或参考图列表中的一项');
  }
  return unique.size === 1 ? unique.keys().next().value : null;
}

async function dispatchVideoProtocol({
  db,
  log,
  opts,
  config,
  protocol,
  model,
  preferredModel,
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
  providerNetworkOptions,
}) {
  if (protocol === 'jimeng_ai_api') {
    return callJimengAiApiVideo(config, log, {
      prompt,
      model: preferredModel,
      duration: opts.duration,
      aspect_ratio,
      resolution: opts.resolution,
      image_url: opts.image_url,
      first_frame_url: opts.first_frame_url,
      last_frame_url: opts.last_frame_url,
      reference_urls: opts.reference_urls,
      files_base_url: opts.files_base_url,
      storage_local_path: opts.storage_local_path,
      video_gen_id: opts.video_gen_id,
    });
  }

  if (protocol === 'xai') {
    return callXaiVideoApi(config, log, {
      prompt,
      model,
      duration: opts.duration,
      aspect_ratio,
      resolution: opts.resolution,
      image_url: opts.image_url,
      reference_urls: opts.reference_urls,
      files_base_url: opts.files_base_url,
      storage_local_path: opts.storage_local_path,
      video_gen_id: opts.video_gen_id,
    });
  }

  if (protocol === 'dashscope') {
    return callDashScopeVideoApi(config, log, {
      prompt,
      model,
      image_url: opts.image_url,
      first_frame_url: opts.first_frame_url,
      last_frame_url: opts.last_frame_url,
      reference_urls: opts.reference_urls,
      duration: opts.duration,
      files_base_url: opts.files_base_url,
      storage_local_path: opts.storage_local_path,
      video_gen_id: opts.video_gen_id,
    });
  }

  if (protocol === 'gemini') {
    return callGeminiVideoApi(config, log, {
      prompt, model,
      duration: opts.duration,
      aspect_ratio,
      image_url: opts.image_url,
      video_gen_id: opts.video_gen_id,
      files_base_url: opts.files_base_url,
      storage_local_path: opts.storage_local_path,
    });
  }

  if (protocol === 'vidu') {
    return callViduVideoApi(config, log, {
      prompt, model,
      duration: opts.duration,
      aspect_ratio,
      resolution: opts.resolution,
      image_url: opts.image_url,
      video_gen_id: opts.video_gen_id,
      files_base_url: opts.files_base_url,
      storage_local_path: opts.storage_local_path,
    });
  }

  if (protocol === 'kling') {
    return callKlingVideoApi(config, log, {
      prompt, model,
      duration: opts.duration,
      aspect_ratio,
      image_url: opts.image_url,
      files_base_url: opts.files_base_url,
      storage_local_path: opts.storage_local_path,
      video_gen_id: opts.video_gen_id,
    });
  }

  if (protocol === 'kling_omni') {
    const effectiveConfig = applyKlingOmniEnvOverrides(config);
    await validateProviderRequestUrl(effectiveConfig.base_url, config, {
      provider_network_policy: providerNetworkOptions,
    });
    return callKlingOmniVideoApi(effectiveConfig, log, {
      prompt,
      model,
      duration: opts.duration,
      aspect_ratio,
      image_url: opts.image_url,
      reference_urls: opts.reference_urls,
      files_base_url: opts.files_base_url,
      storage_local_path: opts.storage_local_path,
      video_gen_id: opts.video_gen_id,
      // 为将来可灵 Omni 也支持音色参考做准备（当前 Seedance 2.0 不走此分支）
      voice_reference_url: opts.voice_reference_url,
    });
  }

  if (protocol === 'volcengine_omni') {
    return callVolcengineOmniVideoApi(config, log, {
      prompt,
      model,
      duration: opts.duration,
      aspect_ratio,
      resolution: opts.resolution,
      seed: opts.seed,
      camera_fixed: opts.camera_fixed,
      watermark: opts.watermark,
      image_url: opts.image_url,
      reference_urls: opts.reference_urls,
      files_base_url: opts.files_base_url,
      storage_local_path: opts.storage_local_path,
      video_gen_id: opts.video_gen_id,
      // 关键：把 callVideoApi 里自动注入的 Seedance 2.0 音色参考音频透传下去
      voice_reference_url: opts.voice_reference_url,
    });
  }

  // Veo3 protocol (api_protocol = 'veo3')
  if (protocol === 'veo3') {
    return callVeo3VideoApi(config, log, {
      prompt, model,
      image_url: opts.image_url,
      storage_local_path: opts.storage_local_path,
      video_gen_id: opts.video_gen_id,
    });
  }

  // Sora protocol (api_protocol = 'sora')
  if (protocol === 'sora') {
    const sizeMap = {
      '9:16': '720x1280',
      '16:9': '1280x720',
    };
    const normalizedAspectRatio = aspect_ratio || '9:16';
    const soraSize = sizeMap[normalizedAspectRatio];
    if (!soraSize) {
      throw videoInputError(`Sora 当前不支持项目画幅 ${normalizedAspectRatio}，请选择 16:9 或 9:16`);
    }
    let inputReference = null;
    const reference = pickSoraReference(opts);
    if (reference) {
      const image = await loadReferenceImageBuffer(reference, opts.storage_local_path);
      if (!image) throw videoInputError('Sora 参考图不存在或无法读取');
      const extension = image.mimeType === 'image/png'
        ? 'png'
        : image.mimeType === 'image/webp' ? 'webp' : 'jpg';
      inputReference = await normalizeSoraInputReference({
        buffer: image.buffer,
        mimeType: image.mimeType,
        filename: `reference.${extension}`,
      }, soraSize, log, opts.video_gen_id);
    }
    const requestedDuration = opts.duration ? Number(opts.duration) : 4;
    const soraDuration = requestedDuration <= 4 ? 4 : requestedDuration <= 8 ? 8 : 12;
    return createSoraVideo(config, {
      prompt,
      model,
      duration: soraDuration,
      size: soraSize,
      input_reference: inputReference,
    }, createAdapterRuntime(config, opts, log));
  }

  if (protocol === 'minimax') {
    return createMinimaxVideo(config, {
      prompt,
      model,
      duration: opts.duration,
      resolution: opts.resolution,
      image_url: opts.image_url || opts.first_frame_url,
    }, createAdapterRuntime(config, opts, log));
  }

  // Agnes Video V2.0 (api_protocol = 'agnes')
  if (protocol === 'agnes') {
    return callAgnesVideoApi(db, config, log, {
      prompt,
      model,
      duration: opts.duration,
      aspect_ratio,
      image_url: opts.image_url,
      first_frame_url: opts.first_frame_url,
      last_frame_url: opts.last_frame_url,
      reference_urls: opts.reference_urls,
      files_base_url: opts.files_base_url,
      storage_local_path: opts.storage_local_path,
      video_gen_id: opts.video_gen_id,
    });
  }

  const url = buildVideoUrl(config);
  const dur = duration ? Number(duration) : 5;
  const ratio = aspect_ratio || '16:9';

  const isVolc = protocol === 'volcengine';
  // ???? model ???????????? API ?? ID?
  const finalModel = isVolc ? normalizeVolcModel(model) : model;

  // ========== 首尾帧支持（完善版） ==========
  // 优先使用显式传入的 first_frame_url / last_frame_url（首尾帧模式核心）
  // 其次回退到 image_url（经典单图模式保持兼容）
  const rawFirst = (first_frame_url || first_frame_local_path || image_url || '').toString().trim();
  const rawLast = (last_frame_url || last_frame_local_path || '').toString().trim();

  // 使用新 helper 解析（自动处理 localhost → base64、asset:// 直传、公网 URL）
  const firstForApi = resolveVolcClassicImage(rawFirst, files_base_url || opts.files_base_url, storage_local_path || opts.storage_local_path, log, video_gen_id, 'first_frame');
  let lastForApi = null;
  if (rawLast) {
    lastForApi = resolveVolcClassicImage(rawLast, files_base_url || opts.files_base_url, storage_local_path || opts.storage_local_path, log, video_gen_id, 'last_frame');
  }

  // 去重：如果 first 和 last 指向同一资源，只保留 first（极少见）
  if (firstForApi && lastForApi && firstForApi === lastForApi) {
    lastForApi = null;
  }

  const hasAnyFrame = !!(firstForApi || lastForApi);
  // 只要有首帧或尾帧就走 i2v；旧版单图行为完全保留
  const volcTaskType = isVolc ? (hasAnyFrame ? 'i2v' : 't2v') : null;

  // 火山 Seedance：按模型版本限制时长（1.5 Pro 支持 5–12 秒，非仅 5/10）
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

  // ratio?duration ????????????????/ChatFire ???????
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

  // 按官方要求：first_frame 必须在 last_frame 之前；role 严格区分
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

  // 向后兼容：没有任何 first/last 字段时，单张 image_url 仍按老逻辑作为 first_frame（i2v）
  if (!hasAnyFrame && image_url && image_url.trim()) {
    // 极少数兜底（正常流程不会走到这里，因为 rawFirst 已包含 image_url）
    const legacy = resolveVolcClassicImage(image_url, files_base_url || opts.files_base_url, storage_local_path || opts.storage_local_path, log, video_gen_id, 'image_url_fallback');
    if (legacy) {
      const p = { type: 'image_url', image_url: { url: legacy } };
      p.role = 'first_frame';
      body.content.push(p);
      if (!body.task_type) body.task_type = 'i2v';
    }
  }

  // Seedance 1.5 Pro（火山）480p 草稿模式：检测模型名含 seedance + 1-5 + pro 且分辨率为 480p 时自动添加 draft=true，降低成本并加速
  if (isVolc) {
    const m = (finalModel || '').toLowerCase();
    const resStr = resolution ? String(resolution).toLowerCase() : '';
    if (m.includes('seedance') && m.includes('1-5') && m.includes('pro') && resStr === '480p') {
      body.draft = true;
      log.info('启用 Seedance 1.5 Pro 草稿模式 (draft=true) 以降低成本并提升速度', { model: finalModel, resolution, video_gen_id });
    }
  }

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
  dispatchVideoProtocol,
  createAdapterRuntime,
};
