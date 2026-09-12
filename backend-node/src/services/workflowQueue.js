'use strict';

// 从 workflowService 拆出的工作流队列：后台任务排队、排空与运行中标记。

const { backgroundTasks: defaultBackgroundTasks } = require('./legacyAsyncSchedulerService');

const processingRunIds = new Set();
const workflowQueues = new WeakMap();

function isWorkflowWorkerActive(runId) {
  return processingRunIds.has(String(runId));
}

function tryBeginWorkflowProcessing(runId) {
  const id = String(runId);
  if (processingRunIds.has(id)) return false;
  processingRunIds.add(id);
  return true;
}

function endWorkflowProcessing(runId) {
  processingRunIds.delete(String(runId));
}

function resolveWorkflowBackgroundTasks(options = {}) {
  const tasks = options.backgroundTasks || defaultBackgroundTasks;
  if (!tasks || typeof tasks.schedule !== 'function' || typeof tasks.assertAccepting !== 'function') {
    throw new Error('工作流调度需要后台任务调度器，请检查服务状态后重试');
  }
  return tasks;
}

function getWorkflowQueue(backgroundTasks) {
  let queue = workflowQueues.get(backgroundTasks);
  if (!queue) {
    queue = {
      backgroundTasks,
      drainScheduled: false,
      queuedRuns: new Map(),
    };
    workflowQueues.set(backgroundTasks, queue);
  }
  return queue;
}

async function drainWorkflowQueue(queue) {
  const { processWorkflowRun } = require('./workflowService');
  const { setRunStatus, toUserFacingWorkflowError } = require('./workflowStatus');
  const failures = [];
  try {
    while (queue.queuedRuns.size) {
      const entries = Array.from(queue.queuedRuns.values());
      queue.queuedRuns.clear();
      for (const entry of entries) {
        try {
          await processWorkflowRun(entry.db, entry.log, entry.runId, entry.processOptions);
        } catch (error) {
          entry.log?.error?.('Workflow run fatal error', {
            run_id: entry.runId,
            error: error.message || String(error),
          });
          try {
            setRunStatus(entry.db, entry.runId, 'failed', { error: toUserFacingWorkflowError(error) });
          } catch (checkpointError) {
            failures.push(checkpointError);
          }
          failures.push(error);
        }
      }
    }
    if (failures.length) {
      throw new AggregateError(failures, `${failures.length} 个工作流排队操作失败`);
    }
  } finally {
    queue.drainScheduled = false;
  }
}

function scheduleWorkflowRun(db, log, runId, options = {}) {
  const backgroundTasks = resolveWorkflowBackgroundTasks(options);
  backgroundTasks.assertAccepting();
  const queue = getWorkflowQueue(backgroundTasks);
  const { backgroundTasks: _ignored, ...processOptions } = options;
  queue.queuedRuns.set(String(runId), {
    db,
    log,
    processOptions,
    runId: String(runId),
  });
  if (queue.drainScheduled) return;

  queue.drainScheduled = true;
  try {
    backgroundTasks.schedule(
      log,
      'novel2anime_workflow_queue',
      () => drainWorkflowQueue(queue),
      { workflow_run_id: String(runId) }
    );
  } catch (error) {
    queue.queuedRuns.delete(String(runId));
    queue.drainScheduled = false;
    throw error;
  }
}

async function waitForWorkflowWorkersToIdle(runIds, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 30_000;
  const intervalMs = Number.isFinite(options.intervalMs) ? options.intervalMs : 10;
  const ids = (runIds || []).map((id) => String(id));
  const timeoutAt = Date.now() + timeoutMs;
  while (ids.some((id) => processingRunIds.has(id))) {
    if (Date.now() >= timeoutAt) {
      const error = new Error('工作流取消后未能在限定时间内退出，项目保持回收锁定');
      error.code = 'WORKFLOW_DRAIN_TIMEOUT';
      error.statusCode = 409;
      error.details = {
        active_workflow_run_ids: ids.filter((id) => processingRunIds.has(id)),
        project_remains_locked: true,
      };
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

module.exports = {
  isWorkflowWorkerActive,
  tryBeginWorkflowProcessing,
  endWorkflowProcessing,
  resolveWorkflowBackgroundTasks,
  getWorkflowQueue,
  drainWorkflowQueue,
  scheduleWorkflowRun,
  waitForWorkflowWorkersToIdle,
};
