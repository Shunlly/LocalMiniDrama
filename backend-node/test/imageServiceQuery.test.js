const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');

const imageService = require('../src/services/imageService');
const query = require('../src/services/imageServiceQuery');
const { rowToItem } = require('../src/services/imageServiceAssembly');

const DRAMA_ACTIVE = 11;
const DRAMA_RECYCLING = 22;
const DRAMA_OTHER = 33;
const EPISODE_ACTIVE = 1101;
const EPISODE_RECYCLING = 2202;
const EPISODE_OTHER = 3303;
const STORYBOARD_ACTIVE = 4404;
const STORYBOARD_RECYCLING = 5505;
const STORYBOARD_OTHER = 6606;
const STORYBOARD_MIXED = 7707;
const SCENE_ACTIVE = 8808;
const SCENE_DELETED = 9909;
const SCENE_OTHER = 10101;
const IMAGE_ACTIVE = 11111;
const IMAGE_RECYCLING = 12222;
const IMAGE_MIXED = 13333;
const IMAGE_GLOBAL = 14444;
const IMAGE_DELETED = 15555;
const IMAGE_OTHER = 16666;

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY, title TEXT, status TEXT, metadata TEXT,
      created_at TEXT, deleted_at TEXT, trash_state TEXT, recycle_phase TEXT
    );
    CREATE TABLE episodes (id INTEGER PRIMARY KEY, drama_id INTEGER, deleted_at TEXT);
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY, episode_id INTEGER, scene_id INTEGER,
      storyboard_number INTEGER, deleted_at TEXT
    );
    CREATE TABLE scenes (
      id INTEGER PRIMARY KEY, drama_id INTEGER, location TEXT, time TEXT, prompt TEXT,
      image_url TEXT, local_path TEXT, status TEXT, deleted_at TEXT
    );
    CREATE TABLE characters (id INTEGER PRIMARY KEY, drama_id INTEGER, deleted_at TEXT);
    CREATE TABLE image_generations (
      id INTEGER PRIMARY KEY, drama_id INTEGER, storyboard_id INTEGER, scene_id INTEGER,
      character_id INTEGER, provider TEXT, prompt TEXT, model TEXT, image_url TEXT,
      local_path TEXT, status TEXT, task_id TEXT, error_msg TEXT, frame_type TEXT,
      created_at TEXT, updated_at TEXT, completed_at TEXT, deleted_at TEXT
    );
    INSERT INTO dramas VALUES
      (${DRAMA_ACTIVE}, '可读', 'draft', NULL, '2026-01-01', NULL, NULL, NULL),
      (${DRAMA_RECYCLING}, '回收中', 'draft', NULL, '2026-01-01', NULL, 'recycling', 'claimed'),
      (${DRAMA_OTHER}, '另一个可读', 'draft', NULL, '2026-01-01', NULL, NULL, NULL);
    INSERT INTO episodes VALUES
      (${EPISODE_ACTIVE}, ${DRAMA_ACTIVE}, NULL),
      (${EPISODE_RECYCLING}, ${DRAMA_RECYCLING}, NULL),
      (${EPISODE_OTHER}, ${DRAMA_OTHER}, NULL);
    INSERT INTO storyboards VALUES
      (${STORYBOARD_ACTIVE}, ${EPISODE_ACTIVE}, ${SCENE_ACTIVE}, 1, NULL),
      (${STORYBOARD_RECYCLING}, ${EPISODE_RECYCLING}, NULL, 1, NULL),
      (${STORYBOARD_OTHER}, ${EPISODE_OTHER}, ${SCENE_OTHER}, 1, NULL),
      (${STORYBOARD_MIXED}, ${EPISODE_OTHER}, NULL, 2, NULL);
    INSERT INTO scenes VALUES
      (${SCENE_ACTIVE}, ${DRAMA_ACTIVE}, '码头', '夜', '雨', '/static/a.png', 'projects/a.png', 'generated', NULL),
      (${SCENE_DELETED}, ${DRAMA_ACTIVE}, '已删', '日', '空', '/static/d.png', 'projects/d.png', 'generated', '2026-01-02'),
      (${SCENE_OTHER}, ${DRAMA_OTHER}, '山道', '晨', '雾', '/static/b.png', 'projects/b.png', 'generated', NULL);
    INSERT INTO image_generations
      (id, drama_id, storyboard_id, scene_id, character_id, provider, prompt, model, image_url, local_path, status, frame_type, created_at, updated_at, deleted_at)
    VALUES
      (${IMAGE_ACTIVE}, ${DRAMA_ACTIVE}, ${STORYBOARD_ACTIVE}, ${SCENE_ACTIVE}, NULL, 'openai', 'A', 'm', '/static/a.png', 'projects/a.png', 'completed', 'first', '2026-01-03', '2026-01-03', NULL),
      (${IMAGE_RECYCLING}, ${DRAMA_RECYCLING}, ${STORYBOARD_RECYCLING}, NULL, NULL, 'openai', 'B', 'm', '/static/r.png', 'projects/r.png', 'completed', 'first', '2026-01-02', '2026-01-02', NULL),
      (${IMAGE_MIXED}, ${DRAMA_ACTIVE}, ${STORYBOARD_MIXED}, NULL, NULL, 'openai', 'C', 'm', '/static/m.png', 'projects/m.png', 'completed', 'last', '2026-01-04', '2026-01-04', NULL),
      (${IMAGE_GLOBAL}, NULL, NULL, NULL, NULL, 'upload', 'G', NULL, '/static/g.png', 'library/g.png', 'completed', NULL, '2026-01-05', '2026-01-05', NULL),
      (${IMAGE_DELETED}, ${DRAMA_ACTIVE}, ${STORYBOARD_ACTIVE}, NULL, NULL, 'openai', 'D', 'm', '/static/x.png', 'projects/x.png', 'completed', 'first', '2026-01-01', '2026-01-01', '2026-01-06'),
      (${IMAGE_OTHER}, ${DRAMA_OTHER}, ${STORYBOARD_OTHER}, ${SCENE_OTHER}, NULL, 'openai', 'E', 'm', '/static/e.png', 'projects/e.png', 'pending', 'first', '2026-01-06', '2026-01-06', NULL);
  `);
  return db;
}

test('跨模块 ID 在测试数据里互不相等，避免碰巧同值假通过', () => {
  const ids = [
    DRAMA_ACTIVE, DRAMA_RECYCLING, DRAMA_OTHER,
    EPISODE_ACTIVE, EPISODE_RECYCLING, EPISODE_OTHER,
    STORYBOARD_ACTIVE, STORYBOARD_RECYCLING, STORYBOARD_OTHER, STORYBOARD_MIXED,
    SCENE_ACTIVE, SCENE_DELETED, SCENE_OTHER,
    IMAGE_ACTIVE, IMAGE_RECYCLING, IMAGE_MIXED, IMAGE_GLOBAL, IMAGE_DELETED, IMAGE_OTHER,
  ];
  assert.equal(new Set(ids).size, ids.length);
});

test('imageService 公开查询 API 仍指向查询模块的同一函数', () => {
  assert.equal(imageService.list, query.list);
  assert.equal(imageService.getById, query.getById);
  assert.equal(imageService.getBackgroundsForEpisode, query.getBackgroundsForEpisode);
});

test('列表按权限 fail closed，并支持状态/分镜过滤与分页', () => {
  const db = createDb();
  try {
    const all = query.list(db, {});
    assert.deepEqual(all.items.map((item) => item.id), [IMAGE_OTHER, IMAGE_GLOBAL, IMAGE_ACTIVE]);
    assert.equal(all.total, 3);
    assert.equal(all.items.every((item) => item.scene_id !== null || item.id === IMAGE_GLOBAL), true);
    assert.equal(query.list(db, { drama_id: DRAMA_RECYCLING }).total, 0);
    assert.deepEqual(query.list(db, { drama_id: DRAMA_RECYCLING }).items, []);
    assert.equal(query.list(db, { drama_id: DRAMA_ACTIVE }).total, 1);
    assert.deepEqual(query.list(db, { drama_id: DRAMA_ACTIVE }).items.map((item) => item.id), [IMAGE_ACTIVE]);
    assert.deepEqual(
      query.list(db, { storyboard_id: STORYBOARD_OTHER, status: 'pending' }).items.map((item) => item.id),
      [IMAGE_OTHER]
    );
    assert.deepEqual(query.list(db, { frame_type: 'last' }).items, []);
    const page = query.list(db, { page: 2, page_size: 1 });
    assert.equal(page.page, 2);
    assert.equal(page.pageSize, 1);
    assert.equal(page.total, 3);
    assert.deepEqual(page.items.map((item) => item.id), [IMAGE_GLOBAL]);
  } finally {
    db.close();
  }
});

test('详情读取区分权限校验与作用域已通过后的装配', () => {
  const db = createDb();
  try {
    assert.deepEqual(query.getById(db, IMAGE_ACTIVE), rowToItem(db.prepare('SELECT * FROM image_generations WHERE id = ?').get(IMAGE_ACTIVE)));
    assert.equal(query.getById(db, IMAGE_RECYCLING), null);
    assert.equal(query.getById(db, IMAGE_MIXED), null);
    assert.equal(query.getById(db, IMAGE_DELETED), null);
    assert.equal(query.getById(db, 99999), null);
    const recyclingRow = query.getByIdAfterScopeValidation(db, IMAGE_RECYCLING);
    assert.equal(recyclingRow.id, IMAGE_RECYCLING);
    assert.equal(recyclingRow.status, 'completed');
    assert.equal(query.getByIdAfterScopeValidation(db, IMAGE_DELETED), null);
  } finally {
    db.close();
  }
});

test('剧集背景图跳过不可读剧集、已删除分镜和已删除场景', () => {
  const db = createDb();
  try {
    db.prepare(
      `INSERT INTO storyboards (id, episode_id, scene_id, storyboard_number, deleted_at)
       VALUES (17777, ?, ?, 2, NULL), (18888, ?, ?, 3, '2026-01-07')`
    ).run(EPISODE_ACTIVE, SCENE_DELETED, EPISODE_ACTIVE, SCENE_ACTIVE);
    assert.deepEqual(query.getBackgroundsForEpisode(db, EPISODE_ACTIVE), [
      {
        scene_id: SCENE_ACTIVE,
        location: '码头',
        time: '夜',
        prompt: '雨',
        image_url: '/static/a.png',
        local_path: 'projects/a.png',
        status: 'generated',
      },
    ]);
    assert.deepEqual(query.getBackgroundsForEpisode(db, EPISODE_RECYCLING), []);
    assert.deepEqual(query.getBackgroundsForEpisode(db, 19999), []);
  } finally {
    db.close();
  }
});

test('生成作用域在项目 ID 与分镜所属项目不相等时返回中文 BAD_REQUEST', () => {
  const db = createDb();
  try {
    assert.deepEqual(
      query.resolveImageGenerationScope(db, { drama_id: DRAMA_ACTIVE, storyboard_id: STORYBOARD_ACTIVE }),
      { dramaId: DRAMA_ACTIVE, storyboardId: STORYBOARD_ACTIVE }
    );
    assert.deepEqual(
      query.resolveImageGenerationScope(db, { storyboard_id: String(STORYBOARD_OTHER) }),
      { dramaId: DRAMA_OTHER, storyboardId: STORYBOARD_OTHER }
    );
    assert.throws(
      () => query.resolveImageGenerationScope(db, { drama_id: DRAMA_ACTIVE, storyboard_id: STORYBOARD_OTHER }),
      (error) => error.code === 'BAD_REQUEST' && error.message === '分镜不属于当前项目'
    );
    assert.throws(
      () => query.resolveImageGenerationScope(db, { drama_id: { nested: DRAMA_ACTIVE } }),
      (error) => error.code === 'BAD_REQUEST' && error.message === '项目 ID 无效'
    );
    assert.throws(
      () => query.resolveImageGenerationScope(db, { storyboard_id: 0 }),
      (error) => error.code === 'BAD_REQUEST' && error.message === '分镜 ID 无效'
    );
    assert.equal(query.normalizeScopeId(0, 'drama_id', true), 0);
    assert.throws(
      () => query.normalizeScopeId(-1, 'drama_id', true),
      (error) => error.code === 'BAD_REQUEST' && error.message === '项目 ID 无效'
    );
  } finally {
    db.close();
  }
});