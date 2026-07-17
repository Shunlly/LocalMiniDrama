'use strict';

function parseUrl(value) {
  try {
    return new URL(value);
  } catch (_) {
    return null;
  }
}

function hasCredentials(url) {
  return Boolean(url.username || url.password);
}

function isTrustedAppUrl(value, port) {
  const url = parseUrl(value);
  return Boolean(
    url &&
      url.protocol === 'http:' &&
      url.hostname === '127.0.0.1' &&
      url.port === String(port) &&
      !hasCredentials(url)
  );
}

function isAllowedExternalUrl(value) {
  const url = parseUrl(value);
  return Boolean(
    url &&
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      !hasCredentials(url)
  );
}

function isAllowedRendererPermission(permission, value, port, isMainFrame) {
  return (
    permission === 'clipboard-sanitized-write' &&
    isMainFrame === true &&
    isTrustedAppUrl(value, port)
  );
}

module.exports = { isAllowedExternalUrl, isAllowedRendererPermission, isTrustedAppUrl };
