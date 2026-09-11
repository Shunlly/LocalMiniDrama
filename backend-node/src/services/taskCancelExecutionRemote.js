'use strict';

// 任务远端取消落库：不确定重试、耗尽失败、拒绝恢复、确认终态、延迟调度与操作日志。
const {
  finishOperation,
  getOperation,
} = require('./operationRegistry');
const {
  CANCEL_STATE_ATTEMPTING,
  CANCEL_STATE_RETRY_WAIT,
  CANCEL_STATE_CONFIRMED,
  CANCEL_STATE_EXHAUSTED,
  CANCEL_STATE_REJECTED,
  REMOTE_CANCEL_REJECTED_MSG,
  REMOTE_CANCEL_MISSING_ORIGINAL_STATUS_MSG,
  serializeCancelContext,
  taskCancelContext,
  taskCancelDetails,
  updateContextAfterUncertain,
} = require('./taskCancelState');
const {
  getRawTask,
  rowToTask,
} = require('./taskAssembly');
const {
  imageTaskScope,
  terminalizeOwnedVideoRecords,
  terminalizeOwnedImageRecords,
  terminalizeOwnedMergeRecords,
} = require('./taskCancelScope');
const {
  REMOTE_CANCEL_RETRY_MAX_ATTEMPTS,
  cancellationRetryJobs,
  clearCancellationRetry,
  retryDelayMs,
} = require('./taskCancelExecutionPrepare');

function nowIso() {
  return new Date().toISOString();
}

function recordUncertainCancellation(db, taskId, token, outcome) {
  const persist = db.transaction(() => {
    const row = getRawTask(db, taskId);
    if (!row || row.status !== 'cancelling' || String(row.cancel_operation_id || '') !== String(token)) {
      return { stale: true, task: row ? rowToTask(row) : null };
    }
    const attempt = Math.max(1, Number(row.cancel_attempt) || 1);
    const context = updateContextAfterUncertain(row, outcome);
    if (attempt >= REMOTE_CANCEL_RETRY_MAX_ATTEMPTS) {
      const updatedAt = nowIso();
      db.prepare(
        `UPDATE async_tasks SET cancel_context = ?, cancel_state = ?, cancel_next_retry_at = NULL, updated_at = ?
          WHERE id = ? AND status = 'cancelling' AND cancel_operation_id = ?`
      ).run(serializeCancelContext(context), CANCEL_STATE_EXHAUSTED, updatedAt, taskId, token);
      return { exhausted: true, task: rowToTask(getRawTask(db, taskId)), details: taskCancelDetails(getRawTask(db, taskId)) };
    }
    const nextRetryAt = new Date(Date.now() + retryDelayMs(attempt)).toISOString();
    const updatedAt = nowIso();
    const changed = db.prepare(
      `UPDATE async_tasks
          SET cancel_context = ?, cancel_state = ?, cancel_next_retry_at = ?, updated_at = ?
        WHERE id = ? AND status = 'cancelling' AND cancel_operation_id = ? AND cancel_state = ?`
    ).run(
      serializeCancelContext(context),
      CANCEL_STATE_RETRY_WAIT,
      nextRetryAt,
      updatedAt,
      taskId,
      token,
      CANCEL_STATE_ATTEMPTING
    );
    if (!changed.changes) {
      const current = getRawTask(db, taskId);
      return { stale: true, task: current ? rowToTask(current) : null };
    }
    return { exhausted: false, task: rowToTask(getRawTask(db, taskId)), details: taskCancelDetails(getRawTask(db, taskId)) };
  });
  return persist();
}

function failTaskAfterRemoteCancellationExhausted(db, taskId, token, message) {
  const updatedAt = nowIso();
  const persist = db.transaction(() => {
    const task = getRawTask(db, taskId);
    if (!task || task.status !== 'cancelling' || String(task.cancel_operation_id || '') !== String(token)) {
      return false;
    }
    const changed = db.prepare(
      `UPDATE async_tasks
          SET status = 'failed', error = ?, progress = 0, completed_at = ?, updated_at = ?,
              cancel_state = ?, cancel_next_retry_at = NULL
        WHERE id = ? AND status = 'cancelling' AND cancel_operation_id = ?`
    ).run(message, updatedAt, updatedAt, CANCEL_STATE_EXHAUSTED, taskId, token);
    if (!changed.changes) return false;
    const imageScope = imageTaskScope(db, task);
    terminalizeOwnedVideoRecords(db, task, message, updatedAt, 'failed');
    terminalizeOwnedImageRecords(db, task, message, updatedAt, imageScope.dramaId, 'failed');
    terminalizeOwnedMergeRecords(db, task, message, updatedAt, 'failed');
    return true;
  });
  const result = persist();
  if (result) {
    clearCancellationRetry(taskId);
    finishOperation('task', taskId);
  }
  return result;
}

function restoreAfterRemoteRejection(db, taskId, token, outcome) {
  const persist = db.transaction(() => {
    const row = getRawTask(db, taskId);
    if (!row || row.status !== 'cancelling' || String(row.cancel_operation_id || '') !== String(token)) {
      return { stale: true, task: row ? rowToTask(row) : null };
    }
    const context = taskCancelContext(row);
    const originalStatus = context?.original_status;
    const originalError = Object.prototype.hasOwnProperty.call(context || {}, 'original_error')
      ? context.original_error
      : null;
    const updatedAt = nowIso();
    if (!['pending', 'processing'].includes(originalStatus)) {
      const message = REMOTE_CANCEL_MISSING_ORIGINAL_STATUS_MSG;
      const changed = db.prepare(
        `UPDATE async_tasks SET status = 'failed', error = ?, progress = 0, completed_at = ?, updated_at = ?,
            cancel_state = ?, cancel_next_retry_at = NULL
          WHERE id = ? AND status = 'cancelling' AND cancel_operation_id = ?`
      ).run(message, updatedAt, updatedAt, CANCEL_STATE_REJECTED, taskId, token);
      if (!changed.changes) return { stale: true, task: rowToTask(getRawTask(db, taskId)) };
      terminalizeOwnedVideoRecords(db, row, message, updatedAt, 'failed');
      const imageScope = imageTaskScope(db, row);
      terminalizeOwnedImageRecords(db, row, message, updatedAt, imageScope.dramaId, 'failed');
      terminalizeOwnedMergeRecords(db, row, message, updatedAt, 'failed');
      return { failed: true, task: rowToTask(getRawTask(db, taskId)), error: message };
    }
    const changed = db.prepare(
      `UPDATE async_tasks SET status = ?, error = ?, updated_at = ?, completed_at = NULL,
          cancel_context = NULL, cancel_operation_id = NULL, cancel_state = NULL,
          cancel_attempt = 0, cancel_next_retry_at = NULL, cancel_requested_at = NULL,
          cancel_confirmed_at = NULL
        WHERE id = ? AND status = 'cancelling' AND cancel_operation_id = ?`
    ).run(originalStatus, originalError, updatedAt, taskId, token);
    if (!changed.changes) return { stale: true, task: rowToTask(getRawTask(db, taskId)) };
    return {
      failed: false,
      task: rowToTask(getRawTask(db, taskId)),
      error: outcome?.error || REMOTE_CANCEL_REJECTED_MSG,
    };
  });
  const result = persist();
  if (!result.stale) clearCancellationRetry(taskId);
  if (result.failed) finishOperation('task', taskId);
  else if (!result.stale) getOperation('task', taskId)?.resetCancellation();
  return result;
}

function confirmCancellation(db, taskId, token, reason, outcome) {
  const updatedAt = nowIso();
  const persist = db.transaction(() => {
    const row = getRawTask(db, taskId);
    if (!row || row.status !== 'cancelling' || String(row.cancel_operation_id || '') !== String(token)) {
      return { stale: true, task: row ? rowToTask(row) : null };
    }
    const context = taskCancelContext(row) || {};
    const nextContext = {
      ...context,
      last_error: null,
      last_outcome: outcome?.outcome || 'confirmed',
    };
    const changed = db.prepare(
      `UPDATE async_tasks
          SET status = 'cancelled', error = ?, progress = 0, completed_at = ?, updated_at = ?,
              cancel_context = ?, cancel_state = ?, cancel_next_retry_at = NULL, cancel_confirmed_at = ?
        WHERE id = ? AND status = 'cancelling' AND cancel_operation_id = ?`
    ).run(
      reason,
      updatedAt,
      updatedAt,
      serializeCancelContext(nextContext),
      CANCEL_STATE_CONFIRMED,
      updatedAt,
      taskId,
      token
    );
    if (!changed.changes) return { stale: true, task: rowToTask(getRawTask(db, taskId)) };
    const imageScope = imageTaskScope(db, row);
    terminalizeOwnedVideoRecords(db, row, reason, updatedAt, 'cancelled');
    terminalizeOwnedImageRecords(db, row, reason, updatedAt, imageScope.dramaId, 'cancelled');
    terminalizeOwnedMergeRecords(db, row, reason, updatedAt, 'cancelled');
    return { stale: false, task: rowToTask(getRawTask(db, taskId)) };
  });
  const result = persist();
  if (!result.stale) finishOperation('task', taskId);
  return result;
}

function scheduleRemoteCancellationRetry(db, log, taskId, token, reason) {
  const key = String(taskId);
  const row = getRawTask(db, taskId);
  if (!row || row.status !== 'cancelling' || String(row.cancel_operation_id || '') !== String(token)
      || row.cancel_state !== CANCEL_STATE_RETRY_WAIT) return false;
  const nextRetryAt = Date.parse(row.cancel_next_retry_at || '');
  const delayMs = Number.isFinite(nextRetryAt) ? Math.max(0, nextRetryAt - Date.now()) : 0;
  const existing = cancellationRetryJobs.get(key);
  if (existing && existing.token === String(token)) return true;
  const job = { token: String(token), attempt: Number(row.cancel_attempt) || 0 };
  cancellationRetryJobs.set(key, job);
  try {
    job.scheduler_job_id = require('./legacyAsyncSchedulerService').scheduleDelayedBackgroundTask(
      log,
      'task_remote_cancel_retry',
      delayMs,
      async () => {
        // 已回滚、确认或被新操作取代的延迟任务不得再触碰其旧数据库句柄。
        if (cancellationRetryJobs.get(key) !== job) return;
        try {
          const current = getRawTask(db, taskId);
          if (!current || current.status !== 'cancelling' || String(current.cancel_operation_id || '') !== job.token) return;
          if (cancellationRetryJobs.get(key) === job) cancellationRetryJobs.delete(key);
          // 延迟加载编排入口，避免远端模块与 cancelTask 形成加载期循环依赖。
          await require('./taskCancelExecution').cancelTask(db, log, taskId, reason, {
            expectedOperationId: job.token,
            backgroundRetry: true,
          });
        } catch (error) {
          log.error?.('Task remote cancellation retry failed', {
            task_id: taskId,
            attempt: job.attempt,
            error: error.message,
          });
        } finally {
          if (cancellationRetryJobs.get(key) === job) cancellationRetryJobs.delete(key);
        }
      },
      { task_id: key, attempt: job.attempt, operation_id: job.token }
    );
  } catch (error) {
    if (cancellationRetryJobs.get(key) === job) cancellationRetryJobs.delete(key);
    log.error?.('Task remote cancellation retry could not be scheduled', {
      task_id: taskId,
      attempt: job.attempt,
      error: error.message,
    });
    return false;
  }
  return true;
}

function logTaskCancelOperation(log, taskId, token, phase, extra = {}) {
  log?.operation?.({
    operation: 'task_cancel',
    operationId: token || String(taskId),
    phase,
    task_id: taskId,
    ...extra,
  });
}

module.exports = {
  recordUncertainCancellation,
  failTaskAfterRemoteCancellationExhausted,
  restoreAfterRemoteRejection,
  confirmCancellation,
  scheduleRemoteCancellationRetry,
  logTaskCancelOperation,
};
