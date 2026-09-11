/**
 * 项目回收站：移入回收站、还原，以及回收期间的任务归属校验。
 * 回收锁与中断恢复见 dramaRecycleRecovery.js。
 * 路由仍通过 dramaService 调用公开 API，本模块不改变对外导出。
 */

const { randomUUID } = require('crypto');
const taskService = require('./taskService');
const { parseJsonColumn, rowToDrama } = require('./dramaAssembly');
const { getDramaById } = require('./dramaQueryService');
const { createDramaRecycleRecovery } = require('./dramaRecycleRecovery');

function dramaRecycleError(message = '项目正在移入回收站，请等待当前操作完成') {
  const error = new Error(message);
  error.code = 'DRAMA_RECYCLE_IN_PROGRESS';
  error.statusCode = 409;
  return error;
}

function taskScopeConflict(message, details) {
  const error = new Error(message);
  error.code = 'TASK_SCOPE_CONFLICT';
  error.statusCode = 409;
  error.details = details;
  return error;
}

function numericResourceId(value) {
  const normalized = String(value ?? '').trim();
  if (!/^[1-9]\d*$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function queryDramaIds(db, sql, ...params) {
  try {
    return db.prepare(sql).all(...params)
      .map((row) => Number(row.drama_id))
      .filter((value) => Number.isSafeInteger(value) && value > 0);
  } catch (error) {
    if (/no such table|no such column/i.test(error?.message || '')) return [];
    throw error;
  }
}

function declaredTaskDramaIds(db, task) {
  const type = String(task.type || '');
  const resource = String(task.resource_id || '').trim();
  const id = numericResourceId(resource);
  if (['character_generation', 'story_generation', 'video_generation'].includes(type)) {
    return id ? [id] : [];
  }
  if (['background_extraction', 'prop_extraction', 'storyboard_generation', 'video_merge', 'character_extraction'].includes(type)) {
    return id ? queryDramaIds(db, 'SELECT drama_id FROM episodes WHERE id = ?', id) : [];
  }
  if (type === 'frame_prompt_generation') {
    return id ? queryDramaIds(
      db,
      `SELECT episode.drama_id FROM storyboards storyboard
        JOIN episodes episode ON episode.id = storyboard.episode_id
       WHERE storyboard.id = ?`,
      id
    ) : [];
  }
  if (['prop_image_generation'].includes(type)) {
    return id ? queryDramaIds(db, 'SELECT drama_id FROM props WHERE id = ?', id) : [];
  }
  if (['character_image'].includes(type)) {
    return id ? queryDramaIds(db, 'SELECT drama_id FROM characters WHERE id = ?', id) : [];
  }
  if (type === 'image_generation') {
    const character = resource.match(/^character_(\d+)$/);
    if (character) return queryDramaIds(db, 'SELECT drama_id FROM characters WHERE id = ?', Number(character[1]));
    const scene = resource.match(/^scene_(\d+)$/);
    if (scene) return queryDramaIds(db, 'SELECT drama_id FROM scenes WHERE id = ?', Number(scene[1]));
    return id ? [id] : [];
  }
  return [];
}

function relatedTaskDramaIds(db, taskId) {
  return [
    ...queryDramaIds(db, 'SELECT drama_id FROM image_generations WHERE task_id = ? AND deleted_at IS NULL', taskId),
    ...queryDramaIds(db, 'SELECT drama_id FROM video_generations WHERE task_id = ? AND deleted_at IS NULL', taskId),
    ...queryDramaIds(db, 'SELECT drama_id FROM video_merges WHERE task_id = ? AND deleted_at IS NULL', taskId),
  ];
}

function taskOwnershipRows(db, dramaId, rows, options = {}) {
  const owned = [];
  const conflicts = [];
  for (const task of rows) {
    const declared = new Set(declaredTaskDramaIds(db, task));
    const relatedValues = relatedTaskDramaIds(db, task.id);
    const related = new Set(relatedValues);
    const combined = new Set([...declared, ...related]);
    const touchesDrama = combined.has(Number(dramaId));
    const mismatched = combined.size > 1
      || (declared.size && related.size && [...declared].some((id) => !related.has(id)))
      || related.size > 1;
    const unresolved = combined.size === 0;
    if (unresolved && options.rejectUnresolved !== false) {
      conflicts.push({
        task_id: task.id,
        task_type: task.type,
        resource_id: task.resource_id || null,
        reason: 'unresolved_active_task_ownership',
      });
      continue;
    }
    if (touchesDrama && mismatched) {
      conflicts.push({
        task_id: task.id,
        task_type: task.type,
        resource_id: task.resource_id || null,
        declared_drama_ids: [...declared],
        related_drama_ids: [...related],
      });
      continue;
    }
    if (touchesDrama) owned.push(task);
  }
  if (conflicts.length) {
    throw taskScopeConflict('任务声明归属与业务关联归属不一致，已拒绝回收项目', { conflicts });
  }
  return owned;
}

function auditActiveTaskOwnership(db, dramaId) {
  let activeTasks;
  try {
    activeTasks = db.prepare(
      `SELECT id, type, resource_id, status FROM async_tasks
        WHERE status IN ('pending', 'processing', 'cancelling') AND deleted_at IS NULL`
    ).all();
  } catch (error) {
    if (/no such table/i.test(error?.message || '')) return [];
    throw error;
  }
  return taskOwnershipRows(db, dramaId, activeTasks);
}

function auditPendingCancellationOwnership(db, dramaId) {
  let rows;
  try {
    rows = db.prepare(
      `SELECT id, type, resource_id, status, cancel_state, cancel_operation_id, cancel_context
         FROM async_tasks
        WHERE deleted_at IS NULL
          AND cancel_state IS NOT NULL
          AND cancel_state != 'confirmed'
          AND (status IN ('pending', 'processing', 'cancelling') OR status = 'failed')`
    ).all();
  } catch (error) {
    if (/no such table|no such column/i.test(error?.message || '')) return [];
    throw error;
  }
  return taskOwnershipRows(db, dramaId, rows, { rejectUnresolved: true });
}

function auditProjectCancellationSafety(db, dramaId, operationId) {
  const activeTasks = auditActiveTaskOwnership(db, dramaId);
  if (activeTasks.length) return { safe: false, reason: 'active_tasks', tasks: activeTasks };
  const pending = auditPendingCancellationOwnership(db, dramaId);
  if (pending.length) {
    return {
      safe: false,
      reason: 'unconfirmed_cancellations',
      tasks: pending.map((task) => ({
        task_id: task.id,
        task_type: task.type,
        status: task.status,
        cancel_state: task.cancel_state,
        cancel_operation_id: task.cancel_operation_id || null,
        cancel_context: parseJsonColumn(task.cancel_context),
      })),
    };
  }
  const claimed = db.prepare(
    `SELECT id, status, cancel_state, cancel_operation_id
       FROM async_tasks
      WHERE deleted_at IS NULL AND cancel_operation_id = ?`
  ).all(operationId);
  const unconfirmedClaim = claimed.find((task) => task.cancel_state !== 'confirmed');
  if (unconfirmedClaim) {
    return {
      safe: false,
      reason: 'operation_confirmation_missing',
      tasks: [unconfirmedClaim],
    };
  }
  return { safe: true, tasks: [] };
}

function upgradePendingDramaCancellations(db, dramaId, operationId) {
  const candidates = auditPendingCancellationOwnership(db, dramaId);
  const context = {
    scope: 'drama_recycle',
    drama_id: Number(dramaId),
    recycle_operation_id: String(operationId),
    reason: '项目移入回收站',
  };
  const upgraded = [];
  for (const task of candidates) {
    const token = taskService.upgradeTaskCancellationContext(db, task.id, context);
    if (token) upgraded.push({ task_id: task.id, token });
  }
  return upgraded;
}

function persistDramaRemoval(db, log, id, operationId) {
  const removedAt = new Date().toISOString();
  const result = db.prepare(
    `UPDATE dramas
        SET deleted_at = ?, trash_state = NULL, recycle_phase = 'completed', updated_at = ?
      WHERE id = ? AND deleted_at IS NULL AND trash_state = 'recycling'
        AND recycle_operation_id = ?`
  ).run(removedAt, removedAt, id, operationId);
  if (!result.changes) return null;
  const row = db.prepare('SELECT * FROM dramas WHERE id = ?').get(id);
  log.info('Drama moved to trash', { drama_id: id, associated_data: 'preserved', recoverable: true });
  return row ? rowToDrama(row) : null;
}

const {
  dramaRecycleRecoveryKey,
  releaseDramaRecycleLock,
  markDramaRecycleManualIntervention,
  preserveMalformedDramaRecycleLock,
  dramaRecycleDeadlineExceeded,
  scheduleDramaRecycleRecovery,
  continueDramaRecycle,
  recoverInterruptedTrashOperations,
} = createDramaRecycleRecovery({
  persistDramaRemoval,
  auditActiveTaskOwnership,
});

async function moveDramaToTrash(db, log, dramaId) {
  const id = Number(dramaId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const recyclingAt = new Date().toISOString();
  const operationId = randomUUID();
  const existing = db.prepare(
    `SELECT id, trash_state, recycle_phase FROM dramas
      WHERE id = ? AND deleted_at IS NULL`
  ).get(id);
  if (!existing) return null;
  const retryingManualIntervention = existing.trash_state === 'recycling'
    && existing.recycle_phase === 'manual_intervention';
  const claimed = retryingManualIntervention
    ? db.prepare(
        `UPDATE dramas
            SET recycle_operation_id = ?, recycle_phase = 'claimed',
                recycle_started_at = ?, updated_at = ?
          WHERE id = ? AND deleted_at IS NULL AND trash_state = 'recycling'
            AND recycle_phase = 'manual_intervention'`
      ).run(operationId, recyclingAt, recyclingAt, id)
    : db.prepare(
        `UPDATE dramas
            SET trash_state = 'recycling', recycle_operation_id = ?, recycle_phase = 'claimed',
                recycle_started_at = ?, updated_at = ?
          WHERE id = ? AND deleted_at IS NULL
            AND (trash_state IS NULL OR trash_state = '')`
      ).run(operationId, recyclingAt, recyclingAt, id);
  if (!claimed.changes) {
    const current = db.prepare(
      'SELECT id, trash_state FROM dramas WHERE id = ? AND deleted_at IS NULL'
    ).get(id);
    if (!current) return null;
    throw dramaRecycleError();
  }
  try {
    auditActiveTaskOwnership(db, id);
  } catch (error) {
    if (retryingManualIntervention) {
      markDramaRecycleManualIntervention(db, log, id, operationId, error.code || 'task_scope_conflict');
    } else {
      markDramaRecycleManualIntervention(db, log, id, operationId, error.code || 'task_scope_conflict');
    }
    throw error;
  }
  return continueDramaRecycle(db, log, id, operationId);
}

function restoreDrama(db, log, dramaId) {
  const id = Number(dramaId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const restoredAt = new Date().toISOString();
  const result = db.prepare(
    `UPDATE dramas
        SET deleted_at = NULL, trash_state = NULL,
            recycle_phase = NULL, recycle_operation_id = NULL,
            recycle_started_at = NULL, updated_at = ?
      WHERE id = ? AND deleted_at IS NOT NULL`
  ).run(restoredAt, id);
  if (result.changes === 0) return null;

  log.info('Drama restored from trash', {
    drama_id: id,
    associated_data: 'preserved',
  });
  return getDramaById(db, id);
}

module.exports = {
  declaredTaskDramaIds,
  relatedTaskDramaIds,
  auditActiveTaskOwnership,
  dramaRecycleError,
  persistDramaRemoval,
  dramaRecycleRecoveryKey,
  releaseDramaRecycleLock,
  markDramaRecycleManualIntervention,
  preserveMalformedDramaRecycleLock,
  dramaRecycleDeadlineExceeded,
  scheduleDramaRecycleRecovery,
  continueDramaRecycle,
  moveDramaToTrash,
  recoverInterruptedTrashOperations,
  restoreDrama,
};
