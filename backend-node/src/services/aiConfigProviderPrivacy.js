/**
 * AI 配置供应商地址校验、响应脱敏与密钥占位处理。
 * 路由和写操作仍走 aiConfigService。
 */
const net = require('net');
const uploadService = require('./uploadService');
const {
  fieldKeyWords: settingKeyWords,
  isSensitiveFieldKey: isSensitiveSettingKey,
} = require('./sensitiveFieldPolicy');

const MASKED_SECRET = '********';

const LOCAL_ONLY_PROVIDERS = new Set([
  'comfyui',
  'comfy_ui',
  'jimeng_ai_api',
  'lmstudio',
  'local_openai',
  'local_sd',
  'local_tts',
  'ollama',
]);
const LOCAL_MODE_CAPABLE_PROVIDERS = new Set([
  ...LOCAL_ONLY_PROVIDERS,
  'openai_compatible',
]);
const BLOCKED_LOCAL_HOSTS = new Set([
  'instance-data',
  'metadata',
  'metadata.azure.internal',
  'metadata.google.internal',
]);
const BLOCKED_PROVIDER_IPS = new Set([
  '100.100.100.200',
  '168.63.129.16',
  '169.254.169.254',
  '169.254.170.2',
  'fd00:ec2::254',
]);

function providerUrlValidationError(message) {
  const error = new Error(message);
  error.code = 'INVALID_PROVIDER_URL';
  error.status = 400;
  return error;
}

function normalizedProviderId(value) {
  return String(value || '').trim().toLowerCase().replace(/-/g, '_');
}

function isAllowedLocalIpv4(hostname) {
  const octets = hostname.split('.').map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return false;
  }
  return octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
}

function isAllowedLocalIpv6(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === '::1') return true;
  const first = host.split(':', 1)[0];
  if (!/^[0-9a-f]{4}$/.test(first)) return false;
  return (parseInt(first, 16) & 0xfe00) === 0xfc00;
}

function isExplicitLocalProviderHost(hostname) {
  const host = String(hostname || '').trim().replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!host
    || BLOCKED_LOCAL_HOSTS.has(host)
    || BLOCKED_PROVIDER_IPS.has(host)
    || host.endsWith('.metadata.google.internal')) return false;
  const family = net.isIP(host);
  if (family === 4) return isAllowedLocalIpv4(host);
  if (family === 6) return isAllowedLocalIpv6(host);
  return !host.includes('.')
    || host === 'localhost'
    || host.endsWith('.localhost')
    || host.endsWith('.local')
    || host.endsWith('.internal')
    || host.endsWith('.home.arpa')
    || host.endsWith('.docker.internal');
}

function isExplicitLocalProviderConfig(config = {}) {
  const provider = normalizedProviderId(config.provider);
  if (!LOCAL_MODE_CAPABLE_PROVIDERS.has(provider)) return false;
  const settings = parseSettingsValue(config.settings) || {};
  return settings.allow_local_http === true;
}

function normalizeProviderBaseUrl(value, config = {}) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    throw providerUrlValidationError('接口地址必须是合法的 HTTP 或 HTTPS 网址');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw providerUrlValidationError('接口地址仅支持 HTTP 或 HTTPS');
  }
  if (parsed.username || parsed.password) {
    throw providerUrlValidationError('接口地址不得包含用户名或密码，请使用认证字段');
  }
  if (parsed.search) {
    throw providerUrlValidationError('接口地址不得包含查询参数，请使用接口路径或认证字段');
  }
  if (parsed.hash) {
    throw providerUrlValidationError('接口地址不得包含网址片段');
  }
  const localTarget = isExplicitLocalProviderHost(parsed.hostname);
  const localMode = isExplicitLocalProviderConfig(config);
  const normalizedHost = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (BLOCKED_LOCAL_HOSTS.has(normalizedHost)
    || BLOCKED_PROVIDER_IPS.has(normalizedHost)
    || normalizedHost.endsWith('.metadata.google.internal')
    || (net.isIP(normalizedHost) && !localTarget && !uploadService.isGloballyRoutableIp(normalizedHost))) {
    throw providerUrlValidationError('服务地址指向被拦截或不可路由的网络位置');
  }
  if (localTarget && !localMode) {
    throw providerUrlValidationError('私有或本地服务地址需要使用已识别的本地供应商模式');
  }
  if (parsed.protocol === 'http:' && (!localTarget || !localMode)) {
    throw providerUrlValidationError('公网服务地址必须使用 HTTPS');
  }
  return parsed.toString().replace(/\/$/, '');
}

function getProviderNetworkOptions(config = {}, overrides = {}) {
  const baseUrl = normalizeProviderBaseUrl(config.base_url, config);
  if (!baseUrl) throw providerUrlValidationError('请填写接口地址');
  const parsed = new URL(baseUrl);
  const allowPrivate = isExplicitLocalProviderHost(parsed.hostname) && isExplicitLocalProviderConfig(config);
  return {
    ...overrides,
    baseUrl,
    trustedOrigins: [baseUrl],
    allowPrivateOrigins: allowPrivate ? [baseUrl] : [],
    requireHttpsForPublic: true,
  };
}

function sanitizeProviderUrlForResponse(value) {
  const raw = String(value || '').trim();
  if (!raw) return raw;
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch (_) {
    return '';
  }
}

function isMaskedSecret(value) {
  return String(value || '').trim() === MASKED_SECRET;
}

function hasSecret(value) {
  return value != null && String(value).trim() !== '';
}

function maskSecretValue(value) {
  return hasSecret(value) ? MASKED_SECRET : '';
}

const SAFE_RESPONSE_HEADER_NAMES = new Set([
  'accept',
  'acceptencoding',
  'cachecontrol',
  'contenttype',
  'useragent',
]);

function isHeaderContainerKey(key) {
  return settingKeyWords(key).some((word) => word === 'header' || word === 'headers');
}

function isSafeResponseHeaderName(name) {
  return SAFE_RESPONSE_HEADER_NAMES.has(settingKeyWords(name).join(''));
}

function isSensitiveQueryParameter(key) {
  const compact = settingKeyWords(key).join('');
  return compact === 'auth'
    || compact === 'apikey'
    || compact === 'key'
    || compact === 'sig'
    || /authorization|bearer|cookie|credential|password|secret|signature|sessiontoken|token/.test(compact)
    || (compact.includes('key') && /access|api|auth|client|private|secret|session|signing|xapi/.test(compact));
}

const SAFE_PROVIDER_QUERY_PARAMETERS = new Set([
  'alt',
  'apiversion',
  'format',
  'page',
  'pagesize',
  'prettyprint',
  'responseformat',
  'version',
  'view',
]);

function isSafeProviderQueryParameter(key) {
  return SAFE_PROVIDER_QUERY_PARAMETERS.has(settingKeyWords(key).join(''));
}

function normalizeProviderEndpoint(value, fieldName = 'endpoint') {
  const fieldLabel = fieldName === 'query_endpoint' ? '查询路径' : '接口路径';
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.length > 2048
    || !raw.startsWith('/')
    || raw.startsWith('//')
    || raw.includes('\\')
    || /[\u0000-\u0020\u007f]/.test(raw)) {
    throw providerUrlValidationError(`${fieldLabel}必须是受控的相对路径，请检查后重试`);
  }
  if (raw.includes('#')) throw providerUrlValidationError(`${fieldLabel}不得包含网址片段`);
  const queryIndex = raw.indexOf('?');
  const pathname = queryIndex >= 0 ? raw.slice(0, queryIndex) : raw;
  const query = queryIndex >= 0 ? raw.slice(queryIndex + 1) : '';
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch (_) {
    throw providerUrlValidationError(`${fieldLabel}包含无效的网址编码`);
  }
  if (decodedPath.includes('\\') || decodedPath.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw providerUrlValidationError(`${fieldLabel}包含不安全的路径段`);
  }
  for (const key of new URLSearchParams(query).keys()) {
    if (isSensitiveQueryParameter(key) || !isSafeProviderQueryParameter(key)) {
      throw providerUrlValidationError(`${fieldLabel}不得在查询参数中携带凭据`);
    }
  }
  return raw;
}

function sanitizeProviderEndpointForResponse(value) {
  const raw = String(value || '').trim();
  if (!raw) return raw;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || /[\u0000-\u001f\u007f]/.test(raw)) return '';
  const hashIndex = raw.indexOf('#');
  const withoutHash = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
  const queryIndex = withoutHash.indexOf('?');
  if (queryIndex < 0) return withoutHash;
  const pathname = withoutHash.slice(0, queryIndex);
  const params = new URLSearchParams(withoutHash.slice(queryIndex + 1));
  for (const key of [...params.keys()]) {
    if (isSensitiveQueryParameter(key) || !isSafeProviderQueryParameter(key)) params.delete(key);
  }
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ''}`;
}

function sanitizeProtocolRelativeProviderUrl(value) {
  try {
    const parsed = new URL(`https:${value}`);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return `//${parsed.host}${parsed.pathname}`.replace(/\/$/, '');
  } catch (_) {
    return '';
  }
}

function sanitizeRelativeProviderLocation(value) {
  const hashIndex = value.indexOf('#');
  const withoutHash = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
  const queryIndex = withoutHash.indexOf('?');
  if (queryIndex < 0) return withoutHash;
  const pathname = withoutHash.slice(0, queryIndex);
  const params = new URLSearchParams(withoutHash.slice(queryIndex + 1));
  for (const key of [...params.keys()]) {
    if (isSensitiveQueryParameter(key) || !isSafeProviderQueryParameter(key)) params.delete(key);
  }
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ''}`;
}

function sanitizeProviderLocationForResponse(value) {
  if (typeof value !== 'string') return value;
  const raw = value.trim();
  if (!raw) return value;
  if (/^https?:\/\//i.test(raw)) return sanitizeProviderUrlForResponse(raw);
  if (raw.startsWith('//')) return sanitizeProtocolRelativeProviderUrl(raw);
  if (raw.startsWith('/') || /^[A-Za-z0-9._~-]+\/[^\s]*[?#]/.test(raw)) {
    return sanitizeRelativeProviderLocation(raw);
  }

  return value
    .replace(/https?:\/\/[^\s,"'<>[\]{}(),;]+/gi, (url) => sanitizeProviderUrlForResponse(url))
    .replace(/(^|[^:])(\/\/[^\s,"'<>[\]{}(),;]+)/gi, (match, prefix, url) => (
      `${prefix}${sanitizeProtocolRelativeProviderUrl(url)}`
    ))
    .replace(
      /[A-Za-z0-9._~:@%+=\/-]+\?[^\s,"'<>[\]{}(),;]+/gi,
      (url) => sanitizeRelativeProviderLocation(url)
    );
}

function maskHeaderCollection(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return maskSecretValue(entry);
      const headerName = entry.name ?? entry.key ?? '';
      const safe = isSafeResponseHeaderName(headerName);
      const out = {};
      for (const [key, child] of Object.entries(entry)) {
        if (key === 'name' || key === 'key') out[key] = child;
        else if (key === 'value' || key === 'values') out[key] = safe
          ? maskSensitiveSettingsObject(child, key)
          : maskSecretValue(child);
        else out[key] = isSensitiveSettingKey(key) ? maskSecretValue(child) : maskSensitiveSettingsObject(child, key);
      }
      return out;
    });
  }
  if (!value || typeof value !== 'object') return maskSecretValue(value);
  const out = {};
  for (const [name, child] of Object.entries(value)) {
    out[name] = isSafeResponseHeaderName(name)
      ? maskSensitiveSettingsObject(child, name)
      : maskSecretValue(child);
  }
  return out;
}

function maskSensitiveSettingsObject(value, parentKey = '') {
  if (isHeaderContainerKey(parentKey)) return maskHeaderCollection(value);
  if (Array.isArray(value)) return value.map((child) => maskSensitiveSettingsObject(child, parentKey));
  if (typeof value === 'string') return sanitizeProviderLocationForResponse(value);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (isSensitiveSettingKey(key)) {
      out[key] = maskSecretValue(child);
    } else if (isHeaderContainerKey(key)) {
      out[key] = maskHeaderCollection(child);
    } else {
      out[key] = maskSensitiveSettingsObject(child, key);
    }
  }
  return out;
}

function parseSettingsValue(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function maskSensitiveSettings(settings) {
  const parsed = parseSettingsValue(settings);
  if (!parsed) {
    if (typeof settings !== 'string') return settings;
    let masked = settings.replace(
      /([A-Za-z][A-Za-z0-9_-]*)(\s*[:=]\s*)(.*?)(?=(?:\s+|,\s*)[A-Za-z][A-Za-z0-9_-]*\s*[:=]|[,}\n]|$)/g,
      (match, key, separator) => isSensitiveSettingKey(key)
        ? `${key}${separator}${MASKED_SECRET}`
        : match
    );
    masked = masked.replace(/\b(sk-[A-Za-z0-9._-]{6,})\b/g, '********');
    return sanitizeProviderLocationForResponse(masked);
  }
  return JSON.stringify(maskSensitiveSettingsObject(parsed));
}

function preserveMaskedSettingsValue(nextValue, existingValue) {
  if (isMaskedSecret(nextValue)) return existingValue;
  if (Array.isArray(nextValue)) {
    return nextValue.map((item, index) => preserveMaskedSettingsValue(item, Array.isArray(existingValue) ? existingValue[index] : undefined));
  }
  if (nextValue && typeof nextValue === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(nextValue)) {
      out[key] = preserveMaskedSettingsValue(child, existingValue && typeof existingValue === 'object' ? existingValue[key] : undefined);
    }
    return out;
  }
  return nextValue;
}

function preserveMaskedSettings(nextSettings, existingSettings) {
  if (nextSettings == null) return nextSettings;
  const nextParsed = parseSettingsValue(nextSettings);
  if (!nextParsed) return nextSettings;
  const existingParsed = parseSettingsValue(existingSettings) || {};
  return JSON.stringify(preserveMaskedSettingsValue(nextParsed, existingParsed));
}

function hasStoredCredentialValue(value) {
  const normalized = String(value || '').trim();
  return normalized !== '' && normalized !== MASKED_SECRET;
}

function hasStoredCredentials(config = {}) {
  if (hasStoredCredentialValue(config.api_key)) return true;
  const settings = parseSettingsValue(config.settings) || {};
  const credentialPairs = [
    ['kling_access_key', 'kling_secret_key'],
    ['access_key', 'secret_key'],
    ['access_key_id', 'secret_access_key'],
  ];
  return credentialPairs.some(([accessKey, secretKey]) => (
    hasStoredCredentialValue(settings[accessKey])
      && hasStoredCredentialValue(settings[secretKey])
  ));
}

function configForResponse(config) {
  if (!config) return config;
  const maskedConfig = maskSensitiveSettingsObject(config);
  return {
    ...maskedConfig,
    base_url: sanitizeProviderUrlForResponse(config.base_url),
    endpoint: sanitizeProviderEndpointForResponse(config.endpoint),
    query_endpoint: sanitizeProviderEndpointForResponse(config.query_endpoint),
    api_key: maskSecretValue(config.api_key),
    api_key_set: hasStoredCredentialValue(config.api_key),
    credential_set: hasStoredCredentials(config),
    settings: maskSensitiveSettings(config.settings),
  };
}

module.exports = {
  MASKED_SECRET,
  providerUrlValidationError,
  configForResponse,
  getProviderNetworkOptions,
  hasStoredCredentials,
  isExplicitLocalProviderConfig,
  isExplicitLocalProviderHost,
  isMaskedSecret,
  maskSensitiveSettings,
  normalizeProviderBaseUrl,
  normalizeProviderEndpoint,
  parseSettingsValue,
  preserveMaskedSettings,
  sanitizeProviderEndpointForResponse,
  sanitizeProviderUrlForResponse,
};
