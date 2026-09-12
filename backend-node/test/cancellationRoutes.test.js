'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const dramaRoutes = require('../src/routes/drama');
const taskRoutes = require('../src/routes/task');
const videoRoutes = require('../src/routes/videos');
const dramaService = require('../src/services/dramaService');
const taskService = require('../src/services/taskService');
const videoService = require('../src/services/videoService');

const log = { debug() {}, info() {}, warn() {}, error() {}, errorw() {} };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return server;
}

async function close(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test('取消、视频删除和项目回收 HTTP 入口等待异步服务完成后才返回成功', async (t) => {
  const taskResult = deferred();
  const videoResult = deferred();
  const dramaResult = deferred();
  t.mock.method(taskService, 'cancelTask', () => taskResult.promise);
  t.mock.method(videoService, 'deleteById', () => videoResult.promise);
  t.mock.method(dramaService, 'moveDramaToTrash', () => dramaResult.promise);

  const app = express();
  app.use(express.json());
  app.post('/tasks/:task_id/cancel', taskRoutes({}, log).cancelTaskStatus);
  app.delete('/videos/:id', videoRoutes({}, log).delete);
  app.delete('/dramas/:id', dramaRoutes({}, {}, log).moveDramaToTrash);
  const server = await listen(app);
  t.after(() => close(server));
  const base = `http://127.0.0.1:${server.address().port}`;

  const settled = { task: false, video: false, drama: false };
  const taskRequest = fetch(`${base}/tasks/task-1/cancel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: '用户取消' }),
  }).then((response) => { settled.task = true; return response; });
  const videoRequest = fetch(`${base}/videos/2`, { method: 'DELETE' })
    .then((response) => { settled.video = true; return response; });
  const dramaRequest = fetch(`${base}/dramas/3`, { method: 'DELETE' })
    .then((response) => { settled.drama = true; return response; });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(settled, { task: false, video: false, drama: false });

  taskResult.resolve({ ok: true, task: { id: 'task-1', status: 'cancelled' } });
  videoResult.resolve(true);
  dramaResult.resolve({ id: 3, is_removed: true });
  const responses = await Promise.all([taskRequest, videoRequest, dramaRequest]);
  assert.deepEqual(responses.map((response) => response.status), [200, 200, 200]);
});

test('三个 HTTP 入口都把远端取消失败映射为冲突且不误报成功', async (t) => {
  const failure = Object.assign(new Error('Provider 拒绝取消'), { code: 'REMOTE_CANCEL_FAILED' });
  t.mock.method(taskService, 'cancelTask', async () => ({
    ok: false, reason: 'remote_cancel_failed', error: failure.message,
  }));
  t.mock.method(videoService, 'deleteById', async () => { throw failure; });
  t.mock.method(dramaService, 'moveDramaToTrash', async () => { throw failure; });

  const app = express();
  app.use(express.json());
  app.post('/tasks/:task_id/cancel', taskRoutes({}, log).cancelTaskStatus);
  app.delete('/videos/:id', videoRoutes({}, log).delete);
  app.delete('/dramas/:id', dramaRoutes({}, {}, log).moveDramaToTrash);
  const server = await listen(app);
  t.after(() => close(server));
  const base = `http://127.0.0.1:${server.address().port}`;
  const responses = await Promise.all([
    fetch(`${base}/tasks/task-1/cancel`, { method: 'POST' }),
    fetch(`${base}/videos/2`, { method: 'DELETE' }),
    fetch(`${base}/dramas/3`, { method: 'DELETE' }),
  ]);
  assert.deepEqual(responses.map((response) => response.status), [409, 409, 409]);
  for (const response of responses) {
    const body = await response.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'REMOTE_CANCEL_FAILED');
  }
});

test('项目回收工作流排空超时映射为 409', async (t) => {
  const failure = Object.assign(new Error('工作流仍在退出'), {
    code: 'WORKFLOW_DRAIN_TIMEOUT',
    details: { project_remains_locked: true },
  });
  t.mock.method(dramaService, 'moveDramaToTrash', async () => { throw failure; });
  const app = express();
  app.delete('/dramas/:id', dramaRoutes({}, {}, log).moveDramaToTrash);
  const server = await listen(app);
  t.after(() => close(server));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/dramas/3`, { method: 'DELETE' });
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.error.code, 'WORKFLOW_DRAIN_TIMEOUT');
  assert.equal(body.error.details.project_remains_locked, true);
});

test('任务入口保留项目回收边界的 HTTP 状态和错误码', async (t) => {
  const recycleError = Object.assign(new Error('项目正在回收站流程中，暂不可访问'), {
    code: 'DRAMA_RECYCLE_IN_PROGRESS',
    statusCode: 409,
  });
  t.mock.method(taskService, 'getTask', () => { throw recycleError; });
  t.mock.method(taskService, 'getTasksByResource', () => { throw recycleError; });
  t.mock.method(taskService, 'cancelTask', async () => ({
    ok: false,
    reason: 'drama_unreadable',
    code: recycleError.code,
    error: recycleError.message,
  }));
  const app = express();
  app.get('/tasks/:task_id', taskRoutes({}, log).getTaskStatus);
  app.get('/tasks', taskRoutes({}, log).getResourceTasks);
  app.post('/tasks/:task_id/cancel', taskRoutes({}, log).cancelTaskStatus);
  const server = await listen(app);
  t.after(() => close(server));
  const base = `http://127.0.0.1:${server.address().port}`;

  const responses = await Promise.all([
    fetch(`${base}/tasks/task-1`),
    fetch(`${base}/tasks?resource_id=1`),
    fetch(`${base}/tasks/task-1/cancel`, { method: 'POST' }),
  ]);
  assert.deepEqual(responses.map((item) => item.status), [409, 409, 409]);
  for (const item of responses) {
    const body = await item.json();
    assert.equal(body.error.code, 'DRAMA_RECYCLE_IN_PROGRESS');
  }
});
