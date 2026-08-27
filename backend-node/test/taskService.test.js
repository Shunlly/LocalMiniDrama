const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const taskService = require('../src/services/taskService');
const { getOperation } = require('../src/services/operationRegistry');

function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`
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
  `);
  return db;
}

describe('taskService.failOrphanedAsyncTasksOnStartup', () => {
  it('marks pending and processing tasks as failed on startup', () => {
    const db = createTestDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at)
       VALUES (?, ?, ?, 0, '', ?, ?, ?)`
    ).run('task-pending', 'background_extraction', 'pending', '42', now, now);
    db.prepare(
      `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at)
       VALUES (?, ?, ?, 0, '', ?, ?, ?)`
    ).run('task-processing', 'background_extraction', 'processing', '42', now, now);
    db.prepare(
      `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, 100, '', ?, ?, ?, ?)`
    ).run('task-done', 'background_extraction', 'completed', '42', now, now, now);

    const count = taskService.failOrphanedAsyncTasksOnStartup(db, { warn() {}, info() {} });
    assert.equal(count, 2);

    const pending = taskService.getTask(db, 'task-pending');
    const processing = taskService.getTask(db, 'task-processing');
    const done = taskService.getTask(db, 'task-done');

    assert.equal(pending.status, 'failed');
    assert.equal(processing.status, 'failed');
    assert.equal(pending.error, taskService.ORPHAN_ASYNC_TASK_MSG);
    assert.equal(done.status, 'completed');
  });

  it('cancelTask marks active task as cancelled', async () => {
    const db = createTestDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at)
       VALUES (?, ?, ?, 0, '', ?, ?, ?)`
    ).run('task-active', 'background_extraction', 'processing', '42', now, now);

    const result = await taskService.cancelTask(db, { info() {} }, 'task-active');
    assert.equal(result.ok, true);
    const task = taskService.getTask(db, 'task-active');
    assert.equal(task.status, 'cancelled');
    assert.equal(task.error, taskService.USER_CANCEL_TASK_MSG);
  });

  it('keeps resumable provider video tasks active on startup', () => {
    const db = createTestDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at)
       VALUES (?, 'video_generation', 'processing', 20, '', '42', ?, ?)`
    ).run('task-resumable-video', now, now);
    db.prepare(
      `INSERT INTO video_generations (task_id, status, provider_task_id)
       VALUES (?, 'processing', ?)`
    ).run('task-resumable-video', 'provider-task-42');

    const count = taskService.failOrphanedAsyncTasksOnStartup(db, { warn() {}, info() {} });

    assert.equal(count, 0);
    assert.equal(taskService.getTask(db, 'task-resumable-video').status, 'processing');
  });

  it('preserves an unconfirmed cancellation when provider polling can resume', () => {
    const db = createTestDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO async_tasks (id, type, status, progress, message, error, resource_id, created_at, updated_at)
       VALUES (?, 'video_generation', 'cancelling', 20, '', '用户已取消', '42', ?, ?)`
    ).run('task-resumable-cancelling', now, now);
    db.prepare(
      `INSERT INTO video_generations (task_id, status, provider_task_id)
       VALUES (?, 'processing', ?)`
    ).run('task-resumable-cancelling', 'provider-task-cancelling');

    const count = taskService.failOrphanedAsyncTasksOnStartup(db, { warn() {}, info() {} });

    const task = taskService.getTask(db, 'task-resumable-cancelling');
    assert.equal(count, 0);
    assert.equal(task.status, 'cancelling');
    assert.equal(task.error, '用户已取消');
  });

  it('fails an unconfirmed cancellation when no worker can be recovered', () => {
    const db = createTestDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO async_tasks (id, type, status, progress, message, error, resource_id, created_at, updated_at)
       VALUES (?, 'background_extraction', 'cancelling', 20, '', '用户已取消', '42', ?, ?)`
    ).run('task-orphan-cancelling', now, now);

    const count = taskService.failOrphanedAsyncTasksOnStartup(db, { warn() {}, info() {} });

    const task = taskService.getTask(db, 'task-orphan-cancelling');
    assert.equal(count, 1);
    assert.equal(task.status, 'failed');
    assert.equal(task.error, taskService.ORPHAN_ASYNC_TASK_MSG);
  });

  it('does not register an in-memory operation before an outer transaction commits', () => {
    const db = createTestDb();
    let taskId;
    const createThenRollback = db.transaction(() => {
      const task = taskService.createTask(db, { info() {} }, 'video_generation', '42');
      taskId = task.id;
      throw new Error('rollback');
    });

    assert.throws(() => createThenRollback(), /rollback/);
    assert.equal(taskService.getTask(db, taskId), null);
    assert.equal(getOperation('task', taskId), null);
  });

  it('keeps cancellation terminal when a worker reports late progress or success', async () => {
    const db = createTestDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at)
       VALUES (?, ?, ?, 0, '', ?, ?, ?)`
    ).run('task-cancel-race', 'video_generation', 'processing', '42', now, now);

    await taskService.cancelTask(db, { info() {} }, 'task-cancel-race');

    assert.equal(taskService.updateTaskStatus(db, 'task-cancel-race', 'processing', 80, 'late'), false);
    assert.equal(taskService.updateTaskResult(db, 'task-cancel-race', { video_url: 'late.mp4' }), false);
    assert.equal(taskService.updateTaskError(db, 'task-cancel-race', 'late failure'), false);

    const task = taskService.getTask(db, 'task-cancel-race');
    assert.equal(task.status, 'cancelled');
    assert.equal(task.progress, 0);
    assert.equal(task.error, taskService.USER_CANCEL_TASK_MSG);
    assert.equal(task.result, null);
  });

  it('does not cancel a task that completed first', async () => {
    const db = createTestDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at)
       VALUES (?, ?, ?, 0, '', ?, ?, ?)`
    ).run('task-complete-race', 'video_generation', 'processing', '42', now, now);

    assert.equal(taskService.updateTaskResult(db, 'task-complete-race', { video_url: 'done.mp4' }), true);
    const result = await taskService.cancelTask(db, { info() {} }, 'task-complete-race');

    assert.equal(result.already_done, true);
    assert.equal(taskService.getTask(db, 'task-complete-race').status, 'completed');
  });
});
