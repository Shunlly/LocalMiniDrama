const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const workflowService = require('../src/services/workflowService');
const {
  EXECUTE_STEP_KEYS,
  WORKFLOW_STEP_MESSAGES,
  isKnownExecuteStepKey,
  unknownWorkflowStepError,
  assertKnownExecuteStepKey,
  assertSourceDetailForRun,
  assertAdaptationPlanForSource,
  requirePreviousSourceId,
  requirePreviousAdaptationPlanId,
  assertAdaptationApplyResult,
  qaAuditFailureError,
  assertQaAuditAccepted,
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
     VALUES (1, '步骤错误甲', 'fixture', 'anime', 'draft', ?, ?)`
  ).run(now, now);
  t.after(() => db.close());
  return db;
}

test('executeStep 的 step_key 分支必须与类型过滤集合一致', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/workflowService.js'), 'utf8');
  const start = source.indexOf('async function executeStep');
  const end = source.indexOf('async function processWorkflowRun');
  assert.equal(start >= 0 && end > start, true);
  const body = source.slice(start, end);
  const branchKeys = [...body.matchAll(/step\.step_key === '([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(branchKeys, [...EXECUTE_STEP_KEYS]);
  assert.equal(body.includes('assertKnownExecuteStepKey(step.step_key)'), true);
  assert.equal(body.includes('throw unknownWorkflowStepError()'), true);
});

test('步骤类型过滤只接受 executeStep 已知键，近义键不能混用', () => {
  assert.deepEqual([...EXECUTE_STEP_KEYS], workflowService.NOVEL2ANIME_STEPS.map((step) => step.key));
  assert.equal(isKnownExecuteStepKey('qa_audit'), true);
  assert.equal(isKnownExecuteStepKey('QA_AUDIT'), false);
  assert.equal(isKnownExecuteStepKey('qa-audit'), false);
  assert.equal(isKnownExecuteStepKey('qa_audit_extra'), false);
  assert.equal(isKnownExecuteStepKey(''), false);
  assert.equal(isKnownExecuteStepKey(null), false);
  assert.doesNotThrow(() => assertKnownExecuteStepKey('source_intake'));
  assert.throws(
    () => assertKnownExecuteStepKey('not_a_real_step'),
    (error) => error.message === WORKFLOW_STEP_MESSAGES.UNKNOWN_STEP
  );
  assert.equal(unknownWorkflowStepError().message, WORKFLOW_STEP_MESSAGES.UNKNOWN_STEP);
});

test('素材源绑定按 drama_id 判断，不把剧集 ID 或其他项目当成同一键', () => {
  const dramaId = 1;
  const otherDramaId = 2;
  const episodeId = 101;
  const sourceId = 11;
  assert.notEqual(dramaId, otherDramaId);
  assert.notEqual(dramaId, episodeId);
  assert.notEqual(dramaId, sourceId);

  const localDetail = { source: { id: sourceId, drama_id: dramaId } };
  assert.equal(assertSourceDetailForRun(localDetail, dramaId), localDetail);
  assert.throws(
    () => assertSourceDetailForRun(null, dramaId),
    (error) => error.message === WORKFLOW_STEP_MESSAGES.SOURCE_NOT_FOUND
  );
  assert.throws(
    () => assertSourceDetailForRun({ source: { id: sourceId, drama_id: otherDramaId } }, dramaId),
    (error) => error.message === WORKFLOW_STEP_MESSAGES.SOURCE_WRONG_DRAMA
  );
  assert.throws(
    () => assertSourceDetailForRun(localDetail, episodeId),
    (error) => error.message === WORKFLOW_STEP_MESSAGES.SOURCE_WRONG_DRAMA
  );
});

test('改编方案绑定按 source_id 判断，不把项目 ID 或其他素材源当成同一键', () => {
  const sourceId = 11;
  const otherSourceId = 22;
  const dramaId = 1;
  const planId = 33;
  assert.notEqual(sourceId, otherSourceId);
  assert.notEqual(sourceId, dramaId);
  assert.notEqual(sourceId, planId);

  const plan = { id: planId, source_id: sourceId };
  const stringIdPlan = { id: planId, source_id: '11' };
  assert.equal(assertAdaptationPlanForSource(plan, sourceId), plan);
  assert.equal(assertAdaptationPlanForSource(stringIdPlan, 11), stringIdPlan);
  assert.throws(
    () => assertAdaptationPlanForSource(null, sourceId),
    (error) => error.message === WORKFLOW_STEP_MESSAGES.PLAN_WRONG_SOURCE
  );
  assert.throws(
    () => assertAdaptationPlanForSource({ id: planId, source_id: otherSourceId }, sourceId),
    (error) => error.message === WORKFLOW_STEP_MESSAGES.PLAN_WRONG_SOURCE
  );
  assert.throws(
    () => assertAdaptationPlanForSource(plan, dramaId),
    (error) => error.message === WORKFLOW_STEP_MESSAGES.PLAN_WRONG_SOURCE
  );
});

test('前置步骤输出缺失时装配可操作中文错误', () => {
  assert.equal(requirePreviousSourceId({ source_id: 11 }), 11);
  assert.throws(
    () => requirePreviousSourceId({}),
    (error) => error.message === WORKFLOW_STEP_MESSAGES.MISSING_SOURCE_ID
  );
  assert.equal(requirePreviousAdaptationPlanId({ adaptation_plan_id: 33 }), 33);
  assert.throws(
    () => requirePreviousAdaptationPlanId({ source_id: 11 }),
    (error) => error.message === WORKFLOW_STEP_MESSAGES.MISSING_PLAN_ID
  );
  assert.equal(assertAdaptationApplyResult({ episode_count: 1 }).episode_count, 1);
  assert.throws(
    () => assertAdaptationApplyResult(null),
    (error) => error.message === WORKFLOW_STEP_MESSAGES.APPLY_FAILED
  );
});

test('质量检查失败会带上 report 并在得分不足时拒绝', () => {
  const failedReport = { id: 9, score: 70, passed: false, report_json: { issues: [1] } };
  const failed = qaAuditFailureError(failedReport);
  assert.equal(failed.message, '质量检查未通过，当前得分 70，请根据 QA 报告修复后再重试');
  assert.equal(failed.report, failedReport);

  assert.throws(
    () => assertQaAuditAccepted(failedReport, null),
    (error) => error.report === failedReport && error.message.includes('70')
  );

  const passedReport = { id: 10, score: 80, passed: true };
  assert.throws(
    () => assertQaAuditAccepted(passedReport, { score: 79, passed: true }),
    (error) => error.report === passedReport
  );
  assert.throws(
    () => assertQaAuditAccepted(passedReport, { score: 80, passed: 'true' }),
    (error) => error.report === passedReport
  );
  const output = { score: 80, passed: true };
  assert.equal(assertQaAuditAccepted(passedReport, output), output);
});

test('workflowService 公开导出保持不变，不泄漏步骤错误辅助', () => {
  assert.deepEqual(Object.keys(workflowService).sort(), PUBLIC_EXPORTS);
  assert.equal('assertKnownExecuteStepKey' in workflowService, false);
  assert.equal('assertQaAuditAccepted' in workflowService, false);
  assert.equal('EXECUTE_STEP_KEYS' in workflowService, false);
});

test('未知步骤仍通过公开 API 写成中文失败', async (t) => {
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
