'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const aiClient = require('../src/services/aiClient');
const dramaService = require('../src/services/dramaService');
const { getLegacyAsyncSchedulerState } = require('../src/services/legacyAsyncSchedulerService');
const storyGenerationService = require('../src/services/storyGenerationService');
const taskService = require('../src/services/taskService');

const log = { info() {}, warn() {}, error() {}, errorw() {} };

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function waitFor(predicate, message, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(message);
}

test('剧本生成取消后即使 Provider 迟到返回也不得改写项目', async () => {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const drama = dramaService.createDrama(db, log, {
    title: '原项目标题',
    description: '原项目简介',
  });
  dramaService.saveEpisodes(db, log, drama.id, {
    episodes: [{ episode_number: 1, title: '原第一集', script_content: '原剧本内容' }],
  });

  const started = deferred();
  const release = deferred();
  const originalGenerateText = aiClient.generateText;
  let providerSignal;
  let released = false;

  aiClient.generateText = async (...args) => {
    providerSignal = args[5]?.signal;
    started.resolve();
    await release.promise;
    return JSON.stringify([{ episode: 1, title: '迟到第一集', content: '迟到剧本内容' }]);
  };

  try {
    const taskId = storyGenerationService.startStoryGeneration(db, log, {
      drama_id: drama.id,
      premise: '生成新剧本',
      title: '迟到项目标题',
      summary: '迟到项目简介',
    });
    await started.promise;

    assert.ok(providerSignal instanceof AbortSignal, '必须把任务取消信号传给 Provider');
    const cancelled = await taskService.cancelTask(db, log, taskId, '测试取消');
    assert.equal(cancelled.ok, true);
    assert.equal(providerSignal.aborted, true);

    released = true;
    release.resolve();
    await waitFor(
      () => getLegacyAsyncSchedulerState().active === 0,
      '剧本生成后台任务未按时退出'
    );

    const storedDrama = db.prepare('SELECT title, description FROM dramas WHERE id = ?').get(drama.id);
    const storedEpisodes = db.prepare(
      'SELECT title, script_content FROM episodes WHERE drama_id = ? AND deleted_at IS NULL ORDER BY episode_number'
    ).all(drama.id);
    assert.equal(taskService.getTask(db, taskId).status, 'cancelled');
    assert.deepEqual(storedDrama, { title: '原项目标题', description: '原项目简介' });
    assert.deepEqual(storedEpisodes, [{ title: '原第一集', script_content: '原剧本内容' }]);
  } finally {
    aiClient.generateText = originalGenerateText;
    if (!released) release.resolve();
    await waitFor(() => getLegacyAsyncSchedulerState().active === 0, '剧本生成测试清理超时');
    db.close();
  }
});
