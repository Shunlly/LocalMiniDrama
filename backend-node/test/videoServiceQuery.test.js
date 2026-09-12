const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');

const videoService = require('../src/services/videoService');
const query = require('../src/services/videoServiceQuery');
const { rowToItem } = require('../src/services/videoServiceAssembly');

const DRAMA_ACTIVE = 11;
const DRAMA_RECYCLING = 22;
const DRAMA_OTHER = 33;
const DRAMA_DELETED = 44;
const EPISODE_ACTIVE = 1101;
const EPISODE_RECYCLING = 2202;
const EPISODE_OTHER = 3303;
const EPISODE_DELETED = 4404;
const STORYBOARD_ACTIVE = 5505;
const STORYBOARD_RECYCLING = 6606;
const STORYBOARD_OTHER = 7707;
const STORYBOARD_MIXED = 8808;
const STORYBOARD_DELETED_DRAMA = 9909;
const VIDEO_ACTIVE = 11111;
const VIDEO_RECYCLING = 12222;
const VIDEO_MIXED = 13333;
const VIDEO_GLOBAL = 14444;
const VIDEO_DELETED = 15555;
const VIDEO_OTHER = 16666;
const VIDEO_RECENT_DONE = 17777;
const VIDEO_OLD_DONE = 18888;
const VIDEO_RECENT_FAILED = 19999;

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY, title TEXT, status TEXT, metadata TEXT,
      created_at TEXT, deleted_at TEXT, trash_state TEXT, recycle_phase TEXT
    );
    CREATE TABLE episodes (id INTEGER PRIMARY KEY, drama_id INTEGER, deleted_at TEXT);
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY, episode_id INTEGER, storyboard_number INTEGER, deleted_at TEXT
    );
    CREATE TABLE video_generations (
      id INTEGER PRIMARY KEY, drama_id INTEGER, storyboard_id INTEGER, provider TEXT, prompt TEXT,
      model TEXT, image_gen_id INTEGER, image_url TEXT, first_frame_url TEXT, last_frame_url TEXT,
      reference_image_urls TEXT, video_url TEXT, local_path TEXT, status TEXT, task_id TEXT,
      provider_task_id TEXT, idempotency_key TEXT, error_msg TEXT, created_at TEXT, updated_at TEXT,
      completed_at TEXT, deleted_at TEXT
    );
    INSERT INTO dramas VALUES
      (${DRAMA_ACTIVE}, '可读', 'draft', NULL, '2026-01-01', NULL, NULL, NULL),
      (${DRAMA_RECYCLING}, '回收中', 'draft', NULL, '2026-01-01', NULL, 'recycling', 'claimed'),
      (${DRAMA_OTHER}, '另一个可读', 'draft', NULL, '2026-01-01', NULL, NULL, NULL),
      (${DRAMA_DELETED}, '已删除', 'draft', NULL, '2026-01-01', '2026-01-02', NULL, NULL);
    INSERT INTO episodes VALUES
      (${EPISODE_ACTIVE}, ${DRAMA_ACTIVE}, NULL),
      (${EPISODE_RECYCLING}, ${DRAMA_RECYCLING}, NULL),
      (${EPISODE_OTHER}, ${DRAMA_OTHER}, NULL),
      (${EPISODE_DELETED}, ${DRAMA_DELETED}, NULL);
    INSERT INTO storyboards VALUES
      (${STORYBOARD_ACTIVE}, ${EPISODE_ACTIVE}, 1, NULL),
      (${STORYBOARD_RECYCLING}, ${EPISODE_RECYCLING}, 1, NULL),
      (${STORYBOARD_OTHER}, ${EPISODE_OTHER}, 1, NULL),
      (${STORYBOARD_MIXED}, ${EPISODE_OTHER}, 2, NULL),
      (${STORYBOARD_DELETED_DRAMA}, ${EPISODE_DELETED}, 1, NULL);
    INSERT INTO video_generations
      (id, drama_id, storyboard_id, prompt, status, reference_image_urls, created_at, updated_at, deleted_at)
    VALUES
      (${VIDEO_ACTIVE}, ${DRAMA_ACTIVE}, ${STORYBOARD_ACTIVE}, 'A', 'processing', '["/static/a.png"]', '2026-01-02', '2026-01-02', NULL),
      (${VIDEO_RECYCLING}, ${DRAMA_RECYCLING}, ${STORYBOARD_RECYCLING}, 'B', 'processing', NULL, '2026-01-02', '2026-01-02', NULL),
      (${VIDEO_MIXED}, ${DRAMA_ACTIVE}, ${STORYBOARD_MIXED}, 'C', 'completed', NULL, '2026-01-04', '2026-01-04', NULL),
      (${VIDEO_GLOBAL}, 0, NULL, 'G', 'completed', NULL, '2026-01-05', '2026-01-05', NULL),
      (${VIDEO_DELETED}, ${DRAMA_ACTIVE}, ${STORYBOARD_ACTIVE}, 'D', 'completed', NULL, '2026-01-01', '2026-01-01', '2026-01-06'),
      (${VIDEO_OTHER}, ${DRAMA_OTHER}, ${STORYBOARD_OTHER}, 'E', 'pending', NULL, '2026-01-06', '2026-01-06', NULL),
      (${VIDEO_RECENT_DONE}, ${DRAMA_ACTIVE}, ${STORYBOARD_ACTIVE}, 'F', 'completed', NULL, '2026-01-03', datetime('now'), NULL),
      (${VIDEO_OLD_DONE}, ${DRAMA_ACTIVE}, ${STORYBOARD_ACTIVE}, 'H', 'completed', NULL, '2026-01-01T12:00:00.000Z', '2000-01-01 00:00:00', NULL),
      (${VIDEO_RECENT_FAILED}, ${DRAMA_ACTIVE}, ${STORYBOARD_ACTIVE}, 'I', 'failed', NULL, '2026-01-04', datetime('now'), NULL);
  `);
  return db;
}

test('跨模块 ID 在测试数据里互不相等，避免碰巧同值假通过', () => {
  const ids = [
    DRAMA_ACTIVE, DRAMA_RECYCLING, DRAMA_OTHER, DRAMA_DELETED,
    EPISODE_ACTIVE, EPISODE_RECYCLING, EPISODE_OTHER, EPISODE_DELETED,
    STORYBOARD_ACTIVE, STORYBOARD_RECYCLING, STORYBOARD_OTHER, STORYBOARD_MIXED, STORYBOARD_DELETED_DRAMA,
    VIDEO_ACTIVE, VIDEO_RECYCLING, VIDEO_MIXED, VIDEO_GLOBAL, VIDEO_DELETED, VIDEO_OTHER,
    VIDEO_RECENT_DONE, VIDEO_OLD_DONE, VIDEO_RECENT_FAILED,
  ];
  assert.equal(new Set(ids).size, ids.length);
});

test('videoService 公开查询 API 仍指向查询模块的同一函数', () => {
  assert.equal(videoService.list, query.list);
  assert.equal(videoService.getById, query.getById);
});

test('列表按权限 fail closed，且 drama_id / episode_id / storyboard_id 不可互换', () => {
  const db = createDb();
  try {
    const all = query.list(db, {});
    assert.deepEqual(all.items.map((item) => item.id), [
      VIDEO_OTHER, VIDEO_GLOBAL, VIDEO_RECENT_FAILED, VIDEO_RECENT_DONE, VIDEO_ACTIVE, VIDEO_OLD_DONE,
    ]);
    assert.equal(all.total, 6);
    assert.equal(query.list(db, { drama_id: DRAMA_RECYCLING }).total, 0);
    assert.deepEqual(query.list(db, { drama_id: DRAMA_RECYCLING }).items, []);
    assert.deepEqual(
      query.list(db, { drama_id: DRAMA_ACTIVE }).items.map((item) => item.id),
      [VIDEO_RECENT_FAILED, VIDEO_RECENT_DONE, VIDEO_ACTIVE, VIDEO_OLD_DONE]
    );
    assert.deepEqual(
      query.list(db, { storyboard_id: STORYBOARD_OTHER, status: 'pending' }).items.map((item) => item.id),
      [VIDEO_OTHER]
    );
    assert.deepEqual(query.list(db, { drama_id: STORYBOARD_ACTIVE }).items, []);
    assert.deepEqual(query.list(db, { drama_id: EPISODE_ACTIVE }).items, []);
    assert.deepEqual(query.list(db, { storyboard_id: EPISODE_ACTIVE }).items, []);
    assert.deepEqual(query.list(db, { storyboard_id: DRAMA_ACTIVE }).items, []);
    const page = query.list(db, { page: 2, page_size: 1 });
    assert.equal(page.page, 2);
    assert.equal(page.pageSize, 1);
    assert.equal(page.total, 6);
    assert.deepEqual(page.items.map((item) => item.id), [VIDEO_GLOBAL]);
  } finally {
    db.close();
  }
});

test('请求 processing 时包含五分钟内刚结束的记录，但不放行不可读或过旧记录', () => {
  const db = createDb();
  try {
    assert.deepEqual(
      query.list(db, { status: 'processing' }).items.map((item) => item.id),
      [VIDEO_RECENT_FAILED, VIDEO_RECENT_DONE, VIDEO_ACTIVE]
    );
    assert.equal(
      query.list(db, { status: 'processing' }).items.some((item) => item.id === VIDEO_OLD_DONE),
      false
    );
    assert.equal(
      query.list(db, { status: 'processing' }).items.some((item) => item.id === VIDEO_RECYCLING || item.id === VIDEO_MIXED),
      false
    );
  } finally {
    db.close();
  }
});

test('详情读取区分权限校验与作用域已通过后的装配', () => {
  const db = createDb();
  try {
    const activeRow = db.prepare('SELECT * FROM video_generations WHERE id = ?').get(VIDEO_ACTIVE);
    assert.deepEqual(query.getById(db, VIDEO_ACTIVE), rowToItem(activeRow));
    assert.equal(query.getById(db, VIDEO_RECYCLING), null);
    assert.equal(query.getById(db, VIDEO_MIXED), null);
    assert.equal(query.getById(db, VIDEO_DELETED), null);
    assert.equal(query.getById(db, 99999), null);
    const recyclingRow = query.getByIdAfterScopeValidation(db, VIDEO_RECYCLING);
    assert.equal(recyclingRow.id, VIDEO_RECYCLING);
    assert.equal(recyclingRow.status, 'processing');
    assert.equal(query.getByIdAfterScopeValidation(db, VIDEO_DELETED), null);
  } finally {
    db.close();
  }
});

test('生成作用域在项目 ID 与分镜所属项目不相等时返回中文 BAD_REQUEST', () => {
  const db = createDb();
  try {
    assert.deepEqual(
      query.resolveVideoGenerationScope(db, { drama_id: DRAMA_ACTIVE, storyboard_id: STORYBOARD_ACTIVE }),
      { dramaId: DRAMA_ACTIVE, storyboardId: STORYBOARD_ACTIVE }
    );
    assert.deepEqual(
      query.resolveVideoGenerationScope(db, { storyboard_id: String(STORYBOARD_OTHER) }),
      { dramaId: DRAMA_OTHER, storyboardId: STORYBOARD_OTHER }
    );
    assert.deepEqual(
      query.resolveVideoGenerationScope(db, { episode_id: STORYBOARD_ACTIVE, drama_id: DRAMA_ACTIVE }),
      { dramaId: DRAMA_ACTIVE, storyboardId: null }
    );
    assert.throws(
      () => query.resolveVideoGenerationScope(db, { drama_id: DRAMA_ACTIVE, storyboard_id: STORYBOARD_OTHER }),
      (error) => error.code === 'BAD_REQUEST' && error.message === '分镜不存在或不属于当前项目'
    );
    assert.throws(
      () => query.resolveVideoGenerationScope(db, { drama_id: { nested: DRAMA_ACTIVE } }),
      (error) => error.code === 'BAD_REQUEST' && error.message === '项目 ID 无效'
    );
    assert.throws(
      () => query.resolveVideoGenerationScope(db, { storyboard_id: 0 }),
      (error) => error.code === 'BAD_REQUEST' && error.message === '分镜 ID 无效'
    );
    assert.equal(query.normalizeScopeId(0, 'drama_id', true), 0);
    assert.throws(
      () => query.normalizeScopeId(-1, 'drama_id', true),
      (error) => error.code === 'BAD_REQUEST' && error.message === '项目 ID 无效'
    );
    assert.equal(query.normalizeStoredDramaId(null), 0);
    assert.equal(query.normalizeStoredDramaId(''), 0);
    assert.equal(query.normalizeStoredDramaId(DRAMA_ACTIVE), DRAMA_ACTIVE);
    assert.throws(
      () => query.normalizeStoredDramaId('abc'),
      (error) => error.code === 'BAD_REQUEST' && error.message === '历史项目编号 无效'
    );
  } finally {
    db.close();
  }
});

test('作用域解析拒绝把 episode_id / storyboard_id / drama_id 当作彼此使用', () => {
  const db = createDb();
  try {
    assert.throws(
      () => query.resolveVideoGenerationScope(db, { storyboard_id: EPISODE_ACTIVE }),
      (error) => error.code === 'BAD_REQUEST' && error.message === '分镜不存在或不属于当前项目'
    );
    assert.throws(
      () => query.resolveVideoGenerationScope(db, { storyboard_id: DRAMA_ACTIVE }),
      (error) => error.code === 'BAD_REQUEST' && error.message === '分镜不存在或不属于当前项目'
    );
    assert.throws(
      () => query.resolveVideoGenerationScope(db, { drama_id: EPISODE_ACTIVE }),
      (error) => error.code === 'DRAMA_NOT_FOUND' && error.statusCode === 404
    );
    assert.throws(
      () => query.resolveVideoGenerationScope(db, { drama_id: STORYBOARD_ACTIVE }),
      (error) => error.code === 'DRAMA_NOT_FOUND' && error.statusCode === 404
    );
    assert.throws(
      () => query.resolveVideoGenerationScope(db, { storyboard_id: STORYBOARD_DELETED_DRAMA }),
      (error) => error.code === 'BAD_REQUEST' && error.message === '分镜不存在或不属于当前项目'
    );
    assert.throws(
      () => query.resolveVideoGenerationScope(db, { storyboard_id: STORYBOARD_RECYCLING }),
      (error) => error.code === 'DRAMA_RECYCLE_IN_PROGRESS' && error.statusCode === 409
    );
    query.assertDramaAcceptsVideoWrites(db, 0);
    query.assertDramaAcceptsVideoWrites(db, DRAMA_ACTIVE);
    assert.throws(
      () => query.assertDramaAcceptsVideoWrites(db, DRAMA_RECYCLING),
      (error) => error.code === 'DRAMA_RECYCLE_IN_PROGRESS'
    );
  } finally {
    db.close();
  }
});
