const MASKED_SECRET = '********'

const SECRET_SETTING_WORDS = new Set([
  'authorization',
  'cookie',
  'credential',
  'credentials',
  'key',
  'keys',
  'password',
  'passwords',
  'secret',
  'secrets',
  'sig',
  'signature',
  'signatures',
  'token',
  'tokens',
])

const TOKEN_BUSINESS_WORDS = new Set([
  'budget',
  'cached',
  'completion',
  'cost',
  'count',
  'input',
  'limit',
  'max',
  'min',
  'output',
  'price',
  'prompt',
  'rate',
  'total',
  'usage',
])

export function isMaskedSecretValue(value) {
  return String(value || '').trim() === MASKED_SECRET
}

function settingKeyWords(key) {
  return String(key || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function isTokenBusinessField(words) {
  const compact = words.join('')
  if (!compact.includes('token')) return false
  const hasSecretContext = [
    'access', 'api', 'auth', 'authorization', 'bearer', 'client', 'credential',
    'cookie', 'key', 'password', 'refresh', 'secret', 'session',
  ].some((word) => compact.includes(word))
  return !hasSecretContext && [...TOKEN_BUSINESS_WORDS].some((word) => compact.includes(word))
}

function isSensitiveSettingKey(key) {
  const words = settingKeyWords(key)
  if (isTokenBusinessField(words)) return false
  const compact = words.join('')
  if (compact === 'auth' || compact === 'authentication' || compact === 'xauth' || compact.endsWith('authentication')) return true
  if (words.some((word) => word !== 'key' && word !== 'keys' && SECRET_SETTING_WORDS.has(word))) return true
  if (compact === 'sig' || /authorization|cookie|credential|secret|signature|token|password/.test(compact)) return true
  if (compact === 'key' || compact === 'keys') return true
  return compact.includes('key') && [
    'access', 'api', 'auth', 'bearer', 'client', 'credential', 'encrypt',
    'private', 'secret', 'session', 'signing', 'xapi',
  ].some((context) => compact.includes(context))
}

const SAFE_EXPORT_HEADER_NAMES = new Set([
  'accept',
  'acceptencoding',
  'cachecontrol',
  'contenttype',
  'useragent',
])

function isHeaderContainerKey(key) {
  return settingKeyWords(key).some((word) => word === 'header' || word === 'headers')
}

function isSafeExportHeaderName(name) {
  return SAFE_EXPORT_HEADER_NAMES.has(settingKeyWords(name).join(''))
}

function isSensitiveQueryParameter(key) {
  const compact = settingKeyWords(key).join('')
  return compact === 'auth'
    || compact === 'apikey'
    || compact === 'key'
    || compact === 'sig'
    || /authorization|bearer|cookie|credential|password|secret|signature|sessiontoken|token/.test(compact)
    || (compact.includes('key') && /access|api|auth|client|private|secret|session|signing|xapi/.test(compact))
}

const SAFE_URL_QUERY_PARAMETERS = new Set([
  'alt',
  'apiversion',
  'format',
  'page',
  'pagesize',
  'prettyprint',
  'responseformat',
  'version',
  'view',
])

function isSafeUrlQueryParameter(key) {
  return SAFE_URL_QUERY_PARAMETERS.has(settingKeyWords(key).join(''))
}

function sanitizeRelativeUrl(value) {
  const withoutHash = value.split('#', 1)[0]
  const queryIndex = withoutHash.indexOf('?')
  if (queryIndex < 0) return withoutHash
  const pathname = withoutHash.slice(0, queryIndex)
  const params = new URLSearchParams(withoutHash.slice(queryIndex + 1))
  for (const key of [...params.keys()]) {
    if (isSensitiveQueryParameter(key) || !isSafeUrlQueryParameter(key)) params.delete(key)
  }
  const query = params.toString()
  return `${pathname}${query ? `?${query}` : ''}`
}

function sanitizeProtocolRelativeUrl(value) {
  try {
    const parsed = new URL(`https:${value}`)
    parsed.username = ''
    parsed.password = ''
    parsed.search = ''
    parsed.hash = ''
    return `//${parsed.host}${parsed.pathname}`.replace(/\/$/, '')
  } catch (_) {
    return ''
  }
}

function sanitizeAbsoluteUrl(value) {
  try {
    const parsed = new URL(value)
    parsed.username = ''
    parsed.password = ''
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString().replace(/\/$/, '')
  } catch (_) {
    return ''
  }
}

export function sanitizeUrlForExport(value) {
  const raw = String(value || '').trim()
  if (!raw) return value
  if (/^https?:\/\//i.test(raw)) return sanitizeAbsoluteUrl(raw)
  if (raw.startsWith('//')) return sanitizeProtocolRelativeUrl(raw)
  if (raw.startsWith('/') || /^[A-Za-z0-9._~-]+\/[^\s]*[?#]/.test(raw)) {
    return sanitizeRelativeUrl(raw)
  }

  return value
    .replace(/https?:\/\/[^\s,"'<>[\]{}(),;]+/gi, (url) => sanitizeAbsoluteUrl(url))
    .replace(/(^|[^:])(\/\/[^\s,"'<>[\]{}(),;]+)/gi, (match, prefix, url) => (
      `${prefix}${sanitizeProtocolRelativeUrl(url)}`
    ))
    .replace(
      /[A-Za-z0-9._~:@%+=\/-]+\?[^\s,"'<>[\]{}(),;]+/gi,
      (url) => sanitizeRelativeUrl(url),
    )
}

function sanitizeHeadersForExport(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return ''
      const headerName = entry.name ?? entry.key ?? ''
      const safe = isSafeExportHeaderName(headerName)
      const out = {}
      for (const [key, child] of Object.entries(entry)) {
        if (key === 'name' || key === 'key') out[key] = child
        else if (key === 'value' || key === 'values') out[key] = safe ? removeMaskedSecrets(child, key) : ''
        else out[key] = isSensitiveSettingKey(key) ? '' : removeMaskedSecrets(child, key)
      }
      return out
    })
  }
  if (!value || typeof value !== 'object') return ''
  return Object.fromEntries(Object.entries(value).map(([name, child]) => [
    name,
    isSafeExportHeaderName(name) ? removeMaskedSecrets(child, name) : '',
  ]))
}

function removeMaskedSecrets(value, parentKey = '') {
  if (isHeaderContainerKey(parentKey)) return sanitizeHeadersForExport(value)
  if (Array.isArray(value)) return value.map((child) => removeMaskedSecrets(child, parentKey))
  if (typeof value === 'string') return sanitizeUrlForExport(value)
  if (!value || typeof value !== 'object') return value
  const out = {}
  for (const [key, child] of Object.entries(value)) {
    out[key] = isHeaderContainerKey(key)
      ? sanitizeHeadersForExport(child)
      : isSensitiveSettingKey(key) || isMaskedSecretValue(child)
      ? ''
      : removeMaskedSecrets(child, key)
  }
  return out
}

function sanitizeLooseSettings(settings) {
  const cleaned = settings
    .replace(
      /([A-Za-z][A-Za-z0-9_-]*)(\s*[:=]\s*)(.*?)(?=(?:\s+|,\s*)[A-Za-z][A-Za-z0-9_-]*\s*[:=]|[,}\n]|$)/g,
      (match, key, separator) => isSensitiveSettingKey(key) ? `${key}${separator}` : match,
    )
    .split(MASKED_SECRET).join('')
  return sanitizeUrlForExport(cleaned)
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
  if (!parsed || typeof parsed !== 'object') {
    return typeof settings === 'string' ? sanitizeLooseSettings(settings) : settings
  }
  return JSON.stringify(removeMaskedSecrets(parsed))
}

export function sanitizeConfigForExport(config) {
  const { id, created_at, updated_at, api_key, api_key_set, ...rest } = config || {}
  const sanitized = removeMaskedSecrets(rest)
  return {
    ...sanitized,
    api_key: '',
    settings: stripMaskedSecretsFromSettings(rest.settings),
  }
}
