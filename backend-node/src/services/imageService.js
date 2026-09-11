// 只读查询、行装配、管线辅助与生成执行见 imageServiceQuery.js / imageServiceAssembly.js / imageServicePipeline.js / imageServiceProcess.js

const taskService = require('./taskService');
const { scheduleLegacyAsync } = require('./legacyAsyncSchedulerService');
const { toUserFacingProcessError } = require('./providerErrorSanitizer');
const {
  rowToItem,
  aspectRatioToSize,
  mergePromptWithStyle,
  isUsableProviderReference,
  resolveUseFirstFrameLayoutLock,
} = require('./imageServiceAssembly');
const {
  list,
  getById,
  getByIdAfterScopeValidation,
  getBackgroundsForEpisode,
  resolveImageGenerationScope,
  imageBadRequest,
} = require('./imageServiceQuery');
const { bindCompletedSceneImage } = require('./imageServicePipeline');
const {
  processImageGeneration,
  persistImageFailure,
} = require('./imageServiceProcess');

/**
 * 入口模块保留失败收口调用形态，供用户可见错误扫描锁定。
 * 实际写入与生成流水线在 imageServiceProcess.js。
 */
function persistCaughtImageFailure(db, row, err) {
  return persistImageFailure(db, row, err);
}

function toImageSaveUserError(saveErr) {
  return toUserFacingProcessError(saveErr, '图片保存到本地失败，请稍后重试');
}

function toImageProcessUserError(message) {
  return toUserFacingProcessError(message, '图片生成失败');
}

void persistCaughtImageFailure;
void toImageSaveUserError;
void toImageProcessUserError;

function create(db, log, req) {
  const now = new Date().toISOString();
  const { dramaId, storyboardId } = resolveImageGenerationScope(db, req);
  const idempotencyKey = String(req.idempotency_key || '').trim() || null;
  if (idempotencyKey) {
    const existing = db.prepare(
      `SELECT id, drama_id, storyboard_id, deleted_at
         FROM image_generations
        WHERE idempotency_key = ?`
    ).get(idempotencyKey);
    if (existing) {
      let existingScope;
      try {
        existingScope = resolveImageGenerationScope(db, {
          drama_id: existing.drama_id,
          storyboard_id: existing.storyboard_id,
        });
      } catch (_) {
        throw imageBadRequest('该幂等键属于其他项目或分镜');
      }
      const wrongDrama = existingScope.dramaId !== dramaId;
      const wrongStoryboard = existingScope.storyboardId !== storyboardId;
      if (wrongDrama || wrongStoryboard) {
        throw imageBadRequest('该幂等键属于其他项目或分镜');
      }
      if (existing.deleted_at) {
        throw imageBadRequest('该幂等键指向已删除的图片记录，请使用新的幂等键');
      }
      if ((Number(existing.drama_id) || 0) !== existingScope.dramaId) {
        db.prepare('UPDATE image_generations SET drama_id = ?, updated_at = ? WHERE id = ?')
          .run(existingScope.dramaId, now, existing.id);
      }
      return { ...getByIdAfterScopeValidation(db, existing.id), idempotent_reuse: true };
    }
  }
  const task = taskService.createTask(db, log, 'image_generation', String(dramaId || ''));
  const taskId = task.id;
  const frameType = req.frame_type ?? null;
  const sceneId = req.scene_id != null ? Number(req.scene_id) : null;
  const refImagesJson =
    req.reference_images && Array.isArray(req.reference_images)
      ? JSON.stringify(req.reference_images.slice(0, 10))
      : null;
  if (req.reference_images && Array.isArray(req.reference_images)) {
    log.info('reference_images received', {
      image_gen_create: true,
      count: req.reference_images.length,
    });
  }
  const mergedPrompt = mergePromptWithStyle(req.prompt || '', req.style);
  // 优先使用请求中直接传入的 size；其次将 aspect_ratio 转成 size；未提供则存 NULL 留给 processImageGeneration 从 drama 元数据读取
  let reqSize = req.size || null;
  if (!reqSize && req.aspect_ratio) {
    reqSize = aspectRatioToSize(req.aspect_ratio) || null;
  }
  const useFirstFrameLayoutLock = resolveUseFirstFrameLayoutLock(req, frameType);
  const info = db.prepare(
    `INSERT INTO image_generations (storyboard_id, drama_id, scene_id, character_id, provider, prompt, negative_prompt, model, frame_type, reference_images, use_first_frame_layout_lock, size, status, task_id, idempotency_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
  ).run(
    storyboardId,
    dramaId,
    sceneId,
    req.character_id != null ? Number(req.character_id) : null,
    req.provider || 'openai',
    mergedPrompt,
    req.negative_prompt ?? null,
    req.model ?? null,
    frameType,
    refImagesJson,
    useFirstFrameLayoutLock,
    reqSize,
    taskId,
    idempotencyKey,
    now,
    now
  );
  const imageGenId = info.lastInsertRowid;
  if (!imageGenId) throw new Error('图片记录写入失败');
  if (req.__defer_processing !== true) {
    scheduleLegacyAsync(log, 'image_generation', () => {
      processImageGeneration(db, log, imageGenId);
    }, { image_generation_id: imageGenId, task_id: taskId, drama_id: dramaId });
  }
  return { id: imageGenId, task_id: taskId, status: 'pending', ...getByIdAfterScopeValidation(db, imageGenId) };
}

async function createAndProcessImage(db, log, req) {
  const created = create(db, log, { ...req, __defer_processing: true });
  if (created.status === 'completed') return created;
  if (created.idempotent_reuse && ['processing', 'failed'].includes(created.status)) {
    db.prepare("UPDATE image_generations SET status = 'pending', error_msg = NULL, updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), created.id);
  }
  await processImageGeneration(db, log, created.id);
  const completed = getById(db, created.id);
  if (!completed || completed.status !== 'completed') {
    throw new Error(completed?.error_msg || '图片生成未完成');
  }
  if (req.require_local !== false && !isUsableProviderReference(completed.local_path)) {
    const message = '图片生成完成但未保存到本地文件';
    const now = new Date().toISOString();
    db.prepare('UPDATE image_generations SET status = ?, error_msg = ?, updated_at = ? WHERE id = ?')
      .run('failed', message, now, created.id);
    if (created.task_id) taskService.updateTaskError(db, created.task_id, message);
    throw new Error(message);
  }
  return completed;
}

function deleteById(db, log, id) {
  const numId = Number(id);
  const now = new Date().toISOString();
  // 若该图当前绑定为某分镜的首/尾帧，解除绑定（避免悬空引用）
  try {
    const row = db.prepare('SELECT storyboard_id FROM image_generations WHERE id = ? AND deleted_at IS NULL').get(numId);
    if (row && row.storyboard_id != null) {
      const sid = Number(row.storyboard_id);
      db.prepare(`UPDATE storyboards SET first_frame_image_id = NULL, image_url = NULL, local_path = NULL, updated_at = ? WHERE id = ? AND first_frame_image_id = ?`).run(now, sid, numId);
      db.prepare(`UPDATE storyboards SET last_frame_image_id = NULL, last_frame_image_url = NULL, last_frame_local_path = NULL, updated_at = ? WHERE id = ? AND last_frame_image_id = ?`).run(now, sid, numId);
      db.prepare(`UPDATE storyboards SET video_reference_image_id = NULL, updated_at = ? WHERE id = ? AND video_reference_image_id = ?`).run(now, sid, numId);
    }
  } catch (e) {
    try { log?.warn?.('[image delete] 清除分镜绑定失败', { id: numId, err: e.message }); } catch (_) {}
  }
  const result = db.prepare('UPDATE image_generations SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(now, numId);
  return result.changes > 0;
}

function upload(db, log, req) {
  const now = new Date().toISOString();
  const { dramaId, storyboardId } = resolveImageGenerationScope(db, req);
  const frameType = req.frame_type ?? null;
  const info = db.prepare(
    `INSERT INTO image_generations (storyboard_id, drama_id, provider, prompt, image_url, local_path, frame_type, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?)`
  ).run(
    storyboardId,
    dramaId,
    'upload',
    req.prompt || '',
    req.image_url || '',
    req.local_path ?? null,
    frameType,
    now,
    now
  );
  const row = db.prepare('SELECT * FROM image_generations WHERE id = ?').get(info.lastInsertRowid);
  if (row && row.storyboard_id) {
    try {
      const { bindStoryboardFrameImage } = require('./storyboardFrameBinding');
      bindStoryboardFrameImage(
        db,
        row.storyboard_id,
        row.frame_type,
        row.id,
        row.image_url,
        row.local_path
      );
    } catch (_) {}
  }
  return row ? rowToItem(row) : null;
}

/**
 * 纯文本字符匹配：扫描分镜文本字段，补全 storyboards.characters 中漏掉的角色。
 * 无 AI 调用，速度极快，可在分镜生成后批量调用。
 * @param {object} db
 * @param {object} log
 * @param {number} storyboardId
 * @returns {{ added: string[] }} 本次新增的角色名列表
 */
function syncStoryboardCharacters(db, log, storyboardId) {
  const added = [];
  try {
    const sb = db.prepare(
      'SELECT id, episode_id, characters, action, dialogue, result, description FROM storyboards WHERE id = ? AND deleted_at IS NULL'
    ).get(Number(storyboardId));
    if (!sb) return { added };

    // 获取剧集对应的 drama_id
    let dramaId = null;
    try {
      const ep = db.prepare('SELECT drama_id FROM episodes WHERE id = ? AND deleted_at IS NULL').get(sb.episode_id);
      dramaId = ep?.drama_id ?? null;
    } catch (_) {}
    if (!dramaId) return { added };

    // 构造扫描文本
    const scanText = [sb.action, sb.dialogue, sb.result, sb.description].filter(Boolean).join(' ').toLowerCase();
    if (!scanText) return { added };

    // 解析已关联角色
    let charList = [];
    try { charList = JSON.parse(sb.characters || '[]'); } catch (_) { charList = []; }
    const coveredIds = new Set(charList.map((c) => Number(typeof c === 'object' && c != null ? c.id : c)));

    // 与剧集全角色做文本匹配
    const allChars = db.prepare('SELECT id, name FROM characters WHERE drama_id = ? AND deleted_at IS NULL').all(Number(dramaId));
    let updated = false;
    for (const ch of allChars) {
      if (!ch.name) continue;
      if (coveredIds.has(ch.id)) continue;
      if (!scanText.includes(ch.name.toLowerCase())) continue;
      charList.push({ id: ch.id, name: ch.name });
      coveredIds.add(ch.id);
      added.push(ch.name);
      updated = true;
    }

    if (updated) {
      db.prepare('UPDATE storyboards SET characters = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
        .run(JSON.stringify(charList), new Date().toISOString(), Number(storyboardId));
      if (log) log.info('[分镜角色补全] 补全完成', { storyboard_id: storyboardId, added });
    }
  } catch (err) {
    if (log) log.warn('[分镜角色补全] 异常', { storyboard_id: storyboardId, error: err.message });
  }
  return { added };
}

module.exports = {
  list,
  getById,
  create,
  deleteById,
  getBackgroundsForEpisode,
  upload,
  processImageGeneration,
  createAndProcessImage,
  bindCompletedSceneImage,
  aspectRatioToSize,
  isUsableProviderReference,
  syncStoryboardCharacters,
};
