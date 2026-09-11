import { APP_PATH_ALIASES, APP_VIEW_DEFINITIONS } from '@/router/views.js'

function viewPathPattern(path) {
  const escaped = String(path || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp('^' + escaped.replace(/:id/g, '[1-9]\\d*') + '$')
}

const RECOVERABLE_PATH_PATTERNS = Object.values(APP_VIEW_DEFINITIONS)
  .filter((view) => view.allowed && view.persist)
  .map((view) => viewPathPattern(view.path))

const RECOVERABLE_ALIAS_PATHS = new Set(
  APP_PATH_ALIASES
    .filter((alias) => APP_VIEW_DEFINITIONS[alias.view]?.allowed && APP_VIEW_DEFINITIONS[alias.view]?.persist)
    .map((alias) => alias.path),
)

export function isRecoverableNotFoundBackPath(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return false
  const pathname = path.split(/[?#]/, 1)[0]
  if (RECOVERABLE_ALIAS_PATHS.has(pathname)) return true
  return RECOVERABLE_PATH_PATTERNS.some((pattern) => pattern.test(pathname))
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

export function resolveCatchallNotFoundLocation(unknownFullPath = '', currentPath = '') {
  const from = resolveNotFoundFromPath(unknownFullPath)
  return {
    name: 'not-found',
    replace: !isRecoverableNotFoundBackPath(currentPath),
    query: from ? { from } : {},
  }
}
