export function resolveNotFoundNavigation(historyState, currentFullPath = '') {
  const back = historyState?.back
  if (typeof back !== 'string' || !back.startsWith('/') || back.startsWith('//')) {
    return { type: 'home' }
  }
  const backPath = back.split(/[?#]/, 1)[0]
  if (!backPath || backPath === '/not-found') return { type: 'home' }
  if (back === currentFullPath) return { type: 'home' }
  return { type: 'back' }
}
