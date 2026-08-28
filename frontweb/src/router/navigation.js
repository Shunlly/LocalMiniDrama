import { isValidResourceId } from '@/utils/routeValidation.js'
import { resolveNotFoundFromPath } from '@/utils/notFoundNavigation.js'
import {
  mergeMediaLibraryNetworkRoute,
  normalizeMediaLibraryNetworkRoute,
} from '@/utils/mediaLibrary.js'
import { getViewDefinition, isAllowedView } from './views.js'

export const RESTORE_FAILURE_MESSAGE = '无法恢复上次页面：地址无效或已失效。'
export const RETURN_TO_REJECTED_MESSAGE = '返回地址无效，已回到安全页面。'

const AI_CONFIG_SERVICE_TYPES = new Set(['text', 'image', 'storyboard_image', 'video', 'tts'])

export function firstQueryValue(value) {
  return Array.isArray(value) ? value[0] : value
}

function cloneQuery(query) {
  return query && typeof query === 'object' ? { ...query } : {}
}

function queriesEqual(left, right) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const key of keys) {
    const a = left[key]
    const b = right[key]
    if (Array.isArray(a) || Array.isArray(b)) {
      if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) return false
      continue
    }
    if (a !== b) return false
  }
  return true
}

function assignNormalized(query, key, nextValue) {
  if (!Object.prototype.hasOwnProperty.call(query, key)) return false
  if (!nextValue) {
    delete query[key]
    return true
  }
  const raw = query[key]
  if (Array.isArray(raw) || raw !== nextValue) {
    query[key] = nextValue
    return true
  }
  return false
}

function normalizePositiveId(value) {
  const raw = firstQueryValue(value)
  return /^[1-9]\d*$/.test(String(raw || '')) ? String(raw) : ''
}

function normalizeFocusId(value) {
  const raw = firstQueryValue(value)
  return /^[A-Za-z0-9:_-]{1,128}$/.test(String(raw || '')) ? String(raw) : ''
}

function normalizeFreeCreateMode(value) {
  const raw = firstQueryValue(value)
  return raw === 'image' || raw === 'video' ? raw : ''
}

function normalizeAiConfigServiceType(value) {
  const raw = String(firstQueryValue(value) || '').trim()
  return AI_CONFIG_SERVICE_TYPES.has(raw) ? raw : ''
}

function normalizeDramaIntake(value) {
  return firstQueryValue(value) === 'source-url' ? 'source-url' : ''
}

export function buildNotFoundLocation(fromPath = '') {
  const from = resolveNotFoundFromPath(fromPath)
  return {
    name: 'not-found',
    replace: true,
    query: from ? { from } : {},
  }
}

export function resolveAppNavigation(viewName, extras = {}) {
  const view = getViewDefinition(viewName)
  if (!view || !isAllowedView(view.name) || view.name === 'not-found') {
    return buildNotFoundLocation(extras.from || '')
  }
  if (view.resourceId && !isValidResourceId(extras.params?.id)) {
    return buildNotFoundLocation(extras.from || view.path)
  }
  return {
    name: view.name,
    params: extras.params || {},
    query: extras.query || {},
    hash: extras.hash || '',
  }
}

export function dispatchAppNavigation(router, viewName, extras = {}) {
  const location = resolveAppNavigation(viewName, extras)
  if (!router) return location
  return extras.replace || location.replace
    ? router.replace(location)
    : router.push(location)
}

export function createLocationSanitizer(normalizers = {}) {
  const normalizeProjectListReturnTo = normalizers.normalizeProjectListReturnTo || (() => '')
  const normalizeAiConfigReturnTo = normalizers.normalizeAiConfigReturnTo || (() => '')
  const normalizeMediaLibraryReturnTo = normalizers.normalizeMediaLibraryReturnTo || (() => '')
  const normalizeBackupReturnTo = normalizers.normalizeBackupReturnTo || (() => '')

  return function sanitizeAppLocation(to = {}) {
    const query = cloneQuery(to.query)
    let changed = false

    if (['drama-detail', 'film', 'film-canvas'].includes(to.name)) {
      if (assignNormalized(query, 'returnTo', normalizeProjectListReturnTo(query.returnTo))) changed = true
      if (assignNormalized(query, 'episode', normalizePositiveId(query.episode))) changed = true
    }
    if (to.name === 'drama-detail') {
      if (assignNormalized(query, 'intake', normalizeDramaIntake(query.intake))) changed = true
    }
    if (to.name === 'film-canvas') {
      if (assignNormalized(query, 'focus', normalizeFocusId(query.focus))) changed = true
    }
    if (to.name === 'ai-config') {
      if (assignNormalized(query, 'returnTo', normalizeAiConfigReturnTo(query.returnTo))) changed = true
      if (assignNormalized(query, 'service_type', normalizeAiConfigServiceType(query.service_type))) changed = true
    }
    if (to.name === 'media-library') {
      if (assignNormalized(query, 'returnTo', normalizeMediaLibraryReturnTo(query.returnTo))) changed = true
      const merged = mergeMediaLibraryNetworkRoute(query, normalizeMediaLibraryNetworkRoute(query))
      if (!queriesEqual(query, merged)) {
        Object.keys(query).forEach((key) => { delete query[key] })
        Object.assign(query, merged)
        changed = true
      }
    }
    if (to.name === 'backup') {
      if (assignNormalized(query, 'returnTo', normalizeBackupReturnTo(query.returnTo))) changed = true
    }
    if (to.name === 'free-create') {
      if (assignNormalized(query, 'mode', normalizeFreeCreateMode(query.mode))) changed = true
    }
    if (to.name === 'not-found') {
      if (assignNormalized(query, 'from', resolveNotFoundFromPath(query.from))) changed = true
    }

    if (!changed) return null
    return {
      name: to.name,
      params: to.params || {},
      query,
      hash: to.hash || '',
      replace: true,
    }
  }
}
