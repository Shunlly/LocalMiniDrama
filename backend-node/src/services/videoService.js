// 只读查询与行装配见 videoServiceQuery.js / videoServiceAssembly.js
// 供应商任务编号持久化、重启恢复与补偿取消见 videoServiceProviderTasks.js
// 参考图装配见 videoServiceReferences.js，生成执行见 videoServiceProcess.js

const videoClient = require('./videoClient');
const { toUserFacingProcessError } = require('./providerErrorSanitizer');
const taskService = require('./taskService');
const { scheduleLegacyAsync } = require('./legacyAsyncSchedulerService');
const { targetVideoPixelsForAspect } = require('./videoServiceAssembly');
const {
  list,
  getById,
  resolveVideoGenerationScope,
  normalizeStoredDramaId,
  assertDramaAcceptsVideoWrites,
  videoBadRequest: badRequest,
} = require('./videoServiceQuery');
const { createVideoReferenceHelpers } = require('./videoServiceReferences');
const { createVideoServiceProcess } = require('./videoServiceProcess');

const VIDEO_PROVIDER_TASK_MESSAGES = Object.freeze({
  ownershipChanged: '视频任务归属已变化，拒绝写入供应商任务编号',
  persistFailed: '供应商任务编号持久化失败',
  lateCancel: '补偿取消迟到的供应商任务',
  missingOnRestart: '服务重启后无法恢复轮询（缺少供应商任务编号），请重新生成',
  restartCancelUnsupported(protocol) {
    return `当前供应商协议 ${protocol} 不支持重启后恢复远端取消`;
  },
});

const VIDEO_PROCESS_MESSAGES = Object.freeze({
  missingTaskOrUrl: '未返回任务编号或视频地址',
  missingRemoteCancel: '供应商已返回任务编号，但未注册远端取消函数',
});

const VIDEO_REFERENCE_MESSAGES = Object.freeze({
  invalidUrl: '参考媒体 URL 无效',
  publicHttp: '参考媒体 URL 必须是无凭据的公网 HTTP(S) 地址',
  localPath: '参考媒体本地路径必须位于本地存储目录内',
  gridIdInvalid: '宫格视频参考图 ID 无效',
  gridNeedsStoryboard: '选择宫格视频参考图时必须提供有效的分镜',
  gridNotInStoryboard: '宫格视频参考图不存在或不属于当前分镜',
  gridMissingUrl: '宫格视频参考图缺少可用地址',
  refsMustBeArray: '参考图列表必须是数组',
});

const {
  parseConfigSettings,
  configuredVideoModel,
  videoConfigSupportsGridReference,
  normalizedLocalReferencePath,
  referenceIdentity,
  normalizeSubmittedMediaReference,
  loadVideoReferenceImage,
  normalizeReferenceUrls,
} = createVideoReferenceHelpers(VIDEO_REFERENCE_MESSAGES);

const {
  persistVideoFailure,
  persistCompletedVideo,
  finalizeSuccessfulVideo,
  processVideoGeneration,
  persistProviderTaskId,
  persistProviderTaskIdAndCompensateCancel,
  resumePollForVideoGeneration,
  resumeProcessingVideoGenerations,
  setVideoGenFailed,
} = createVideoServiceProcess({
  providerMessages: VIDEO_PROVIDER_TASK_MESSAGES,
  processMessages: VIDEO_PROCESS_MESSAGES,
});

/**
 * 入口模块保留失败收口调用形态，供用户可见错误扫描锁定。
 * 实际写入与生成流水线在 videoServiceProcess.js。
 */
function persistCaughtVideoFailure(db, row, err) {
  return persistVideoFailure(db, row, err);
}

function toVideoProcessUserError(errorMessage) {
  return toUserFacingProcessError(errorMessage, '视频生成失败');
}

void persistCaughtVideoFailure;
void toVideoProcessUserError;
void parseConfigSettings;
void configuredVideoModel;
void normalizedLocalReferencePath;

function replaceFailedIdempotentTask(db, log, videoGeneration) {
  const retry = db.transaction(() => {
    const current = db.prepare(
      `SELECT id, drama_id, status, task_id
         FROM video_generations
        WHERE id = ? AND deleted_at IS NULL`
    ).get(videoGeneration.id);
    if (!current || current.status !== 'failed') return getById(db, videoGeneration.id);
    assertDramaAcceptsVideoWrites(db, Number(current.drama_id) || 0);
    const previousTask = current.task_id ? taskService.getTask(db, current.task_id) : null;
    if (previousTask && !['failed', 'cancelled', 'completed'].includes(previousTask.status)) {
      throw badRequest('幂等视频记录与活动任务状态不一致，请稍后重试');
    }
    const nextTask = taskService.createTask(
      db,
      log,
      'video_generation',
      String(Number(current.drama_id) || '')
    );
    const now = new Date().toISOString();
    const updated = db.prepare(
      `UPDATE video_generations
          SET status = 'processing', task_id = ?, provider_task_id = NULL,
              video_url = NULL, local_path = NULL, error_msg = NULL, completed_at = NULL, updated_at = ?
        WHERE id = ? AND status = 'failed' AND task_id IS ?`
    ).run(nextTask.id, now, current.id, current.task_id);
    if (updated.changes !== 1) throw new Error('失败视频重试状态已变化');
    return getById(db, current.id);
  });
  return typeof retry.immediate === 'function' ? retry.immediate() : retry();
}

function findIdempotentVideoGeneration(db, idempotencyKey, scope, now) {
  const existing = db.prepare(
    `SELECT id, drama_id, storyboard_id, deleted_at
       FROM video_generations
      WHERE idempotency_key = ?`
  ).get(idempotencyKey);
  if (!existing) return null;

  let existingScope;
  let storedDramaId;
  try {
    storedDramaId = normalizeStoredDramaId(existing.drama_id);
    existingScope = resolveVideoGenerationScope(db, {
      drama_id: existing.drama_id,
      storyboard_id: existing.storyboard_id,
    });
  } catch (_) {
    throw badRequest('该幂等键属于其他项目或分镜');
  }

  // 仅兼容旧数据将分镜任务的 drama_id 留为 0；其他不一致均为历史脏归属。
  const legacyZeroDrama = storedDramaId === 0 && existing.storyboard_id != null;
  if ((!legacyZeroDrama && storedDramaId !== existingScope.dramaId)
    || existingScope.dramaId !== scope.dramaId
    || existingScope.storyboardId !== scope.storyboardId) {
    throw badRequest('该幂等键属于其他项目或分镜');
  }
  if (existing.deleted_at) {
    throw badRequest('该幂等键指向已删除的视频记录，请使用新的幂等键');
  }
  if (storedDramaId !== existingScope.dramaId) {
    db.prepare('UPDATE video_generations SET drama_id = ?, updated_at = ? WHERE id = ?')
      .run(existingScope.dramaId, now, existing.id);
  }
  return { ...getById(db, existing.id), idempotent_reuse: true };
}

function createVideoGeneration(db, log, body, options = {}) {
  const now = new Date().toISOString();
  const { dramaId, storyboardId } = resolveVideoGenerationScope(db, body);
  const provider = String(body.provider || '').trim() || null;
  let prompt = body.prompt || '';
  const style = String(body.style || '').trim();
  if (style && !String(prompt).toLowerCase().includes(style.toLowerCase())) {
    prompt = prompt ? `${prompt}. Style: ${style}` : `Style: ${style}`;
  }
  let aspectRatio = null;
  if (body.aspect_ratio != null && String(body.aspect_ratio).trim() !== '') {
    aspectRatio = videoClient.normalizeAspectRatioForApi(body.aspect_ratio);
  }
  if (!aspectRatio && dramaId) {
    try {
      const dramaRow = db.prepare('SELECT metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(dramaId);
      const metadata = dramaRow?.metadata
        ? (typeof dramaRow.metadata === 'string' ? JSON.parse(dramaRow.metadata) : dramaRow.metadata)
        : null;
      if (metadata?.aspect_ratio) aspectRatio = videoClient.normalizeAspectRatioForApi(metadata.aspect_ratio);
    } catch (_) {}
  }
  let imageUrl = normalizeSubmittedMediaReference(body.image_url);
  let firstFrameUrl = normalizeSubmittedMediaReference(body.first_frame_url ?? body.first_frame_local_path);
  const lastFrameUrl = normalizeSubmittedMediaReference(body.last_frame_url ?? body.last_frame_local_path);
  let referenceUrls = normalizeReferenceUrls(body.reference_image_urls);
  const gridReference = loadVideoReferenceImage(
    db,
    storyboardId,
    dramaId,
    body.video_reference_image_id
  );
  if (gridReference) {
    const selectedConfig = videoClient.getDefaultVideoConfig(db, body.model, provider);
    if (!selectedConfig) throw badRequest('未配置可用于宫格参考的视频模型');
    if (!videoConfigSupportsGridReference(selectedConfig, body.model)) {
      throw badRequest('当前视频模型未声明支持宫格整图参考');
    }

    const suppliedPrimary = [body.image_url, body.first_frame_url, body.first_frame_local_path]
      .map((item) => String(item || '').trim())
      .filter(Boolean);
    if (suppliedPrimary.some((item) => referenceIdentity(item) !== gridReference.identity)) {
      throw badRequest('宫格视频参考图 ID 与提交的主图地址不一致');
    }
    const hasCanonicalReference = referenceUrls.some(
      (item) => referenceIdentity(item) === gridReference.identity
    );
    if (referenceUrls.length > 0 && suppliedPrimary.length === 0 && !hasCanonicalReference) {
      throw badRequest('宫格视频参考图 ID 与提交的参考图地址不一致');
    }

    imageUrl = gridReference.canonical;
    firstFrameUrl = gridReference.canonical;
    referenceUrls = [
      gridReference.canonical,
      ...referenceUrls.filter((item) => referenceIdentity(item) !== gridReference.identity),
    ].slice(0, 10);
  }
  const refImagesJson = referenceUrls.length ? JSON.stringify(referenceUrls) : null;
  const idempotencyKey = String(body.idempotency_key || '').trim() || null;
  if (idempotencyKey) {
    const reused = findIdempotentVideoGeneration(db, idempotencyKey, { dramaId, storyboardId }, now);
    if (reused) return reused;
  }
  const providerConfig = videoClient.getDefaultVideoConfig(db, body.model, provider);
  if (!providerConfig) throw badRequest('缺少已启用的视频生成配置');
  if (!configuredVideoModel(providerConfig, body.model)) {
    throw badRequest('视频生成配置尚未选择可用模型');
  }
  // 复查与两条写入必须在同一个写事务内，避免并发相同 key 留下孤立 async_tasks。
  const persist = db.transaction(() => {
    assertDramaAcceptsVideoWrites(db, dramaId);
    if (idempotencyKey) {
      const racedReuse = findIdempotentVideoGeneration(
        db,
        idempotencyKey,
        { dramaId, storyboardId },
        now
      );
      if (racedReuse) return { reused: racedReuse };
    }

    const task = taskService.createTask(db, log, 'video_generation', String(dramaId || ''));
    const info = db.prepare(
      `INSERT INTO video_generations
       (drama_id, storyboard_id, provider, prompt, model, duration, aspect_ratio, resolution, seed,
        camera_fixed, watermark, image_url, first_frame_url, last_frame_url, reference_image_urls,
         status, task_id, idempotency_key, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?, ?, ?)`
    ).run(
      dramaId,
      storyboardId,
      provider,
      prompt,
      body.model ?? null,
      body.duration ?? null,
      aspectRatio,
      body.resolution ?? null,
      body.seed != null ? Number(body.seed) : null,
      body.camera_fixed != null ? (body.camera_fixed ? 1 : 0) : null,
      body.watermark != null ? (body.watermark ? 1 : 0) : 0,
      imageUrl,
      firstFrameUrl,
      lastFrameUrl,
      refImagesJson,
      task.id,
      idempotencyKey,
      now,
      now
    );
    return { videoGenId: Number(info.lastInsertRowid), taskId: task.id };
  });
  const persisted = typeof persist.immediate === 'function' ? persist.immediate() : persist();
  if (persisted.reused) return persisted.reused;
  const { videoGenId, taskId } = persisted;
  if (options.defer_processing !== true) {
    scheduleLegacyAsync(log, 'video_generation_route', () => {
      processVideoGeneration(db, log, videoGenId);
    }, { video_generation_id: videoGenId, task_id: taskId, drama_id: dramaId });
  }
  return getById(db, videoGenId) || { id: videoGenId, task_id: taskId, status: 'processing' };
}

async function createAndProcessVideo(db, log, body) {
  let created = createVideoGeneration(db, log, body, { defer_processing: true });
  if (created.status === 'completed') return created;
  if (created.idempotent_reuse && created.status === 'failed') {
    created = replaceFailedIdempotentTask(db, log, created);
  }
  await processVideoGeneration(db, log, created.id);
  const completed = getById(db, created.id);
  if (!completed || completed.status !== 'completed') {
    throw new Error(completed?.error_msg || '视频生成未完成');
  }
  if (body.require_local !== false && !String(completed.local_path || '').trim()) {
    const message = '视频生成完成但未保存到本地文件';
    const now = new Date().toISOString();
    setVideoGenFailed(db, created.id, message, now);
    if (created.task_id) taskService.updateTaskError(db, created.task_id, message);
    throw new Error(message);
  }
  return completed;
}

async function deleteById(db, log, id) {
  const row = db.prepare(
    'SELECT id, task_id, status FROM video_generations WHERE id = ? AND deleted_at IS NULL'
  ).get(Number(id));
  if (!row) return false;
  const task = row.task_id ? taskService.getTask(db, row.task_id) : null;
  if (task && ['pending', 'processing', 'cancelling'].includes(task.status)) {
    const cancelled = await taskService.cancelTask(db, log, row.task_id, '删除视频生成记录');
    if (!cancelled.ok) {
      const error = new Error(cancelled.error || '任务取消失败，视频记录未删除');
      error.code = cancelled.reason === 'task_scope_conflict'
        ? 'TASK_SCOPE_CONFLICT'
        : cancelled.reason === 'remote_cancel_uncertain'
          ? 'REMOTE_CANCEL_UNCERTAIN'
          : 'REMOTE_CANCEL_FAILED';
      throw error;
    }
  }
  const now = new Date().toISOString();
  const result = db.prepare(
    'UPDATE video_generations SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL'
  ).run(now, Number(id));
  return result.changes > 0;
}

module.exports = {
  list,
  getById,
  createVideoGeneration,
  createAndProcessVideo,
  finalizeSuccessfulVideo,
  persistCompletedVideo,
  targetVideoPixelsForAspect,
  videoConfigSupportsGridReference,
  deleteById,
  processVideoGeneration,
  persistProviderTaskId,
  persistProviderTaskIdAndCompensateCancel,
  resumePollForVideoGeneration,
  resumeProcessingVideoGenerations,
  VIDEO_PROVIDER_TASK_MESSAGES,
};
