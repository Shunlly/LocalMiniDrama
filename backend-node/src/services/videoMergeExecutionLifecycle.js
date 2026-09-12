'use strict';

/**
 * 视频合成执行生命周期：任务取消、失败收口、暂存发布与剧集状态写入。
 */

const path = require('path');
const fs = require('fs');
const uploadService = require('./uploadService');
const { finishOperation } = require('./operationRegistry');
const {
  operationCancelledError,
  throwIfAborted,
} = require('./videoMergeErrors');
const { removeFileIfPresent } = require('./videoMergeProcess');

function updateCurrentMergeEpisodeStatus(db, mergeId, episodeId, status, now) {
  return db.prepare(
    `UPDATE episodes
        SET status = ?, updated_at = ?
      WHERE id = ?
        AND ? = (
          SELECT id
            FROM video_merges
           WHERE episode_id = ?
           ORDER BY id DESC
           LIMIT 1
        )`
  ).run(status, now, episodeId, mergeId, episodeId);
}

function updateCurrentMergeEpisodeOutput(db, mergeId, episodeId, videoUrl, status, now) {
  return db.prepare(
    `UPDATE episodes
        SET video_url = ?, status = ?, updated_at = ?
      WHERE id = ?
        AND ? = (
          SELECT id
            FROM video_merges
           WHERE episode_id = ?
           ORDER BY id DESC
           LIMIT 1
        )`
  ).run(videoUrl, status, now, episodeId, mergeId, episodeId);
}

function createMergeExecution(log, row, externalSignal) {
  const taskService = require('./taskService');
  const controller = new AbortController();
  const generatedFiles = new Set();
  const temporaryDirectories = new Set();
  const pendingPublications = new Set();
  let stoppedResolve;
  let stopped = false;
  let cancellationPromise = null;
  const stoppedPromise = new Promise((resolve) => { stoppedResolve = resolve; });
  const forwardAbort = () => {
    if (!controller.signal.aborted) controller.abort(operationCancelledError(externalSignal?.reason));
  };
  if (externalSignal?.aborted) forwardAbort();
  else externalSignal?.addEventListener('abort', forwardAbort, { once: true });

  const cleanup = () => {
    for (const publication of pendingPublications) publication.rollback();
    pendingPublications.clear();
    for (const filePath of generatedFiles) removeFileIfPresent(filePath);
    for (const directory of temporaryDirectories) {
      try { fs.rmSync(directory, { recursive: true, force: true }); } catch (_) {}
    }
  };
  const finish = () => {
    if (stopped) return;
    stopped = true;
    externalSignal?.removeEventListener('abort', forwardAbort);
    cleanup();
    finishOperation('task', row.task_id);
    stoppedResolve();
  };
  const cancel = () => {
    if (cancellationPromise) return cancellationPromise;
    cancellationPromise = (async () => {
      if (!controller.signal.aborted) controller.abort(operationCancelledError());
      await stoppedPromise;
      cleanup();
      log.info('Video merge worker stopped for cancellation', { merge_id: row.id, task_id: row.task_id });
      return { outcome: 'confirmed', confirmed: true };
    })();
    return cancellationPromise;
  };

  taskService.ensureTaskOperation(row.task_id);
  taskService.registerRemoteCancel(row.task_id, cancel);
  return {
    signal: controller.signal,
    cancel,
    finish,
    trackPublication(publication) { if (publication) pendingPublications.add(publication); },
    commitPublication(publication) {
      if (!publication) return;
      publication.commit();
      pendingPublications.delete(publication);
    },
    rollbackPublication(publication) {
      if (!publication) return;
      publication.rollback();
      pendingPublications.delete(publication);
    },
    keepFile(filePath) { generatedFiles.delete(path.resolve(filePath)); },
    trackFile(filePath) { if (filePath) generatedFiles.add(path.resolve(filePath)); },
    trackDirectory(directory) { if (directory) temporaryDirectories.add(path.resolve(directory)); },
  };
}

function settleCancelledMergeBeforeWorker(db, log, row) {
  const taskService = require('./taskService');
  const task = taskService.getTask(db, row.task_id);
  if (task?.status !== 'cancelled') return false;

  const cancelledAt = task.completed_at || new Date().toISOString();
  const settled = db.transaction(() => {
    const mergeUpdate = db.prepare(
      `UPDATE video_merges
          SET status = 'cancelled', merged_url = NULL, duration = NULL, completed_at = ?, error_msg = ?
        WHERE id = ? AND status IN ('pending', 'processing')`
    ).run(cancelledAt, task.error || '用户已取消', row.id);
    const currentMerge = db.prepare('SELECT status FROM video_merges WHERE id = ?').get(row.id);
    if (mergeUpdate.changes === 1) {
      updateCurrentMergeEpisodeStatus(db, row.id, row.episode_id, 'draft', cancelledAt);
      return true;
    }
    if (currentMerge?.status === 'cancelled') {
      updateCurrentMergeEpisodeStatus(db, row.id, row.episode_id, 'draft', cancelledAt);
      return true;
    }
    return false;
  })();
  if (settled) {
    log.info('Video merge cancelled before worker registration', { merge_id: row.id, task_id: row.task_id });
  }
  return settled;
}

async function settleCancelledMergeAfterWorker(db, log, row, execution) {
  const taskService = require('./taskService');
  await execution.cancel();
  const pendingTask = taskService.getTask(db, row.task_id);
  const cancellation = await taskService.cancelTask(
    db,
    log,
    row.task_id,
    pendingTask?.error || '用户已取消'
  );
  const task = taskService.getTask(db, row.task_id);
  if (!cancellation.ok && task?.status !== 'cancelled') {
    throw new Error(cancellation.error || '视频合成取消终态提交失败');
  }
  if (task?.status !== 'cancelled') {
    throw new Error('视频合成任务未进入取消终态');
  }

  const cancelledAt = task.completed_at || new Date().toISOString();
  db.transaction(() => {
    const mergeUpdate = db.prepare(
      `UPDATE video_merges
          SET status = 'cancelled', merged_url = NULL, duration = NULL, completed_at = ?, error_msg = ?
        WHERE id = ? AND task_id = ? AND status = 'cancelled'`
    ).run(cancelledAt, task.error || '用户已取消', row.id, row.task_id);
    if (mergeUpdate.changes !== 1) {
      throw new Error('视频合成业务记录未与取消任务终态保持一致');
    }
    updateCurrentMergeEpisodeStatus(db, row.id, row.episode_id, 'draft', cancelledAt);
  })();
  return cancellation;
}

function commitMergeFailure(db, row, message, signal) {
  const now = new Date().toISOString();
  const errorMessage = String(message || '视频合成失败').slice(0, 4000);
  const taskService = require('./taskService');
  db.transaction(() => {
    throwIfAborted(signal);
    const task = taskService.getTask(db, row.task_id);
    if (!task || ['cancelling', 'cancelled', 'completed'].includes(task.status)) {
      throw operationCancelledError(task?.error || '合成任务不再接受失败终态');
    }
    const mergeUpdate = db.prepare(
      `UPDATE video_merges
          SET status = 'failed', merged_url = NULL, duration = NULL, completed_at = ?, error_msg = ?
        WHERE id = ? AND status IN ('pending', 'processing')`
    ).run(now, errorMessage, row.id);
    if (mergeUpdate.changes !== 1) throw operationCancelledError('视频合成业务记录不再处于活动状态');
    updateCurrentMergeEpisodeStatus(db, row.id, row.episode_id, 'failed', now);
    if (task.status !== 'failed' && !taskService.updateTaskError(db, row.task_id, errorMessage)) {
      throw operationCancelledError('视频合成任务不再接受失败终态');
    }
  })();
  return errorMessage;
}

function publishMergeOutput(stagedPath, finalPath, signal, execution) {
  throwIfAborted(signal);
  let publication = null;
  try {
    publication = uploadService.publishStagedFile(stagedPath, finalPath);
    execution.trackPublication(publication);
    // rename 前后的取消都必须回滚，不能把尚未入库的文件留在可服务路径。
    throwIfAborted(signal);
    return publication;
  } catch (error) {
    execution.rollbackPublication(publication);
    throw error;
  }
}

function persistMergeOutputAndCommitPublications(execution, publications, persist) {
  persist();
  for (const publication of publications) {
    if (!publication) continue;
    try {
      execution.commitPublication(publication);
    } catch (_) {
      // 数据库已提交且最终文件已就位。丢掉备份失败不能再 rollback。
    }
  }
}

module.exports = {
  updateCurrentMergeEpisodeStatus,
  updateCurrentMergeEpisodeOutput,
  createMergeExecution,
  settleCancelledMergeBeforeWorker,
  settleCancelledMergeAfterWorker,
  commitMergeFailure,
  publishMergeOutput,
  persistMergeOutputAndCommitPublications,
};
