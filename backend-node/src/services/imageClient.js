// 与 Go pkg/image + ImageGenerationService 对齐：调用图片生成 API，更新 image_generations 与角色头像
const path = require('path');
const crypto = require('crypto');
const aiConfigService = require('./aiConfigService');
const uploadService = require('./uploadService');
const storageLayout = require('./storageLayout');
const taskService = require('./taskService');
const { loadConfig } = require('../config');
const { generateComfyUiImage } = require('./comfyUiClient');
const seedance2AssetGuards = require('../utils/seedance2AssetGuards');
const { scheduleLegacyAsync } = require('./legacyAsyncSchedulerService');
const {
  createSafeProviderLogger,
  sanitizeProviderException,
  sanitizeProviderResult,
  summarizeProviderResponse,
  toSafeProviderErrorMessage,
} = require('./providerErrorSanitizer');
const {
  IMAGE_HTTP_TIMEOUT_MS,
  imageRequestContext,
  normalizeIdempotencyKey,
  operationCancelledError,
  throwIfAborted,
  isOperationCancelled,
  abortableDelay,
  postJSONWithTimeout,
  imageProviderFailure,
  imageProviderException,
  ANTI_SPLIT_NEGATIVE_PROMPT,
  mergeNegativePromptFragments,
  inferProtocol,
} = require('./imageGateway/runtime');
const {
  fixSeedreamSize,
  fixAgnesImageSize,
  isAgnesImageConfig,
} = require('./imageGateway/sizeAdapters');
const {
  resolveImageRef,
  prepareImageReferences,
  getStoryboardReferenceLimits,
  canAddStoryboardCharacterRef,
  canAddStoryboardObjectRef,
  refListHasCanonical,
} = require('./imageGateway/referenceUtils');
const {
  getProxyCache,
  getProxyCacheValidated,
  deleteProxyCache,
  isProxyUrlAlive,
  setProxyCache,
} = require('./imageGateway/proxyCache');
const { callKlingImageApi } = require('./imageGateway/klingImageAdapter');
const { callNanoBananaImageApi } = require('./imageGateway/nanoBananaImageAdapter');
const { callDashScopeImageApi } = require('./imageGateway/dashScopeImageAdapter');
const { callGeminiImageApi } = require('./imageGateway/geminiImageAdapter');

// 厂商适配与纯工具已拆到 imageGateway/，本文件只负责编排、配置解析与稳定导出。

/** 角色/场景/道具资产生图：请求里显式传入 model 且资产上存有负面词时，与自动负面片段合并后传给图生 API */
function resolveAssetUserNegativeForApi(explicitModelName, storedNegative) {
  const hasModel = explicitModelName != null && String(explicitModelName).trim().length > 0;
  const neg = storedNegative != null ? String(storedNegative).trim() : '';
  return hasModel && neg ? neg : '';
}

/**
 * 获取默认图片配置：优先使用前端勾选的「默认」配置（is_default），同类型内按优先级（priority）排序；
 * 可选按 preferredProvider / preferredModel 进一步筛选。
 * @param {object} db
 * @param {string} [preferredModel] - 指定模型名时，在匹配到的配置中选含该模型的
 * @param {string} [preferredProvider] - 指定供应商（如 openai / dashscope），只在该 provider 的配置中选
 * @param {string} [imageServiceType] - 'image' 文本生成图片（角色/场景/道具），'storyboard_image' 分镜图片生成（支持参考图）；缺省为 'image'
 */
function getDefaultImageConfig(db, preferredModel, preferredProvider, imageServiceType) {
  const serviceType = imageServiceType || 'image';
  const selectedModel = String(preferredModel ?? '').trim();
  let configs = aiConfigService.listConfigs(db, serviceType);
  if (configs.length === 0 && serviceType === 'storyboard_image') {
    configs = aiConfigService.listConfigs(db, 'image');
  }
  let active = configs.filter((c) => c.is_active);
  if (active.length === 0) return null;
  if (preferredProvider && String(preferredProvider).trim()) {
    const want = String(preferredProvider).trim().toLowerCase();
    const byProvider = active.filter((c) => (c.provider || '').toLowerCase() === want);
    if (byProvider.length === 0) return null;
    active = byProvider;
  }
  if (selectedModel) {
    const matches = active.filter((c) => {
      const models = aiConfigService.normalizeConfigModels(c).model;
      return models.includes(selectedModel);
    });
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      const defaultMatch = matches.find((c) => c.is_default);
      if (defaultMatch) return defaultMatch;
      const providers = new Set(matches.map((c) => String(c.provider || '').toLowerCase()));
      if (providers.size === 1) return matches[0];
      return null;
    }
  }
  // 显式使用前端设置的「默认」：优先 is_default，再按 priority 降序（listConfigs 已按 is_default DESC, priority DESC 排序，取第一个即可）
  const defaultOne = active.find((c) => c.is_default);
  if (defaultOne) return defaultOne;
  return active[0];
}

// 与 Go image_generation_service 一致：openai/chatfire 使用 "/images/generations"，base_url 通常已含 /v1
function buildImageUrl(config) {
  const base = (config.base_url || '').replace(/\/$/, '');
  let ep = config.endpoint || '/images/generations';
  if (!ep.startsWith('/')) ep = '/' + ep;
  return base + ep;
}

function getModelFromConfig(config, preferredModel) {
  return aiConfigService.resolveConfiguredModel(config, preferredModel, 'dall-e-3');
}

async function downloadImageToLocalAbortable(
  storagePath, imageUrl, category, log, prefix = '', projectSubdir = null, signal
) {
  if (!imageUrl || typeof imageUrl !== 'string') return null;
  let localPath = null;
  try {
    throwIfAborted(signal);
    let buffer;
    if (imageUrl.startsWith('data:')) {
      const match = imageUrl.match(/^data:image\/([a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i);
      if (!match) throw new uploadService.UnsafeMediaReferenceError('图片 data URL 无效');
      buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
      if (buffer.length === 0 || buffer.length > uploadService.DEFAULT_REMOTE_MEDIA_MAX_BYTES) {
        throw new uploadService.UnsafeMediaReferenceError('图片数据超过大小限制');
      }
    } else {
      let lastError;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const result = await uploadService.downloadBufferViaNodeHttp(imageUrl, 30000, 0, {
            maxBytes: uploadService.DEFAULT_REMOTE_MEDIA_MAX_BYTES,
            accept: 'image/*',
            signal,
          });
          buffer = result.buffer;
          break;
        } catch (error) {
          if (isOperationCancelled(error, signal)) throw operationCancelledError(signal?.reason || error);
          lastError = error;
          log.warn('downloadImageToLocal: 下载失败，准备重试', {
            category, attempt, error: error.message, url: imageUrl.slice(0, 100),
          });
          if (attempt < 3) await abortableDelay(1500 * attempt, signal);
        }
      }
      if (!buffer) throw lastError || new Error('图片下载失败');
    }

    throwIfAborted(signal);
    const detected = await uploadService.validateAllowedUpload(buffer, 'image');
    throwIfAborted(signal);
    uploadService.assertUploadDiskCapacity(storagePath, buffer.length);
    const extension = detected.extension.replace(/^\./, '');
    const filename = `${prefix}${prefix ? '_' : ''}${crypto.randomUUID().slice(0, 8)}.${extension}`;
    const relativeParts = [projectSubdir, category, filename]
      .filter((part) => part != null && String(part).trim() !== '')
      .map((part) => String(part).replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''));
    localPath = relativeParts.join('/');
    uploadService.writeStorageBuffer(storagePath, localPath, buffer);
    throwIfAborted(signal);
    log.info('Image saved to local', { category, local_path: localPath, projectSubdir: projectSubdir || '(root)' });
    return localPath;
  } catch (error) {
    removeDownloadedImage(storagePath, localPath, log);
    if (isOperationCancelled(error, signal)) throw operationCancelledError(signal?.reason || error);
    log.warn('downloadImageToLocal error', { category, error: error.message });
    return null;
  }
}

function removeDownloadedImage(storagePath, localPath, log) {
  if (!localPath) return;
  try {
    const resolved = uploadService.resolveStorageReference(storagePath, localPath, { allowMissing: true });
    if (resolved?.absolutePath) uploadService.removeFile(resolved.absolutePath, log);
  } catch (error) {
    log?.warn?.('取消图片生成时清理临时文件失败', { local_path: localPath, error: error.message });
  }
}

/**
 * 调用提供商图片生成 API（OpenAI /images/generations 风格 或 通义万象 multimodal-generation）
 * @param {object} db - database
 * @param {object} log - logger
 * @param {object} opts - { prompt, model?, size?, quality?, drama_id, preferred_provider?, character_id?, image_type?, image_gen_id, user_negative_prompt? }
 * @returns {Promise<{ image_url?: string, error?: string }>}
 */
async function callImageApiInternal(db, log, opts) {
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
    throw new Error('未配置图片模型，请在「AI 配置」中添加 image 类型且已启用的配置');
  }
  const model = getModelFromConfig(config, preferredModel);
  const provider = (config.provider || '').toLowerCase();
  // api_protocol 显式指定接口规范，优先级高于 provider 推断；未设置时按 provider 自动判断
  const protocol = (config.api_protocol || '').toLowerCase() || inferProtocol(provider, model);
  const providerNetworkPolicy = aiConfigService.getProviderNetworkOptions(config, {
    lookup: opts.provider_dns_lookup,
    signal: opts.signal,
  });
  const requestContext = imageRequestContext.getStore();
  if (requestContext) {
    requestContext.networkOptions = providerNetworkPolicy;
  }
  const safeReferenceImageUrls = await prepareImageReferences(reference_image_urls, opts, config);

  // ── 参考图标签注入：为所有非 Gemini 模型将标签注入 prompt 文本 ─────────────────────────────
  // Gemini 通过 parts 结构处理（interleaved text+image），不需要文字注入。
  // 其他所有模型（Doubao/DashScope/NanoBanana/OpenAI-compat 等）通过文字告知模型各参考图用途，
  // 避免模型模仿参考图的宫格/四视图布局，同时抑制生成分割画面。
  let effectivePrompt = prompt || '';
  if (
    protocol !== 'gemini' &&
    safeReferenceImageUrls.length > 0 &&
    system_prompt
  ) {
    const refLines = String(system_prompt).split('\n').filter(l => /^Image\s+\d+:/i.test(l));
    if (refLines.length > 0) {
      const refHeader = refLines
        .map(l => `[${l} — FOR REFERENCE ONLY, DO NOT copy its layout or framing]`)
        .join('\n');
      effectivePrompt = `${refHeader}\n\n[GENERATE THIS SCENE — single continuous image, no grid, no split panels]:\n${effectivePrompt}`;
    }
  }

  log.info('[图生] callImageApi 路由', {
    image_gen_id,
    protocol,
    api_protocol_raw: config.api_protocol || '(empty→auto)',
    provider,
    model,
    size,
    imageServiceType,
    ref_count: safeReferenceImageUrls.length,
    ref_label_injected: effectivePrompt !== (prompt || ''),
    prompt_length: String(effectivePrompt).length,
  });

  // 多参考图时统一生成 negative_prompt（供各子函数使用）
  const refCountForNeg = safeReferenceImageUrls.length;
  // Seedream/Volcengine 模型强制启用安全词负面提示，其他模型仅在多参考图时启用
  const isVolcOrSeedream = (protocol === 'volcengine' || /seedream|doubao/i.test(model));
  const autoNegativePrompt = (refCountForNeg > 1 || isVolcOrSeedream) ? ANTI_SPLIT_NEGATIVE_PROMPT : '';
  const userNegFragment = (user_negative_prompt && String(user_negative_prompt).trim()) || '';
  const mergedNegativePrompt = mergeNegativePromptFragments(autoNegativePrompt, userNegFragment);

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
      const safeError = imageProviderException(error, 'ComfyUI', 'image request');
      return { error: safeError.message };
    }
  }

  const url = buildImageUrl(config);
  const isVolc = protocol === 'volcengine';
  const isAgnes = isAgnesImageConfig(config, model);
  // doubao-seedream 系列模型（含通过自定义代理使用的场景）：使用 volcengine 图片 API 规范
  const isSeedream = isVolc || /seedream|doubao/i.test(model);
  // 解析参考图：本地路径/localhost URL → base64，公网 URL → 直接传
  const rawRefs = safeReferenceImageUrls;
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
    prompt: effectivePrompt,
    // doubao-seedream API 不使用 n，其他 OpenAI 兼容接口保留
    ...(!isSeedream ? { n: 1 } : {}),
    ...(effectiveSize ? { size: effectiveSize } : {}),
    ...(quality ? { quality } : {}),
    // volcengine 原生或 doubao-seedream 模型均需关闭水印（默认为 true）
    ...((isVolc || isSeedream) ? { watermark: false } : {}),
    // 多张参考图时加 negative_prompt，防止模型把参考图拼成左右分割的合图
    // Doubao/Seedream 原生支持；通用 OpenAI-compat 接口大多也会接受该字段（不支持的会忽略）
    ...(mergedNegativePrompt ? { negative_prompt: mergedNegativePrompt } : {}),
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
    const out = await postJSONWithTimeout(url, openaiCompatHeaders, body, IMAGE_HTTP_TIMEOUT_MS);
    httpStatus = out.statusCode;
    raw = out.raw;
  } catch (e) {
    const safeError = imageProviderException(e, 'Image provider', 'image request');
    log.error('Image API network error', { image_gen_id, error: safeError, url });
    return { error: safeError.message };
  }
  if (httpStatus < 200 || httpStatus >= 300) {
    log.error('Image API failed', { status: httpStatus, ...summarizeProviderResponse(raw) });
    return imageProviderFailure('Image provider', 'image request', httpStatus, raw);
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

async function callImageApi(db, log, opts = {}) {
  const idempotencyKey = normalizeIdempotencyKey(opts.idempotency_key);
  return imageRequestContext.run({
    idempotencyKey,
    networkOptions: opts.signal ? { signal: opts.signal } : {},
  }, async () => {
    const provider = opts.preferred_provider || opts.preferredProvider || 'Image provider';
    try {
      throwIfAborted(opts.signal);
      const result = await callImageApiInternal(db, log, opts);
      throwIfAborted(opts.signal);
      return sanitizeProviderResult(result, { provider, operation: 'image generation' });
    } catch (error) {
      if (isOperationCancelled(error, opts.signal)) {
        throw operationCancelledError(opts.signal?.reason || error);
      }
      throw sanitizeProviderException(error, { provider, operation: 'image generation' });
    }
  });
}

/**
 * 创建 image_generation 记录并异步调用 API，完成后更新记录与角色 image_url。
 * 与场景图一致：创建 task 并写入 task_id，便于前端轮询 /tasks/:task_id 获知完成或报错。
 */
function createAndGenerateImage(db, log, opts) {
  log = createSafeProviderLogger(log);
  const {
    drama_id,
    character_id,
    scene_id,
    image_type,
    prompt,
    model,
    size,
    quality,
    provider,
    user_negative_prompt,
  } = opts;
  const negRow = (user_negative_prompt && String(user_negative_prompt).trim()) || null;
  const now = new Date().toISOString();
  const dramaIdNum = Number(drama_id) || 0;
  const charIdNum = character_id != null ? Number(character_id) : null;
  const sceneIdNum = scene_id != null ? Number(scene_id) : null;

  let resourceId;
  if (charIdNum != null) resourceId = `character_${charIdNum}`;
  else if (sceneIdNum != null) resourceId = `scene_${sceneIdNum}`;
  else resourceId = String(dramaIdNum);
  const task = taskService.createTask(db, log, 'image_generation', resourceId);
  const taskId = task.id;

  let imageGenId;
  try {
    const info = db.prepare(
      `INSERT INTO image_generations (drama_id, character_id, scene_id, provider, prompt, negative_prompt, model, size, quality, status, task_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
    ).run(
      dramaIdNum,
      charIdNum,
      sceneIdNum,
      provider || 'openai',
      prompt || '',
      negRow,
      model || null,
      size || null,
      quality || null,
      taskId,
      now,
      now
    );
    imageGenId = info.lastInsertRowid;
  } catch (e) {
    if ((e.message || '').includes('scene_id') || (e.message || '').includes('character_id')) {
      const info = db.prepare(
        `INSERT INTO image_generations (drama_id, provider, prompt, model, size, quality, status, task_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
      ).run(dramaIdNum, provider || 'openai', prompt || '', model || null, size || null, quality || null, taskId, now, now);
      imageGenId = info.lastInsertRowid;
    } else {
      throw e;
    }
  }

  scheduleLegacyAsync(log, 'legacy_image_client_generation', async () => {
    const signal = taskService.ensureTaskOperation(taskId).signal;
    let storagePath = null;
    let localPath = null;
    let committed = false;

    const updateGenerationCompleted = (imageUrl, completedAt) => {
      try {
        db.prepare(
          'UPDATE image_generations SET status = ?, image_url = ?, local_path = ?, error_msg = NULL, completed_at = ?, updated_at = ? WHERE id = ?'
        ).run('completed', imageUrl, localPath, completedAt, completedAt, imageGenId);
      } catch (error) {
        if (!String(error.message || '').includes('completed_at')) throw error;
        db.prepare(
          'UPDATE image_generations SET status = ?, image_url = ?, local_path = ?, error_msg = NULL, updated_at = ? WHERE id = ?'
        ).run('completed', imageUrl, localPath, completedAt, imageGenId);
      }
    };

    const updateCharacterImage = (imageUrl, completedAt) => {
      if (charIdNum == null) return;
      try {
        const oldChar = db
          .prepare('SELECT local_path, image_url, extra_images, seedance2_asset FROM characters WHERE id = ?')
          .get(charIdNum);
        const oldPath = oldChar?.local_path || oldChar?.image_url || '';
        let extras = [];
        try { extras = oldChar?.extra_images ? JSON.parse(oldChar.extra_images) : []; } catch (_) {}
        if (!Array.isArray(extras)) extras = [];
        if (oldPath && !extras.includes(oldPath)) extras.push(oldPath);
        const extraJson = extras.length ? JSON.stringify(extras) : null;
        seedance2AssetGuards.markStaleOnCharacterMainImageDrift(db, log, { ...oldChar, id: charIdNum }, {
          image_url: imageUrl,
          local_path: localPath,
        });
        db.prepare(
          'UPDATE characters SET image_url = ?, local_path = ?, extra_images = ?, error_msg = NULL, updated_at = ? WHERE id = ?'
        ).run(imageUrl, localPath, extraJson, completedAt, charIdNum);
      } catch (error) {
        if (!/local_path|extra_images|error_msg/.test(String(error.message || ''))) throw error;
        db.prepare('UPDATE characters SET image_url = ?, updated_at = ? WHERE id = ?')
          .run(imageUrl, completedAt, charIdNum);
      }
    };

    const updateSceneImage = (imageUrl, completedAt) => {
      if (sceneIdNum == null) return;
      try {
        const oldScene = db.prepare('SELECT local_path, image_url, extra_images FROM scenes WHERE id = ?').get(sceneIdNum);
        const oldPath = oldScene?.local_path || oldScene?.image_url || '';
        let extras = [];
        try { extras = oldScene?.extra_images ? JSON.parse(oldScene.extra_images) : []; } catch (_) {}
        if (!Array.isArray(extras)) extras = [];
        if (oldPath && !extras.includes(oldPath)) extras.push(oldPath);
        const extraJson = extras.length ? JSON.stringify(extras) : null;
        db.prepare(
          'UPDATE scenes SET image_url = ?, local_path = ?, extra_images = ?, error_msg = NULL, updated_at = ? WHERE id = ?'
        ).run(imageUrl, localPath, extraJson, completedAt, sceneIdNum);
      } catch (error) {
        if (!/local_path|extra_images|error_msg/.test(String(error.message || ''))) throw error;
        db.prepare('UPDATE scenes SET image_url = ?, updated_at = ? WHERE id = ?')
          .run(imageUrl, completedAt, sceneIdNum);
      }
    };

    try {
      taskService.runTaskMutation(db, taskId, signal, () => {
        db.prepare('UPDATE image_generations SET status = ?, updated_at = ? WHERE id = ?')
          .run('processing', new Date().toISOString(), imageGenId);
        taskService.updateTaskStatus(db, taskId, 'processing', 10, '正在生成图片');
      });

      const result = await module.exports.callImageApi(db, log, {
        prompt,
        model,
        size,
        quality,
        drama_id: drama_id,
        character_id: character_id,
        image_type,
        image_gen_id: imageGenId,
        preferred_provider: provider,
        user_negative_prompt: user_negative_prompt || undefined,
        signal,
      });
      throwIfAborted(signal);
      if (result.error) {
        throw new Error(toSafeProviderErrorMessage(result.error, {
          provider: provider || 'Image provider',
          operation: 'image generation',
        }));
      }
      if (!result.image_url) throw new Error('图片 Provider 未返回图片地址');

      const cfg = require('../config').loadConfig();
      storagePath = path.isAbsolute(cfg.storage?.local_path)
        ? cfg.storage.local_path
        : path.join(process.cwd(), cfg.storage?.local_path || './data/storage');
      const category = sceneIdNum != null ? 'scenes' : (charIdNum != null ? 'characters' : 'images');
      const projectSubdir = storageLayout.getProjectStorageSubdir(db, dramaIdNum);
      localPath = await module.exports.downloadImageToLocalAbortable(
        storagePath,
        result.image_url,
        category,
        log,
        'ig',
        projectSubdir,
        signal
      );
      if (!localPath) throw new Error('图片下载失败，未生成可提交的本地文件');

      const completedAt = new Date().toISOString();
      taskService.runTaskMutation(db, taskId, signal, () => {
        updateGenerationCompleted(result.image_url, completedAt);
        updateCharacterImage(result.image_url, completedAt);
        updateSceneImage(result.image_url, completedAt);
        const taskCompleted = taskService.updateTaskResult(db, taskId, {
          image_generation_id: imageGenId,
          image_url: result.image_url,
          local_path: localPath,
          status: 'completed',
        });
        if (!taskCompleted) throw operationCancelledError('任务已结束，拒绝提交迟到的图片结果');
      });
      committed = true;
      if (charIdNum != null) {
        log.info('Character image updated', { character_id: charIdNum, image_url: result.image_url, local_path: localPath });
      }
      if (sceneIdNum != null) {
        log.info('Scene image updated', { scene_id: sceneIdNum, image_url: result.image_url, local_path: localPath });
      }
      log.info('Image generation completed', { image_gen_id: imageGenId, local_path: localPath });
    } catch (err) {
      if (!committed) removeDownloadedImage(storagePath, localPath, log);
      if (isOperationCancelled(err, signal)) {
        try {
          await taskService.waitForTaskCancellationDecision(db, taskId, signal);
        } catch (_) {}
        log.info('Image generation cancelled', { image_gen_id: imageGenId, task_id: taskId });
        return;
      }

      const errMsg = toSafeProviderErrorMessage(err, {
        provider: provider || 'Image provider',
        operation: 'image generation',
      });
      try {
        await taskService.failTaskAfterCancellationDecision(db, taskId, errMsg, (failedAt) => {
          db.prepare(
            'UPDATE image_generations SET status = ?, error_msg = ?, updated_at = ? WHERE id = ?'
          ).run('failed', errMsg, failedAt, imageGenId);
          if (charIdNum != null) {
            try {
              db.prepare('UPDATE characters SET error_msg = ?, updated_at = ? WHERE id = ?')
                .run(errMsg, failedAt, charIdNum);
            } catch (_) {}
          }
          if (sceneIdNum != null) {
            try {
              db.prepare('UPDATE scenes SET error_msg = ?, updated_at = ? WHERE id = ?')
                .run(errMsg, failedAt, sceneIdNum);
            } catch (_) {}
          }
        });
      } catch (persistError) {
        log.error('Image generation: failed to persist atomic failure', {
          image_gen_id: imageGenId,
          task_id: taskId,
          error: persistError.message,
        });
      }
      log.error('Image generation error', { image_gen_id: imageGenId, task_id: taskId, error: errMsg });
    }
  }, { image_generation_id: imageGenId, task_id: taskId, drama_id: dramaIdNum });

  const row = db.prepare('SELECT * FROM image_generations WHERE id = ?').get(imageGenId);
  return row ? rowToItem(row) : { id: imageGenId, task_id: taskId, status: 'pending', drama_id: dramaIdNum, character_id: charIdNum, scene_id: sceneIdNum, prompt, model, size, quality, created_at: now, updated_at: now };
}

function rowToItem(r) {
  return {
    id: r.id,
    storyboard_id: r.storyboard_id,
    drama_id: r.drama_id,
    character_id: r.character_id,
    provider: r.provider,
    prompt: r.prompt,
    model: r.model,
    size: r.size,
    quality: r.quality,
    image_url: r.image_url,
    local_path: r.local_path,
    status: r.status,
    task_id: r.task_id,
    error_msg: r.error_msg,
    created_at: r.created_at,
    updated_at: r.updated_at,
    completed_at: r.completed_at,
  };
}

module.exports = {
  getDefaultImageConfig,
  callImageApi,
  createAndGenerateImage,
  downloadImageToLocalAbortable,
  removeDownloadedImage,
  resolveAssetUserNegativeForApi,
  getStoryboardReferenceLimits,
  canAddStoryboardCharacterRef,
  canAddStoryboardObjectRef,
  refListHasCanonical,
  fixAgnesImageSize,
  isAgnesImageConfig,
  /** 图床 URL 缓存（image_proxy_cache），供 SD2 认证等复用 */
  getProxyCache,
  getProxyCacheValidated,
  deleteProxyCache,
  isProxyUrlAlive,
  setProxyCache,
};
