/**
 * 项目导出隐私清洗：去掉敏感字段、URL 凭证与查询密钥，并收敛来源元数据。
 */

const { isSensitiveFieldKey } = require('./sensitiveFieldPolicy');

const SENSITIVE_SOURCE_METADATA_KEY = /api[_-]?key|access[_-]?key|client[_-]?secret|secret|password|token|authorization|cookie|private[_-]?key|raw[_-]?text|full[_-]?text|extracted[_-]?text|ocr[_-]?text|transcript/i;
const HTTP_URL_REFERENCE = /^https?:/i;
const RELATIVE_URL_SCHEME = 'lmd-export-relative:';
const MAX_EXPORT_SANITIZE_DEPTH = 64;
const SENSITIVE_KEY_WORDS = new Set([
  'auth',
  'authorization',
  'cookie',
  'cookies',
  'credential',
  'credentials',
  'csrf',
  'jwt',
  'key',
  'keys',
  'passphrase',
  'passwd',
  'password',
  'secret',
  'secrets',
  'session',
  'sessionid',
  'sig',
  'signature',
  'token',
  'tokens',
  'xsrf',
]);
const SENSITIVE_URL_QUERY_KEYS = new Set(['code', 'nonce', 'policy']);
const SENSITIVE_KEY_COMPOUNDS = Object.freeze([
  'apikey',
  'accesskey',
  'accesskeyid',
  'accessid',
  'clientsecret',
  'privatekey',
  'secretkey',
  'signingkey',
  'encryptionkey',
  'accesstoken',
  'refreshtoken',
  'authtoken',
  'bearertoken',
  'sessiontoken',
  'securitytoken',
  'authorization',
  'authentication',
  'credential',
  'signature',
]);

function sensitiveKeyParts(key) {
  const separated = String(key || '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  return separated.split(/[^a-z0-9]+/).filter(Boolean);
}

function isSensitiveExportKey(key) {
  const parts = sensitiveKeyParts(key);
  if (parts.some((part) => SENSITIVE_KEY_WORDS.has(part))) return true;
  const compact = parts.join('');
  return SENSITIVE_KEY_COMPOUNDS.some((term) => compact.includes(term));
}

function isSensitiveUrlQueryKey(key) {
  const compact = sensitiveKeyParts(key).join('');
  return isSensitiveExportKey(key) || SENSITIVE_URL_QUERY_KEYS.has(compact);
}

function normalizeHeaderAlias(key) {
  return sensitiveKeyParts(key).join('');
}

function isRelativeUrlReference(value) {
  if (!value || /[\\\s]/.test(value) || /^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
  if (/^(?:\/|\.\/|\.\.\/|\?|#)/.test(value)) return true;
  const pathname = value.split(/[?#]/, 1)[0];
  return pathname.includes('/') || /(?:^|\/)[^/]+\.[a-z0-9]{1,16}$/i.test(pathname);
}

function parseUrlReference(value) {
  const protocolRelative = value.startsWith('//');
  const httpReference = HTTP_URL_REFERENCE.test(value);
  const relative = !httpReference && !protocolRelative && isRelativeUrlReference(value);
  if (!httpReference && !protocolRelative && !relative) return null;

  try {
    if (protocolRelative) {
      const parsed = new URL(`https:${value}`);
      return {
        parsed,
        serialize: () => parsed.toString().slice('https:'.length),
      };
    }
    if (httpReference) {
      const parsed = new URL(value);
      if (!['http:', 'https:'].includes(parsed.protocol)) return { invalid: true };
      return { parsed, serialize: () => parsed.toString() };
    }
    const parsed = new URL(`${RELATIVE_URL_SCHEME}${value}`);
    return {
      parsed,
      serialize: () => parsed.toString().slice(RELATIVE_URL_SCHEME.length),
    };
  } catch (_) {
    return { invalid: true };
  }
}

function sanitizeUrlReference(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  const reference = parseUrlReference(trimmed);
  if (!reference) return value;
  if (reference.invalid) return null;

  const { parsed } = reference;
  let changed = false;
  if (parsed.username || parsed.password) {
    parsed.username = '';
    parsed.password = '';
    changed = true;
  }

  for (const key of new Set(parsed.searchParams.keys())) {
    if (!isSensitiveUrlQueryKey(key)) continue;
    parsed.searchParams.delete(key);
    changed = true;
  }
  if (!changed) return value;
  return reference.serialize();
}

function sanitizeStructuredJsonString(value, depth) {
  const trimmed = value.trim();
  if (!trimmed || !['{', '['].includes(trimmed[0])) return value;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object') return value;
    const sanitized = sanitizeProjectExport(parsed, depth + 1);
    const before = JSON.stringify(parsed);
    const after = JSON.stringify(sanitized);
    return before === after ? value : after;
  } catch (_) {
    return value;
  }
}

function sanitizeHeaderArray(value, depth) {
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return sanitizeProjectExport(entry, depth + 1);
    }
    const headerNames = Object.entries(entry)
      .filter(([key, child]) => {
        const alias = normalizeHeaderAlias(key);
        return (alias === 'name' || alias === 'key') && typeof child === 'string';
      })
      .map(([, child]) => child);
    if (headerNames.length === 0) return sanitizeProjectExport(entry, depth + 1);

    const sensitiveHeader = headerNames.some((headerName) => isSensitiveFieldKey(headerName));
    const sanitized = {};
    for (const [key, child] of Object.entries(entry)) {
      const alias = normalizeHeaderAlias(key);
      if (alias === 'name' || alias === 'key') {
        sanitized[key] = sanitizeProjectExport(child, depth + 1);
        continue;
      }
      if (sensitiveHeader && (alias === 'value' || alias === 'values')) continue;
      if (isSensitiveExportKey(key)) continue;
      sanitized[key] = sanitizeProjectExport(child, depth + 1);
    }
    return sanitized;
  });
}

function sanitizeProjectExport(value, depth = 0) {
  if (depth > MAX_EXPORT_SANITIZE_DEPTH) return null;
  if (typeof value === 'string') {
    const sanitizedUrl = sanitizeUrlReference(value);
    if (sanitizedUrl !== value) return sanitizedUrl;
    return sanitizeStructuredJsonString(value, depth);
  }
  if (Array.isArray(value)) {
    return value.map((child) => sanitizeProjectExport(child, depth + 1));
  }
  if (!value || typeof value !== 'object') return value;

  const sanitized = {};
  for (const [key, child] of Object.entries(value)) {
    if (isSensitiveExportKey(key)) continue;
    const alias = normalizeHeaderAlias(key);
    if ((alias === 'headers' || alias === 'customheaders') && Array.isArray(child)) {
      sanitized[key] = sanitizeHeaderArray(child, depth + 1);
      continue;
    }
    sanitized[key] = sanitizeProjectExport(child, depth + 1);
  }
  return sanitized;
}

function sanitizeSourceMetadataNode(value, depth = 0) {
  if (value == null) return value;
  if (depth > 6) return null;
  if (typeof value === 'string') return value.slice(0, 2000);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitizeSourceMetadataNode(item, depth + 1));
  }
  if (typeof value !== 'object') return null;
  const safe = {};
  for (const [key, child] of Object.entries(value).slice(0, 100)) {
    if (key === 'original_file' || SENSITIVE_SOURCE_METADATA_KEY.test(key)) continue;
    safe[key] = sanitizeSourceMetadataNode(child, depth + 1);
  }
  return safe;
}

module.exports = {
  sanitizeProjectExport,
  sanitizeSourceMetadataNode,
};
