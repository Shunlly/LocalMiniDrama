const { AsyncLocalStorage, createHook } = require('node:async_hooks');

function nowIso() {
  return new Date().toISOString();
}

function jobKey(label, meta) {
  const id = meta?.task_id || meta?.id || meta?.resource_id || '';
  return id ? `${label}:${id}` : `${label}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function createSchedulerClosedError() {
  const error = new Error('Background task scheduler is draining and no longer accepts new jobs');
  error.code = 'LEGACY_ASYNC_SCHEDULER_CLOSED';
  error.status = 503;
  return error;
}

function createBackgroundTaskDrainError(failures) {
  const error = new AggregateError(
    failures.map((failure) => failure.error),
    `${failures.length} background task(s) failed while draining`
  );
  error.code = 'BACKGROUND_TASK_DRAIN_FAILED';
  error.failures = failures.map((failure) => ({
    id: failure.id,
    label: failure.label,
    meta: failure.meta,
    error: failure.error?.message || String(failure.error),
  }));
  return error;
}

function normalizeTaskError(reason) {
  if (reason instanceof Error) return reason;
  if (reason && typeof reason === 'object' && typeof reason.message === 'string') return reason;
  const error = new Error(
    reason == null ? 'Background task rejected without an error' : String(reason)
  );
  error.cause = reason;
  return error;
}

function createLegacyAsyncScheduler(options = {}) {
  const scheduledJobs = new Map();
  const activeJobs = new Set();
  const taskContext = new AsyncLocalStorage();
  const resourceOwners = new Map();
  const setTimeoutFn = options.setTimeoutFn || setTimeout;
  const queueTask = options.queueTask || queueMicrotask;
  const maxHistory = Math.max(20, Number(options.maxHistory) || 200);

  let accepting = true;
  let drainPromise = null;
  let resolveDrain = null;
  let hookEnabled = false;
  let activeTrackers = 0;
  let jobSequence = 0;
  let completedJobs = 0;
  let failedJobs = 0;

  function maybeFinishTracker(tracker) {
    if (tracker.finished || !tracker.callbackReturned || tracker.pendingResources !== 0) return;
    tracker.finished = true;
    activeTrackers -= 1;
    tracker.resolve();
    if (activeTrackers === 0 && hookEnabled) {
      resourceHook.disable();
      hookEnabled = false;
    }
  }

  function stopTracking(tracker) {
    if (tracker.finished) return;
    tracker.finished = true;
    for (const [asyncId, owner] of resourceOwners) {
      if (owner.tracker === tracker) resourceOwners.delete(asyncId);
    }
    tracker.pendingResources = 0;
    activeTrackers -= 1;
    tracker.resolve();
    if (activeTrackers === 0 && hookEnabled) {
      resourceHook.disable();
      hookEnabled = false;
    }
  }

  function releaseResource(asyncId, expectedType = null) {
    const owner = resourceOwners.get(asyncId);
    if (!owner || (expectedType && owner.type !== expectedType)) return;
    resourceOwners.delete(asyncId);
    owner.tracker.pendingResources -= 1;
    maybeFinishTracker(owner.tracker);
  }

  const resourceHook = createHook({
    init(asyncId, type) {
      if (type !== 'PROMISE' && type !== 'Timeout') return;
      const tracker = taskContext.getStore();
      if (!tracker || tracker.finished) return;
      resourceOwners.set(asyncId, { tracker, type });
      tracker.pendingResources += 1;
    },
    promiseResolve(asyncId) {
      releaseResource(asyncId, 'PROMISE');
    },
    after(asyncId) {
      releaseResource(asyncId, 'Timeout');
    },
    destroy(asyncId) {
      releaseResource(asyncId);
    },
  });

  // Many legacy callbacks discard async return values. The async resource scope keeps
  // their promises and timers attached to the owning job until the final write settles.
  function trackInvocation(fn) {
    let resolveTracking;
    const trackingDone = new Promise((resolve) => {
      resolveTracking = resolve;
    });
    const tracker = {
      callbackReturned: false,
      finished: false,
      pendingResources: 0,
      resolve: resolveTracking,
    };

    activeTrackers += 1;
    if (!hookEnabled) {
      resourceHook.enable();
      hookEnabled = true;
    }

    let returned;
    let invocationError;
    let hasInvocationError = false;
    try {
      returned = taskContext.run(tracker, fn);
    } catch (error) {
      invocationError = error;
      hasInvocationError = true;
    }
    tracker.callbackReturned = true;

    if (!hasInvocationError && returned && typeof returned.then === 'function') {
      stopTracking(tracker);
      return Promise.resolve(returned);
    }

    maybeFinishTracker(tracker);

    let returnedError;
    let hasReturnedError = false;
    const returnedDone = hasInvocationError
      ? Promise.resolve()
      : Promise.resolve(returned).catch((error) => {
        returnedError = error;
        hasReturnedError = true;
      });

    return Promise.all([trackingDone, returnedDone]).then(() => {
      if (hasInvocationError) throw invocationError;
      if (hasReturnedError) throw returnedError;
    });
  }

  function getState() {
    const jobs = Array.from(scheduledJobs.entries()).map(([id, job]) => ({ id, ...job }));
    return {
      accepting,
      draining: !accepting && activeJobs.size > 0,
      active: activeJobs.size,
      queued: jobs.filter((job) => job.status === 'queued').length,
      running: jobs.filter((job) => job.status === 'running').length,
      completed: completedJobs,
      failed: failedJobs,
      recent: jobs.slice(-20),
    };
  }

  function maybeFinishDrain() {
    if (!resolveDrain || activeJobs.size !== 0) return;
    const resolve = resolveDrain;
    resolveDrain = null;
    resolve(getState());
  }

  function assertAccepting() {
    if (!accepting) throw createSchedulerClosedError();
    return true;
  }

  function uniqueJobKey(label, meta) {
    const base = jobKey(label, meta);
    if (!scheduledJobs.has(base)) return base;
    jobSequence += 1;
    return `${base}:${jobSequence}`;
  }

  function registerJob(label, meta, status) {
    const id = uniqueJobKey(label, meta);
    const createdAt = nowIso();
    scheduledJobs.set(id, {
      label,
      meta,
      status,
      created_at: createdAt,
      updated_at: createdAt,
    });
    activeJobs.add(id);
    return id;
  }

  function updateJob(id, patch) {
    const current = scheduledJobs.get(id);
    if (!current) return;
    scheduledJobs.set(id, { ...current, ...patch, updated_at: nowIso() });
  }

  function trimHistory() {
    if (scheduledJobs.size <= maxHistory) return;
    for (const [id] of scheduledJobs) {
      if (scheduledJobs.size <= maxHistory) break;
      if (!activeJobs.has(id)) scheduledJobs.delete(id);
    }
  }

  function settleJob(log, id, error) {
    const current = scheduledJobs.get(id);
    const completedAt = nowIso();
    if (error) {
      failedJobs += 1;
      updateJob(id, {
        status: 'failed',
        error: error?.message || String(error),
        completed_at: completedAt,
      });
      log?.error?.('Legacy async job failed', {
        label: current?.label,
        ...(current?.meta || {}),
        error: error?.message || String(error),
      });
    } else {
      completedJobs += 1;
      updateJob(id, { status: 'completed', completed_at: completedAt });
    }
    activeJobs.delete(id);
    trimHistory();
    maybeFinishDrain();
  }

  function invokeJob(log, id, fn) {
    updateJob(id, { status: 'running' });
    let completion;
    try {
      completion = trackInvocation(fn);
    } catch (error) {
      settleJob(log, id, error);
      return;
    }
    Promise.resolve(completion).then(
      () => settleJob(log, id, null),
      (error) => settleJob(log, id, normalizeTaskError(error))
    );
  }

  function validateTask(fn, apiName) {
    if (typeof fn !== 'function') throw new Error(`${apiName} requires a function`);
  }

  function schedule(log, label, fn, meta = {}) {
    validateTask(fn, 'scheduleLegacyAsync');
    assertAccepting();

    const normalizedLabel = label || 'legacy_async';
    const id = registerJob(normalizedLabel, meta, 'queued');
    try {
      queueTask(() => invokeJob(log, id, fn));
    } catch (error) {
      activeJobs.delete(id);
      scheduledJobs.delete(id);
      maybeFinishDrain();
      throw error;
    }
    return id;
  }

  function runTracked(log, label, fn, meta = {}) {
    validateTask(fn, 'runTrackedBackgroundTask');
    assertAccepting();

    const normalizedLabel = label || 'tracked_async';
    const id = registerJob(normalizedLabel, meta, 'running');
    invokeJob(log, id, fn);
    return id;
  }

  function scheduleDelayed(log, label, delayMs, fn, meta = {}) {
    validateTask(fn, 'scheduleDelayedBackgroundTask');
    const normalizedDelay = Number(delayMs);
    if (!Number.isFinite(normalizedDelay) || normalizedDelay < 0) {
      throw new Error('scheduleDelayedBackgroundTask requires a non-negative delay');
    }
    return schedule(log, label, () => new Promise((resolve, reject) => {
      setTimeoutFn(() => {
        Promise.resolve().then(fn).then(resolve, reject);
      }, normalizedDelay);
    }), meta);
  }

  function shutdown() {
    accepting = false;
    if (!drainPromise) {
      drainPromise = new Promise((resolve) => {
        resolveDrain = resolve;
      });
      maybeFinishDrain();
    }
    return drainPromise;
  }

  return {
    assertAccepting,
    getState,
    runTracked,
    schedule,
    scheduleDelayed,
    shutdown,
  };
}

const backgroundTasks = createLegacyAsyncScheduler();

module.exports = {
  backgroundTasks,
  createBackgroundTaskDrainError,
  createLegacyAsyncScheduler,
  createSchedulerClosedError,
  assertBackgroundTasksAccepting: backgroundTasks.assertAccepting,
  getBackgroundTasksState: backgroundTasks.getState,
  runTrackedBackgroundTask: backgroundTasks.runTracked,
  scheduleBackgroundTask: backgroundTasks.schedule,
  scheduleDelayedBackgroundTask: backgroundTasks.scheduleDelayed,
  shutdownBackgroundTasks: backgroundTasks.shutdown,
  getLegacyAsyncSchedulerState: backgroundTasks.getState,
  scheduleLegacyAsync: backgroundTasks.schedule,
  shutdownLegacyAsyncScheduler: backgroundTasks.shutdown,
};
