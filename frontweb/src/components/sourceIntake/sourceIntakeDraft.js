const STORAGE_PREFIX = 'lmd-source-intake-draft:'

export function isAiConfigRoundTrip(to) {
  const name = to?.name
  const path = String(to?.path || '')
  return name === 'ai-config' || path === '/ai-config' || path.startsWith('/ai-config/')
}

function storageKey(dramaId) {
  const id = Number(dramaId)
  if (!Number.isFinite(id) || id <= 0) return ''
  return STORAGE_PREFIX + id
}

export function saveSourceIntakeDraft(dramaId, form, storage = globalThis.sessionStorage) {
  const key = storageKey(dramaId)
  if (!key || !storage?.setItem || !form) return false
  const payload = {
    title: String(form.title || ''),
    source_type: form.source_type || '',
    target_episode_count: form.target_episode_count,
    source_url: String(form.source_url || ''),
    text: String(form.text || ''),
  }
  if (!payload.title && !payload.source_url && !payload.text) {
    storage.removeItem?.(key)
    return false
  }
  storage.setItem(key, JSON.stringify(payload))
  return true
}

export function restoreSourceIntakeDraft(dramaId, form, storage = globalThis.sessionStorage) {
  const key = storageKey(dramaId)
  if (!key || !storage?.getItem || !form) return false
  const raw = storage.getItem(key)
  if (!raw) return false
  try {
    const payload = JSON.parse(raw)
    if (!payload || typeof payload !== 'object') return false
    if (payload.title) form.title = String(payload.title)
    if (payload.source_type) form.source_type = payload.source_type
    if (payload.target_episode_count != null) form.target_episode_count = payload.target_episode_count
    if (payload.source_url) form.source_url = String(payload.source_url)
    if (payload.text) form.text = String(payload.text)
    return true
  } catch (_) {
    return false
  }
}

export function clearSourceIntakeDraft(dramaId, storage = globalThis.sessionStorage) {
  const key = storageKey(dramaId)
  if (!key || !storage?.removeItem) return
  storage.removeItem(key)
}
