'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const videoService = require('../src/services/videoService');
const videoRoutes = require('../src/routes/videos');
const videoClient = require('../src/services/videoClient');

const log = { debug() {}, info() {}, warn() {}, error() {} };

function createDb() {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const now = '2026-08-02T00:00:00.000Z';
  db.prepare(
    `INSERT INTO dramas (id, title, status, metadata, created_at, updated_at, deleted_at)
     VALUES (1, '项目一', 'draft', '{}', ?, ?, NULL),
            (2, '项目二', 'draft', '{}', ?, ?, NULL),
            (3, '已删除项目', 'draft', '{}', ?, ?, ?)`
  ).run(now, now, now, now, now, now, now);
  db.prepare(
    `INSERT INTO episodes (id, drama_id, episode_number, title, status, created_at, updated_at, deleted_at)
     VALUES (10, 1, 1, '第一集', 'draft', ?, ?, NULL),
            (20, 2, 1, '第二集', 'draft', ?, ?, NULL),
            (30, 3, 1, '已删除项目的集', 'draft', ?, ?, NULL)`
  ).run(now, now, now, now, now, now);
  db.prepare(
    `INSERT INTO storyboards (id, episode_id, storyboard_number, title, status, created_at, updated_at, deleted_at)
     VALUES (100, 10, 1, '项目一分镜', 'pending', ?, ?, NULL),
            (200, 20, 1, '项目二分镜', 'pending', ?, ?, NULL),
            (300, 30, 1, '已删除项目分镜', 'pending', ?, ?, NULL)`
  ).run(now, now, now, now, now, now);
  return db;
}

function responseRecorder() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function assertNoTask(db) {
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM async_tasks').get().count, 0);
}

function insertVideo(db, options = {}) {
  const now = '2026-08-02T00:00:00.000Z';
  const dramaId = Object.prototype.hasOwnProperty.call(options, 'dramaId')
    ? options.dramaId
    : 2;
  const storyboardId = Object.prototype.hasOwnProperty.call(options, 'storyboardId')
    ? options.storyboardId
    : 200;
  db.prepare(
    `INSERT INTO video_generations
     (drama_id, storyboard_id, prompt, status, idempotency_key, created_at, updated_at, deleted_at)
     VALUES (?, ?, '已有视频', 'processing', ?, ?, ?, ?)`
  ).run(
    dramaId,
    storyboardId,
    options.idempotencyKey,
    now,
    now,
    options.deletedAt ?? null
  );
}

test('视频服务拒绝跨项目幂等键且不创建任务', () => {
  const db = createDb();
  try {
    insertVideo(db, { idempotencyKey: 'cross-project-key' });
    assert.throws(
      () => videoService.createVideoGeneration(db, log, {
        drama_id: 1, storyboard_id: 100, idempotency_key: 'cross-project-key',
      }, { defer_processing: true }),
      (error) => error.code === 'BAD_REQUEST' && /idempotency_key/.test(error.message)
    );
    assertNoTask(db);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM video_generations').get().count, 1);
  } finally {
    db.close();
  }
});

test('视频服务仅复用完全相同的真实 drama 和 storyboard 作用域', () => {
  const db = createDb();
  try {
    insertVideo(db, { idempotencyKey: 'same-scope-key' });
    const reused = videoService.createVideoGeneration(db, log, {
      drama_id: 2, storyboard_id: 200, idempotency_key: 'same-scope-key',
    }, { defer_processing: true });
    assert.equal(reused.idempotent_reuse, true);
    assert.equal(reused.drama_id, 2);
    assert.equal(reused.storyboard_id, 200);
    assertNoTask(db);
  } finally {
    db.close();
  }
});

test('视频服务拒绝软删除幂等记录和历史脏归属且不创建任务', () => {
  for (const fixture of [
    { key: 'deleted-video-key', deletedAt: '2026-08-01T00:00:00.000Z', dramaId: 2, storyboardId: 200 },
    { key: 'dirty-video-key', dramaId: 1, storyboardId: 200 },
  ]) {
    const db = createDb();
    try {
      insertVideo(db, {
        idempotencyKey: fixture.key,
        dramaId: fixture.dramaId,
        storyboardId: fixture.storyboardId,
        deletedAt: fixture.deletedAt,
      });
      assert.throws(
        () => videoService.createVideoGeneration(db, log, {
          drama_id: 2, storyboard_id: 200, idempotency_key: fixture.key,
        }, { defer_processing: true }),
        (error) => error.code === 'BAD_REQUEST' && /idempotency_key/.test(error.message)
      );
      assertNoTask(db);
    } finally {
      db.close();
    }
  }
});

test('视频服务拒绝不存在或已删除的显式 drama 与宫格参考图链路', () => {
  const db = createDb();
  try {
    const now = '2026-08-02T00:00:00.000Z';
    db.prepare(
      `INSERT INTO image_generations
       (drama_id, storyboard_id, frame_type, image_url, status, created_at, updated_at)
       VALUES (3, 300, 'quad_grid', '/static/projects/deleted/grid.png', 'completed', ?, ?)`
    ).run(now, now);
    const deletedDramaGridId = Number(db.prepare(
      `SELECT id FROM image_generations
       WHERE storyboard_id = 300 AND frame_type = 'quad_grid'`
    ).get().id);
    for (const { body, code, statusCode } of [
      {
        body: { drama_id: 999, idempotency_key: 'missing-drama-key' },
        code: 'DRAMA_NOT_FOUND',
        statusCode: 404,
      },
      {
        body: { drama_id: 3, idempotency_key: 'deleted-drama-key' },
        code: 'DRAMA_NOT_FOUND',
        statusCode: 404,
      },
      {
        body: {
          storyboard_id: 300,
          video_reference_image_id: deletedDramaGridId,
          idempotency_key: 'deleted-grid-chain-key',
        },
        code: 'BAD_REQUEST',
      },
    ]) {
      assert.throws(
        () => videoService.createVideoGeneration(db, log, body, { defer_processing: true }),
        (error) => error.code === code
          && (statusCode === undefined || error.statusCode === statusCode)
      );
    }
    assertNoTask(db);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM video_generations').get().count, 0);
  } finally {
    db.close();
  }
});

test('视频服务保留无项目且无分镜的全局作用域语义', () => {
  const db = createDb();
  try {
    insertVideo(db, { dramaId: 0, storyboardId: null, idempotencyKey: 'global-video-key' });
    const reused = videoService.createVideoGeneration(db, log, {
      idempotency_key: 'global-video-key',
    }, { defer_processing: true });
    assert.equal(reused.idempotent_reuse, true);
    assert.equal(reused.drama_id, 0);
    assert.equal(reused.storyboard_id, null);
    assertNoTask(db);
  } finally {
    db.close();
  }
});

test('POST /videos 将错误作用域稳定映射为 BAD_REQUEST，且不调用 Provider', () => {
  const db = createDb();
  const originalCallVideoApi = videoClient.callVideoApi;
  let providerCalls = 0;
  videoClient.callVideoApi = async () => {
    providerCalls += 1;
    return { error: '测试不应调用 Provider' };
  };
  try {
    insertVideo(db, { idempotencyKey: 'http-cross-project-key' });
    const res = responseRecorder();
    videoRoutes(db, log).create({
      body: { drama_id: 1, storyboard_id: 100, idempotency_key: 'http-cross-project-key' },
    }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'BAD_REQUEST');
    assertNoTask(db);
    assert.equal(providerCalls, 0);
  } finally {
    videoClient.callVideoApi = originalCallVideoApi;
    db.close();
  }
});
