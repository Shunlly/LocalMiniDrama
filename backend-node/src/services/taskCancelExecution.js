'use strict';

// 从 taskService 拆出的远端取消执行编排：准备结果后认领租约、调用 Provider，再分发确认/重试/恢复。
// 准备与远端落库见 taskCancelExecutionPrepare.js / taskCancelExecutionRemote.js。
// 作用域校验与所属记录终态见 taskCancelScope.js。路由仍通过 taskService.cancelTask 进入，本模块不改变公开 API。
const {
  cancelOperation,
} = require('./operationRegistry');
const {
  USER_CANCEL_TASK_MSG,
  REMOTE_CANCEL_EXHAUSTED_MSG,
  REMOTE_CANCEL_SUPERSEDED_MSG,
  REMOTE_CANCEL_UNCERTAIN_MSG,
  REMOTE_CANCEL_WAIT_MSG,
  REMOTE_CANCEL_FAILED_MSG,
  taskCancelContext,
  isProjectCancelContext,
  isUncertainOutcome,
  userFacingRemoteCancelError,
} = require('./taskCancelState');
const {
  getRawTask,
  getTask,
} = require('./taskAssembly');
const {
  imageTaskScope,
  terminalizeOwnedVideoRecords,
  terminalizeOwnedImageRecords,
  terminalizeOwnedMergeRecords,
} = require('./taskCancelScope');
const {
  REMOTE_CANCEL_RETRY_MAX_ATTEMPTS,
  cancellationRequests,
  ensureTaskOperation,
  getCancellationRequest,
  clearCancellationRetry,
  retryDelayMs,
  taskRequiresRemoteCancellation,
  prepareCancellation,
  upgradeTaskCancellationContext,
  claimCancellationAttempt,
} = require('./taskCancelExecutionPrepare');
const {
  recordUncertainCancellation,
  failTaskAfterRemoteCancellationExhausted,
  restoreAfterRemoteRejection,
  confirmCancellation,
  scheduleRemoteCancellationRetry,
  logTaskCancelOperation,
} = require('./taskCancelExecutionRemote');

async function executeCancellation(db, log, taskId, reason, prepared, options) {
  const token = prepared.token;
  logTaskCancelOperation(log, taskId, token, 'start');
  const result = await executeCancellationAttempt(db, log, taskId, reason, prepared, options);
  if (!result?.ok) {
    logTaskCancelOperation(log, taskId, token, 'error', {
      status: result?.reason || 'failed',
      error: result?.error || result?.reason || null,
    });
  }
  return result;
}

async function executeCancellationAttempt(db, log, taskId, reason, prepared, options) {
  const persistedContext = prepared.context || taskCancelContext(getRawTask(db, taskId));
  const cancellationReason = String(reason || persistedContext?.reason || USER_CANCEL_TASK_MSG)
    .trim()
    .slice(0, 2000) || USER_CANCEL_TASK_MSG;
  const token = prepared.token;
  const claim = claimCancellationAttempt(db, taskId, token);
  if (claim.kind === 'stale') {
    return {
      ok: false,
      reason: 'cancel_superseded',
      error: REMOTE_CANCEL_SUPERSEDED_MSG,
      task: claim.task,
    };
  }
  if (claim.kind === 'in_progress' || claim.kind === 'wait') {
    const scheduled = scheduleRemoteCancellationRetry(db, log, taskId, token, cancellationReason);
    return {
      ok: false,
      reason: 'remote_cancel_uncertain',
      error: REMOTE_CANCEL_WAIT_MSG,
      retry_scheduled: scheduled,
      retry_schedule_failed: !scheduled,
      details: claim.details,
      task: claim.task,
    };
  }
  if (claim.kind === 'exhausted') {
    const context = taskCancelContext(getRawTask(db, taskId));
    if (!isProjectCancelContext(context)) {
      const failed = failTaskAfterRemoteCancellationExhausted(db, taskId, token, REMOTE_CANCEL_EXHAUSTED_MSG);
      return {
        ok: false,
        reason: 'remote_cancel_exhausted',
        error: REMOTE_CANCEL_EXHAUSTED_MSG,
        task: getTask(db, taskId),
        local_terminal_state: failed ? 'failed' : 'unchanged',
      };
    }
    return {
      ok: false,
      reason: 'remote_cancel_exhausted',
      error: REMOTE_CANCEL_EXHAUSTED_MSG,
      task: claim.task,
      details: claim.details,
    };
  }

  const task = getRawTask(db, taskId);
  if (!task) return { ok: false, reason: 'not_found' };
  const operation = ensureTaskOperation(taskId);
  if (taskRequiresRemoteCancellation(db, task) && !operation.hasRemoteCancel()) {
    // 已持久化 Provider task id 时，必须等待恢复流程重新注册远端取消，不能把缺少回调当成成功。
    operation.markRemoteCancelPending({ timeout_ms: 15_000, reset: true });
  }
  let outcome;
  try {
    outcome = await cancelOperation('task', taskId);
  } catch (error) {
    outcome = { outcome: 'failed', uncertain: true, remote_supported: true, error: error.message };
  }

  if (outcome.outcome === 'failed') {
    if (isUncertainOutcome(outcome)) {
      operation.resetCancellation();
      const recorded = recordUncertainCancellation(db, taskId, token, outcome);
      if (recorded.stale) return { ok: false, reason: 'cancel_superseded', error: REMOTE_CANCEL_SUPERSEDED_MSG, task: recorded.task };
      if (recorded.exhausted) {
        const context = taskCancelContext(getRawTask(db, taskId));
        if (isProjectCancelContext(context)) {
          return {
            ok: false,
            reason: 'remote_cancel_exhausted',
            error: REMOTE_CANCEL_EXHAUSTED_MSG,
            task: recorded.task,
            details: recorded.details,
          };
        }
        const failed = failTaskAfterRemoteCancellationExhausted(db, taskId, token, REMOTE_CANCEL_EXHAUSTED_MSG);
        return {
          ok: false,
          reason: 'remote_cancel_exhausted',
          error: REMOTE_CANCEL_EXHAUSTED_MSG,
          task: getTask(db, taskId),
          local_terminal_state: failed ? 'failed' : 'unchanged',
        };
      }
      const scheduled = scheduleRemoteCancellationRetry(db, log, taskId, token, cancellationReason);
      log.error?.('Task remote cancellation result is uncertain', {
        task_id: taskId,
        type: task.type,
        error: outcome.error,
        retry_scheduled: scheduled,
        retry_attempt: recorded.details?.attempt || 0,
      });
      return {
        ok: false,
        reason: 'remote_cancel_uncertain',
        error: userFacingRemoteCancelError(outcome, REMOTE_CANCEL_UNCERTAIN_MSG),
        outcome,
        retry_scheduled: scheduled,
        retry_schedule_failed: !scheduled,
        retries_exhausted: false,
        details: recorded.details,
        task: recorded.task,
      };
    }
    const restored = restoreAfterRemoteRejection(db, taskId, token, outcome);
    if (restored.stale) return { ok: false, reason: 'cancel_superseded', error: REMOTE_CANCEL_SUPERSEDED_MSG, task: restored.task };
    log.error?.('Task remote cancellation failed', { task_id: taskId, type: task.type, error: outcome.error });
    return {
      ok: false,
      reason: restored.failed ? 'remote_cancel_exhausted' : 'remote_cancel_failed',
      error: restored.error || userFacingRemoteCancelError(outcome, REMOTE_CANCEL_FAILED_MSG),
      outcome,
      task: restored.task,
    };
  }

  const confirmed = confirmCancellation(db, taskId, token, cancellationReason, outcome);
  if (confirmed.stale) return { ok: false, reason: 'cancel_superseded', error: REMOTE_CANCEL_SUPERSEDED_MSG, task: confirmed.task };
  clearCancellationRetry(taskId);
  log.info('Task cancelled by user', { task_id: taskId, cancel_outcome: outcome.outcome });
  log?.operation?.({
    operation: 'task_cancel',
    operationId: token || String(taskId),
    phase: 'cancel',
    status: 'cancelled',
    task_id: taskId,
    cancel_outcome: outcome.outcome,
  });
  return { ok: true, outcome, task: confirmed.task };
}

/** 用户主动取消任务。所有远端重试状态都先落库，再由唯一租约执行 Provider 调用。 */
function cancelTask(db, log, taskId, reason, options = {}) {
  let prepared;
  try {
    prepared = prepareCancellation(db, taskId, reason, options);
  } catch (error) {
    logTaskCancelOperation(log, taskId, null, 'error', {
      status: error.code || 'failed',
      error: error.message,
    });
    return Promise.reject(error);
  }
  if (!prepared.ok && !prepared.already_done) {
    logTaskCancelOperation(log, taskId, prepared.token, 'error', {
      status: prepared.reason || 'failed',
      error: prepared.error || prepared.reason || null,
    });
  }
  if (!prepared.ok || prepared.already_done) return Promise.resolve(prepared);

  const key = String(taskId);
  const existing = cancellationRequests.get(key);
  if (existing && existing.token === String(prepared.token)) return existing.promise;
  const request = (async () => {
    if (existing && existing.token !== String(prepared.token)) {
      try { await existing.promise; } catch (_) {}
    }
    return executeCancellation(db, log, taskId, reason, prepared, options);
  })();
  const entry = { token: String(prepared.token), promise: request };
  cancellationRequests.set(key, entry);
  const clear = () => {
    if (cancellationRequests.get(key) === entry) cancellationRequests.delete(key);
  };
  void request.then(clear, clear);
  return request;
}

module.exports = {
  REMOTE_CANCEL_RETRY_MAX_ATTEMPTS,
  cancelTask,
  clearCancellationRetry,
  getCancellationRequest,
  upgradeTaskCancellationContext,
  retryDelayMs,
  taskRequiresRemoteCancellation,
  imageTaskScope,
  terminalizeOwnedVideoRecords,
  terminalizeOwnedImageRecords,
  terminalizeOwnedMergeRecords,
};
