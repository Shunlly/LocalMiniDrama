/**
 * 项目回收锁与中断恢复：锁释放、人工介入、超期判定与后台续跑。
 * 移入回收站、还原与归属审计仍在 dramaRecycle.js；对外 API 仍由该模块再导出。
 */

const taskService = require('./taskService');

const dramaRecycleRecoveryJobs = new Map();
const DRAMA_RECYCLE_RECOVERY_BASE_DELAY_MS = 1000;
const DRAMA_RECYCLE_RECOVERY_MAX_DELAY_MS = 10_000;
const DRAMA_RECYCLE_RECOVERY_MAX_ELAPSED_MS = 10 * 60 * 1000;
const DRAMA_RECYCLE_TASK_DRAIN_MAX_PASSES = 5;

function createDramaRecycleRecovery({ persistDramaRemoval, auditActiveTaskOwnership }) {
  function dramaRecycleRecoveryKey(id, operationId) {
    return `${Number(id)}:${String(operationId || '')}`;
  }

  function releaseDramaRecycleLock(db, log, id, operationId, reason) {
    const releasedAt = new Date().toISOString();
    const result = db.prepare(
      `UPDATE dramas
          SET trash_state = NULL, recycle_operation_id = NULL, recycle_phase = NULL,
              recycle_started_at = NULL, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL AND trash_state = 'recycling'
          AND recycle_operation_id = ?`
    ).run(releasedAt, id, operationId);
    if (result.changes) {
      log.error?.('Drama recycle stopped without deleting the project', {
        drama_id: id,
        recycle_operation_id: operationId,
        reason,
      });
    }
    return result.changes > 0;
  }

  function markDramaRecycleManualIntervention(db, log, id, operationId, reason) {
    const markedAt = new Date().toISOString();
    const result = db.prepare(
      `UPDATE dramas
          SET recycle_phase = 'manual_intervention', updated_at = ?
        WHERE id = ? AND deleted_at IS NULL AND trash_state = 'recycling'
          AND recycle_operation_id = ?`
    ).run(markedAt, id, operationId);
    if (result.changes) {
      log.error?.('Drama recycle requires manual intervention and remains locked', {
        drama_id: id,
        recycle_operation_id: operationId,
        reason,
      });
    }
    return result.changes > 0;
  }

  function preserveMalformedDramaRecycleLock(db, log, id, reason) {
    const markedAt = new Date().toISOString();
    const result = db.prepare(
      `UPDATE dramas
          SET recycle_phase = 'manual_intervention', updated_at = ?
        WHERE id = ? AND deleted_at IS NULL AND trash_state = 'recycling'`
    ).run(markedAt, id);
    if (result.changes) {
      log.error?.('Drama recycle metadata is incomplete; lock preserved for manual intervention', {
        drama_id: id,
        reason,
      });
    }
    return result.changes > 0;
  }

  function dramaRecycleDeadlineExceeded(db, id, operationId, now = Date.now()) {
    const row = db.prepare(
      `SELECT recycle_started_at FROM dramas
        WHERE id = ? AND deleted_at IS NULL AND trash_state = 'recycling'
          AND recycle_operation_id = ?`
    ).get(id, operationId);
    if (!row) return true;
    const startedAt = Date.parse(row.recycle_started_at || '');
    return !Number.isFinite(startedAt)
      || now - startedAt >= DRAMA_RECYCLE_RECOVERY_MAX_ELAPSED_MS;
  }

  function scheduleDramaRecycleRecovery(db, log, id, operationId, attempt = 0) {
    const key = dramaRecycleRecoveryKey(id, operationId);
    if (dramaRecycleRecoveryJobs.has(key)) return false;
    if (dramaRecycleDeadlineExceeded(db, id, operationId)) {
      markDramaRecycleManualIntervention(db, log, id, operationId, 'recovery_deadline_exceeded');
      return false;
    }
    const normalizedAttempt = Math.max(0, Number(attempt) || 0);
    const delayMs = Math.min(
      DRAMA_RECYCLE_RECOVERY_MAX_DELAY_MS,
      DRAMA_RECYCLE_RECOVERY_BASE_DELAY_MS * (2 ** Math.min(normalizedAttempt, 10))
    );
    dramaRecycleRecoveryJobs.set(key, { attempt: normalizedAttempt, delay_ms: delayMs });
    try {
      require('./legacyAsyncSchedulerService').scheduleDelayedBackgroundTask(log, 'drama_recycle_recovery', delayMs, async () => {
        dramaRecycleRecoveryJobs.delete(key);
        const locked = db.prepare(
          `SELECT id FROM dramas
            WHERE id = ? AND deleted_at IS NULL AND trash_state = 'recycling'
              AND recycle_operation_id = ?`
        ).get(id, operationId);
        if (!locked) return;
        try {
          await continueDramaRecycle(db, log, id, operationId, {
            recoveryAttempt: normalizedAttempt + 1,
            backgroundRecovery: true,
          });
        } catch (error) {
          log.error('Deferred drama recycle recovery failed', {
            drama_id: id,
            recycle_operation_id: operationId,
            error: error.message,
          });
        }
      }, { id: key, drama_id: id, recycle_operation_id: operationId, attempt: normalizedAttempt });
    } catch (error) {
      dramaRecycleRecoveryJobs.delete(key);
      throw error;
    }
    return true;
  }

  async function continueDramaRecycle(db, log, id, operationId, options = {}) {
    const workflowService = require('./workflowService');
    if (dramaRecycleDeadlineExceeded(db, id, operationId)) {
      markDramaRecycleManualIntervention(db, log, id, operationId, 'recovery_deadline_exceeded');
      if (options.backgroundRecovery) return null;
      const error = new Error('项目回收等待任务退出已超过安全时限，请确认任务状态后重试');
      error.code = 'WORKFLOW_DRAIN_TIMEOUT';
      error.statusCode = 409;
      error.details = {
        project_remains_locked: true,
        recycle_phase: 'manual_intervention',
      };
      throw error;
    }
    db.prepare(
      `UPDATE dramas SET recycle_phase = 'cancelling', updated_at = ?
        WHERE id = ? AND deleted_at IS NULL AND trash_state = 'recycling' AND recycle_operation_id = ?`
    ).run(new Date().toISOString(), id, operationId);

    let workflowResult;
    try {
      workflowResult = await workflowService.cancelAndDrainDramaWorkflows(
        db, log, id, '项目移入回收站'
      );
    } catch (error) {
      if (error?.code !== 'WORKFLOW_DRAIN_TIMEOUT') throw error;
      scheduleDramaRecycleRecovery(
        db, log, id, operationId, Math.max(0, Number(options.recoveryAttempt) || 0)
      );
      if (options.backgroundRecovery) return null;
      throw error;
    }
    const cancelledTaskIds = new Set();
    for (let pass = 0; pass < DRAMA_RECYCLE_TASK_DRAIN_MAX_PASSES; pass += 1) {
      let taskRows;
      try {
        taskRows = auditActiveTaskOwnership(db, id);
      } catch (error) {
        markDramaRecycleManualIntervention(db, log, id, operationId, error.code || 'task_scope_conflict');
        throw error;
      }
      if (taskRows.length) {
        const cancelContext = {
          scope: 'drama_recycle',
          drama_id: Number(id),
          recycle_operation_id: String(operationId),
          reason: '项目移入回收站',
        };
        const cancellations = await Promise.all(
          taskRows.map((row) => {
            taskService.upgradeTaskCancellationContext(db, row.id, cancelContext);
            return taskService.cancelTask(
              db,
              log,
              row.id,
              '项目移入回收站',
              { preserveOnUncertain: true, cancelContext }
            );
          })
        );
        const failedIndex = cancellations.findIndex((result) => !result.ok);
        taskRows.forEach((row, index) => {
          if (cancellations[index]?.ok) cancelledTaskIds.add(row.id);
        });
        if (failedIndex >= 0) {
          const failed = cancellations[failedIndex];
          const remainsLocked = [
            'remote_cancel_uncertain',
            'remote_cancel_exhausted',
            'task_scope_conflict',
          ].includes(failed.reason);
          if (failed.reason === 'remote_cancel_uncertain' || failed.reason === 'remote_cancel_exhausted') {
            scheduleDramaRecycleRecovery(
              db, log, id, operationId, Math.max(0, Number(options.recoveryAttempt) || 0)
            );
          } else if (failed.reason === 'task_scope_conflict') {
            markDramaRecycleManualIntervention(db, log, id, operationId, failed.reason);
          } else {
            releaseDramaRecycleLock(db, log, id, operationId, failed.reason || 'remote_cancel_failed');
          }
          const error = new Error(failed.error || '任务取消失败，项目保持回收锁定');
          error.code = failed.reason === 'task_scope_conflict'
            ? 'TASK_SCOPE_CONFLICT'
              : remainsLocked
              ? failed.reason === 'remote_cancel_exhausted'
                ? 'REMOTE_CANCEL_EXHAUSTED'
                : 'REMOTE_CANCEL_UNCERTAIN'
              : 'REMOTE_CANCEL_FAILED';
          error.details = {
            cancelled_task_ids: [...cancelledTaskIds],
            failed_task_id: taskRows[failedIndex]?.id || null,
            cancelled_workflow_run_ids: workflowResult.cancelled_run_ids,
            project_remains_locked: remainsLocked,
          };
          if (options.backgroundRecovery && remainsLocked) return null;
          throw error;
        }
        continue;
      }

      const commit = db.transaction(() => {
        const remainingTasks = auditActiveTaskOwnership(db, id);
        if (remainingTasks.length) return { remainingTasks, removed: null };
        db.prepare(
          `UPDATE dramas SET recycle_phase = 'ready_to_commit', updated_at = ?
            WHERE id = ? AND deleted_at IS NULL AND trash_state = 'recycling'
              AND recycle_operation_id = ?`
        ).run(new Date().toISOString(), id, operationId);
        return { remainingTasks: [], removed: persistDramaRemoval(db, log, id, operationId) };
      });
      const committed = typeof commit.immediate === 'function' ? commit.immediate() : commit();
      if (committed.removed) return committed.removed;
    }

    scheduleDramaRecycleRecovery(
      db, log, id, operationId, Math.max(0, Number(options.recoveryAttempt) || 0)
    );
    if (options.backgroundRecovery) return null;
    const error = new Error('项目回收期间仍有新任务进入，已延后重试');
    error.code = 'WORKFLOW_DRAIN_TIMEOUT';
    error.statusCode = 409;
    error.details = {
      cancelled_task_ids: [...cancelledTaskIds],
      cancelled_workflow_run_ids: workflowResult.cancelled_run_ids,
      project_remains_locked: true,
    };
    throw error;
  }

  function recoverInterruptedTrashOperations(db, log) {
    const rows = db.prepare(
      `SELECT id, recycle_operation_id, recycle_phase, recycle_started_at FROM dramas
        WHERE deleted_at IS NULL AND trash_state = 'recycling'`
    ).all();
    let recovered = 0;
    for (const row of rows) {
      if (row.recycle_phase === 'claimed' || row.recycle_phase === 'cancelling') {
        if (row.recycle_operation_id) {
          scheduleDramaRecycleRecovery(db, log, Number(row.id), row.recycle_operation_id);
        } else {
          preserveMalformedDramaRecycleLock(db, log, Number(row.id), 'missing_recycle_operation_id');
        }
        recovered += 1;
        continue;
      }
      if (!row.recycle_operation_id || !row.recycle_phase) {
        preserveMalformedDramaRecycleLock(db, log, Number(row.id), 'missing_recycle_metadata');
        recovered += 1;
        continue;
      }
      if (row.recycle_phase === 'manual_intervention') {
        recovered += 1;
        continue;
      }
      scheduleDramaRecycleRecovery(db, log, Number(row.id), row.recycle_operation_id);
      recovered += 1;
    }
    if (recovered) log.warn?.('Recovered interrupted drama recycle operations', { count: recovered });
    return recovered;
  }

  return {
    dramaRecycleRecoveryKey,
    releaseDramaRecycleLock,
    markDramaRecycleManualIntervention,
    preserveMalformedDramaRecycleLock,
    dramaRecycleDeadlineExceeded,
    scheduleDramaRecycleRecovery,
    continueDramaRecycle,
    recoverInterruptedTrashOperations,
  };
}

module.exports = {
  createDramaRecycleRecovery,
};
