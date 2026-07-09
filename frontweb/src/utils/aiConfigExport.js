const MASKED_SECRET = '********'

export function isMaskedSecretValue(value) {
  return String(value || '').trim() === MASKED_SECRET
}

function removeMaskedSecrets(value) {
  if (Array.isArray(value)) return value.map(removeMaskedSecrets)
  if (!value || typeof value !== 'object') return value
  const out = {}
  for (const [key, child] of Object.entries(value)) {
    out[key] = isMaskedSecretValue(child) ? '' : removeMaskedSecrets(child)
  }
  return out
}

export function stripMaskedSecretsFromSettings(settings) {
  if (!settings) return settings || null
  const parsed = typeof settings === 'object' ? settings : (() => {
    try {
      return JSON.parse(settings)
    } catch (_) {
      return null
    }
  })()
  if (!parsed || typeof parsed !== 'object') return settings
  return JSON.stringify(removeMaskedSecrets(parsed))
}

export function sanitizeConfigForExport(config) {
  const { id, created_at, updated_at, api_key, api_key_set, ...rest } = config || {}
  return {
    ...rest,
    api_key: '',
    settings: stripMaskedSecretsFromSettings(rest.settings),
  }
}
