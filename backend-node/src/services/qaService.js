'use strict';

/**
 * 质量检查公开 API：评估、落库、查询与自动修复。
 * 检查规则、结果装配和错误文案分别在 qaServiceChecks / qaServiceCheckCollectors / qaServiceCheckRules / qaServiceAssembly / qaServiceMessages。
 */

const { toUserFacingProcessError } = require('./providerErrorSanitizer');
const { runQaChecks } = require('./qaServiceChecks');
const {
  assembleQaEvaluation,
  getQaReportById,
  listQaReports,
  rowToQaReport,
  saveQaReport,
} = require('./qaServiceAssembly');
const {
  REMEDIATE_REASONS,
  workflowActiveStatusReason,
} = require('./qaServiceMessages');

function evaluateDrama(db, params) {
  return assembleQaEvaluation(runQaChecks(db, params, toUserFacingProcessError));
}

function auditDrama(db, log, params) {
  const evaluation = evaluateDrama(db, params);
  const report = saveQaReport(db, evaluation);
  log?.info?.('QA report created', {
    drama_id: evaluation.drama_id,
    run_id: evaluation.run_id,
    score: evaluation.score,
    passed: evaluation.passed,
  });
  return report;
}

function getLatestSourceForDrama(db, dramaId) {
  return db.prepare(
    `SELECT * FROM story_sources
     WHERE drama_id = ? AND deleted_at IS NULL
     ORDER BY created_at DESC, id DESC
     LIMIT 1`
  ).get(Number(dramaId));
}

function remediateQaReport(db, log, reportId, options = {}) {
  const report = getQaReportById(db, reportId);
  if (!report) return null;
  if (report.passed) {
    return { report, skipped: true, reason: REMEDIATE_REASONS.already_passed, actions_taken: [] };
  }

  const actions = Array.isArray(report.report_json?.remediation_actions)
    ? report.report_json.remediation_actions
    : [];
  const preferred = options.action_code || options.action || '';
  const automatedAction = actions.find((action) => action.automated && action.code === preferred) ||
    actions.find((action) => action.automated && ['refresh_asset_bible', 'repair_storyboards', 'repair_timeline'].includes(action.code)) ||
    actions.find((action) => action.automated);
  if (!automatedAction) {
    return {
      report,
      skipped: true,
      reason: REMEDIATE_REASONS.no_automated_action,
      actions_taken: [],
      required_actions: actions,
    };
  }

  const workflowService = require('./workflowService');
  if (['refresh_asset_bible', 'repair_storyboards', 'repair_timeline'].includes(automatedAction.code)) {
    const run = workflowService.startNovel2AnimeRepairWorkflow(db, log, {
      drama_id: report.drama_id,
      episode_id: report.episode_id || null,
      mode: report.report_json?.mode === 'production' ? 'production' : 'draft',
      action: automatedAction.code,
      target_episode_count: options.target_episode_count || undefined,
      overwrite_existing_episodes: options.overwrite_existing_episodes === true,
      style: options.style || '',
      metadata: { remediation_report_id: report.id, remediation_action: automatedAction.code },
    });
    return {
      report,
      skipped: false,
      actions_taken: [{ code: automatedAction.code, run_id: run.id }],
      workflow_run: run,
    };
  }

  if (report.run_id) {
    const run = workflowService.getWorkflowRunDetail(db, report.run_id);
    if (run && run.status === 'failed') {
      const retried = workflowService.retryWorkflowRun(db, log, run.id, options.workflow_options || {});
      return {
        report,
        skipped: false,
        actions_taken: [{ code: 'retry_workflow', run_id: run.id }],
        workflow_run: retried,
      };
    }
    if (run && ['pending', 'processing', 'paused'].includes(run.status)) {
      return {
        report,
        skipped: true,
        reason: workflowActiveStatusReason(run.status),
        actions_taken: [],
        workflow_run: run,
      };
    }
  }

  const source = getLatestSourceForDrama(db, report.drama_id);
  if (!source) {
    return {
      report,
      skipped: true,
      reason: REMEDIATE_REASONS.missing_source,
      actions_taken: [],
      required_actions: actions,
    };
  }

  const run = workflowService.startNovel2AnimeWorkflow(db, log, {
    drama_id: report.drama_id,
    episode_id: report.episode_id || null,
    source_id: source.id,
    mode: report.report_json?.mode === 'production' ? 'production' : 'draft',
    title: source.title || '',
    source_type: source.source_type || '',
    target_episode_count: options.target_episode_count || undefined,
    overwrite_existing_episodes: options.overwrite_existing_episodes === true,
    style: options.style || '',
    metadata: { remediation_report_id: report.id },
  });

  return {
    report,
    skipped: false,
    actions_taken: [{ code: 'start_workflow_from_latest_source', source_id: source.id, run_id: run.id }],
    workflow_run: run,
  };
}

module.exports = {
  evaluateDrama,
  auditDrama,
  getQaReportById,
  listQaReports,
  remediateQaReport,
  rowToQaReport,
};
