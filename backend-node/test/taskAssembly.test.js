'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');

const taskService = require('../src/services/taskService');
const {
  getRawTask,
  rowToTask,
  resolveTaskDramaIds,
  resolveTaskDramaScope,
  getTask,
  getTasksByResource,
} = require('../src/services/taskAssembly');

function createQueryDb() {
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
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      deleted_at TEXT
    );
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY,
      episode_id INTEGER
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
      deleted_at TEXT
    );
    CREATE TABLE image_generations (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      task_id TEXT,
      deleted_at TEXT
    );
  `);
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
    values.progress ?? 0,
    values.message || '',
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

test('行装配会带上取消状态并解析 cancel_context', () => {
  const task = rowToTask({
    id: 'task-1',
    type: 'character_extraction',
    status: 'cancelling',
    progress: null,
    message: '',
    error: '用户已取消',
    result: null,
    resource_id: '11',
    created_at: 't0',
    updated_at: 't1',
    completed_at: null,
    cancel_operation_id: 'op-1',
    cancel_state: 'requested',
    cancel_attempt: '3',
    cancel_next_retry_at: 't2',
    cancel_context: '{"scope":"task","drama_id":2}',
  });
  assert.equal(task.progress, 0);
  assert.equal(task.cancel_operation_id, 'op-1');
  assert.equal(task.cancel_state, 'requested');
  assert.equal(task.cancel_attempt, 3);
  assert.deepEqual(task.cancel_context, { scope: 'task', drama_id: 2 });
});

test('没有项目表时查询装配跳过归属，保持旧夹具可用', () => {
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
      cancel_next_retry_at TEXT
    );
  `);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at)
     VALUES ('task-skip', 'background_extraction', 'pending', 0, '', '42', ?, ?)`
  ).run(now, now);
  const task = getTask(db, 'task-skip');
  assert.equal(task.status, 'pending');
  assert.equal(Object.prototype.hasOwnProperty.call(task, 'drama_id'), false);
  db.close();
});

test('已删除任务不会被原始查询装配出来', () => {
  const db = createQueryDb();
  insertTask(db, {
    id: 'task-deleted',
    type: 'character_extraction',
    resource_id: '11',
    deleted_at: '2026-09-11T00:00:00.000Z',
  });
  assert.equal(getRawTask(db, 'task-deleted'), null);
  assert.equal(getTask(db, 'task-deleted'), null);
  db.close();
});

test('查询按 episode/character 真实关联解析项目，不把 resource_id 当 drama_id', () => {
  const db = createQueryDb();
  db.prepare("INSERT INTO dramas (id, title, status) VALUES (1, '项目一', 'draft')").run();
  db.prepare("INSERT INTO dramas (id, title, status) VALUES (2, '项目二', 'draft')").run();
  db.prepare('INSERT INTO episodes (id, drama_id) VALUES (11, 2)').run();
  db.prepare('INSERT INTO characters (id, drama_id) VALUES (12, 2)').run();
  insertTask(db, { id: 'task-ep', type: 'character_extraction', resource_id: '11' });
  insertTask(db, { id: 'task-char', type: 'image_generation', resource_id: 'character_12' });

  assert.notEqual(11, 2);
  assert.notEqual(12, 2);
  assert.equal(getTask(db, 'task-ep').drama_id, 2);
  assert.equal(getTask(db, 'task-char').drama_id, 2);
  assert.deepEqual(getTasksByResource(db, '11', { dramaId: 2 }).map((item) => item.id), ['task-ep']);
  assert.deepEqual(getTasksByResource(db, '11', { dramaId: 1 }), []);
  assert.deepEqual(getTasksByResource(db, '11', { dramaId: 0 }), []);
  db.close();
});

test('混合两个不相等 drama_id 时查询装配 fail closed', () => {
  const db = createQueryDb();
  db.prepare("INSERT INTO dramas (id, title, status) VALUES (1, '项目一', 'draft')").run();
  db.prepare("INSERT INTO dramas (id, title, status) VALUES (2, '项目二', 'draft')").run();
  insertTask(db, { id: 'task-mix', type: 'video_generation', resource_id: '1' });
  db.prepare("INSERT INTO video_generations (drama_id, task_id) VALUES (1, 'task-mix')").run();
  db.prepare("INSERT INTO video_generations (drama_id, task_id) VALUES (2, 'task-mix')").run();

  const ids = resolveTaskDramaIds(db, getRawTask(db, 'task-mix'));
  assert.deepEqual(ids.declared, [1]);
  assert.deepEqual(ids.related.sort(), [1, 2]);
  assert.throws(
    () => resolveTaskDramaScope(db, getRawTask(db, 'task-mix')),
    (error) => error.code === 'TASK_SCOPE_CONFLICT'
      && error.details.reason === 'mixed_drama_ownership'
      && error.details.expected_drama_id === '1'
      && error.details.actual_drama_id === '2'
  );
  assert.throws(() => getTask(db, 'task-mix'), (error) => error.code === 'TASK_SCOPE_CONFLICT');
  db.close();
});

test('外部查询 requireReadable 拒绝回收中的真实父项目', () => {
  const db = createQueryDb();
  db.prepare(
    "INSERT INTO dramas (id, title, status, trash_state, recycle_phase) VALUES (2, '回收中', 'draft', 'recycling', 'claimed')"
  ).run();
  db.prepare('INSERT INTO episodes (id, drama_id) VALUES (11, 2)').run();
  insertTask(db, { id: 'task-recycle', type: 'character_extraction', resource_id: '11' });

  assert.equal(getTask(db, 'task-recycle').drama_id, 2);
  assert.throws(
    () => getTask(db, 'task-recycle', { requireReadable: true }),
    (error) => error.code === 'DRAMA_RECYCLE_IN_PROGRESS'
  );
  db.close();
});

test('taskService 公开查询 API 仍指向装配模块', () => {
  assert.equal(taskService.getTask, getTask);
  assert.equal(taskService.getTasksByResource, getTasksByResource);
  assert.equal(taskService.resolveTaskDramaScope, resolveTaskDramaScope);
});

test('取消状态和查询装配已从 taskService 拆到辅助模块', () => {
  const service = fs.readFileSync(path.join(__dirname, '../src/services/taskService.js'), 'utf8');
  const cancelState = fs.readFileSync(path.join(__dirname, '../src/services/taskCancelState.js'), 'utf8');
  const assembly = fs.readFileSync(path.join(__dirname, '../src/services/taskAssembly.js'), 'utf8');
  assert.match(service, /require\('\.\/taskCancelState'\)/);
  assert.match(service, /require\('\.\/taskAssembly'\)/);
  assert.equal(service.includes('function parseCancelContext'), false);
  assert.equal(service.includes('function rowToTask'), false);
  assert.equal(service.includes('function resolveTaskDramaScope'), false);
  assert.match(cancelState, /function parseCancelContext/);
  assert.match(assembly, /function rowToTask/);
  assert.match(assembly, /function resolveTaskDramaScope/);
});


test('混合两个不相等 drama_id 时取消走公开 API 失败关闭且不改记录', async () => {
  const db = createQueryDb();
  db.prepare("INSERT INTO dramas (id, title, status) VALUES (1, '项目一', 'draft')").run();
  db.prepare("INSERT INTO dramas (id, title, status) VALUES (2, '项目二', 'draft')").run();
  insertTask(db, { id: 'task-cancel-mix', type: 'video_generation', resource_id: '1' });
  db.prepare("INSERT INTO video_generations (drama_id, task_id) VALUES (1, 'task-cancel-mix')").run();
  db.prepare("INSERT INTO video_generations (drama_id, task_id) VALUES (2, 'task-cancel-mix')").run();

  const result = await taskService.cancelTask(db, { info() {} }, 'task-cancel-mix', '混合归属取消');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'task_scope_conflict');
  assert.equal(getRawTask(db, 'task-cancel-mix').status, 'processing');
  assert.deepEqual(
    db.prepare('SELECT drama_id, task_id FROM video_generations ORDER BY id').all(),
    [
      { drama_id: 1, task_id: 'task-cancel-mix' },
      { drama_id: 2, task_id: 'task-cancel-mix' },
    ]
  );
  db.close();
});
