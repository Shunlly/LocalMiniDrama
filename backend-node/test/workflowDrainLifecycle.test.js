const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const { createLegacyAsyncScheduler } = require('../src/services/legacyAsyncSchedulerService');
const providerSdkService = require('../src/services/providerSdkService');
const workflowService = require('../src/services/workflowService');

const log = { info() {}, warn() {}, error() {} };

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createDb(t) {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO dramas (id, title, description, style, status, created_at, updated_at)
     VALUES (1, 'Lifecycle', 'Workflow drain fixture', 'anime', 'draft', ?, ?)`
  ).run(now, now);
  t.after(() => db.close());
  return db;
}

test('production start and repair fail closed before creating workflow rows', (t) => {
  const db = createDb(t);
  const launches = [
    () => workflowService.startNovel2AnimeWorkflow(db, log, {
      drama_id: 1,
      qa_mode: 'production',
      text: 'Production source',
    }),
    () => workflowService.startNovel2AnimeRepairWorkflow(db, log, {
      drama_id: 1,
      mode: 'production',
      action: 'audit_only',
    }),
  ];

  for (const launch of launches) {
    assert.throws(
      launch,
      (error) => error.code === 'WORKFLOW_NOT_READY' && error.status === 409
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM workflow_runs').get().count, 0);
  }
});

test('workflow queue drain waits for provider polling and the durable step commit', async (t) => {
  const db = createDb(t);
  const scheduler = createLegacyAsyncScheduler();
  const providerStarted = createDeferred();
  const providerPoll = createDeferred();
  const originalGenerateVideos = providerSdkService.generateStoryboardVideos;
  t.after(() => {
    providerSdkService.generateStoryboardVideos = originalGenerateVideos;
  });

  providerSdkService.generateStoryboardVideos = async () => {
    providerStarted.resolve();
    await providerPoll.promise;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return {
      mode: 'production-simulated',
      storyboard_count: 1,
      video_created: 1,
      video_reused: 0,
    };
  };

  const run = workflowService.createWorkflowRun(db, log, {
    drama_id: 1,
    type: 'novel2anime:drain-test',
    steps: [{ key: 'video_generation', label: 'Provider polling' }],
  });
  workflowService.scheduleWorkflowRun(db, log, run.id, { backgroundTasks: scheduler });
  await providerStarted.promise;

  const drain = scheduler.shutdown();
  let drained = false;
  drain.then(() => { drained = true; });
  await Promise.resolve();

  const processingStep = workflowService.getWorkflowSteps(db, run.id)[0];
  assert.equal(processingStep.status, 'processing');
  assert.equal(drained, false);
  assert.equal(scheduler.getState().active, 1);
  assert.throws(
    () => workflowService.scheduleWorkflowRun(db, log, run.id, { backgroundTasks: scheduler }),
    (error) => error.code === 'LEGACY_ASYNC_SCHEDULER_CLOSED'
  );

  providerPoll.resolve();
  const finalState = await drain;
  const detail = workflowService.getWorkflowRunDetail(db, run.id);

  assert.equal(finalState.active, 0);
  assert.equal(finalState.completed, 1);
  assert.equal(detail.status, 'completed');
  assert.equal(detail.steps[0].status, 'completed');
  assert.equal(detail.steps[0].output_json.video_created, 1);
});

test('cancelled workflow detail reports an active worker until the in-flight run exits', async (t) => {
  const db = createDb(t);
  const providerStarted = createDeferred();
  const releaseProvider = createDeferred();
  const originalGenerateVideos = providerSdkService.generateStoryboardVideos;
  t.after(() => {
    providerSdkService.generateStoryboardVideos = originalGenerateVideos;
  });
  providerSdkService.generateStoryboardVideos = async () => {
    providerStarted.resolve();
    await releaseProvider.promise;
    return {
      mode: 'production-simulated',
      storyboard_count: 1,
      video_created: 1,
      video_reused: 0,
    };
  };
  const run = workflowService.createWorkflowRun(db, log, {
    drama_id: 1,
    type: 'novel2anime:cancel-worker-lifecycle',
    steps: [{ key: 'video_generation', label: 'Video generation' }],
  });

  const worker = workflowService.processWorkflowRun(db, log, run.id);
  await providerStarted.promise;

  try {
    const cancelled = workflowService.cancelWorkflowRun(db, log, run.id, 'test cancellation');
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.worker_active, true);
    assert.equal(cancelled.steps[0].status, 'cancelled');

    releaseProvider.resolve();
    const drainedResult = await worker;
    assert.equal(drainedResult.worker_active, false);
    assert.equal(drainedResult.status, 'cancelled');
    assert.equal(drainedResult.steps[0].status, 'cancelled');

    const drained = workflowService.getWorkflowRunDetail(db, run.id);
    assert.equal(drained.worker_active, false);
    assert.equal(drained.status, 'cancelled');
    assert.equal(drained.steps[0].status, 'cancelled');
  } finally {
    releaseProvider.resolve();
    await worker;
  }
});
