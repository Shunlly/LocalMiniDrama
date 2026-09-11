'use strict';

// 备份密钥脱敏：识别敏感字段、清洗 URL/请求头，并递归抹除密钥。

const SENSITIVE_BACKUP_STRUCTURED_KEY_ALIASES = new Set(['key', 'keys', 'passwd', 'passphrase']);

function isSensitiveBackupKey(key) {
  const text = String(key || '');
  const compact = text.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return ['auth', 'authentication', 'xauth'].includes(compact) || compact.endsWith('authentication') ||
    /api[_-]?key/i.test(text) ||
    /access[_-]?key/i.test(text) ||
    /credential/i.test(text) ||
    /secret/i.test(text) ||
    /signature/i.test(text) ||
    /^sig$/i.test(text) ||
    /password/i.test(text) ||
    /authorization/i.test(text) ||
    /cookie/i.test(text) ||
    /private[_-]?key/i.test(text) ||
    /session/i.test(text) ||
    /^token$/i.test(text) ||
    /[_-]token$/i.test(text) ||
    /Token$/.test(text);
}

const SAFE_BACKUP_HEADER_NAMES = new Set([
  'accept',
  'acceptencoding',
  'cachecontrol',
  'contenttype',
  'useragent',
]);

function backupKeyWords(key) {
  return String(key || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function isSensitiveBackupStructuredKey(key) {
  return isSensitiveBackupKey(key) ||
    SENSITIVE_BACKUP_STRUCTURED_KEY_ALIASES.has(backupKeyWords(key).join(''));
}

function isBackupHeaderContainerKey(key) {
  return backupKeyWords(key).some((word) => word === 'header' || word === 'headers');
}

function isSafeBackupHeaderName(name) {
  return SAFE_BACKUP_HEADER_NAMES.has(backupKeyWords(name).join(''));
}

const SAFE_BACKUP_URL_QUERY_PARAMETERS = new Set([
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

function normalizeBackupQueryKey(key) {
  return String(key || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function sanitizeBackupRelativeUrl(value) {
  const withoutHash = value.split('#', 1)[0];
  const queryIndex = withoutHash.indexOf('?');
  if (queryIndex < 0) return withoutHash;
  const pathname = withoutHash.slice(0, queryIndex);
  const params = new URLSearchParams(withoutHash.slice(queryIndex + 1));
  for (const key of [...params.keys()]) {
    if (!SAFE_BACKUP_URL_QUERY_PARAMETERS.has(normalizeBackupQueryKey(key))) params.delete(key);
  }
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ''}`;
}

function sanitizeBackupAbsoluteUrl(value, protocolRelative = false) {
  try {
    const parsed = new URL(protocolRelative ? `https:${value}` : value);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    if (protocolRelative) return `//${parsed.host}${parsed.pathname}`.replace(/\/$/, '');
    return parsed.toString().replace(/\/$/, '');
  } catch (_) {
    return '';
  }
}

function sanitizeBackupLocation(value) {
  if (typeof value !== 'string') return value;
  const raw = value.trim();
  if (!raw) return value;
  if (/^https?:\/\//i.test(raw)) return sanitizeBackupAbsoluteUrl(raw);
  if (raw.startsWith('//')) return sanitizeBackupAbsoluteUrl(raw, true);
  if (raw.startsWith('/') || /^[A-Za-z0-9._~-]+\/[^\s]*[?#]/.test(raw)) {
    return sanitizeBackupRelativeUrl(raw);
  }
  return value
    .replace(/https?:\/\/[^\s,"'<>[\]{}(),;]+/gi, (url) => sanitizeBackupAbsoluteUrl(url))
    .replace(/(^|[^:])(\/\/[^\s,"'<>[\]{}(),;]+)/gi, (match, prefix, url) => (
      `${prefix}${sanitizeBackupAbsoluteUrl(url, true)}`
    ))
    .replace(
      /[A-Za-z0-9._~:@%+=\/-]+\?[^\s,"'<>[\]{}(),;]+/gi,
      (url) => sanitizeBackupRelativeUrl(url)
    );
}

function sanitizeBackupUrlColumn(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const urlLike = /^https?:\/\//i.test(raw)
    || raw.startsWith('//')
    || raw.startsWith('/')
    || /^[A-Za-z0-9._~-]+\//.test(raw);
  return urlLike ? sanitizeBackupLocation(raw) : '';
}

function redactBackupHeaders(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return '';
      const headerName = entry.name ?? entry.key ?? '';
      const safe = isSafeBackupHeaderName(headerName);
      const out = {};
      for (const [key, child] of Object.entries(entry)) {
        if (key === 'name' || key === 'key') out[key] = child;
        else if (key === 'value' || key === 'values') out[key] = safe ? redactSecretObject(child, key) : '';
        else out[key] = isSensitiveBackupStructuredKey(key) ? '' : redactSecretObject(child, key);
      }
      return out;
    });
  }
  if (!value || typeof value !== 'object') return '';
  return Object.fromEntries(Object.entries(value).map(([name, child]) => [
    name,
    isSafeBackupHeaderName(name) ? redactSecretObject(child, name) : '',
  ]));
}

function redactSecretObject(value, parentKey = '') {
  if (isBackupHeaderContainerKey(parentKey)) return redactBackupHeaders(value);
  if (Array.isArray(value)) return value.map((child) => redactSecretObject(child, parentKey));
  if (typeof value === 'string') return sanitizeBackupLocation(value);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = isBackupHeaderContainerKey(key)
      ? redactBackupHeaders(child)
      : isSensitiveBackupStructuredKey(key) ? '' : redactSecretObject(child, key);
  }
  return out;
}

function redactSettingsText(value) {
  if (value == null || value === '') return value;
  try {
    return JSON.stringify(redactSecretObject(JSON.parse(value)));
  } catch (_) {
    return null;
  }
}

function redactLooseBackupText(value) {
  return sanitizeBackupLocation(String(value || ''))
    .replace(/\bBearer\s+[^\s,;}\]]+/gi, 'Bearer ')
    .replace(
    /((?:authorization|authentication|api[_-]?key|access[_-]?key|credential|password|private[_-]?key|secret|signature|token)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}\]]+)/gi,
    '$1'
    );
}

function redactStructuredBackupText(value) {
  if (value == null || value === '') return value;
  try {
    return JSON.stringify(redactSecretObject(JSON.parse(value)));
  } catch (_) {
    return redactLooseBackupText(value);
  }
}

function backupColumnRedactionPolicy(columnName) {
  const name = String(columnName || '');
  if (isSensitiveBackupKey(name)) return 'secret';
  if (/(?:url|uri|endpoint)/i.test(name)) return 'url';
  if (/(?:json|settings|metadata|result|payload|options|headers|request|response)/i.test(name)) return 'structured';
  if (/(?:^|_)(?:reference_images|extra_images|scenes)(?:$|_)/i.test(name)) return 'structured';
  if (/(?:^|_)(?:error|message|log)(?:$|_)/i.test(name)) return 'loose';
  return null;
}

module.exports = {
  backupColumnRedactionPolicy,
  backupKeyWords,
  isBackupHeaderContainerKey,
  isSafeBackupHeaderName,
  isSensitiveBackupKey,
  isSensitiveBackupStructuredKey,
  normalizeBackupQueryKey,
  redactBackupHeaders,
  redactLooseBackupText,
  redactSecretObject,
  redactSettingsText,
  redactStructuredBackupText,
  sanitizeBackupAbsoluteUrl,
  sanitizeBackupLocation,
  sanitizeBackupRelativeUrl,
  sanitizeBackupUrlColumn,
};
