// 与 Go pkg/image + ImageGenerationService 对齐：调用图片生成 API，更新 image_generations 与角色头像
const path = require('path');
const aiConfigService = require('./aiConfigService');
const uploadService = require('./uploadService');
const storageLayout = require('./storageLayout');
const taskService = require('./taskService');
const { loadConfig } = require('../config');
const seedance2AssetGuards = require('../utils/seedance2AssetGuards');
const { scheduleLegacyAsync } = require('./legacyAsyncSchedulerService');
const {
  createSafeProviderLogger,
  sanitizeProviderException,
  sanitizeProviderResult,
  toSafeProviderErrorMessage,
} = require('./providerErrorSanitizer');
const {
  imageRequestContext,
  normalizeIdempotencyKey,
  operationCancelledError,
  throwIfAborted,
  isOperationCancelled,
} = require('./imageGateway/runtime');
const {
  fixAgnesImageSize,
  isAgnesImageConfig,
} = require('./imageGateway/sizeAdapters');
const {
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
const {
  downloadImageToLocalAbortable,
  removeDownloadedImage,
} = require('./imageGateway/download');
const {
  resolveAssetUserNegativeForApi,
  getDefaultImageConfig,
  getModelFromConfig,
} = require('./imageGateway/config');
const { dispatchImageProtocol } = require('./imageGateway/protocolDispatch');
const { assembleImageProtocolRequest } = require('./imageGateway/requestAssembly');

// 厂商适配与纯工具已拆到 imageGateway/，本文件只负责编排、配置解析与稳定导出。

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
  const providerNetworkPolicy = aiConfigService.getProviderNetworkOptions(config, {
    lookup: opts.provider_dns_lookup,
    signal: opts.signal,
    fetchImpl: opts.fetch_impl || opts.fetchImpl,
  });
  const requestContext = imageRequestContext.getStore();
  if (requestContext) {
    requestContext.networkOptions = {
      ...(requestContext.networkOptions || {}),
      ...providerNetworkPolicy,
    };
  }
  const safeReferenceImageUrls = await prepareImageReferences(reference_image_urls, opts, config);
  const {
    protocol,
    effectivePrompt,
    mergedNegativePrompt,
    refLabelInjected,
  } = assembleImageProtocolRequest({
    config,
    model,
    prompt,
    systemPrompt: system_prompt,
    referenceUrls: safeReferenceImageUrls,
    userNegativePrompt: user_negative_prompt,
  });

  log.info('[图生] callImageApi 路由', {
    image_gen_id,
    protocol,
    api_protocol_raw: config.api_protocol || '(empty→auto)',
    provider,
    model,
    size,
    imageServiceType,
    ref_count: safeReferenceImageUrls.length,
    ref_label_injected: refLabelInjected,
    prompt_length: String(effectivePrompt).length,
  });

  return dispatchImageProtocol(db, config, log, {
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
  });
}

async function callImageApi(db, log, opts = {}) {
  const imageGenId = opts.image_gen_id;
  const idempotencyKey = normalizeIdempotencyKey(
    opts.idempotency_key
    || (imageGenId != null && String(imageGenId).trim() !== ''
      ? `image-generation-${imageGenId}`
      : '')
  );
  return imageRequestContext.run({
    idempotencyKey,
    networkOptions: {
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...((opts.fetch_impl || opts.fetchImpl) ? { fetchImpl: opts.fetch_impl || opts.fetchImpl } : {}),
    },
  }, async () => {
    const provider = opts.preferred_provider || opts.preferredProvider || '图片服务';
    try {
      throwIfAborted(opts.signal);
      const result = await callImageApiInternal(db, log, opts);
      throwIfAborted(opts.signal);
      return sanitizeProviderResult(result, { provider, operation: '图片生成' });
    } catch (error) {
      if (isOperationCancelled(error, opts.signal)) {
        throw operationCancelledError(opts.signal?.reason || error);
      }
      throw sanitizeProviderException(error, { provider, operation: '图片生成' });
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
          provider: provider || '图片服务',
          operation: '图片生成',
        }));
      }
      if (!result.image_url) throw new Error('图片服务未返回图片地址');

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
        provider: provider || '图片服务',
        operation: '图片生成',
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
