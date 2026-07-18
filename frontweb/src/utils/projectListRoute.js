const PROJECT_STATUS_VALUES = new Set(['all', 'draft', 'generating', 'published'])
const PROJECT_SORT_VALUES = new Set(['updated-desc', 'created-desc', 'title-asc'])
const DEFAULT_PROJECT_STATUS = 'all'
const DEFAULT_PROJECT_SORT = 'updated-desc'
const MAX_PROJECT_SEARCH_LENGTH = 200
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

function firstQueryValue(value) {
  return Array.isArray(value) ? value[0] : value
}

function normalizeProjectSearch(value) {
  const rawValue = firstQueryValue(value)
  if (typeof rawValue !== 'string' || CONTROL_CHARACTERS.test(rawValue)) return ''
  return rawValue.trim().slice(0, MAX_PROJECT_SEARCH_LENGTH)
}

function normalizeChoice(value, allowedValues, fallback) {
  const rawValue = firstQueryValue(value)
  return typeof rawValue === 'string' && allowedValues.has(rawValue) ? rawValue : fallback
}

export function normalizeProjectListFilters(query = {}) {
  return {
    q: normalizeProjectSearch(query?.q),
    status: normalizeChoice(query?.status, PROJECT_STATUS_VALUES, DEFAULT_PROJECT_STATUS),
    sort: normalizeChoice(query?.sort, PROJECT_SORT_VALUES, DEFAULT_PROJECT_SORT),
  }
}

export function mergeProjectListFilters(query = {}, filters = {}) {
  const nextQuery = query && typeof query === 'object' ? { ...query } : {}
  delete nextQuery.q
  delete nextQuery.status
  delete nextQuery.sort

  const normalized = normalizeProjectListFilters(filters)
  if (normalized.q) nextQuery.q = normalized.q
  if (normalized.status !== DEFAULT_PROJECT_STATUS) nextQuery.status = normalized.status
  if (normalized.sort !== DEFAULT_PROJECT_SORT) nextQuery.sort = normalized.sort
  return nextQuery
}

export function normalizeProjectListReturnTo(value) {
  const rawValue = firstQueryValue(value)
  if (typeof rawValue !== 'string') return ''

  const candidate = rawValue.trim()
  if (!candidate || candidate.length > 2048 || !candidate.startsWith('/') || CONTROL_CHARACTERS.test(candidate)) return ''

  try {
    const decodedPath = decodeURIComponent(candidate.split(/[?#]/, 1)[0])
    if (decodedPath.includes('\\') || decodedPath.split('/').some((segment) => segment === '.' || segment === '..')) return ''

    const appOrigin = 'https://localminidrama.invalid'
    const parsed = new URL(candidate, appOrigin)
    if (parsed.origin !== appOrigin || parsed.pathname !== '/') return ''

    const filters = normalizeProjectListFilters({
      q: parsed.searchParams.get('q'),
      status: parsed.searchParams.get('status'),
      sort: parsed.searchParams.get('sort'),
    })
    const query = mergeProjectListFilters({}, filters)
    const search = new URLSearchParams(query).toString()
    return `/${search ? `?${search}` : ''}`
  } catch (_) {
    return ''
  }
}

export function resolveProjectEpisodeId(episodes = [], value) {
  const validEpisodeIds = (Array.isArray(episodes) ? episodes : [])
    .map((episode) => Number(episode?.id))
    .filter((id) => Number.isSafeInteger(id) && id > 0)
  const requestedId = Number(firstQueryValue(value))

  if (Number.isSafeInteger(requestedId) && validEpisodeIds.includes(requestedId)) {
    return requestedId
  }
  return validEpisodeIds[0] ?? null
}
