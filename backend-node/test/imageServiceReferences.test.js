'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const imageService = require('../src/services/imageService');
const processModule = require('../src/services/imageServiceProcess');
const { assembleImageGenerationReferences } = require('../src/services/imageServiceReferences');

const DRAMA_ID = 11;
const EPISODE_ID = 1101;
const SCENE_ID = 8808;
const STORYBOARD_ID = 4404;
const CHARACTER_ID = 5501;
const IMAGE_ID = 11111;
const FIRST_FRAME_ID = 12222;

const log = { info() {}, warn() {}, error() {} };
const LIMITS = { total: 4, maxCharacters: 3, maxObjects: 4 };

function createDb() {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO dramas (id, title, status, created_at, updated_at) VALUES (?, '参考图甲', 'draft', ?, ?)`
  ).run(DRAMA_ID, now, now);
  db.prepare(
    `INSERT INTO episodes (id, drama_id, episode_number, title, status, created_at, updated_at)
     VALUES (?, ?, 1, '第一集', 'draft', ?, ?)`
  ).run(EPISODE_ID, DRAMA_ID, now, now);
  db.prepare(
    `INSERT INTO scenes (id, drama_id, episode_id, location, time, prompt, image_url, local_path, status, created_at, updated_at)
     VALUES (?, ?, ?, '码头', '夜', '雨', '/static/scene.png', 'projects/scene.png', 'generated', ?, ?)`
  ).run(SCENE_ID, DRAMA_ID, EPISODE_ID, now, now);
  db.prepare(
    `INSERT INTO characters (id, drama_id, name, image_url, local_path, created_at, updated_at)
     VALUES (?, ?, '阿宁', '/static/char.png', 'projects/char.png', ?, ?)`
  ).run(CHARACTER_ID, DRAMA_ID, now, now);
  db.prepare(
    `INSERT INTO storyboards (id, episode_id, scene_id, title, action, dialogue, created_at, updated_at)
     VALUES (?, ?, ?, '主分镜', '阿宁在码头等雨停', '阿宁说今晚不走', ?, ?)`
  ).run(STORYBOARD_ID, EPISODE_ID, SCENE_ID, now, now);
  const ids = [DRAMA_ID, EPISODE_ID, SCENE_ID, STORYBOARD_ID, CHARACTER_ID, IMAGE_ID, FIRST_FRAME_ID];
  assert.equal(new Set(ids).size, ids.length);
  return db;
}

test('图生公开 API 仍指向执行模块，参考图装配已从执行文件拆出', () => {
  assert.equal(imageService.processImageGeneration, processModule.processImageGeneration);
  const processSource = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../src/services/imageServiceProcess.js'),
    'utf8'
  );
  assert.match(processSource, /assembleImageGenerationReferences/);
  assert.equal(processSource.includes('Step2.1 文本补扫'), false);
});

test('跨模块 ID 互不相等，避免碰巧同值假通过', () => {
  const ids = [DRAMA_ID, EPISODE_ID, SCENE_ID, STORYBOARD_ID, CHARACTER_ID, IMAGE_ID, FIRST_FRAME_ID];
  assert.equal(new Set(ids).size, ids.length);
});

test('尾帧默认注入首帧站位锁，显式关闭则不注入', () => {
  const db = createDb();
  try {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO image_generations
        (id, storyboard_id, drama_id, local_path, image_url, status, created_at, updated_at)
       VALUES (?, ?, ?, 'projects/first.png', '/static/first.png', 'completed', ?, ?)`
    ).run(FIRST_FRAME_ID, STORYBOARD_ID, DRAMA_ID, now, now);
    db.prepare(
      'UPDATE storyboards SET first_frame_image_id = ? WHERE id = ?'
    ).run(FIRST_FRAME_ID, STORYBOARD_ID);

    const locked = assembleImageGenerationReferences(db, log, {
      row: {
        id: IMAGE_ID,
        storyboard_id: STORYBOARD_ID,
        drama_id: DRAMA_ID,
        frame_type: 'last',
        use_first_frame_layout_lock: null,
        prompt: '转身',
      },
      imageGenId: IMAGE_ID,
      refLimits: LIMITS,
      elapsed: () => '0ms',
    });
    assert.ok(locked.reference_image_urls.includes('projects/first.png') || locked.reference_image_urls.includes('/static/first.png'));
    assert.match(String(locked.reference_context_note), /LAYOUT_LOCK/);
    assert.notEqual(IMAGE_ID, FIRST_FRAME_ID);

    const unlocked = assembleImageGenerationReferences(db, log, {
      row: {
        id: IMAGE_ID,
        storyboard_id: STORYBOARD_ID,
        drama_id: DRAMA_ID,
        frame_type: 'last',
        use_first_frame_layout_lock: 0,
        prompt: '转身',
      },
      imageGenId: IMAGE_ID,
      refLimits: LIMITS,
      elapsed: () => '0ms',
    });
    assert.equal(String(unlocked.reference_source || '').includes('layout-lock'), false);
  } finally {
    db.close();
  }
});

test('分镜显式清空角色后不再按台词把角色塞回参考图', () => {
  const db = createDb();
  try {
    db.prepare('UPDATE storyboards SET characters = ? WHERE id = ?').run('[]', STORYBOARD_ID);
    const assembled = assembleImageGenerationReferences(db, log, {
      row: {
        id: IMAGE_ID,
        storyboard_id: STORYBOARD_ID,
        drama_id: DRAMA_ID,
        prompt: '阿宁站在码头',
        description: '阿宁回头',
      },
      imageGenId: IMAGE_ID,
      refLimits: LIMITS,
      elapsed: () => '0ms',
    });
    const notes = String(assembled.reference_context_note || '');
    assert.equal(notes.includes('character appearance reference for "阿宁"'), false);
    assert.equal(assembled.stagedStoryboardCharacters, null);
  } finally {
    db.close();
  }
});

test('文本补扫到未关联角色时只暂存 characters，不写库', () => {
  const db = createDb();
  try {
    const assembled = assembleImageGenerationReferences(db, log, {
      row: {
        id: IMAGE_ID,
        storyboard_id: STORYBOARD_ID,
        drama_id: DRAMA_ID,
        prompt: '阿宁站在码头',
      },
      imageGenId: IMAGE_ID,
      refLimits: LIMITS,
      elapsed: () => '0ms',
    });
    assert.match(String(assembled.reference_context_note || ''), /阿宁/);
    assert.ok(assembled.stagedStoryboardCharacters);
    const persisted = db.prepare('SELECT characters FROM storyboards WHERE id = ?').get(STORYBOARD_ID);
    assert.equal(persisted.characters, null);
    const staged = JSON.parse(assembled.stagedStoryboardCharacters);
    assert.equal(staged.some((item) => Number(item.id) === CHARACTER_ID), true);
    assert.notEqual(CHARACTER_ID, STORYBOARD_ID);
  } finally {
    db.close();
  }
});
