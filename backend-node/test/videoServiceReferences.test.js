'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const videoService = require('../src/services/videoService');
const { createVideoReferenceHelpers } = require('../src/services/videoServiceReferences');

const DRAMA_ID = 11;
const OTHER_DRAMA_ID = 22;
const EPISODE_ID = 1101;
const STORYBOARD_ID = 4404;
const IMAGE_ID = 8808;
const OTHER_IMAGE_ID = 9909;

const MESSAGES = {
  invalidUrl: '参考媒体 URL 无效',
  publicHttp: '参考媒体 URL 必须是无凭据的公网 HTTP(S) 地址',
  localPath: '参考媒体本地路径必须位于本地存储目录内',
  gridIdInvalid: '宫格视频参考图 ID 无效',
  gridNeedsStoryboard: '选择宫格视频参考图时必须提供有效的分镜',
  gridNotInStoryboard: '宫格视频参考图不存在或不属于当前分镜',
  gridMissingUrl: '宫格视频参考图缺少可用地址',
  refsMustBeArray: '参考图列表必须是数组',
};

const helpers = createVideoReferenceHelpers(MESSAGES);

test('videoService 公开宫格能力判定仍来自参考图装配模块', () => {
  assert.equal(typeof videoService.videoConfigSupportsGridReference, 'function');
  assert.equal(typeof helpers.videoConfigSupportsGridReference, 'function');
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/services/videoService.js'), 'utf8');
  assert.match(source, /createVideoReferenceHelpers/);
});

test('跨模块 ID 互不相等，避免碰巧同值假通过', () => {
  const ids = [DRAMA_ID, OTHER_DRAMA_ID, EPISODE_ID, STORYBOARD_ID, IMAGE_ID, OTHER_IMAGE_ID];
  assert.equal(new Set(ids).size, ids.length);
});

test('Windows 下 /static/ 路径必须先剥前缀，不能当绝对盘符路径', () => {
  if (process.platform === 'win32') {
    assert.equal(path.win32.isAbsolute('/static/projects/a.png'), true);
  }
  assert.equal(helpers.normalizedLocalReferencePath('/static/projects/a.png'), 'projects/a.png');
  assert.equal(helpers.normalizedLocalReferencePath('\\static\\projects\\a.png'), 'projects/a.png');
  assert.equal(
    helpers.normalizeSubmittedMediaReference('/static/projects/a.png'),
    '/static/projects/a.png'
  );
  assert.equal(
    helpers.normalizeSubmittedMediaReference('http://localhost:3013/static/projects/a.png'),
    '/static/projects/a.png'
  );
});

test('非法参考图列表和无效 URL 仍返回原来的中文 BAD_REQUEST', () => {
  assert.throws(
    () => helpers.normalizeReferenceUrls('not-array'),
    (error) => error.code === 'BAD_REQUEST' && error.message === '参考图列表必须是数组'
  );
  assert.throws(
    () => helpers.normalizeSubmittedMediaReference('https://user:pass@cdn.example/a.png'),
    (error) => error.code === 'BAD_REQUEST' && error.message === '参考媒体 URL 必须是无凭据的公网 HTTP(S) 地址'
  );
});

test('宫格参考图必须属于当前分镜，drama_id 不相等时拒绝', () => {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO dramas (id, title, status, created_at, updated_at) VALUES (?, '视频甲', 'draft', ?, ?)`
  ).run(DRAMA_ID, now, now);
  db.prepare(
    `INSERT INTO dramas (id, title, status, created_at, updated_at) VALUES (?, '视频乙', 'draft', ?, ?)`
  ).run(OTHER_DRAMA_ID, now, now);
  db.prepare(
    `INSERT INTO episodes (id, drama_id, episode_number, title, status, created_at, updated_at)
     VALUES (?, ?, 1, '第一集', 'draft', ?, ?)`
  ).run(EPISODE_ID, DRAMA_ID, now, now);
  db.prepare(
    `INSERT INTO storyboards (id, episode_id, title, created_at, updated_at)
     VALUES (?, ?, '宫格分镜', ?, ?)`
  ).run(STORYBOARD_ID, EPISODE_ID, now, now);
  db.prepare(
    `INSERT INTO image_generations
      (id, storyboard_id, drama_id, frame_type, image_url, local_path, status, created_at, updated_at)
     VALUES (?, ?, ?, 'quad_grid', '/static/projects/grid.png', 'projects/grid.png', 'completed', ?, ?)`
  ).run(IMAGE_ID, STORYBOARD_ID, DRAMA_ID, now, now);

  const loaded = helpers.loadVideoReferenceImage(db, STORYBOARD_ID, DRAMA_ID, IMAGE_ID);
  assert.equal(loaded.id, IMAGE_ID);
  assert.equal(loaded.canonical, '/static/projects/grid.png');
  assert.notEqual(IMAGE_ID, STORYBOARD_ID);
  assert.notEqual(DRAMA_ID, OTHER_DRAMA_ID);

  assert.throws(
    () => helpers.loadVideoReferenceImage(db, STORYBOARD_ID, OTHER_DRAMA_ID, IMAGE_ID),
    (error) => error.code === 'BAD_REQUEST' && error.message === '宫格视频参考图不存在或不属于当前分镜'
  );
  assert.throws(
    () => helpers.loadVideoReferenceImage(db, STORYBOARD_ID, DRAMA_ID, OTHER_IMAGE_ID),
    (error) => error.code === 'BAD_REQUEST' && error.message === '宫格视频参考图不存在或不属于当前分镜'
  );
  db.close();
});
