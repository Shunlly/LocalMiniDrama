'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const taskService = require('../src/services/taskService');
const execution = require('../src/services/taskCancelExecution');
const { getRawTask } = require('../src/services/taskAssembly');

const DRAMA_A = 11;
const DRAMA_B = 22;
const EPISODE_A = 1101;
const TASK_ID = 'task-exec-1';
const OTHER_TASK_ID = 'task-exec-2';

function serviceSource() {
  return fs.readFileSync(path.join(__dirname, '../src/services/taskService.js'), 'utf8');
}

function executionSource() {
  return fs.readFileSync(path.join(__dirname, '../src/services/taskCancelExecution.js'), 'utf8');
}

function prepareSource() {
  return fs.readFileSync(path.join(__dirname, '../src/services/taskCancelExecutionPrepare.js'), 'utf8');
}

function remoteSource() {
  return fs.readFileSync(path.join(__dirname, '../src/services/taskCancelExecutionRemote.js'), 'utf8');
}

function combinedSource() {
  return `${serviceSource()}\n${executionSource()}\n${prepareSource()}\n${remoteSource()}`;
}

function createCancelDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY,
      title TEXT,
      status TEXT,
      deleted_at TEXT,
      trash_state TEXT,
      recycle_phase TEXT
    );
    CREATE TABLE episodes (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      deleted_at TEXT
    );
    CREATE TABLE async_tasks (
      id TEXT PRIMARY KEY,
      type TEXT,
      status TEXT,
      progress INTEGER DEFAULT 0,
      message TEXT,
      error TEXT,
      result TEXT,
      resource_id TEXT,
      created_at TEXT,
      updated_at TEXT,
      completed_at TEXT,
      deleted_at TEXT,
      cancel_context TEXT,
      cancel_operation_id TEXT,
      cancel_state TEXT,
      cancel_attempt INTEGER DEFAULT 0,
      cancel_next_retry_at TEXT,
      cancel_requested_at TEXT,
      cancel_confirmed_at TEXT
    );
    CREATE TABLE video_generations (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      task_id TEXT,
      status TEXT,
      provider_task_id TEXT,
      error_msg TEXT,
      completed_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE image_generations (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      task_id TEXT,
      status TEXT,
      error_msg TEXT,
      completed_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
  `);
  db.prepare("INSERT INTO dramas (id, title, status) VALUES (?, '项目甲', 'draft')").run(DRAMA_A);
  db.prepare("INSERT INTO dramas (id, title, status) VALUES (?, '项目乙', 'draft')").run(DRAMA_B);
  db.prepare('INSERT INTO episodes (id, drama_id) VALUES (?, ?)').run(EPISODE_A, DRAMA_A);
  return db;
}

function insertTask(db, values) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO async_tasks (
       id, type, status, progress, message, error, result, resource_id,
       created_at, updated_at, completed_at, deleted_at,
       cancel_context, cancel_operation_id, cancel_state, cancel_attempt, cancel_next_retry_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    values.id,
    values.type,
    values.status || 'processing',
    values.progress ?? 10,
    values.message || '运行中',
    values.error || null,
    values.result || null,
    values.resource_id,
    now,
    now,
    values.completed_at || null,
    values.deleted_at || null,
    values.cancel_context || null,
    values.cancel_operation_id || null,
    values.cancel_state || null,
    values.cancel_attempt ?? 0,
    values.cancel_next_retry_at || null
  );
}

test('跨模块 ID 在远端取消执行反例中互不相等', () => {
  assert.notEqual(DRAMA_A, DRAMA_B);
  assert.notEqual(DRAMA_A, EPISODE_A);
  assert.notEqual(DRAMA_B, EPISODE_A);
  assert.notEqual(TASK_ID, OTHER_TASK_ID);
});

test('taskService 公开取消入口仍指向执行模块的同一函数', () => {
  assert.equal(taskService.cancelTask, execution.cancelTask);
  assert.equal(taskService.upgradeTaskCancellationContext, execution.upgradeTaskCancellationContext);
  assert.equal(taskService.REMOTE_CANCEL_RETRY_MAX_ATTEMPTS, execution.REMOTE_CANCEL_RETRY_MAX_ATTEMPTS);
  assert.equal(typeof taskService.createTask, 'function');
  assert.equal(typeof taskService.updateTaskStatus, 'function');
});

test('远端取消执行已从 taskService 拆到独立模块，且不复制状态/装配层', () => {
  const service = serviceSource();
  const exec = executionSource();
  const prepare = prepareSource();
  const remote = remoteSource();
  assert.match(service, /require\('\.\/taskCancelExecution'\)/);
  assert.match(service, /function createTask/);
  assert.match(service, /function updateTaskStatus/);
  assert.equal(service.includes('function cancelTask'), false);
  assert.equal(service.includes('function executeCancellationAttempt'), false);
  assert.equal(service.includes('function scheduleRemoteCancellationRetry'), false);
  assert.equal(service.includes('function claimCancellationAttempt'), false);
  assert.equal(service.includes('function taskRequiresRemoteCancellation'), false);
  assert.match(exec, /function cancelTask/);
  assert.match(exec, /function executeCancellation/);
  assert.match(exec, /function executeCancellationAttempt/);
  assert.match(exec, /require\('\.\/taskCancelExecutionPrepare'\)/);
  assert.match(exec, /require\('\.\/taskCancelExecutionRemote'\)/);
  assert.match(exec, /require\('\.\/taskCancelState'\)/);
  assert.match(exec, /require\('\.\/taskAssembly'\)/);
  assert.equal(exec.includes('function prepareCancellation'), false);
  assert.equal(exec.includes('function claimCancellationAttempt'), false);
  assert.equal(exec.includes('function scheduleRemoteCancellationRetry'), false);
  assert.equal(exec.includes('function recordUncertainCancellation'), false);
  assert.match(prepare, /function prepareCancellation/);
  assert.match(prepare, /function claimCancellationAttempt/);
  assert.match(prepare, /function taskRequiresRemoteCancellation/);
  assert.match(remote, /function scheduleRemoteCancellationRetry/);
  assert.match(remote, /function recordUncertainCancellation/);
  assert.equal(exec.includes('function parseCancelContext'), false);
  assert.equal(exec.includes('function rowToTask'), false);
  assert.equal(exec.includes('function resolveTaskDramaScope'), false);
  assert.equal(exec.includes('function createTask'), false);
  assert.equal(exec.includes('function updateTaskStatus'), false);
  assert.equal(prepare.includes('function parseCancelContext'), false);
  assert.equal(remote.includes('function parseCancelContext'), false);
  assert.equal(prepare.includes('function cancelTask'), false);
  assert.equal(remote.includes('function cancelTask'), false);
});

test('taskService 与执行层拼接源码仍收口远端取消用户可见中文', () => {
  const source = combinedSource();
  assert.match(source, /userFacingRemoteCancelError/);
  assert.match(source, /REMOTE_CANCEL_UNCERTAIN_MSG/);
  assert.match(source, /REMOTE_CANCEL_EXHAUSTED_MSG/);
  assert.match(source, /function cancelTask/);
  assert.equal(source.includes('ETIMEDOUT: connection timed out'), false);
  assert.equal(source.includes('function parseCancelContext'), false);
});

test('远端取消重试间隔按尝试次数指数退避并封顶', () => {
  assert.equal(execution.retryDelayMs(1), 250);
  assert.equal(execution.retryDelayMs(2), 500);
  assert.equal(execution.retryDelayMs(3), 1000);
  assert.equal(execution.retryDelayMs(4), 2000);
  assert.equal(execution.retryDelayMs(8), 2000);
  assert.equal(execution.retryDelayMs(0), 250);
});

test('只有仍存活且带 provider_task_id 的视频记录才需要远端取消', () => {
  const db = createCancelDb();
  insertTask(db, { id: TASK_ID, type: 'video_generation', resource_id: String(DRAMA_A) });
  assert.equal(execution.taskRequiresRemoteCancellation(db, { id: TASK_ID }), false);

  db.prepare(
    `INSERT INTO video_generations (drama_id, task_id, status, provider_task_id)
     VALUES (?, ?, 'processing', '')`
  ).run(DRAMA_A, TASK_ID);
  assert.equal(execution.taskRequiresRemoteCancellation(db, { id: TASK_ID }), false);

  db.prepare(
    `INSERT INTO video_generations (drama_id, task_id, status, provider_task_id)
     VALUES (?, ?, 'processing', 'provider-1')`
  ).run(DRAMA_B, OTHER_TASK_ID);
  assert.notEqual(TASK_ID, OTHER_TASK_ID);
  assert.equal(execution.taskRequiresRemoteCancellation(db, { id: TASK_ID }), false);

  db.prepare(
    `INSERT INTO video_generations (drama_id, task_id, status, provider_task_id, deleted_at)
     VALUES (?, ?, 'processing', 'provider-deleted', ?)`
  ).run(DRAMA_A, TASK_ID, new Date().toISOString());
  assert.equal(execution.taskRequiresRemoteCancellation(db, { id: TASK_ID }), false);

  db.prepare(
    `INSERT INTO video_generations (drama_id, task_id, status, provider_task_id)
     VALUES (?, ?, 'processing', 'provider-live')`
  ).run(DRAMA_A, TASK_ID);
  assert.equal(execution.taskRequiresRemoteCancellation(db, { id: TASK_ID }), true);
  db.close();
});

test('缺视频表时远端取消探测失败关闭为不需要远端取消', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE async_tasks (id TEXT PRIMARY KEY)');
  assert.equal(execution.taskRequiresRemoteCancellation(db, { id: TASK_ID }), false);
  db.close();
});

test('执行层 cancelTask 仍能取消无远端依赖的活动任务', async () => {
  const db = createCancelDb();
  insertTask(db, { id: TASK_ID, type: 'character_generation', resource_id: String(DRAMA_A) });
  const result = await execution.cancelTask(db, { info() {} }, TASK_ID);
  assert.equal(result.ok, true);
  const task = taskService.getTask(db, TASK_ID);
  assert.equal(task.status, 'cancelled');
  assert.equal(task.error, taskService.USER_CANCEL_TASK_MSG);
  db.close();
});

test('混合两个不相等 drama_id 时执行层取消失败关闭且不改记录', async () => {
  const db = createCancelDb();
  insertTask(db, { id: TASK_ID, type: 'video_generation', resource_id: String(DRAMA_A) });
  db.prepare(
    `INSERT INTO video_generations (drama_id, task_id, status) VALUES (?, ?, 'processing')`
  ).run(DRAMA_A, TASK_ID);
  db.prepare(
    `INSERT INTO video_generations (drama_id, task_id, status) VALUES (?, ?, 'processing')`
  ).run(DRAMA_B, TASK_ID);

  const result = await execution.cancelTask(db, { info() {} }, TASK_ID, '混合归属取消');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'task_scope_conflict');
  assert.equal(getRawTask(db, TASK_ID).status, 'processing');
  assert.deepEqual(
    db.prepare('SELECT drama_id, task_id FROM video_generations ORDER BY id').all(),
    [
      { drama_id: DRAMA_A, task_id: TASK_ID },
      { drama_id: DRAMA_B, task_id: TASK_ID },
    ]
  );
  db.close();
});

test('图片任务 resource_id 与关联 drama_id 不相等时拒绝取消', async () => {
  const db = createCancelDb();
  insertTask(db, { id: TASK_ID, type: 'image_generation', resource_id: String(DRAMA_A) });
  db.prepare(
    `INSERT INTO image_generations (drama_id, task_id, status) VALUES (?, ?, 'processing')`
  ).run(DRAMA_B, TASK_ID);
  const scope = execution.imageTaskScope(db, getRawTask(db, TASK_ID));
  assert.ok(scope.conflict);
  assert.equal(scope.conflict.expected_drama_id, String(DRAMA_A));
  assert.equal(scope.conflict.actual_drama_id, String(DRAMA_B));

  const result = await execution.cancelTask(db, { info() {} }, TASK_ID, '图片作用域反例');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'task_scope_conflict');
  assert.equal(getRawTask(db, TASK_ID).status, 'processing');
  assert.equal(
    db.prepare('SELECT status FROM image_generations WHERE task_id = ?').get(TASK_ID).status,
    'processing'
  );
  db.close();
});

test('英文超时远端取消结果对外仍是中文，且不泄漏 ETIMEDOUT', async (t) => {
  const scheduler = require('../src/services/legacyAsyncSchedulerService');
  t.mock.method(scheduler, 'scheduleDelayedBackgroundTask', () => 'job-timeout-retry');
  const db = createCancelDb();
  insertTask(db, { id: TASK_ID, type: 'video_generation', resource_id: String(DRAMA_A) });
  taskService.markRemoteCancelPending(TASK_ID);
  taskService.registerRemoteCancel(TASK_ID, async () => ({
    confirmed: false,
    uncertain: true,
    error: 'ETIMEDOUT: connection timed out',
  }));

  const result = await execution.cancelTask(db, { info() {}, error() {} }, TASK_ID, '用户取消');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'remote_cancel_uncertain');
  assert.equal(result.error, '远端取消结果不确定');
  assert.match(result.error, /[\u4e00-\u9fff]/);
  assert.doesNotMatch(result.error, /ETIMEDOUT|timed out|timeout/i);
  const task = taskService.getTask(db, TASK_ID);
  assert.equal(task.status, 'cancelling');
  assert.equal(task.cancel_context.last_error, '远端取消结果不确定');
  assert.doesNotMatch(String(task.cancel_context.last_error), /ETIMEDOUT|timed out|timeout/i);
  db.close();
});

test('终态化图片记录只更新匹配 drama_id，不相等的关联行保持原状', () => {
  const db = createCancelDb();
  insertTask(db, { id: TASK_ID, type: 'image_generation', resource_id: String(DRAMA_A) });
  db.prepare(
    `INSERT INTO image_generations (drama_id, task_id, status, updated_at)
     VALUES (?, ?, 'processing', 't0')`
  ).run(DRAMA_A, TASK_ID);
  db.prepare(
    `INSERT INTO image_generations (drama_id, task_id, status, updated_at)
     VALUES (?, ?, 'processing', 't0')`
  ).run(DRAMA_B, TASK_ID);

  execution.terminalizeOwnedImageRecords(
    db,
    getRawTask(db, TASK_ID),
    '用户已取消',
    't1',
    String(DRAMA_A),
    'cancelled'
  );
  const rows = db.prepare(
    'SELECT drama_id, status, error_msg FROM image_generations ORDER BY id'
  ).all();
  assert.equal(rows[0].drama_id, DRAMA_A);
  assert.equal(rows[0].status, 'cancelled');
  assert.equal(rows[1].drama_id, DRAMA_B);
  assert.equal(rows[1].status, 'processing');
  assert.equal(rows[1].error_msg, null);
  db.close();
});
