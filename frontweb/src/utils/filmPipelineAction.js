export function getPipelineCompactAction(state = {}) {
  if (state.running) {
    if (!state.paused) return null
    return { key: 'resume', label: '继续生成', event: 'resume' }
  }

  if (state.hasEpisode === false) {
    return { key: 'add-episode', label: '添加一集', event: 'add-episode' }
  }

  if (state.draftReason || state.readinessState === 'checking') return null

  if (state.readinessState === 'missing') {
    return {
      key: 'configure',
      label: '配置缺失服务',
      event: 'open-ai-config',
      payload: state.serviceType || '',
    }
  }

  if (state.readinessState === 'error') {
    return { key: 'retry', label: '重试能力检查', event: 'retry-readiness' }
  }

  if (state.readinessState !== 'ready' || state.productionReason) return null
  if (state.hasError) return { key: 'retry-run', label: '重试全流程', event: 'start-one-click' }
  return { key: 'start', label: '一键生成成片', event: 'start-one-click' }
}

export function getPipelineControlReasons(state = {}) {
  const stoppingReason = state.stopping ? '正在停止全流程，请稍候。' : ''
  if (!state.running) {
    return {
      pause: '当前没有运行中的全流程。',
      resume: '当前没有运行中的全流程。',
      cancel: '当前没有运行中的全流程。',
      retry: state.productionReason || '',
    }
  }
  const stopBlockedReason = state.stopRequired
    ? '停止未完成，请先重试停止剩余任务。'
    : stoppingReason
  return {
    pause: stopBlockedReason || (state.paused ? '全流程已暂停。' : ''),
    resume: stopBlockedReason || (state.paused ? '' : '仅已暂停的全流程可以继续。'),
    cancel: stoppingReason,
    retry: '全流程仍在执行，请等待完成或先停止。',
  }
}
