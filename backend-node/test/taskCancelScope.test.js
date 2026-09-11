'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');

const execution = require('../src/services/taskCancelExecution');
const scope = require('../src/services/taskCancelScope');

const DRAMA_A = 11;
const DRAMA_B = 22;
const EPISODE_A = 1101;
const TASK_ID = 'task-scope-1';
const OTHER_TASK_ID = 'task-scope-2';

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY,
      title TEXT,
      status TEXT,
      deleted_at TEXT
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
      resource_id TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE video_generations (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      task_id TEXT,
      status TEXT,
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
    CREATE TABLE video_merges (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      episode_id INTEGER,
      task_id TEXT,
      status TEXT,
      error_msg TEXT,
      completed_at TEXT,
      deleted_at TEXT
    );
  `);
  db.prepare('INSERT INTO dramas (id, title, status) VALUES (?, ?, ?)').run(DRAMA_A, '甲', 'draft');
  db.prepare('INSERT INTO dramas (id, title, status) VALUES (?, ?, ?)').run(DRAMA_B, '乙', 'draft');
  db.prepare('INSERT INTO episodes (id, drama_id) VALUES (?, ?)').run(EPISODE_A, DRAMA_A);
  const ids = [DRAMA_A, DRAMA_B, EPISODE_A];
  assert.equal(new Set(ids).size, ids.length);
  assert.notEqual(TASK_ID, OTHER_TASK_ID);
  return db;
}

test('taskService 执行层仍导出作用域函数，且实现已拆到独立模块', () => {
  assert.equal(execution.imageTaskScope, scope.imageTaskScope);
  assert.equal(execution.terminalizeOwnedImageRecords, scope.terminalizeOwnedImageRecords);
  assert.equal(execution.terminalizeOwnedVideoRecords, scope.terminalizeOwnedVideoRecords);
  assert.equal(execution.terminalizeOwnedMergeRecords, scope.terminalizeOwnedMergeRecords);
});

test('图片任务 resource_id 与关联 drama_id 不相等时判定冲突', () => {
  const db = createDb();
  const task = { id: TASK_ID, type: 'image_generation', resource_id: String(DRAMA_A) };
  db.prepare(
    `INSERT INTO image_generations (drama_id, task_id, status) VALUES (?, ?, 'processing')`
  ).run(DRAMA_B, TASK_ID);
  const result = scope.imageTaskScope(db, task);
  assert.ok(result.conflict);
  assert.equal(result.conflict.expected_drama_id, String(DRAMA_A));
  assert.equal(result.conflict.actual_drama_id, String(DRAMA_B));
  db.close();
});

test('合成任务用剧集 drama_id 校验，不把 episode_id 当成项目 ID', () => {
  const db = createDb();
  const task = { id: TASK_ID, type: 'video_merge', resource_id: String(EPISODE_A) };
  db.prepare(
    `INSERT INTO video_merges (drama_id, episode_id, task_id, status) VALUES (?, ?, ?, 'processing')`
  ).run(DRAMA_B, EPISODE_A, TASK_ID);
  const conflict = scope.validateMergeTaskScope(db, task);
  assert.ok(conflict);
  assert.equal(conflict.expected_drama_id, String(DRAMA_A));
  assert.equal(conflict.actual_drama_id, String(DRAMA_B));
  assert.notEqual(String(EPISODE_A), String(DRAMA_A));
  db.close();
});

test('终态化只更新匹配 drama_id 的视频记录', () => {
  const db = createDb();
  const task = { id: TASK_ID, type: 'video_generation', resource_id: String(DRAMA_A) };
  db.prepare(
    `INSERT INTO video_generations (drama_id, task_id, status) VALUES (?, ?, 'processing')`
  ).run(DRAMA_A, TASK_ID);
  db.prepare(
    `INSERT INTO video_generations (drama_id, task_id, status) VALUES (?, ?, 'processing')`
  ).run(DRAMA_B, TASK_ID);
  scope.terminalizeOwnedVideoRecords(db, task, '用户已取消', 't1', 'cancelled');
  const rows = db.prepare(
    'SELECT drama_id, status FROM video_generations ORDER BY id'
  ).all();
  assert.equal(rows[0].drama_id, DRAMA_A);
  assert.equal(rows[0].status, 'cancelled');
  assert.equal(rows[1].drama_id, DRAMA_B);
  assert.equal(rows[1].status, 'processing');
  db.close();
});
