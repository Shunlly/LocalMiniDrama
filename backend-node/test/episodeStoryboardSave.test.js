const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const {
  saveStoryboards,
  rebuildVideoPromptForStoryboard,
} = require('../src/services/episodeStoryboardSave');
const episodeStoryboardService = require('../src/services/episodeStoryboardService');

const DRAMA_ID = 11;
const EPISODE_ID = 101;
const OTHER_EPISODE_ID = 202;
const SCENE_ID = 501;
const STORYBOARD_ID = 1001;
const OTHER_STORYBOARD_ID = 2002;

const log = { info() {}, warn() {}, error() {} };

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY, episode_id INTEGER, scene_id INTEGER,
      storyboard_number INTEGER, title TEXT, description TEXT, location TEXT, time TEXT,
      duration TEXT, dialogue TEXT, narration TEXT, action TEXT, result TEXT, atmosphere TEXT,
      image_prompt TEXT, video_prompt TEXT, characters TEXT, shot_type TEXT, angle TEXT,
      angle_h TEXT, angle_v TEXT, angle_s TEXT, movement TEXT, lighting_style TEXT,
      depth_of_field TEXT, segment_index INTEGER, segment_title TEXT, creation_mode TEXT,
      universal_segment_text TEXT, status TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT
    );
    CREATE TABLE storyboard_props (storyboard_id INTEGER, prop_id INTEGER);
  `);
  return db;
}

test('空分镜列表抛出中文错误，且不把 episode_id 写进文案', () => {
  assert.notEqual(DRAMA_ID, EPISODE_ID);
  assert.throws(
    () => saveStoryboards({}, log, EPISODE_ID, [], {}, ''),
    { message: 'AI生成分镜失败：返回的分镜数量为0' }
  );
});

test('公开 API 的 rebuildVideoPromptForStoryboard 与保存模块是同一函数', () => {
  assert.equal(episodeStoryboardService.rebuildVideoPromptForStoryboard, rebuildVideoPromptForStoryboard);
});

test('全量保存按 episode_id 软删旧镜，不改其他集', () => {
  assert.notEqual(DRAMA_ID, EPISODE_ID);
  assert.notEqual(EPISODE_ID, OTHER_EPISODE_ID);
  assert.notEqual(EPISODE_ID, STORYBOARD_ID);
  const db = createDb();
  try {
    db.prepare(`
      INSERT INTO storyboards (id, episode_id, scene_id, storyboard_number, title, status, created_at, updated_at)
      VALUES (?, ?, ?, 1, '旧镜', 'pending', '2026-01-01', '2026-01-01')
    `).run(STORYBOARD_ID, EPISODE_ID, SCENE_ID);
    db.prepare(`
      INSERT INTO storyboards (id, episode_id, scene_id, storyboard_number, title, status, created_at, updated_at)
      VALUES (?, ?, ?, 1, '其他集', 'pending', '2026-01-01', '2026-01-01')
    `).run(OTHER_STORYBOARD_ID, OTHER_EPISODE_ID, SCENE_ID);

    const saved = saveStoryboards(db, log, EPISODE_ID, [{
      shot_number: 1,
      title: '新镜',
      action: '推门',
      location: '码头',
      time: '黄昏',
      duration: 5,
    }], { style: { default_style: 'cinematic', default_video_ratio: '16:9' } }, 'cinematic');

    assert.equal(saved.length, 1);
    assert.equal(saved[0].episode_id, EPISODE_ID);
    assert.equal(saved[0].storyboard_number, 1);
    assert.equal(saved[0].title, '新镜');
    assert.notEqual(saved[0].id, STORYBOARD_ID);

    const oldRow = db.prepare('SELECT deleted_at FROM storyboards WHERE id = ?').get(STORYBOARD_ID);
    assert.equal(oldRow.deleted_at == null, false);
    const other = db.prepare('SELECT deleted_at, title FROM storyboards WHERE id = ?').get(OTHER_STORYBOARD_ID);
    assert.equal(other.deleted_at == null, true);
    assert.equal(other.title, '其他集');
  } finally {
    db.close();
  }
});
