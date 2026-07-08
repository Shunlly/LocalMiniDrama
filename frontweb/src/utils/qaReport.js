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
  }
}
