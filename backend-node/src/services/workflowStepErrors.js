'use strict';

// 从 workflowService.executeStep 拆出的步骤错误装配与步骤类型过滤。

const EXECUTE_STEP_KEYS = Object.freeze([
  'source_intake',
  'adaptation_plan',
  'apply_episodes',
  'asset_bible',
  'storyboard_draft',
  'image_generation',
  'video_generation',
  'audio_generation',
  'timeline_plan',
  'post_composite',
  'qa_audit',
]);

const KNOWN_EXECUTE_STEP_KEYS = new Set(EXECUTE_STEP_KEYS);

const WORKFLOW_STEP_MESSAGES = Object.freeze({
  SOURCE_NOT_FOUND: '找不到该素材源，请确认素材源仍存在后重试',
  SOURCE_WRONG_DRAMA: '该素材源不属于当前项目，请选择本项目下的素材源',
  PLAN_WRONG_SOURCE: '该改编方案不属于当前素材源，请选择该素材源下的改编方案',
  MISSING_SOURCE_ID: '素材导入步骤未返回素材源 ID，请重新导入素材后再继续',
  MISSING_PLAN_ID: '改编计划步骤未返回改编方案 ID，请重新生成改编方案后再继续',
  APPLY_FAILED: '应用改编方案失败，请确认方案仍存在后重试',
  UNKNOWN_STEP: '未知的工作流步骤，请刷新后重试',
});

function isKnownExecuteStepKey(stepKey) {
  return KNOWN_EXECUTE_STEP_KEYS.has(String(stepKey || ''));
}

function unknownWorkflowStepError() {
  return new Error(WORKFLOW_STEP_MESSAGES.UNKNOWN_STEP);
}

function assertKnownExecuteStepKey(stepKey) {
  if (!isKnownExecuteStepKey(stepKey)) {
    throw unknownWorkflowStepError();
  }
  return stepKey;
}

function assertSourceDetailForRun(detail, dramaId) {
  if (!detail) {
    throw new Error(WORKFLOW_STEP_MESSAGES.SOURCE_NOT_FOUND);
  }
  if (Number(detail.source.drama_id) !== Number(dramaId)) {
    throw new Error(WORKFLOW_STEP_MESSAGES.SOURCE_WRONG_DRAMA);
  }
  return detail;
}

function assertAdaptationPlanForSource(plan, sourceId) {
  if (!plan || Number(plan.source_id) !== Number(sourceId)) {
    throw new Error(WORKFLOW_STEP_MESSAGES.PLAN_WRONG_SOURCE);
  }
  return plan;
}

function requirePreviousSourceId(sourceOut) {
  const sourceId = sourceOut && sourceOut.source_id;
  if (!sourceId) {
    throw new Error(WORKFLOW_STEP_MESSAGES.MISSING_SOURCE_ID);
  }
  return sourceId;
}

function requirePreviousAdaptationPlanId(planOut) {
  const adaptationPlanId = planOut && planOut.adaptation_plan_id;
  if (!adaptationPlanId) {
    throw new Error(WORKFLOW_STEP_MESSAGES.MISSING_PLAN_ID);
  }
  return adaptationPlanId;
}

function assertAdaptationApplyResult(result) {
  if (!result) {
    throw new Error(WORKFLOW_STEP_MESSAGES.APPLY_FAILED);
  }
  return result;
}

function qaAuditFailureError(report) {
  const error = new Error(`质量检查未通过，当前得分 ${report.score}，请根据质量检查报告修复后再重试`);
  error.report = report;
  return error;
}

function assertQaAuditAccepted(report, output) {
  if (!report.passed) {
    throw qaAuditFailureError(report);
  }
  if (!output || output.score < 80 || output.passed !== true) {
    throw qaAuditFailureError(report);
  }
  return output;
}

module.exports = {
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
};
