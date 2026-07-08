const scheduledJobs = new Map();

function nowIso() {
  return new Date().toISOString();
}

function jobKey(label, meta) {
  const id = meta?.task_id || meta?.id || meta?.resource_id || '';
  return id ? `${label}:${id}` : `${label}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function scheduleLegacyAsync(log, label, fn, meta = {}) {
  if (typeof fn !== 'function') {
    throw new Error('scheduleLegacyAsync requires a function');
  }
  const key = jobKey(label || 'legacy_async', meta);
  scheduledJobs.set(key, {
    label: label || 'legacy_async',
    meta,
    status: 'queued',
    created_at: nowIso(),
    updated_at: nowIso(),
  });

  Promise.resolve().then(async () => {
    const current = scheduledJobs.get(key);
    if (current) scheduledJobs.set(key, { ...current, status: 'running', updated_at: nowIso() });
    try {
      await fn();
      const running = scheduledJobs.get(key);
      if (running) scheduledJobs.set(key, { ...running, status: 'completed', updated_at: nowIso(), completed_at: nowIso() });
    } catch (err) {
      const running = scheduledJobs.get(key);
      if (running) {
        scheduledJobs.set(key, {
          ...running,
          status: 'failed',
          error: err.message || String(err),
          updated_at: nowIso(),
          completed_at: nowIso(),
        });
      }
      log?.error?.('Legacy async job failed', {
        label,
        ...meta,
        error: err.message || String(err),
      });
    }
  });

  return key;
}

function getLegacyAsyncSchedulerState() {
  const jobs = Array.from(scheduledJobs.entries()).map(([id, job]) => ({ id, ...job }));
  return {
    queued: jobs.filter((job) => job.status === 'queued').length,
    running: jobs.filter((job) => job.status === 'running').length,
    completed: jobs.filter((job) => job.status === 'completed').length,
    failed: jobs.filter((job) => job.status === 'failed').length,
    recent: jobs.slice(-20),
  };
}

module.exports = {
  scheduleLegacyAsync,
  getLegacyAsyncSchedulerState,
};
