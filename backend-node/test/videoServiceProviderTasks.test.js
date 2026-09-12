'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const videoService = require('../src/services/videoService');
const query = require('../src/services/videoServiceQuery');
const { createVideoProviderTaskHelpers } = require('../src/services/videoServiceProviderTasks');

const DRAMA_ID = 11;
const STORYBOARD_ID = 21;
const VIDEO_ID = 101;
const OTHER_VIDEO_ID = 202;
const TASK_ID = 'task-303';
const OTHER_TASK_ID = 'task-404';
const PROVIDER_TASK_ID = 'remote-505';
const OTHER_PROVIDER_TASK_ID = 'remote-606';
const NOW = '2026-01-02T00:00:00.000Z';

const log = { info() {}, warn() {}, error() {}, debug() {} };

const MESSAGES = videoService.VIDEO_PROVIDER_TASK_MESSAGES;

function createPersistDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE video_generations (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      storyboard_id INTEGER,
      status TEXT,
      task_id TEXT,
      provider_task_id TEXT,
      error_msg TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
  `);
  return db;
}

function insertVideo(db, overrides = {}) {
  const row = {
    id: VIDEO_ID,
    drama_id: DRAMA_ID,
    storyboard_id: STORYBOARD_ID,
    status: 'pending',
    task_id: TASK_ID,
    provider_task_id: null,
    error_msg: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    deleted_at: null,
    ...overrides,
  };
  db.prepare(`
    INSERT INTO video_generations
      (id, drama_id, storyboard_id, status, task_id, provider_task_id, error_msg, created_at, updated_at, deleted_at)
    VALUES
      (@id, @drama_id, @storyboard_id, @status, @task_id, @provider_task_id, @error_msg, @created_at, @updated_at, @deleted_at)
  `).run(row);
  return row;
}

function createHelpers(overrides = {}) {
  return createVideoProviderTaskHelpers(() => ({
    messages: MESSAGES,
    activeVideoPolls: new Set(),
    pollProviderTaskAndFinalize: async () => {},
    setVideoGenFailed() {},
    isTaskCancellation: () => false,
    ...overrides,
  }));
}

test('跨模块 ID 互不相等，避免碰巧同值假通过', () => {
  const ids = [
    DRAMA_ID, STORYBOARD_ID, VIDEO_ID, OTHER_VIDEO_ID,
    TASK_ID, OTHER_TASK_ID, PROVIDER_TASK_ID, OTHER_PROVIDER_TASK_ID,
  ];
  assert.equal(new Set(ids.map(String)).size, ids.length);
});

test('create/list/delete 入口仍在 videoService，查询仍指向原模块', () => {
  assert.equal(typeof videoService.createVideoGeneration, 'function');
  assert.equal(typeof videoService.createAndProcessVideo, 'function');
  assert.equal(typeof videoService.deleteById, 'function');
  assert.equal(videoService.list, query.list);
  assert.equal(typeof videoService.resumePollForVideoGeneration, 'function');
  assert.equal(typeof videoService.resumeProcessingVideoGenerations, 'function');
  assert.equal(typeof videoService.persistProviderTaskId, 'function');
});

test('中文文案留在 videoService.js，且两处都不出现 Provider 任务 ID', () => {
  const videoSource = fs.readFileSync(path.join(__dirname, '../src/services/videoService.js'), 'utf8');
  const helperSource = fs.readFileSync(path.join(__dirname, '../src/services/videoServiceProviderTasks.js'), 'utf8');
  assert.match(videoSource, /视频任务归属已变化，拒绝写入供应商任务编号/);
  assert.match(videoSource, /供应商任务编号持久化失败/);
  assert.match(videoSource, /补偿取消迟到的供应商任务/);
  assert.match(videoSource, /服务重启后无法恢复轮询（缺少供应商任务编号），请重新生成/);
  assert.match(videoSource, /当前供应商协议 /);
  assert.match(videoSource, /不支持重启后恢复远端取消/);
  assert.equal(videoSource.includes('Provider 任务 ID'), false);
  assert.equal(helperSource.includes('Provider 任务 ID'), false);
  assert.equal(videoSource.includes('补偿取消迟到的 Provider 任务'), false);
  assert.equal(helperSource.includes('补偿取消迟到的 Provider 任务'), false);
  assert.equal(helperSource.includes('厂商任务 ID'), false);
  assert.equal(helperSource.includes('Provider 已返回任务 ID'), false);
  assert.equal(helperSource.includes('Provider 协议'), false);
  assert.equal(MESSAGES.ownershipChanged, '视频任务归属已变化，拒绝写入供应商任务编号');
  assert.equal(MESSAGES.persistFailed, '供应商任务编号持久化失败');
  assert.equal(MESSAGES.lateCancel, '补偿取消迟到的供应商任务');
  assert.equal(MESSAGES.missingOnRestart, '服务重启后无法恢复轮询（缺少供应商任务编号），请重新生成');
});

test('持久化供应商任务编号按视频行与任务编号校验，不拿项目 ID 顶替', () => {
  const db = createPersistDb();
  try {
    insertVideo(db, { id: VIDEO_ID, task_id: TASK_ID, status: 'pending' });
    insertVideo(db, {
      id: OTHER_VIDEO_ID,
      drama_id: DRAMA_ID,
      task_id: OTHER_TASK_ID,
      status: 'processing',
      provider_task_id: OTHER_PROVIDER_TASK_ID,
    });
    videoService.persistProviderTaskId(db, { id: VIDEO_ID, task_id: TASK_ID }, PROVIDER_TASK_ID, NOW);
    const written = db.prepare('SELECT * FROM video_generations WHERE id = ?').get(VIDEO_ID);
    assert.equal(written.provider_task_id, PROVIDER_TASK_ID);
    assert.equal(written.status, 'processing');
    assert.equal(written.task_id, TASK_ID);
    assert.equal(written.drama_id, DRAMA_ID);
    const other = db.prepare('SELECT provider_task_id, task_id FROM video_generations WHERE id = ?').get(OTHER_VIDEO_ID);
    assert.equal(other.provider_task_id, OTHER_PROVIDER_TASK_ID);
    assert.equal(other.task_id, OTHER_TASK_ID);
    assert.equal(db.prepare('SELECT id FROM video_generations WHERE id = ?').get(DRAMA_ID), undefined);
  } finally {
    db.close();
  }
});

test('任务编号变化、记录删除或行不存在时拒绝写入供应商任务编号', () => {
  const db = createPersistDb();
  try {
    insertVideo(db, { id: VIDEO_ID, task_id: TASK_ID, status: 'processing' });
    assert.throws(
      () => videoService.persistProviderTaskId(db, { id: VIDEO_ID, task_id: OTHER_TASK_ID }, PROVIDER_TASK_ID, NOW),
      (error) => error.message === MESSAGES.ownershipChanged
    );
    assert.throws(
      () => videoService.persistProviderTaskId(db, { id: VIDEO_ID, task_id: String(DRAMA_ID) }, PROVIDER_TASK_ID, NOW),
      (error) => error.message === MESSAGES.ownershipChanged
    );
    assert.equal(
      db.prepare('SELECT provider_task_id FROM video_generations WHERE id = ?').get(VIDEO_ID).provider_task_id,
      null
    );

    db.prepare('UPDATE video_generations SET deleted_at = ? WHERE id = ?').run(NOW, VIDEO_ID);
    assert.throws(
      () => videoService.persistProviderTaskId(db, { id: VIDEO_ID, task_id: TASK_ID }, PROVIDER_TASK_ID, NOW),
      (error) => error.message === MESSAGES.ownershipChanged
    );

    assert.throws(
      () => videoService.persistProviderTaskId(db, { id: OTHER_VIDEO_ID, task_id: TASK_ID }, PROVIDER_TASK_ID, NOW),
      (error) => error.message === MESSAGES.ownershipChanged
    );
  } finally {
    db.close();
  }
});

test('已完成视频写入供应商任务编号时保持原状态', () => {
  const db = createPersistDb();
  try {
    insertVideo(db, { id: VIDEO_ID, task_id: TASK_ID, status: 'completed' });
    videoService.persistProviderTaskId(db, { id: VIDEO_ID, task_id: TASK_ID }, PROVIDER_TASK_ID, NOW);
    const row = db.prepare('SELECT status, provider_task_id FROM video_generations WHERE id = ?').get(VIDEO_ID);
    assert.equal(row.status, 'completed');
    assert.equal(row.provider_task_id, PROVIDER_TASK_ID);
  } finally {
    db.close();
  }
});

test('更新影响行数不是 1 时视为供应商任务编号持久化失败', () => {
  const helpers = createHelpers();
  const fakeDb = {
    transaction(fn) {
      return () => fn();
    },
    prepare(sql) {
      if (sql.includes('SELECT task_id, deleted_at')) {
        return { get: () => ({ task_id: TASK_ID, deleted_at: null }) };
      }
      return { run: () => ({ changes: 0 }) };
    },
  };
  assert.throws(
    () => helpers.persistProviderTaskId(fakeDb, { id: VIDEO_ID, task_id: TASK_ID }, PROVIDER_TASK_ID, NOW),
    (error) => error.message === MESSAGES.persistFailed
  );
});

test('迟到供应商任务编号在 cancelling 时先落库再补偿取消', async () => {
  const db = createPersistDb();
  try {
    insertVideo(db, { id: VIDEO_ID, task_id: TASK_ID, status: 'processing' });
    const cancelCalls = [];
    const helpers = createHelpers({
      taskService: {
        getTask: (_db, taskId) => {
          assert.equal(taskId, TASK_ID);
          assert.notEqual(taskId, String(VIDEO_ID));
          assert.notEqual(taskId, String(DRAMA_ID));
          return { status: 'cancelling', error: null };
        },
        cancelTask: async (_db, _log, taskId, reason) => {
          cancelCalls.push({ taskId, reason });
          return { ok: true };
        },
      },
    });
    const result = await helpers.persistProviderTaskIdAndCompensateCancel(
      db, log, { id: VIDEO_ID, task_id: TASK_ID }, VIDEO_ID, PROVIDER_TASK_ID, NOW
    );
    assert.equal(result.handled, true);
    assert.equal(
      db.prepare('SELECT provider_task_id FROM video_generations WHERE id = ?').get(VIDEO_ID).provider_task_id,
      PROVIDER_TASK_ID
    );
    assert.deepEqual(cancelCalls, [{ taskId: TASK_ID, reason: MESSAGES.lateCancel }]);
  } finally {
    db.close();
  }
});

test('非 cancelling 任务只落库供应商任务编号，不触发补偿取消', async () => {
  const db = createPersistDb();
  try {
    insertVideo(db, { id: VIDEO_ID, task_id: TASK_ID, status: 'processing' });
    let cancelCalls = 0;
    const helpers = createHelpers({
      taskService: {
        getTask: () => ({ status: 'processing', error: null }),
        cancelTask: async () => {
          cancelCalls += 1;
          return { ok: true };
        },
      },
    });
    const result = await helpers.persistProviderTaskIdAndCompensateCancel(
      db, log, { id: VIDEO_ID, task_id: TASK_ID }, VIDEO_ID, PROVIDER_TASK_ID, NOW
    );
    assert.equal(result.handled, false);
    assert.equal(cancelCalls, 0);
    assert.equal(
      db.prepare('SELECT provider_task_id FROM video_generations WHERE id = ?').get(VIDEO_ID).provider_task_id,
      PROVIDER_TASK_ID
    );
  } finally {
    db.close();
  }
});

test('补偿取消仍不确定时登记对账，不把项目 ID 当成视频 ID 恢复', async () => {
  const db = createPersistDb();
  try {
    insertVideo(db, { id: VIDEO_ID, task_id: TASK_ID, status: 'processing' });
    const timers = [];
    const cancelCalls = [];
    const helpers = createHelpers({
      taskService: {
        getTask: () => ({ status: 'cancelling', error: '远端取消响应丢失' }),
        cancelTask: async (_db, _log, taskId, reason) => {
          cancelCalls.push({ taskId, reason });
          return { ok: false, reason: 'remote_cancel_uncertain' };
        },
      },
      setTimeoutFn: (fn, ms) => {
        timers.push({ fn, ms });
        return { unref() {} };
      },
    });
    const result = await helpers.persistProviderTaskIdAndCompensateCancel(
      db, log, { id: VIDEO_ID, task_id: TASK_ID }, VIDEO_ID, PROVIDER_TASK_ID, NOW
    );
    assert.equal(result.handled, true);
    assert.deepEqual(cancelCalls, [{ taskId: TASK_ID, reason: '远端取消响应丢失' }]);
    assert.notEqual(VIDEO_ID, DRAMA_ID);
    assert.equal(timers.length, 1);
    assert.equal(timers[0].ms, 2000);
    assert.equal(
      db.prepare('SELECT provider_task_id FROM video_generations WHERE id = ?').get(VIDEO_ID).provider_task_id,
      PROVIDER_TASK_ID
    );
  } finally {
    db.close();
  }
});

test('启动恢复把缺少供应商任务编号的 processing 记为失败，空白编号同样处理', () => {
  const db = createPersistDb();
  try {
    insertVideo(db, { id: VIDEO_ID, task_id: TASK_ID, status: 'processing', provider_task_id: null });
    insertVideo(db, {
      id: OTHER_VIDEO_ID,
      task_id: OTHER_TASK_ID,
      status: 'processing',
      provider_task_id: '   ',
    });
    const failed = [];
    const taskErrors = [];
    const scheduled = [];
    const helpers = createHelpers({
      setVideoGenFailed: (_db, id, message) => {
        failed.push({ id, message });
        _db.prepare('UPDATE video_generations SET status = ?, error_msg = ? WHERE id = ?')
          .run('failed', message, id);
      },
      taskService: {
        updateTaskError: (_db, taskId, message) => {
          taskErrors.push({ taskId, message });
        },
      },
      scheduleLegacyAsync: (_log, label, _fn, meta) => {
        scheduled.push({ label, meta });
      },
    });
    helpers.resumeProcessingVideoGenerations(db, log);
    assert.equal(failed.length, 2);
    assert.equal(failed.every((item) => item.message === MESSAGES.missingOnRestart), true);
    assert.deepEqual(failed.map((item) => item.id).sort((a, b) => a - b), [VIDEO_ID, OTHER_VIDEO_ID]);
    assert.deepEqual(taskErrors.map((item) => item.taskId).sort(), [OTHER_TASK_ID, TASK_ID].sort());
    assert.equal(taskErrors.every((item) => item.message === MESSAGES.missingOnRestart), true);
    assert.equal(scheduled.length, 0);
    assert.equal(db.prepare('SELECT status FROM video_generations WHERE id = ?').get(VIDEO_ID).status, 'failed');
  } finally {
    db.close();
  }
});

test('启动恢复只调度带供应商任务编号的 processing，忽略已删除和已完成', () => {
  const db = createPersistDb();
  try {
    insertVideo(db, {
      id: VIDEO_ID,
      task_id: TASK_ID,
      status: 'processing',
      provider_task_id: PROVIDER_TASK_ID,
    });
    insertVideo(db, {
      id: OTHER_VIDEO_ID,
      task_id: OTHER_TASK_ID,
      status: 'processing',
      provider_task_id: OTHER_PROVIDER_TASK_ID,
      deleted_at: NOW,
    });
    insertVideo(db, {
      id: DRAMA_ID,
      task_id: 'task-drama-not-video',
      status: 'completed',
      provider_task_id: 'should-not-resume',
    });
    const scheduled = [];
    const helpers = createHelpers({
      scheduleLegacyAsync: (_log, label, _fn, meta) => {
        scheduled.push({ label, meta });
        return 'job';
      },
    });
    helpers.resumeProcessingVideoGenerations(db, log);
    assert.deepEqual(scheduled, [
      { label: 'video_generation_poll_resume', meta: { video_generation_id: VIDEO_ID } },
    ]);
  } finally {
    db.close();
  }
});

test('恢复轮询在缺少供应商任务编号或已有活动轮询时直接返回', async () => {
  const db = createPersistDb();
  try {
    insertVideo(db, { id: VIDEO_ID, task_id: TASK_ID, status: 'processing', provider_task_id: null });
    const failed = [];
    const polls = [];
    const helpers = createHelpers({
      setVideoGenFailed: (_db, id) => failed.push(id),
      pollProviderTaskAndFinalize: async () => {
        polls.push('polled');
      },
    });
    await helpers.resumePollForVideoGeneration(db, log, VIDEO_ID);
    assert.deepEqual(failed, []);
    assert.deepEqual(polls, []);

    db.prepare('UPDATE video_generations SET provider_task_id = ? WHERE id = ?').run(PROVIDER_TASK_ID, VIDEO_ID);
    const busy = createHelpers({
      activeVideoPolls: new Set([VIDEO_ID]),
      setVideoGenFailed: (_db, id) => failed.push(id),
      pollProviderTaskAndFinalize: async () => {
        polls.push('polled');
      },
    });
    await busy.resumePollForVideoGeneration(db, log, VIDEO_ID);
    assert.deepEqual(polls, []);
    assert.equal(db.prepare('SELECT status FROM video_generations WHERE id = ?').get(VIDEO_ID).status, 'processing');
  } finally {
    db.close();
  }
});

test('videoService 启动恢复对缺少供应商任务编号的记录写出中文失败原因', () => {
  const db = createPersistDb();
  try {
    insertVideo(db, { id: VIDEO_ID, task_id: null, status: 'processing', provider_task_id: '' });
    videoService.resumeProcessingVideoGenerations(db, log);
    const row = db.prepare('SELECT status, error_msg FROM video_generations WHERE id = ?').get(VIDEO_ID);
    assert.equal(row.status, 'failed');
    assert.equal(row.error_msg, MESSAGES.missingOnRestart);
  } finally {
    db.close();
  }
});
