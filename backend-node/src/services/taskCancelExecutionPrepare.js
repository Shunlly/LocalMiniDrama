'use strict';

// 任务取消准备：操作登记、请求去重、重试清理、远端需求判断、准备/升级上下文与认领尝试。
const { v4: uuidv4 } = require('uuid');
const {
  getOperation,
  registerOperation,
} = require('./operationRegistry');
const {
  CANCEL_STATE_REQUESTED,
  CANCEL_STATE_ATTEMPTING,
  CANCEL_STATE_RETRY_WAIT,
  CANCEL_STATE_EXHAUSTED,
  CANCEL_STATE_REJECTED,
  USER_CANCEL_TASK_MSG,
  REMOTE_CANCEL_SUPERSEDED_MSG,
  parseCancelContext,
  serializeCancelContext,
  taskCancelContext,
  isProjectCancelContext,
  taskCancelDetails,
  buildCancelContext,
  shouldKeepExistingProjectContext,
} = require('./taskCancelState');
const {
  getRawTask,
  rowToTask,
  resolveTaskDramaScope,
} = require('./taskAssembly');
const {
  validateVideoTaskScope,
  imageTaskScope,
  validateMergeTaskScope,
} = require('./taskCancelScope');

// 进程内取消请求与延迟重试登记，供编排层与远端调度共享，不落库。
const cancellationRequests = new Map();
const cancellationRetryJobs = new Map();
const REMOTE_CANCEL_RETRY_MAX_ATTEMPTS = 4;
const REMOTE_CANCEL_RETRY_BASE_DELAY_MS = 250;
const REMOTE_CANCEL_RETRY_MAX_DELAY_MS = 2_000;

function nowIso() {
  return new Date().toISOString();
}

function ensureTaskOperation(taskId) {
  return getOperation('task', taskId) || registerOperation({ type: 'task', id: taskId });
}

function getCancellationRequest(taskId) {
  const entry = cancellationRequests.get(String(taskId));
  return entry?.promise || entry || null;
}

function clearCancellationRetry(taskId) {
  const key = String(taskId);
  const job = cancellationRetryJobs.get(key);
  cancellationRetryJobs.delete(key);
  if (job?.scheduler_job_id) {
    require('./legacyAsyncSchedulerService').cancelBackgroundTask(job.scheduler_job_id);
  }
}

function retryDelayMs(attempt) {
  return Math.min(
    REMOTE_CANCEL_RETRY_MAX_DELAY_MS,
    REMOTE_CANCEL_RETRY_BASE_DELAY_MS * (2 ** Math.max(0, Number(attempt) - 1))
  );
}

function taskRequiresRemoteCancellation(db, task) {
  try {
    return Boolean(db.prepare(
      `SELECT 1 FROM video_generations
        WHERE task_id = ? AND deleted_at IS NULL
          AND provider_task_id IS NOT NULL AND TRIM(provider_task_id) != ''
        LIMIT 1`
    ).get(task.id));
  } catch (error) {
    if (/no such table|no such column/i.test(error?.message || '')) return false;
    throw error;
  }
}

function prepareCancellation(db, taskId, reason, options = {}) {
  const initial = getRawTask(db, taskId);
  if (!initial) return { ok: false, reason: 'not_found' };

  const currentContext = taskCancelContext(initial);
  let scope;
  try {
    scope = resolveTaskDramaScope(db, initial);
    if (!scope.skipped && options.requireReadable === true) {
      require('./dramaWriteGuard').assertDramaReadable(db, scope.dramaId);
    }
  } catch (error) {
    return {
      ok: false,
      reason: error.code === 'TASK_SCOPE_CONFLICT' ? 'task_scope_conflict' : 'drama_unreadable',
      code: error.code || 'TASK_SCOPE_CONFLICT',
      error: error.message,
      details: error.details,
      task: rowToTask(initial),
    };
  }
  const incoming = options.cancelContext || null;
  if (scope.dramaId != null) {
    const contextDramaIds = [incoming?.drama_id, currentContext?.drama_id]
      .filter((value) => value != null)
      .map((value) => Number(value));
    if (contextDramaIds.some((value) => value !== scope.dramaId)) {
      return {
        ok: false,
        reason: 'task_scope_conflict',
        error: '取消上下文项目归属与业务关联不一致，已拒绝取消',
        details: {
          task_id: initial.id,
          drama_id: scope.dramaId,
          context_drama_ids: contextDramaIds,
        },
        task: rowToTask(initial),
      };
    }
  }
  if (options.preserveOnUncertain === true
      && (!incoming || incoming.scope !== 'drama_recycle' || !incoming.recycle_operation_id)) {
    return {
      ok: false,
      reason: 'task_scope_conflict',
      error: '回收取消缺少完整项目上下文，已拒绝继续取消',
      details: { task_id: initial.id, reason: 'missing_recycle_cancel_context' },
      task: rowToTask(initial),
    };
  }
  const projectRetry = options.expectedOperationId != null;
  const allowProjectRetry = incoming?.scope === 'drama_recycle' || isProjectCancelContext(currentContext);
  const isExhaustedProject = initial.status === 'failed'
    && [CANCEL_STATE_EXHAUSTED, CANCEL_STATE_REJECTED].includes(initial.cancel_state)
    && incoming?.scope === 'drama_recycle';
  if (!projectRetry && !isExhaustedProject && ['completed', 'failed', 'cancelled'].includes(initial.status)) {
    return { ok: true, already_done: true, task: rowToTask(initial) };
  }

  const scopeConflict = validateVideoTaskScope(db, initial);
  if (scopeConflict) {
    return {
      ok: false,
      reason: 'task_scope_conflict',
      error: '视频任务归属与关联记录不一致，已拒绝取消',
      details: scopeConflict,
      task: rowToTask(initial),
    };
  }
  const imageScope = imageTaskScope(db, initial);
  if (imageScope.conflict) {
    return {
      ok: false,
      reason: 'task_scope_conflict',
      error: '图片任务归属与关联记录不一致，已拒绝取消',
      details: imageScope.conflict,
      task: rowToTask(initial),
    };
  }
  const mergeScope = validateMergeTaskScope(db, initial);
  if (mergeScope) {
    return {
      ok: false,
      reason: 'task_scope_conflict',
      error: '合成任务归属与关联记录不一致，已拒绝取消',
      details: mergeScope,
      task: rowToTask(initial),
    };
  }

  const requestedMessage = String(reason || currentContext?.reason || USER_CANCEL_TASK_MSG).trim()
    .slice(0, 2000) || USER_CANCEL_TASK_MSG;
  let result;
  const persist = db.transaction(() => {
    const row = getRawTask(db, taskId);
    if (!row) return { ok: false, reason: 'not_found' };
    const existing = taskCancelContext(row);
    if (projectRetry && String(row.cancel_operation_id || '') !== String(options.expectedOperationId)) {
      return {
        ok: false,
        reason: 'cancel_superseded',
        error: REMOTE_CANCEL_SUPERSEDED_MSG,
        task: rowToTask(row),
      };
    }
    if (['completed', 'cancelled'].includes(row.status)) {
      return { ok: true, already_done: true, task: rowToTask(row) };
    }
    if (row.status === 'failed' && !isExhaustedProject) {
      return { ok: true, already_done: true, task: rowToTask(row) };
    }

    const incomingProject = incoming?.scope === 'drama_recycle';
    const sameProjectContext = projectRetry || (
      incomingProject
      && existing?.scope === 'drama_recycle'
      && String(existing.recycle_operation_id || '') === String(incoming.recycle_operation_id || '')
    );
    const keepProject = shouldKeepExistingProjectContext(existing, incoming);
    const replaceContext = !existing
      || (incomingProject && !sameProjectContext && !keepProject);
    const token = String(row.cancel_operation_id || '') && !replaceContext
      ? String(row.cancel_operation_id)
      : uuidv4();
    const context = replaceContext
      ? buildCancelContext(null, incoming, row, requestedMessage)
      : buildCancelContext(existing, keepProject ? null : incoming, row, requestedMessage);
    const updatedAt = nowIso();
    const status = row.status === 'failed' && isExhaustedProject ? 'cancelling' : 'cancelling';
    const changed = db.prepare(
      `UPDATE async_tasks
          SET status = ?, error = ?, updated_at = ?, completed_at = CASE WHEN ? = 'cancelling' THEN NULL ELSE completed_at END,
              cancel_context = ?, cancel_operation_id = ?,
              cancel_state = CASE WHEN cancel_operation_id = ? AND cancel_state IN ('attempting', 'retry_wait') AND ? THEN cancel_state ELSE ? END,
              cancel_attempt = CASE WHEN cancel_operation_id = ? AND cancel_state IN ('attempting', 'retry_wait') AND ? THEN cancel_attempt ELSE 0 END,
              cancel_next_retry_at = CASE WHEN cancel_operation_id = ? AND cancel_state IN ('attempting', 'retry_wait') AND ? THEN cancel_next_retry_at ELSE NULL END,
              cancel_requested_at = COALESCE(cancel_requested_at, ?),
              cancel_confirmed_at = NULL
        WHERE id = ? AND deleted_at IS NULL
          AND (status IN ('pending', 'processing', 'cancelling') OR (status = 'failed' AND cancel_state IN ('exhausted', 'rejected')))`
    ).run(
      status,
      requestedMessage,
      updatedAt,
      status,
      serializeCancelContext(context),
      token,
      token,
      sameProjectContext ? 1 : 0,
      sameProjectContext ? (row.cancel_state || CANCEL_STATE_REQUESTED) : CANCEL_STATE_REQUESTED,
      token,
      sameProjectContext ? 1 : 0,
      token,
      sameProjectContext ? 1 : 0,
      updatedAt,
      taskId
    );
    if (changed.changes !== 1) {
      const current = getRawTask(db, taskId);
      if (current?.status === 'cancelling') {
        return { ok: true, task: rowToTask(current), token: current.cancel_operation_id, imageScope };
      }
      return { ok: true, already_done: true, task: current ? rowToTask(current) : null };
    }
    const current = getRawTask(db, taskId);
    result = {
      ok: true,
      task: rowToTask(current),
      token,
      imageScope,
      context: parseCancelContext(current.cancel_context),
    };
    return result;
  })();
  return persist;
}

function upgradeTaskCancellationContext(db, taskId, context = {}) {
  const row = getRawTask(db, taskId);
  if (!row) return null;
  const existing = taskCancelContext(row);
  const canUpgrade = ['pending', 'processing', 'cancelling'].includes(row.status)
    || (row.status === 'failed' && [CANCEL_STATE_EXHAUSTED, CANCEL_STATE_REJECTED].includes(row.cancel_state));
  if (!canUpgrade) return null;
  const updatedAt = nowIso();
  const nextContext = buildCancelContext(existing, context, row, context.reason || '项目移入回收站');
  const token = uuidv4();
  const result = db.prepare(
    `UPDATE async_tasks
        SET status = 'cancelling', error = ?, completed_at = NULL, updated_at = ?,
            cancel_context = ?, cancel_operation_id = ?, cancel_state = ?, cancel_attempt = 0,
            cancel_next_retry_at = NULL, cancel_requested_at = COALESCE(cancel_requested_at, ?),
            cancel_confirmed_at = NULL
      WHERE id = ? AND deleted_at IS NULL
        AND (status IN ('pending', 'processing', 'cancelling') OR (status = 'failed' AND cancel_state IN ('exhausted', 'rejected')))`
  ).run(
    context.reason || '项目移入回收站',
    updatedAt,
    serializeCancelContext(nextContext),
    token,
    CANCEL_STATE_REQUESTED,
    updatedAt,
    taskId
  );
  return result.changes === 1 ? token : null;
}

function claimCancellationAttempt(db, taskId, token) {
  const persist = db.transaction(() => {
    const row = getRawTask(db, taskId);
    if (!row || row.status !== 'cancelling' || String(row.cancel_operation_id || '') !== String(token)) {
      return { kind: 'stale', task: row ? rowToTask(row) : null };
    }
    if (row.cancel_state === CANCEL_STATE_ATTEMPTING) {
      return { kind: 'in_progress', task: rowToTask(row), details: taskCancelDetails(row) };
    }
    if (row.cancel_state === CANCEL_STATE_RETRY_WAIT) {
      const nextRetryAt = Date.parse(row.cancel_next_retry_at || '');
      if (Number.isFinite(nextRetryAt) && nextRetryAt > Date.now()) {
        return { kind: 'wait', task: rowToTask(row), details: taskCancelDetails(row) };
      }
    }
    if (row.cancel_state === CANCEL_STATE_EXHAUSTED) {
      return { kind: 'exhausted', task: rowToTask(row), details: taskCancelDetails(row) };
    }
    const attempt = Math.max(0, Number(row.cancel_attempt) || 0) + 1;
    if (attempt > REMOTE_CANCEL_RETRY_MAX_ATTEMPTS) {
      return { kind: 'exhausted', task: rowToTask(row), details: taskCancelDetails(row) };
    }
    const updatedAt = nowIso();
    const changed = db.prepare(
      `UPDATE async_tasks SET cancel_state = ?, cancel_attempt = ?, cancel_next_retry_at = NULL, updated_at = ?
        WHERE id = ? AND status = 'cancelling' AND cancel_operation_id = ?
          AND cancel_state IN (?, ?, ?)`
    ).run(
      CANCEL_STATE_ATTEMPTING,
      attempt,
      updatedAt,
      taskId,
      token,
      CANCEL_STATE_REQUESTED,
      CANCEL_STATE_RETRY_WAIT,
      CANCEL_STATE_ATTEMPTING
    );
    if (!changed.changes) {
      const current = getRawTask(db, taskId);
      return { kind: 'in_progress', task: current ? rowToTask(current) : null, details: current ? taskCancelDetails(current) : null };
    }
    return { kind: 'claimed', attempt, task: rowToTask(getRawTask(db, taskId)) };
  });
  return typeof persist.immediate === 'function' ? persist.immediate() : persist();
}

module.exports = {
  REMOTE_CANCEL_RETRY_MAX_ATTEMPTS,
  cancellationRequests,
  cancellationRetryJobs,
  ensureTaskOperation,
  getCancellationRequest,
  clearCancellationRetry,
  retryDelayMs,
  taskRequiresRemoteCancellation,
  prepareCancellation,
  upgradeTaskCancellationContext,
  claimCancellationAttempt,
};
