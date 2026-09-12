'use strict';

const SECRET_FIELD_WORDS = new Set([
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
]);

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
]);

function fieldKeyWords(key) {
  return String(key || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function isTokenBusinessField(words) {
  const compact = words.join('');
  if (!compact.includes('token')) return false;
  const hasSecretContext = [
    'access', 'api', 'auth', 'authorization', 'bearer', 'client', 'credential',
    'cookie', 'key', 'password', 'refresh', 'secret', 'session', 'sig',
    'signature', 'signed',
  ].some((word) => compact.includes(word));
  return !hasSecretContext && [...TOKEN_BUSINESS_WORDS].some((word) => compact.includes(word));
}

function isSensitiveFieldKey(key) {
  const words = fieldKeyWords(key);
  if (isTokenBusinessField(words)) return false;
  const compact = words.join('');
  if (compact === 'auth' || compact === 'authentication' || compact === 'xauth' || compact.endsWith('authentication')) return true;
  if (words.some((word) => word !== 'key' && word !== 'keys' && SECRET_FIELD_WORDS.has(word))) return true;
  if (compact === 'sig' || /authorization|cookie|credential|secret|signature|token|password/.test(compact)) return true;
  if (compact === 'key' || compact === 'keys') return true;
  return compact.includes('key') && [
    'access', 'api', 'auth', 'bearer', 'client', 'credential', 'encrypt',
    'private', 'secret', 'session', 'signing', 'xapi',
  ].some((context) => compact.includes(context));
}

module.exports = {
  fieldKeyWords,
  isSensitiveFieldKey,
};
