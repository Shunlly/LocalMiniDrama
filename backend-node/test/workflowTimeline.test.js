'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const workflowService = require('../src/services/workflowService');
const timeline = require('../src/services/workflowTimeline');

const DRAMA_ID = 11;
const OTHER_DRAMA_ID = 22;
const EPISODE_ID = 1101;
const STORYBOARD_ID = 4404;

const log = { info() {}, warn() {}, error() {} };

function createDb() {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO dramas (id, title, description, style, status, created_at, updated_at)
     VALUES (?, '时间线甲', 'fixture', 'anime', 'draft', ?, ?)`
  ).run(DRAMA_ID, now, now);
  db.prepare(
    `INSERT INTO episodes (id, drama_id, episode_number, title, status, created_at, updated_at)
     VALUES (?, ?, 1, '第一集', 'draft', ?, ?)`
  ).run(EPISODE_ID, DRAMA_ID, now, now);
  db.prepare(
    `INSERT INTO storyboards
      (id, episode_id, storyboard_number, title, duration, dialogue, narration, created_at, updated_at)
     VALUES (?, ?, 1, '镜1', 5, '对白', '旁白', ?, ?)`
  ).run(STORYBOARD_ID, EPISODE_ID, now, now);
  const ids = [DRAMA_ID, OTHER_DRAMA_ID, EPISODE_ID, STORYBOARD_ID];
  assert.equal(new Set(ids).size, ids.length);
  return db;
}

test('workflowService 公开 API 仍指向时间线模块的同一函数', () => {
  assert.equal(workflowService.ensureTimelinePlan, timeline.ensureTimelinePlan);
});

test('草稿时间线会写入占位条目，生产模式才用真实成片路径', () => {
  const db = createDb();
  const draft = timeline.ensureTimelinePlan(db, log, DRAMA_ID, 'draft');
  assert.equal(draft.episode_count, 1);
  assert.ok(draft.timeline_item_created > 0);
  const draftItem = db.prepare(
    `SELECT source_path, metadata FROM timeline_items
      WHERE storyboard_id = ? AND source_path LIKE 'mock://%' LIMIT 1`
  ).get(STORYBOARD_ID);
  assert.ok(draftItem);
  assert.match(String(draftItem.metadata), /placeholder/);

  db.prepare(
    `UPDATE storyboards SET video_local_path = ?, audio_local_path = ? WHERE id = ?`
  ).run('projects/ep1/v.mp4', 'projects/ep1/d.mp3', STORYBOARD_ID);
  const production = timeline.ensureTimelinePlan(db, log, DRAMA_ID, 'production');
  assert.equal(production.episode_count, 1);
  const videoItem = db.prepare(
    `SELECT ti.source_path
       FROM timeline_items ti
       JOIN timeline_tracks tt ON tt.id = ti.track_id
      WHERE ti.storyboard_id = ? AND tt.type = 'video'`
  ).get(STORYBOARD_ID);
  assert.equal(videoItem.source_path, 'projects/ep1/v.mp4');
  assert.notEqual(DRAMA_ID, STORYBOARD_ID);
  db.close();
});

test('时间线规划不会写到不相等的其他项目', () => {
  const db = createDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO dramas (id, title, status, created_at, updated_at) VALUES (?, '时间线乙', 'draft', ?, ?)`
  ).run(OTHER_DRAMA_ID, now, now);
  timeline.ensureTimelinePlan(db, log, DRAMA_ID, 'draft');
  const otherTracks = db.prepare(
    `SELECT COUNT(*) AS n
       FROM timeline_tracks tt
       JOIN episodes e ON e.id = tt.episode_id
      WHERE e.drama_id = ?`
  ).get(OTHER_DRAMA_ID);
  assert.equal(otherTracks.n, 0);
  db.close();
});
