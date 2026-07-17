'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  SHUTDOWN_TIMEOUT_MS,
  createShutdownController,
} = require('../scripts/shutdown-controller');

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createElectronAppStub() {
  return {
    exitCalls: [],
    exit(code) {
      this.exitCalls.push(code);
    },
  };
}

function createExitEvent() {
  return {
    prevented: 0,
    preventDefault() {
      this.prevented += 1;
    },
  };
}

function createTimerHarness() {
  const timers = [];
  return {
    clearTimeoutFn(timer) {
      timer.cleared = true;
    },
    setTimeoutFn(callback, delay) {
      const timer = { callback, cleared: false, delay, unrefCalls: 0 };
      timer.unref = () => { timer.unrefCalls += 1; };
      timers.push(timer);
      return timer;
    },
    timers,
  };
}

test('desktop shutdown keeps the 50 second drain deadline inside a 60 second outer limit', () => {
  assert.equal(SHUTDOWN_TIMEOUT_MS, 50_000);
  assert.ok(SHUTDOWN_TIMEOUT_MS < 60_000);
});

test('window close and app quit coalesce while HTTP and background work drain', async () => {
  const app = createElectronAppStub();
  const timerHarness = createTimerHarness();
  const backgroundDrain = createDeferred();
  const calls = [];
  let closeHttp;
  const controller = createShutdownController({ app, ...timerHarness });

  controller.setBackendResources({
    backgroundTasks: {
      shutdown() {
        calls.push('background.shutdown');
        return backgroundDrain.promise;
      },
    },
    close() { calls.push('resources.close'); },
    detachExitClose() { calls.push('resources.detachExitClose'); },
  });
  controller.setHttpServer({
    close(callback) {
      calls.push('server.close');
      closeHttp = callback;
    },
  });

  const windowEvent = createExitEvent();
  const beforeQuitEvent = createExitEvent();
  const firstShutdown = controller.handleWindowClose(windowEvent);
  const repeatedShutdown = controller.handleBeforeQuit(beforeQuitEvent);

  assert.strictEqual(repeatedShutdown, firstShutdown);
  assert.equal(windowEvent.prevented, 1);
  assert.equal(beforeQuitEvent.prevented, 1);
  assert.deepEqual(calls, ['background.shutdown', 'server.close']);
  assert.equal(timerHarness.timers.length, 1);
  assert.equal(timerHarness.timers[0].unrefCalls, 1);

  closeHttp();
  await Promise.resolve();
  assert.deepEqual(calls, ['background.shutdown', 'server.close']);

  backgroundDrain.resolve();
  const outcome = await firstShutdown;

  assert.equal(outcome.ok, true);
  assert.deepEqual(calls, ['background.shutdown', 'server.close', 'resources.close']);
  assert.deepEqual(app.exitCalls, [0]);
  assert.equal(timerHarness.timers[0].cleared, true);
  assert.deepEqual(controller.getState(), {
    backgroundDrained: true,
    exitAuthorized: true,
    httpClosed: true,
    phase: 'exiting',
    requestedExitCode: 0,
  });

  const authorizedEvent = createExitEvent();
  assert.equal(controller.handleBeforeQuit(authorizedEvent), null);
  assert.equal(authorizedEvent.prevented, 0);
  assert.strictEqual(controller.requestShutdown('again'), firstShutdown);
  assert.deepEqual(app.exitCalls, [0]);
});

test('a rejected background drain fails once without closing the database', async () => {
  const app = createElectronAppStub();
  const timerHarness = createTimerHarness();
  const logs = [];
  const calls = [];
  const controller = createShutdownController({
    app,
    log: (message) => logs.push(message),
    ...timerHarness,
  });

  controller.setBackendResources({
    backgroundTasks: {
      shutdown() {
        calls.push('background.shutdown');
        return Promise.reject(new Error('drain unavailable'));
      },
    },
    close() { calls.push('resources.close'); },
    detachExitClose() { calls.push('resources.detachExitClose'); },
  });
  controller.setHttpServer({
    close(callback) {
      calls.push('server.close');
      callback();
    },
  });

  const first = controller.requestShutdown('before-quit');
  const second = controller.requestShutdown('window-close');
  const outcome = await first;

  assert.strictEqual(second, first);
  assert.equal(outcome.ok, false);
  assert.deepEqual(calls, [
    'background.shutdown',
    'server.close',
    'resources.detachExitClose',
  ]);
  assert.deepEqual(app.exitCalls, [1]);
  assert.equal(timerHarness.timers[0].cleared, true);
  assert.ok(logs.some((line) => line.includes('background task drain failed')));
});

test('shutdown timeout detaches exit cleanup and ignores late drain completion', async () => {
  const app = createElectronAppStub();
  const timerHarness = createTimerHarness();
  const backgroundDrain = createDeferred();
  const logs = [];
  const calls = [];
  let closeHttp;
  const controller = createShutdownController({
    app,
    log: (message) => logs.push(message),
    timeoutMs: 25,
    ...timerHarness,
  });

  controller.setBackendResources({
    backgroundTasks: {
      getState() { return { accepting: false, active: 2 }; },
      shutdown() {
        calls.push('background.shutdown');
        return backgroundDrain.promise;
      },
    },
    close() { calls.push('resources.close'); },
    detachExitClose() { calls.push('resources.detachExitClose'); },
  });
  controller.setHttpServer({
    close(callback) {
      calls.push('server.close');
      closeHttp = callback;
    },
  });

  const shutdown = controller.requestShutdown('before-quit');
  assert.equal(timerHarness.timers[0].delay, 25);
  timerHarness.timers[0].callback();
  const outcome = await shutdown;

  assert.equal(outcome.ok, false);
  assert.deepEqual(calls, [
    'background.shutdown',
    'server.close',
    'resources.detachExitClose',
  ]);
  assert.deepEqual(app.exitCalls, [1]);
  assert.ok(logs.some((line) => (
    line.includes('graceful shutdown timed out') &&
    line.includes('"activeBackgroundTasks":2') &&
    line.includes('"httpClosed":false')
  )));

  closeHttp();
  backgroundDrain.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls.includes('resources.close'), false);
  assert.deepEqual(app.exitCalls, [1]);
});

test('an HTTP close failure does not close resources after the background drain', async () => {
  const app = createElectronAppStub();
  const calls = [];
  const controller = createShutdownController({ app, timeoutMs: 25 });

  controller.setBackendResources({
    backgroundTasks: {
      shutdown() {
        calls.push('background.shutdown');
        return Promise.resolve();
      },
    },
    close() { calls.push('resources.close'); },
    detachExitClose() { calls.push('resources.detachExitClose'); },
  });
  controller.setHttpServer({
    close(callback) {
      calls.push('server.close');
      callback(Object.assign(new Error('socket close failed'), { code: 'EIO' }));
    },
  });

  const outcome = await controller.requestShutdown('before-quit');

  assert.equal(outcome.ok, false);
  assert.deepEqual(calls, [
    'background.shutdown',
    'server.close',
    'resources.detachExitClose',
  ]);
  assert.deepEqual(app.exitCalls, [1]);
});

test('startup failure drains and releases resources even before an HTTP server exists', async () => {
  const app = createElectronAppStub();
  const calls = [];
  const controller = createShutdownController({ app, timeoutMs: 25 });
  controller.setBackendResources({
    backgroundTasks: {
      shutdown() {
        calls.push('background.shutdown');
        return Promise.resolve();
      },
    },
    close() { calls.push('resources.close'); },
    detachExitClose() { calls.push('resources.detachExitClose'); },
  });

  const outcome = await controller.requestShutdown('startup-failure', 1);

  assert.equal(outcome.ok, false);
  assert.equal(outcome.exitCode, 1);
  assert.deepEqual(calls, ['background.shutdown', 'resources.close']);
  assert.deepEqual(app.exitCalls, [1]);
  assert.equal(controller.getState().httpClosed, true);
});

test('ERR_SERVER_NOT_RUNNING is safe during startup cleanup', async () => {
  const app = createElectronAppStub();
  const calls = [];
  const controller = createShutdownController({ app, timeoutMs: 25 });
  controller.setBackendResources({
    backgroundTasks: { shutdown: () => Promise.resolve() },
    close() { calls.push('resources.close'); },
    detachExitClose() { calls.push('resources.detachExitClose'); },
  });
  controller.setHttpServer({
    close(callback) {
      callback(Object.assign(new Error('server is not running'), {
        code: 'ERR_SERVER_NOT_RUNNING',
      }));
    },
  });

  const outcome = await controller.requestShutdown('startup-failure', 1);

  assert.equal(outcome.exitCode, 1);
  assert.deepEqual(calls, ['resources.close']);
  assert.deepEqual(app.exitCalls, [1]);
});

test('a later failure request upgrades the single graceful exit to status 1', async () => {
  const app = createElectronAppStub();
  const backgroundDrain = createDeferred();
  const controller = createShutdownController({ app, timeoutMs: 25 });
  controller.setBackendResources({
    backgroundTasks: { shutdown: () => backgroundDrain.promise },
    close() {},
  });

  const first = controller.requestShutdown('window-close');
  const upgraded = controller.requestShutdown('startup-failure', 1);
  backgroundDrain.resolve();
  const outcome = await first;

  assert.strictEqual(upgraded, first);
  assert.equal(outcome.exitCode, 1);
  assert.deepEqual(app.exitCalls, [1]);
});
