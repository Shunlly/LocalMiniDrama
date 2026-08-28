import { isValidResourceId } from '@/utils/routeValidation.js'
import { getViewDefinition, isPersistableView } from './views.js'

const STORAGE_KEY = 'localminidrama.workspace.location.v1'

function getSessionStorage(storage) {
  if (storage && typeof storage.getItem === 'function') return storage
  try {
    return globalThis.sessionStorage || null
  } catch (_) {
    return null
  }
}

export function serializeWorkspaceLocation(location = {}) {
  const view = getViewDefinition(location?.name)
  if (!view || !isPersistableView(view.name)) return null

  const params = {}
  if (view.resourceId) {
    const id = location?.params?.id
    if (!isValidResourceId(id)) return null
    params.id = String(id)
  }

  const query = location?.query && typeof location.query === 'object' && !Array.isArray(location.query)
    ? { ...location.query }
    : {}

  return {
    name: view.name,
    params,
    query,
    hash: typeof location?.hash === 'string' ? location.hash : '',
  }
}

export function persistWorkspaceLocation(location, storage) {
  const serialized = serializeWorkspaceLocation(location)
  const store = getSessionStorage(storage)
  if (!serialized || !store?.setItem) return false
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(serialized))
    return true
  } catch (_) {
    return false
  }
}

export function restoreWorkspaceLocation(storage, sanitizeAppLocation) {
  const store = getSessionStorage(storage)
  if (!store?.getItem) return null

  let parsed
  try {
    parsed = JSON.parse(store.getItem(STORAGE_KEY) || 'null')
  } catch (_) {
    return null
  }

  const serialized = serializeWorkspaceLocation(parsed)
  if (!serialized) return null

  if (typeof sanitizeAppLocation !== 'function') return serialized

  const sanitized = sanitizeAppLocation({
    name: serialized.name,
    params: serialized.params,
    query: serialized.query,
    hash: serialized.hash,
    fullPath: '',
  })
  if (!sanitized) return serialized
  if (sanitized.name === 'not-found' || sanitized.name === 'not-found-catchall') return null
  return {
    name: sanitized.name,
    params: sanitized.params || serialized.params,
    query: sanitized.query || {},
    hash: sanitized.hash || '',
  }
}
