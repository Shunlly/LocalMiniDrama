const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const workflowService = require('../src/services/workflowService');
const { executeWorkflowStep } = require('../src/services/workflowExecuteSteps');
const qaService = require('../src/services/qaService');
const {
  EXECUTE_STEP_KEYS,
  WORKFLOW_STEP_MESSAGES,
} = require('../src/services/workflowStepErrors');

const log = { info() {}, warn() {}, error() {} };

const PUBLIC_EXPORTS = [
  'NOVEL2ANIME_STEPS',
  'assertProductionRunReadiness',
  'applyWorkflowTypeFilter',
  'cancelAndDrainDramaWorkflows',
  'cancelWorkflowRun',
  'createCreativeReview',
  'createWorkflowRun',
  'ensureAssetBible',
  'ensureStoryboardDraft',
  'ensureTimelinePlan',
  'getWorkflowRun',
  'getWorkflowRunDetail',
  'getWorkflowSteps',
  'inheritProductionProviderAudits',
  'listWorkflowRuns',
  'pauseWorkflowRun',
  'processWorkflowRun',
  'resumeActiveWorkflowRunsOnStartup',
  'resumeWorkflowRun',
  'retryWorkflowRun',
  'rowToRun',
  'rowToStep',
  'scheduleWorkflowRun',
  'startNovel2AnimeRepairWorkflow',
  'startNovel2AnimeWorkflow',
].sort();

function createDb(t) {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO dramas (id, title, description, style, status, created_at, updated_at)
     VALUES (1, '步骤执行甲', 'fixture', 'anime', 'draft', ?, ?)`
  ).run(now, now);
  t.after(() => db.close());
  return db;
}

function insertDrama(db, id) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO dramas (id, title, description, style, status, created_at, updated_at)
     VALUES (?, '步骤执行乙', 'other fixture', 'anime', 'draft', ?, ?)`
  ).run(id, now, now);
}

function insertSource(db, dramaId) {
  const now = new Date().toISOString();
  const source = db.prepare(
    `INSERT INTO story_sources (drama_id, source_type, title, content_hash, metadata, created_at)
     VALUES (?, 'storyboard', 'Fixture source', 'fixture-hash', '{}', ?)`
  ).run(dramaId, now);
  return Number(source.lastInsertRowid);
}

function insertEpisode(db, dramaId, episodeId) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO episodes (id, drama_id, episode_number, title, status, created_at, updated_at)
     VALUES (?, ?, 1, '步骤执行剧集', 'draft', ?, ?)`
  ).run(episodeId, dramaId, now, now);
}

function insertPlan(db, dramaId, sourceId) {
  const now = new Date().toISOString();
  const plan = db.prepare(
    `INSERT INTO adaptation_plans
     (drama_id, source_id, target_episode_count, style, plan_json, status, created_at, updated_at)
     VALUES (?, ?, 1, 'anime', ?, 'draft', ?, ?)`
  ).run(dramaId, sourceId, JSON.stringify({ episodes: [] }), now, now);
  return Number(plan.lastInsertRowid);
}

function stepHelpers() {
  return {
    checkpointStepResult(db, stepId, callKey, output) {
      return output;
    },
    createCreativeReview: workflowService.createCreativeReview,
    ensureAssetBible: workflowService.ensureAssetBible,
    ensureStoryboardDraft: workflowService.ensureStoryboardDraft,
    ensureTimelinePlan: workflowService.ensureTimelinePlan,
  };
}

function branchKeysFrom(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  assert.equal(start >= 0 && end > start, true);
  const body = source.slice(start, end);
  return [...body.matchAll(/step\.step_key === '([^']+)'/g)].map((match) => match[1]);
}

test('executeStep 只做可写校验、步骤过滤并调度到执行模块', () => {
  const serviceSource = fs.readFileSync(path.join(__dirname, '../src/services/workflowService.js'), 'utf8');
  const executeSource = fs.readFileSync(path.join(__dirname, '../src/services/workflowExecuteSteps.js'), 'utf8');
  const executeBody = serviceSource.slice(
    serviceSource.indexOf('async function executeStep'),
    serviceSource.indexOf('async function processWorkflowRun')
  );

  assert.deepEqual(branchKeysFrom(serviceSource, 'async function executeStep', 'async function processWorkflowRun'), [...EXECUTE_STEP_KEYS]);
  assert.deepEqual(branchKeysFrom(executeSource, 'async function executeWorkflowStep', 'module.exports'), [...EXECUTE_STEP_KEYS]);
  assert.equal(executeBody.includes('assertKnownExecuteStepKey(step.step_key)'), true);
  assert.equal(executeBody.includes('dramaService.assertDramaWritable(db, run.drama_id)'), true);
  assert.equal(executeBody.includes('executeWorkflowStep('), true);
  assert.equal(executeBody.includes('throw unknownWorkflowStepError()'), true);
  assert.equal(executeBody.includes('createStorySource'), false);
  assert.equal(executeBody.includes('auditDrama'), false);
  assert.equal(executeBody.includes('applyAdaptationPlanToEpisodes'), false);
  assert.equal(executeSource.includes("require('./workflowStepErrors')"), true);
  assert.equal(executeSource.includes('function assertSourceDetailForRun'), false);
  assert.equal(executeSource.includes('function assertQaAuditAccepted'), false);
  assert.equal(executeSource.includes('function unknownWorkflowStepError'), false);
});

test('workflowService 公开导出保持不变，不泄漏步骤执行体', () => {
  assert.deepEqual(Object.keys(workflowService).sort(), PUBLIC_EXPORTS);
  assert.equal('executeWorkflowStep' in workflowService, false);
  assert.equal('executeStep' in workflowService, false);
  assert.equal('EXECUTE_STEP_KEYS' in workflowService, false);
});

test('跨项目素材源、跨素材源方案和剧集 ID 混用仍返回原来的中文失败', async (t) => {
  const db = createDb(t);
  const dramaId = 11;
  const otherDramaId = 22;
  const episodeId = 101;
  insertDrama(db, dramaId);
  insertDrama(db, otherDramaId);
  insertEpisode(db, dramaId, episodeId);
  const localSourceId = insertSource(db, dramaId);
  const foreignSourceId = insertSource(db, otherDramaId);
  const foreignPlanId = insertPlan(db, otherDramaId, foreignSourceId);
  const helpers = stepHelpers();

  assert.notEqual(dramaId, otherDramaId);
  assert.notEqual(dramaId, episodeId);
  assert.notEqual(dramaId, localSourceId);
  assert.notEqual(episodeId, localSourceId);
  assert.notEqual(localSourceId, foreignSourceId);

  const run = { id: 'run-exec', drama_id: dramaId, episode_id: episodeId, input_json: {} };

  await assert.rejects(
    () => executeWorkflowStep(db, log, run, {
      id: 'step-missing',
      step_key: 'source_intake',
      call_key: 'k-missing',
      input_json: { source_id: 99999 },
    }, [], helpers),
    (error) => error.message === WORKFLOW_STEP_MESSAGES.SOURCE_NOT_FOUND
  );

  await assert.rejects(
    () => executeWorkflowStep(db, log, run, {
      id: 'step-foreign-source',
      step_key: 'source_intake',
      call_key: 'k-foreign-source',
      input_json: { source_id: foreignSourceId },
    }, [], helpers),
    (error) => error.message === WORKFLOW_STEP_MESSAGES.SOURCE_WRONG_DRAMA
  );

  await assert.rejects(
    () => executeWorkflowStep(db, log, { ...run, drama_id: episodeId }, {
      id: 'step-episode-as-drama',
      step_key: 'source_intake',
      call_key: 'k-episode-as-drama',
      input_json: { source_id: localSourceId },
    }, [], helpers),
    (error) => error.message === WORKFLOW_STEP_MESSAGES.SOURCE_WRONG_DRAMA
  );

  await assert.rejects(
    () => executeWorkflowStep(db, log, run, {
      id: 'step-foreign-plan',
      step_key: 'source_intake',
      call_key: 'k-foreign-plan',
      input_json: { source_id: localSourceId, adaptation_plan_id: foreignPlanId },
    }, [], helpers),
    (error) => error.message === WORKFLOW_STEP_MESSAGES.PLAN_WRONG_SOURCE
  );

  const created = workflowService.createWorkflowRun(db, log, {
    drama_id: dramaId,
    episode_id: episodeId,
    source_id: localSourceId,
    steps: [{ key: 'source_intake', label: '素材导入' }],
  });
  const detail = await workflowService.processWorkflowRun(db, log, created.id);
  assert.equal(detail.status, 'completed');
  assert.equal(detail.steps[0].output_json.source_id, localSourceId);
  assert.notEqual(detail.steps[0].output_json.source_id, episodeId);
  assert.notEqual(detail.drama_id, detail.episode_id);
});

test('前置步骤缺 ID、应用失败和未知步骤仍走原中文错误', async (t) => {
  const db = createDb(t);
  const helpers = stepHelpers();
  const run = { id: 'run-pre', drama_id: 1, episode_id: 101, input_json: {} };

  await assert.rejects(
    () => executeWorkflowStep(db, log, run, {
      id: 'step-adapt',
      step_key: 'adaptation_plan',
      call_key: 'k-adapt',
      input_json: {},
    }, [{ step_key: 'source_intake', output_json: {} }], helpers),
    (error) => error.message === WORKFLOW_STEP_MESSAGES.MISSING_SOURCE_ID
  );

  await assert.rejects(
    () => executeWorkflowStep(db, log, run, {
      id: 'step-apply',
      step_key: 'apply_episodes',
      call_key: 'k-apply',
      input_json: {},
    }, [{ step_key: 'adaptation_plan', output_json: { source_id: 11 } }], helpers),
    (error) => error.message === WORKFLOW_STEP_MESSAGES.MISSING_PLAN_ID
  );

  await assert.rejects(
    () => executeWorkflowStep(db, log, run, {
      id: 'step-apply-missing-plan',
      step_key: 'apply_episodes',
      call_key: 'k-apply-missing-plan',
      input_json: {},
    }, [{ step_key: 'adaptation_plan', output_json: { adaptation_plan_id: 999999 } }], helpers),
    (error) => error.message === WORKFLOW_STEP_MESSAGES.APPLY_FAILED
  );

  await assert.rejects(
    () => executeWorkflowStep(db, log, run, {
      id: 'step-unknown',
      step_key: 'not_a_real_step',
      call_key: 'k-unknown',
      input_json: {},
    }, [], helpers),
    (error) => error.message === WORKFLOW_STEP_MESSAGES.UNKNOWN_STEP
  );
});

test('质量检查未通过仍返回带得分的中文失败，且不把 episode_id 当成 drama_id', async (t) => {
  const db = createDb(t);
  const dramaId = 11;
  const episodeId = 101;
  insertDrama(db, dramaId);
  insertEpisode(db, dramaId, episodeId);
  assert.notEqual(dramaId, episodeId);

  let captured = null;
  const originalAudit = qaService.auditDrama;
  qaService.auditDrama = (auditDb, auditLog, params) => {
    captured = params;
    return originalAudit(auditDb, auditLog, params);
  };
  t.after(() => {
    qaService.auditDrama = originalAudit;
  });

  const created = workflowService.createWorkflowRun(db, log, {
    drama_id: dramaId,
    episode_id: episodeId,
    steps: [{ key: 'qa_audit', label: '质量检查' }],
  });
  const detail = await workflowService.processWorkflowRun(db, log, created.id);
  assert.equal(detail.status, 'failed');
  assert.match(detail.error, /^质量检查未通过，当前得分 \d+，请根据质量检查报告修复后再重试$/);
  assert.equal(detail.steps[0].output_json.passed, false);

  assert.equal(captured.drama_id, dramaId);
  assert.equal(captured.episode_id, episodeId);
  assert.notEqual(captured.drama_id, captured.episode_id);
});

test('公开调度入口对未知步骤仍写成中文失败', async (t) => {
  const db = createDb(t);
  const run = workflowService.createWorkflowRun(db, log, {
    drama_id: 1,
    steps: [{ key: 'not_a_real_step', label: '未知' }],
  });
  const detail = await workflowService.processWorkflowRun(db, log, run.id);
  assert.equal(detail.status, 'failed');
  assert.equal(detail.error, WORKFLOW_STEP_MESSAGES.UNKNOWN_STEP);
  assert.equal(detail.steps[0].error, WORKFLOW_STEP_MESSAGES.UNKNOWN_STEP);
});
