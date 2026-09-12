/**
 * 视频生成执行：轮询收口、成功提交与失败持久化。
 * 下载与像素归一化见 videoServiceProcessNormalize.js。
 * 创建/删除入口仍在 videoService.js；路由仍通过 videoService 调用，本模块不改变公开 API。
 * 即梦同步协议的短路仍在 videoClient.pollVideoTask，本模块不得改为强制轮询。
 */

const fs = require('fs');
const path = require('path');
const videoClient = require('./videoClient');
const { toUserFacingProcessError, isUserFacingAbort, isTimeoutLikeError } = require('./providerErrorSanitizer');
const taskService = require('./taskService');
const storageLayout = require('./storageLayout');
const uploadService = require('./uploadService');
const { createVideoProviderTaskHelpers } = require('./videoServiceProviderTasks');
const { createVideoServiceProcessNormalize } = require('./videoServiceProcessNormalize');

function createVideoServiceProcess({ providerMessages, processMessages }) {
  function resolveRemoteVideoUrl(videoUrl, fallbackError) {
    if (videoUrl && videoClient.isPlausibleHttpVideoUrl(videoUrl)) {
      return { ok: true, video_url: String(videoUrl).trim() };
    }
    if (videoUrl) {
      return { ok: false, error: (fallbackError || String(videoUrl)).slice(0, 500) };
    }
    return { ok: false, error: (fallbackError || '视频生成失败').slice(0, 500) };
  }

  /** 将 video_generations 标为失败；若无 error_msg 列则只更新 status/updated_at */
  function setVideoGenFailed(db, videoGenId, errorMsg, now) {
    try {
      db.prepare('UPDATE video_generations SET status = ?, error_msg = ?, updated_at = ? WHERE id = ?').run(
        'failed', (errorMsg || '').slice(0, 500), now, videoGenId
      );
    } catch (e) {
      if ((e.message || '').includes('error_msg')) {
        db.prepare('UPDATE video_generations SET status = ?, updated_at = ? WHERE id = ?').run('failed', now, videoGenId);
      } else throw e;
    }
  }

  function isTimeoutError(error) {
    if (!error || typeof error !== 'object') return false;
    if (error.isTimeout === true || error.name === 'TimeoutError') return true;
    const code = String(error.code || '');
    return code === 'ETIMEDOUT' || code === 'ECONNABORTED' || code === 'TIMEOUT';
  }

  function isTaskCancellation(error, signal) {
    return isUserFacingAbort(error, signal);
  }

  function runVideoTaskMutation(db, row, signal, mutation) {
    if (row.task_id) return taskService.runTaskMutation(db, row.task_id, signal, mutation);
    if (signal?.aborted) throw signal.reason;
    return db.transaction(mutation)();
  }

  async function persistVideoFailure(db, row, errorMessage) {
    const message = toUserFacingProcessError(errorMessage, '视频生成失败').slice(0, 500);
    if (!row.task_id) {
      const now = new Date().toISOString();
      db.transaction(() => setVideoGenFailed(db, row.id, message, now))();
      return true;
    }
    return taskService.failTaskAfterCancellationDecision(db, row.task_id, message, (now) => {
      setVideoGenFailed(db, row.id, message, now);
    });
  }

  function waitForAbortable(promise, signal) {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
      Promise.resolve(promise).then(resolve, reject).finally(() => {
        signal.removeEventListener('abort', onAbort);
      });
    });
  }

  const {
    resolveVideosDir,
    downloadVideoToLocal,
    removeUncommittedVideo,
    normalizeVideoFileToTargetPixels,
    maybeNormalizeVideoAfterDownload,
  } = createVideoServiceProcessNormalize({
    isTaskCancellation,
    uploadService,
    fs,
  });

  /** 防止同一 videoGenId 重复发起 poll（含重启恢复） */
  const activeVideoPolls = new Set();

  function resolveStoragePath(cfg) {
    return path.isAbsolute(cfg.storage?.local_path)
      ? cfg.storage.local_path
      : path.join(process.cwd(), cfg.storage?.local_path || './data/storage');
  }

  function persistCompletedVideo(db, videoGenId, row, videoUrl, localPath, now) {
    const persist = db.transaction(() => {
      try {
        db.prepare(
          'UPDATE video_generations SET status = ?, video_url = ?, local_path = ?, completed_at = ?, updated_at = ? WHERE id = ?'
        ).run('completed', videoUrl, localPath, now, now, videoGenId);
      } catch (e) {
        if ((e.message || '').includes('completed_at')) {
          db.prepare(
            'UPDATE video_generations SET status = ?, video_url = ?, local_path = ?, updated_at = ? WHERE id = ?'
          ).run('completed', videoUrl, localPath, now, videoGenId);
        } else throw e;
      }
      if (row.storyboard_id) {
        db.prepare(
          'UPDATE storyboards SET video_url = ?, video_local_path = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
        ).run(videoUrl, localPath, now, row.storyboard_id);
      }
    });
    persist();
  }

  async function finalizeSuccessfulVideo(
    db,
    log,
    videoGenId,
    row,
    rowForAspect,
    videoUrl,
    logLabel,
    providerConfig,
    signal
  ) {
    if (row.task_id) {
      await taskService.waitForTaskCancellationDecision(db, row.task_id, signal);
    }
    const now = new Date().toISOString();
    const providerEnabled = providerConfig?.is_active === true
      || providerConfig?.is_active === 1
      || providerConfig?.is_active === '1';
    const trustedOrigins = providerEnabled ? [providerConfig?.base_url].filter(Boolean) : [];
    const validatedVideo = await uploadService.validatePublicHttpUrl(videoUrl, { trustedOrigins });
    if (row.task_id) {
      await taskService.waitForTaskCancellationDecision(db, row.task_id, signal);
    }
    videoUrl = validatedVideo.url;
    let localPath = null;
    let storagePath = null;
    try {
      const cfg = require('../config').loadConfig();
      storagePath = resolveStoragePath(cfg);
      const projectSubdir = storageLayout.getProjectStorageSubdir(db, row.drama_id);
      localPath = await downloadVideoToLocal(storagePath, videoUrl, videoGenId, log, projectSubdir, {
        trustedOrigins,
        signal,
      });
      if (row.task_id) {
        await taskService.waitForTaskCancellationDecision(db, row.task_id, signal);
      }
      maybeNormalizeVideoAfterDownload(storagePath, localPath, rowForAspect, videoGenId, log);
    } catch (error) {
      if (isTimeoutLikeError(error) || isTimeoutLikeError(signal && signal.reason)) {
        removeUncommittedVideo(storagePath, localPath, videoGenId, log);
        await persistVideoFailure(db, { ...row, id: videoGenId }, error);
        return;
      }
      if (isTaskCancellation(error, signal)) {
        removeUncommittedVideo(storagePath, localPath, videoGenId, log);
        throw error;
      }
      removeUncommittedVideo(storagePath, localPath, videoGenId, log);
      await persistVideoFailure(db, { ...row, id: videoGenId }, error);
      return;
    }
    if (!localPath) {
      await persistVideoFailure(db, { ...row, id: videoGenId }, '视频文件下载失败，请稍后重试');
      return;
    }
    try {
      runVideoTaskMutation(db, row, signal, () => {
        persistCompletedVideo(db, videoGenId, row, videoUrl, localPath, now);
        if (row.task_id) {
          taskService.updateTaskResult(db, row.task_id, {
            video_generation_id: videoGenId,
            video_url: videoUrl,
            status: 'completed',
          });
        }
      });
    } catch (error) {
      removeUncommittedVideo(storagePath, localPath, videoGenId, log);
      throw error;
    }
    if (row.storyboard_id) {
      log.info('Updated storyboard video' + (logLabel ? ` (${logLabel})` : ''), {
        storyboard_id: row.storyboard_id,
        video_url: videoUrl,
        video_local_path: localPath,
      });
    }
    log.info('Video generation completed' + (logLabel ? ` (${logLabel})` : ''), {
      id: videoGenId,
      video_url: videoUrl,
      local_path: localPath,
    });
  }

  async function pollProviderTaskAndFinalize(
    db,
    log,
    videoGenId,
    row,
    rowForAspect,
    providerTaskId,
    config,
    signal
  ) {
    const cfg = require('../config').loadConfig();
    const POLL_INTERVAL_MS = 10000;
    const { resolveVideoGenerationTimeoutMinutes } = require('../config/videoGeneration');
    const generationTimeoutMinutes = resolveVideoGenerationTimeoutMinutes(cfg);
    const pollMaxAttempts = Math.max(
      1,
      Math.ceil((generationTimeoutMinutes * 60 * 1000) / POLL_INTERVAL_MS)
    );
    const pollResult = await waitForAbortable(videoClient.pollVideoTask(
      db,
      log,
      videoGenId,
      providerTaskId,
      config,
      pollMaxAttempts,
      POLL_INTERVAL_MS,
      signal
    ), signal);
    if (row.task_id) {
      await taskService.waitForTaskCancellationDecision(db, row.task_id, signal);
    }
    const now = new Date().toISOString();
    const polledVideo = resolveRemoteVideoUrl(pollResult.video_url, pollResult.error);
    if (polledVideo.ok) {
      await finalizeSuccessfulVideo(
        db, log, videoGenId, row, rowForAspect, polledVideo.video_url, 'after poll', config, signal
      );
    } else {
      runVideoTaskMutation(db, row, signal, () => {
        setVideoGenFailed(db, videoGenId, polledVideo.error, now);
        if (row.task_id) taskService.updateTaskError(db, row.task_id, polledVideo.error);
      });
      log.error('Video generation failed (after poll)', { id: videoGenId, error: polledVideo.error });
    }
  }

  async function processVideoGeneration(db, log, videoGenId, options = {}) {
    if (activeVideoPolls.has(videoGenId)) {
      log.info('Video generation already in progress, skip duplicate', { videoGenId });
      return;
    }
    activeVideoPolls.add(videoGenId);
    log.info('processVideoGeneration started', { videoGenId });
    const row = db.prepare('SELECT * FROM video_generations WHERE id = ? AND deleted_at IS NULL').get(Number(videoGenId));
    if (!row) {
      activeVideoPolls.delete(videoGenId);
      log.error('Video generation not found', { id: videoGenId });
      return;
    }
    const now = new Date().toISOString();
    const operation = row.task_id ? taskService.ensureTaskOperation(row.task_id) : null;
    const signal = operation?.signal || options.signal;
    if (operation) operation.markRemoteCancelPending();
    const registerRemoteCancel = (remoteCancel) => {
      if (typeof remoteCancel !== 'function') return;
      if (row.task_id) taskService.registerRemoteCancel(row.task_id, remoteCancel);
      options.register_remote_cancel?.(remoteCancel);
    };
    try {
      runVideoTaskMutation(db, row, signal, () => {
        db.prepare('UPDATE video_generations SET status = ?, updated_at = ? WHERE id = ?')
          .run('processing', now, videoGenId);
      });
      const loadConfig = require('../config').loadConfig;
      const cfg = loadConfig();
      const filesBaseUrl = (cfg.storage && cfg.storage.base_url) ? String(cfg.storage.base_url).replace(/\/$/, '') : '';
      const storageLocalPath = path.isAbsolute(cfg.storage?.local_path)
        ? cfg.storage.local_path
        : path.join(process.cwd(), cfg.storage?.local_path || './data/storage');
      const config = videoClient.getDefaultVideoConfig(db, row.model, row.provider);
      if (!config) {
        setVideoGenFailed(db, videoGenId, '未配置视频模型', now);
        if (row.task_id) taskService.updateTaskError(db, row.task_id, '未配置视频模型');
        return;
      }
      let reference_urls = null;
      if (row.reference_image_urls) {
        try {
          reference_urls = JSON.parse(row.reference_image_urls);
          if (!Array.isArray(reference_urls)) reference_urls = null;
        } catch (_) {}
      }
      // 优先使用分镜自身的镜头时长（storyboard.duration），其次用 video_generations.duration
      let effectiveDuration = row.duration || null;
      if (row.storyboard_id) {
        const sb = db.prepare('SELECT duration FROM storyboards WHERE id = ?').get(row.storyboard_id);
        if (sb && sb.duration > 0) {
          effectiveDuration = sb.duration;
          log.info('使用分镜镜头时长', { storyboard_id: row.storyboard_id, duration: effectiveDuration, video_gen_id: videoGenId });
        }
      }
      let aspectForVideo = row.aspect_ratio;
      if (aspectForVideo) {
        const n = videoClient.normalizeAspectRatioForApi(aspectForVideo);
        if (n) aspectForVideo = n;
      }
      if (!aspectForVideo && row.drama_id) {
        try {
          const dramaRow = db.prepare('SELECT metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(row.drama_id);
          if (dramaRow && dramaRow.metadata) {
            const meta =
              typeof dramaRow.metadata === 'string' ? JSON.parse(dramaRow.metadata) : dramaRow.metadata;
            if (meta && meta.aspect_ratio) {
              aspectForVideo = videoClient.normalizeAspectRatioForApi(meta.aspect_ratio);
            }
          }
        } catch (_) {}
      }
      const rowForAspect = { ...row, aspect_ratio: aspectForVideo || row.aspect_ratio };
      const hasOmniRefs = !!(reference_urls && reference_urls.length > 0);
      if (row.task_id && hasOmniRefs) {
        taskService.updateTaskStatus(
          db,
          row.task_id,
          'processing',
          5,
          `正在上传 ${reference_urls.length} 张参考图到图床…`
        );
      }
      const result = await videoClient.callVideoApi(db, log, {
        prompt: row.prompt,
        model: row.model,
        duration: effectiveDuration,
        aspect_ratio: rowForAspect.aspect_ratio,
        resolution: row.resolution,
        seed: row.seed,
        camera_fixed: row.camera_fixed,
        watermark: row.watermark,
        provider: row.provider,
        drama_id: row.drama_id,
        storyboard_id: row.storyboard_id || undefined,
        image_url: row.image_url,
        first_frame_url: row.first_frame_url,
        last_frame_url: row.last_frame_url,
        reference_urls,
        files_base_url: filesBaseUrl,
        storage_local_path: storageLocalPath,
        video_gen_id: videoGenId,
        idempotency_key: row.idempotency_key || `video-generation-${videoGenId}`,
        signal,
        register_remote_cancel: registerRemoteCancel,
      });
      const now2 = new Date().toISOString();
      if (result.task_id) {
        // 远端创建可能与取消超时交错，先保留可对账的远端 ID，再处理取消决议。
        const compensated = await persistProviderTaskIdAndCompensateCancel(
          db, log, row, videoGenId, result.task_id, now2
        );
        if (compensated.handled) return;
      }
      if (result.error) {
        if (row.task_id) taskService.closeRemoteCancelWindow(row.task_id, { outcome: 'unsupported' });
        await persistVideoFailure(db, row, result.error);
        log.error('Video generation failed', { id: videoGenId, error: result.error });
        return;
      }
      const directVideo = resolveRemoteVideoUrl(result.video_url, result.error);
      if (result.video_url && !directVideo.ok) {
        if (row.task_id) taskService.closeRemoteCancelWindow(row.task_id, { outcome: 'unsupported' });
        await persistVideoFailure(db, row, directVideo.error);
        log.error('Video generation failed', { id: videoGenId, error: directVideo.error });
        return;
      }
      if (!directVideo.ok && !result.task_id) {
        if (row.task_id) taskService.closeRemoteCancelWindow(row.task_id, { outcome: 'unsupported' });
        await persistVideoFailure(db, row, processMessages.missingTaskOrUrl);
        return;
      }
      if (row.task_id) {
        await taskService.waitForTaskCancellationDecision(db, row.task_id, signal);
      }
      if (directVideo.ok) {
        if (row.task_id) taskService.closeRemoteCancelWindow(row.task_id, { outcome: 'unsupported' });
        await finalizeSuccessfulVideo(
          db, log, videoGenId, row, rowForAspect, directVideo.video_url, '', config, signal
        );
        return;
      }
      if (result.task_id) {
        if (row.task_id && !operation.hasRemoteCancel()) {
          taskService.closeRemoteCancelWindow(row.task_id, {
            outcome: 'failed',
            error: processMessages.missingRemoteCancel,
          });
        }
        await pollProviderTaskAndFinalize(
          db, log, videoGenId, row, rowForAspect, result.task_id, config, signal
        );
        return;
      }
    } catch (err) {
      if (isTimeoutLikeError(err) || isTimeoutLikeError(signal && signal.reason)) {
        await persistVideoFailure(db, row, err);
        log.error('Video generation timed out', { id: videoGenId, error: err.message });
        return;
      }
      if (isTaskCancellation(err, signal)) {
        log.info('Video generation cancelled; skipping late writes', { id: videoGenId });
        log.operation?.({
          operation: 'video_generation',
          phase: 'cancel',
          status: 'cancelled',
          id: videoGenId,
        });
        return;
      }
      await persistVideoFailure(db, row, err);
      log.error('Video generation error', { id: videoGenId, error: err.message });
    } finally {
      activeVideoPolls.delete(videoGenId);
    }
  }

  const {
    persistProviderTaskId,
    persistProviderTaskIdAndCompensateCancel,
    resumePollForVideoGeneration,
    resumeProcessingVideoGenerations,
  } = createVideoProviderTaskHelpers(() => ({
    messages: providerMessages,
    activeVideoPolls,
    pollProviderTaskAndFinalize,
    setVideoGenFailed,
    isTaskCancellation,
  }));

  return {
    activeVideoPolls,
    resolveRemoteVideoUrl,
    setVideoGenFailed,
    isTaskCancellation,
    persistVideoFailure,
    waitForAbortable,
    resolveVideosDir,
    downloadVideoToLocal,
    removeUncommittedVideo,
    normalizeVideoFileToTargetPixels,
    maybeNormalizeVideoAfterDownload,
    resolveStoragePath,
    persistCompletedVideo,
    finalizeSuccessfulVideo,
    pollProviderTaskAndFinalize,
    processVideoGeneration,
    persistProviderTaskId,
    persistProviderTaskIdAndCompensateCancel,
    resumePollForVideoGeneration,
    resumeProcessingVideoGenerations,
  };
}

module.exports = {
  createVideoServiceProcess,
};
