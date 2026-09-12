/**
 * 图片生成执行：失败持久化、供应商调用装配与 processImageGeneration 主体流水线。
 * 参考图装配见 imageServiceReferences.js，提示词优化见 imageServicePrompt.js。
 */

const path = require('path');
const imageClient = require('./imageClient');
const taskService = require('./taskService');
const storageLayout = require('./storageLayout');
const { toUserFacingProcessError } = require('./providerErrorSanitizer');
const {
  aspectRatioToSize,
  isLastFrameType,
  rowUseFirstFrameLayoutLock,
} = require('./imageServiceAssembly');
const {
  imageTaskCancelled,
  removeUncommittedImage,
  runImageTaskMutation,
  assertImageTaskActive,
  applyGridPromptIfNeeded,
  resolveStorageRoot,
  normalizeLocalImageToTargetSize,
  normalizeSavedImageToTargetPixels,
  bindCompletedSceneImage,
  splitGeneratedGridIfNeeded,
} = require('./imageServicePipeline');
const { assembleImageGenerationReferences } = require('./imageServiceReferences');
const { polishStoryboardImagePrompt } = require('./imageServicePrompt');

/**
 * 将图片生成标为失败，并把错误收成用户可见中文。
 */
async function persistImageFailure(db, row, message) {
  const errorMessage = toUserFacingProcessError(message, '图片生成失败').slice(0, 500);
  const mutation = (now) => {
    db.prepare(
      `UPDATE image_generations SET status = 'failed', error_msg = ?, updated_at = ?
        WHERE id = ? AND status IN ('pending', 'processing')`
    ).run(errorMessage, now, row.id);
    if (row.scene_id != null) {
      try { db.prepare('UPDATE scenes SET error_msg = ?, updated_at = ? WHERE id = ?').run(errorMessage, now, row.scene_id); } catch (_) {}
    }
    if (row.storyboard_id != null) {
      try { db.prepare('UPDATE storyboards SET error_msg = ?, updated_at = ? WHERE id = ?').run(errorMessage, now, row.storyboard_id); } catch (_) {}
    }
  };
  if (row.task_id) {
    return taskService.failTaskAfterCancellationDecision(db, row.task_id, errorMessage, mutation);
  }
  const now = new Date().toISOString();
  db.transaction(() => mutation(now))();
  return true;
}

/**
 * 装配图生供应商调用参数。只拼装字段，不发起网络请求。
 */
function assembleImageProviderCallOptions({
  row,
  imageGenId,
  finalPrompt,
  imageSize,
  imageServiceType,
  referenceImageUrls,
  filesBaseUrl,
  storageLocalPath,
  apiSystemPrompt,
  frameIdentityLock,
  signal,
}) {
  return {
    prompt: finalPrompt,
    model: row.model,
    size: imageSize,
    quality: row.quality,
    drama_id: row.drama_id,
    character_id: row.character_id,
    image_gen_id: imageGenId,
    imageServiceType,
    reference_image_urls: referenceImageUrls || undefined,
    files_base_url: filesBaseUrl,
    storage_local_path: storageLocalPath,
    system_prompt: apiSystemPrompt,
    negative_prompt: row.negative_prompt || undefined,
    frame_identity_lock: frameIdentityLock,
    idempotency_key: row.idempotency_key || undefined,
    signal,
  };
}

/**
 * 异步处理图片生成：与 Go ProcessImageGeneration 对齐，调用图生 API 并更新记录与任务
 */
async function processImageGeneration(db, log, imageGenId) {
  const t0 = Date.now();
  const elapsed = () => `${Date.now() - t0}ms`;

  const row = db.prepare('SELECT * FROM image_generations WHERE id = ? AND deleted_at IS NULL').get(Number(imageGenId));
  if (!row) {
    log.error('[图生] 记录不存在', { id: imageGenId });
    return;
  }
  if (row.status !== 'pending') {
    log.info('[图生] 已被处理，跳过', { id: imageGenId, status: row.status });
    return;
  }
  const signal = row.task_id ? taskService.ensureTaskOperation(row.task_id).signal : null;
  let uncommittedStoragePath = null;
  let uncommittedLocalPath = null;
  let stagedStoryboardCharacters = null;
  let stagedPolishedPrompt = null;
  let stagedContinuitySnapshot = null;

  log.info('[图生] ▶ 开始', {
    id: imageGenId,
    storyboard_id: row.storyboard_id,
    scene_id: row.scene_id,
    drama_id: row.drama_id,
    model: row.model,
    prompt_preview: (row.prompt || '').slice(0, 80),
  });

  const now = new Date().toISOString();
  try {
    runImageTaskMutation(db, row, signal, () => {
      const changed = db.prepare(
        "UPDATE image_generations SET status = 'processing', updated_at = ? WHERE id = ? AND status = 'pending'"
      ).run(now, imageGenId);
      if (changed.changes !== 1) throw new Error('图片生成状态已发生变化');
    });
    const imageServiceType = row.storyboard_id ? 'storyboard_image' : 'image';

    await applyGridPromptIfNeeded(db, log, row, signal, imageGenId);

    // ── Step 1: 获取 AI 配置 ──────────────────────────────────────────
    const config = imageClient.getDefaultImageConfig(db, row.model, null, imageServiceType);
    if (!config) {
      log.error('[图生] ✗ 未找到图片 AI 配置', { id: imageGenId, imageServiceType, elapsed: elapsed() });
      await persistImageFailure(db, row, '未配置图片模型');
      return;
    }
    log.info('[图生] Step1 AI配置', {
      id: imageGenId,
      provider: config.provider,
      model: config.model,
      api_protocol: config.api_protocol || '(auto)',
      elapsed: elapsed(),
    });

    const refLimits = imageClient.getStoryboardReferenceLimits(config, row.model);
    log.info('[图生] Step2 参考图上限', {
      id: imageGenId,
      total: refLimits.total,
      max_characters: refLimits.maxCharacters,
      max_objects: refLimits.maxObjects,
      elapsed: elapsed(),
    });

    const {
      reference_image_urls,
      reference_source,
      reference_context_note,
      skipStep23PromptCharFilter,
      stagedStoryboardCharacters: stagedCharsFromRefs,
    } = assembleImageGenerationReferences(db, log, { row, imageGenId, refLimits, elapsed });
    void reference_source;
    void skipStep23PromptCharFilter;
    if (stagedCharsFromRefs) stagedStoryboardCharacters = stagedCharsFromRefs;

    // ── Step 3: 计算尺寸 ────────────────────────────────────────────
    const loadConfig = require('../config').loadConfig;
    const { mergeCfgStyleWithDrama } = require('../utils/dramaStyleMerge');
    let cfg = loadConfig();
    if (row.drama_id) {
      try {
        const dr = db.prepare('SELECT style, metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(row.drama_id);
        cfg = mergeCfgStyleWithDrama(cfg, dr || {});
      } catch (_) {}
    }
    const filesBaseUrl = (cfg.storage && cfg.storage.base_url) ? String(cfg.storage.base_url).replace(/\/$/, '') : '';
    const storageLocalPath = resolveStorageRoot(cfg);

    let imageSize = row.size || null;
    if (!imageSize && row.drama_id) {
      try {
        const dramaRow = db.prepare('SELECT metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(row.drama_id);
        if (dramaRow && dramaRow.metadata) {
          const meta = typeof dramaRow.metadata === 'string' ? JSON.parse(dramaRow.metadata) : dramaRow.metadata;
          if (meta && meta.aspect_ratio) imageSize = aspectRatioToSize(meta.aspect_ratio);
        }
      } catch (_) {}
    }
    if (!imageSize) {
      const cfgRatio = cfg?.style?.default_image_ratio;
      if (cfgRatio) imageSize = aspectRatioToSize(cfgRatio);
    }
    log.info('[图生] Step3 尺寸', { id: imageGenId, size: imageSize, elapsed: elapsed() });


    const polished = await polishStoryboardImagePrompt(db, log, {
      row,
      imageGenId,
      cfg,
      signal,
      elapsed,
      reference_context_note,
    });
    let finalPrompt = polished.finalPrompt;
    const isSingleStoryboard = polished.isSingleStoryboard;
    if (polished.stagedPolishedPrompt) stagedPolishedPrompt = polished.stagedPolishedPrompt;
    if (polished.stagedContinuitySnapshot) stagedContinuitySnapshot = polished.stagedContinuitySnapshot;

    // ── Step 3.8: 单帧分镜注入防分割指令 ──────────────────────────────
    // 当有多张参考图时，部分模型（如 Doubao）会生成左右分栏/对比布局，加入负面约束抑制该行为
    if (isSingleStoryboard && reference_image_urls && reference_image_urls.length > 1) {
      const antiSplitSuffix = ', single continuous scene, no split panels, no side-by-side layout, no collage';
      if (!finalPrompt.includes('no split')) {
        finalPrompt = finalPrompt.trimEnd() + antiSplitSuffix;
      }
    }

    // ── Step 3.9: 尾帧站位锁强制文本指令（与视觉参考图双保险）────────────────
    // 无论是否成功注入参考图，都给尾帧 prompt 追加强约束，防止模型脑补新布局
    const isLastFrameForLock = isLastFrameType(row.frame_type) && rowUseFirstFrameLayoutLock(row);
    if (isLastFrameForLock && row.storyboard_id) {
      const layoutLockSuffix = '。【人物站位最高铁律】必须与本分镜的首帧图片保持100%一致的构图、人物左右站位（左/中/右位置、相对距离、朝向）、相机取景和空间布局，仅允许按result描述改变角色姿态、表情、细微动作和环境结果元素，严禁任何人物位置互换或画面重新构图。违反此规则视为生成失败。';
      if (!finalPrompt.includes('人物站位最高铁律') && !finalPrompt.includes('CHARACTER POSITION LOCK')) {
        finalPrompt = finalPrompt.trimEnd() + layoutLockSuffix;
      }
    }

    // ── Step 4: 调用图生 API ─────────────────────────────────────────
    log.info('[图生] Step4 调用图生 API →', { id: imageGenId, elapsed: elapsed() });
    const tApi = Date.now();
    // 单张分镜图时，把参考图标签（reference_context_note）传给 Gemini，
    // 在 callGeminiImageApi 里解析为 per-image 标签，交替插入 parts 结构
    const apiSystemPrompt = (isSingleStoryboard && reference_context_note) ? reference_context_note : undefined;

    const isFrameIdentityLock =
      row.frame_type &&
      ['first', 'last', 'key', 'storyboard_first', 'storyboard_last'].includes(String(row.frame_type).toLowerCase());
    if (isFrameIdentityLock && row.storyboard_id && finalPrompt) {
      try {
        const framePromptService = require('./framePromptService');
        const { sanitizeFramePrompt, parseNamesFromAnchorLines } = require('../utils/framePromptSanitize');
        const anchors = framePromptService.loadStoryboardCharacterNames(db, row.storyboard_id);
        const allowed = parseNamesFromAnchorLines(anchors);
        const allDrama = framePromptService.loadDramaCharacterNamesForStoryboard(db, row.storyboard_id);
        const sanitized = sanitizeFramePrompt(finalPrompt, allowed, allDrama, {
          log,
          source: 'image_generation',
          storyboard_id: row.storyboard_id,
          frame_kind: row.frame_type,
          image_gen_id: imageGenId,
        });
        if (sanitized !== finalPrompt) {
          finalPrompt = sanitized;
        }
      } catch (sanitizeErr) {
        log.warn('[图生] 首尾帧 prompt 清洗跳过', { id: imageGenId, error: sanitizeErr.message });
      }
    }
    if (isFrameIdentityLock) {
      log.info('[图生] 首尾帧/关键帧：启用身份锁定负面提示词', {
        id: imageGenId,
        frame_type: row.frame_type,
        elapsed: elapsed(),
      });
    }

    const result = await imageClient.callImageApi(db, log, assembleImageProviderCallOptions({
      row,
      imageGenId,
      finalPrompt,
      imageSize,
      imageServiceType,
      referenceImageUrls: reference_image_urls,
      filesBaseUrl,
      storageLocalPath,
      apiSystemPrompt,
      frameIdentityLock: isFrameIdentityLock,
      signal,
    }));
    log.info('[图生] Step4 图生 API 返回', { id: imageGenId, api_ms: Date.now() - tApi, has_error: !!result.error, elapsed: elapsed() });

    const now2 = new Date().toISOString();
    if (result.error) {
      await persistImageFailure(db, row, result.error);
      log.error('[图生] ✗ API返回错误', { id: imageGenId, error: result.error, total_elapsed: elapsed() });
      return;
    }

    // ── Step 5: 保存图片到本地 ───────────────────────────────────────
    log.info('[图生] Step5 保存到本地 →', { id: imageGenId, elapsed: elapsed() });
    const tSave = Date.now();
    let localPath = null;
    let storagePath = null;
    try {
      storagePath = resolveStorageRoot(cfg);
      const category =
        row.scene_id != null ? 'scenes' : row.character_id != null ? 'characters' : 'images';
      const projectSubdir = storageLayout.getProjectStorageSubdir(db, row.drama_id);
      localPath = await imageClient.downloadImageToLocalAbortable(
        storagePath,
        result.image_url,
        category,
        log,
        'ig',
        projectSubdir,
        signal
      );
      if (!localPath) throw new Error('图片下载到本地失败');
      uncommittedStoragePath = storagePath;
      uncommittedLocalPath = localPath;
      assertImageTaskActive(db, row, signal);
      if (localPath && imageSize) {
        const absImg = path.join(storagePath, localPath);
        await normalizeLocalImageToTargetSize(absImg, imageSize, log, { id: imageGenId });
      }
      log.info('[图生] Step5 保存完成', { id: imageGenId, local_path: localPath, save_ms: Date.now() - tSave, elapsed: elapsed() });

      // Step5.1：单帧/场景图等若 API 返回像素与 Step3 目标不一致，则 letterbox 到目标画布（Gemini 常见）
      if (
        localPath &&
        imageSize &&
        row.frame_type !== 'quad_grid' &&
        row.frame_type !== 'nine_grid'
      ) {
        const absNorm = path.join(storagePath, localPath);
        await normalizeSavedImageToTargetPixels(absNorm, imageSize, log, { id: imageGenId, size: imageSize });
      }
    } catch (saveErr) {
      if (imageTaskCancelled(saveErr, signal)) throw saveErr;
      throw new Error(toUserFacingProcessError(saveErr, '图片保存到本地失败，请稍后重试'));
    }

    // 入库的 image_url：优先指向本地静态路径，避免前端仍用 Gemini 返回的 data URL
    let persistedImageUrl = result.image_url;
    if (localPath) {
      persistedImageUrl = '/static/' + String(localPath).replace(/^\//, '');
    }

    // ── Step 6: 写库 & 任务完成 ──────────────────────────────────────
    let sceneBinding = { bound: false };
    let effectiveFrameTypeForBind = row.frame_type;
    const rowFt = String(row.frame_type || '').toLowerCase();
    const rowIsSpecificFirstLast = ['first', 'last', 'storyboard_first', 'storyboard_last'].includes(rowFt);
    if (row.storyboard_id && !rowIsSpecificFirstLast) {
      try {
        const fp = db.prepare(
          'SELECT frame_type FROM frame_prompts WHERE storyboard_id = ? ORDER BY updated_at DESC, created_at DESC LIMIT 1'
        ).get(Number(row.storyboard_id));
        if (fp?.frame_type && ['first', 'last', 'storyboard_first', 'storyboard_last'].includes(String(fp.frame_type))) {
          effectiveFrameTypeForBind = fp.frame_type;
        }
      } catch (_) {}
    }
    runImageTaskMutation(db, row, signal, () => {
      const completed = db.prepare(
        `UPDATE image_generations SET status = 'completed', prompt = ?, image_url = ?, local_path = ?, error_msg = NULL, completed_at = ?, updated_at = ?
          WHERE id = ? AND status = 'processing'`
      ).run(finalPrompt, persistedImageUrl, localPath, now2, now2, imageGenId);
      if (completed.changes !== 1) throw new Error('图片生成完成状态提交发生并发冲突');
      if (stagedStoryboardCharacters && row.storyboard_id) {
        db.prepare('UPDATE storyboards SET characters = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
          .run(stagedStoryboardCharacters, now2, Number(row.storyboard_id));
      }
      if (stagedPolishedPrompt && row.storyboard_id) {
        db.prepare('UPDATE storyboards SET polished_prompt = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
          .run(stagedPolishedPrompt, now2, Number(row.storyboard_id));
      }
      if (stagedContinuitySnapshot && row.storyboard_id) {
        db.prepare('UPDATE storyboards SET continuity_snapshot = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
          .run(stagedContinuitySnapshot, now2, Number(row.storyboard_id));
      }
      sceneBinding = bindCompletedSceneImage(db, row, persistedImageUrl, localPath, now2);
      if (row.storyboard_id && effectiveFrameTypeForBind !== 'quad_grid' && effectiveFrameTypeForBind !== 'nine_grid') {
        const { bindStoryboardFrameImage } = require('./storyboardFrameBinding');
        bindStoryboardFrameImage(db, row.storyboard_id, effectiveFrameTypeForBind, imageGenId, persistedImageUrl, localPath);
      }
      if (row.task_id) {
        const taskCompleted = taskService.updateTaskResult(db, row.task_id, {
          image_generation_id: imageGenId,
        image_url: persistedImageUrl,
        frame_type: row.frame_type || null,
        scene_binding: sceneBinding.target || null,
        status: 'completed',
        });
        if (!taskCompleted) throw new Error('图片任务完成状态提交发生并发冲突');
      }
    });
    uncommittedLocalPath = null;
    log.info('[图生] ✓ 完成', { id: imageGenId, local_path: localPath, total_elapsed: elapsed() });

    // ── 首尾帧绑定决策 ─────────────────────────────────────────────
    // 优先信任 image_generations 行自身保存的 frame_type（前端点击“尾帧生成”会正确传 'storyboard_last'）。
    // 仅当该记录的 frame_type 为空或非首/尾帧特型时，才回退到“最近一次 frame_prompts”作为推断（兼容旧数据/历史创建路径）。
    splitGeneratedGridIfNeeded(db, log, row, localPath, persistedImageUrl, cfg, imageGenId);

  } catch (err) {
    removeUncommittedImage(uncommittedStoragePath, uncommittedLocalPath, log);
    if (imageTaskCancelled(err, signal)) {
      log.info('[图生] 已取消，未提交生成结果', { id: imageGenId, total_elapsed: elapsed() });
      log.operation?.({
        operation: 'image_generation',
        phase: 'cancel',
        status: 'cancelled',
        id: imageGenId,
      });
      return;
    }
    await persistImageFailure(db, row, err);
    log.error('[图生] ✗ 异常', { id: imageGenId, error: err.message, stack: (err.stack || '').slice(0, 400), total_elapsed: elapsed() });
  }
}

module.exports = {
  persistImageFailure,
  assembleImageProviderCallOptions,
  processImageGeneration,
};
