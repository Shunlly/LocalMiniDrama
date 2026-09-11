/**
 * 视频供应商任务编号：持久化、重启恢复轮询与补偿取消。
 * 路由仍通过 videoService 调用，本模块不改变公开 API。
 * 用户可见中文文案由 videoService 注入，避免只读文案扫描失效。
 */

const videoClient = require('./videoClient');
const taskService = require('./taskService');
const { scheduleLegacyAsync } = require('./legacyAsyncSchedulerService');
const { toUserFacingProcessError } = require('./providerErrorSanitizer');

function resolveTaskService(deps) {
  return deps.taskService || taskService;
}

function resolveScheduleLegacyAsync(deps) {
  return deps.scheduleLegacyAsync || scheduleLegacyAsync;
}

function resolveTimer(deps) {
  return deps.setTimeoutFn || setTimeout;
}

function localCancellationError(message) {
  const error = new Error(message);
  error.name = 'AbortError';
  error.code = 'OPERATION_CANCELLED';
  return error;
}

function createVideoProviderTaskHelpers(getDeps) {
  function persistProviderTaskId(db, row, providerTaskId, now) {
    const { messages } = getDeps();
    const persist = db.transaction(() => {
      const current = db.prepare(
        'SELECT task_id, deleted_at FROM video_generations WHERE id = ?'
      ).get(row.id);
      if (!current || current.deleted_at || String(current.task_id || '') !== String(row.task_id || '')) {
        throw new Error(messages.ownershipChanged);
      }
      const updated = db.prepare(
        `UPDATE video_generations
            SET provider_task_id = ?,
                status = CASE WHEN status IN ('pending', 'processing') THEN 'processing' ELSE status END,
                updated_at = ?
          WHERE id = ?`
      ).run(String(providerTaskId), now, row.id);
      if (updated.changes !== 1) throw new Error(messages.persistFailed);
    });
    persist();
  }

  function scheduleVideoCancellationReconciliation(db, log, videoGenId, delayMs = 2_000) {
    const timer = resolveTimer(getDeps())(() => {
      resumePollForVideoGeneration(db, log, videoGenId).catch((error) => {
        log.error('Video cancellation reconciliation failed', {
          videoGenId,
          error: error.message,
        });
      });
    }, delayMs);
    timer.unref?.();
  }

  async function persistProviderTaskIdAndCompensateCancel(
    db,
    log,
    row,
    videoGenId,
    providerTaskId,
    now
  ) {
    persistProviderTaskId(db, row, providerTaskId, now);
    const boundTaskService = resolveTaskService(getDeps());
    const currentTask = row.task_id ? boundTaskService.getTask(db, row.task_id) : null;
    if (currentTask?.status !== 'cancelling') return { handled: false };
    const { messages } = getDeps();
    const cancellation = await boundTaskService.cancelTask(
      db, log, row.task_id, currentTask.error || messages.lateCancel
    );
    if (cancellation.ok) return { handled: true };
    if (cancellation.reason === 'remote_cancel_uncertain') {
      scheduleVideoCancellationReconciliation(db, log, videoGenId);
      return { handled: true };
    }
    return { handled: false };
  }

  /**
   * 服务重启后恢复对厂商异步任务的轮询（需已持久化 provider_task_id）
   */
  async function resumePollForVideoGeneration(db, log, videoGenId) {
    const {
      messages,
      activeVideoPolls,
      pollProviderTaskAndFinalize,
      setVideoGenFailed,
      isTaskCancellation,
    } = getDeps();
    const boundTaskService = resolveTaskService(getDeps());
    if (activeVideoPolls.has(videoGenId)) {
      log.info('Video poll already active, skip resume', { videoGenId });
      return;
    }
    const row = db.prepare('SELECT * FROM video_generations WHERE id = ? AND deleted_at IS NULL').get(Number(videoGenId));
    if (!row || row.status !== 'processing') return;
    const providerTaskId = row.provider_task_id && String(row.provider_task_id).trim();
    if (!providerTaskId) return;

    const config = videoClient.getDefaultVideoConfig(db, row.model, row.provider);
    if (!config) {
      if (row.task_id) {
        await boundTaskService.failTaskAfterCancellationDecision(
          db,
          row.task_id,
          '未配置视频模型',
          (now) => setVideoGenFailed(db, videoGenId, '未配置视频模型', now)
        );
      } else {
        setVideoGenFailed(db, videoGenId, '未配置视频模型', new Date().toISOString());
      }
      return;
    }

    activeVideoPolls.add(videoGenId);
    const operation = row.task_id ? boundTaskService.ensureTaskOperation(row.task_id) : null;
    const signal = operation?.signal;
    const pollController = new AbortController();
    const forwardOperationAbort = () => {
      if (!pollController.signal.aborted) pollController.abort(signal.reason);
    };
    if (signal?.aborted) forwardOperationAbort();
    else signal?.addEventListener('abort', forwardOperationAbort, { once: true });
    const pollSignal = pollController.signal;
    const taskBeforeResume = row.task_id ? boundTaskService.getTask(db, row.task_id) : null;
    const protocol = videoClient.resolveVideoProtocol(config, row.model);
    const supportsRestoredCancellation = protocol === 'sora' || protocol === 'minimax';
    const resumedConfig = supportsRestoredCancellation && row.task_id
      ? {
          ...config,
          register_remote_cancel(remoteCancel) {
            boundTaskService.registerRemoteCancel(row.task_id, remoteCancel);
          },
        }
      : config;
    if (operation) {
      operation.markRemoteCancelPending({ timeout_ms: 15_000, reset: true });
      if (!supportsRestoredCancellation) {
        operation.closeRemoteCancelWindow({
          outcome: 'failed',
          error: messages.restartCancelUnsupported(protocol),
        });
      }
    }
    log.info('Resuming video generation poll after restart', {
      videoGenId,
      provider_task_id: providerTaskId,
    });
    try {
      let aspectForVideo = row.aspect_ratio;
      if (aspectForVideo) {
        const n = videoClient.normalizeAspectRatioForApi(aspectForVideo);
        if (n) aspectForVideo = n;
      }
      const rowForAspect = { ...row, aspect_ratio: aspectForVideo || row.aspect_ratio };
      const polling = pollProviderTaskAndFinalize(
        db, log, videoGenId, row, rowForAspect, providerTaskId, resumedConfig, pollSignal
      );
      if (taskBeforeResume?.status === 'cancelling') {
        const cancellation = await boundTaskService.cancelTask(
          db, log, row.task_id, taskBeforeResume.error || '恢复未确认的取消请求'
        );
        if (cancellation.ok) {
          await polling.catch((error) => {
            if (!isTaskCancellation(error) && !signal?.aborted) throw error;
          });
          return;
        }
        if (cancellation.reason === 'remote_cancel_uncertain') {
          log.warn('Resumed video cancellation remains uncertain; continuing reconciliation poll', {
            videoGenId,
            task_id: row.task_id,
            provider_task_id: providerTaskId,
          });
          pollController.abort(localCancellationError('远端取消结果仍不确定，等待下一轮对账'));
          await polling.catch((error) => {
            if (!isTaskCancellation(error) && !pollSignal.aborted) throw error;
          });
          scheduleVideoCancellationReconciliation(db, log, videoGenId);
          return;
        }
      }
      await polling;
    } catch (err) {
      if (isTaskCancellation(err) || signal?.aborted) {
        log.info('Video generation resume poll cancelled', { id: videoGenId });
        return;
      }
      const now = new Date().toISOString();
      const userError = toUserFacingProcessError(err, '视频生成恢复失败，请稍后重试');
      setVideoGenFailed(db, videoGenId, userError, now);
      if (row.task_id) boundTaskService.updateTaskError(db, row.task_id, userError);
      log.error('Video generation resume poll error', { id: videoGenId, error: err.message });
    } finally {
      signal?.removeEventListener('abort', forwardOperationAbort);
      activeVideoPolls.delete(videoGenId);
    }
  }

  /** 启动时恢复 processing 视频任务；无 provider_task_id 的视为中断 */
  function resumeProcessingVideoGenerations(db, log) {
    const { messages, setVideoGenFailed } = getDeps();
    const boundTaskService = resolveTaskService(getDeps());
    const schedule = resolveScheduleLegacyAsync(getDeps());
    const stuck = db
      .prepare(
        `SELECT id, task_id FROM video_generations
         WHERE status = 'processing' AND deleted_at IS NULL
           AND (provider_task_id IS NULL OR TRIM(provider_task_id) = '')`
      )
      .all();
    const stuckMsg = messages.missingOnRestart;
    for (const s of stuck) {
      const now = new Date().toISOString();
      setVideoGenFailed(db, s.id, stuckMsg, now);
      if (s.task_id) boundTaskService.updateTaskError(db, s.task_id, stuckMsg);
      log.warn('Marked interrupted video generation as failed', { videoGenId: s.id });
    }

    const resumable = db
      .prepare(
        `SELECT id FROM video_generations
         WHERE status = 'processing' AND deleted_at IS NULL
           AND provider_task_id IS NOT NULL AND TRIM(provider_task_id) != ''`
      )
      .all();
    if (resumable.length) {
      log.info('Resuming video generation polls', { count: resumable.length });
    }
    for (const r of resumable) {
      schedule(log, 'video_generation_poll_resume', () => {
        resumePollForVideoGeneration(db, log, r.id).catch((e) => {
          log.error('resumePollForVideoGeneration unhandled', { videoGenId: r.id, error: e.message });
        });
      }, { video_generation_id: r.id });
    }
  }

  return {
    persistProviderTaskId,
    persistProviderTaskIdAndCompensateCancel,
    scheduleVideoCancellationReconciliation,
    resumePollForVideoGeneration,
    resumeProcessingVideoGenerations,
  };
}

module.exports = {
  createVideoProviderTaskHelpers,
};
