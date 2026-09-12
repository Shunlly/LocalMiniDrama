'use strict';

/**
 * 任务查询装配：原始行读取、公开对象装配与项目归属解析。
 * 路由仍通过 taskService 调用，本模块不改变公开 API。
 */

const { taskCancelContext } = require('./taskCancelState');

function getRawTask(db, taskId) {
  return db.prepare(
    'SELECT * FROM async_tasks WHERE id = ? AND deleted_at IS NULL'
  ).get(taskId) || null;
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

module.exports = {
  getRawTask,
  rowToTask,
  taskToPublic,
  resolveTaskDramaIds,
  resolveTaskDramaScope,
  getTask,
  getTasksByResource,
};
