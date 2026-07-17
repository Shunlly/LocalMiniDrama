const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { SHUTDOWN_TIMEOUT_MS, startServer } = require('../src/server');
const { createLegacyAsyncScheduler } = require('../src/services/legacyAsyncSchedulerService');

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createProcessStub() {
  const processRef = new EventEmitter();
  processRef.env = {};
  processRef.exitCodes = [];
  processRef.exit = (code) => processRef.exitCodes.push(code);
  return processRef;
}

function createLoggerStub(entries = []) {
  return {
    info(message, fields) { entries.push({ level: 'info', message, fields }); },
    error(message, fields) { entries.push({ level: 'error', message, fields }); },
  };
}

function createTimerHarness() {
  const timers = [];
  return {
    clearTimeoutFn(timer) { timer.cleared = true; },
    setTimeoutFn(callback, delay) {
      const timer = { callback, delay, cleared: false, unref() {} };
      timers.push(timer);
      return timer;
    },
    timers,
  };
}

test('application shutdown timeout leaves margin inside the Compose 60 second grace period', () => {
  assert.equal(SHUTDOWN_TIMEOUT_MS, 50_000);
  assert.ok(SHUTDOWN_TIMEOUT_MS < 60_000);
});

test('registers signals before initialization and drains startup jobs before releasing resources', async () => {
  const processRef = createProcessStub();
  const timerHarness = createTimerHarness();
  let listenCalls = 0;
  let backgroundShutdownCalls = 0;
  let resourceCloseCalls = 0;

  const lifecycle = startServer({
    processRef,
    logger: createLoggerStub(),
    ...timerHarness,
    createApp() {
      assert.equal(processRef.listenerCount('SIGINT'), 1);
      assert.equal(processRef.listenerCount('SIGTERM'), 1);
      processRef.emit('SIGTERM');
      return {
        app: {
          listen() {
            listenCalls += 1;
            return { close() {} };
          },
        },
        backgroundTasks: {
          shutdown() {
            backgroundShutdownCalls += 1;
            return Promise.resolve();
          },
        },
        config: { server: {} },
        close() { resourceCloseCalls += 1; },
      };
    },
  });

  await lifecycle.shutdown('manual');

  assert.equal(listenCalls, 0);
  assert.equal(backgroundShutdownCalls, 1);
  assert.equal(resourceCloseCalls, 1);
  assert.deepEqual(processRef.exitCodes, [0]);
  assert.equal(processRef.listenerCount('SIGINT'), 0);
  assert.equal(processRef.listenerCount('SIGTERM'), 0);
  assert.equal(timerHarness.timers.length, 1);
  assert.equal(timerHarness.timers[0].cleared, true);
});

test('coalesces repeated shutdowns and closes resources only after HTTP and background tasks drain', async () => {
  const processRef = createProcessStub();
  const timerHarness = createTimerHarness();
  const backgroundDrain = createDeferred();
  let backgroundShutdownCalls = 0;
  let serverCloseCalls = 0;
  let serverCloseCallback;
  let resourceCloseCalls = 0;
  let detachExitCloseCalls = 0;

  const lifecycle = startServer({
    processRef,
    logger: createLoggerStub(),
    shutdownTimeoutMs: 25,
    ...timerHarness,
    createApp() {
      return {
        app: {
          listen() {
            return {
              close(callback) {
                assert.equal(backgroundShutdownCalls, 1);
                serverCloseCalls += 1;
                serverCloseCallback = callback;
              },
            };
          },
        },
        backgroundTasks: {
          shutdown() {
            backgroundShutdownCalls += 1;
            return backgroundDrain.promise;
          },
        },
        config: { server: { port: 5679, host: '127.0.0.1' } },
        close() { resourceCloseCalls += 1; },
        detachExitClose() { detachExitCloseCalls += 1; },
      };
    },
  });

  assert.ok(lifecycle.server);
  processRef.emit('SIGINT');
  processRef.emit('SIGTERM');
  const shutdownPromise = lifecycle.shutdown('manual');

  assert.equal(backgroundShutdownCalls, 1);
  assert.equal(serverCloseCalls, 1);
  assert.equal(resourceCloseCalls, 0);
  assert.equal(timerHarness.timers.length, 1);
  assert.equal(timerHarness.timers[0].delay, 25);

  serverCloseCallback();
  await Promise.resolve();
  assert.equal(resourceCloseCalls, 0);

  backgroundDrain.resolve();
  await shutdownPromise;
  timerHarness.timers[0].callback();

  assert.equal(timerHarness.timers[0].cleared, true);
  assert.equal(resourceCloseCalls, 1);
  assert.equal(detachExitCloseCalls, 0);
  assert.deepEqual(processRef.exitCodes, [0]);
});

test('waits for the real scheduler queue through detached provider work and its final checkpoint', async () => {
  const processRef = createProcessStub();
  const timerHarness = createTimerHarness();
  const scheduler = createLegacyAsyncScheduler();
  const providerPoll = createDeferred();
  const events = [];

  scheduler.schedule(null, 'real_provider_poll', () => {
    (async () => {
      await providerPoll.promise;
      events.push('provider settled');
      await new Promise((resolve) => setTimeout(resolve, 10));
      events.push('checkpoint committed');
    })();
  });

  const lifecycle = startServer({
    processRef,
    logger: createLoggerStub(),
    ...timerHarness,
    createApp() {
      return {
        app: {
          listen() {
            return { close(callback) { callback(); } };
          },
        },
        backgroundTasks: scheduler,
        config: { server: {} },
        close() { events.push('resources closed'); },
      };
    },
  });

  const shutdown = lifecycle.shutdown('manual');
  await Promise.resolve();
  assert.equal(scheduler.getState().accepting, false);
  assert.equal(scheduler.getState().active, 1);
  assert.deepEqual(events, []);
  assert.deepEqual(processRef.exitCodes, []);

  providerPoll.resolve();
  await shutdown;

  assert.deepEqual(events, ['provider settled', 'checkpoint committed', 'resources closed']);
  assert.deepEqual(processRef.exitCodes, [0]);
});

test('timeout exits with failure and never closes resources while a background task is active', async () => {
  const processRef = createProcessStub();
  const timerHarness = createTimerHarness();
  const backgroundDrain = createDeferred();
  const logEntries = [];
  let serverCloseCallback;
  let resourceCloseCalls = 0;
  let detachExitCloseCalls = 0;

  const lifecycle = startServer({
    processRef,
    logger: createLoggerStub(logEntries),
    shutdownTimeoutMs: 25,
    ...timerHarness,
    createApp() {
      return {
        app: {
          listen() {
            return {
              close(callback) { serverCloseCallback = callback; },
            };
          },
        },
        backgroundTasks: {
          getState() { return { active: 1 }; },
          shutdown() { return backgroundDrain.promise; },
        },
        config: { server: {} },
        close() { resourceCloseCalls += 1; },
        detachExitClose() { detachExitCloseCalls += 1; },
      };
    },
  });

  processRef.emit('SIGTERM');
  serverCloseCallback();
  timerHarness.timers[0].callback();

  assert.equal(resourceCloseCalls, 0);
  assert.equal(detachExitCloseCalls, 1);
  assert.deepEqual(processRef.exitCodes, [1]);
  const timeoutLog = logEntries.find((entry) => entry.message.includes('exiting without closing'));
  assert.equal(timeoutLog?.level, 'error');
  assert.equal(timeoutLog?.fields?.httpClosed, true);
  assert.equal(timeoutLog?.fields?.backgroundDrained, false);
  assert.equal(timeoutLog?.fields?.activeBackgroundTasks, 1);

  backgroundDrain.resolve();
  await lifecycle.shutdown('manual');
  assert.equal(resourceCloseCalls, 0);
  assert.deepEqual(processRef.exitCodes, [1]);
});

test('a failed background drain exits without closing resources whose safety is unknown', async () => {
  const processRef = createProcessStub();
  const timerHarness = createTimerHarness();
  const logEntries = [];
  let resourceCloseCalls = 0;
  let detachExitCloseCalls = 0;

  const lifecycle = startServer({
    processRef,
    logger: createLoggerStub(logEntries),
    shutdownTimeoutMs: 25,
    ...timerHarness,
    createApp() {
      return {
        app: {
          listen() {
            return { close(callback) { callback(); } };
          },
        },
        backgroundTasks: {
          shutdown() { return Promise.reject(new Error('drain unavailable')); },
        },
        config: { server: {} },
        close() { resourceCloseCalls += 1; },
        detachExitClose() { detachExitCloseCalls += 1; },
      };
    },
  });

  await lifecycle.shutdown('manual');

  assert.equal(resourceCloseCalls, 0);
  assert.equal(detachExitCloseCalls, 1);
  assert.deepEqual(processRef.exitCodes, [1]);
  assert.equal(timerHarness.timers[0].cleared, true);
  assert.ok(logEntries.some((entry) => entry.message.includes('drain failed')));
});

test('an HTTP close failure does not release resources while request safety is unknown', async () => {
  const processRef = createProcessStub();
  const timerHarness = createTimerHarness();
  const logEntries = [];
  let resourceCloseCalls = 0;
  let detachExitCloseCalls = 0;

  const lifecycle = startServer({
    processRef,
    logger: createLoggerStub(logEntries),
    ...timerHarness,
    createApp() {
      return {
        app: {
          listen() {
            return { close(callback) { callback(new Error('listener still active')); } };
          },
        },
        backgroundTasks: { shutdown() { return Promise.resolve(); } },
        config: { server: {} },
        close() { resourceCloseCalls += 1; },
        detachExitClose() { detachExitCloseCalls += 1; },
      };
    },
  });

  await lifecycle.shutdown('manual');

  assert.equal(resourceCloseCalls, 0);
  assert.equal(detachExitCloseCalls, 1);
  assert.deepEqual(processRef.exitCodes, [1]);
  assert.equal(timerHarness.timers[0].cleared, true);
  assert.ok(logEntries.some((entry) => entry.message.includes('HTTP server close failed')));
});

test('refuses to release resources when the application exposes no real scheduler', async () => {
  const processRef = createProcessStub();
  const timerHarness = createTimerHarness();
  const logEntries = [];
  let resourceCloseCalls = 0;

  const lifecycle = startServer({
    processRef,
    logger: createLoggerStub(logEntries),
    ...timerHarness,
    createApp() {
      return {
        app: {
          listen() {
            return { close(callback) { callback(); } };
          },
        },
        config: { server: {} },
        close() { resourceCloseCalls += 1; },
      };
    },
  });

  await lifecycle.shutdown('manual');

  assert.equal(resourceCloseCalls, 0);
  assert.deepEqual(processRef.exitCodes, [1]);
  assert.ok(logEntries.some((entry) => (
    entry.message.includes('drain failed')
    && entry.fields?.error.includes('scheduler is unavailable')
  )));
});
