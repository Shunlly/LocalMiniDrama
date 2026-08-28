'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const dramaService = require('../src/services/dramaService');
const taskService = require('../src/services/taskService');
const videoClient = require('../src/services/videoClient');
const videoService = require('../src/services/videoService');
const workflowService = require('../src/services/workflowService');
const { createOperationRegistry } = require('../src/services/operationRegistry');

const log = { debug() {}, info() {}, warn() {}, error() {}, errorw() {} };
let sequence = 0;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function createDb(t) {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO dramas (id, title, status, metadata, created_at, updated_at)
     VALUES (1, '取消一致性项目', 'draft', '{}', ?, ?)`
  ).run(now, now);
  db.prepare(
    `INSERT INTO episodes (id, drama_id, episode_number, title, status, created_at, updated_at)
     VALUES (11, 1, 1, '第一集', 'draft', ?, ?)`
  ).run(now, now);
  db.prepare(
    `INSERT INTO storyboards (id, episode_id, storyboard_number, title, status, created_at, updated_at)
     VALUES (21, 11, 1, '第一镜', 'pending', ?, ?)`
  ).run(now, now);
  t.after(() => db.close());
  return db;
}

function createTask(db, status = 'processing') {
  const task = taskService.createTask(db, log, 'video_generation', '1');
  if (status !== 'pending') {
    taskService.updateTaskStatus(db, task.id, status, 10, '运行中');
  }
  return task.id;
}

function createVideo(db, taskId) {
  const now = new Date().toISOString();
  const result = db.prepare(
    `INSERT INTO video_generations
     (drama_id, storyboard_id, provider, prompt, model, status, task_id, created_at, updated_at)
     VALUES (1, 21, 'deferred', '测试', 'deferred-video', 'processing', ?, ?, ?)`
  ).run(taskId, now, now);
  return Number(result.lastInsertRowid);
}

function createImage(db, taskId, dramaId = 1) {
  const now = new Date().toISOString();
  const result = db.prepare(
    `INSERT INTO image_generations
     (drama_id, provider, prompt, model, status, task_id, created_at, updated_at)
     VALUES (?, 'deferred', '测试', 'deferred-image', 'processing', ?, ?, ?)`
  ).run(dramaId, taskId, now, now);
  return Number(result.lastInsertRowid);
}

test('并发取消汇合同一 Promise，已有 cancelling 在远端结果返回前不会成功', async (t) => {
  const db = createDb(t);
  const taskId = createTask(db);
  const remote = deferred();
  let calls = 0;
  taskService.markRemoteCancelPending(taskId);
  taskService.registerRemoteCancel(taskId, async () => {
    calls += 1;
    return remote.promise;
  });

  const first = taskService.cancelTask(db, log, taskId, '并发取消');
  const second = taskService.cancelTask(db, log, taskId, '并发取消');
  assert.equal(first, second);
  assert.equal(taskService.getTask(db, taskId).status, 'cancelling');

  let settled = false;
  first.finally(() => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal(calls, 1);

  remote.resolve({ confirmed: true });
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult, secondResult);
  assert.equal(firstResult.ok, true);
  assert.equal(taskService.getTask(db, taskId).status, 'cancelled');
});

test('远端取消失败返回失败并把任务恢复为原活动状态', async (t) => {
  const db = createDb(t);
  const events = [];
  const opLog = { ...log, operation(event) { events.push(event); } };
  const taskId = createTask(db);
  taskService.markRemoteCancelPending(taskId);
  taskService.registerRemoteCancel(taskId, async () => ({
    confirmed: false,
    error: 'provider refused cancellation',
  }));

  const result = await taskService.cancelTask(db, opLog, taskId, '远端失败');

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'remote_cancel_failed');
  assert.match(result.error, /provider refused cancellation/);
  assert.equal(db.prepare('SELECT status FROM async_tasks WHERE id = ?').get(taskId).status, 'processing');
  assert.equal(events.some((event) => event.operation === 'task_cancel' && event.phase === 'start'), true);
  assert.equal(
    events.some((event) => event.operation === 'task_cancel' && event.phase === 'error' && event.status === 'remote_cancel_failed'),
    true,
    JSON.stringify(events)
  );
});

test('取消未启动的剧集合并会清掉 processing 剧集状态', async (t) => {
  const db = createDb(t);
  db.prepare("UPDATE episodes SET status = 'processing' WHERE id = 11").run();
  const task = taskService.createTask(db, log, 'video_merge', '11');
  taskService.updateTaskStatus(db, task.id, 'processing', 10, '合成中');
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO video_merges (episode_id, drama_id, title, provider, status, scenes, task_id, created_at)
     VALUES (11, 1, '合成', 'ffmpeg', 'pending', '[]', ?, ?)`
  ).run(task.id, now);

  const result = await taskService.cancelTask(db, log, task.id, '启动前取消');

  assert.equal(result.ok, true);
  assert.equal(db.prepare('SELECT status FROM video_merges WHERE task_id = ?').get(task.id).status, 'cancelled');
  assert.equal(db.prepare('SELECT status FROM episodes WHERE id = 11').get().status, 'draft');
});

test('启动恢复中断的剧集合并会把 processing 剧集收敛为 failed', (t) => {
  const db = createDb(t);
  db.prepare("UPDATE episodes SET status = 'processing' WHERE id = 11").run();
  const task = taskService.createTask(db, log, 'video_merge', '11');
  taskService.updateTaskStatus(db, task.id, 'processing', 10, '合成中');
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO video_merges (episode_id, drama_id, title, provider, status, scenes, task_id, created_at)
     VALUES (11, 1, '合成', 'ffmpeg', 'processing', '[]', ?, ?)`
  ).run(task.id, now);

  assert.ok(taskService.failOrphanedAsyncTasksOnStartup(db, log) >= 1);
  assert.equal(taskService.getTask(db, task.id).status, 'failed');
  assert.equal(db.prepare('SELECT status FROM video_merges WHERE task_id = ?').get(task.id).status, 'failed');
  assert.equal(db.prepare('SELECT status FROM episodes WHERE id = 11').get().status, 'failed');
});

test('worker 先返回时等待远端失败决议并继续完成，不留下无 worker 的 processing 任务', async (t) => {
  const db = createDb(t);
  const taskId = createTask(db);
  const videoId = createVideo(db, taskId);
  const providerEntered = deferred();
  const providerResult = deferred();
  const remoteResult = deferred();

  t.mock.method(videoClient, 'getDefaultVideoConfig', () => ({
    provider: 'deferred',
    default_model: 'deferred-video',
    model: 'deferred-video',
    base_url: 'https://provider.invalid',
    is_active: 1,
  }));
  t.mock.method(videoClient, 'callVideoApi', async (_db, _log, options) => {
    options.register_remote_cancel(() => remoteResult.promise);
    providerEntered.resolve();
    return providerResult.promise;
  });

  const worker = videoService.processVideoGeneration(db, log, videoId);
  await providerEntered.promise;
  const cancellation = taskService.cancelTask(db, log, taskId, '远端失败竞态');
  providerResult.resolve({ error: 'provider generation failed normally' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(taskService.getTask(db, taskId).status, 'cancelling');

  remoteResult.resolve({ confirmed: false, error: 'provider refused cancellation' });
  const cancelled = await cancellation;
  await worker;

  assert.equal(cancelled.ok, false);
  assert.equal(taskService.getTask(db, taskId).status, 'failed');
  assert.equal(videoService.getById(db, videoId).status, 'failed');
  assert.match(videoService.getById(db, videoId).error_msg, /generation failed normally/);
});

test('取消完成后迟到 worker 不能覆盖 cancelled 终态', async (t) => {
  const db = createDb(t);
  const taskId = createTask(db);

  const result = await taskService.cancelTask(db, log, taskId, '终止任务');
  assert.equal(result.ok, true);
  assert.equal(taskService.updateTaskStatus(db, taskId, 'processing', 80, '迟到进度'), false);
  assert.equal(taskService.updateTaskResult(db, taskId, { video_url: 'late.mp4' }), false);
  assert.equal(taskService.updateTaskError(db, taskId, '迟到错误'), false);
  assert.equal(taskService.getTask(db, taskId).status, 'cancelled');
});

test('真实视频 worker 在 Provider task id 返回前开放远端取消注册窗口', async (t) => {
  const db = createDb(t);
  const taskId = createTask(db);
  const videoId = createVideo(db, taskId);
  const entered = deferred();
  const releaseProvider = deferred();
  let providerOptions;
  let remoteCancelCalls = 0;

  t.mock.method(videoClient, 'getDefaultVideoConfig', () => ({
    provider: 'deferred',
    default_model: 'deferred-video',
    model: 'deferred-video',
    base_url: 'https://provider.invalid',
    is_active: 1,
  }));
  t.mock.method(videoClient, 'callVideoApi', async (_db, _log, options) => {
    providerOptions = options;
    entered.resolve();
    await releaseProvider.promise;
    return { task_id: 'provider-task-' + (++sequence) };
  });
  t.mock.method(videoClient, 'pollVideoTask', async () => new Promise(() => {}));

  const worker = videoService.processVideoGeneration(db, log, videoId);
  await entered.promise;
  const cancellation = taskService.cancelTask(db, log, taskId, '注册窗口取消');
  assert.equal(taskService.getTask(db, taskId).status, 'cancelling');

  providerOptions.register_remote_cancel(async () => {
    remoteCancelCalls += 1;
    return { confirmed: true };
  });
  const cancelled = await cancellation;
  releaseProvider.resolve();
  await worker;

  assert.equal(cancelled.ok, true);
  assert.equal(remoteCancelCalls, 1);
  assert.equal(providerOptions.signal.aborted, true);
  assert.equal(taskService.getTask(db, taskId).status, 'cancelled');
  assert.equal(db.prepare('SELECT status FROM video_generations WHERE id = ?').get(videoId).status, 'cancelled');
});

test('取消结果不确定后迟到的 Provider task id 先落库并触发补偿取消', async (t) => {
  const db = createDb(t);
  const taskId = createTask(db);
  const videoId = createVideo(db, taskId);
  const providerEntered = deferred();
  const providerResult = deferred();
  let remoteCancelCalls = 0;

  t.mock.method(videoClient, 'getDefaultVideoConfig', () => ({
    provider: 'deferred',
    default_model: 'deferred-video',
    model: 'deferred-video',
    base_url: 'https://provider.invalid',
    is_active: 1,
  }));
  t.mock.method(videoClient, 'callVideoApi', async (_db, _log, options) => {
    options.register_remote_cancel(async () => {
      remoteCancelCalls += 1;
      if (remoteCancelCalls === 1) {
        return { confirmed: false, uncertain: true, error: '远端取消响应丢失' };
      }
      return { confirmed: true };
    });
    providerEntered.resolve();
    return providerResult.promise;
  });

  const worker = videoService.processVideoGeneration(db, log, videoId);
  await providerEntered.promise;
  const firstCancellation = await taskService.cancelTask(db, log, taskId, '不确定取消');
  assert.equal(firstCancellation.reason, 'remote_cancel_uncertain');
  assert.equal(taskService.getTask(db, taskId).status, 'cancelling');

  providerResult.resolve({ task_id: 'remote-task-late-123' });
  await worker;

  const persisted = db.prepare(
    'SELECT status, provider_task_id FROM video_generations WHERE id = ?'
  ).get(videoId);
  assert.equal(persisted.provider_task_id, 'remote-task-late-123');
  assert.equal(persisted.status, 'cancelled');
  assert.equal(taskService.getTask(db, taskId).status, 'cancelled');
  assert.equal(remoteCancelCalls, 2);
});

test('取消结果不确定后 Provider 明确失败会提交 failed 终态', async (t) => {
  const db = createDb(t);
  const taskId = createTask(db);
  const videoId = createVideo(db, taskId);
  const providerEntered = deferred();
  const providerResult = deferred();

  t.mock.method(videoClient, 'getDefaultVideoConfig', () => ({
    provider: 'deferred',
    default_model: 'deferred-video',
    model: 'deferred-video',
    base_url: 'https://provider.invalid',
    is_active: 1,
  }));
  t.mock.method(videoClient, 'callVideoApi', async (_db, _log, options) => {
    options.register_remote_cancel(async () => ({
      confirmed: false,
      uncertain: true,
      error: '远端取消响应丢失',
    }));
    providerEntered.resolve();
    return providerResult.promise;
  });

  const worker = videoService.processVideoGeneration(db, log, videoId);
  await providerEntered.promise;
  const cancellation = await taskService.cancelTask(db, log, taskId, '不确定取消后失败');
  assert.equal(cancellation.reason, 'remote_cancel_uncertain');
  providerResult.resolve({ error: 'Provider 已确认创建失败' });
  await worker;

  assert.equal(taskService.getTask(db, taskId).status, 'failed');
  assert.equal(videoService.getById(db, videoId).status, 'failed');
  assert.match(videoService.getById(db, videoId).error_msg, /Provider 已确认创建失败/);
});

test('失败视频复用幂等键时原子绑定新任务，不复活旧失败任务', async (t) => {
  const db = createDb(t);
  const oldTaskId = createTask(db);
  const videoId = createVideo(db, oldTaskId);
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE async_tasks SET status = 'failed', error = '旧失败', completed_at = ?, updated_at = ? WHERE id = ?`
  ).run(now, now, oldTaskId);
  db.prepare(
    `UPDATE video_generations SET status = 'failed', error_msg = '旧失败', idempotency_key = ? WHERE id = ?`
  ).run('retry-same-key', videoId);

  t.mock.method(videoClient, 'getDefaultVideoConfig', () => ({
    provider: 'deferred',
    default_model: 'deferred-video',
    model: 'deferred-video',
    base_url: 'https://provider.invalid',
    is_active: 1,
  }));
  t.mock.method(videoClient, 'callVideoApi', async () => ({ error: '新任务真实执行失败' }));

  await assert.rejects(
    videoService.createAndProcessVideo(db, log, {
      drama_id: 1,
      storyboard_id: 21,
      provider: 'deferred',
      model: 'deferred-video',
      prompt: '重试',
      idempotency_key: 'retry-same-key',
    }),
    /新任务真实执行失败/
  );

  const video = db.prepare('SELECT task_id, status FROM video_generations WHERE id = ?').get(videoId);
  assert.notEqual(video.task_id, oldTaskId);
  assert.equal(video.status, 'failed');
  assert.equal(taskService.getTask(db, oldTaskId).status, 'failed');
  assert.equal(taskService.getTask(db, video.task_id).status, 'failed');
});

test('重启恢复会用持久化 Provider task id 重建支持厂商的取消函数', async (t) => {
  const db = createDb(t);
  const taskId = createTask(db);
  const videoId = createVideo(db, taskId);
  db.prepare(
    `UPDATE async_tasks SET status = 'cancelling', error = '重启前取消', updated_at = ? WHERE id = ?`
  ).run(new Date().toISOString(), taskId);
  db.prepare('UPDATE video_generations SET provider_task_id = ? WHERE id = ?')
    .run('persisted-sora-task', videoId);
  let cancelledTaskId = null;

  t.mock.method(videoClient, 'getDefaultVideoConfig', () => ({
    provider: 'openai',
    api_protocol: 'sora',
    default_model: 'sora-2',
    model: 'sora-2',
    base_url: 'https://provider.invalid',
    is_active: 1,
  }));
  t.mock.method(videoClient, 'pollVideoTask', async (
    _db, _log, _videoId, providerTaskId, config
  ) => {
    config.register_remote_cancel(async () => {
      cancelledTaskId = providerTaskId;
      return { confirmed: true };
    });
    return new Promise(() => {});
  });

  await videoService.resumePollForVideoGeneration(db, log, videoId);

  assert.equal(cancelledTaskId, 'persisted-sora-task');
  assert.equal(taskService.getTask(db, taskId).status, 'cancelled');
  assert.equal(videoService.getById(db, videoId).status, 'cancelled');
});

test('视频删除等待远端取消，失败时保留视频和活动任务', async (t) => {
  const db = createDb(t);
  const taskId = createTask(db);
  const videoId = createVideo(db, taskId);
  const remote = deferred();
  taskService.markRemoteCancelPending(taskId);
  taskService.registerRemoteCancel(taskId, () => remote.promise);

  const deletion = videoService.deleteById(db, log, videoId);
  assert.equal(taskService.getTask(db, taskId).status, 'cancelling');
  assert.equal(db.prepare('SELECT deleted_at FROM video_generations WHERE id = ?').get(videoId).deleted_at, null);

  remote.resolve({ confirmed: false, error: 'remote cancel failed' });
  await assert.rejects(deletion, (error) => error.code === 'REMOTE_CANCEL_FAILED');
  assert.equal(db.prepare('SELECT status FROM async_tasks WHERE id = ?').get(taskId).status, 'processing');
  assert.deepEqual(
    db.prepare('SELECT status, deleted_at FROM video_generations WHERE id = ?').get(videoId),
    { status: 'processing', deleted_at: null }
  );
});

test('视频删除仅在远端取消确认后落库', async (t) => {
  const db = createDb(t);
  const taskId = createTask(db);
  const videoId = createVideo(db, taskId);
  const remote = deferred();
  taskService.markRemoteCancelPending(taskId);
  taskService.registerRemoteCancel(taskId, () => remote.promise);

  const deletion = videoService.deleteById(db, log, videoId);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(db.prepare('SELECT deleted_at FROM video_generations WHERE id = ?').get(videoId).deleted_at, null);
  remote.resolve({ confirmed: true });

  assert.equal(await deletion, true);
  assert.equal(taskService.getTask(db, taskId).status, 'cancelled');
  assert.ok(db.prepare('SELECT deleted_at FROM video_generations WHERE id = ?').get(videoId).deleted_at);
});

test('视频删除以真实任务状态为准，不被不一致的视频状态绕过', async (t) => {
  const db = createDb(t);
  const taskId = createTask(db);
  const videoId = createVideo(db, taskId);
  db.prepare('UPDATE video_generations SET status = ? WHERE id = ?').run('failed', videoId);
  const remote = deferred();
  let cancelCalls = 0;
  taskService.markRemoteCancelPending(taskId);
  taskService.registerRemoteCancel(taskId, () => {
    cancelCalls += 1;
    return remote.promise;
  });

  const deletion = videoService.deleteById(db, log, videoId);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelCalls, 1);
  assert.equal(db.prepare('SELECT deleted_at FROM video_generations WHERE id = ?').get(videoId).deleted_at, null);
  remote.resolve({ confirmed: false, error: 'mixed state remote failure' });

  await assert.rejects(deletion, (error) => error.code === 'REMOTE_CANCEL_FAILED');
  assert.equal(db.prepare('SELECT status FROM async_tasks WHERE id = ?').get(taskId).status, 'processing');
  assert.equal(db.prepare('SELECT deleted_at FROM video_generations WHERE id = ?').get(videoId).deleted_at, null);
});

test('项目回收等待全部视频取消，任一失败时项目和视频均保持可用', async (t) => {
  const db = createDb(t);
  const firstTaskId = createTask(db);
  const secondTaskId = createTask(db);
  const firstVideoId = createVideo(db, firstTaskId);
  const secondVideoId = createVideo(db, secondTaskId);
  const firstRemote = deferred();
  const secondRemote = deferred();
  taskService.markRemoteCancelPending(firstTaskId);
  taskService.markRemoteCancelPending(secondTaskId);
  taskService.registerRemoteCancel(firstTaskId, () => firstRemote.promise);
  taskService.registerRemoteCancel(secondTaskId, () => secondRemote.promise);

  const recycling = dramaService.moveDramaToTrash(db, log, 1);
  assert.equal(db.prepare('SELECT deleted_at FROM dramas WHERE id = 1').get().deleted_at, null);
  firstRemote.resolve({ confirmed: true });
  secondRemote.resolve({ confirmed: false, error: 'second provider refused' });

  await assert.rejects(recycling, (error) => error.code === 'REMOTE_CANCEL_FAILED');
  assert.equal(db.prepare('SELECT deleted_at FROM dramas WHERE id = 1').get().deleted_at, null);
  assert.equal(taskService.getTask(db, firstTaskId).status, 'cancelled');
  assert.equal(taskService.getTask(db, secondTaskId).status, 'processing');
  assert.equal(videoService.getById(db, firstVideoId).status, 'cancelled');
  assert.equal(videoService.getById(db, secondVideoId).status, 'processing');
});

test('项目仅在全部视频远端取消确认后进入回收站', async (t) => {
  const db = createDb(t);
  const taskId = createTask(db);
  createVideo(db, taskId);
  const remote = deferred();
  taskService.markRemoteCancelPending(taskId);
  taskService.registerRemoteCancel(taskId, () => remote.promise);

  const recycling = dramaService.moveDramaToTrash(db, log, 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(db.prepare('SELECT deleted_at FROM dramas WHERE id = 1').get().deleted_at, null);
  remote.resolve({ confirmed: true });

  const removed = await recycling;
  assert.equal(removed.id, 1);
  assert.equal(removed.is_removed, true);
  assert.equal(taskService.getTask(db, taskId).status, 'cancelled');
});

test('远端取消回调永不结束时在硬超时后失败且不触发本地中止', async () => {
  const registry = createOperationRegistry({ remoteCancelTimeoutMs: 20 });
  const operation = registry.registerOperation({ type: 'task', id: 'hung-provider' });
  let remoteSignal;
  operation.setRemoteCancel(({ signal }) => {
    remoteSignal = signal;
    return new Promise(() => {});
  });

  const startedAt = Date.now();
  const outcome = await registry.cancelOperation('task', 'hung-provider');

  assert.equal(outcome.outcome, 'failed');
  assert.equal(outcome.uncertain, true);
  assert.match(outcome.error, /远端取消执行超时/);
  assert.equal(operation.signal.aborted, false);
  assert.equal(remoteSignal.aborted, true);
  assert.ok(Date.now() - startedAt < 1000);
  operation.finish();
});

test('远端取消硬超时会中止回调并阻止迟到副作用', async () => {
  const registry = createOperationRegistry({ remoteCancelTimeoutMs: 20 });
  const operation = registry.registerOperation({ type: 'task', id: 'abort-provider' });
  let aborted = false;
  let lateSideEffect = false;
  operation.setRemoteCancel(({ signal }) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      lateSideEffect = true;
      resolve({ confirmed: true });
    }, 80);
    signal.addEventListener('abort', () => {
      aborted = true;
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  }));

  const outcome = await registry.cancelOperation('task', 'abort-provider');
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(outcome.outcome, 'failed');
  assert.equal(aborted, true);
  assert.equal(lateSideEffect, false);
  assert.equal(operation.signal.aborted, false);
  operation.finish();
});

test('恢复对账会替换缓存旧结果的远端取消回调', async () => {
  const registry = createOperationRegistry({ remoteCancelTimeoutMs: 100 });
  const operation = registry.registerOperation({ type: 'task', id: 'reconcile-provider' });
  let firstCalls = 0;
  let secondCalls = 0;
  operation.setRemoteCancel(async () => {
    firstCalls += 1;
    return { confirmed: false, uncertain: true, error: '首次结果不确定' };
  });

  const first = await registry.cancelOperation('task', 'reconcile-provider');
  assert.equal(first.uncertain, true);
  operation.markRemoteCancelPending({ reset: true });
  operation.setRemoteCancel(async () => {
    secondCalls += 1;
    return { confirmed: true };
  });

  const second = await registry.cancelOperation('task', 'reconcile-provider');
  assert.equal(second.outcome, 'confirmed');
  assert.equal(firstCalls, 1);
  assert.equal(secondCalls, 1);
  operation.finish();
});

test('任务 resource_id 与跨项目视频不一致时失败关闭且不修改任一项目', async (t) => {
  const db = createDb(t);
  const taskId = createTask(db);
  const ownedVideoId = createVideo(db, taskId);
  const otherProjectVideoId = createVideo(db, taskId);
  db.prepare('UPDATE video_generations SET drama_id = ? WHERE id = ?').run(2, otherProjectVideoId);

  const result = await taskService.cancelTask(db, log, taskId, '作用域反例');

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'task_scope_conflict');
  assert.equal(result.details.expected_drama_id, '1');
  assert.equal(result.details.actual_drama_id, '2');
  assert.equal(db.prepare('SELECT status FROM async_tasks WHERE id = ?').get(taskId).status, 'processing');
  assert.equal(db.prepare('SELECT status FROM video_generations WHERE id = ?').get(ownedVideoId).status, 'processing');
  assert.equal(db.prepare('SELECT status FROM video_generations WHERE id = ?').get(otherProjectVideoId).status, 'processing');
});

test('任务 UUID 和 resource_id 查询按 episode 真实关联解析项目，不把 resource_id 当 drama_id', async (t) => {
  const db = createDb(t);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO dramas (id, title, status, metadata, created_at, updated_at)
     VALUES (2, '第二项目', 'draft', '{}', ?, ?)`
  ).run(now, now);
  db.prepare(
    `INSERT INTO episodes (id, drama_id, episode_number, title, status, created_at, updated_at)
     VALUES (1, 2, 1, '第二项目第一集', 'draft', ?, ?)`
  ).run(now, now);

  const task = taskService.createTask(db, log, 'character_extraction', '1');
  taskService.updateTaskStatus(db, task.id, 'processing', 10, '运行中');

  assert.equal(taskService.getTask(db, task.id).drama_id, 2);
  assert.deepEqual(
    taskService.getTasksByResource(db, '1', { dramaId: 2 }).map((item) => item.id),
    [task.id]
  );
  assert.deepEqual(taskService.getTasksByResource(db, '1', { dramaId: 1 }), []);

  const cancelled = await taskService.cancelTask(db, log, task.id, '真实关联取消');
  assert.equal(cancelled.ok, true);
  assert.equal(taskService.getTask(db, task.id).status, 'cancelled');
});

test('外部任务读取和取消拒绝回收中的真实父项目，内部读取仍可用于恢复', async (t) => {
  const db = createDb(t);
  const task = taskService.createTask(db, log, 'character_extraction', '11');
  taskService.updateTaskStatus(db, task.id, 'processing', 10, '运行中');
  db.prepare(
    `UPDATE dramas SET trash_state = 'recycling', recycle_phase = 'claimed' WHERE id = 1`
  ).run();

  assert.equal(taskService.getTask(db, task.id).status, 'processing');
  assert.throws(
    () => taskService.getTask(db, task.id, { requireReadable: true }),
    (error) => error.code === 'DRAMA_RECYCLE_IN_PROGRESS'
  );
  assert.throws(
    () => taskService.getTasksByResource(db, '11', { requireReadable: true }),
    (error) => error.code === 'DRAMA_RECYCLE_IN_PROGRESS'
  );
  const cancelled = await taskService.cancelTask(db, log, task.id, '外部取消', { requireReadable: true });
  assert.equal(cancelled.ok, false);
  assert.equal(cancelled.reason, 'drama_unreadable');
  assert.equal(cancelled.code, 'DRAMA_RECYCLE_IN_PROGRESS');
  assert.equal(taskService.getTask(db, task.id).status, 'processing');
});

test('混合两个不相等 drama_id 的任务 UUID 查询和取消都 fail closed', async (t) => {
  const db = createDb(t);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO dramas (id, title, status, metadata, created_at, updated_at)
     VALUES (2, '第二项目', 'draft', '{}', ?, ?)`
  ).run(now, now);
  const taskId = createTask(db);
  createVideo(db, taskId);
  const otherVideoId = createVideo(db, taskId);
  db.prepare('UPDATE video_generations SET drama_id = 2 WHERE id = ?').run(otherVideoId);

  assert.throws(
    () => taskService.getTask(db, taskId),
    (error) => error.code === 'TASK_SCOPE_CONFLICT'
      && error.details.reason === 'mixed_drama_ownership'
  );
  assert.throws(
    () => taskService.getTasksByResource(db, '1'),
    (error) => error.code === 'TASK_SCOPE_CONFLICT'
  );
  const cancelled = await taskService.cancelTask(db, log, taskId, '混合归属取消');
  assert.equal(cancelled.ok, false);
  assert.equal(cancelled.reason, 'task_scope_conflict');
  assert.equal(db.prepare('SELECT status FROM video_generations WHERE task_id = ?').all(taskId).every((row) => row.status === 'processing'), true);
});

test('终态视频记录仍参与任务归属校验，不能用状态绕过跨项目冲突', async (t) => {
  const db = createDb(t);
  const taskId = createTask(db);
  const videoId = createVideo(db, taskId);
  db.prepare(
    `UPDATE video_generations SET drama_id = 2, status = 'failed' WHERE id = ?`
  ).run(videoId);

  const result = await taskService.cancelTask(db, log, taskId, '终态作用域反例');

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'task_scope_conflict');
  assert.equal(db.prepare('SELECT status FROM async_tasks WHERE id = ?').get(taskId).status, 'processing');
});

test('图片任务关联跨项目记录时拒绝取消且不修改任一记录', async (t) => {
  const db = createDb(t);
  const task = taskService.createTask(db, log, 'image_generation', '1');
  taskService.updateTaskStatus(db, task.id, 'processing', 10, '运行中');
  const ownedImageId = createImage(db, task.id, 1);
  const otherImageId = createImage(db, task.id, 2);

  const result = await taskService.cancelTask(db, log, task.id, '图片作用域反例');

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'task_scope_conflict');
  assert.equal(db.prepare('SELECT status FROM async_tasks WHERE id = ?').get(task.id).status, 'processing');
  assert.equal(db.prepare('SELECT status FROM image_generations WHERE id = ?').get(ownedImageId).status, 'processing');
  assert.equal(db.prepare('SELECT status FROM image_generations WHERE id = ?').get(otherImageId).status, 'processing');
});

test('无法解析归属的活动任务阻止项目回收并保留人工介入锁', async (t) => {
  const db = createDb(t);
  const orphan = taskService.createTask(db, log, 'future_unknown_task', '');
  taskService.updateTaskStatus(db, orphan.id, 'processing', 10, '运行中');

  await assert.rejects(
    dramaService.moveDramaToTrash(db, log, 1),
    (error) => error.code === 'TASK_SCOPE_CONFLICT'
  );

  assert.equal(db.prepare('SELECT trash_state, recycle_phase FROM dramas WHERE id = 1').get().trash_state, 'recycling');
  assert.equal(db.prepare('SELECT recycle_phase FROM dramas WHERE id = 1').get().recycle_phase, 'manual_intervention');
  assert.equal(db.prepare('SELECT status FROM async_tasks WHERE id = ?').get(orphan.id).status, 'processing');
});

test('重启恢复缺少 Provider 配置时会收敛 cancelling 视频任务', async (t) => {
  const db = createDb(t);
  const taskId = createTask(db);
  const videoId = createVideo(db, taskId);
  db.prepare(
    `UPDATE async_tasks SET status = 'cancelling', error = '重启前取消', updated_at = ? WHERE id = ?`
  ).run(new Date().toISOString(), taskId);
  db.prepare('UPDATE video_generations SET provider_task_id = ? WHERE id = ?')
    .run('provider-task-without-config', videoId);
  t.mock.method(videoClient, 'getDefaultVideoConfig', () => null);

  await videoService.resumePollForVideoGeneration(db, log, videoId);

  assert.equal(taskService.getTask(db, taskId).status, 'failed');
  assert.equal(videoService.getById(db, videoId).status, 'failed');
});

test('项目回收等待远端时持久化封锁新视频任务，失败后解除封锁', async (t) => {
  const db = createDb(t);
  const taskId = createTask(db);
  createVideo(db, taskId);
  const remote = deferred();
  taskService.markRemoteCancelPending(taskId);
  taskService.registerRemoteCancel(taskId, () => remote.promise);

  const recycling = dramaService.moveDramaToTrash(db, log, 1);
  assert.equal(db.prepare('SELECT trash_state FROM dramas WHERE id = 1').get().trash_state, 'recycling');
  assert.throws(
    () => videoService.createVideoGeneration(db, log, { drama_id: 1, prompt: '竞态写入' }),
    (error) => error.code === 'DRAMA_RECYCLE_IN_PROGRESS'
  );
  assert.throws(
    () => taskService.createTask(db, log, 'story_generation', '1'),
    (error) => error.code === 'DRAMA_RECYCLE_IN_PROGRESS'
  );
  assert.throws(
    () => taskService.createTask(db, log, 'character_extraction', '11'),
    (error) => error.code === 'DRAMA_RECYCLE_IN_PROGRESS'
  );

  remote.resolve({ confirmed: false, error: 'provider refused' });
  await assert.rejects(recycling, (error) => error.code === 'REMOTE_CANCEL_FAILED');
  assert.equal(db.prepare('SELECT trash_state FROM dramas WHERE id = 1').get().trash_state, null);
});

test('启动恢复元数据不完整时保留项目回收封锁并要求人工介入', (t) => {
  const db = createDb(t);
  db.prepare(`UPDATE dramas SET trash_state = 'recycling' WHERE id = 1`).run();

  assert.equal(dramaService.recoverInterruptedTrashOperations(db, log), 1);
  assert.deepEqual(
    db.prepare('SELECT trash_state, recycle_phase FROM dramas WHERE id = 1').get(),
    { trash_state: 'recycling', recycle_phase: 'manual_intervention' }
  );
});

test('工作流排空期间出现的新任务会被取消后再提交项目回收', async (t) => {
  const db = createDb(t);
  let insertedTaskId;
  t.mock.method(workflowService, 'cancelAndDrainDramaWorkflows', async () => {
    insertedTaskId = `late-task-${Date.now()}`;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO async_tasks
        (id, type, status, progress, message, resource_id, created_at, updated_at)
       VALUES (?, 'story_generation', 'pending', 0, '', '1', ?, ?)`
    ).run(insertedTaskId, now, now);
    return { cancelled_run_ids: [] };
  });

  const removed = await dramaService.moveDramaToTrash(db, log, 1);

  assert.equal(removed.is_removed, true);
  assert.equal(taskService.getTask(db, insertedTaskId).status, 'cancelled');
});

test('character_extraction 按 episode 归属项目，不把 episode ID 当 drama ID', async (t) => {
  const db = createDb(t);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO dramas (id, title, status, metadata, created_at, updated_at)
     VALUES (2, '第二项目', 'draft', '{}', ?, ?)`
  ).run(now, now);
  db.prepare(
    `INSERT INTO episodes (id, drama_id, episode_number, title, status, created_at, updated_at)
     VALUES (1, 2, 1, '项目二第一集', 'draft', ?, ?)`
  ).run(now, now);
  const extraction = taskService.createTask(db, log, 'character_extraction', '1');
  taskService.updateTaskStatus(db, extraction.id, 'processing', 10, '运行中');

  const firstRemoved = await dramaService.moveDramaToTrash(db, log, 1);
  assert.equal(firstRemoved.is_removed, true);
  assert.equal(taskService.getTask(db, extraction.id).status, 'processing');

  const secondRemoved = await dramaService.moveDramaToTrash(db, log, 2);
  assert.equal(secondRemoved.is_removed, true);
  assert.equal(taskService.getTask(db, extraction.id).status, 'cancelled');
});

test('普通任务远端取消结果不确定后会自动重试并完成取消', async (t) => {
  const db = createDb(t);
  const taskId = createTask(db);
  let calls = 0;
  taskService.markRemoteCancelPending(taskId);
  taskService.registerRemoteCancel(taskId, async () => {
    calls += 1;
    return calls === 1
      ? { confirmed: false, uncertain: true, error: '首次响应丢失' }
      : { confirmed: true };
  });

  const first = await taskService.cancelTask(db, log, taskId, '普通任务取消');
  assert.equal(first.reason, 'remote_cancel_uncertain');
  assert.equal(taskService.getTask(db, taskId).status, 'cancelling');

  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline && taskService.getTask(db, taskId)?.status !== 'cancelled') {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(calls, 2);
  assert.equal(taskService.getTask(db, taskId).status, 'cancelled');
});

test('普通任务远端取消重试耗尽后进入明确失败终态', async (t) => {
  const db = createDb(t);
  const taskId = createTask(db);
  let calls = 0;
  taskService.markRemoteCancelPending(taskId);
  taskService.registerRemoteCancel(taskId, async () => {
    calls += 1;
    return { confirmed: false, uncertain: true, error: 'Provider 状态持续未知' };
  });

  const first = await taskService.cancelTask(db, log, taskId, '普通任务取消');
  assert.equal(first.reason, 'remote_cancel_uncertain');

  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline && taskService.getTask(db, taskId)?.status !== 'failed') {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const task = taskService.getTask(db, taskId);
  assert.equal(calls, 4);
  assert.equal(task.status, 'failed');
  assert.match(task.error, /多次未确认/);
});

test('远端取消结果首次不确定后后台自动重试并完成项目回收', async (t) => {
  const db = createDb(t);
  const taskId = createTask(db);
  createVideo(db, taskId);
  let calls = 0;
  taskService.markRemoteCancelPending(taskId);
  taskService.registerRemoteCancel(taskId, async () => {
    calls += 1;
    return calls === 1
      ? { confirmed: false, uncertain: true, error: '首次状态未知' }
      : { confirmed: true };
  });

  await assert.rejects(
    dramaService.moveDramaToTrash(db, log, 1),
    (error) => error.code === 'REMOTE_CANCEL_UNCERTAIN'
  );
  const cancellingRow = db.prepare(
    'SELECT status, cancel_context FROM async_tasks WHERE id = ?'
  ).get(taskId);
  const cancelContext = JSON.parse(cancellingRow.cancel_context);
  const recycleOperationId = db.prepare(
    'SELECT recycle_operation_id FROM dramas WHERE id = 1'
  ).get().recycle_operation_id;
  assert.equal(db.prepare('SELECT trash_state FROM dramas WHERE id = 1').get().trash_state, 'recycling');
  assert.equal(cancellingRow.status, 'cancelling');
  assert.deepEqual(cancelContext, {
    scope: 'drama_recycle',
    drama_id: 1,
    recycle_operation_id: recycleOperationId,
    original_status: 'processing',
    original_error: null,
    reason: '项目移入回收站',
    last_error: '首次状态未知',
    last_outcome: 'uncertain',
  });

  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const row = db.prepare('SELECT deleted_at FROM dramas WHERE id = 1').get();
    if (row?.deleted_at) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  assert.equal(calls, 2);
  assert.equal(taskService.getTask(db, taskId).status, 'cancelled');
  assert.ok(db.prepare('SELECT deleted_at FROM dramas WHERE id = 1').get().deleted_at);
});

test('超过持久化回收截止时间的操作停止续跑并持久化人工介入锁', (t) => {
  const db = createDb(t);
  const expiredAt = new Date(Date.now() - (11 * 60 * 1000)).toISOString();
  db.prepare(
    `UPDATE dramas
        SET trash_state = 'recycling', recycle_operation_id = 'expired-operation',
            recycle_phase = 'cancelling', recycle_started_at = ?
      WHERE id = 1`
  ).run(expiredAt);

  assert.equal(dramaService.recoverInterruptedTrashOperations(db, log), 1);
  const row = db.prepare(
    `SELECT deleted_at, trash_state, recycle_operation_id, recycle_phase, recycle_started_at
       FROM dramas WHERE id = 1`
  ).get();
  assert.equal(row.deleted_at, null);
  assert.equal(row.trash_state, 'recycling');
  assert.equal(row.recycle_operation_id, 'expired-operation');
  assert.equal(row.recycle_phase, 'manual_intervention');
  assert.equal(row.recycle_started_at, expiredAt);
});

test('启动恢复 claimed 阶段且已超时时不会提前解除项目锁', (t) => {
  const db = createDb(t);
  const expiredAt = new Date(Date.now() - (11 * 60 * 1000)).toISOString();
  db.prepare(
    `UPDATE dramas
        SET trash_state = 'recycling', recycle_operation_id = 'claimed-operation',
            recycle_phase = 'claimed', recycle_started_at = ?
      WHERE id = 1`
  ).run(expiredAt);

  assert.equal(dramaService.recoverInterruptedTrashOperations(db, log), 1);
  const row = db.prepare(
    `SELECT deleted_at, trash_state, recycle_operation_id, recycle_phase, recycle_started_at
       FROM dramas WHERE id = 1`
  ).get();
  assert.equal(row.deleted_at, null);
  assert.equal(row.trash_state, 'recycling');
  assert.equal(row.recycle_operation_id, 'claimed-operation');
  assert.equal(row.recycle_phase, 'manual_intervention');
  assert.equal(row.recycle_started_at, expiredAt);
});

test('人工介入终态可由用户再次删除以重新发起项目回收', async (t) => {
  const db = createDb(t);
  const expiredAt = new Date(Date.now() - (11 * 60 * 1000)).toISOString();
  db.prepare(
    `UPDATE dramas
        SET trash_state = 'recycling', recycle_operation_id = 'manual-operation',
            recycle_phase = 'manual_intervention', recycle_started_at = ?
      WHERE id = 1`
  ).run(expiredAt);

  const removed = await dramaService.moveDramaToTrash(db, log, 1);
  assert.equal(removed.is_removed, true);
  const row = db.prepare(
    'SELECT deleted_at, trash_state, recycle_operation_id, recycle_phase FROM dramas WHERE id = 1'
  ).get();
  assert.ok(row.deleted_at);
  assert.equal(row.trash_state, null);
  assert.notEqual(row.recycle_operation_id, 'manual-operation');
  assert.equal(row.recycle_phase, 'completed');
});
