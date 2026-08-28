const fs = require('fs');
const path = require('path');

const MAX_LOG_STRING_LENGTH = 2048;
const MAX_LOG_METADATA_LENGTH = 8192;
const SECRET_KEY_PATTERN = /(?:auth(?:orization)?|api[_-]?key|access[_-]?key|secret|password|token|cookie|credential)/i;
const CONTENT_KEY_PATTERN = /(?:prompt|body|raw|response|content|(?:^|_)(?:text|input|output)(?:_|$))/i;
const SAFE_SUMMARY_KEY_PATTERN = /(?:_len|_length|_count|_bytes|_chars|_keys|_status)$/i;
const REDACTED = '[REDACTED]';
const AUTHORIZATION_LABEL_SOURCE = '(?:(?:proxy[-_ ]?)?authorization|auth(?:orization)?[-_ ]?header)';
const COOKIE_LABEL_SOURCE = '(?:set[-_ ]?cookie|cookie)';
const SECRET_LABEL_SOURCE = '(?:x[-_ ]?api[-_ ]?key|api[-_ ]?key|access[-_ ]?key(?:[-_ ]?id)?|client[-_ ]?secret|private[-_ ]?key|secret|password|passwd|passphrase|credential|(?:access|refresh|id|session|csrf|xsrf|auth)[-_ ]?token|token|signature|sig)';
const SENSITIVE_QUERY_KEY_PATTERN = /^(?:auth(?:orization)?|api[-_ ]?key|apikey|key|access[-_ ]?key(?:[-_ ]?id)?|awsaccesskeyid|client[-_ ]?secret|private[-_ ]?key|secret|password|passwd|passphrase|credential|(?:access|refresh|id|session|csrf|xsrf|auth)[-_ ]?token|token|signature|sig|code|cookie|x[-_ ]?amz[-_ ]?(?:signature|credential|security[-_ ]?token)|x[-_ ]?goog[-_ ]?(?:signature|credential))$/i;
const URL_USERINFO_PATTERN = /((?:[a-z][a-z0-9+.-]*:)?\/\/)[^/?#\s"'<>]*@/gi;
const QUERY_PARAMETER_PATTERN = /([?&#;])([^?&#;=\s"'<>]+)([ \t]*=[ \t]*)["']?([^?&#;\s"'<>]*)/g;
const JWT_PATTERN = /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{3,}\.[A-Za-z0-9_-]{8,}\b/g;
const AUTH_SCHEME_PATTERN = /\b(Bearer|Basic|Token|API[-_ ]?Key)\b[ \t]+(?:token[ \t]*=[ \t]*)?(?:"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|[^\s,;}"']+)/gi;

function assignmentPatterns(labelSource) {
  const prefix = `(\\b${labelSource}\\b["']?[ \\t]*[:=][ \\t]*)`;
  return {
    doubleQuoted: new RegExp(`${prefix}"(?:\\\\.|[^"\\\\\\r\\n])*"`, 'gi'),
    singleQuoted: new RegExp(`${prefix}'(?:\\\\.|[^'\\\\\\r\\n])*'`, 'gi'),
    unquoted: new RegExp(`${prefix}(?!["'])[^\\s,;}"'&?#]+`, 'gi'),
  };
}

const AUTHORIZATION_PATTERNS = assignmentPatterns(AUTHORIZATION_LABEL_SOURCE);
AUTHORIZATION_PATTERNS.unquoted = new RegExp(
  `(\\b${AUTHORIZATION_LABEL_SOURCE}\\b["']?[ \\t]*[:=][ \\t]*)(?!["'])[^\\r\\n]+`,
  'gi'
);
const COOKIE_PATTERNS = assignmentPatterns(COOKIE_LABEL_SOURCE);
COOKIE_PATTERNS.unquoted = new RegExp(
  `(\\b${COOKIE_LABEL_SOURCE}\\b["']?[ \\t]*[:=][ \\t]*)(?!["'])[^\\r\\n]+`,
  'gi'
);
const SECRET_PATTERNS = assignmentPatterns(SECRET_LABEL_SOURCE);

function redactAssignments(text, patterns) {
  return text
    .replace(patterns.doubleQuoted, `$1"${REDACTED}"`)
    .replace(patterns.singleQuoted, `$1'${REDACTED}'`)
    .replace(patterns.unquoted, `$1${REDACTED}`);
}

function decodeQueryKey(value) {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch (_) {
    return value;
  }
}

function redactUrlCredentials(text) {
  const withoutUserinfo = text.replace(URL_USERINFO_PATTERN, '$1');
  return withoutUserinfo.replace(
    QUERY_PARAMETER_PATTERN,
    (match, delimiter, key, equals) => {
      if (!SENSITIVE_QUERY_KEY_PATTERN.test(decodeQueryKey(key))) return match;
      return `${delimiter}${key}${equals}${REDACTED}`;
    }
  );
}

function sanitizeLogString(value, maxLength = MAX_LOG_STRING_LENGTH) {
  let text = String(value ?? '');
  text = redactUrlCredentials(text);
  text = redactAssignments(text, AUTHORIZATION_PATTERNS);
  text = text.replace(AUTH_SCHEME_PATTERN, (_match, scheme) => `${scheme} ${REDACTED}`);
  text = redactAssignments(text, COOKIE_PATTERNS);
  text = redactAssignments(text, SECRET_PATTERNS);
  text = text.replace(JWT_PATTERN, REDACTED);
  text = text.replace(/\bsk-[A-Za-z0-9._-]{6,}\b/gi, REDACTED);
  if (text.length > maxLength) return `${text.slice(0, maxLength)}...[truncated ${text.length - maxLength} chars]`;
  return text;
}

function sanitizeLogValue(value, key = '', depth = 0, seen = new WeakSet()) {
  if (SECRET_KEY_PATTERN.test(key)) return '[REDACTED]';
  if (typeof value === 'string') {
    if (CONTENT_KEY_PATTERN.test(key) && !SAFE_SUMMARY_KEY_PATTERN.test(key)) {
      return `[REDACTED ${key || 'content'} length=${value.length}]`;
    }
    return sanitizeLogString(value);
  }
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
  if (value instanceof Error) return { name: value.name, message: sanitizeLogString(value.message) };
  if (typeof value !== 'object') return sanitizeLogString(value);
  if (depth >= 5) return '[Max depth reached]';
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) {
    const items = value.slice(0, 20).map((item) => sanitizeLogValue(item, key, depth + 1, seen));
    if (value.length > items.length) items.push(`[${value.length - items.length} more items]`);
    return items;
  }
  const out = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    out[childKey] = sanitizeLogValue(childValue, childKey, depth + 1, seen);
  }
  return out;
}

function formatLogArgs(args) {
  if (!args.length) return '';
  const sanitized = args.map((value) => sanitizeLogValue(value));
  let serialized = sanitized.length === 1 && typeof sanitized[0] === 'object'
    ? JSON.stringify(sanitized[0])
    : sanitized.map((value) => (typeof value === 'object' ? JSON.stringify(value) : String(value))).join(' ');
  if (serialized.length > MAX_LOG_METADATA_LENGTH) {
    serialized = `${serialized.slice(0, MAX_LOG_METADATA_LENGTH)}...[metadata truncated]`;
  }
  return ` ${serialized}`;
}

// 简单 logger，和 Go 端行为接近；若设置 LOG_FILE 则同时追加到该文件（便于打包 exe 双击时查日志）
function log(level, msg, ...args) {
  const time = new Date().toISOString();
  const line = `${time} [${level}] ${sanitizeLogString(msg)}${formatLogArgs(args)}\n`;
  try {
    console.log(line.trimEnd());
  } catch (_) {}
  const logFile = process.env.LOG_FILE;
  if (logFile) {
    try {
      const dir = path.dirname(logFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(logFile, line);
    } catch (_) {}
  }
}

function operation(event = {}) {
  const phase = String(event.phase || 'info');
  const record = sanitizeLogValue({
    ...event,
    event: 'operation',
    operation: event.operation || 'unknown',
    operationId: event.operationId || null,
    phase,
    status: event.status || phase,
    durationMs: Number.isFinite(event.durationMs) ? event.durationMs : null,
    error: event.error ? String(event.error) : null,
  });
  const level = phase === 'error' ? 'ERROR' : phase === 'cancel' ? 'WARN' : 'INFO';
  log(level, 'operation', record);
}

module.exports = {
  sanitizeLogString,
  sanitizeLogValue,
  formatLogArgs,
  operation,
  info(msg, ...args) {
    log('INFO', msg, ...args);
  },
  infow(msg, ...args) {
    log('INFO', msg, ...args);
  },
  warn(msg, ...args) {
    log('WARN', msg, ...args);
  },
  warnw(msg, ...args) {
    log('WARN', msg, ...args);
  },
  error(msg, ...args) {
    log('ERROR', msg, ...args);
  },
  errorw(msg, ...args) {
    log('ERROR', msg, ...args);
  },
};
