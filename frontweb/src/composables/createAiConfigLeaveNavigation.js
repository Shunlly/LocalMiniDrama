/**
 * AI 配置独立页的离开确认与返回导航。
 * 页面负责接线 requestClose 和 router.replace；确认只问一次。
 * 预加载只做预热，不得挡住真正的 replace。
 */
export function preloadProjectListPage() {
  return import('@/views/FilmList.vue').catch(() => null)
}

export function preloadAiConfigReturnTarget(returnTo = '') {
  const target = typeof returnTo === 'string' ? returnTo : ''
  if (!target || target === '/' || target.startsWith('/?')) return preloadProjectListPage()
  if (target.startsWith('/free-create')) return import('@/views/FreeCreate.vue').catch(() => null)
  if (target.startsWith('/film/') && target.includes('/canvas')) return import('@/views/DramaCanvas.vue').catch(() => null)
  if (target.startsWith('/film/')) return import('@/views/FilmCreate.vue').catch(() => null)
  if (target.startsWith('/drama/')) return import('@/views/DramaDetail.vue').catch(() => null)
  return preloadProjectListPage()
}

export function createAiConfigLeaveNavigation(options = {}) {
  const requestClose = options.requestClose
  const navigateBack = options.navigateBack
  const navigateBackup = options.navigateBackup
  const preload = options.preload
  let skipNextRouteGuard = false
  let leaveConfirmed = false

  async function requestAiConfigPageClose() {
    if (leaveConfirmed || skipNextRouteGuard) return true
    const allowed = (await requestClose?.()) !== false
    return allowed
  }

  function allowRouteLeave() {
    if (skipNextRouteGuard || leaveConfirmed) return true
    return requestAiConfigPageClose()
  }

  async function runNavigation(navigate) {
    if (!await requestAiConfigPageClose()) return false
    skipNextRouteGuard = true
    if (typeof preload === 'function') void preload()
    try {
      const result = await navigate()
      if (result === false) {
        skipNextRouteGuard = false
        return false
      }
      leaveConfirmed = true
      skipNextRouteGuard = false
      return true
    } catch (error) {
      skipNextRouteGuard = false
      throw error
    }
  }

  async function goBack() {
    return runNavigation(() => navigateBack())
  }

  async function goBackup() {
    return runNavigation(() => navigateBackup())
  }

  return {
    requestAiConfigPageClose,
    allowRouteLeave,
    goBack,
    goBackup,
    isLeaveConfirmed: () => leaveConfirmed,
    isSkippingRouteGuard: () => skipNextRouteGuard,
  }
}
