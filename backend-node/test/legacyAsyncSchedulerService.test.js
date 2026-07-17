const test = require('node:test');
const assert = require('node:assert/strict');

const { createLegacyAsyncScheduler } = require('../src/services/legacyAsyncSchedulerService');
const { createBackgroundTaskContextMiddleware } = require('../src/app');

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

test('shutdown synchronously rejects new jobs and drains returned and detached promises', async () => {
  const scheduler = createLegacyAsyncScheduler();
  const returnedTask = createDeferred();
  const detachedTask = createDeferred();
  const writes = [];

  scheduler.schedule(null, 'returned', () => returnedTask.promise.then(() => {
    writes.push('returned');
  }));
  scheduler.schedule(null, 'detached', () => {
    (async () => {
      await detachedTask.promise;
      writes.push('detached');
    })();
  });

  const firstDrain = scheduler.shutdown();
  const secondDrain = scheduler.shutdown();
  assert.strictEqual(secondDrain, firstDrain);
  assert.equal(scheduler.getState().accepting, false);
  assert.throws(
    () => scheduler.schedule(null, 'late', () => {}),
    (error) => error.code === 'LEGACY_ASYNC_SCHEDULER_CLOSED'
  );

  let drained = false;
  firstDrain.then(() => { drained = true; });
  await Promise.resolve();
  assert.equal(drained, false);
  assert.equal(scheduler.getState().active, 2);

  returnedTask.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(drained, false);

  detachedTask.resolve();
  const finalState = await firstDrain;
  assert.equal(drained, true);
  assert.deepEqual(writes.sort(), ['detached', 'returned']);
  assert.equal(finalState.active, 0);
  assert.equal(finalState.completed, 2);
  assert.equal(finalState.failed, 0);
});

test('failed returned jobs are logged and still allow shutdown to drain', async () => {
  const scheduler = createLegacyAsyncScheduler();
  const errors = [];
  scheduler.schedule({
    error(message, fields) { errors.push({ message, fields }); },
  }, 'failure', async () => {
    throw new Error('generation failed');
  }, { task_id: 42 });

  const state = await scheduler.shutdown();

  assert.equal(state.active, 0);
  assert.equal(state.failed, 1);
  assert.equal(state.completed, 0);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].message, 'Legacy async job failed');
  assert.equal(errors[0].fields.task_id, 42);
  assert.equal(errors[0].fields.error, 'generation failed');
});

test('returned promises with timer-backed continuations drain without async hook retention', async () => {
  const scheduler = createLegacyAsyncScheduler();
  const checkpoints = [];

  scheduler.schedule(null, 'returned-timer', async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    checkpoints.push('committed');
  });

  const state = await scheduler.shutdown();
  assert.deepEqual(checkpoints, ['committed']);
  assert.equal(state.active, 0);
  assert.equal(state.completed, 1);
});

test('API task context drains bare route timers and rejects requests after draining starts', async () => {
  const scheduler = createLegacyAsyncScheduler();
  const middleware = createBackgroundTaskContextMiddleware(scheduler, null);
  const writes = [];

  middleware({ requestId: 'request-1', method: 'POST', path: '/stub' }, {}, (error) => {
    assert.equal(error, undefined);
    setTimeout(() => writes.push('timer checkpoint'), 10);
  });

  const drain = scheduler.shutdown();
  let drained = false;
  drain.then(() => { drained = true; });
  await Promise.resolve();

  assert.equal(drained, false);
  assert.equal(scheduler.getState().active, 1);

  const finalState = await drain;
  assert.deepEqual(writes, ['timer checkpoint']);
  assert.equal(finalState.active, 0);
  assert.equal(finalState.completed, 1);

  let rejection;
  middleware({ requestId: 'request-2', method: 'POST', path: '/late' }, {}, (error) => {
    rejection = error;
  });
  assert.equal(rejection?.code, 'LEGACY_ASYNC_SCHEDULER_CLOSED');
  assert.equal(rejection?.status, 503);
});
