const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const taskService = require('../src/services/taskService');

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
      deleted_at TEXT
    );
    CREATE TABLE video_generations (
      id INTEGER PRIMARY KEY,
      task_id TEXT,
      status TEXT,
      provider_task_id TEXT,
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

  it('cancelTask marks active task as failed', () => {
    const db = createTestDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at)
       VALUES (?, ?, ?, 0, '', ?, ?, ?)`
    ).run('task-active', 'background_extraction', 'processing', '42', now, now);

    const result = taskService.cancelTask(db, { info() {} }, 'task-active');
    assert.equal(result.ok, true);
    const task = taskService.getTask(db, 'task-active');
    assert.equal(task.status, 'failed');
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

  it('keeps cancellation terminal when a worker reports late progress or success', () => {
    const db = createTestDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at)
       VALUES (?, ?, ?, 0, '', ?, ?, ?)`
    ).run('task-cancel-race', 'video_generation', 'processing', '42', now, now);

    taskService.cancelTask(db, { info() {} }, 'task-cancel-race');

    assert.equal(taskService.updateTaskStatus(db, 'task-cancel-race', 'processing', 80, 'late'), false);
    assert.equal(taskService.updateTaskResult(db, 'task-cancel-race', { video_url: 'late.mp4' }), false);
    assert.equal(taskService.updateTaskError(db, 'task-cancel-race', 'late failure'), false);

    const task = taskService.getTask(db, 'task-cancel-race');
    assert.equal(task.status, 'failed');
    assert.equal(task.progress, 0);
    assert.equal(task.error, taskService.USER_CANCEL_TASK_MSG);
    assert.equal(task.result, null);
  });

  it('does not cancel a task that completed first', () => {
    const db = createTestDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at)
       VALUES (?, ?, ?, 0, '', ?, ?, ?)`
    ).run('task-complete-race', 'video_generation', 'processing', '42', now, now);

    assert.equal(taskService.updateTaskResult(db, 'task-complete-race', { video_url: 'done.mp4' }), true);
    const result = taskService.cancelTask(db, { info() {} }, 'task-complete-race');

    assert.equal(result.already_done, true);
    assert.equal(taskService.getTask(db, 'task-complete-race').status, 'completed');
  });
});
