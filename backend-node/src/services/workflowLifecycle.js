'use strict';

// 从 workflowService 拆出的工作流生命周期：启动、修复、重试、取消、暂停、恢复与排空。
// 启动/修复需要公开入口里的 createWorkflowRun 与步骤清单；函数内延迟 require，避免循环依赖。

const dramaService = require('./dramaService');
const providerSdkService = require('./providerSdkService');
const readinessService = require('./readinessService');
const { backgroundTasks: defaultBackgroundTasks } = require('./legacyAsyncSchedulerService');
const {
  nowIso,
  toJson,
  RUN_TERMINAL_STATUSES,
  getWorkflowRun,
  getWorkflowRunDetail,
  setRunStatus,
} = require('./workflowStatus');
const {
  scheduleWorkflowRun,
  waitForWorkflowWorkersToIdle,
} = require('./workflowQueue');

function assertNovel2AnimeLaunchReadiness(db, params = {}) {
  if (params.qa_mode !== 'production' && params.mode !== 'production') return null;
  return readinessService.assertNovel2AnimeReadiness(db, params);
}

function startNovel2AnimeWorkflow(db, log, params = {}) {
  const { createWorkflowRun, NOVEL2ANIME_STEPS } = require('./workflowService');
  assertNovel2AnimeLaunchReadiness(db, params);
  defaultBackgroundTasks.assertAccepting();
  const run = createWorkflowRun(db, log, { ...params, type: 'novel2anime', steps: NOVEL2ANIME_STEPS });
  scheduleWorkflowRun(db, log, run.id);
  return run;
}

function stepsFromKeys(stepKeys) {
  const { NOVEL2ANIME_STEPS } = require('./workflowService');
  const keySet = new Set(stepKeys || []);
  return NOVEL2ANIME_STEPS.filter((step) => keySet.has(step.key));
}

function inheritProductionProviderAudits(db, log, targetRunId, dramaId, sourceRunId = null) {
  const existingTypes = new Set(
    db.prepare('SELECT provider_type FROM provider_invocations WHERE run_id = ? AND status = ?')
      .all(String(targetRunId), 'success')
      .map((row) => String(row.provider_type || '').toLowerCase())
  );
  const sourceRows = db.prepare(
    `SELECT invocation.*
       FROM provider_invocations invocation
       INNER JOIN workflow_runs run ON run.id = invocation.run_id
      WHERE run.drama_id = ?
        AND invocation.run_id != ?
        AND invocation.status = 'success'
        AND LOWER(COALESCE(invocation.mode, '')) != 'mock'
        AND LOWER(COALESCE(invocation.provider_name, '')) NOT LIKE 'mock%'
        AND (? IS NULL OR invocation.run_id = ?)
      ORDER BY COALESCE(run.completed_at, run.updated_at, run.created_at) DESC, invocation.id DESC`
  ).all(Number(dramaId), String(targetRunId), sourceRunId || null, sourceRunId || null);
  let inherited = 0;
  for (const row of sourceRows) {
    const providerType = String(row.provider_type || '').toLowerCase();
    if (!providerType || existingTypes.has(providerType)) continue;
    let output = {};
    try { output = JSON.parse(row.output_json || '{}'); } catch (_) {}
    providerSdkService.recordProviderInvocation(db, {
      run_id: targetRunId,
      provider_type: row.provider_type,
      provider_name: row.provider_name,
      model: row.model,
      mode: 'production',
      status: 'success',
      input: { inherited_from_run_id: row.run_id, inherited_invocation_id: row.id },
      output,
      billable: false,
    });
    existingTypes.add(providerType);
    inherited += 1;
  }
  if (inherited) {
    log?.info?.('Production provider audit evidence inherited', {
      run_id: targetRunId,
      drama_id: dramaId,
      inherited_count: inherited,
    });
  }
  return inherited;
}

function startNovel2AnimeRepairWorkflow(db, log, params = {}) {
  const { createWorkflowRun } = require('./workflowService');
  assertNovel2AnimeLaunchReadiness(db, params);
  const action = String(params.action || '').trim();
  const actionSteps = {
    refresh_asset_bible: ['asset_bible', 'qa_audit'],
    repair_storyboards: ['storyboard_draft', 'image_generation', 'video_generation', 'audio_generation', 'timeline_plan', 'post_composite', 'qa_audit'],
    repair_timeline: ['timeline_plan', 'post_composite', 'qa_audit'],
    audit_only: ['qa_audit'],
  };
  const steps = stepsFromKeys(actionSteps[action] || actionSteps.repair_storyboards);
  if (!steps.length) {
    const err = new Error(`不支持的修复操作：${action}，请选择有效的修复动作后重试`);
    err.code = 'BAD_REQUEST';
    throw err;
  }
  defaultBackgroundTasks.assertAccepting();
  const run = createWorkflowRun(db, log, {
    ...params,
    type: `novel2anime:${action || 'repair'}`,
    steps,
    metadata: {
      ...(params.metadata || {}),
      repair_action: action || 'repair_storyboards',
    },
  });
  if (run.input_json?.qa_mode === 'production') {
    inheritProductionProviderAudits(db, log, run.id, run.drama_id, params.source_run_id || null);
  }
  scheduleWorkflowRun(db, log, run.id);
  return run;
}

function retryWorkflowRun(db, log, runId, options = {}) {
  const run = getWorkflowRun(db, runId);
  if (!run) return null;
  if (run.status !== 'failed') {
    const err = new Error('只有失败的工作流可以重试');
    err.code = 'BAD_REQUEST';
    throw err;
  }
  dramaService.assertDramaWritable(db, run.drama_id);
  assertProductionRunReadiness(db, run);
  defaultBackgroundTasks.assertAccepting();
  const now = nowIso();
  const stepInputs = options.step_inputs && typeof options.step_inputs === 'object' ? options.step_inputs : {};
  for (const [stepKey, input] of Object.entries(stepInputs)) {
    db.prepare(
      `UPDATE workflow_steps
       SET input_json = ?, updated_at = ?
       WHERE run_id = ? AND step_key = ? AND status = 'failed'`
    ).run(toJson(input), now, run.id, stepKey);
  }
  db.prepare(
    `UPDATE workflow_steps
     SET status = 'pending', error = NULL, completed_at = NULL, updated_at = ?
     WHERE run_id = ? AND status = 'failed'`
  ).run(now, run.id);
  setRunStatus(db, run.id, 'pending', { error: null, completed_at: null });
  scheduleWorkflowRun(db, log, run.id);
  return getWorkflowRunDetail(db, run.id);
}

function cancelWorkflowRun(db, log, runId, reason = '用户已取消工作流') {
  const run = getWorkflowRun(db, runId);
  if (!run) return null;
  if (RUN_TERMINAL_STATUSES.has(run.status)) {
    log?.operation?.({
      operation: 'workflow_cancel',
      operationId: run.id,
      phase: 'success',
      status: 'already_terminal',
      run_status: run.status,
    });
    return getWorkflowRunDetail(db, runId);
  }
  const now = nowIso();
  db.prepare(
    `UPDATE workflow_steps
     SET status = 'cancelled', error = ?, completed_at = ?, updated_at = ?
     WHERE run_id = ? AND status IN ('pending', 'processing')`
  ).run(reason, now, now, run.id);
  setRunStatus(db, run.id, 'cancelled', { error: reason });
  log?.info?.('Workflow run cancelled', { run_id: run.id });
  log?.operation?.({
    operation: 'workflow_cancel',
    operationId: run.id,
    phase: 'cancel',
    status: 'cancelled',
  });
  return getWorkflowRunDetail(db, run.id);
}

function pauseWorkflowRun(db, log, runId, reason = '用户已暂停工作流') {
  const run = getWorkflowRun(db, runId);
  if (!run) return null;
  if (RUN_TERMINAL_STATUSES.has(run.status) || run.status === 'paused') return getWorkflowRunDetail(db, runId);
  const now = nowIso();
  db.prepare(
    `UPDATE workflow_steps
     SET status = 'pending', error = ?, updated_at = ?
     WHERE run_id = ? AND status = 'processing'`
  ).run(reason, now, run.id);
  setRunStatus(db, run.id, 'paused', { error: reason, completed_at: null });
  log?.info?.('Workflow run paused', { run_id: run.id });
  return getWorkflowRunDetail(db, run.id);
}

function resumeWorkflowRun(db, log, runId) {
  const run = getWorkflowRun(db, runId);
  if (!run) return null;
  if (run.status !== 'paused') {
    const err = new Error('只有已暂停的工作流可以继续');
    err.code = 'BAD_REQUEST';
    throw err;
  }
  dramaService.assertDramaWritable(db, run.drama_id);
  assertProductionRunReadiness(db, run);
  defaultBackgroundTasks.assertAccepting();
  setRunStatus(db, run.id, 'pending', { error: null, completed_at: null });
  scheduleWorkflowRun(db, log, run.id);
  log?.info?.('Workflow run resumed', { run_id: run.id });
  return getWorkflowRunDetail(db, run.id);
}

function assertProductionRunReadiness(db, run) {
  if (run?.input_json?.qa_mode !== 'production' && run?.input_json?.mode !== 'production') return null;
  return readinessService.assertNovel2AnimeReadiness(db, {
    ...run.input_json,
    drama_id: run.drama_id,
    qa_mode: 'production',
  });
}

function resumeActiveWorkflowRunsOnStartup(db, log) {
  const runs = db.prepare(
    `SELECT run.id FROM workflow_runs run
       JOIN dramas drama ON drama.id = run.drama_id
     WHERE run.status IN ('pending', 'processing') AND run.deleted_at IS NULL
       AND drama.deleted_at IS NULL
       AND (drama.trash_state IS NULL OR drama.trash_state = '')
     ORDER BY run.created_at ASC`
  ).all();
  if (runs.length) defaultBackgroundTasks.assertAccepting();
  for (const row of runs) {
    db.prepare(
      `UPDATE workflow_steps
       SET status = 'pending', updated_at = ?
       WHERE run_id = ? AND status = 'processing'`
    ).run(nowIso(), row.id);
    scheduleWorkflowRun(db, log, row.id);
  }
  if (runs.length) log?.info?.('Workflow runs resumed on startup', { count: runs.length });
  return runs.length;
}

async function cancelAndDrainDramaWorkflows(db, log, dramaId, reason = '项目移入回收站') {
  let rows;
  try {
    rows = db.prepare(
      `SELECT id FROM workflow_runs
        WHERE drama_id = ? AND status IN ('pending', 'processing', 'paused') AND deleted_at IS NULL`
    ).all(Number(dramaId));
  } catch (error) {
    if (/no such table/i.test(error?.message || '')) return { cancelled_run_ids: [] };
    throw error;
  }
  const cancelledRunIds = [];
  for (const row of rows) {
    const result = cancelWorkflowRun(db, log, row.id, reason);
    if (result) cancelledRunIds.push(String(row.id));
  }
  await waitForWorkflowWorkersToIdle(cancelledRunIds);
  return { cancelled_run_ids: cancelledRunIds };
}

module.exports = {
  assertNovel2AnimeLaunchReadiness,
  startNovel2AnimeWorkflow,
  stepsFromKeys,
  inheritProductionProviderAudits,
  startNovel2AnimeRepairWorkflow,
  retryWorkflowRun,
  cancelWorkflowRun,
  pauseWorkflowRun,
  resumeWorkflowRun,
  assertProductionRunReadiness,
  resumeActiveWorkflowRunsOnStartup,
  cancelAndDrainDramaWorkflows,
};
