import { resolveNotFoundFromPath } from './notFoundNavigation.js'

export function firstRouteValue(value) {
  return Array.isArray(value) ? value[0] : value
}

export function normalizeResourceId(value) {
  const raw = firstRouteValue(value)
  if (raw == null) return ''
  const text = String(raw)
  return /^[1-9]\d*$/.test(text) ? text : ''
}

export function isValidResourceId(value) {
  return Boolean(normalizeResourceId(value))
}

export function requireValidDramaId(to) {
  const id = normalizeResourceId(to?.params?.id)
  if (!id) {
    const from = resolveNotFoundFromPath(to?.fullPath || '')
    return {
      name: 'not-found',
      replace: true,
      query: from ? { from } : {},
    }
  }
  const raw = to?.params?.id
  if (Array.isArray(raw) || String(raw) !== id) {
    return {
      name: to.name,
      params: { ...(to.params || {}), id },
      query: { ...(to.query || {}) },
      hash: to.hash || '',
      replace: true,
    }
  }
  return true
}

export const SOURCE_WORKFLOW_STEP_IDS = Object.freeze([
  'intake',
  'process',
  'qa',
  'remediation',
  'delivery',
])

const DRAMA_DETAIL_HASHES = new Set([
  '#source-intake-workflow',
  '#episode-list',
  '#project-resources',
])

const DRAMA_DETAIL_HASH_ALIASES = {
  '#intake': '#source-intake-workflow',
  '#sources': '#source-intake-workflow',
  '#workflow': '#source-intake-workflow',
  '#source-intake': '#source-intake-workflow',
  '#episodes': '#episode-list',
  '#resources': '#project-resources',
}

export function normalizeSourceWorkflowStep(value) {
  const raw = String(firstRouteValue(value) || '').trim()
  return SOURCE_WORKFLOW_STEP_IDS.includes(raw) ? raw : ''
}

export function normalizeDramaDetailHash(hash) {
  const raw = String(firstRouteValue(hash) || '').trim()
  if (!raw) return ''
  const normalized = (raw.startsWith('#') ? raw : `#${raw}`).toLowerCase()
  if (DRAMA_DETAIL_HASHES.has(normalized)) return normalized
  return DRAMA_DETAIL_HASH_ALIASES[normalized] || ''
}

export function sanitizeDramaDetailLocation(to = {}) {
  if (to?.name !== 'drama-detail') return null

  const query = to.query && typeof to.query === 'object' && !Array.isArray(to.query)
    ? { ...to.query }
    : {}
  let changed = false

  if (Object.prototype.hasOwnProperty.call(query, 'step')) {
    const step = normalizeSourceWorkflowStep(query.step)
    if (Array.isArray(query.step) || query.step !== step) {
      if (step) query.step = step
      else delete query.step
      changed = true
    }
  }

  const currentHash = typeof to.hash === 'string' ? to.hash : ''
  const hash = currentHash ? normalizeDramaDetailHash(currentHash) : ''
  if (currentHash !== hash) changed = true

  if (!changed) return null
  return {
    name: 'drama-detail',
    params: to.params || {},
    query,
    hash,
    replace: true,
  }
}
