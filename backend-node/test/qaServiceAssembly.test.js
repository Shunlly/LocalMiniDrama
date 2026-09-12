'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const qaService = require('../src/services/qaService');
const {
  assembleQaEvaluation,
  buildRemediationActionsV2,
  rowToQaReport,
  saveQaReport,
  listQaReports,
  getQaReportById,
} = require('../src/services/qaServiceAssembly');

test('qaService 公开 API 保持不变', () => {
  assert.deepEqual(Object.keys(qaService).sort(), [
    'auditDrama',
    'evaluateDrama',
    'getQaReportById',
    'listQaReports',
    'remediateQaReport',
    'rowToQaReport',
  ]);
});

test('项目缺失评估只装配失败结果，不含 remediation_actions', () => {
  const result = assembleQaEvaluation({ dramaMissing: true, dramaId: 42 });
  assert.equal(result.passed, false);
  assert.equal(result.score, 0);
  assert.equal(result.issues[0].code, 'drama_missing');
  assert.equal(result.issues[0].message, '项目不存在');
  assert.deepEqual(result.recommendations, ['请先创建或选择有效项目，再启动制作流程。']);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'remediation_actions'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'evaluated_at'), false);
});

test('正式模式出现 error 时分数封顶到 79 且生成中文修复动作', () => {
  const result = assembleQaEvaluation({
    dramaMissing: false,
    dramaId: 1,
    episodeId: 2,
    runId: 'run-1',
    auditMode: 'production',
    draftMode: false,
    score: 95,
    issues: [{ code: 'storyboards_incomplete', severity: 'error', message: '正式制作分镜需要画面构图、运镜、时长、对白或旁白、图片提示词和视频提示词' }],
    checks: [{ key: 'storyboards', passed: false, weight: 20 }],
    sourceCount: 1,
    stepRows: [{ id: 1 }],
  });
  assert.equal(result.score, 79);
  assert.equal(result.passed, false);
  assert.equal(result.recommendations[0], '请在生成媒体前补齐分镜草稿字段。');
  assert.equal(result.remediation_actions[0].code, 'repair_storyboards');
  assert.equal(result.remediation_actions[0].label, '修复分镜草稿');
  assert.equal(result.remediation_actions[0].automated, true);
  assert.match(result.evaluated_at, /T/);
});

test('rowToQaReport 与报告读写保持原字段', () => {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO dramas (id, title, status, created_at, updated_at)
     VALUES (1, '装配测试', 'draft', ?, ?)`
  ).run(now, now);

  const evaluation = assembleQaEvaluation({
    dramaMissing: false,
    dramaId: 1,
    episodeId: null,
    runId: null,
    auditMode: 'draft',
    draftMode: true,
    score: 80,
    issues: [],
    checks: [],
    sourceCount: 0,
    stepRows: [],
  });
  const saved = saveQaReport(db, evaluation);
  assert.equal(saved.drama_id, 1);
  assert.equal(saved.passed, true);
  assert.equal(saved.report_json.mode, 'draft');
  assert.equal(getQaReportById(db, saved.id).id, saved.id);
  assert.equal(listQaReports(db, { drama_id: 1 }).length, 1);
  assert.deepEqual(rowToQaReport({
    id: 9,
    drama_id: 1,
    episode_id: null,
    run_id: null,
    score: 80,
    passed: 1,
    report_json: '{"mode":"draft"}',
    created_at: now,
  }), {
    id: 9,
    drama_id: 1,
    episode_id: null,
    run_id: null,
    score: 80,
    passed: true,
    report_json: { mode: 'draft' },
    created_at: now,
  });
  db.close();
});

test('修复动作按 issue 去重且无素材时不可自动执行', () => {
  const actions = buildRemediationActionsV2(
    [
      { code: 'source_missing' },
      { code: 'story_ir_missing' },
      { code: 'story_ir_missing' },
    ],
    { drama_id: 1, run_id: null, source_count: 0 }
  );
  assert.equal(actions[0].code, 'import_source');
  assert.equal(actions[0].automated, false);
  assert.equal(actions[1].code, 'start_or_retry_workflow');
  assert.equal(actions[1].automated, false);
  assert.equal(actions.length, 2);
});
