// 对应 Go application/services/drama_service.go
// 只读查询与行装配见 dramaQueryService.js / dramaAssembly.js
// 回收站与回收锁见 dramaRecycle.js
// 创建/更新/大纲/角色/分集/进度/画布写入见 dramaServiceWrites.js

const uploadService = require('./uploadService');
const dramaWriteGuard = require('./dramaWriteGuard');
const {
  assertBackgroundTasksAccepting,
  scheduleLegacyAsync,
} = require('./legacyAsyncSchedulerService');
const {
  getDrama,
  getDramaById,
  listDramas,
  listTrashedDramas,
  getTrashRetentionPolicy,
  getDramaStats,
  getCharacters,
  downloadEpisodeVideo,
} = require('./dramaQueryService');
const dramaRecycle = require('./dramaRecycle');
const dramaServiceWrites = require('./dramaServiceWrites');

const assertDramaWritable = dramaWriteGuard.assertDramaWritable;

function runDramaWriteTransaction(db, dramaId, mutation) {
  assertDramaWritable(db, dramaId);
  const persist = db.transaction(() => {
    assertDramaWritable(db, dramaId);
    return mutation();
  });
  return typeof persist.immediate === 'function' ? persist.immediate() : persist();
}

dramaServiceWrites.bindDramaWriteTransaction(runDramaWriteTransaction);

const {
  createDrama,
  updateDrama,
  saveOutline,
  saveCharacters,
  saveEpisodes,
  saveProgress,
  saveCanvasLayout,
} = dramaServiceWrites;

function generateStoryboard(db, log, episodeId, options) {
  const episodeStoryboardService = require('./episodeStoryboardService');
  const { model, style, storyboard_count, video_duration, aspect_ratio, include_narration, universal_omni_storyboard } = options || {};
  // 转换可能为字符串的数字
  const count = storyboard_count ? Number(storyboard_count) : undefined;
  const duration = video_duration ? Number(video_duration) : undefined;
  return episodeStoryboardService.generateStoryboard(
    db,
    log,
    episodeId,
    model || undefined,
    style,
    count,
    duration,
    aspect_ratio,
    include_narration,
    universal_omni_storyboard
  );
}

function assertTaskResourceWritable(db, taskType, resourceId) {
  try {
    db.prepare('SELECT id FROM dramas LIMIT 1').get();
  } catch (error) {
    if (/no such table/i.test(error?.message || '')) return [];
    throw error;
  }
  const dramaIds = [...new Set(dramaRecycle.declaredTaskDramaIds(db, {
    type: taskType,
    resource_id: resourceId,
  }))];
  for (const dramaId of dramaIds) assertDramaWritable(db, dramaId);
  return dramaIds;
}

/**
 * 取某分镜的视频地址：优先使用用户手动选定的 storyboard.video_url，否则取最新完成的 video_generations 记录
 */
function getVideoUrlForStoryboard(db, storyboardId, baseUrl) {
  // 1. 获取 storyboard 表中的视频信息（代表用户选定或上次同步的结果）
  const sb = db.prepare('SELECT video_url, video_local_path, updated_at FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(storyboardId);
  
  // 2. 获取 video_generations 表中最新完成的记录
  const vg = db.prepare(
    "SELECT video_url, local_path, completed_at, updated_at, created_at FROM video_generations WHERE storyboard_id = ? AND status = 'completed' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1"
  ).get(storyboardId);

  // 辅助函数：构造完整 URL，优先使用本地路径（避免远程URL过期导致无法合并）
  const buildUrl = (videoUrl, localPath) => {
    const cfg = require('../config').loadConfig();
    const rawStorage = cfg?.storage?.local_path || './data/storage';
    const path = require('path');
    const storageRoot = path.isAbsolute(rawStorage) ? rawStorage : path.join(process.cwd(), rawStorage);
    for (const candidate of [localPath, videoUrl]) {
      const value = String(candidate || '').trim();
      if (!value) continue;
      try {
        const local = uploadService.resolveStorageReference(storageRoot, value);
        if (local) return local.relativePath;
      } catch (error) {
        if (!/^https?:\/\//i.test(value) || value.startsWith('/static/')) continue;
      }
      if (/^https?:\/\//i.test(value)) {
        try { return uploadService.assertPublicHttpUrlSyntax(value).toString(); } catch (_) { continue; }
      }
    }
    return null;
  };

  const sbUrl = sb ? buildUrl(sb.video_url, sb.video_local_path) : null;
  const vgUrl = vg ? buildUrl(vg.video_url, vg.local_path) : null;

  // 策略：比较时间，取最新的
  // 如果只有其中一个有 URL，直接用那个
  if (sbUrl && !vgUrl) return sbUrl;
  if (!sbUrl && vgUrl) return vgUrl;
  if (!sbUrl && !vgUrl) return null;

  // 都有 URL，比较时间
  // sb 使用 updated_at
  // vg 使用 completed_at > updated_at > created_at
  const sbTime = sb.updated_at || '1970-01-01';
  const vgTime = vg.completed_at || vg.updated_at || vg.created_at || '1970-01-01';

  // 如果生成记录的时间比分镜更新时间还晚（说明是重新生成的，且可能没回写），则优先用生成记录
  if (vgTime > sbTime) {
    return vgUrl;
  }
  
  // 否则依然以 storyboard 为准（可能是用户手动修改过，或者已经回写过）
  return sbUrl;
}

function findActiveEpisodeMerge(db, episodeId) {
  return db.prepare(
    `SELECT merge.id AS merge_id, merge.task_id, merge.scenes, merge.status
       FROM video_merges merge
       LEFT JOIN async_tasks task
         ON task.id = merge.task_id
        AND task.deleted_at IS NULL
      WHERE merge.episode_id = ?
        AND merge.deleted_at IS NULL
        AND (
          merge.status = 'qa_pending'
          OR (
            merge.status IN ('pending', 'processing')
            AND task.status IN ('pending', 'processing')
          )
        )
      ORDER BY merge.id DESC
      LIMIT 1`
  ).get(Number(episodeId));
}

function activeMergeResponse(activeMerge, episodeId) {
  let scenesCount = 0;
  try {
    const activeScenes = JSON.parse(activeMerge.scenes || '[]');
    scenesCount = Array.isArray(activeScenes) ? activeScenes.length : 0;
  } catch (_) {}
  return {
    message: activeMerge.status === 'qa_pending'
      ? '本集视频已合成，正在等待质量检查'
      : '本集已有视频合成任务正在处理',
    merge_id: activeMerge.merge_id,
    episode_id: Number(episodeId),
    scenes_count: scenesCount,
    task_id: activeMerge.task_id,
    reused: true,
  };
}

function finalizeEpisode(db, log, episodeId, baseUrl, body = {}) {
  const ep = db.prepare(
    'SELECT id, drama_id, episode_number, status, video_url, updated_at FROM episodes WHERE id = ? AND deleted_at IS NULL'
  ).get(episodeId);
  if (!ep) return null;
  const activeMerge = findActiveEpisodeMerge(db, episodeId);
  if (activeMerge) return activeMergeResponse(activeMerge, episodeId);
  const drama = db.prepare('SELECT title FROM dramas WHERE id = ? AND deleted_at IS NULL').get(ep.drama_id);
  const storyboards = db.prepare(
    'SELECT id, storyboard_number, duration FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL ORDER BY storyboard_number ASC'
  ).all(episodeId);
  const videoMergeService = require('./videoMergeService');
  const scenes = [];
  for (let i = 0; i < storyboards.length; i++) {
    const sb = storyboards[i];
    const videoUrl = getVideoUrlForStoryboard(db, sb.id, baseUrl);
    if (!videoUrl) {
      log.warn('Finalize skip storyboard (no video)', { storyboard_id: sb.id, storyboard_number: sb.storyboard_number });
      continue;
    }
    scenes.push({
      scene_id: sb.id,
      video_url: videoUrl,
      duration: Number(sb.duration) || 5,
      order: i,
    });
  }
  if (scenes.length === 0) {
    log.warn('Finalize no scenes with video', { episode_id: episodeId });
    return { message: '本集没有可合成的视频片段', merge_id: null, episode_id: episodeId, scenes_count: 0, task_id: null };
  }
  const title = drama && drama.title ? `${drama.title} - 第${ep.episode_number ?? episodeId}集` : null;
  const mergeReq = {
    episode_id: episodeId,
    drama_id: ep.drama_id,
    title,
    scenes,
    provider: 'ffmpeg',
    mode: 'strict_production',
    merge_options: {
      burn_narration_subtitles: !!(body && body.burn_narration_subtitles),
      burn_dialogue_audio: !!(body && body.burn_dialogue_audio),
      watermark_text: (body && body.watermark_text != null)
        ? String(body.watermark_text).trim().slice(0, 200)
        : '',
    },
  };
  assertBackgroundTasksAccepting();
  const createMerge = db.transaction(() => {
    const concurrentMerge = findActiveEpisodeMerge(db, episodeId);
    if (concurrentMerge) return { activeMerge: concurrentMerge };
    const created = videoMergeService.create(db, log, mergeReq);
    const mergeId = created.merge_id || created.id;
    db.prepare('UPDATE episodes SET status = ? WHERE id = ?').run('processing', episodeId);
    return { created, mergeId };
  });
  const persisted = createMerge();
  if (persisted.activeMerge) return activeMergeResponse(persisted.activeMerge, episodeId);
  const { created, mergeId } = persisted;
  try {
    scheduleLegacyAsync(
      log,
      'episode_video_merge',
      () => videoMergeService.processVideoMerge(db, log, mergeId, baseUrl),
      { merge_id: mergeId, episode_id: Number(episodeId) }
    );
  } catch (error) {
    const now = new Date().toISOString();
    const failUnscheduledMerge = db.transaction(() => {
      const userError = require('./providerErrorSanitizer').toUserFacingProcessError(error, '视频合成任务创建失败，请稍后重试');
      db.prepare(
        `UPDATE video_merges
            SET status = 'failed', completed_at = ?, error_msg = ?
          WHERE id = ?`
      ).run(now, userError.slice(0, 4000), mergeId);
      require('./taskService').updateTaskError(db, created.task_id, userError);
      db.prepare(
        `UPDATE episodes
            SET status = ?, video_url = ?, updated_at = ?
          WHERE id = ?
            AND ? = (SELECT id FROM video_merges WHERE episode_id = ? ORDER BY id DESC LIMIT 1)`
      ).run(ep.status, ep.video_url, ep.updated_at, episodeId, mergeId, episodeId);
    });
    failUnscheduledMerge();
    throw error;
  }
  return {
    message: '视频合成任务已创建，正在后台处理',
    merge_id: mergeId,
    episode_id: episodeId,
    scenes_count: scenes.length,
    task_id: created.task_id,
  };
}

module.exports = {
  assertDramaWritable,
  assertTaskResourceWritable,
  createDrama,
  getDrama,
  getDramaById,
  listDramas,
  listTrashedDramas,
  updateDrama,
  moveDramaToTrash: dramaRecycle.moveDramaToTrash,
  recoverInterruptedTrashOperations: dramaRecycle.recoverInterruptedTrashOperations,
  restoreDrama: dramaRecycle.restoreDrama,
  getTrashRetentionPolicy,
  getDramaStats,
  saveOutline,
  getCharacters,
  saveCharacters,
  saveEpisodes,
  saveProgress,
  saveCanvasLayout,
  finalizeEpisode,
  downloadEpisodeVideo,
  generateStoryboard,
};
