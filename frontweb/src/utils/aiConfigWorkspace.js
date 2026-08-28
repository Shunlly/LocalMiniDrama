const CONFIG_WORKSPACE_VIEWS = ['coverage', 'configs']

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
