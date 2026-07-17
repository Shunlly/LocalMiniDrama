const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { CONTENT_SECURITY_POLICY, createAppCloseHandler, securityHeaders } = require('../src/app');

test('backend responses receive anti-framing, MIME, referrer, permissions, and CSP headers', () => {
  const headers = new Map();
  let nextCalled = false;
  securityHeaders({}, {
    setHeader(name, value) { headers.set(String(name).toLowerCase(), String(value)); },
  }, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(headers.get('x-frame-options'), 'DENY');
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
  assert.equal(headers.get('referrer-policy'), 'same-origin');
  assert.match(headers.get('permissions-policy'), /camera=\(\)/);
  assert.match(headers.get('permissions-policy'), /microphone=\(\)/);
  assert.equal(headers.get('x-permitted-cross-domain-policies'), 'none');
  assert.equal(headers.get('content-security-policy'), CONTENT_SECURITY_POLICY);
});

test('CSP blocks framing and plugins while allowing remote image and video rendering', () => {
  assert.match(CONTENT_SECURITY_POLICY, /frame-ancestors 'none'/);
  assert.match(CONTENT_SECURITY_POLICY, /object-src 'none'/);
  assert.match(CONTENT_SECURITY_POLICY, /img-src 'self' data: blob:/);
  assert.match(CONTENT_SECURITY_POLICY, /media-src 'self' data: blob:/);
  assert.doesNotMatch(CONTENT_SECURITY_POLICY, /(?:img|media)-src[^;]*https?:/);
  assert.match(CONTENT_SECURITY_POLICY, /(?:^|; )connect-src 'self'(?:;|$)/);
  assert.doesNotMatch(CONTENT_SECURITY_POLICY, /connect-src[^;]*(?:http:|https:|ws:|wss:)/);
  assert.doesNotMatch(CONTENT_SECURITY_POLICY, /default-src \*/);
});

test('nginx applies the same restrictive policy to assets despite add_header inheritance', () => {
  const nginx = fs.readFileSync(path.join(__dirname, '../../frontweb/nginx.conf'), 'utf8');
  const assetLocation = nginx.match(/location \/assets\/ \{([\s\S]*?)\n    \}/)?.[1] || '';
  for (const header of [
    'Content-Security-Policy',
    'X-Frame-Options',
    'X-Content-Type-Options',
    'Referrer-Policy',
    'Permissions-Policy',
    'X-Permitted-Cross-Domain-Policies',
  ]) {
    assert.match(assetLocation, new RegExp(`add_header ${header.replaceAll('-', '\\-')} `));
  }
  assert.match(nginx, /connect-src 'self'/);
  assert.doesNotMatch(nginx, /connect-src[^;\"]*(?:http:|https:|ws:|wss:)/);
});

test('application close handler closes the database and releases maintenance exactly once', () => {
  const calls = [];
  const close = createAppCloseHandler(
    { release() { calls.push('lock'); } },
    () => calls.push('database')
  );
  assert.equal(close(), true);
  assert.equal(close(), false);
  assert.deepEqual(calls, ['database', 'lock']);
});
