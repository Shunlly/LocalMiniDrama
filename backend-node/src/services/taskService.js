const { v4: uuidv4 } = require('uuid');
const {
  cancelOperation,
  createOperationCancelledError,
  finishOperation,
  getOperation,
  registerOperation,
} = require('./operationRegistry');

const cancellationRequests = new Map();
const cancellationRetryJobs = new Map();
const REMOTE_CANCEL_RETRY_MAX_ATTEMPTS = 4;
const REMOTE_CANCEL_RETRY_BASE_DELAY_MS = 250;
const REMOTE_CANCEL_RETRY_MAX_DELAY_MS = 2_000;
const CANCEL_STATE_REQUESTED = 'requested';
const CANCEL_STATE_ATTEMPTING = 'attempting';
const CANCEL_STATE_RETRY_WAIT = 'retry_wait';
const CANCEL_STATE_CONFIRMED = 'confirmed';
const CANCEL_STATE_EXHAUSTED = 'exhausted';
const CANCEL_STATE_REJECTED = 'rejected';

function nowIso() {
  return new Date().toISOString();
}

function parseCancelContext(value) {
  if (!value) return null;
  if (typeof value === 'object') return { ...value };
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

function serializeCancelContext(context) {
  return JSON.stringify(context || {});
}

function getRawTask(db, taskId) {
  return db.prepare(
    'SELECT * FROM async_tasks WHERE id = ? AND deleted_at IS NULL'
  ).get(taskId) || null;
}

function taskCancelContext(row) {
  return parseCancelContext(row?.cancel_context);
}

function isProjectCancelContext(context) {
  return context?.scope === 'drama_recycle' && String(context.recycle_operation_id || '') !== '';
}

function taskCancelDetails(row) {
  return {
    operation_id: row?.cancel_operation_id || null,
    state: row?.cancel_state || null,
    attempt: Number(row?.cancel_attempt) || 0,
    next_retry_at: row?.cancel_next_retry_at || null,
    context: taskCancelContext(row),
  };
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

function getTask(db, taskId, options = {}) {
  const row = getRawTask(db, taskId);
  return row ? taskToPublic(db, row, options) : null;
}

function getTasksByResource(db, resourceId, options = {}) {
  const rows = db.prepare(
    'SELECT * FROM async_tasks WHERE resource_id = ? AND deleted_at IS NULL ORDER BY created_at DESC'
  ).all(resourceId);
  const tasks = rows.map((row) => taskToPublic(db, row, options));
  if (options.dramaId == null || options.dramaId === '') return tasks;
  const dramaId = Number(options.dramaId);
  if (!Number.isSafeInteger(dramaId) || dramaId <= 0) return [];
  return tasks.filter((task) => Number(task.drama_id) === dramaId);
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

function rowToTask(row) {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    progress: row.progress ?? 0,
    message: row.message,
    error: row.error,
    result: row.result,
    resource_id: row.resource_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at,
    cancel_operation_id: row.cancel_operation_id || null,
    cancel_state: row.cancel_state || null,
    cancel_attempt: Number(row.cancel_attempt) || 0,
    cancel_next_retry_at: row.cancel_next_retry_at || null,
    cancel_context: taskCancelContext(row),
  };
}

function numericScopeId(value) {
  const normalized = String(value ?? '').trim();
  if (!/^[1-9]\d*$/.test(normalized)) return null;
  const id = Number(normalized);
  return Number.isSafeInteger(id) ? id : null;
}

function queryScopeIds(db, sql, ...params) {
  try {
    return db.prepare(sql).all(...params)
      .map((row) => Number(row.drama_id))
      .filter((id) => Number.isSafeInteger(id) && id > 0);
  } catch (error) {
    if (/no such table|no such column/i.test(error?.message || '')) return [];
    throw error;
  }
}

function tableExists(db, table) {
  try {
    return Boolean(db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
    ).get(table));
  } catch (_) {
    return false;
  }
}

function resolveTaskDramaIds(db, task) {
  const type = String(task?.type || '');
  const resourceId = String(task?.resource_id ?? '').trim();
  const numericId = numericScopeId(resourceId);
  const declared = [];
  const related = [];

  if (['character_generation', 'story_generation', 'video_generation'].includes(type)) {
    if (numericId) declared.push(...queryScopeIds(db, 'SELECT id AS drama_id FROM dramas WHERE id = ?', numericId));
  } else if (['background_extraction', 'prop_extraction', 'storyboard_generation', 'video_merge', 'character_extraction'].includes(type)) {
    if (numericId) declared.push(...queryScopeIds(db, 'SELECT drama_id FROM episodes WHERE id = ?', numericId));
  } else if (type === 'frame_prompt_generation') {
    if (numericId) declared.push(...queryScopeIds(
      db,
      `SELECT episode.drama_id
         FROM storyboards storyboard
         JOIN episodes episode ON episode.id = storyboard.episode_id
        WHERE storyboard.id = ?`,
      numericId
    ));
  } else if (type === 'prop_image_generation') {
    if (numericId) declared.push(...queryScopeIds(db, 'SELECT drama_id FROM props WHERE id = ?', numericId));
  } else if (type === 'character_image') {
    if (numericId) declared.push(...queryScopeIds(db, 'SELECT drama_id FROM characters WHERE id = ?', numericId));
  } else if (type === 'image_generation') {
    const scoped = resourceId.match(/^(character|scene)_(\d+)$/);
    if (scoped) {
      const table = scoped[1] === 'character' ? 'characters' : 'scenes';
      declared.push(...queryScopeIds(db, `SELECT drama_id FROM ${table} WHERE id = ?`, Number(scoped[2])));
    } else if (numericId) {
      declared.push(...queryScopeIds(db, 'SELECT id AS drama_id FROM dramas WHERE id = ?', numericId));
    }
  }

  if (type === 'video_generation') {
    related.push(...queryScopeIds(db, 'SELECT drama_id FROM video_generations WHERE task_id = ?', task.id));
  } else if (type === 'image_generation') {
    related.push(...queryScopeIds(db, 'SELECT drama_id FROM image_generations WHERE task_id = ?', task.id));
  } else if (type === 'video_merge') {
    related.push(...queryScopeIds(db, 'SELECT drama_id FROM video_merges WHERE task_id = ?', task.id));
  }

  return {
    declared: [...new Set(declared)],
    related: [...new Set(related)],
  };
}

function resolveTaskDramaScope(db, task) {
  // 轻量测试夹具和旧数据库可能没有项目表；保持旧服务 API 可用，正式数据库则严格拒绝未解析任务。
  if (!tableExists(db, 'dramas')) return { dramaId: null, skipped: true };
  const { declared, related } = resolveTaskDramaIds(db, task);
  const dramaIds = [...new Set([...declared, ...related])];
  if (dramaIds.length !== 1) {
    const error = new Error(dramaIds.length > 1
      ? '任务关联了多个项目，已拒绝继续操作'
      : '无法解析任务唯一项目归属，已拒绝继续操作');
    error.code = 'TASK_SCOPE_CONFLICT';
    error.statusCode = 409;
    error.details = {
      task_id: task.id,
      task_type: task.type,
      resource_id: task.resource_id || null,
      declared_drama_ids: declared,
      related_drama_ids: related,
      drama_ids: dramaIds,
      reason: dramaIds.length > 1 ? 'mixed_drama_ownership' : 'unresolved_drama_ownership',
    };
    if (declared.length === 1) {
      const conflicting = related.find((dramaId) => dramaId !== declared[0]);
      if (conflicting != null) {
        error.details.expected_drama_id = String(declared[0]);
        error.details.actual_drama_id = String(conflicting);
      }
    }
    throw error;
  }
  return { dramaId: dramaIds[0], declared, related };
}

function taskToPublic(db, row, options = {}) {
  const task = rowToTask(row);
  const scope = resolveTaskDramaScope(db, row);
  if (!scope.skipped) {
    if (options.requireReadable === true) {
      require('./dramaWriteGuard').assertDramaReadable(db, scope.dramaId);
    }
    task.drama_id = scope.dramaId;
  }
  return task;
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

function getCancellationRequest(taskId) {
  const entry = cancellationRequests.get(String(taskId));
  return entry?.promise || entry || null;
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

function normalizeTaskResourceId(value) {
  const normalized = String(value ?? '').trim();
  return normalized === '0' ? '' : normalized;
}

function readDramaIdByEpisode(db, episodeId) {
  try {
    return db.prepare(
      'SELECT drama_id FROM episodes WHERE id = ? AND deleted_at IS NULL'
    ).get(Number(episodeId))?.drama_id ?? '';
  } catch (error) {
    if (/no such column/i.test(error?.message || '')) {
      return db.prepare('SELECT drama_id FROM episodes WHERE id = ?').get(Number(episodeId))?.drama_id ?? '';
    }
    if (/no such table/i.test(error?.message || '')) return '';
    throw error;
  }
}

function validateVideoTaskScope(db, task) {
  if (task?.type !== 'video_generation') return null;
  let rows;
  try {
    rows = db.prepare(
      `SELECT id, drama_id FROM video_generations
        WHERE task_id = ? AND deleted_at IS NULL`
    ).all(task.id);
  } catch (error) {
    if (/no such table/i.test(error?.message || '')) return null;
    if (/no such column/i.test(error?.message || '')) {
      rows = db.prepare('SELECT id, drama_id FROM video_generations WHERE task_id = ?').all(task.id);
    } else throw error;
  }
  const expected = normalizeTaskResourceId(task.resource_id);
  const conflicting = rows.find((row) => normalizeTaskResourceId(row.drama_id) !== expected);
  if (!conflicting) return null;
  return {
    video_generation_id: conflicting.id,
    expected_drama_id: expected || null,
    actual_drama_id: normalizeTaskResourceId(conflicting.drama_id) || null,
  };
}

function resolveDeclaredImageDramaId(db, task) {
  const resourceId = normalizeTaskResourceId(task?.resource_id);
  if (/^[1-9]\d*$/.test(resourceId)) return resourceId;
  const scoped = resourceId.match(/^(character|scene)_(\d+)$/);
  if (!scoped) return '';
  try {
    const table = scoped[1] === 'character' ? 'characters' : 'scenes';
    const row = db.prepare(
      `SELECT drama_id FROM ${table} WHERE id = ? AND deleted_at IS NULL`
    ).get(Number(scoped[2]));
    return normalizeTaskResourceId(row?.drama_id);
  } catch (error) {
    if (/no such column/i.test(error?.message || '')) {
      const table = scoped[1] === 'character' ? 'characters' : 'scenes';
      return normalizeTaskResourceId(db.prepare(`SELECT drama_id FROM ${table} WHERE id = ?`).get(Number(scoped[2]))?.drama_id);
    }
    if (/no such table/i.test(error?.message || '')) return '';
    throw error;
  }
}

function imageTaskScope(db, task) {
  if (task?.type !== 'image_generation') return { conflict: null, dramaId: '' };
  let rows;
  try {
    rows = db.prepare(
      `SELECT id, drama_id FROM image_generations
        WHERE task_id = ? AND deleted_at IS NULL`
    ).all(task.id);
  } catch (error) {
    if (/no such table/i.test(error?.message || '')) {
      return { conflict: null, dramaId: resolveDeclaredImageDramaId(db, task) };
    }
    if (/no such column/i.test(error?.message || '')) {
      rows = db.prepare('SELECT id, drama_id FROM image_generations WHERE task_id = ?').all(task.id);
    } else throw error;
  }
  const declared = resolveDeclaredImageDramaId(db, task);
  const actualIds = [...new Set(rows.map((row) => normalizeTaskResourceId(row.drama_id)))];
  const conflicting = rows.find((row) => declared && normalizeTaskResourceId(row.drama_id) !== declared);
  if (actualIds.length <= 1 && !conflicting) {
    return { conflict: null, dramaId: declared || actualIds[0] || '' };
  }
  const conflictRow = conflicting || rows.find((row) => normalizeTaskResourceId(row.drama_id) !== actualIds[0]);
  return {
    conflict: {
      image_generation_id: conflictRow?.id || null,
      expected_drama_id: declared || actualIds[0] || null,
      actual_drama_id: normalizeTaskResourceId(conflictRow?.drama_id) || null,
    },
    dramaId: '',
  };
}

function validateMergeTaskScope(db, task) {
  if (task?.type !== 'video_merge') return null;
  let rows;
  try {
    rows = db.prepare(
      `SELECT id, drama_id FROM video_merges
        WHERE task_id = ? AND deleted_at IS NULL`
    ).all(task.id);
  } catch (error) {
    if (/no such table/i.test(error?.message || '')) return null;
    if (/no such column/i.test(error?.message || '')) {
      rows = db.prepare('SELECT id, drama_id FROM video_merges WHERE task_id = ?').all(task.id);
    } else throw error;
  }
  const expected = normalizeTaskResourceId(readDramaIdByEpisode(db, task.resource_id));
  const conflicting = rows.find((row) => normalizeTaskResourceId(row.drama_id) !== expected);
  if (!conflicting) return null;
  return {
    video_merge_id: conflicting.id,
    expected_drama_id: expected || null,
    actual_drama_id: normalizeTaskResourceId(conflicting.drama_id) || null,
  };
}

function terminalizeOwnedVideoRecords(db, task, message, updatedAt, terminalStatus = 'cancelled') {
  const status = terminalStatus === 'failed' ? 'failed' : 'cancelled';
  const resourceId = normalizeTaskResourceId(task.resource_id);
  try {
    db.prepare(
      `UPDATE video_generations
          SET status = ?, error_msg = ?, completed_at = ?, updated_at = ?
        WHERE task_id = ?
          AND (CASE WHEN drama_id IS NULL OR drama_id = 0 THEN '' ELSE CAST(drama_id AS TEXT) END) = ?
          AND status IN ('pending', 'processing') AND deleted_at IS NULL`
    ).run(status, String(message || '').slice(0, 500), updatedAt, updatedAt, task.id, resourceId);
  } catch (error) {
    if (/no such table/i.test(error?.message || '')) return;
    if (!/completed_at|error_msg/i.test(error?.message || '')) throw error;
    db.prepare(
      `UPDATE video_generations SET status = ?, updated_at = ?
        WHERE task_id = ?
          AND (CASE WHEN drama_id IS NULL OR drama_id = 0 THEN '' ELSE CAST(drama_id AS TEXT) END) = ?
          AND status IN ('pending', 'processing') AND deleted_at IS NULL`
    ).run(status, updatedAt, task.id, resourceId);
  }
}

function terminalizeOwnedImageRecords(db, task, message, updatedAt, dramaId, terminalStatus = 'cancelled') {
  if (task?.type !== 'image_generation') return;
  const status = terminalStatus === 'failed' ? 'failed' : 'cancelled';
  try {
    db.prepare(
      `UPDATE image_generations
          SET status = ?, error_msg = ?, completed_at = ?, updated_at = ?
        WHERE task_id = ?
          AND (CASE WHEN drama_id IS NULL OR drama_id = 0 THEN '' ELSE CAST(drama_id AS TEXT) END) = ?
          AND status IN ('pending', 'processing') AND deleted_at IS NULL`
    ).run(status, String(message || '').slice(0, 500), updatedAt, updatedAt, task.id, dramaId || '');
  } catch (error) {
    if (/no such table/i.test(error?.message || '')) return;
    if (!/completed_at|error_msg/i.test(error?.message || '')) throw error;
    db.prepare(
      `UPDATE image_generations SET status = ?, updated_at = ?
        WHERE task_id = ?
          AND (CASE WHEN drama_id IS NULL OR drama_id = 0 THEN '' ELSE CAST(drama_id AS TEXT) END) = ?
          AND status IN ('pending', 'processing') AND deleted_at IS NULL`
    ).run(status, updatedAt, task.id, dramaId || '');
  }
}

function terminalizeOwnedMergeRecords(db, task, message, updatedAt, terminalStatus = 'cancelled') {
  if (task?.type !== 'video_merge') return;
  const status = terminalStatus === 'failed' ? 'failed' : 'cancelled';
  const expected = normalizeTaskResourceId(readDramaIdByEpisode(db, task.resource_id));
  try {
    db.prepare(
      `UPDATE video_merges
          SET status = ?, error_msg = ?, completed_at = ?
        WHERE task_id = ?
          AND (CASE WHEN drama_id IS NULL OR drama_id = 0 THEN '' ELSE CAST(drama_id AS TEXT) END) = ?
          AND status IN ('pending', 'processing') AND deleted_at IS NULL`
    ).run(status, String(message || '').slice(0, 500), updatedAt, task.id, expected);
  } catch (error) {
    if (/no such table/i.test(error?.message || '')) return;
    if (!/completed_at|error_msg/i.test(error?.message || '')) throw error;
    db.prepare(
      `UPDATE video_merges SET status = ?
        WHERE task_id = ?
          AND (CASE WHEN drama_id IS NULL OR drama_id = 0 THEN '' ELSE CAST(drama_id AS TEXT) END) = ?
          AND status IN ('pending', 'processing') AND deleted_at IS NULL`
    ).run(status, task.id, expected);
  }
}

const ORPHAN_ASYNC_TASK_MSG = '服务重启后任务中断，请重新操作';
const USER_CANCEL_TASK_MSG = '用户已取消';
const REMOTE_CANCEL_EXHAUSTED_MSG = '远端取消多次未确认，任务已停止本地接收结果，请在 Provider 控制台核验';
const REMOTE_CANCEL_SUPERSEDED_MSG = '取消请求已由更新的操作接管，请查看最新任务状态';

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

function buildCancelContext(existing, incoming, task, reason) {
  const current = existing || {};
  const scope = incoming?.scope || current.scope || 'task';
  const originalStatus = current.original_status || (
    task.status === 'pending' || task.status === 'processing' ? task.status : null
  );
  const originalError = Object.prototype.hasOwnProperty.call(current, 'original_error')
    ? current.original_error
    : task.error || null;
  return {
    ...current,
    scope,
    drama_id: incoming?.drama_id ?? current.drama_id ?? null,
    recycle_operation_id: incoming?.recycle_operation_id || current.recycle_operation_id || null,
    original_status: originalStatus,
    original_error: originalError,
    reason: reason || current.reason || USER_CANCEL_TASK_MSG,
    last_error: current.last_error || null,
    last_outcome: current.last_outcome || null,
  };
}

function shouldKeepExistingProjectContext(existing, incoming) {
  return isProjectCancelContext(existing) && incoming?.scope !== 'drama_recycle';
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

function updateContextAfterUncertain(row, outcome) {
  const context = taskCancelContext(row) || {};
  return {
    ...context,
    last_error: outcome?.error || '远端取消结果不确定',
    last_outcome: 'uncertain',
  };
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
      const message = '远端拒绝取消，原任务状态缺失，已转为明确失败终态';
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
      error: outcome?.error || '远端拒绝取消',
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

function isUncertainOutcome(outcome) {
  if (outcome?.uncertain === true) return true;
  const message = String(outcome?.error || '');
  return /超时|timeout|timed?\s*out|network|socket|ECONN|EAI_AGAIN|连接|传输|调度/i.test(message);
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
          await cancelTask(db, log, taskId, reason, {
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

async function executeCancellation(db, log, taskId, reason, prepared, options) {
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
      error: '远端取消结果仍在确认或退避等待中',
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
        error: outcome.error || '远端取消结果不确定',
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
      error: restored.error || outcome.error || '远端取消失败',
      outcome,
      task: restored.task,
    };
  }

  const confirmed = confirmCancellation(db, taskId, token, cancellationReason, outcome);
  if (confirmed.stale) return { ok: false, reason: 'cancel_superseded', error: REMOTE_CANCEL_SUPERSEDED_MSG, task: confirmed.task };
  clearCancellationRetry(taskId);
  log.info('Task cancelled by user', { task_id: taskId, cancel_outcome: outcome.outcome });
  return { ok: true, outcome, task: confirmed.task };
}

/** 用户主动取消任务。所有远端重试状态都先落库，再由唯一租约执行 Provider 调用。 */
function cancelTask(db, log, taskId, reason, options = {}) {
  let prepared;
  try {
    prepared = prepareCancellation(db, taskId, reason, options);
  } catch (error) {
    return Promise.reject(error);
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
