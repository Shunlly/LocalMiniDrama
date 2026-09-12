'use strict';

/**
 * 视频合成执行入口：规范化、生命周期与 worker 编排。
 * 公开 API 保持 normalizeMergeScenes / updateCurrentMergeEpisodeOutput / processVideoMerge。
 */

const { strictMergeError } = require('./videoMergeErrors');
const { normalizeMergeScenes } = require('./videoMergeExecutionNormalize');
const {
  createMergeExecution,
  settleCancelledMergeBeforeWorker,
  settleCancelledMergeAfterWorker,
  commitMergeFailure,
  updateCurrentMergeEpisodeOutput,
} = require('./videoMergeExecutionLifecycle');
const { processVideoMergeWorker } = require('./videoMergeExecutionWorker');

async function processVideoMerge(db, log, mergeId, baseUrl, options = {}) {
  const row = db.prepare('SELECT * FROM video_merges WHERE id = ? AND deleted_at IS NULL').get(Number(mergeId));
  if (!row) return;
  if (settleCancelledMergeBeforeWorker(db, log, row)) {
    return { ok: false, merge_id: Number(mergeId), status: 'cancelled', cancelled: true };
  }
  const execution = createMergeExecution(log, row, options.signal);
  let cancelled = false;
  try {
    return await processVideoMergeWorker(db, log, mergeId, baseUrl, execution);
  } catch (error) {
    if (execution.signal.aborted) {
      cancelled = true;
    } else if (error?.code === 'OPERATION_CANCELLED') {
      const task = require('./taskService').getTask(db, row.task_id);
      if (task?.status === 'cancelling' || task?.status === 'cancelled') {
        cancelled = true;
      } else if (task?.status === 'failed') {
        commitMergeFailure(db, row, task.error || error.message, execution.signal);
        throw strictMergeError(task.error || error.message || '合成任务已失败');
      } else {
        throw strictMergeError(error.message || '合成任务不再处于活动状态');
      }
    } else {
      throw error;
    }
  } finally {
    execution.finish();
  }
  if (cancelled) {
    await settleCancelledMergeAfterWorker(db, log, row, execution);
    return { ok: false, merge_id: Number(mergeId), status: 'cancelled', cancelled: true };
  }
}

module.exports = {
  normalizeMergeScenes,
  updateCurrentMergeEpisodeOutput,
  processVideoMerge,
};
