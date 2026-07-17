'use strict';

const http = require('http');
const https = require('https');
const net = require('net');
const {
  UnsafeMediaReferenceError,
  createPinnedDnsLookup,
  isGloballyRoutableIp,
  validatePublicHttpUrl,
} = require('./uploadService');

const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const SENSITIVE_REDIRECT_HEADERS = new Set([
  'authorization',
  'cookie',
  'cookie2',
  'proxy-authorization',
]);
const SENSITIVE_REDIRECT_OPTION_NAMES = [
  'auth',
  'credentials',
  'cookieJar',
  'proxyAuth',
  'proxyAuthorization',
];

function boundedPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function boundedNonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function abortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

function normalizeHeaders(value) {
  const result = {};
  const headers = new Headers(value || {});
  for (const [name, headerValue] of headers.entries()) result[name] = headerValue;
  return result;
}

function hasHeader(headers, expected) {
  const normalized = String(expected).toLowerCase();
  return Object.keys(headers).some((name) => name.toLowerCase() === normalized);
}

function deleteHeader(headers, expected) {
  const normalized = String(expected).toLowerCase();
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase() === normalized) delete headers[name];
  }
}

function isSensitiveRedirectHeader(name) {
  const normalized = String(name || '').trim().toLowerCase();
  if (SENSITIVE_REDIRECT_HEADERS.has(normalized)) return true;
  return /(?:^|-)(?:auth(?:entication)?|api-?key|access-?key|client-?(?:key|secret)|private-?key|secret|token|credential|password|signature|signed)(?:-|$)/i.test(normalized);
}

function stripCrossOriginCredentials(options) {
  const next = { ...options, headers: normalizeHeaders(options.headers) };
  for (const header of Object.keys(next.headers)) {
    if (isSensitiveRedirectHeader(header)) delete next.headers[header];
  }
  for (const name of SENSITIVE_REDIRECT_OPTION_NAMES) delete next[name];
  return next;
}

function originMatches(url, origins) {
  if (!Array.isArray(origins) || origins.length === 0) return false;
  return origins.some((value) => {
    try {
      return new URL(value).origin === url.origin;
    } catch (_) {
      return false;
    }
  });
}

async function validateHttpRequestTarget(url, networkOptions = {}) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch (_) {
    throw new UnsafeMediaReferenceError('Remote URL is invalid.');
  }

  const requireHttpsForPublic = networkOptions.requireHttpsForPublic === true;
  const explicitPrivateOrigin = originMatches(parsed, networkOptions.allowPrivateOrigins);
  if (requireHttpsForPublic && parsed.protocol === 'http:' && !explicitPrivateOrigin) {
    throw new UnsafeMediaReferenceError('Public provider endpoints must use HTTPS.');
  }

  const validated = await validatePublicHttpUrl(parsed, {
    trustedOrigins: networkOptions.trustedOrigins,
    allowPrivateOrigins: networkOptions.allowPrivateOrigins,
    lookup: networkOptions.lookup,
  });
  if (requireHttpsForPublic && validated.parsed.protocol === 'http:') {
    const privateOnly = validated.addresses.every((record) => !isGloballyRoutableIp(record.address));
    if (!explicitPrivateOrigin || !privateOnly) {
      throw new UnsafeMediaReferenceError('HTTP provider endpoints must remain on an explicitly allowed private origin.');
    }
  }
  return validated;
}

async function serializeBody(body, headers) {
  if (body == null) return null;
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (body instanceof URLSearchParams) {
    if (!hasHeader(headers, 'content-type')) {
      headers['content-type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
    }
    return Buffer.from(body.toString());
  }
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    if (body.type && !hasHeader(headers, 'content-type')) headers['content-type'] = body.type;
    return Buffer.from(await body.arrayBuffer());
  }
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const encoded = new Response(body);
    const contentType = encoded.headers.get('content-type');
    if (contentType && !hasHeader(headers, 'content-type')) headers['content-type'] = contentType;
    return Buffer.from(await encoded.arrayBuffer());
  }
  throw new TypeError('Unsupported request body type for secure HTTP fetch.');
}

function responseHeaders(rawHeaders) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(rawHeaders || {})) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value != null) {
      headers.append(name, String(value));
    }
  }
  return headers;
}

function toResponse(result, url, redirected) {
  const status = Number(result.statusCode || 0);
  const body = [204, 205, 304].includes(status) ? null : result.buffer;
  const response = new Response(body, {
    status,
    statusText: result.statusMessage || '',
    headers: responseHeaders(result.headers),
  });
  Object.defineProperties(response, {
    url: { configurable: true, value: url },
    redirected: { configurable: true, value: redirected },
  });
  return response;
}

async function requestOnce(url, options, networkOptions) {
  const validated = await validateHttpRequestTarget(url, networkOptions);
  const parsed = validated.parsed;
  const selected = validated.addresses[0];
  const headers = normalizeHeaders(options.headers);
  const body = await serializeBody(options.body, headers);
  if (body && !hasHeader(headers, 'content-length')) headers['content-length'] = String(body.length);

  const timeoutMs = boundedPositiveInteger(networkOptions.timeoutMs, 30000);
  const maxBytes = boundedPositiveInteger(networkOptions.maxBytes, DEFAULT_MAX_RESPONSE_BYTES);
  const method = String(options.method || (body ? 'POST' : 'GET')).toUpperCase();
  const signal = options.signal;
  if (signal?.aborted) throw abortError(signal);

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    let request = null;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      callback(value);
    };
    const fail = (error) => finish(reject, error);
    const onAbort = () => request?.destroy(abortError(signal));
    const transport = parsed.protocol === 'https:' ? https : http;

    request = transport.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: `${parsed.pathname}${parsed.search}`,
      method,
      headers,
      servername: net.isIP(parsed.hostname) ? undefined : parsed.hostname,
      lookup: createPinnedDnsLookup(selected),
    }, (res) => {
      const contentLength = Number(res.headers['content-length'] || 0);
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        const error = new UnsafeMediaReferenceError('Remote response exceeds the size limit.');
        res.destroy(error);
        fail(error);
        return;
      }
      const chunks = [];
      let bytes = 0;
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          const error = new UnsafeMediaReferenceError('Remote response exceeds the size limit.');
          res.destroy(error);
          fail(error);
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => finish(resolve, {
        statusCode: Number(res.statusCode || 0),
        statusMessage: res.statusMessage || '',
        headers: res.headers,
        buffer: Buffer.concat(chunks, bytes),
      }));
      res.on('error', fail);
    });

    request.on('error', fail);
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      const error = new Error(`Secure HTTP request timed out after ${timeoutMs}ms.`);
      error.name = 'TimeoutError';
      request.destroy(error);
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    request.end(body || undefined);
  });
}

function redirectRequestOptions(options, statusCode, fromUrl, toUrl) {
  const crossOrigin = new URL(fromUrl).origin !== new URL(toUrl).origin;
  const next = crossOrigin
    ? stripCrossOriginCredentials(options)
    : { ...options, headers: normalizeHeaders(options.headers) };
  const method = String(next.method || (next.body == null ? 'GET' : 'POST')).toUpperCase();
  if (statusCode === 303 || ((statusCode === 301 || statusCode === 302) && method === 'POST')) {
    next.method = 'GET';
    next.body = undefined;
    deleteHeader(next.headers, 'content-length');
    deleteHeader(next.headers, 'content-type');
  }
  return next;
}

async function secureHttpFetch(url, options = {}, networkOptions = {}) {
  let currentUrl = String(url);
  let currentOptions = { ...options };
  const redirectMode = options.redirect || 'follow';
  const maxRedirects = boundedNonNegativeInteger(networkOptions.maxRedirects, DEFAULT_MAX_REDIRECTS);

  for (let redirectCount = 0; ; redirectCount += 1) {
    const result = await requestOnce(currentUrl, currentOptions, networkOptions);
    if (!REDIRECT_STATUSES.has(result.statusCode)) {
      return toResponse(result, currentUrl, redirectCount > 0);
    }

    const response = toResponse(result, currentUrl, redirectCount > 0);
    if (redirectMode === 'manual') return response;
    if (redirectMode === 'error') throw new TypeError('Redirects are not allowed for this request.');
    const location = response.headers.get('location');
    if (!location) return response;
    if (redirectCount >= maxRedirects) throw new TypeError('Too many redirects.');

    const nextUrl = new URL(location, currentUrl).toString();
    if (new URL(currentUrl).protocol === 'https:' && new URL(nextUrl).protocol !== 'https:') {
      throw new UnsafeMediaReferenceError('HTTPS requests cannot redirect to HTTP.');
    }
    const crossOrigin = new URL(currentUrl).origin !== new URL(nextUrl).origin;
    const currentMethod = String(currentOptions.method || (currentOptions.body == null ? 'GET' : 'POST')).toUpperCase();
    if (crossOrigin && !['GET', 'HEAD'].includes(currentMethod)) {
      throw new UnsafeMediaReferenceError('Cross-origin redirects cannot replay request bodies.');
    }
    currentOptions = redirectRequestOptions(currentOptions, result.statusCode, currentUrl, nextUrl);
    currentUrl = nextUrl;
  }
}

module.exports = {
  DEFAULT_MAX_RESPONSE_BYTES,
  isSensitiveRedirectHeader,
  redirectRequestOptions,
  secureHttpFetch,
  validateHttpRequestTarget,
};
