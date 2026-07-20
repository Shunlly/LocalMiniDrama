const STORAGE_PREFIX = 'lmd-ai-config-connection-status-v2'
const VALID_STATUSES = new Set(['passed', 'failed'])
const RUNTIME_SCOPE_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/

function normalizeRuntimeScope(value) {
  const scope = String(value || '').trim()
  return RUNTIME_SCOPE_PATTERN.test(scope) ? scope : ''
}

function normalizeEntry(value) {
  if (!value || typeof value !== 'object' || !VALID_STATUSES.has(value.status)) return null
  const testedAt = String(value.testedAt || '').trim()
  if (!testedAt || Number.isNaN(Date.parse(testedAt))) return null
  return { status: value.status, testedAt }
}

function resolveStorage(storage, globalObject) {
  if (storage !== undefined) return storage
  try {
    return globalObject?.localStorage ?? null
  } catch (_) {
    return null
  }
}

function read(storage, storageKey) {
  if (!storage || !storageKey) return {}
  try {
    const parsed = JSON.parse(storage.getItem(storageKey) || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([id, value]) => Number.isInteger(Number(id)) && Number(id) > 0 && normalizeEntry(value))
        .map(([id, value]) => [id, normalizeEntry(value)]),
    )
  } catch (_) {
    return {}
  }
}

export async function resolveAiConfigConnectionStatusScope({
  fetchImpl = globalThis.fetch,
  fallbackScope = '',
} = {}) {
  try {
    const response = await fetchImpl('/health', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    if (response?.ok) {
      const runtimeScope = normalizeRuntimeScope((await response.json())?.instance_id)
      if (runtimeScope) return runtimeScope
    }
  } catch (_) {
    // The build-scoped runtime id remains a non-sensitive offline fallback.
  }
  return normalizeRuntimeScope(fallbackScope)
}

export function createAiConfigConnectionStatusStore({
  storage,
  globalObject = globalThis,
  scope = '',
} = {}) {
  const runtimeScope = normalizeRuntimeScope(scope)
  const resolvedStorage = resolveStorage(storage, globalObject)
  const storageKey = runtimeScope ? `${STORAGE_PREFIX}:${runtimeScope}` : ''
  let entries = read(resolvedStorage, storageKey)

  function persist() {
    if (!resolvedStorage || !storageKey) return
    try {
      if (Object.keys(entries).length === 0 && typeof resolvedStorage.removeItem === 'function') {
        resolvedStorage.removeItem(storageKey)
      } else {
        resolvedStorage.setItem(storageKey, JSON.stringify(entries))
      }
    } catch (_) {
      // Connection status is advisory; unavailable storage must not block configuration.
    }
  }

  return {
    set(configId, status, testedAt = new Date().toISOString()) {
      const id = Number(configId)
      const entry = normalizeEntry({ status, testedAt })
      if (!Number.isInteger(id) || id <= 0 || !entry) return
      entries = { ...entries, [id]: entry }
      persist()
    },
    forConfigs(configs = []) {
      const ids = new Set((Array.isArray(configs) ? configs : [])
        .map((config) => Number(config?.id))
        .filter((id) => Number.isInteger(id) && id > 0))
      const filteredEntries = Object.fromEntries(
        Object.entries(entries).filter(([id]) => ids.has(Number(id))),
      )
      if (Object.keys(filteredEntries).length !== Object.keys(entries).length) {
        entries = filteredEntries
        persist()
      }
      return { ...filteredEntries }
    },
    invalidate(configId) {
      const id = Number(configId)
      if (!Object.prototype.hasOwnProperty.call(entries, id)) return
      const nextEntries = { ...entries }
      delete nextEntries[id]
      entries = nextEntries
      persist()
    },
    invalidateAll() {
      entries = {}
      persist()
    },
  }
}
