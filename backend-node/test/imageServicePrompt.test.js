'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const aiClient = require('../src/services/aiClient');
const { polishStoryboardImagePrompt } = require('../src/services/imageServicePrompt');

const DRAMA_ID = 11;
const EPISODE_ID = 1101;
const STORYBOARD_ID = 4404;
const IMAGE_ID = 11111;
const OTHER_IMAGE_ID = 12222;

const log = { info() {}, warn() {}, error() {} };

function createDb() {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO dramas (id, title, status, created_at, updated_at) VALUES (?, '提示词甲', 'draft', ?, ?)`
  ).run(DRAMA_ID, now, now);
  db.prepare(
    `INSERT INTO episodes (id, drama_id, episode_number, title, status, created_at, updated_at)
     VALUES (?, ?, 1, '第一集', 'draft', ?, ?)`
  ).run(EPISODE_ID, DRAMA_ID, now, now);
  db.prepare(
    `INSERT INTO storyboards
      (id, episode_id, storyboard_number, title, action, polished_prompt, created_at, updated_at)
     VALUES (?, ?, 1, '主分镜', '码头夜雨', '这是已经人工确认过的润色提示词内容', ?, ?)`
  ).run(STORYBOARD_ID, EPISODE_ID, now, now);
  assert.notEqual(DRAMA_ID, STORYBOARD_ID);
  assert.notEqual(IMAGE_ID, OTHER_IMAGE_ID);
  return db;
}

test('已有 polished_prompt 的普通分镜不再调文本模型', async () => {
  const db = createDb();
  const original = aiClient.generateText;
  let called = 0;
  aiClient.generateText = async () => {
    called += 1;
    return '不应使用';
  };
  try {
    const result = await polishStoryboardImagePrompt(db, log, {
      row: {
        id: IMAGE_ID,
        storyboard_id: STORYBOARD_ID,
        drama_id: DRAMA_ID,
        prompt: '原始提示词',
        frame_type: null,
      },
      imageGenId: IMAGE_ID,
      cfg: { style: {} },
      signal: null,
      elapsed: () => '0ms',
      reference_context_note: '',
    });
    assert.equal(result.isSingleStoryboard, true);
    assert.equal(result.finalPrompt, '这是已经人工确认过的润色提示词内容');
    assert.equal(called, 0);
    assert.equal(result.stagedPolishedPrompt, null);
  } finally {
    aiClient.generateText = original;
    db.close();
  }
});

test('首尾帧专用提示词优先，忽略分镜上的旧润色结果', async () => {
  const db = createDb();
  const original = aiClient.generateText;
  aiClient.generateText = async () => '不应覆盖首尾帧';
  try {
    const result = await polishStoryboardImagePrompt(db, log, {
      row: {
        id: OTHER_IMAGE_ID,
        storyboard_id: STORYBOARD_ID,
        drama_id: DRAMA_ID,
        prompt: '尾帧专用提示词',
        frame_type: 'last',
      },
      imageGenId: OTHER_IMAGE_ID,
      cfg: { style: {} },
      signal: null,
      elapsed: () => '0ms',
      reference_context_note: '',
    });
    assert.equal(result.finalPrompt, '尾帧专用提示词');
    assert.notEqual(IMAGE_ID, OTHER_IMAGE_ID);
  } finally {
    aiClient.generateText = original;
    db.close();
  }
});

test('优化过程中取消会原样抛出，不吞掉 AbortError', async () => {
  const db = createDb();
  db.prepare('UPDATE storyboards SET polished_prompt = NULL WHERE id = ?').run(STORYBOARD_ID);
  db.prepare(
    `INSERT INTO ai_service_configs (id, service_type, provider, model, is_active, created_at, updated_at)
     VALUES (1, 'text', 'test', 'm1', 1, datetime('now'), datetime('now'))`
  ).run();
  const original = aiClient.generateText;
  aiClient.generateText = async () => {
    const error = new Error('操作已取消');
    error.name = 'AbortError';
    error.code = 'OPERATION_CANCELLED';
    throw error;
  };
  try {
    await assert.rejects(
      () => polishStoryboardImagePrompt(db, log, {
        row: {
          id: IMAGE_ID,
          storyboard_id: STORYBOARD_ID,
          drama_id: DRAMA_ID,
          prompt: '需要优化的提示词',
          frame_type: null,
        },
        imageGenId: IMAGE_ID,
        cfg: { style: {} },
        signal: null,
        elapsed: () => '0ms',
        reference_context_note: '',
      }),
      (error) => error.code === 'OPERATION_CANCELLED' && error.name === 'AbortError'
    );
  } finally {
    aiClient.generateText = original;
    db.close();
  }
});
