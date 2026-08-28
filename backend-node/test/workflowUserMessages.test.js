const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const workflowService = require('../src/services/workflowService');

const log = { info() {}, warn() {}, error() {} };

const SERVICE_SOURCE = fs.readFileSync(
  path.join(__dirname, '../src/services/workflowService.js'),
  'utf8'
);

const leftoverEnglish = [
  'Source not found for production text adaptation',
  'Production workflow is not ready: text provider route is unavailable',
  'Source not found',
  'Source does not belong to this drama',
  'Adaptation plan does not belong to this source',
  'Failed to apply adaptation plan',
  'source_intake output missing source_id',
  'adaptation_plan output missing adaptation_plan_id',
  'QA gate failed with score',
  'Unknown workflow step',
  'Workflow scheduling requires a background task scheduler',
  'Unsupported repair action',
  'Workflow cannot complete without a passing QA score of at least 80',
  'User cancelled workflow',
  'User paused workflow',
  'Production text provider request failed',
];

const messages = {
  sourceNotFoundProduction: '找不到用于生产文本改编的素材源，请确认素材源仍存在后重试',
  textRouteUnavailable: '生产工作流尚未就绪：文本模型路由不可用，请在「AI 配置」中启用文本模型后重试',
  sourceNotFound: '找不到该素材源，请确认素材源仍存在后重试',
  sourceWrongDrama: '该素材源不属于当前项目，请选择本项目下的素材源',
  planWrongSource: '该改编方案不属于当前素材源，请选择该素材源下的改编方案',
  applyFailed: '应用改编方案失败，请确认方案仍存在后重试',
  missingSourceId: '素材导入步骤未返回素材源 ID，请重新导入素材后再继续',
  missingPlanId: '改编计划步骤未返回改编方案 ID，请重新生成改编方案后再继续',
  scheduler: '工作流调度需要后台任务调度器，请检查服务状态后重试',
  cancelled: '用户已取消工作流',
  paused: '用户已暂停工作流',
};

function createDb(t) {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO dramas (id, title, description, style, status, created_at, updated_at)
     VALUES (1, 'Workflow Messages', 'fixture', 'anime', 'draft', ?, ?)`
  ).run(now, now);
  t.after(() => db.close());
  return db;
}

function insertDrama(db, id) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO dramas (id, title, description, style, status, created_at, updated_at)
     VALUES (?, 'Other', 'other fixture', 'anime', 'draft', ?, ?)`
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

function insertPlan(db, dramaId, sourceId) {
  const now = new Date().toISOString();
  const plan = db.prepare(
    `INSERT INTO adaptation_plans
     (drama_id, source_id, target_episode_count, style, plan_json, status, created_at, updated_at)
     VALUES (?, ?, 1, 'anime', ?, 'draft', ?, ?)`
  ).run(dramaId, sourceId, JSON.stringify({ episodes: [] }), now, now);
  return Number(plan.lastInsertRowid);
}

async function runUntilFailed(db, params) {
  const run = workflowService.createWorkflowRun(db, log, params);
  const detail = await workflowService.processWorkflowRun(db, log, run.id);
  assert.equal(detail.status, 'failed');
  return detail;
}

function assertFailedMessage(detail, message) {
  assert.equal(detail.error, message);
  const failedStep = detail.steps.find((step) => step.status === 'failed');
  assert.ok(failedStep, '应有失败步骤');
  assert.equal(failedStep.error, message);
}

test('workflowService 源码不再包含已列出的英文用户错误', () => {
  for (const phrase of leftoverEnglish) {
    assert.equal(SERVICE_SOURCE.includes(phrase), false, phrase);
  }
  for (const message of Object.values(messages)) {
    assert.equal(SERVICE_SOURCE.includes(message), true, message);
  }
  assert.match(SERVICE_SOURCE, /质量检查未通过，当前得分 \$\{report\.score\}/);
  assert.match(SERVICE_SOURCE, /未知的工作流步骤：\$\{step\.step_key\}/);
  assert.match(SERVICE_SOURCE, /不支持的修复操作：\$\{action\}/);
  assert.match(SERVICE_SOURCE, /工作流无法完成：质量检查得分需至少 80 分/);
  assert.match(SERVICE_SOURCE, /生产文本模型请求失败/);
  assert.equal(SERVICE_SOURCE.includes('err.code = \'BAD_REQUEST\''), true);
});

test('缺少后台调度器时返回可操作的中文错误', () => {
  assert.throws(
    () => workflowService.scheduleWorkflowRun({}, log, 'run-1', { backgroundTasks: {} }),
    (error) => error.message === messages.scheduler
  );
});

test('工作流步骤失败会把中文错误写入 run/step.error', async (t) => {
  const db = createDb(t);
  insertDrama(db, 2);
  const foreignSourceId = insertSource(db, 2);
  const localSourceId = insertSource(db, 1);
  const foreignPlanId = insertPlan(db, 2, foreignSourceId);

  assertFailedMessage(await runUntilFailed(db, {
    drama_id: 1,
    source_id: 99999,
    steps: [{ key: 'source_intake', label: '素材导入' }],
  }), messages.sourceNotFound);

  assertFailedMessage(await runUntilFailed(db, {
    drama_id: 1,
    source_id: foreignSourceId,
    steps: [{ key: 'source_intake', label: '素材导入' }],
  }), messages.sourceWrongDrama);

  assertFailedMessage(await runUntilFailed(db, {
    drama_id: 1,
    source_id: localSourceId,
    adaptation_plan_id: foreignPlanId,
    steps: [{ key: 'source_intake', label: '素材导入' }],
  }), messages.planWrongSource);

  assertFailedMessage(await runUntilFailed(db, {
    drama_id: 1,
    steps: [{ key: 'adaptation_plan', label: '改编计划' }],
  }), messages.missingSourceId);

  assertFailedMessage(await runUntilFailed(db, {
    drama_id: 1,
    steps: [{ key: 'apply_episodes', label: '写入分集' }],
  }), messages.missingPlanId);

  const applyRun = workflowService.createWorkflowRun(db, log, {
    drama_id: 1,
    steps: [
      { key: 'adaptation_plan', label: '改编计划' },
      { key: 'apply_episodes', label: '写入分集' },
    ],
  });
  db.prepare(
    `UPDATE workflow_steps
     SET status = 'completed', output_json = ?, updated_at = ?
     WHERE run_id = ? AND step_key = 'adaptation_plan'`
  ).run(JSON.stringify({ adaptation_plan_id: 999999 }), new Date().toISOString(), applyRun.id);
  const applyFailed = await workflowService.processWorkflowRun(db, log, applyRun.id);
  assert.equal(applyFailed.status, 'failed');
  assertFailedMessage(applyFailed, messages.applyFailed);

  assertFailedMessage(await runUntilFailed(db, {
    drama_id: 1,
    steps: [{ key: 'not_a_real_step', label: '未知' }],
  }), '未知的工作流步骤：not_a_real_step，请刷新后重试');
});

test('生产文本改编失败返回可操作的中文错误', async (t) => {
  const db = createDb(t);
  const sourceId = insertSource(db, 1);
  const planId = insertPlan(db, 1, sourceId);

  const missingSourceRun = workflowService.createWorkflowRun(db, log, {
    drama_id: 1,
    qa_mode: 'production',
    source_id: sourceId,
    adaptation_plan_id: planId,
    steps: [
      { key: 'source_intake', label: '素材导入' },
      { key: 'adaptation_plan', label: '改编计划' },
    ],
  });
  db.prepare(
    `UPDATE workflow_steps
     SET status = 'completed', output_json = ?, updated_at = ?
     WHERE run_id = ? AND step_key = 'source_intake'`
  ).run(
    JSON.stringify({ source_id: sourceId, adaptation_plan_id: planId }),
    new Date().toISOString(),
    missingSourceRun.id
  );
  db.prepare('UPDATE story_sources SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), sourceId);
  const missingSource = await workflowService.processWorkflowRun(db, log, missingSourceRun.id);
  assert.equal(missingSource.status, 'failed');
  assertFailedMessage(missingSource, messages.sourceNotFoundProduction);

  const liveSourceId = insertSource(db, 1);
  const livePlanId = insertPlan(db, 1, liveSourceId);
  assertFailedMessage(await runUntilFailed(db, {
    drama_id: 1,
    qa_mode: 'production',
    source_id: liveSourceId,
    adaptation_plan_id: livePlanId,
    steps: [
      { key: 'source_intake', label: '素材导入' },
      { key: 'adaptation_plan', label: '改编计划' },
    ],
  }), messages.textRouteUnavailable);
});

test('取消和暂停的默认原因是简体中文', (t) => {
  const db = createDb(t);
  const pausedRun = workflowService.createWorkflowRun(db, log, {
    drama_id: 1,
    steps: [{ key: 'source_intake', label: '素材导入' }],
  });
  const paused = workflowService.pauseWorkflowRun(db, log, pausedRun.id);
  assert.equal(paused.status, 'paused');
  assert.equal(paused.error, messages.paused);

  const cancelledRun = workflowService.createWorkflowRun(db, log, {
    drama_id: 1,
    steps: [{ key: 'source_intake', label: '素材导入' }],
  });
  const cancelled = workflowService.cancelWorkflowRun(db, log, cancelledRun.id);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.error, messages.cancelled);
});
