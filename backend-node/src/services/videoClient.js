'use strict';

// 视频生成客户端：协议路由、轮询与公开 API。厂商请求实现位于 videoGateway。
let sharp; try { sharp = require('sharp'); } catch (_) { sharp = null; }
const uploadService = require('./uploadService');
const aiConfigService = require('./aiConfigService');
const {
  sanitizeProviderException,
  sanitizeProviderResult,
  summarizeProviderResponse,
} = require('./providerErrorSanitizer');
const {
  createMinimaxVideo,
  pollMinimaxVideo,
} = require('./videoGateway/minimaxVideoAdapter');
const {
  createSoraVideo,
  pollSoraVideo,
} = require('./videoGateway/openAiSoraAdapter');
const {
  createSafeVideoLogger,
  videoRequestContext,
  normalizeIdempotencyKey,
  fetchVideoWithTimeout,
  videoProviderFailure,
  resolveVideoProtocol,
  getModelFromConfig,
  normalizeVolcModel,
  buildVideoUrl,
  buildQueryUrl,
  isPlausibleHttpVideoUrl,
  extractPollTaskStatus,
  isPollTaskFailed,
  extractPollFailureMessage,
  videoUrlFromRecord,
  pickProxyVideoUrl,
  parseDashScopeVideoUrl,
  logVideoPostRequest,
  formatVideoPostBodyForLog,
  normalizeAspectRatioForApi,
} = require('./videoGateway/helpers');
const {
  validateVideoMediaReferences,
  validateProviderDispatch,
  validateProviderRequestUrl,
  createProviderNetworkOptions,
  loadReferenceImageBuffer,
  resolveVolcClassicImage,
} = require('./videoGateway/mediaRefs');
const {
  callVolcengineOmniVideoApi,
  normalizeVolcengineDuration,
} = require('./videoGateway/volcengineVideoAdapter');
const {
  applyKlingOmniEnvOverrides,
  resolveKlingOmniBaseUrl,
  resolveKlingOmniQueryPathTemplate,
  resolveKlingOmniBearerToken,
  callKlingOmniVideoApi,
  parseKlingOmniPollVideoUrl,
  callKlingVideoApi,
} = require('./videoGateway/klingVideoAdapter');
const { callDashScopeVideoApi } = require('./videoGateway/dashscopeVideoAdapter');
const { callGeminiVideoApi } = require('./videoGateway/geminiVideoAdapter');
const { callViduVideoApi } = require('./videoGateway/viduVideoAdapter');
const { callVeo3VideoApi } = require('./videoGateway/veo3VideoAdapter');
const {
  buildAgnesVideoImagePayload,
  callAgnesVideoApi,
} = require('./videoGateway/agnesVideoAdapter');
const {
  callJimengAiApiVideo,
  resolveJimengApiImageBuffer,
} = require('./videoGateway/jimengVideoAdapter');
const { callXaiVideoApi } = require('./videoGateway/xaiVideoAdapter');
const { resolveVideoTimeoutMs } = require('./videoGateway/providerRuntime');

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
    throw videoInputError('Sora 当前不支持尾帧参考，请移除 last_frame_url');
  }
  if (unique.size > 1) {
    throw videoInputError('Sora 当前只支持一张参考图，请仅保留主图、首帧或参考图列表中的一项');
  }
  return unique.size === 1 ? unique.keys().next().value : null;
}

// ??????????????????listConfigs ?? is_default DESC, priority DESC ??
function getDefaultVideoConfig(db, preferredModel, preferredProvider) {
  const configs = aiConfigService.listConfigs(db, 'video');
  const selectedModel = String(preferredModel ?? '').trim();
  let active = configs.filter((c) => c.is_active);
  if (active.length === 0) return null;
  if (preferredProvider && String(preferredProvider).trim()) {
    const wanted = String(preferredProvider).trim().toLowerCase();
    const matchingProvider = active.filter((config) => (
      String(config.provider || '').trim().toLowerCase() === wanted
    ));
    if (matchingProvider.length === 0) return null;
    active = matchingProvider;
  }
  if (selectedModel) {
    for (const c of active) {
      const models = aiConfigService.normalizeConfigModels(c).model;
      if (models.includes(selectedModel)) return c;
    }
  }
  const defaultOne = active.find((c) => c.is_default);
  return defaultOne != null ? defaultOne : active[0];
}

const VIDEO_PROTOCOLS_SUPPORT_SD2_ASSET_SCHEME = new Set([
  'volcengine_omni',
  'volcengine',
  'dashscope',
  'kling_omni',
  'kling',
]);

function parseJsonColumnForVideo(v) {
  if (v == null || v === '') return null;
  try {
    return typeof v === 'string' ? JSON.parse(v) : v;
  } catch (_) {
    return null;
  }
}

function normalizeMaterialHubAssetUrlForVideo(assetUrlOrId) {
  const s = String(assetUrlOrId || '').trim();
  if (!s) return null;
  if (s.startsWith('asset://')) return s;
  if (s.startsWith('asset-')) return `asset://${s}`;
  return `asset://${s.replace(/^\/+/, '')}`;
}

function normalizeStorageRelativePath(p) {
  let s = String(p || '').trim().replace(/^[/\\]+/, '').split('?')[0];
  s = s.replace(/\\/g, '/').replace(/\/+$/, '');
  return s;
}

function storageRelativeFromPublicUrl(urlStr) {
  const s = String(urlStr || '').trim();
  if (!/^https?:\/\//i.test(s)) return '';
  try {
    const u = new URL(s);
    let p = u.pathname || '';
    const marker = '/static/';
    const idx = p.toLowerCase().indexOf(marker);
    if (idx >= 0) p = p.slice(idx + marker.length);
    else p = p.replace(/^\/+/, '');
    return normalizeStorageRelativePath(decodeURIComponent(p));
  } catch (_) {
    return '';
  }
}

function buildSd2ActiveAssetUrlLookup(db, dramaId) {
  const urlToAsset = new Map();
  const relPathToAsset = new Map();
  if (!db || !dramaId) return { urlToAsset, relPathToAsset };
  let rows = [];
  try {
    rows = db.prepare(
      'SELECT image_url, local_path, seedance2_asset FROM characters WHERE drama_id = ? AND deleted_at IS NULL'
    ).all(Number(dramaId));
  } catch (_) {
    return { urlToAsset, relPathToAsset };
  }
  for (const row of rows) {
    const asset = parseJsonColumnForVideo(row.seedance2_asset);
    if (!asset || String(asset.status || '').toLowerCase() !== 'active') continue;
    const uri = normalizeMaterialHubAssetUrlForVideo(asset.hub_asset_id || asset.asset_url);
    if (!uri) continue;
    const certImg = String(asset.certified_image_url || '').trim();
    const certLp = normalizeStorageRelativePath(asset.certified_local_path || '');
    if (certImg) {
      urlToAsset.set(certImg, uri);
      urlToAsset.set(certImg.split('?')[0], uri);
    }
    if (certLp) relPathToAsset.set(certLp, uri);
    const img = String(row.image_url || '').trim();
    if (img) {
      urlToAsset.set(img, uri);
      urlToAsset.set(img.split('?')[0], uri);
    }
    const lp = normalizeStorageRelativePath(row.local_path || '');
    if (lp) relPathToAsset.set(lp, uri);
  }
  return { urlToAsset, relPathToAsset };
}

function rewriteOneImageUrlForSd2(original, lookup) {
  const s = String(original || '').trim();
  if (!s || s.startsWith('asset://') || s.startsWith('data:')) return { next: s, changed: false };
  const tries = [s, s.split('?')[0]];
  for (const t of tries) {
    if (lookup.urlToAsset.has(t)) return { next: lookup.urlToAsset.get(t), changed: true };
  }
  const rel = storageRelativeFromPublicUrl(s);
  if (rel && lookup.relPathToAsset.has(rel)) {
    return { next: lookup.relPathToAsset.get(rel), changed: true };
  }
  return { next: s, changed: false };
}

/**
 * 收集剧中所有 active 状态的 Seedance 2.0 角色音色参考
 * @returns {Map<number, string>} charId -> publicUrl
 */
function collectActiveCharacterVoiceRefs(db, dramaId) {
  const map = new Map();
  if (!db || !dramaId) return map;
  try {
    const rows = db.prepare(
      'SELECT id, seedance2_voice_asset FROM characters WHERE drama_id = ? AND deleted_at IS NULL'
    ).all(Number(dramaId));
    for (const row of rows) {
      const asset = parseJsonColumnForVideo(row.seedance2_voice_asset);
      if (!asset || String(asset.status || '').toLowerCase() !== 'active') continue;
      const url = String(asset.url || '').trim();
      if (url) map.set(Number(row.id), url);
    }
  } catch (_) {}
  return map;
}

function applySeedance2CertifiedAssetUrlsToVideoOpts(db, log, opts) {
  const out = { ...opts };
  const lookup = buildSd2ActiveAssetUrlLookup(db, opts.drama_id);
  if (lookup.urlToAsset.size === 0 && lookup.relPathToAsset.size === 0) return out;
  const changes = [];
  const patch = (field, val) => {
    const r = rewriteOneImageUrlForSd2(val, lookup);
    if (r.changed) changes.push(field);
    return r.next;
  };
  if (opts.image_url != null) out.image_url = patch('image_url', opts.image_url);
  if (opts.first_frame_url != null) out.first_frame_url = patch('first_frame_url', opts.first_frame_url);
  if (opts.last_frame_url != null) out.last_frame_url = patch('last_frame_url', opts.last_frame_url);
  if (Array.isArray(opts.reference_urls)) {
    out.reference_urls = opts.reference_urls.map((u, i) => patch(`reference_urls[${i}]`, u));
  }
  if (changes.length && log?.info) {
    log.info('[视频][SD2] 已将认证图片替换为 asset 引用', {
      video_gen_id: opts.video_gen_id,
      drama_id: opts.drama_id,
      changed_fields: changes,
    });
  }
  return out;
}

/**
 * ?????? API?ChatFire/?? ? ?????
 * @returns {Promise<{ task_id?: string, video_url?: string, error?: string }>}
 */
async function callVideoApiInternal(db, log, opts) {
  log = createSafeVideoLogger(log);
  opts = await validateVideoMediaReferences(opts);
  const {
    prompt,
    model: preferredModel,
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
    video_gen_id
  } = opts;
  const config = getDefaultVideoConfig(
    db,
    preferredModel,
    opts.preferred_provider || opts.preferredProvider || opts.provider
  );
  if (!config) {
    throw new Error('请先在 AI 配置中添加并启用视频服务');
  }
  const providerNetworkOptions = createProviderNetworkOptions(config, {
    fetch_impl: opts.fetch_impl,
    provider_dns_lookup: opts.provider_dns_lookup,
    signal: opts.signal,
  });
  const requestContext = videoRequestContext.getStore();
  if (requestContext) {
    requestContext.networkOptions = providerNetworkOptions;
  }
  await validateProviderDispatch(config, { provider_network_policy: providerNetworkOptions });
  const model = getModelFromConfig(config, preferredModel);
  const provider = (config.provider || '').toLowerCase();
  const protocol = resolveVideoProtocol(config, preferredModel);
  if (db && opts.drama_id && VIDEO_PROTOCOLS_SUPPORT_SD2_ASSET_SCHEME.has(protocol)) {
    opts = applySeedance2CertifiedAssetUrlsToVideoOpts(db, log, opts);
  }

  // Seedance 2.0 自动注入角色音色参考（仅当模型为 SD2 且未显式指定 voice_reference_url 时）
  const isSeedance2 = /seedance[-_]?2|seedance2|2[-_]0[-_]/.test(String(model || ''));
  if (isSeedance2 && db && opts.drama_id && !opts.voice_reference_url) {
    const voiceMap = collectActiveCharacterVoiceRefs(db, opts.drama_id);
    if (voiceMap.size > 0) {
      // 优先使用分镜显式指定的角色（如果有），否则取第一个
      let chosen = null;
      if (opts.storyboard_id) {
        try {
          const sbRow = db.prepare('SELECT characters FROM storyboards WHERE id = ?').get(opts.storyboard_id);
          if (sbRow && sbRow.characters) {
            const charList = typeof sbRow.characters === 'string' ? JSON.parse(sbRow.characters) : sbRow.characters;
            const ids = Array.isArray(charList) ? charList.map(c => Number(c?.id || c)).filter(Boolean) : [];
            for (const cid of ids) {
              if (voiceMap.has(cid)) { chosen = voiceMap.get(cid); break; }
            }
          }
        } catch (_) {}
      }
      if (!chosen) {
        // 取 Map 中的第一个
        chosen = voiceMap.values().next().value;
      }
      if (chosen) {
        const validatedVoice = await uploadService.validateMediaReference(chosen, {
          storagePath: opts.storage_local_path,
          lookup: opts.media_dns_lookup,
        });
        opts.voice_reference_url = validatedVoice.canonical;
        log.info('[视频][SD2][全能] 自动为 Seedance 2.0 注入角色音色参考（来自角色 seedance2_voice_asset）', {
          video_gen_id,
          storyboard_id: opts.storyboard_id,
          voice_ref_url: String(chosen).slice(0, 100)
        });
      } else {
        log.info('[视频][SD2][全能] 检测到活跃音色参考但未匹配到当前分镜角色', {
          video_gen_id,
          storyboard_id: opts.storyboard_id,
          available_voice_char_ids: Array.from(voiceMap.keys())
        });
      }
    } else {
      log.info('[视频][SD2][全能] Seedance 2.0 模型但本剧暂无 active 音色参考', { video_gen_id, drama_id: opts.drama_id });
    }
  }
  log.info('[视频] 路由协议', {
    video_gen_id,
    provider,
    api_protocol_raw: config.api_protocol || '(empty→auto)',
    protocol_used: protocol,
    model,
    endpoint: config.endpoint || '(auto)',
  });

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

async function callVideoApi(db, log, opts = {}) {
  const idempotencyKey = normalizeIdempotencyKey(opts.idempotency_key);
  return videoRequestContext.run({ idempotencyKey }, async () => {
    const provider = opts.preferred_provider || opts.preferredProvider || opts.provider || 'Video provider';
    try {
      const result = await callVideoApiInternal(db, log, opts);
      return sanitizeProviderResult(result, { provider, operation: '视频生成' });
    } catch (error) {
      if (error?.code === 'VIDEO_INPUT_INVALID') throw error;
      throw sanitizeProviderException(error, { provider, operation: '视频生成' });
    }
  });
}

/**
 * ??????????????????/ChatFire ? ???? DashScope?
 */
async function pollVideoTaskInternal(db, log, videoGenId, taskId, config, maxAttempts = 300, intervalMs = 10000, signal) {
  log = createSafeVideoLogger(log);
  const providerNetworkOptions = createProviderNetworkOptions(config, {
    fetch_impl: config.fetch_impl,
    provider_dns_lookup: config.provider_dns_lookup,
    signal,
  });
  await validateProviderDispatch(config, { provider_network_policy: providerNetworkOptions });
  const provider = (config.provider || '').toLowerCase();
  const protocol = resolveVideoProtocol(config);
  const isDashScope = protocol === 'dashscope';
  const isGemini = protocol === 'gemini';
  const isVidu = protocol === 'vidu';
  const isSora = protocol === 'sora';
  const isMinimax = protocol === 'minimax';
  const isAgnes = protocol === 'agnes';
  const isKling = protocol === 'kling';
  const isKlingOmni = protocol === 'kling_omni' || (typeof taskId === 'string' && taskId.startsWith('omni:'));
  const isVeo3 = protocol === 'veo3';
  const isVolcPoll =
    provider === 'volces' ||
    provider === 'volcengine' ||
    provider === 'volc' ||
    protocol === 'volcengine' ||
    protocol === 'volcengine_omni';
  if (protocol === 'jimeng_ai_api') {
    log.warn('[poll] Jimeng AI API 不应进入轮询', { video_gen_id: videoGenId, task_id: taskId });
    return { error: 'Jimeng AI API 为同步返回视频地址，不应进入轮询' };
  }
  const queryUrl = () => buildQueryUrl(config, taskId);
  log.info('[poll] ????', { video_gen_id: videoGenId, task_id: taskId, protocol, poll_url: queryUrl() });
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal?.aborted) throw signal.reason;
    await new Promise((resolve, reject) => {
      const finish = () => {
        signal?.removeEventListener('abort', abort);
        resolve();
      };
      const abort = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        reject(signal.reason);
      };
      const timer = setTimeout(finish, intervalMs);
      signal?.addEventListener('abort', abort, { once: true });
    });
    try {
      if (isSora || isMinimax) {
        const runtime = createAdapterRuntime(config, {
          signal,
          fetch_impl: config.fetch_impl,
          provider_dns_lookup: config.provider_dns_lookup,
          register_remote_cancel: config.register_remote_cancel,
          provider_network_policy: providerNetworkOptions,
        }, log);
        const result = isSora
          ? await pollSoraVideo(config, taskId, runtime)
          : await pollMinimaxVideo(config, taskId, runtime);
        if (result.status === 'pending') continue;
        return result;
      }
      let url, headers;
      if (isKling) {
        // task_id 编码格式：`t2v:xxx` / `i2v:xxx` / `mc:xxx`
        const klingBase = (config.base_url || 'https://api.klingai.com').replace(/\/$/, '');
        let actualTaskId = taskId;
        let videoType = 'text2video';
        if (taskId.startsWith('i2v:')) { actualTaskId = taskId.slice(4); videoType = 'image2video'; }
        else if (taskId.startsWith('t2v:')) { actualTaskId = taskId.slice(4); videoType = 'text2video'; }
        else if (taskId.startsWith('mc:'))  { actualTaskId = taskId.slice(3); videoType = 'motion-control'; }
        // 若用户配置了 query_endpoint，优先使用
        let qep = config.query_endpoint || `/v1/videos/${videoType}/{taskId}`;
        qep = String(qep).replace(/\{taskId\}/gi, encodeURIComponent(actualTaskId)).replace(/\{task_id\}/gi, encodeURIComponent(actualTaskId)).replace(/\{id\}/gi, encodeURIComponent(actualTaskId));
        if (!qep.startsWith('/')) qep = '/' + qep;
        url = klingBase + qep;
        headers = { Authorization: 'Bearer ' + (config.api_key || '') };
      } else if (isKlingOmni) {
        const cfgOmni = applyKlingOmniEnvOverrides(config);
        const omniBase = resolveKlingOmniBaseUrl(cfgOmni);
        let actualId = String(taskId);
        if (actualId.startsWith('omni:')) actualId = actualId.slice(5);
        let qep = resolveKlingOmniQueryPathTemplate(cfgOmni, omniBase);
        qep = String(qep)
          .replace(/\{taskId\}/gi, encodeURIComponent(actualId))
          .replace(/\{task_id\}/gi, encodeURIComponent(actualId))
          .replace(/\{id\}/gi, encodeURIComponent(actualId));
        if (!qep.startsWith('/')) qep = '/' + qep;
        url = omniBase + qep;
        const bt = resolveKlingOmniBearerToken(cfgOmni, log);
        headers = bt
          ? { Authorization: bt.startsWith('Bearer ') ? bt : `Bearer ${bt}` }
          : {};
      } else if (isGemini) {
        const base = (config.base_url || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
        url = `${base}/v1beta/${taskId}`;
        headers = { 'x-goog-api-key': config.api_key || '' };
      } else if (isVidu) {
        const viduBase = (config.base_url || 'https://api.vidu.cn').replace(/\/$/, '');
        const isOfficialVidu = /api\.vidu\.cn/i.test(viduBase);
        const defaultQep = isOfficialVidu ? '/ent/v2/tasks/{taskId}/creations' : '/ent/v2/tasks/{taskId}/creations';
        let qep = config.query_endpoint || defaultQep;
        qep = String(qep).replace(/\{taskId\}/gi, encodeURIComponent(taskId)).replace(/\{task_id\}/gi, encodeURIComponent(taskId)).replace(/\{id\}/gi, encodeURIComponent(taskId));
        if (!qep.startsWith('/')) qep = '/' + qep;
        url = viduBase + qep;
        headers = { Authorization: (isOfficialVidu ? 'Token ' : 'Bearer ') + (config.api_key || '') };
      } else {
        url = queryUrl();
        headers = { Authorization: 'Bearer ' + (config.api_key || '') };
      }
      const pollRound = attempt + 1;
      await validateProviderRequestUrl(url, config, {
        provider_network_policy: providerNetworkOptions,
      });
      log.info('[poll] 发起查询', { video_gen_id: videoGenId, round: pollRound, url });
      const res = await fetchVideoWithTimeout(
        url,
        { method: 'GET', headers },
        resolveVideoTimeoutMs('poll'),
        providerNetworkOptions
      );
      const raw = await res.text();
      log.info('[poll] 查询 HTTP 结果', {
        video_gen_id: videoGenId,
        round: pollRound,
        http_status: res.status,
        ...summarizeProviderResponse(raw),
      });
      if (!res.ok) {
        log.warn('[poll] 查询非 2xx', {
          video_gen_id: videoGenId,
          round: pollRound,
          http_status: res.status,
          ...summarizeProviderResponse(raw),
        });
        if (res.status >= 400 && res.status < 500) {
          return videoProviderFailure(provider || 'Video provider', 'video task', res.status, raw);
        }
        continue;
      }
      let data;
      try {
        data = JSON.parse(raw);
      } catch (parseErr) {
        log.warn('[poll] 响应非 JSON', {
          video_gen_id: videoGenId,
          round: pollRound,
          ...summarizeProviderResponse(raw),
        });
        continue;
      }

      if (isKling) {
        if (data.code !== undefined && data.code !== 0) {
          log.warn('[Kling poll] API 错误', { video_gen_id: videoGenId, code: data.code });
          return videoProviderFailure('Kling', 'video task', res.status, data, data.code);
        }
        const status = (data?.data?.task_status || '').toLowerCase();
        log.info('[Kling poll] 状态', { video_gen_id: videoGenId, attempt, status, task_id: taskId });
        if (status === 'succeed') {
          const videoUrl = data?.data?.task_result?.videos?.[0]?.url;
          if (videoUrl) {
            log.info('[Kling poll] 视频生成完成', { video_gen_id: videoGenId, video_url: videoUrl });
            return { video_url: videoUrl };
          }
          return { error: '可灵任务完成但未返回视频地址' };
        }
        if (status === 'failed') {
          log.warn('[Kling poll] 任务失败', {
            video_gen_id: videoGenId,
            ...summarizeProviderResponse(data),
          });
          return videoProviderFailure('Kling', 'video task', res.status, data, data.code);
        }
        // submitted / processing → 继续轮询
        continue;
      }

      if (isKlingOmni) {
        if (data.code !== undefined && Number(data.code) !== 0) {
          log.warn('[KlingOmni poll] API 错误', { video_gen_id: videoGenId, code: data.code });
          return videoProviderFailure('KlingOmni', 'video task', res.status, data, data.code);
        }
        const st = (data?.data?.task_status || data?.task_status || data?.status || '').toLowerCase();
        const videoUrlOmni = parseKlingOmniPollVideoUrl(data);
        log.info('[KlingOmni poll] 状态', { video_gen_id: videoGenId, attempt, status: st, has_url: !!videoUrlOmni });
        if (videoUrlOmni) {
          log.info('[KlingOmni poll] 完成', { video_gen_id: videoGenId });
          return { video_url: videoUrlOmni };
        }
        if (st === 'succeed' || st === 'success' || st === 'completed' || st === 'succeeded' || st === 'done') {
          return videoProviderFailure('KlingOmni', 'video task response', res.status, data);
        }
        if (st === 'failed' || st === 'error') {
          return videoProviderFailure('KlingOmni', 'video task', res.status, data, data.code);
        }
        continue;
      }

      if (isVeo3) {
        const status = extractPollTaskStatus(data);
        log.info('[Veo3 poll] task status', { video_gen_id: videoGenId, attempt, status, id: data.task_id || data.id });
        if (isPollTaskFailed(status)) {
          log.warn('[Veo3 poll] task failed', {
            video_gen_id: videoGenId,
            ...summarizeProviderResponse(data),
          });
          return videoProviderFailure('Veo3', 'video task', res.status, data, data?.error?.code);
        }
        const videoUrl = pickProxyVideoUrl(data);
        if (videoUrl) {
          log.info('[Veo3 poll] video completed', { video_gen_id: videoGenId, video_url: videoUrl });
          return { video_url: videoUrl };
        }
        if (status === 'succeeded' || status === 'completed' || status === 'done') {
          log.warn('[Veo3 poll] completed but no video_url', summarizeProviderResponse(data));
          return videoProviderFailure('Veo3', 'video task response', res.status, data);
        }
        continue;
      }

      if (isSora) {
        const status = extractPollTaskStatus(data);
        log.info('[Sora poll] ????', { video_gen_id: videoGenId, attempt, status, progress: data.progress, id: data.id });
        if (isPollTaskFailed(status)) {
          log.warn('[Sora poll] 任务失败', {
            video_gen_id: videoGenId,
            ...summarizeProviderResponse(data),
          });
          return videoProviderFailure('Sora', 'video task', res.status, data, data?.error?.code);
        }
        // succeeded / completed / done ? ??? URL
        const videoUrl = pickProxyVideoUrl(data);
        if (videoUrl && isPlausibleHttpVideoUrl(videoUrl)) {
          log.info('[Sora poll] ????', { video_gen_id: videoGenId, video_url: videoUrl });
          return { video_url: videoUrl };
        }
        if (status === 'succeeded' || status === 'completed' || status === 'done') {
          log.warn('[Sora poll] ????????? video_url', {
            video_gen_id: videoGenId,
            ...summarizeProviderResponse(data),
          });
          return videoProviderFailure('Sora', 'video task response', res.status, data);
        }
        // queued / processing / running ? ????
        continue;
      }

      if (isAgnes) {
        const status = extractPollTaskStatus(data);
        log.info('[Agnes poll] 状态', { video_gen_id: videoGenId, attempt, status, progress: data.progress, id: data.id });
        if (isPollTaskFailed(status)) {
          log.warn('[Agnes poll] 任务失败', {
            video_gen_id: videoGenId,
            ...summarizeProviderResponse(data),
          });
          return videoProviderFailure('Agnes', 'video task', res.status, data, data?.error?.code);
        }
        const videoUrl = pickProxyVideoUrl(data);
        if (videoUrl && isPlausibleHttpVideoUrl(videoUrl)) {
          log.info('[Agnes poll] 完成', { video_gen_id: videoGenId, video_url: videoUrl });
          return { video_url: videoUrl };
        }
        if (status === 'succeeded' || status === 'completed' || status === 'done') {
          log.warn('[Agnes poll] 标记完成但未返回 video_url', {
            video_gen_id: videoGenId,
            ...summarizeProviderResponse(data),
          });
          return videoProviderFailure('Agnes', 'video task response', res.status, data);
        }
        continue;
      }

      if (isVidu) {
        const state = (data?.state || data?.status || data?.data?.status || '').toLowerCase();
        log.info('[Vidu poll] ????', { video_gen_id: videoGenId, attempt, state, id: taskId });
        if (state === 'failed' || state === 'error') {
          log.warn('[Vidu poll] ????', { video_gen_id: videoGenId, ...summarizeProviderResponse(data) });
          return videoProviderFailure('Vidu', 'video task', res.status, data, data?.err_code);
        }
        // ?? ent/v2 ???????? success???? creations[0].url
        // ??????????????? succeeded/completed/done???? video_url/url ?
        const videoUrl =
          data?.creations?.[0]?.url ||
          videoUrlFromRecord(data?.creations?.[0]) ||
          pickProxyVideoUrl(data);
        if (videoUrl) {
          log.info('[Vidu poll] ????', { video_gen_id: videoGenId, video_url: videoUrl });
          return { video_url: videoUrl };
        }
        if (state === 'success' || state === 'succeeded' || state === 'completed' || state === 'done') {
          log.warn('[Vidu poll] ???????? video_url', summarizeProviderResponse(data));
          return { error: 'Vidu 任务完成但未返回视频地址' };
        }
        continue;
      }

      if (isGemini) {
        if (data.error) {
          return videoProviderFailure('Gemini', 'video task', res.status, data, data.error?.code);
        }
        if (data.done === true) {
          const videoUri = data.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
          if (videoUri) return { video_url: videoUri };
          return { error: 'Gemini 任务完成但未返回视频地址' };
        }
        continue;
      }

      if (isDashScope) {
        const taskStatus = data?.output?.task_status;
        const videoUrl = parseDashScopeVideoUrl(data);
        if (videoUrl) return { video_url: videoUrl };
        if (taskStatus === 'FAILED' || taskStatus === 'CANCELED') {
          log.warn('DashScope ????????? download image failed????? URL ???????? localhost?', {
            video_gen_id: videoGenId,
            task_id: taskId,
            task_status: taskStatus,
            ...summarizeProviderResponse(data),
          });
          return videoProviderFailure('DashScope', 'video task', res.status, data, data?.code);
        }
        continue;
      }
      const status = extractPollTaskStatus(data);
      const videoUrl = pickProxyVideoUrl(data);
      const failMsg = extractPollFailureMessage(data);
      const errMsg = data.error && (typeof data.error === 'string' ? data.error : data.error.message);
      if (isVolcPoll) {
        log.info('[poll] 方舟/火山 解析摘要', {
          video_gen_id: videoGenId,
          round: pollRound,
          top_level_status: status,
          has_video_url: !!videoUrl,
          ...summarizeProviderResponse(data),
        });
      }
      if (isPollTaskFailed(status) || errMsg) {
        log.warn('[poll] 任务失败', {
          video_gen_id: videoGenId,
          round: pollRound,
          status,
          ...summarizeProviderResponse(data),
        });
        return videoProviderFailure(provider || 'Video provider', 'video task', res.status, data, data?.error?.code);
      }
      if (videoUrl && isPlausibleHttpVideoUrl(videoUrl)) return { video_url: videoUrl };
      if (failMsg) {
        log.warn('[poll] 上游返回失败文案', {
          video_gen_id: videoGenId,
          round: pollRound,
          ...summarizeProviderResponse(data),
        });
        return videoProviderFailure(provider || 'Video provider', 'video task', res.status, data, data?.error?.code);
      }
    } catch (e) {
      if (signal?.aborted) throw signal.reason;
      log.warn('Video poll request failed', { attempt, error: e.message });
    }
  }
  return { error: '视频生成超时，请稍后重试' };
}

async function pollVideoTask(db, log, videoGenId, taskId, config, maxAttempts = 300, intervalMs = 10000, signal) {
  const provider = config?.provider || 'Video provider';
  try {
    const result = await pollVideoTaskInternal(
      db,
      log,
      videoGenId,
      taskId,
      config,
      maxAttempts,
      intervalMs,
      signal
    );
    return sanitizeProviderResult(result, { provider, operation: '视频任务' });
  } catch (error) {
    throw sanitizeProviderException(error, { provider, operation: '视频任务' });
  }
}

module.exports = {
  getDefaultVideoConfig,
  callVideoApi,
  pollVideoTask,
  normalizeAspectRatioForApi,
  isPlausibleHttpVideoUrl,
  pickProxyVideoUrl,
  buildAgnesVideoImagePayload,
  formatVideoPostBodyForLog,
  resolveVideoProtocol,
  fetchVideoWithTimeout,
  createSafeVideoLogger,
  loadReferenceImageBuffer,
  resolveJimengApiImageBuffer,
  validateProviderDispatch,
  validateProviderRequestUrl,
  validateVideoMediaReferences,
};
