export function isRecoverableNotFoundBackPath(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return false
  const pathname = path.split(/[?#]/, 1)[0]
  return /^\/(?:(?:ai-config|free-create|media-library)|(?:drama|film)\/[1-9]\d*(?:\/canvas)?)?$/.test(pathname)
}

export function resolveNotFoundFromPath(value) {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw !== 'string') return ''
  const candidate = raw.trim()
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.length > 180) return ''
  if (/[\u0000-\u001f\u007f]/.test(candidate)) return ''
  return candidate
}

export function resolveNotFoundNavigation(historyState, currentFullPath = '') {
  const back = historyState?.back
  if (typeof back !== 'string') return { type: 'home' }
  if (back === currentFullPath) return { type: 'home' }
  const backPath = back.split(/[?#]/, 1)[0]
  if (!isRecoverableNotFoundBackPath(backPath)) return { type: 'home' }
  return { type: 'back' }
}
