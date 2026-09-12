'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const aiClient = require('../src/services/aiClient');
const characterGenerationService = require('../src/services/characterGenerationService');
const dramaService = require('../src/services/dramaService');
const { getLegacyAsyncSchedulerState } = require('../src/services/legacyAsyncSchedulerService');
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

test('角色生成取消后即使 Provider 迟到返回也不得写入角色', async () => {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const drama = dramaService.createDrama(db, log, { title: '取消角色生成' });
  const started = deferred();
  const release = deferred();
  const originalGenerateText = aiClient.generateText;
  let providerSignal;
  let released = false;

  aiClient.generateText = async (...args) => {
    providerSignal = args[5]?.signal;
    started.resolve();
    await release.promise;
    return JSON.stringify([{ name: '迟到角色', role: '主角' }]);
  };

  try {
    const taskId = characterGenerationService.generateCharacters(db, {}, log, {
      drama_id: drama.id,
      outline: '生成一个角色',
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
      '角色生成后台任务未按时退出'
    );

    assert.equal(taskService.getTask(db, taskId).status, 'cancelled');
    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM characters WHERE drama_id = ?').get(drama.id).count,
      0
    );
  } finally {
    aiClient.generateText = originalGenerateText;
    if (!released) release.resolve();
    await waitFor(() => getLegacyAsyncSchedulerState().active === 0, '角色生成测试清理超时');
    db.close();
  }
});
