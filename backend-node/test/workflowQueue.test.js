const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const {
  scheduleWorkflowRun,
  getWorkflowQueue,
  drainWorkflowQueue,
  isWorkflowWorkerActive,
  tryBeginWorkflowProcessing,
  endWorkflowProcessing,
  waitForWorkflowWorkersToIdle,
} = require('../src/services/workflowQueue');
const workflowService = require('../src/services/workflowService');
const { getWorkflowRun } = require('../src/services/workflowStatus');

const QUEUE_SOURCE = fs.readFileSync(
  path.join(__dirname, '../src/services/workflowQueue.js'),
  'utf8'
);

function createFakeScheduler() {
  const scheduled = [];
  return {
    scheduled,
    assertAccepting() {},
    schedule(log, label, fn, meta) {
      scheduled.push({ log, label, fn, meta });
    },
  };
}

function createDb(t) {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO dramas (id, title, description, style, status, created_at, updated_at)
     VALUES (1, '队列装配', 'fixture', 'anime', 'draft', ?, ?)`
  ).run(now, now);
  t.after(() => db.close());
  return db;
}

test('工作流队列源码使用集中调度器而不是 setImmediate', () => {
  assert.equal(QUEUE_SOURCE.includes('setImmediate'), false);
  assert.equal(QUEUE_SOURCE.includes('workflowQueues'), true);
  assert.equal(QUEUE_SOURCE.includes('drainWorkflowQueue'), true);
  assert.equal(QUEUE_SOURCE.includes('backgroundTasks.assertAccepting()'), true);
  assert.equal(QUEUE_SOURCE.includes('backgroundTasks.schedule('), true);
});

test('缺少后台调度器时返回可操作的中文错误', () => {
  assert.throws(
    () => scheduleWorkflowRun({}, { info() {} }, 'run-1', { backgroundTasks: {} }),
    (error) => error.message === '工作流调度需要后台任务调度器，请检查服务状态后重试'
  );
});

test('同一调度器上多个 run 只安排一次排空，后写入覆盖同 ID 条目', () => {
  const scheduler = createFakeScheduler();
  scheduleWorkflowRun({ db: 1 }, { info() {} }, 'run-a', { backgroundTasks: scheduler, foo: 1 });
  scheduleWorkflowRun({ db: 2 }, { info() {} }, 'run-b', { backgroundTasks: scheduler });
  scheduleWorkflowRun({ db: 3 }, { info() {} }, 'run-a', { backgroundTasks: scheduler, foo: 2 });
  const queue = getWorkflowQueue(scheduler);
  assert.equal(scheduler.scheduled.length, 1);
  assert.equal(scheduler.scheduled[0].label, 'novel2anime_workflow_queue');
  assert.equal(scheduler.scheduled[0].meta.workflow_run_id, 'run-a');
  assert.equal(queue.queuedRuns.size, 2);
  assert.equal(queue.queuedRuns.get('run-a').processOptions.foo, 2);
  assert.equal('backgroundTasks' in queue.queuedRuns.get('run-a').processOptions, false);
  assert.notEqual('run-a', 'run-b');
});

test('调度失败会撤回本次入队并允许再次安排', () => {
  const scheduler = {
    assertAccepting() {},
    schedule() {
      const error = new Error('Background task scheduler is draining and no longer accepts new jobs');
      error.code = 'LEGACY_ASYNC_SCHEDULER_CLOSED';
      throw error;
    },
  };
  assert.throws(
    () => scheduleWorkflowRun({}, { info() {} }, 'run-closed', { backgroundTasks: scheduler }),
    (error) => error.code === 'LEGACY_ASYNC_SCHEDULER_CLOSED'
  );
  const queue = getWorkflowQueue(scheduler);
  assert.equal(queue.queuedRuns.size, 0);
  assert.equal(queue.drainScheduled, false);
});

test('等待在跑 worker 超时会给出中文锁定错误，且只报告仍活跃的 run', async () => {
  assert.equal(tryBeginWorkflowProcessing('run-keep'), true);
  try {
    await assert.rejects(
      () => waitForWorkflowWorkersToIdle(['run-keep', 'run-idle'], { timeoutMs: 20, intervalMs: 5 }),
      (error) => (
        error.code === 'WORKFLOW_DRAIN_TIMEOUT'
        && error.statusCode === 409
        && error.message === '工作流取消后未能在限定时间内退出，项目保持回收锁定'
        && error.details.project_remains_locked === true
        && error.details.active_workflow_run_ids.join(',') === 'run-keep'
      )
    );
  } finally {
    endWorkflowProcessing('run-keep');
  }
  assert.equal(isWorkflowWorkerActive('run-keep'), false);
});

test('公开 processWorkflowRun 在并发进入时直接返回详情并保持 worker 标记', async (t) => {
  const db = createDb(t);
  const run = workflowService.createWorkflowRun(db, { info() {}, warn() {}, error() {} }, {
    drama_id: 1,
    type: 'novel2anime:queue-status',
    steps: [{ key: 'source_intake', label: '素材导入' }],
  });
  assert.equal(tryBeginWorkflowProcessing(run.id), true);
  try {
    const detail = await workflowService.processWorkflowRun(db, { info() {}, warn() {}, error() {} }, run.id);
    assert.equal(detail.status, 'pending');
    assert.equal(detail.worker_active, true);
    assert.equal(isWorkflowWorkerActive(run.id), true);
  } finally {
    endWorkflowProcessing(run.id);
  }
});

test('排空遇到致命错误会把 run 写成中文失败状态', async (t) => {
  const db = createDb(t);
  const log = { info() {}, warn() {}, error() {} };
  const run = workflowService.createWorkflowRun(db, log, {
    drama_id: 1,
    type: 'novel2anime:queue-fatal',
    steps: [{ key: 'source_intake', label: '素材导入' }],
  });
  const original = workflowService.processWorkflowRun;
  t.after(() => {
    workflowService.processWorkflowRun = original;
  });
  workflowService.processWorkflowRun = async () => {
    throw new Error('fetch failed');
  };

  const scheduler = createFakeScheduler();
  scheduleWorkflowRun(db, log, run.id, { backgroundTasks: scheduler });
  await assert.rejects(
    () => scheduler.scheduled[0].fn(),
    (error) => error instanceof AggregateError && String(error.message).includes('个工作流排队操作失败')
  );

  const failed = getWorkflowRun(db, run.id);
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /[一-鿿]/);
  assert.doesNotMatch(failed.error, /fetch failed/i);
});

