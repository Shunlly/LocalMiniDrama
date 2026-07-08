const STATUS_LABELS = {
  pending: '等待中',
  processing: '运行中',
  paused: '已暂停',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

export function normalizeWorkflowRun(run) {
  const steps = Array.isArray(run?.steps) ? run.steps : []
  const failedStep = steps.find((step) => step.status === 'failed') || null
  const activeStep = steps.find((step) => step.status === 'processing') || steps.find((step) => step.status === 'pending') || null
  const completedCount = steps.filter((step) => step.status === 'completed').length
  const totalCount = steps.length
  const active = run?.status === 'pending' || run?.status === 'processing'
  const progress = Math.max(0, Math.min(100, Number(run?.progress) || (totalCount ? Math.round((completedCount / totalCount) * 100) : 0)))

  return {
    id: run?.id || '',
    status: run?.status || 'pending',
    label: STATUS_LABELS[run?.status] || run?.status || '等待中',
    active,
    canRetry: run?.status === 'failed',
    canPause: active,
    canResume: run?.status === 'paused',
    canCancel: active,
    progress,
    failedStep,
    activeStep,
    completedCount,
    totalCount,
  }
}

export function workflowStepLabel(stepKey) {
  const labels = {
    source_intake: '素材导入',
    adaptation_plan: '改编计划',
    apply_episodes: '写入分集',
    asset_bible: '资产 Bible',
    storyboard_draft: '分镜草稿',
    image_generation: '生图',
    video_generation: '生成视频',
    audio_generation: '配音',
    timeline_plan: '时间线',
    post_composite: '合成',
    qa_audit: 'QA 审计',
  }
  return labels[stepKey] || stepKey
}
