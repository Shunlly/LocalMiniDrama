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

test('CSP blocks framing and plugins while allowing only reviewed Wikimedia previews', () => {
  assert.match(CONTENT_SECURITY_POLICY, /frame-ancestors 'none'/);
  assert.match(CONTENT_SECURITY_POLICY, /object-src 'none'/);
  assert.equal(CONTENT_SECURITY_POLICY.includes("img-src 'self' data: blob: https://upload.wikimedia.org"), true);
  assert.equal(CONTENT_SECURITY_POLICY.includes("media-src 'self' data: blob: https://upload.wikimedia.org"), true);
  const reviewedOrigin = 'https://upload.wikimedia.org';
  assert.equal(CONTENT_SECURITY_POLICY.split(reviewedOrigin).length - 1, 2);
  assert.equal(CONTENT_SECURITY_POLICY.replaceAll(reviewedOrigin, '').includes('https://'), false);
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
  assert.equal(nginx.includes("img-src 'self' data: blob: https://upload.wikimedia.org"), true);
  assert.equal(nginx.includes("media-src 'self' data: blob: https://upload.wikimedia.org"), true);
  assert.doesNotMatch(nginx, /connect-src[^;\"]*(?:http:|https:|ws:|wss:)/);
});

test('应用关闭先停止周期资源，再关闭数据库并且只释放一次维护锁', () => {
  const calls = [];
  const close = createAppCloseHandler(
    { release() { calls.push('lock'); } },
    () => calls.push('database'),
    [() => calls.push('timer')]
  );
  assert.equal(close(), true);
  assert.equal(close(), false);
  assert.deepEqual(calls, ['timer', 'database', 'lock']);
});

test('周期资源关闭失败时仍会关闭数据库并释放维护锁', () => {
  const calls = [];
  const timerError = new Error('timer close failed');
  const close = createAppCloseHandler(
    { release() { calls.push('lock'); } },
    () => calls.push('database'),
    [
      () => { calls.push('timer-1'); throw timerError; },
      () => calls.push('timer-2'),
    ]
  );

  assert.throws(() => close(), (error) => error === timerError);
  assert.equal(close(), false);
  assert.deepEqual(calls, ['timer-1', 'timer-2', 'database', 'lock']);
});
