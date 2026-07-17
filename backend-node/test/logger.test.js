const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const logger = require('../src/logger');

describe('logger redaction', () => {
  it('redacts structured credentials, prompts, response bodies, and signed URLs', () => {
    const value = logger.sanitizeLogValue({
      authorization: 'Bearer synthetic-bearer-placeholder',
      auth_header_prefix: 'Basic c3ludGhldGljOnBsYWNlaG9sZGVy',
      api_key: ['sk', 'synthetic-placeholder-123456'].join('-'),
      headers: {
        'Proxy-Authorization': 'Token synthetic-proxy-placeholder',
        'X-API-Key': 'synthetic-api-key-placeholder',
        Cookie: 'session=synthetic-cookie-placeholder',
        'Set-Cookie': 'sid=synthetic-set-cookie-placeholder; Path=/; HttpOnly',
      },
      prompt: 'private screenplay prompt',
      effectivePrompt: 'private camel case prompt',
      text_preview: 'private generated text',
      output_json: '{"private":"provider output"}',
      raw_preview: '{"prompt":"private response"}',
      image_url: 'https://synthetic-user:synthetic-pass@cdn.example.test/frame.png?X-Amz-Signature=synthetic-signature-placeholder&width=1280',
      prompt_len: 25,
      body_keys: ['model', 'prompt'],
    });
    const serialized = JSON.stringify(value);

    assert.doesNotMatch(
      serialized,
      /synthetic-bearer|c3ludGhldGljOnBsYWNlaG9sZGVy|sk-synthetic|synthetic-proxy|synthetic-api-key|synthetic-cookie|synthetic-set-cookie|synthetic-user|synthetic-pass|synthetic-signature|private screenplay|private camel|private generated|provider output|private response/
    );
    assert.match(serialized, /https:\/\/cdn\.example\.test\/frame\.png/);
    assert.equal(value.headers.Authorization, undefined);
    assert.equal(value.headers['Proxy-Authorization'], '[REDACTED]');
    assert.equal(value.headers['X-API-Key'], '[REDACTED]');
    assert.equal(value.headers.Cookie, '[REDACTED]');
    assert.equal(value.headers['Set-Cookie'], '[REDACTED]');
    assert.equal(value.prompt_len, 25);
    assert.deepEqual(value.body_keys, ['model', 'prompt']);
  });

  it('redacts credential headers, JWTs, and credentials in every URL form', () => {
    const jwt = [
      'eyJhbGciOiJIUzI1NiJ9',
      'eyJzdWIiOiJzeW50aGV0aWMifQ',
      'syntheticSignaturePlaceholder',
    ].join('.');
    const message = logger.sanitizeLogString([
      'Authorization: Bearer synthetic-bearer-placeholder',
      'Authorization=Basic c3ludGhldGljOnBsYWNlaG9sZGVy',
      'Authorization: Token token="synthetic-token-placeholder"',
      'Authorization: API-Key synthetic-auth-api-key-placeholder',
      'X-API-Key: synthetic-header-api-key-placeholder',
      'Cookie: session=synthetic-cookie-placeholder; theme=dark',
      'Set-Cookie: sid=synthetic-set-cookie-placeholder; Path=/; HttpOnly',
      `standalone jwt=${jwt}`,
      'absolute=https://synthetic-user:synthetic-pass@example.test/path?access_token=synthetic-access-placeholder&safe=visible',
      'protocol-relative=//synthetic-user:synthetic-pass@cdn.example.test/asset?X-Amz-Signature=synthetic-signature-placeholder&width=100',
      'relative=../callback?api%5Fkey=synthetic-query-placeholder&page=2',
      'query-only=?refresh_token=synthetic-refresh-placeholder&next=/projects',
    ].join('\n'));

    for (const marker of [
      'synthetic-bearer-placeholder',
      'c3ludGhldGljOnBsYWNlaG9sZGVy',
      'synthetic-token-placeholder',
      'synthetic-auth-api-key-placeholder',
      'synthetic-header-api-key-placeholder',
      'synthetic-cookie-placeholder',
      'synthetic-set-cookie-placeholder',
      jwt,
      'synthetic-user',
      'synthetic-pass',
      'synthetic-access-placeholder',
      'synthetic-signature-placeholder',
      'synthetic-query-placeholder',
      'synthetic-refresh-placeholder',
    ]) {
      assert.equal(message.includes(marker), false, `log leaked ${marker}`);
    }
    assert.match(message, /https:\/\/example\.test\/path\?access_token=\[REDACTED\]/);
    assert.match(message, /\/\/cdn\.example\.test\/asset\?X-Amz-Signature=\[REDACTED\]/);
    assert.match(message, /\.\.\/callback\?api%5Fkey=\[REDACTED\]&page=2/);
    assert.match(message, /\?refresh_token=\[REDACTED\]&next=\/projects/);
  });

  it('bounds oversized metadata after sanitization', () => {
    const message = logger.sanitizeLogString(
      `request Bearer synthetic-standalone-placeholder ${[
        'sk',
        'synthetic-placeholder-654321',
      ].join('-')}`
    );
    assert.doesNotMatch(message, /synthetic-standalone|sk-synthetic/);

    const formatted = logger.formatLogArgs([{ safe: 'x'.repeat(20000) }]);
    assert.ok(formatted.length < 8300);
    assert.match(formatted, /truncated/);
  });
});
