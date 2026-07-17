'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  isAllowedExternalUrl,
  isAllowedRendererPermission,
  isTrustedAppUrl,
} = require('../scripts/url-security');

test('trusted app navigation is restricted to the exact loopback origin', () => {
  assert.equal(isTrustedAppUrl('http://127.0.0.1:5679/projects/1', 5679), true);
  assert.equal(isTrustedAppUrl('http://127.0.0.1:5679/#/settings', 5679), true);
  assert.equal(isTrustedAppUrl('http://localhost:5679/', 5679), false);
  assert.equal(isTrustedAppUrl('http://127.0.0.1:5680/', 5679), false);
  assert.equal(isTrustedAppUrl('https://127.0.0.1:5679/', 5679), false);
  assert.equal(isTrustedAppUrl('http://user@127.0.0.1:5679/', 5679), false);
  assert.equal(isTrustedAppUrl('not a url', 5679), false);
});

test('only credential-free HTTP(S) links may open in the system browser', () => {
  assert.equal(isAllowedExternalUrl('https://docs.example.com/guide'), true);
  assert.equal(isAllowedExternalUrl('http://docs.example.com/guide'), true);
  assert.equal(isAllowedExternalUrl('https://user@example.com/guide'), false);
  assert.equal(isAllowedExternalUrl('file:///C:/Windows/System32/calc.exe'), false);
  assert.equal(isAllowedExternalUrl('javascript:alert(1)'), false);
  assert.equal(isAllowedExternalUrl('data:text/html,hello'), false);
  assert.equal(isAllowedExternalUrl('not a url'), false);
});

test('only sanitized clipboard writes from the trusted main frame are allowed', () => {
  assert.equal(
    isAllowedRendererPermission('clipboard-sanitized-write', 'http://127.0.0.1:5679/editor', 5679, true),
    true
  );
  assert.equal(
    isAllowedRendererPermission('clipboard-read', 'http://127.0.0.1:5679/editor', 5679, true),
    false
  );
  assert.equal(
    isAllowedRendererPermission('media', 'http://127.0.0.1:5679/editor', 5679, true),
    false
  );
  assert.equal(
    isAllowedRendererPermission('clipboard-sanitized-write', 'https://example.com/', 5679, true),
    false
  );
  assert.equal(
    isAllowedRendererPermission('clipboard-sanitized-write', 'http://127.0.0.1:5679/editor', 5679, false),
    false
  );
});
