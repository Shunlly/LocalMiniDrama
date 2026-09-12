'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  isTimeoutLikeError,
  isCancelLikeError,
  isUserFacingAbort,
  toUserFacingProcessError,
} = require('../src/services/providerErrorSanitizer');
const aiConfigRoutes = require('../src/routes/aiConfig');
const aiConfigService = require('../src/services/aiConfigService');
const { logCaughtRouteError } = require('../src/routes/serviceFailure');

function mockResponse() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    writableEnded: false,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.writableEnded = true; return this; },
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = String(value); return this; },
    getHeader(name) { return this.headers[String(name).toLowerCase()]; },
  };
}

function capturingLog() {
  const events = [];
  return {
    events,
    error(message, metadata) { events.push({ level: 'error', message, metadata }); },
    warn(message, metadata) { events.push({ level: 'warn', message, metadata }); },
    operation(event) { events.push({ level: 'operation', event }); },
  };
}

describe('cancel-timeout-log', () => {
  it('timeout-chinese', () => {
    assert.equal(isTimeoutLikeError(new Error('\u8fde\u63a5\u6d4b\u8bd5\u8d85\u65f6')), true);
    assert.equal(isTimeoutLikeError(new Error('\u8fde\u63a5\u6d4b\u8bd5\u5df2\u53d6\u6d88')), false);
    const timeoutAbort = Object.assign(new Error('The operation was aborted.'), {
      name: 'AbortError',
      isTimeout: true,
      code: 'ETIMEDOUT',
    });
    assert.equal(isTimeoutLikeError(timeoutAbort), true);
    assert.equal(isCancelLikeError(timeoutAbort), false);
    assert.equal(isUserFacingAbort(timeoutAbort), false);
    assert.match(toUserFacingProcessError(timeoutAbort, 'fail'), /\u8d85\u65f6/);
    assert.doesNotMatch(toUserFacingProcessError(timeoutAbort, 'fail'), /\u53d6\u6d88/);
  });

  it('timeout-signal', () => {
    const timeout = Object.assign(new Error('\u8bf7\u6c42\u8d85\u65f6'), { name: 'TimeoutError', isTimeout: true, code: 'ETIMEDOUT' });
    const controller = new AbortController();
    controller.abort(timeout);
    assert.equal(isUserFacingAbort(null, controller.signal), false);
    const cancelled = new AbortController();
    cancelled.abort();
    assert.equal(isUserFacingAbort(null, cancelled.signal), true);
  });

  it('connection-timeout-abort', async () => {
    const original = aiConfigService.testConnection;
    aiConfigService.testConnection = async () => {
      throw Object.assign(new Error('The operation was aborted.'), {
        name: 'AbortError',
        code: 'ECONNABORTED',
        isTimeout: true,
      });
    };
    const log = capturingLog();
    try {
      const res = mockResponse();
      await aiConfigRoutes({}, log, {}).testConnection({
        body: {
          provider: 'openai',
          service_type: 'text',
          base_url: 'https://provider.example.com/v1',
          api_key: 'sk-timeout-route-secret-123456',
        },
      }, res);
      assert.equal(res.statusCode, 400);
      assert.match(res.body.error.message, /\u8d85\u65f6/);
      assert.doesNotMatch(res.body.error.message, /\u53d6\u6d88/);
      const serialized = JSON.stringify({ body: res.body, events: log.events });
      assert.doesNotMatch(serialized, /sk-timeout-route-secret-123456/);
      const op = log.events.find((item) => item.level === 'operation');
      assert.ok(op);
      assert.notEqual(op.event.phase, 'cancel');
      assert.notEqual(op.event.phase, 'success');
    } finally {
      aiConfigService.testConnection = original;
    }
  });

  it('connection-cancel-phase', async () => {
    const original = aiConfigService.testConnection;
    aiConfigService.testConnection = async () => {
      throw Object.assign(new Error('\u8fde\u63a5\u6d4b\u8bd5\u5df2\u53d6\u6d88'), {
        name: 'AbortError',
        code: 'ERR_CANCELED',
      });
    };
    const log = capturingLog();
    try {
      const res = mockResponse();
      await aiConfigRoutes({}, log, {}).testConnection({
        body: {
          provider: 'openai',
          service_type: 'text',
          base_url: 'https://provider.example.com/v1',
          api_key: 'sk-cancel-route-secret-123456',
        },
      }, res);
      assert.match(res.body.error.message, /\u53d6\u6d88/);
      assert.doesNotMatch(res.body.error.message, /\u8d85\u65f6|\u6210\u529f/);
      const op = log.events.find((item) => item.level === 'operation');
      assert.equal(op.event.phase, 'cancel');
      assert.notEqual(op.event.phase, 'success');
      assert.doesNotMatch(JSON.stringify(log.events), /sk-cancel-route-secret-123456/);
    } finally {
      aiConfigService.testConnection = original;
    }
  });

  it('connection-header-secret', async () => {
    const original = aiConfigService.testConnection;
    const headerSecret = 'hdr-synthetic-token-987654';
    aiConfigService.testConnection = async () => {
      throw new Error('provider rejected ' + headerSecret);
    };
    const log = capturingLog();
    try {
      const res = mockResponse();
      await aiConfigRoutes({}, log, {}).testConnection({
        body: {
          provider: 'openai',
          service_type: 'text',
          base_url: 'https://provider.example.com/v1',
          api_key: 'sk-header-route-secret-123456',
          settings: { headers: { 'X-Custom-Auth': headerSecret } },
        },
      }, res);
      const serialized = JSON.stringify({ body: res.body, events: log.events });
      assert.doesNotMatch(serialized, /hdr-synthetic-token-987654/);
      assert.doesNotMatch(serialized, /sk-header-route-secret-123456/);
      assert.match(res.body.error.message, /[\u4e00-\u9fff]/);
    } finally {
      aiConfigService.testConnection = original;
    }
  });

  it('discover-timeout-abort', async () => {
    const original = aiConfigService.discoverModels;
    const secret = 'sk-discover-timeout-route-123456';
    aiConfigService.discoverModels = async () => {
      throw Object.assign(new Error('timeout after using ' + secret), {
        name: 'AbortError',
        code: 'ETIMEDOUT',
        isTimeout: true,
      });
    };
    const log = capturingLog();
    try {
      const res = mockResponse();
      await aiConfigRoutes({}, log, {}).discoverModels({
        body: {
          provider: 'openai_compatible',
          service_type: 'text',
          base_url: 'https://provider.example.com/v1',
          api_key: secret,
        },
      }, res);
      assert.match(res.body.error.message, /\u8d85\u65f6/);
      assert.doesNotMatch(res.body.error.message, /\u53d6\u6d88/);
      const serialized = JSON.stringify({ body: res.body, events: log.events });
      assert.doesNotMatch(serialized, /sk-discover-timeout-route-123456/);
    } finally {
      aiConfigService.discoverModels = original;
    }
  });

  it('log-cancel-phase', () => {
    const log = capturingLog();
    const err = Object.assign(new Error('\u64cd\u4f5c\u5df2\u53d6\u6d88'), {
      name: 'AbortError',
      code: 'OPERATION_CANCELLED',
    });
    logCaughtRouteError(log, 'demo cancel', err, { fallback: '\u64cd\u4f5c\u5df2\u53d6\u6d88' });
    const op = log.events.find((item) => item.level === 'operation');
    assert.equal(op.event.phase, 'cancel');
    assert.notEqual(op.event.phase, 'success');
    assert.notEqual(op.event.phase, 'error');
  });
});
