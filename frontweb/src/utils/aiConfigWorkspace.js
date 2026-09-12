/**
 * AI 配置工作区导航与初始服务类型归一。
 */
const CONFIG_WORKSPACE_VIEWS = ['coverage', 'configs']
const FILTERABLE_SERVICE_TYPES = new Set(['text', 'image', 'storyboard_image', 'video', 'tts', 'ocr', 'transcription'])

export function normalizeInitialServiceType(value) {
  const normalized = String(value || '').trim()
  return FILTERABLE_SERVICE_TYPES.has(normalized) ? normalized : ''
}

export function getConfigWorkspaceKeyTarget(currentView, key) {
  const currentIndex = CONFIG_WORKSPACE_VIEWS.indexOf(currentView)
  if (currentIndex < 0) return ''
  if (key === 'Home') return CONFIG_WORKSPACE_VIEWS[0]
  if (key === 'End') return CONFIG_WORKSPACE_VIEWS[CONFIG_WORKSPACE_VIEWS.length - 1]
  if (key === 'ArrowRight') {
    return CONFIG_WORKSPACE_VIEWS[(currentIndex + 1) % CONFIG_WORKSPACE_VIEWS.length]
  }
  if (key === 'ArrowLeft') {
    return CONFIG_WORKSPACE_VIEWS[(currentIndex - 1 + CONFIG_WORKSPACE_VIEWS.length) % CONFIG_WORKSPACE_VIEWS.length]
  }
  return ''
}

export function shouldApplyConfigWorkspaceRequest({
  requestedServiceType,
  activeServiceType,
  workspaceView,
}) {
  if (requestedServiceType !== activeServiceType) return true
  return Boolean(requestedServiceType) && workspaceView !== 'configs'
}
