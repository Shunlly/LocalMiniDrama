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

  it('operation 记录统一生命周期字段并复用脱敏', () => {
    const record = logger.sanitizeLogValue({
      event: 'operation',
      operation: 'task_cancel',
      operationId: 'op-1',
      phase: 'error',
      api_key: 'sk-synthetic-placeholder',
    });
    assert.equal(record.event, 'operation');
    assert.equal(record.operation, 'task_cancel');
    assert.equal(record.operationId, 'op-1');
    assert.equal(record.phase, 'error');
    assert.equal(record.api_key, '[REDACTED]');
  });

  it('request-scoped logs reuse the same request_id without inventing a second field', () => {
    const lines = [];
    const originalLog = console.log;
    console.log = (msg) => { lines.push(String(msg)); };
    try {
      logger.runWithRequestId('trace-logger-1', () => {
        logger.info('scoped-event', { path: '/health' });
        logger.info('provider-event', { request_id: 'provider-task-9', path: '/health' });
        logger.operation({ operation: 'http_request', phase: 'error', code: 'INTERNAL_ERROR' });
      });
      logger.info('unscoped-event', { path: '/health' });
    } finally {
      console.log = originalLog;
    }

    const scoped = lines.find((line) => line.includes('scoped-event'));
    const provider = lines.find((line) => line.includes('provider-event'));
    const operation = lines.find((line) => line.includes('"event":"operation"'));
    const unscoped = lines.find((line) => line.includes('unscoped-event'));
    assert.match(String(scoped), /"request_id":"trace-logger-1"/);
    assert.doesNotMatch(String(scoped), /requestId/);
    assert.match(String(provider), /"request_id":"provider-task-9"/);
    assert.doesNotMatch(String(provider), /trace-logger-1/);
    assert.match(String(operation), /"request_id":"trace-logger-1"/);
    assert.match(String(operation), /"operationId":"http_request-/);
    assert.doesNotMatch(String(operation), /"operationId":"trace-logger-1"/);
    assert.equal(String(unscoped).includes('trace-logger-1'), false);
  });

  it('缺省 operationId 会自造，不回落 requestId，并单独保留 request_id', () => {
    const lines = [];
    const originalLog = console.log;
    console.log = (msg) => { lines.push(String(msg)); };
    try {
      logger.runWithRequestId('trace-logger-1', () => {
        logger.operation({ operation: 'provider_poll', request_id: 'provider-task-9', phase: 'error' });
      });
    } finally {
      console.log = originalLog;
    }
    const operation = lines.find((line) => line.includes('"event":"operation"'));
    assert.match(String(operation), /"operationId":"provider_poll-/);
    assert.doesNotMatch(String(operation), /"operationId":"trace-logger-1"/);
    assert.doesNotMatch(String(operation), /"operationId":"provider-task-9"/);
    assert.match(String(operation), /"request_id":"provider-task-9"/);
    assert.doesNotMatch(String(operation), /requestId/);
  });

  it('显式传入的 operationId 会保留，request_id 仍走 ALS', () => {
    const lines = [];
    const originalLog = console.log;
    console.log = (msg) => { lines.push(String(msg)); };
    try {
      logger.runWithRequestId('trace-logger-1', () => {
        logger.operation({ operation: 'http_request', operationId: 'op-explicit-1', phase: 'error' });
      });
    } finally {
      console.log = originalLog;
    }
    const operation = lines.find((line) => line.includes('"event":"operation"'));
    assert.match(String(operation), /"operationId":"op-explicit-1"/);
    assert.match(String(operation), /"request_id":"trace-logger-1"/);
    assert.doesNotMatch(String(operation), /"operationId":"trace-logger-1"/);
  });

  it('createOperationId 生成独立编号，不复用 requestId', () => {
    const first = logger.createOperationId('http_request');
    const second = logger.createOperationId('http_request');
    assert.match(first, /^http_request-/);
    assert.match(second, /^http_request-/);
    assert.notEqual(first, second);
    assert.notEqual(first, 'trace-logger-1');
  });

  it('unsafe request ids are not bound into the log context', () => {
    logger.runWithRequestId('../secret\r\nInjected: yes', () => {
      assert.equal(logger.getRequestId(), undefined);
    });
    assert.equal(logger.isSafeRequestId('trace-123:child'), true);
    assert.equal(logger.isSafeRequestId('../secret'), false);
  });
});
