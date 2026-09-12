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

function isPositiveResourceId(value) {
  return /^[1-9]\d*$/.test(String(value || ''))
}

function pathnameOf(path) {
  return String(path || '').split(/[?#]/, 1)[0]
}

export function isRecoverableNotFoundBackPath(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return false
  const pathname = pathnameOf(path)
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

export function resolveNotFoundDisplayPath(route = {}) {
  const fromQuery = resolveNotFoundFromPath(route.query?.from)
  if (fromQuery) return fromQuery
  if (route.name === 'not-found-catchall') return resolveNotFoundFromPath(route.fullPath || '')
  return ''
}

export function resolveNotFoundNavigation(historyState, currentFullPath = '') {
  const back = historyState?.back
  if (typeof back !== 'string') return { type: 'home' }
  if (back === currentFullPath) return { type: 'home' }
  const backPath = pathnameOf(back)
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

export function classifyNotFoundPath(value) {
  const path = resolveNotFoundFromPath(value)
  if (!path) return { kind: 'generic', path: '', pathname: '', id: '', validId: false }

  const pathname = pathnameOf(path)
  const canvasMatch = pathname.match(/^\/film\/([^/]+)\/canvas$/)
  if (canvasMatch) {
    return {
      kind: 'film-canvas',
      path,
      pathname,
      id: canvasMatch[1],
      validId: isPositiveResourceId(canvasMatch[1]),
    }
  }

  const filmMatch = pathname.match(/^\/film\/([^/]+)$/)
  if (filmMatch) {
    return {
      kind: 'film',
      path,
      pathname,
      id: filmMatch[1],
      validId: isPositiveResourceId(filmMatch[1]),
    }
  }

  const dramaMatch = pathname.match(/^\/drama\/([^/]+)$/)
  if (dramaMatch) {
    return {
      kind: 'drama-detail',
      path,
      pathname,
      id: dramaMatch[1],
      validId: isPositiveResourceId(dramaMatch[1]),
    }
  }

  if (pathname === '/film' || pathname.startsWith('/film/')) {
    return { kind: 'film-unknown', path, pathname, id: '', validId: false }
  }
  if (pathname === '/drama' || pathname.startsWith('/drama/')) {
    return { kind: 'drama-unknown', path, pathname, id: '', validId: false }
  }

  return { kind: 'unknown', path, pathname, id: '', validId: false }
}

function notFoundReason(classified) {
  const address = classified.path ? `无法打开地址 ${classified.path}。` : ''
  if (classified.kind === 'film') {
    return classified.validId
      ? `${address}制作页深链接已失效，项目可能不存在或已不可用。`
      : `${address}制作页深链接已失效，项目编号不正确，无法进入制作。`
  }
  if (classified.kind === 'film-canvas') {
    return classified.validId
      ? `${address}画布深链接已失效，项目可能不存在或已不可用。`
      : `${address}画布深链接已失效，项目编号不正确，无法打开剧集画布。`
  }
  if (classified.kind === 'drama-detail') {
    return classified.validId
      ? `${address}项目详情深链接已失效，项目可能不存在或已不可用。`
      : `${address}项目详情深链接已失效，项目编号不正确，无法打开剧集管理。`
  }
  if (classified.kind === 'film-unknown') {
    return `${address}这个制作相关地址不在应用里，可能是旧链接或输入错误。`
  }
  if (classified.kind === 'drama-unknown') {
    return `${address}这个项目详情地址不在应用里，可能是旧链接或输入错误。`
  }
  if (classified.kind === 'unknown') {
    return `${address}这个地址不在应用里，可能是旧链接或输入错误。`
  }
  return '地址可能已失效，或项目编号不正确。'
}

function notFoundNextStep(classified, canGoBack) {
  let specific = ''
  if (classified.kind === 'film' || classified.kind === 'film-unknown') {
    specific = '下一步：回到项目列表，从项目卡片重新打开制作页。'
  } else if (classified.kind === 'film-canvas') {
    specific = '下一步：回到项目列表，打开有效项目后再进入画布。'
  } else if (classified.kind === 'drama-detail' || classified.kind === 'drama-unknown') {
    specific = '下一步：回到项目列表，从项目卡片重新进入详情。'
  }

  if (canGoBack && specific) return `可以返回上一页。${specific}`
  if (canGoBack) return '可以返回上一页，或回到项目列表继续制作。'
  return specific || '可以回到项目列表继续制作。'
}

export function resolveNotFoundCopy(fromPath, options = {}) {
  const classified = classifyNotFoundPath(fromPath)
  return {
    title: '页面不存在',
    kind: classified.kind,
    reason: notFoundReason(classified),
    nextStep: notFoundNextStep(classified, options.canGoBack === true),
  }
}
