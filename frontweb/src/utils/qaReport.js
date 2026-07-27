export function normalizeQaReport(report) {
  const body = report?.report_json || {}
  const issues = Array.isArray(body.issues) ? body.issues : []
  const checks = Array.isArray(body.checks) ? body.checks : []
  const remediationActions = Array.isArray(body.remediation_actions) ? body.remediation_actions : []
  const severityCounts = issues.reduce((acc, issue) => {
    const key = issue.severity || 'info'
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})

  return {
    id: report?.id || null,
    score: Number(report?.score ?? body.score ?? 0),
    passed: Boolean(report?.passed ?? body.passed),
    run_id: report?.run_id || body.run_id || null,
    issues,
    checks,
    issueCount: issues.length,
    severityCounts,
    recommendations: Array.isArray(body.recommendations) ? body.recommendations : [],
    remediationActions,
    canRemediate: remediationActions.some((action) => action.automated),
    created_at: report?.created_at || body.evaluated_at || '',
    mode: report?.mode || body.mode || '',
  }
}

const QA_CHECK_LABELS = Object.freeze({
  source_intake: '素材导入',
  story_ir: '故事结构',
  episodes: '分集剧本',
  character_continuity: '角色连续性',
  asset_library: '场景与道具资产',
  storyboards: '分镜完整性',
  production_asset_references: '正式资产引用',
  media_timeline: '媒体与时间线',
  workflow_integrity: '流程完整性',
  provider_sdk_audit: 'AI 调用审计',
  skill_registry_audit: '技能调用审计',
  skill_template_audit: '技能模板审计',
  legacy_async_audit: '后台任务审计',
})

export function qaCheckLabel(value) {
  return QA_CHECK_LABELS[String(value || '').trim()] || '其他检查'
}

export function buildQaPresentation(report, fallbackMode = 'production') {
  const qa = normalizeQaReport(report)
  const mode = qa.mode || fallbackMode
  const draft = mode === 'draft'
  const scopeLabel = draft ? '草稿结构检查' : '正式交付检查'
  return {
    scopeLabel,
    scoreLabel: `${scopeLabel} ${qa.score} 分`,
    statusLabel: `${draft ? '草稿结构检查' : '正式交付检查'}${qa.passed ? '已通过' : '未通过'}`,
    notice: draft
      ? '该评分仅评估脚本与流程结构；草稿占位媒体不计为可交付成片。'
      : '',
  }
}
