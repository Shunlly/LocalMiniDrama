'use strict';

// 从 videoClient 拆出的专用协议创建分发，保持原语义；不是新增真实接入。

let sharp; try { sharp = require('sharp'); } catch (_) { sharp = null; }
const {
  createMinimaxVideo,
} = require('./minimaxVideoAdapter');
const {
  createSoraVideo,
} = require('./openAiSoraAdapter');
const {
  videoRequestContext,
  normalizeIdempotencyKey,
} = require('./helpers');
const {
  validateProviderRequestUrl,
  createProviderNetworkOptions,
  loadReferenceImageBuffer,
} = require('./mediaRefs');
const {
  callVolcengineOmniVideoApi,
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
const {
  dispatchCompatibleVideoRequest,
} = require('./requestAssembly');

function createAdapterRuntime(config, opts, log) {
  const requestContext = videoRequestContext.getStore();
  const networkOptions = opts.provider_network_policy
    || requestContext?.networkOptions
    || createProviderNetworkOptions(config, opts);
  return {
    signal: opts.signal || networkOptions.signal,
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
      provider_network_policy: providerNetworkOptions,
      signal: opts.signal,
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
      signal: opts.signal,
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
      signal: opts.signal,
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
      signal: opts.signal,
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
      signal: opts.signal,
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
      signal: opts.signal,
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
      signal: opts.signal,
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
      signal: opts.signal,
    });
  }

  // Veo3 protocol (api_protocol = 'veo3')
  if (protocol === 'veo3') {
    return callVeo3VideoApi(config, log, {
      prompt, model,
      image_url: opts.image_url,
      storage_local_path: opts.storage_local_path,
      video_gen_id: opts.video_gen_id,
      signal: opts.signal,
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
      signal: opts.signal,
    });
  }

  return dispatchCompatibleVideoRequest({
    db,
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
  });
}

module.exports = {
  dispatchVideoProtocol,
  createAdapterRuntime,
};
