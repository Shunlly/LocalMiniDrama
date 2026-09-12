const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const assetService = require('../src/services/assetService');
const episodeStoryboardService = require('../src/services/episodeStoryboardService');
const imageService = require('../src/services/imageService');
const videoService = require('../src/services/videoService');
const videoMergeService = require('../src/services/videoMergeService');
const dramaWriteGuard = require('../src/services/dramaWriteGuard');
const { createStorageStaticMiddleware } = require('../src/app');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY, title TEXT, status TEXT, metadata TEXT,
      created_at TEXT, deleted_at TEXT, trash_state TEXT, recycle_phase TEXT
    );
    CREATE TABLE episodes (id INTEGER PRIMARY KEY, drama_id INTEGER, deleted_at TEXT);
    CREATE TABLE storyboards (id INTEGER PRIMARY KEY, episode_id INTEGER, deleted_at TEXT);
    CREATE TABLE assets (id INTEGER PRIMARY KEY, drama_id INTEGER, name TEXT, url TEXT, local_path TEXT, deleted_at TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE image_generations (id INTEGER PRIMARY KEY, drama_id INTEGER, storyboard_id INTEGER, scene_id INTEGER, character_id INTEGER, local_path TEXT, image_url TEXT, status TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT);
    CREATE TABLE video_generations (id INTEGER PRIMARY KEY, drama_id INTEGER, storyboard_id INTEGER, local_path TEXT, video_url TEXT, status TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT);
    CREATE TABLE video_merges (id INTEGER PRIMARY KEY, episode_id INTEGER, drama_id INTEGER, merged_url TEXT, status TEXT, created_at TEXT, deleted_at TEXT);
    INSERT INTO dramas VALUES
      (1, '可读项目', 'draft', NULL, '2026-01-01', NULL, NULL, NULL),
      (2, '回收项目', 'draft', NULL, '2026-01-01', NULL, 'recycling', 'claimed'),
      (3, '已删除项目', 'trash', NULL, '2026-01-01', '2026-01-02', NULL, 'completed'),
      (4, '另一个可读项目', 'draft', NULL, '2026-01-01', NULL, NULL, NULL);
    INSERT INTO episodes VALUES (101, 1, NULL), (202, 2, NULL), (303, 3, NULL), (404, 4, NULL);
    INSERT INTO storyboards VALUES (1001, 101, NULL), (2002, 202, NULL), (4004, 404, NULL);
    INSERT INTO assets VALUES
      (1, 1, 'active', '/static/projects/active.png', 'projects/active.png', NULL, '2026-01-01', '2026-01-01'),
      (2, 2, 'recycling', '/static/projects/recycling.png', 'projects/recycling.png', NULL, '2026-01-01', '2026-01-01'),
      (3, NULL, 'global', '/static/library/global.png', 'library/global.png', NULL, '2026-01-01', '2026-01-01');
    INSERT INTO image_generations VALUES
      (11, 1, 1001, NULL, NULL, 'projects/active-image.png', '/static/projects/active-image.png', 'completed', '2026-01-01', '2026-01-01', NULL),
      (12, 2, 2002, NULL, NULL, 'projects/recycling-image.png', '/static/projects/recycling-image.png', 'completed', '2026-01-01', '2026-01-01', NULL),
      (13, 1, 2002, NULL, NULL, 'projects/mixed-image.png', '/static/projects/mixed-image.png', 'completed', '2026-01-01', '2026-01-01', NULL),
      (14, NULL, NULL, NULL, NULL, 'library/global-image.png', '/static/library/global-image.png', 'completed', '2026-01-01', '2026-01-01', NULL);
    INSERT INTO video_generations VALUES
      (21, 1, 1001, 'projects/active-video.mp4', '/static/projects/active-video.mp4', 'completed', '2026-01-01', '2026-01-01', NULL),
      (22, 2, 2002, 'projects/recycling-video.mp4', '/static/projects/recycling-video.mp4', 'completed', '2026-01-01', '2026-01-01', NULL),
      (23, 1, 2002, 'projects/mixed-video.mp4', '/static/projects/mixed-video.mp4', 'completed', '2026-01-01', '2026-01-01', NULL);
    INSERT INTO video_merges VALUES
      (31, 101, 1, 'projects/active-merge.mp4', 'completed', '2026-01-01', NULL),
      (32, 202, 2, 'projects/recycling-merge.mp4', 'completed', '2026-01-01', NULL),
      (33, 101, 4, 'projects/mixed-merge.mp4', 'completed', '2026-01-01', NULL);
  `);
  return db;
}

test('回收中和已回收父项目的五类子资源读取均 fail closed，空数据保持空结果', () => {
  const db = createDb();
  try {
    assert.deepEqual(assetService.list(db, {}).items.map((item) => item.id), [3, 1]);
    assert.equal(assetService.getById(db, 2), null);
    assert.deepEqual(episodeStoryboardService.getStoryboardsForEpisode(db, 202), []);
    assert.deepEqual(episodeStoryboardService.getStoryboardsForEpisode(db, 303), []);
    assert.deepEqual(imageService.list(db, {}).items.map((item) => item.id), [14, 11]);
    assert.equal(imageService.getById(db, 12), null);
    assert.equal(imageService.getById(db, 13), null);
    assert.deepEqual(videoService.list(db, {}).items.map((item) => item.id), [21]);
    assert.equal(videoService.getById(db, 22), null);
    assert.equal(videoService.getById(db, 23), null);
    assert.deepEqual(videoMergeService.list(db, {}), [videoMergeService.getById(db, 31)]);
    assert.equal(videoMergeService.getById(db, 32), null);
    assert.equal(videoMergeService.getById(db, 33), null);
    assert.equal(assetService.list(db, { drama_id: 2 }).total, 0);
    assert.equal(imageService.list(db, { drama_id: 3 }).total, 0);
    assert.equal(videoService.list(db, { drama_id: 2 }).total, 0);
    assert.deepEqual(videoMergeService.list(db, { drama_id: 2 }), []);
  } finally {
    db.close();
  }
});

test('资源的直接 drama_id 与关联 episode 项目 ID 不相等时拒绝读取', () => {
  const db = createDb();
  try {
    assert.equal(dramaWriteGuard.canReadResource(db, 'image_generations', 13), false);
    assert.equal(dramaWriteGuard.canReadResource(db, 'video_generations', 23), false);
    assert.equal(dramaWriteGuard.canReadResource(db, 'video_merges', 33), false);
    assert.throws(
      () => dramaWriteGuard.assertMediaPathReadable(db, 'projects/mixed-image.png'),
      (error) => error.code === 'RESOURCE_NOT_FOUND'
    );
  } finally {
    db.close();
  }
});

test('静态媒体路径校验父项目状态，未知受保护路径拒绝而公共 library 路径可读', () => {
  const db = createDb();
  try {
    assert.equal(dramaWriteGuard.assertMediaPathReadable(db, 'projects/active-image.png'), true);
    assert.throws(
      () => dramaWriteGuard.assertMediaPathReadable(db, 'projects/recycling-image.png'),
      (error) => error.code === 'RESOURCE_NOT_FOUND'
    );
    assert.throws(
      () => dramaWriteGuard.assertMediaPathReadable(db, 'projects/not-registered.png'),
      (error) => error.code === 'RESOURCE_NOT_FOUND'
    );
    assert.equal(dramaWriteGuard.assertMediaPathReadable(db, 'library/unknown.png'), true);
  } finally {
    db.close();
  }
});

test('实际静态挂载不会为回收项目或未登记的受保护路径提供文件', async () => {
  const db = createDb();
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-static-boundary-'));
  const app = express();
  app.use('/static', createStorageStaticMiddleware(storageRoot, { warnw() {} }, db));
  fs.mkdirSync(path.join(storageRoot, 'projects'), { recursive: true });
  fs.mkdirSync(path.join(storageRoot, 'library'), { recursive: true });
  fs.writeFileSync(path.join(storageRoot, 'projects', 'active-image.png'), 'active');
  fs.writeFileSync(path.join(storageRoot, 'projects', 'recycling-image.png'), 'recycling');
  fs.writeFileSync(path.join(storageRoot, 'library', 'unknown.png'), 'global');
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const base = `http://127.0.0.1:${server.address().port}/static`;
    assert.equal((await fetch(`${base}/projects/active-image.png`)).status, 200);
    assert.equal((await fetch(`${base}/projects/recycling-image.png`)).status, 404);
    assert.equal((await fetch(`${base}/projects/not-registered.png`)).status, 404);
    assert.equal((await fetch(`${base}/library/unknown.png`)).status, 200);
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    db.close();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  }
});

test('asset 更新和删除在父项目回收后拒绝，活动项目仍可正常更新', () => {
  const db = createDb();
  try {
    assert.equal(assetService.update(db, {}, 1, { name: 'updated' }).name, 'updated');
    assert.throws(
      () => assetService.update(db, {}, 2, { name: 'must reject' }),
      (error) => error.code === 'DRAMA_RECYCLE_IN_PROGRESS'
    );
    assert.throws(
      () => assetService.deleteById(db, {}, 2),
      (error) => error.code === 'DRAMA_RECYCLE_IN_PROGRESS'
    );
    assert.equal(db.prepare('SELECT name, deleted_at FROM assets WHERE id = 2').get().name, 'recycling');
  } finally {
    db.close();
  }
});
