'use strict';

/**
 * 质量检查结果装配：评估对象、修复动作、报告行转换与读写。
 * 路由仍通过 qaService 调用，本模块不改变公开 API。
 */

const { parseJson, toJson, nowIso } = require('./qaServiceChecks');
const {
  issueMessage,
  recommendationForIssue,
  REMEDIATION_COPY,
} = require('./qaServiceMessages');

function buildRemediationActionsV2(issues, context) {
  const actions = [];
  const add = (code, label, automated, reason, payload = {}) => {
    if (actions.some((action) => action.code === code)) return;
    actions.push({ code, label, automated: !!automated, reason, payload });
  };

  for (const issue of issues) {
    if (issue.code === 'source_missing') {
      add('import_source', REMEDIATION_COPY.import_source.label, false, REMEDIATION_COPY.import_source.reason);
      continue;
    }
    if (issue.code === 'story_ir_missing') {
      add(
        'start_or_retry_workflow',
        REMEDIATION_COPY.start_or_retry_workflow.label,
        context.source_count > 0 || !!context.run_id,
        REMEDIATION_COPY.start_or_retry_workflow.reason,
        { drama_id: context.drama_id, run_id: context.run_id || null }
      );
      continue;
    }
    if (issue.code === 'character_continuity_incomplete') {
      add(
        'refresh_asset_bible',
        REMEDIATION_COPY.refresh_asset_bible.label,
        context.source_count > 0 || !!context.run_id,
        REMEDIATION_COPY.refresh_asset_bible.reason,
        { drama_id: context.drama_id, run_id: context.run_id || null }
      );
      continue;
    }
    if (issue.code === 'storyboards_incomplete') {
      add(
        'repair_storyboards',
        REMEDIATION_COPY.repair_storyboards.label,
        context.source_count > 0 || !!context.run_id,
        REMEDIATION_COPY.repair_storyboards.reason,
        { drama_id: context.drama_id, run_id: context.run_id || null }
      );
      continue;
    }
    if (issue.code === 'media_timeline_incomplete') {
      add(
        'repair_timeline',
        REMEDIATION_COPY.repair_timeline.label,
        context.source_count > 0 || !!context.run_id,
        REMEDIATION_COPY.repair_timeline.reason,
        { drama_id: context.drama_id, run_id: context.run_id || null }
      );
      continue;
    }
    if (['episodes_incomplete', 'workflow_steps_incomplete'].includes(issue.code)) {
      add(
        'start_or_retry_workflow',
        REMEDIATION_COPY.retry_workflow.label,
        context.source_count > 0 || !!context.run_id,
        REMEDIATION_COPY.retry_workflow.reason,
        { drama_id: context.drama_id, run_id: context.run_id || null }
      );
      continue;
    }
    if (['provider_audit_missing', 'skill_audit_missing'].includes(issue.code)) {
      add(
        'start_or_retry_workflow',
        REMEDIATION_COPY.rerun_workflow_audit.label,
        context.source_count > 0 || !!context.run_id,
        REMEDIATION_COPY.rerun_workflow_audit.reason,
        { drama_id: context.drama_id, run_id: context.run_id || null }
      );
    }
  }

  return actions;
}

function assembleQaEvaluation(checkResult) {
  if (checkResult.dramaMissing) {
    return {
      score: 0,
      passed: false,
      issues: [{
        code: 'drama_missing',
        severity: 'error',
        message: issueMessage('drama_missing'),
        target: { drama_id: checkResult.dramaId },
      }],
      checks: [],
      recommendations: [recommendationForIssue({ code: 'drama_missing' })],
    };
  }

  let score = checkResult.score;
  const issues = checkResult.issues;
  if (!checkResult.draftMode && issues.some((issue) => issue.severity === 'error')) {
    score = Math.min(score, 79);
  }
  const passed = score >= 80 && !issues.some((issue) => issue.severity === 'error');
  const recommendations = issues.map((issue) => recommendationForIssue(issue));
  const remediationActions = buildRemediationActionsV2(issues, {
    drama_id: checkResult.dramaId,
    episode_id: checkResult.episodeId,
    run_id: checkResult.runId,
    source_count: checkResult.sourceCount,
    workflow_step_count: checkResult.stepRows.length,
  });

  return {
    drama_id: checkResult.dramaId,
    episode_id: checkResult.episodeId,
    run_id: checkResult.runId,
    mode: checkResult.auditMode,
    score,
    passed,
    issues,
    checks: checkResult.checks,
    recommendations,
    remediation_actions: remediationActions,
    evaluated_at: nowIso(),
  };
}

function rowToQaReport(row) {
  return {
    id: row.id,
    drama_id: row.drama_id,
    episode_id: row.episode_id,
    run_id: row.run_id,
    score: row.score,
    passed: !!row.passed,
    report_json: parseJson(row.report_json, {}),
    created_at: row.created_at,
  };
}

function getQaReportById(db, id) {
  const row = db.prepare('SELECT * FROM qa_reports WHERE id = ?').get(Number(id));
  return row ? rowToQaReport(row) : null;
}

function listQaReports(db, { drama_id, episode_id, run_id, limit } = {}) {
  let sql = 'SELECT * FROM qa_reports WHERE 1 = 1';
  const params = [];
  if (drama_id != null) {
    sql += ' AND drama_id = ?';
    params.push(Number(drama_id));
  }
  if (episode_id != null) {
    sql += ' AND episode_id = ?';
    params.push(Number(episode_id));
  }
  if (run_id != null) {
    sql += ' AND run_id = ?';
    params.push(String(run_id));
  }
  sql += ' ORDER BY created_at DESC, id DESC LIMIT ?';
  params.push(Math.max(1, Math.min(100, Number(limit) || 20)));
  return db.prepare(sql).all(...params).map(rowToQaReport);
}

function saveQaReport(db, evaluation) {
  const createdAt = nowIso();
  const info = db.prepare(
    `INSERT INTO qa_reports (drama_id, episode_id, run_id, score, passed, report_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    evaluation.drama_id,
    evaluation.episode_id || null,
    evaluation.run_id || null,
    evaluation.score,
    evaluation.passed ? 1 : 0,
    toJson(evaluation),
    createdAt
  );
  return getQaReportById(db, Number(info.lastInsertRowid));
}

module.exports = {
  assembleQaEvaluation,
  buildRemediationActionsV2,
  rowToQaReport,
  getQaReportById,
  listQaReports,
  saveQaReport,
};
