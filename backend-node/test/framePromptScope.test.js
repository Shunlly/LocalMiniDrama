'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { isTrustedChineseUserError } = require('../src/services/providerErrorSanitizer');
const { FRAME_PROMPT_MESSAGES } = require('../src/services/framePromptErrors');
const {
  FRAME_TYPES,
  isSupportedFrameType,
  assertSupportedFrameType,
  assertStoryboardExists,
  resolveStoryboardScope,
  loadDramaStyleRowForStoryboard,
  loadLayoutNeighborStoryboards,
} = require('../src/services/framePromptScope');

const DRAMA_ID = 11;
const OTHER_DRAMA_ID = 22;
const TRAP_DRAMA_ID = 3301;
const EPISODE_ID = 1101;
const OTHER_EPISODE_ID = 2201;
const TRAP_EPISODE_ID = 3301;
const STORYBOARD_ID = 3301;
const OTHER_STORYBOARD_ID = 4401;
const TRAP_STORYBOARD_ID = 1101;
const PREV_STORYBOARD_ID = 3001;
const TRAP_NEIGHBOR_STORYBOARD_ID = 5001;

function assertDistinctIds() {
  assert.notEqual(DRAMA_ID, OTHER_DRAMA_ID);
  assert.notEqual(DRAMA_ID, EPISODE_ID);
  assert.notEqual(DRAMA_ID, STORYBOARD_ID);
  assert.notEqual(EPISODE_ID, STORYBOARD_ID);
  assert.notEqual(EPISODE_ID, OTHER_EPISODE_ID);
  assert.notEqual(STORYBOARD_ID, OTHER_STORYBOARD_ID);
  assert.equal(TRAP_DRAMA_ID, STORYBOARD_ID);
  assert.equal(TRAP_EPISODE_ID, STORYBOARD_ID);
  assert.equal(TRAP_STORYBOARD_ID, EPISODE_ID);
}

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY,
      title TEXT,
      style TEXT,
      metadata TEXT,
      deleted_at TEXT
    );
    CREATE TABLE episodes (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      deleted_at TEXT
    );
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY,
      episode_id INTEGER,
      storyboard_number INTEGER,
      action TEXT,
      result TEXT,
      layout_description TEXT,
      deleted_at TEXT
    );
    INSERT INTO dramas (id, title, style, metadata) VALUES
      (${DRAMA_ID}, '主项目', 'ink', '{"aspect_ratio":"9:16"}'),
      (${OTHER_DRAMA_ID}, '其他项目', 'cinematic', '{"aspect_ratio":"1:1"}'),
      (${TRAP_DRAMA_ID}, '陷阱项目', 'trap-style', '{"aspect_ratio":"16:9"}');
    INSERT INTO episodes (id, drama_id) VALUES
      (${EPISODE_ID}, ${DRAMA_ID}),
      (${OTHER_EPISODE_ID}, ${OTHER_DRAMA_ID}),
      (${TRAP_EPISODE_ID}, ${TRAP_DRAMA_ID});
    INSERT INTO storyboards (id, episode_id, storyboard_number, action, result, layout_description) VALUES
      (${PREV_STORYBOARD_ID}, ${EPISODE_ID}, 1, '推门', '站住', '本集上一镜'),
      (${STORYBOARD_ID}, ${EPISODE_ID}, 2, '拿钥匙', '转身', '当前镜布局'),
      (${OTHER_STORYBOARD_ID}, ${OTHER_EPISODE_ID}, 1, '别的动作', '别的结果', '其他集布局'),
      (${TRAP_STORYBOARD_ID}, ${OTHER_EPISODE_ID}, 3, '误用剧集键', '错误邻镜', '剧集号当分镜'),
      (${TRAP_NEIGHBOR_STORYBOARD_ID}, ${TRAP_EPISODE_ID}, 1, '陷阱动作', '陷阱结果', '陷阱邻镜');
  `);
  return db;
}

test('帧类型校验返回简体中文，且不含英文字段名', () => {
  assert.deepEqual(FRAME_TYPES, ['first', 'key', 'last', 'panel', 'action']);
  assert.equal(isSupportedFrameType('first'), true);
  assert.equal(isSupportedFrameType('grid'), false);
  assert.throws(
    () => assertSupportedFrameType('grid'),
    (error) => error.message === FRAME_PROMPT_MESSAGES.UNSUPPORTED_FRAME_TYPE
  );
  assert.equal(isTrustedChineseUserError(FRAME_PROMPT_MESSAGES.UNSUPPORTED_FRAME_TYPE), true);
  assert.doesNotMatch(FRAME_PROMPT_MESSAGES.UNSUPPORTED_FRAME_TYPE, /frame_type|storyboard_id/);
});

test('分镜存在性按 storyboard_id 判断，不会把 episode_id 或 drama_id 当成分镜键', () => {
  assertDistinctIds();
  const db = createDb();
  try {
    assert.equal(assertStoryboardExists(db, STORYBOARD_ID), STORYBOARD_ID);
    assert.throws(
      () => assertStoryboardExists(db, 9999),
      (error) => error.message === FRAME_PROMPT_MESSAGES.STORYBOARD_NOT_FOUND
    );
    assert.equal(isTrustedChineseUserError(FRAME_PROMPT_MESSAGES.STORYBOARD_NOT_FOUND), true);
    assert.equal(resolveStoryboardScope(db, STORYBOARD_ID).episodeId, EPISODE_ID);
    assert.equal(resolveStoryboardScope(db, STORYBOARD_ID).dramaId, DRAMA_ID);
    assert.equal(resolveStoryboardScope(db, EPISODE_ID).storyboardId, TRAP_STORYBOARD_ID);
    assert.notEqual(resolveStoryboardScope(db, EPISODE_ID).dramaId, DRAMA_ID);
    assert.equal(resolveStoryboardScope(db, DRAMA_ID), null);
    assert.equal(resolveStoryboardScope(db, OTHER_STORYBOARD_ID).dramaId, OTHER_DRAMA_ID);
  } finally {
    db.close();
  }
});

test('项目画风按分镜所属 drama_id 读取，不会把 storyboard_id 当成项目键', () => {
  assertDistinctIds();
  const db = createDb();
  try {
    const row = loadDramaStyleRowForStoryboard(db, STORYBOARD_ID);
    assert.equal(row.style, 'ink');
    assert.match(row.metadata, /9:16/);
    assert.equal(loadDramaStyleRowForStoryboard(db, TRAP_DRAMA_ID).style, 'ink');
    assert.notEqual(loadDramaStyleRowForStoryboard(db, STORYBOARD_ID).style, 'trap-style');
    assert.equal(loadDramaStyleRowForStoryboard(db, EPISODE_ID).style, 'cinematic');
    assert.equal(loadDramaStyleRowForStoryboard(db, DRAMA_ID), null);
  } finally {
    db.close();
  }
});

test('布局邻镜按 episode_id 取同一集，不会把 storyboard_id 当成剧集键', () => {
  assertDistinctIds();
  const db = createDb();
  try {
    const sameEpisode = loadLayoutNeighborStoryboards(db, EPISODE_ID, 2);
    assert.equal(sameEpisode.prev.layout_description, '本集上一镜');
    assert.equal(sameEpisode.next, null);

    const swapped = loadLayoutNeighborStoryboards(db, STORYBOARD_ID, 2);
    assert.equal(swapped.prev.layout_description, '陷阱邻镜');
    assert.notEqual(swapped.prev.layout_description, '本集上一镜');

    const other = loadLayoutNeighborStoryboards(db, OTHER_EPISODE_ID, 3);
    assert.equal(other.prev.layout_description, '其他集布局');
    assert.equal(loadLayoutNeighborStoryboards(db, DRAMA_ID, 2).prev, null);
  } finally {
    db.close();
  }
});