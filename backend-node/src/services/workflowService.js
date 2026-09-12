// 队列、状态装配、步骤错误与步骤执行体见 workflowQueue.js / workflowStatus.js / workflowStepErrors.js / workflowExecuteSteps.js
// 启动、修复、重试、取消、暂停、恢复与排空见 workflowLifecycle.js
// 资产准备与时间线规划见 workflowAssets.js / workflowTimeline.js
const { v4: uuidv4 } = require('uuid');
const dramaService = require('./dramaService');
const skillRegistryService = require('./skillRegistryService');
const { executeWorkflowStep } = require('./workflowExecuteSteps');
const {
  nowIso,
  toJson,
  toUserFacingWorkflowError,
  RUN_TERMINAL_STATUSES,
  rowToRun,
  rowToStep,
  getWorkflowRun,
  getWorkflowSteps,
  getWorkflowRunDetail,
  applyWorkflowTypeFilter,
  listWorkflowRuns,
  setRunStatus,
  setStepStatus,
} = require('./workflowStatus');
const {
  tryBeginWorkflowProcessing,
  endWorkflowProcessing,
  scheduleWorkflowRun,
} = require('./workflowQueue');
const {
  assertKnownExecuteStepKey,
  unknownWorkflowStepError,
} = require('./workflowStepErrors');

const STEP_CHECKPOINT_KEY = '__workflow_checkpoint';
const STEP_CALL_KEY_FIELD = '_workflow_call_key';

const NOVEL2ANIME_STEPS = [
  { key: 'source_intake', label: '素材导入' },
  { key: 'adaptation_plan', label: '改编计划' },
  { key: 'apply_episodes', label: '写入分集' },
  { key: 'asset_bible', label: '角色与场景资产' },
  { key: 'storyboard_draft', label: '分镜草稿' },
  { key: 'image_generation', label: '分镜图片生成' },
  { key: 'video_generation', label: '分镜视频生成' },
  { key: 'audio_generation', label: '对白与旁白配音' },
  { key: 'timeline_plan', label: '时间线规划' },
  { key: 'post_composite', label: '成片合成' },
  { key: 'qa_audit', label: '质量检查' },
];

const {
  ensureAssetBible,
  createCreativeReview,
  ensureStoryboardDraft,
} = require('./workflowAssets');
const { ensureTimelinePlan } = require('./workflowTimeline');
const {
  startNovel2AnimeWorkflow,
  startNovel2AnimeRepairWorkflow,
  retryWorkflowRun,
  cancelWorkflowRun,
  pauseWorkflowRun,
  resumeWorkflowRun,
  assertProductionRunReadiness,
  cancelAndDrainDramaWorkflows,
  resumeActiveWorkflowRunsOnStartup,
  inheritProductionProviderAudits,
} = require('./workflowLifecycle');

function workflowStepCallKey(runId, stepKey) {
  return `workflow:${String(runId)}:step:${String(stepKey)}:v1`;
}

function ensureStepCallKey(db, run, step) {
  const input = step?.input_json && typeof step.input_json === 'object' ? { ...step.input_json } : {};
  const expected = workflowStepCallKey(run.id, step.step_key);
  if (input[STEP_CALL_KEY_FIELD] === expected) return expected;
  input[STEP_CALL_KEY_FIELD] = expected;
  db.prepare('UPDATE workflow_steps SET input_json = ?, updated_at = ? WHERE id = ?')
    .run(toJson(input), nowIso(), step.id);
  return expected;
}

function checkpointStepResult(db, stepId, callKey, output) {
  const checkpoint = {
    [STEP_CHECKPOINT_KEY]: {
      version: 1,
      call_key: callKey,
      state: 'succeeded',
      output: output == null ? {} : output,
      recorded_at: nowIso(),
    },
  };
  db.prepare('UPDATE workflow_steps SET output_json = ?, updated_at = ? WHERE id = ?')
    .run(toJson(checkpoint), nowIso(), String(stepId));
  return output;
}

function completedCheckpoint(step, callKey) {
  const checkpoint = step?.output_json?.[STEP_CHECKPOINT_KEY];
  if (!checkpoint || checkpoint.state !== 'succeeded' || checkpoint.call_key !== callKey) return null;
  return checkpoint.output == null ? {} : checkpoint.output;
}

function createWorkflowRun(db, log, params) {
  const dramaId = Number(params.drama_id || params.dramaId);
  if (!dramaId || !dramaService.getDramaById(db, dramaId)) {
    const err = new Error('项目 ID 必填，且必须指向未删除的项目');
    err.code = 'BAD_REQUEST';
    throw err;
  }
  dramaService.assertDramaWritable(db, dramaId);
  const type = String(params.type || 'novel2anime').trim();
  const steps = params.steps && params.steps.length ? params.steps : NOVEL2ANIME_STEPS;
  const id = uuidv4();
  const createdAt = nowIso();
  const workflowOptions = params.options && typeof params.options === 'object' && !Array.isArray(params.options)
    ? { ...params.options }
    : {};
  for (const key of [
    'text_model',
    'text_provider',
    'asset_image_model',
    'asset_image_provider',
    'image_model',
    'image_provider',
    'video_model',
    'video_provider',
    'tts_model',
    'tts_provider',
  ]) {
    if (workflowOptions[key] == null && params[key] != null) workflowOptions[key] = params[key];
  }
  skillRegistryService.ensureDefaultSkills(db);
  const runInput = {
    drama_id: dramaId,
    episode_id: params.episode_id || null,
    type,
    source_id: params.source_id || null,
    adaptation_plan_id: params.adaptation_plan_id || null,
    overwrite_existing_episodes: params.overwrite_existing_episodes === true || params.overwrite === true,
    title: params.title || '',
    source_type: params.source_type || '',
    target_episode_count: params.target_episode_count || params.episode_count || null,
    style: params.style || '',
    metadata: params.metadata || {},
    qa_mode: params.qa_mode === 'production' || params.mode === 'production' ? 'production' : 'draft',
    text_excerpt: String(params.text || '').slice(0, 1000),
    options: workflowOptions,
  };

  const tx = db.transaction(() => {
    dramaService.assertDramaWritable(db, dramaId);
    db.prepare(
      `INSERT INTO workflow_runs
       (id, drama_id, episode_id, type, status, progress, current_step, input_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?)`
    ).run(id, dramaId, params.episode_id || null, type, steps[0]?.key || null, toJson(runInput), createdAt, createdAt);

    const insertStep = db.prepare(
      `INSERT INTO workflow_steps
       (id, run_id, step_key, status, attempts, input_json, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', 0, ?, ?, ?, ?)`
    );
    steps.forEach((step, index) => {
      const stepInput = index === 0 ? {
        drama_id: dramaId,
        source_id: params.source_id || null,
        adaptation_plan_id: params.adaptation_plan_id || null,
        text: params.text || '',
        title: params.title || '',
        source_type: params.source_type || '',
        target_episode_count: params.target_episode_count || params.episode_count || null,
        style: params.style || '',
        metadata: params.metadata || {},
      } : {};
      stepInput[STEP_CALL_KEY_FIELD] = workflowStepCallKey(id, step.key);
      insertStep.run(uuidv4(), id, step.key, toJson(stepInput), index, createdAt, createdAt);
    });
  });
  tx();
  log?.info?.('Workflow run created', { run_id: id, type, drama_id: dramaId });
  return getWorkflowRunDetail(db, id);
}

async function executeStep(db, log, run, step, allSteps) {
  dramaService.assertDramaWritable(db, run.drama_id);
  assertKnownExecuteStepKey(step.step_key);
  if (
    step.step_key === 'source_intake'
    || step.step_key === 'adaptation_plan'
    || step.step_key === 'apply_episodes'
    || step.step_key === 'asset_bible'
    || step.step_key === 'storyboard_draft'
    || step.step_key === 'image_generation'
    || step.step_key === 'video_generation'
    || step.step_key === 'audio_generation'
    || step.step_key === 'timeline_plan'
    || step.step_key === 'post_composite'
    || step.step_key === 'qa_audit'
  ) {
    return executeWorkflowStep(db, log, run, step, allSteps, {
      checkpointStepResult,
      createCreativeReview,
      ensureAssetBible,
      ensureStoryboardDraft,
      ensureTimelinePlan,
    });
  }
  throw unknownWorkflowStepError();
}

async function processWorkflowRun(db, log, runId, options = {}) {
  if (!tryBeginWorkflowProcessing(runId)) return getWorkflowRunDetail(db, runId);
  let result;
  try {
    result = await processWorkflowRunInner(db, log, runId, options);
  } finally {
    endWorkflowProcessing(runId);
  }
  return result ? getWorkflowRunDetail(db, runId) : result;
}

async function processWorkflowRunInner(db, log, runId, options = {}) {
  let run = getWorkflowRun(db, runId);
  if (!run) return null;
  if (RUN_TERMINAL_STATUSES.has(run.status)) return getWorkflowRunDetail(db, runId);
  if (run.status === 'paused') return getWorkflowRunDetail(db, runId);
  dramaService.assertDramaWritable(db, run.drama_id);

  setRunStatus(db, runId, 'processing', {
    progress: run.progress || 0,
    current_step: run.current_step,
    error: null,
  });

  while (true) {
    run = getWorkflowRun(db, runId);
    if (!run || RUN_TERMINAL_STATUSES.has(run.status)) return getWorkflowRunDetail(db, runId);
    if (run.status === 'paused') return getWorkflowRunDetail(db, runId);
    dramaService.assertDramaWritable(db, run.drama_id);
    const steps = getWorkflowSteps(db, runId);
    const failedStep = steps.find((step) => step.status === 'failed');
    if (failedStep) {
      return getWorkflowRunDetail(db, runId);
    }
    const step = steps.find((s) => s.status !== 'completed');
    if (!step) {
      const qaStep = steps.find((item) => item.step_key === 'qa_audit');
      if (qaStep && (qaStep.output_json?.passed !== true || Number(qaStep.output_json?.score) < 80)) {
        const message = '工作流无法完成：质量检查得分需至少 80 分，请根据质量检查报告修复后再重试';
        setRunStatus(db, runId, 'failed', {
          current_step: 'qa_audit',
          error: message,
        });
        return getWorkflowRunDetail(db, runId);
      }
      setRunStatus(db, runId, 'completed', {
        progress: 100,
        current_step: null,
        output_json: { completed_step_count: steps.length },
        error: null,
      });
      log?.info?.('Workflow run completed', { run_id: runId });
      return getWorkflowRunDetail(db, runId);
    }

    const callKey = ensureStepCallKey(db, run, step);
    const checkpointOutput = completedCheckpoint(step, callKey);
    if (checkpointOutput) {
      setStepStatus(db, step.id, 'completed', { output_json: checkpointOutput, error: null });
      const recoveredCount = getWorkflowSteps(db, runId).filter((item) => item.status === 'completed').length;
      setRunStatus(db, runId, 'processing', {
        progress: Math.min(99, Math.floor((recoveredCount / Math.max(steps.length, 1)) * 100)),
        current_step: step.step_key,
        error: null,
      });
      log?.info?.('Workflow step recovered from durable checkpoint', {
        run_id: runId,
        step_key: step.step_key,
        call_key: callKey,
      });
      continue;
    }

    const attempts = (step.attempts || 0) + 1;
    setStepStatus(db, step.id, 'processing', { attempts, error: null, completed_at: null });
    setRunStatus(db, runId, 'processing', {
      progress: Math.floor((steps.filter((s) => s.status === 'completed').length / Math.max(steps.length, 1)) * 100),
      current_step: step.step_key,
      error: null,
      completed_at: null,
    });

    try {
      const latestRun = getWorkflowRun(db, runId);
      if (!latestRun || RUN_TERMINAL_STATUSES.has(latestRun.status) || latestRun.status === 'paused') {
        return getWorkflowRunDetail(db, runId);
      }
      const latestSteps = getWorkflowSteps(db, runId);
      const output = await executeStep(db, log, latestRun, { ...step, attempts, call_key: callKey }, latestSteps);
      const afterRun = getWorkflowRun(db, runId);
      const afterStep = db.prepare('SELECT status FROM workflow_steps WHERE id = ?').get(String(step.id));
      if (!afterRun || RUN_TERMINAL_STATUSES.has(afterRun.status) || afterRun.status === 'paused' || afterStep?.status === 'cancelled') {
        return getWorkflowRunDetail(db, runId);
      }
      if (typeof options.faultInjector === 'function') {
        await options.faultInjector({
          phase: 'after_step_execute_before_checkpoint',
          run: latestRun,
          step: { ...step, attempts, call_key: callKey },
          output,
        });
      }
      checkpointStepResult(db, step.id, callKey, output);
      if (typeof options.faultInjector === 'function') {
        await options.faultInjector({
          phase: 'after_step_checkpoint',
          run: latestRun,
          step: { ...step, attempts, call_key: callKey },
          output,
        });
      }
      setStepStatus(db, step.id, 'completed', { output_json: output, error: null });
      const completedCount = getWorkflowSteps(db, runId).filter((s) => s.status === 'completed').length;
      setRunStatus(db, runId, 'processing', {
        progress: Math.min(99, Math.floor((completedCount / Math.max(steps.length, 1)) * 100)),
        current_step: step.step_key,
        error: null,
      });
    } catch (err) {
      const cancelledRun = getWorkflowRun(db, runId);
      if (!cancelledRun || RUN_TERMINAL_STATUSES.has(cancelledRun.status) || cancelledRun.status === 'paused') {
        return getWorkflowRunDetail(db, runId);
      }
      if (err?.workflow_process_crash === true) {
        log?.warn?.('Workflow process interrupted during step commit', {
          run_id: runId,
          step_key: step.step_key,
          call_key: callKey,
        });
        throw err;
      }
      const output = err.report ? {
        qa_report_id: err.report.id,
        score: err.report.score,
        passed: false,
        issue_count: err.report.report_json?.issues?.length || 0,
      } : undefined;
      setStepStatus(db, step.id, 'failed', {
        output_json: output,
        error: toUserFacingWorkflowError(err),
      });
      setRunStatus(db, runId, 'failed', {
        progress: Math.floor((steps.filter((s) => s.status === 'completed').length / Math.max(steps.length, 1)) * 100),
        current_step: step.step_key,
        error: toUserFacingWorkflowError(err),
      });
      log?.error?.('Workflow run failed', { run_id: runId, step_key: step.step_key, error: err.message });
      return getWorkflowRunDetail(db, runId);
    }
  }
}

module.exports = {
  NOVEL2ANIME_STEPS,
  createWorkflowRun,
  startNovel2AnimeWorkflow,
  startNovel2AnimeRepairWorkflow,
  processWorkflowRun,
  scheduleWorkflowRun,
  retryWorkflowRun,
  cancelWorkflowRun,
  pauseWorkflowRun,
  resumeWorkflowRun,
  assertProductionRunReadiness,
  cancelAndDrainDramaWorkflows,
  resumeActiveWorkflowRunsOnStartup,
  getWorkflowRun,
  getWorkflowSteps,
  getWorkflowRunDetail,
  applyWorkflowTypeFilter,
  listWorkflowRuns,
  rowToRun,
  rowToStep,
  ensureAssetBible,
  ensureStoryboardDraft,
  ensureTimelinePlan,
  inheritProductionProviderAudits,
  createCreativeReview,
};
