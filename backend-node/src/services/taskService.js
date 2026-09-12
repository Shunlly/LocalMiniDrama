// 异步任务服务：创建、状态更新、取消编排与启动收敛。
// 取消状态、查询装配与远端取消执行分别位于 taskCancelState.js / taskAssembly.js / taskCancelExecution.js。
const { v4: uuidv4 } = require('uuid');
const {
  createOperationCancelledError,
  finishOperation,
  getOperation,
  registerOperation,
} = require('./operationRegistry');
const {
  CANCEL_STATE_CONFIRMED,
  CANCEL_STATE_EXHAUSTED,
  USER_CANCEL_TASK_MSG,
  REMOTE_CANCEL_EXHAUSTED_MSG,
  taskCancelContext,
} = require('./taskCancelState');
const {
  getRawTask,
  rowToTask,
  resolveTaskDramaScope,
  getTask,
  getTasksByResource,
} = require('./taskAssembly');
const {
  REMOTE_CANCEL_RETRY_MAX_ATTEMPTS,
  cancelTask,
  clearCancellationRetry,
  getCancellationRequest,
  upgradeTaskCancellationContext,
  imageTaskScope,
  terminalizeOwnedVideoRecords,
  terminalizeOwnedImageRecords,
  terminalizeOwnedMergeRecords,
} = require('./taskCancelExecution');

function nowIso() {
  return new Date().toISOString();
}

function createTask(db, log, taskType, resourceId) {
  const id = uuidv4();
  const createdAt = nowIso();
  const wasInTransaction = Boolean(db.inTransaction);
  const persist = () => {
    require('./dramaService').assertTaskResourceWritable(db, taskType, resourceId);
    db.prepare(
      `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at)
       VALUES (?, ?, 'pending', 0, '', ?, ?, ?)`
    ).run(id, taskType, resourceId || '', createdAt, createdAt);
    return rowToTask(getRawTask(db, id));
  };
  let task;
  if (wasInTransaction) {
    task = persist();
  } else {
    const transaction = db.transaction(persist);
    task = typeof transaction.immediate === 'function' ? transaction.immediate() : transaction();
  }
  // 外层事务仍可能回滚，只有已经提交的独立创建才注册内存操作。
  if (!wasInTransaction) registerOperation({ type: 'task', id });
  log.info('Task created', { task_id: id, type: taskType, resource_id: resourceId });
  return task || {
    id,
    type: taskType,
    status: 'pending',
    progress: 0,
    message: '',
    resource_id: resourceId || '',
    created_at: createdAt,
    updated_at: createdAt,
    completed_at: null,
  };
}
function updateTaskStatus(db, taskId, status, progress, message) {
  const updatedAt = nowIso();
  const completedAt = status === 'completed' || status === 'failed' ? updatedAt : null;
  const result = db.prepare(
    `UPDATE async_tasks
        SET status = ?, progress = ?, message = ?, updated_at = ?, completed_at = ?,
            cancel_context = CASE WHEN ? IN ('completed', 'failed') THEN NULL ELSE cancel_context END,
            cancel_operation_id = CASE WHEN ? IN ('completed', 'failed') THEN NULL ELSE cancel_operation_id END,
            cancel_state = CASE WHEN ? IN ('completed', 'failed') THEN NULL ELSE cancel_state END,
            cancel_attempt = CASE WHEN ? IN ('completed', 'failed') THEN 0 ELSE cancel_attempt END,
            cancel_next_retry_at = CASE WHEN ? IN ('completed', 'failed') THEN NULL ELSE cancel_next_retry_at END,
            cancel_requested_at = CASE WHEN ? IN ('completed', 'failed') THEN NULL ELSE cancel_requested_at END,
            cancel_confirmed_at = CASE WHEN ? IN ('completed', 'failed') THEN NULL ELSE cancel_confirmed_at END
      WHERE id = ? AND status IN ('pending', 'processing')`
  ).run(
    status,
    progress ?? 0,
    message || '',
    updatedAt,
    completedAt,
    status,
    status,
    status,
    status,
    status,
    status,
    status,
    taskId
  );
  if (result.changes > 0 && (status === 'completed' || status === 'failed')) finishOperation('task', taskId);
  return result.changes > 0;
}

function updateTaskError(db, taskId, errMsg) {
  const updatedAt = nowIso();
  const result = db.prepare(
    `UPDATE async_tasks
        SET status = 'failed', error = ?, progress = 0, completed_at = ?, updated_at = ?,
            cancel_context = NULL, cancel_operation_id = NULL, cancel_state = NULL,
            cancel_attempt = 0, cancel_next_retry_at = NULL,
            cancel_requested_at = NULL, cancel_confirmed_at = NULL
      WHERE id = ? AND status IN ('pending', 'processing')`
  ).run(errMsg || '', updatedAt, updatedAt, taskId);
  if (result.changes > 0) finishOperation('task', taskId);
  return result.changes > 0;
}

function updateTaskResult(db, taskId, result) {
  const updatedAt = nowIso();
  const resultStr = typeof result === 'string' ? result : JSON.stringify(result || {});
  const update = db.prepare(
    `UPDATE async_tasks
        SET status = 'completed', progress = 100, result = ?, completed_at = ?, updated_at = ?,
            cancel_context = NULL, cancel_operation_id = NULL, cancel_state = NULL,
            cancel_attempt = 0, cancel_next_retry_at = NULL,
            cancel_requested_at = NULL, cancel_confirmed_at = NULL
      WHERE id = ? AND status IN ('pending', 'processing')`
  ).run(resultStr, updatedAt, updatedAt, taskId);
  if (update.changes > 0) finishOperation('task', taskId);
  return update.changes > 0;
}

function refreshCompletedTaskResult(db, taskId, result) {
  const updatedAt = nowIso();
  const resultStr = typeof result === 'string' ? result : JSON.stringify(result || {});
  const update = db.prepare(
    `UPDATE async_tasks SET result = ?, updated_at = ?
      WHERE id = ? AND status = 'completed'`
  ).run(resultStr, updatedAt, taskId);
  return update.changes > 0;
}
function ensureTaskOperation(taskId) {
  return getOperation('task', taskId) || registerOperation({ type: 'task', id: taskId });
}

function markRemoteCancelPending(taskId, options = {}) {
  return ensureTaskOperation(taskId).markRemoteCancelPending(options);
}

function registerRemoteCancel(taskId, remoteCancel) {
  return ensureTaskOperation(taskId).setRemoteCancel(remoteCancel);
}

function closeRemoteCancelWindow(taskId, result) {
  return getOperation('task', taskId)?.closeRemoteCancelWindow(result);
}

function throwIfTaskInactive(db, taskId, signal) {
  if (signal?.aborted) throw createOperationCancelledError(signal.reason);
  const task = getTask(db, taskId);
  if (task && (task.status === 'pending' || task.status === 'processing')) return task;
  throw createOperationCancelledError(task?.error || '任务不再处于活动状态');
}

function runTaskMutation(db, taskId, signal, mutation) {
  const persist = db.transaction(() => {
    throwIfTaskInactive(db, taskId, signal);
    return mutation();
  });
  return persist();
}

async function waitForTaskCancellationDecision(db, taskId, signal) {
  const request = getCancellationRequest(taskId);
  if (request) await request;
  return throwIfTaskInactive(db, taskId, signal);
}

async function failTaskAfterCancellationDecision(db, taskId, errMsg, mutation) {
  const request = getCancellationRequest(taskId);
  if (request) await request;
  const updatedAt = nowIso();
  let changed = false;
  const persist = db.transaction(() => {
    const task = getRawTask(db, taskId);
    if (!task || !['pending', 'processing', 'cancelling'].includes(task.status)) return false;
    mutation?.(updatedAt);
    const context = taskCancelContext(task);
    const result = db.prepare(
      `UPDATE async_tasks
          SET status = 'failed', error = ?, progress = 0, completed_at = ?, updated_at = ?,
              cancel_state = CASE WHEN status = 'cancelling' AND cancel_operation_id IS NOT NULL THEN ? ELSE NULL END,
              cancel_next_retry_at = NULL,
              cancel_confirmed_at = CASE WHEN status = 'cancelling' AND cancel_operation_id IS NOT NULL THEN ? ELSE NULL END
        WHERE id = ? AND status = ?`
    ).run(
      String(errMsg || '任务失败').slice(0, 2000),
      updatedAt,
      updatedAt,
      context ? CANCEL_STATE_CONFIRMED : null,
      context ? updatedAt : null,
      taskId,
      task.status
    );
    if (result.changes !== 1) throw new Error('任务失败终态提交发生并发冲突');
    changed = true;
    return true;
  })();
  if (persist && changed) finishOperation('task', taskId);
  return persist;
}

const ORPHAN_ASYNC_TASK_MSG = '服务重启后任务中断，请重新操作';

function listOrphanRows(db) {
  try {
    return db.prepare(
      `SELECT task.id, task.type, task.status, task.resource_id
         FROM async_tasks task
        WHERE task.status IN ('pending', 'processing', 'cancelling')
          AND task.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM video_generations video
             WHERE video.task_id = task.id AND video.deleted_at IS NULL
               AND video.provider_task_id IS NOT NULL AND TRIM(video.provider_task_id) != ''
          )`
    ).all();
  } catch (error) {
    if (/no such table/i.test(error?.message || '')) return [];
    if (/no such column/i.test(error?.message || '')) {
      return db.prepare(
        `SELECT task.id, task.type, task.status, task.resource_id
           FROM async_tasks task
          WHERE task.status IN ('pending', 'processing', 'cancelling')
            AND task.deleted_at IS NULL`
      ).all();
    }
    throw error;
  }
}

function listResumableCancellationRows(db) {
  try {
    return db.prepare(
      `SELECT DISTINCT task.id
         FROM async_tasks task
         JOIN video_generations video ON video.task_id = task.id
          AND video.status = 'processing' AND video.deleted_at IS NULL
          AND video.provider_task_id IS NOT NULL AND TRIM(video.provider_task_id) != ''
        WHERE task.status = 'cancelling' AND task.deleted_at IS NULL`
    ).all().map((row) => String(row.id));
  } catch (error) {
    if (/no such table|no such column/i.test(error?.message || '')) return [];
    throw error;
  }
}

/** 服务重启时，在同一个事务中收敛任务和已确认归属的业务记录。 */
function failOrphanedAsyncTasksOnStartup(db, log) {
  const resumable = new Set(listResumableCancellationRows(db));
  for (const taskId of resumable) {
    log.warn?.('保留可恢复的远端取消任务', { task_id: taskId });
  }
  const rows = listOrphanRows(db).filter((row) => !resumable.has(String(row.id)));
  if (!rows.length) return 0;
  const changedTaskIds = [];
  const persist = db.transaction(() => {
    for (const row of rows) {
      const task = getRawTask(db, row.id);
      if (!task || !['pending', 'processing', 'cancelling'].includes(task.status)) continue;
      const updatedAt = nowIso();
      const changed = db.prepare(
        `UPDATE async_tasks
            SET status = 'failed', error = ?, progress = 0, completed_at = ?, updated_at = ?,
                cancel_state = CASE WHEN status = 'cancelling' AND cancel_operation_id IS NOT NULL THEN ? ELSE NULL END,
                cancel_next_retry_at = NULL,
                cancel_confirmed_at = NULL
          WHERE id = ? AND status IN ('pending', 'processing', 'cancelling')`
      ).run(
        ORPHAN_ASYNC_TASK_MSG,
        updatedAt,
        updatedAt,
        task.status === 'cancelling' && task.cancel_operation_id ? CANCEL_STATE_EXHAUSTED : null,
        row.id
      );
      if (!changed.changes) continue;
      const imageScope = imageTaskScope(db, task);
      terminalizeOwnedVideoRecords(db, task, ORPHAN_ASYNC_TASK_MSG, updatedAt, 'failed');
      terminalizeOwnedImageRecords(db, task, ORPHAN_ASYNC_TASK_MSG, updatedAt, imageScope.dramaId, 'failed');
      terminalizeOwnedMergeRecords(db, task, ORPHAN_ASYNC_TASK_MSG, updatedAt, 'failed');
      changedTaskIds.push(String(row.id));
    }
  });
  persist();
  for (const taskId of changedTaskIds) {
    clearCancellationRetry(taskId);
    finishOperation('task', taskId);
  }
  log.warn?.('服务重启后已收敛中断任务', { count: changedTaskIds.length });
  return changedTaskIds.length;
}

module.exports = {
  createTask,
  getTask,
  getTasksByResource,
  updateTaskStatus,
  updateTaskError,
  updateTaskResult,
  refreshCompletedTaskResult,
  ensureTaskOperation,
  markRemoteCancelPending,
  registerRemoteCancel,
  closeRemoteCancelWindow,
  throwIfTaskInactive,
  runTaskMutation,
  waitForTaskCancellationDecision,
  failTaskAfterCancellationDecision,
  upgradeTaskCancellationContext,
  resolveTaskDramaScope,
  failOrphanedAsyncTasksOnStartup,
  cancelTask,
  ORPHAN_ASYNC_TASK_MSG,
  USER_CANCEL_TASK_MSG,
  REMOTE_CANCEL_EXHAUSTED_MSG,
  REMOTE_CANCEL_RETRY_MAX_ATTEMPTS,
};
