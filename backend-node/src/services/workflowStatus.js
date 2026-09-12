'use strict';

// 从 workflowService 拆出的工作流状态装配：行到接口对象、详情拼装、类型过滤与状态写入。

const { toUserFacingProcessError } = require('./providerErrorSanitizer');
const { isWorkflowWorkerActive } = require('./workflowQueue');

const RUN_ACTIVE_STATUSES = new Set(['pending', 'processing']);
const RUN_TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

function nowIso() {
  return new Date().toISOString();
}

/** 将工作流失败原因转成制作页可见中文；步骤名中的下划线不视为泄漏 */
function toUserFacingWorkflowError(error) {
  const raw = typeof error === 'string' ? error.trim() : String(error && error.message || error || '').trim();
  const mapped = toUserFacingProcessError(error, '工作流步骤失败，请稍后重试');
  if (mapped === raw) return mapped;
  if (
    raw
    && raw.length <= 240
    && /[一-鿿]/.test(raw)
    && !/https?:\/\//i.test(raw)
    && !/\bsk-[A-Za-z0-9._-]{6,}\b/i.test(raw)
    && !/\bHTTP\s*[:=]?\s*\d{3}\b/i.test(raw)
    && !/invalid\s*authorization|invalidauthorization|invalid\s+token|invalid\s+api\s+key/i.test(raw)
    && !/\b[A-Z]{3,}(?:_[A-Z0-9]+){1,}\b/.test(raw)
    && !/\b(SQLITE_[A-Z0-9]+|no such table|database is locked|fetch failed|AbortError|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|ENETUNREACH|ETIMEDOUT|ENOENT|unauthorized|forbidden|not found|bad request|internal server error|too many requests|service unavailable|gateway timeout|timed?\s*out)\b/i.test(raw)
  ) {
    return raw;
  }
  return mapped;
}

function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function toJson(value) {
  return JSON.stringify(value == null ? {} : value);
}

function rowToRun(row) {
  return {
    id: row.id,
    drama_id: row.drama_id,
    episode_id: row.episode_id,
    type: row.type,
    status: row.status,
    progress: row.progress ?? 0,
    current_step: row.current_step,
    input_json: parseJson(row.input_json, {}),
    output_json: parseJson(row.output_json, {}),
    error: row.error,
    started_at: row.started_at,
    completed_at: row.completed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function rowToStep(row) {
  return {
    id: row.id,
    run_id: row.run_id,
    step_key: row.step_key,
    status: row.status,
    attempts: row.attempts ?? 0,
    input_json: parseJson(row.input_json, {}),
    output_json: parseJson(row.output_json, {}),
    error: row.error,
    sort_order: row.sort_order ?? 0,
    started_at: row.started_at,
    completed_at: row.completed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function getWorkflowRun(db, runId) {
  const row = db.prepare('SELECT * FROM workflow_runs WHERE id = ? AND deleted_at IS NULL').get(String(runId));
  return row ? rowToRun(row) : null;
}

function getWorkflowSteps(db, runId) {
  return db.prepare(
    'SELECT * FROM workflow_steps WHERE run_id = ? ORDER BY sort_order ASC, created_at ASC'
  ).all(String(runId)).map(rowToStep);
}

function getWorkflowProviderSummaries(db, runId) {
  return db.prepare(
    `SELECT workflow_step_id, provider_type, provider_name, model, mode, status, cost_estimate, cost_kind
       FROM provider_invocations
      WHERE run_id = ?
      ORDER BY id ASC`
  ).all(String(runId)).map((row) => {
    const storedCost = row.cost_estimate == null ? null : Number(row.cost_estimate);
    const legacyUnknown = !row.cost_kind && row.mode === 'production' && storedCost === 0;
    const costKind = row.cost_kind || (
      row.mode === 'mock' ? 'non_billable' : legacyUnknown || storedCost == null ? 'unknown' : 'estimated'
    );
    return {
      workflow_step_id: row.workflow_step_id,
      provider_type: row.provider_type,
      provider_name: row.provider_name,
      model: row.model,
      mode: row.mode,
      status: row.status,
      cost_estimate: legacyUnknown ? null : storedCost,
      cost_kind: costKind,
    };
  });
}

function getWorkflowRunDetail(db, runId) {
  const run = getWorkflowRun(db, runId);
  if (!run) return null;
  const providerInvocations = getWorkflowProviderSummaries(db, run.id);
  const providersByStep = new Map();
  for (const invocation of providerInvocations) {
    if (!invocation.workflow_step_id) continue;
    const values = providersByStep.get(invocation.workflow_step_id) || [];
    values.push(invocation);
    providersByStep.set(invocation.workflow_step_id, values);
  }
  const steps = getWorkflowSteps(db, run.id).map((step) => ({
    ...step,
    provider_invocations: providersByStep.get(step.id) || [],
  }));
  return {
    ...run,
    steps,
    provider_invocations: providerInvocations,
    worker_active: isWorkflowWorkerActive(run.id),
  };
}

function applyWorkflowTypeFilter(sql, params, type, column = 'type') {
  const normalized = String(type || '').trim();
  if (!normalized) return sql;
  if (normalized.includes(':')) {
    params.push(normalized);
    return `${sql} AND ${column} = ?`;
  }
  params.push(normalized, `${normalized}:%`);
  return `${sql} AND (${column} = ? OR ${column} LIKE ?)`;
}

function listWorkflowRuns(db, query = {}) {
  let sql = 'SELECT * FROM workflow_runs WHERE deleted_at IS NULL';
  const params = [];
  if (query.drama_id != null) {
    sql += ' AND drama_id = ?';
    params.push(Number(query.drama_id));
  }
  if (query.type) {
    sql = applyWorkflowTypeFilter(sql, params, query.type);
  }
  if (query.status) {
    sql += ' AND status = ?';
    params.push(String(query.status));
  }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(Math.max(1, Math.min(100, Number(query.limit) || 20)));
  return db.prepare(sql).all(...params).map(rowToRun);
}

function setRunStatus(db, runId, status, patch = {}) {
  const now = nowIso();
  const run = getWorkflowRun(db, runId);
  if (!run) return null;
  const startedAt = patch.started_at !== undefined ? patch.started_at : (run.started_at || (status === 'processing' ? now : null));
  const completedAt = patch.completed_at !== undefined
    ? patch.completed_at
    : (RUN_TERMINAL_STATUSES.has(status) ? now : null);
  db.prepare(
    `UPDATE workflow_runs
     SET status = ?, progress = ?, current_step = ?, output_json = ?, error = ?, started_at = ?, completed_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    status,
    patch.progress ?? run.progress ?? 0,
    patch.current_step !== undefined ? patch.current_step : run.current_step,
    patch.output_json !== undefined ? toJson(patch.output_json) : toJson(run.output_json || {}),
    patch.error !== undefined ? patch.error : run.error,
    startedAt,
    completedAt,
    now,
    runId
  );
  return getWorkflowRun(db, runId);
}

function setStepStatus(db, stepId, status, patch = {}) {
  const now = nowIso();
  const row = db.prepare('SELECT * FROM workflow_steps WHERE id = ?').get(String(stepId));
  if (!row) return null;
  const startedAt = patch.started_at !== undefined ? patch.started_at : (row.started_at || (status === 'processing' ? now : null));
  const completedAt = patch.completed_at !== undefined
    ? patch.completed_at
    : (status === 'completed' || status === 'failed' || status === 'cancelled' ? now : null);
  const attempts = patch.attempts !== undefined ? patch.attempts : row.attempts;
  db.prepare(
    `UPDATE workflow_steps
     SET status = ?, attempts = ?, output_json = ?, error = ?, started_at = ?, completed_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    status,
    attempts,
    patch.output_json !== undefined ? toJson(patch.output_json) : row.output_json,
    patch.error !== undefined ? patch.error : row.error,
    startedAt,
    completedAt,
    now,
    stepId
  );
  return db.prepare('SELECT * FROM workflow_steps WHERE id = ?').get(String(stepId));
}

module.exports = {
  RUN_ACTIVE_STATUSES,
  RUN_TERMINAL_STATUSES,
  nowIso,
  parseJson,
  toJson,
  toUserFacingWorkflowError,
  rowToRun,
  rowToStep,
  getWorkflowRun,
  getWorkflowSteps,
  getWorkflowProviderSummaries,
  getWorkflowRunDetail,
  applyWorkflowTypeFilter,
  listWorkflowRuns,
  setRunStatus,
  setStepStatus,
};
