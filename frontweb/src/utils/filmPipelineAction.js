export function getPipelineCompactAction(state = {}) {
  if (state.running) {
    if (!state.paused) return null
    return { key: 'resume', label: '继续生成', event: 'resume' }
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
  return { key: 'start', label: '一键生成成片', event: 'start-one-click' }
}
