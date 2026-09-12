'use strict';

/**
 * 质量检查用户可见中文：issue 文案、建议、修复动作与跳过原因。
 * 路由仍通过 qaService 调用，本模块不改变公开 API。
 */

const ISSUE_MESSAGES = Object.freeze({
  drama_missing: '项目不存在',
  source_missing: '缺少可追溯的故事素材及素材片段',
  story_ir_missing: '故事事件、事件关系或改编计划不完整',
  episodes_incomplete: '缺少分集，或部分分集还没有剧本内容',
  character_continuity_incomplete: '角色需要名称、视觉锚点和至少一项图片或参考素材',
  asset_library_empty: '缺少场景或道具资产',
  storyboards_incomplete: Object.freeze({
    draft: '每个分镜都需要画面动作、时长、图片提示词和视频提示词',
    production: '正式制作分镜需要画面构图、运镜、时长、对白或旁白、图片提示词和视频提示词',
  }),
  production_asset_references_invalid: '正式制作分镜引用必须指向现有且非占位的角色、场景和道具资产',
  media_timeline_incomplete: Object.freeze({
    draft: '草稿流程的时间线计划不完整',
    production: '正式交付检查要求每个分镜都有非占位的真实生成媒体',
  }),
  workflow_steps_incomplete: '制作流程仍有未完成步骤',
  provider_audit_missing: Object.freeze({
    draft: 'AI 服务生成审计记录缺失或不完整',
    production: '正式交付检查需要文本、素材图片、分镜图片、视频、语音和合成器的成功非占位审计记录',
  }),
  skill_audit_missing: '技能调用审计记录缺失或不完整',
  skill_templates_missing: '缺少本地技能提示词模板',
  legacy_async_audit_failed: '发现未纳入追踪的旧版后台任务入口',
});

const ISSUE_RECOMMENDATIONS = Object.freeze({
  drama_missing: '请先创建或选择有效项目，再启动制作流程。',
  source_missing: '请先在故事素材流程导入素材，再开始正式制作。',
  story_ir_missing: '请根据已导入素材创建或重新生成改编计划。',
  episodes_incomplete: '请应用改编计划，或补齐缺失的分集剧本。',
  character_continuity_incomplete: '请在图片或视频生成前补齐角色锚点和参考图。',
  asset_library_empty: '请提取或添加场景、道具，以保持画面连续性。',
  storyboards_incomplete: '请在生成媒体前补齐分镜草稿字段。',
  production_asset_references_invalid: '请用现有正式资产替换缺失或占位的分镜引用。',
  media_timeline_incomplete: '请在最终验收前生成完整媒体和时间线轨道。',
  workflow_steps_incomplete: '请在最终质量检查前重试失败的流程步骤。',
  provider_audit_missing: '请通过统一制作流程调用 AI 服务，确保图片、视频、音频和合成记录可审计。',
  skill_audit_missing: '请通过已注册技能运行流程节点，保留创作和质量决策记录。',
  skill_templates_missing: '请在流程审计前恢复本地技能提示词模板。',
  legacy_async_audit_failed: '请先登记或迁移旧版后台任务入口，再增加新的后台任务。',
});

const PROCESS_ERROR_FALLBACKS = Object.freeze({
  skill_templates: '无法审计本地技能提示词模板',
  legacy_async: '后台任务入口审计失败',
});

const REMEDIATION_COPY = Object.freeze({
  import_source: Object.freeze({
    label: '导入故事素材',
    reason: '自动修复前必须先有可追溯的故事素材。',
  }),
  start_or_retry_workflow: Object.freeze({
    label: '启动或重试流程',
    reason: '故事结构或改编计划缺失，可根据最近导入的素材重新生成。',
  }),
  refresh_asset_bible: Object.freeze({
    label: '刷新资产设定',
    reason: '角色身份锚点、阶段设定或参考资产不完整。',
  }),
  repair_storyboards: Object.freeze({
    label: '修复分镜草稿',
    reason: '可重建分镜草稿，然后重新运行媒体、时间线、合成和质量检查。',
  }),
  repair_timeline: Object.freeze({
    label: '修复时间线',
    reason: '可重建时间线轨道、条目和草稿合成产物。',
  }),
  retry_workflow: Object.freeze({
    label: '重试制作流程',
    reason: '分集或流程步骤不完整，应通过统一制作流程修复。',
  }),
  rerun_workflow_audit: Object.freeze({
    label: '重跑流程审计',
    reason: 'AI 服务或技能审计记录应由统一制作流程生成。',
  }),
});

const REMEDIATE_REASONS = Object.freeze({
  already_passed: '质量检查已通过，无需修复',
  no_automated_action: '当前问题没有可自动执行的修复方案',
  missing_source: '缺少可用于自动修复的故事素材',
});

const WORKFLOW_STATUS_LABELS = Object.freeze({
  pending: '等待中',
  processing: '运行中',
  paused: '已暂停',
});

function issueMessage(code, { draftMode } = {}) {
  const entry = ISSUE_MESSAGES[code];
  if (entry == null) return '';
  if (typeof entry === 'string') return entry;
  return draftMode ? entry.draft : entry.production;
}

function recommendationForIssue(issue) {
  const mapped = ISSUE_RECOMMENDATIONS[issue?.code];
  return mapped || issue?.message || '';
}

function workflowActiveStatusReason(status) {
  return `制作流程当前为${WORKFLOW_STATUS_LABELS[status] || '活动状态'}`;
}

module.exports = {
  ISSUE_MESSAGES,
  ISSUE_RECOMMENDATIONS,
  PROCESS_ERROR_FALLBACKS,
  REMEDIATION_COPY,
  REMEDIATE_REASONS,
  WORKFLOW_STATUS_LABELS,
  issueMessage,
  recommendationForIssue,
  workflowActiveStatusReason,
};
