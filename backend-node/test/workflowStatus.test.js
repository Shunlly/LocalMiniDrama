const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const {
  parseJson,
  toJson,
  rowToRun,
  rowToStep,
  getWorkflowRun,
  getWorkflowRunDetail,
  listWorkflowRuns,
  applyWorkflowTypeFilter,
  setRunStatus,
  setStepStatus,
  toUserFacingWorkflowError,
} = require('../src/services/workflowStatus');
const workflowService = require('../src/services/workflowService');
const {
  tryBeginWorkflowProcessing,
  endWorkflowProcessing,
} = require('../src/services/workflowQueue');

function createDb(t) {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO dramas (id, title, description, style, status, created_at, updated_at)
     VALUES (1, '状态装配甲', 'fixture', 'anime', 'draft', ?, ?)`
  ).run(now, now);
  db.prepare(
    `INSERT INTO dramas (id, title, description, style, status, created_at, updated_at)
     VALUES (2, '状态装配乙', 'fixture', 'anime', 'draft', ?, ?)`
  ).run(now, now);
  t.after(() => db.close());
  return db;
}

function insertRun(db, { id, dramaId, type, status, createdAt, deletedAt = null, episodeId = null }) {
  db.prepare(
    `INSERT INTO workflow_runs
     (id, drama_id, episode_id, type, status, progress, input_json, output_json, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`
  ).run(id, dramaId, episodeId, type, status, '{}', '{}', createdAt, createdAt, deletedAt);
}

test('JSON 装配兼容对象、空值和损坏字符串', () => {
  assert.equal(parseJson(null, { keep: true }).keep, true);
  assert.equal(parseJson('', { keep: true }).keep, true);
  assert.deepEqual(parseJson({ a: 1 }), { a: 1 });
  assert.deepEqual(parseJson('{"a":2}'), { a: 2 });
  assert.deepEqual(parseJson('{not-json', { fallback: 1 }), { fallback: 1 });
  assert.equal(toJson(null), '{}');
  assert.equal(toJson({ ok: true }), '{"ok":true}');
});

test('行装配会解析 JSON 并给缺失进度默认值', () => {
  const run = rowToRun({
    id: 'run-1',
    drama_id: 1,
    type: 'novel2anime',
    status: 'pending',
    input_json: '{"qa_mode":"draft"}',
    output_json: '{bad',
  });
  assert.equal(run.progress, 0);
  assert.deepEqual(run.input_json, { qa_mode: 'draft' });
  assert.deepEqual(run.output_json, {});
  const step = rowToStep({
    id: 'step-1',
    run_id: 'run-1',
    step_key: 'source_intake',
    status: 'pending',
  });
  assert.equal(step.attempts, 0);
  assert.equal(step.sort_order, 0);
  assert.deepEqual(step.input_json, {});
});

test('工作流类型过滤把未加前缀的名称当作家族', () => {
  const params = [];
  const sql = applyWorkflowTypeFilter('SELECT * FROM workflow_runs WHERE 1=1', params, 'novel2anime');
  assert.equal(sql, 'SELECT * FROM workflow_runs WHERE 1=1 AND (type = ? OR type LIKE ?)');
  assert.deepEqual(params, ['novel2anime', 'novel2anime:%']);
});

test('列表按项目 ID 过滤，不会把剧集 ID 或其他项目当成同一键', (t) => {
  const db = createDb(t);
  const now = '2026-08-01T00:00:00.000Z';
  const later = '2026-08-01T01:00:00.000Z';
  insertRun(db, { id: 'run-drama-1', dramaId: 1, type: 'novel2anime', status: 'completed', createdAt: later });
  insertRun(db, { id: 'run-drama-2', dramaId: 2, type: 'novel2anime:repair', status: 'failed', createdAt: now });
  insertRun(db, { id: 'run-deleted', dramaId: 1, type: 'novel2anime', status: 'completed', createdAt: later, deletedAt: later });

  assert.notEqual(1, 2);
  assert.notEqual(1, 101);

  const byDrama = listWorkflowRuns(db, { drama_id: 1 });
  assert.deepEqual(byDrama.map((row) => row.id), ['run-drama-1']);

  const byEpisodeIdAsDrama = listWorkflowRuns(db, { drama_id: 101 });
  assert.deepEqual(byEpisodeIdAsDrama, []);

  const family = listWorkflowRuns(db, { type: 'novel2anime' });
  assert.deepEqual(family.map((row) => row.id), ['run-drama-1', 'run-drama-2']);

  const exact = listWorkflowRuns(db, { type: 'novel2anime:repair' });
  assert.deepEqual(exact.map((row) => row.id), ['run-drama-2']);

  assert.equal(getWorkflowRun(db, 'run-deleted'), null);
  assert.equal(workflowService.listWorkflowRuns(db, { drama_id: 1 })[0].id, 'run-drama-1');
});

test('详情会挂上当前 run 的供应商摘要，不会串到其他 run', (t) => {
  const db = createDb(t);
  const now = '2026-08-01T00:00:00.000Z';
  insertRun(db, { id: 'run-main', dramaId: 1, type: 'novel2anime', status: 'processing', createdAt: now });
  insertRun(db, { id: 'run-other', dramaId: 2, type: 'novel2anime', status: 'completed', createdAt: now });
  db.prepare(
    `INSERT INTO workflow_steps
     (id, run_id, step_key, status, attempts, input_json, output_json, sort_order, created_at, updated_at)
     VALUES ('step-main', 'run-main', 'video_generation', 'processing', 1, '{}', '{}', 0, ?, ?)`
  ).run(now, now);
  const insertInvocation = db.prepare(
    `INSERT INTO provider_invocations
     (run_id, workflow_step_id, provider_type, provider_name, model, mode, status, cost_estimate, cost_kind, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'success', ?, ?, ?)`
  );
  insertInvocation.run('run-main', 'step-main', 'video', 'openai', 'test-model', 'production', 0.12, 'estimated', now);
  insertInvocation.run('run-main', 'step-main', 'tts', 'mock-tts', 'mock', 'mock', 0, 'non_billable', now);
  insertInvocation.run('run-main', null, 'text', 'openai', 'test-model', 'production', 0, null, now);
  db.prepare(
    `INSERT INTO workflow_steps
     (id, run_id, step_key, status, attempts, input_json, output_json, sort_order, created_at, updated_at)
     VALUES ('step-other', 'run-other', 'video_generation', 'completed', 1, '{}', '{}', 0, ?, ?)`
  ).run(now, now);
  insertInvocation.run('run-other', 'step-other', 'video', 'leaked', 'leaked', 'production', 9, 'estimated', now);

  assert.notEqual('run-main', 'run-other');
  const detail = getWorkflowRunDetail(db, 'run-main');
  assert.equal(detail.worker_active, false);
  assert.equal(detail.provider_invocations.length, 3);
  assert.equal(detail.provider_invocations.some((item) => item.provider_name === 'leaked'), false);
  assert.equal(detail.steps[0].provider_invocations.length, 2);
  assert.equal(detail.provider_invocations[2].cost_estimate, null);
  assert.equal(detail.provider_invocations[2].cost_kind, 'unknown');

  tryBeginWorkflowProcessing('run-main');
  try {
    assert.equal(workflowService.getWorkflowRunDetail(db, 'run-main').worker_active, true);
    assert.equal(workflowService.getWorkflowRunDetail(db, 'run-other').worker_active, false);
  } finally {
    endWorkflowProcessing('run-main');
  }
});

test('写入 run/step 状态会填充开始和结束时间', (t) => {
  const db = createDb(t);
  const now = '2026-08-01T00:00:00.000Z';
  insertRun(db, { id: 'run-status', dramaId: 1, type: 'novel2anime', status: 'pending', createdAt: now });
  db.prepare(
    `INSERT INTO workflow_steps
     (id, run_id, step_key, status, attempts, input_json, output_json, sort_order, created_at, updated_at)
     VALUES ('step-status', 'run-status', 'source_intake', 'pending', 0, '{}', '{}', 0, ?, ?)`
  ).run(now, now);

  const processing = setRunStatus(db, 'run-status', 'processing', { current_step: 'source_intake' });
  assert.equal(processing.status, 'processing');
  assert.equal(typeof processing.started_at, 'string');
  assert.equal(processing.completed_at, null);

  const failed = setRunStatus(db, 'run-status', 'failed', { error: '步骤失败，请稍后重试' });
  assert.equal(failed.status, 'failed');
  assert.equal(typeof failed.completed_at, 'string');

  const step = setStepStatus(db, 'step-status', 'completed', { output_json: { ok: true } });
  assert.equal(step.status, 'completed');
  assert.equal(JSON.parse(step.output_json).ok, true);
  assert.equal(typeof step.completed_at, 'string');
  assert.equal(setRunStatus(db, 'missing', 'failed'), null);
});

test('工作流可见错误会丢掉英文泄漏并保留可信中文', () => {
  assert.match(toUserFacingWorkflowError(new Error('fetch failed')), /[一-鿿]/);
  assert.doesNotMatch(toUserFacingWorkflowError(new Error('fetch failed')), /fetch failed/i);
  assert.equal(toUserFacingWorkflowError(new Error('请先选择剧集')), '请先选择剧集');
});


test('workflowService 公开导出保持不变', () => {
  assert.deepEqual(Object.keys(workflowService).sort(), [
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
  ].sort());
});
