'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const aiClient = require('../src/services/aiClient');
const backgroundExtractionService = require('../src/services/backgroundExtractionService');
const dramaService = require('../src/services/dramaService');
const episodeStoryboardService = require('../src/services/episodeStoryboardService');
const { getLegacyAsyncSchedulerState } = require('../src/services/legacyAsyncSchedulerService');
const sceneService = require('../src/services/sceneService');
const taskService = require('../src/services/taskService');

const log = { info() {}, warn() {}, error() {}, errorw() {} };

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function waitFor(predicate, message, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(message);
}

function createFixture(title) {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const drama = dramaService.createDrama(db, log, { title });
  dramaService.saveEpisodes(db, log, drama.id, {
    episodes: [{ episode_number: 1, title: '第一集', script_content: '夜晚，主角走进车站。' }],
  });
  const episode = db.prepare(
    'SELECT * FROM episodes WHERE drama_id = ? AND deleted_at IS NULL'
  ).get(drama.id);
  return { db, drama, episode };
}

function insertStoryboard(db, episodeId, number, title) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO storyboards
      (episode_id, storyboard_number, title, status, created_at, updated_at)
     VALUES (?, ?, ?, 'pending', ?, ?)`
  ).run(episodeId, number, title, now, now);
}

function listLiveStoryboards(db, episodeId) {
  return db.prepare(
    `SELECT storyboard_number, title FROM storyboards
      WHERE episode_id = ? AND deleted_at IS NULL ORDER BY storyboard_number, id`
  ).all(episodeId);
}

function storyboardResult(items) {
  return JSON.stringify(items.map((item) => ({
    shot_number: item.number,
    title: item.title,
    description: `${item.title}画面描述`,
    location: '车站',
    time: '夜晚',
    duration: 5,
    action: '主角向前走',
    result: '主角到达站台',
    characters: [],
  })));
}

test('场景提取取消后 Provider 迟到结果不得替换已有场景', async () => {
  const { db, drama, episode } = createFixture('场景取消');
  sceneService.createSceneForEpisode(db, log, drama.id, episode.id, {
    location: '原场景',
    time: '白天',
    prompt: '原提示词',
  });
  const started = deferred();
  const release = deferred();
  const originalGenerateText = aiClient.generateText;
  let providerSignal;

  aiClient.generateText = async (...args) => {
    providerSignal = args[5]?.signal;
    started.resolve();
    await release.promise;
    return JSON.stringify([{ location: '迟到场景', time: '夜晚', prompt: '迟到提示词' }]);
  };

  try {
    const taskId = backgroundExtractionService.extractBackgroundsForEpisode(
      db, { app: { language: 'zh' }, style: {} }, log, episode.id
    );
    await started.promise;
    assert.ok(providerSignal instanceof AbortSignal, '必须把任务取消信号传给 Provider');

    const cancelled = await taskService.cancelTask(db, log, taskId, '测试取消');
    assert.equal(cancelled.ok, true);
    assert.equal(providerSignal.aborted, true);
    release.resolve();
    await waitFor(() => getLegacyAsyncSchedulerState().active === 0, '场景提取后台任务未退出');

    assert.equal(taskService.getTask(db, taskId).status, 'cancelled');
    assert.deepEqual(
      db.prepare(
        `SELECT location, time, prompt FROM scenes
          WHERE episode_id = ? AND deleted_at IS NULL ORDER BY id`
      ).all(episode.id),
      [{ location: '原场景', time: '白天', prompt: '原提示词' }]
    );
  } finally {
    aiClient.generateText = originalGenerateText;
    release.resolve();
    await waitFor(() => getLegacyAsyncSchedulerState().active === 0, '场景取消测试清理超时');
    db.close();
  }
});

test('分镜取消后的流式回调不得写库且必须保留已有分镜', async () => {
  const { db, episode } = createFixture('分镜取消');
  insertStoryboard(db, episode.id, 1, '原分镜');
  const started = deferred();
  const release = deferred();
  const originalGenerateText = aiClient.generateText;
  let providerSignal;
  let callbackError;

  aiClient.generateText = async (...args) => {
    const options = args[5] || {};
    providerSignal = options.signal;
    started.resolve();
    await release.promise;
    try {
      options.streamCallback(storyboardResult([{ number: 1, title: '迟到分镜' }]) + ' '.repeat(500));
    } catch (error) {
      callbackError = error;
      throw error;
    }
    return storyboardResult([{ number: 1, title: '迟到分镜' }]);
  };

  try {
    const { task_id: taskId } = episodeStoryboardService.generateStoryboard(
      db, log, episode.id, null, '', 1, 5, '16:9', false, false
    );
    await started.promise;
    assert.ok(providerSignal instanceof AbortSignal, '必须把任务取消信号传给 Provider');

    const cancelled = await taskService.cancelTask(db, log, taskId, '测试取消');
    assert.equal(cancelled.ok, true);
    release.resolve();
    await waitFor(() => getLegacyAsyncSchedulerState().active === 0, '分镜生成后台任务未退出');

    assert.equal(callbackError?.code, 'OPERATION_CANCELLED');
    assert.equal(taskService.getTask(db, taskId).status, 'cancelled');
    assert.deepEqual(listLiveStoryboards(db, episode.id), [
      { storyboard_number: 1, title: '原分镜' },
    ]);
  } finally {
    aiClient.generateText = originalGenerateText;
    release.resolve();
    await waitFor(() => getLegacyAsyncSchedulerState().active === 0, '分镜取消测试清理超时');
    db.close();
  }
});

test('场景替换中途失败必须整体回滚', async () => {
  const { db, drama, episode } = createFixture('场景回滚');
  sceneService.createSceneForEpisode(db, log, drama.id, episode.id, {
    location: '原场景', time: '白天', prompt: '原提示词',
  });
  db.exec(
    `CREATE TRIGGER fail_second_scene BEFORE INSERT ON scenes
     WHEN NEW.location = '触发失败'
     BEGIN SELECT RAISE(ABORT, '测试场景写入失败'); END;`
  );
  const originalGenerateText = aiClient.generateText;
  aiClient.generateText = async () => JSON.stringify([
    { location: '新场景', time: '夜晚', prompt: '新提示词' },
    { location: '触发失败', time: '夜晚', prompt: '失败提示词' },
  ]);

  try {
    const taskId = backgroundExtractionService.extractBackgroundsForEpisode(
      db, { app: { language: 'zh' }, style: {} }, log, episode.id
    );
    await waitFor(
      () => ['failed', 'completed'].includes(taskService.getTask(db, taskId)?.status),
      '场景回滚任务未结束'
    );
    await waitFor(() => getLegacyAsyncSchedulerState().active === 0, '场景回滚后台任务未退出');

    assert.equal(taskService.getTask(db, taskId).status, 'failed');
    assert.deepEqual(
      db.prepare(
        `SELECT location, time, prompt FROM scenes
          WHERE episode_id = ? AND deleted_at IS NULL ORDER BY id`
      ).all(episode.id),
      [{ location: '原场景', time: '白天', prompt: '原提示词' }]
    );
  } finally {
    aiClient.generateText = originalGenerateText;
    await waitFor(() => getLegacyAsyncSchedulerState().active === 0, '场景回滚测试清理超时');
    db.close();
  }
});

test('分镜替换中途失败必须整体回滚旧分镜与剧集时长', async () => {
  const { db, episode } = createFixture('分镜回滚');
  insertStoryboard(db, episode.id, 1, '原分镜');
  db.prepare('UPDATE episodes SET duration = 9 WHERE id = ?').run(episode.id);
  db.exec(
    `CREATE TRIGGER fail_second_storyboard BEFORE INSERT ON storyboards
     WHEN NEW.storyboard_number = 2
     BEGIN SELECT RAISE(ABORT, '测试分镜写入失败'); END;`
  );
  const originalGenerateText = aiClient.generateText;
  aiClient.generateText = async () => storyboardResult([
    { number: 1, title: '新第一镜' },
    { number: 2, title: '新第二镜' },
  ]);

  try {
    const { task_id: taskId } = episodeStoryboardService.generateStoryboard(
      db, log, episode.id, null, '', 2, 10, '16:9', false, false
    );
    await waitFor(
      () => ['failed', 'completed'].includes(taskService.getTask(db, taskId)?.status),
      '分镜回滚任务未结束'
    );
    await waitFor(() => getLegacyAsyncSchedulerState().active === 0, '分镜回滚后台任务未退出');

    assert.equal(taskService.getTask(db, taskId).status, 'failed');
    assert.deepEqual(listLiveStoryboards(db, episode.id), [
      { storyboard_number: 1, title: '原分镜' },
    ]);
    assert.equal(db.prepare('SELECT duration FROM episodes WHERE id = ?').get(episode.id).duration, 9);
  } finally {
    aiClient.generateText = originalGenerateText;
    await waitFor(() => getLegacyAsyncSchedulerState().active === 0, '分镜回滚测试清理超时');
    db.close();
  }
});
