const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createErrorHandler,
  createNotFoundHandler,
  createProductionErrorResponseSanitizer,
  initializeWithMaintenanceGuard,
  requestContext,
} = require('../src/app');
const logger = require('../src/logger');
const response = require('../src/response');

function responseRecorder() {
  return {
    headers: {},
    headersSent: false,
    statusCode: null,
    body: null,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = String(value); },
    getHeader(name) { return this.headers[String(name).toLowerCase()]; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
  };
}

test('request context accepts only bounded safe correlation ids', () => {
  const accepted = responseRecorder();
  const acceptedReq = { headers: { 'x-request-id': 'trace-123:child' } };
  requestContext(acceptedReq, accepted, () => {});
  assert.equal(acceptedReq.requestId, 'trace-123:child');
  assert.equal(accepted.headers['x-request-id'], 'trace-123:child');

  const replaced = responseRecorder();
  const replacedReq = { headers: { 'x-request-id': '../secret\r\nInjected: yes' } };
  requestContext(replacedReq, replaced, () => {});
  assert.match(replacedReq.requestId, /^[a-f0-9-]{36}$/);
  assert.equal(replaced.headers['x-request-id'], replacedReq.requestId);
});

test('app initialization releases its maintenance guard when startup fails', () => {
  let releases = 0;
  let databaseCloses = 0;
  const startupError = new Error('database startup failed');
  assert.throws(
    () => initializeWithMaintenanceGuard({ release() { releases += 1; } }, () => {
      throw startupError;
    }, () => { databaseCloses += 1; }),
    (error) => error === startupError
  );
  assert.equal(databaseCloses, 1);
  assert.equal(releases, 1);
});

test('app initialization preserves the startup error when cleanup also fails', () => {
  const startupError = new Error('startup root cause');
  let releases = 0;
  assert.throws(
    () => initializeWithMaintenanceGuard(
      { release() { releases += 1; throw new Error('lock release failed'); } },
      () => { throw startupError; },
      () => { throw new Error('database close failed'); }
    ),
    (error) => error === startupError
  );
  assert.equal(releases, 1);
});

test('production 500 response hides details and returns its request id', () => {
  const entries = [];
  const operations = [];
  const handler = createErrorHandler({
    errorw(message, fields) { entries.push({ message, fields }); },
    operation(event) { operations.push(event); },
  }, { production: true });
  const res = responseRecorder();
  const req = { requestId: 'req-500', method: 'GET', path: '/api/v1/fail' };
  handler(new Error('failed at C:\\private\\database.sqlite with upstream token'), req, res, () => {});

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  assert.equal(res.body.error.message, '服务器内部错误');
  assert.equal(res.body.request_id, 'req-500');
  assert.equal(res.body.error.request_id, 'req-500');
  assert.equal(res.headers['x-request-id'], 'req-500');
  assert.doesNotMatch(JSON.stringify(res.body), /private|database\.sqlite|upstream token/);
  assert.match(entries[0].fields.error, /database\.sqlite/);
  assert.equal(entries[0].fields.request_id, 'req-500');
  assert.equal(entries[0].fields.category, 'http_5xx');
  assert.equal(operations[0].operation, 'http_request');
  assert.equal(operations[0].phase, 'error');
  assert.equal(operations[0].code, 'INTERNAL_ERROR');
  assert.equal(operations[0].category, 'http_5xx');
  assert.equal(operations[0].request_id, 'req-500');
  assert.match(String(operations[0].operationId || ''), /^http_request-/);
  assert.notEqual(operations[0].operationId, 'req-500');
});

test('expected client errors retain actionable messages', () => {
  const handler = createErrorHandler({ errorw() {} }, { production: true });
  const english = responseRecorder();
  const error = new Error('reference image URL must be public');
  error.code = 'BAD_REQUEST';
  handler(error, { requestId: 'req-400', method: 'POST', path: '/api/v1/videos' }, english, () => {});

  assert.equal(english.statusCode, 400);
  assert.equal(english.body.error.code, 'BAD_REQUEST');
  assert.equal(english.body.error.message, '请求无效');
  assert.doesNotMatch(english.body.error.message, /reference image URL/i);
  assert.equal(english.body.error.request_id, 'req-400');
  assert.equal(english.body.request_id, 'req-400');

  const chinese = responseRecorder();
  const trusted = new Error('参考图必须是公网地址');
  trusted.code = 'BAD_REQUEST';
  handler(trusted, { requestId: 'req-400-zh', method: 'POST', path: '/api/v1/videos' }, chinese, () => {});
  assert.equal(chinese.body.error.message, '参考图必须是公网地址');
});

test('response internalError sanitizes production messages and preserves development details', (t) => {
  const originalNodeEnv = process.env.NODE_ENV;
  t.after(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  process.env.NODE_ENV = 'production';
  const productionResponse = responseRecorder();
  productionResponse.setHeader('X-Request-Id', 'req-response-500');
  response.internalError(productionResponse, 'C:\\private\\database.sqlite failed with upstream token');

  assert.equal(productionResponse.statusCode, 500);
  assert.equal(productionResponse.headers['x-request-id'], 'req-response-500');
  assert.equal(productionResponse.body.error.code, 'INTERNAL_ERROR');
  assert.equal(productionResponse.body.error.message, '服务器内部错误');
  assert.equal(productionResponse.body.error.request_id, 'req-response-500');
  assert.equal(productionResponse.body.request_id, 'req-response-500');
  assert.doesNotMatch(JSON.stringify(productionResponse.body), /private|database\.sqlite|upstream token/);

  process.env.NODE_ENV = 'development';
  const developmentResponse = responseRecorder();
  response.internalError(developmentResponse, 'actionable development detail');
  assert.equal(developmentResponse.body.error.message, 'actionable development detail');
  assert.match(developmentResponse.headers['x-request-id'], /^[a-f0-9-]{36}$/);
  assert.equal(
    developmentResponse.body.request_id,
    developmentResponse.headers['x-request-id']
  );
});

test('production sanitizer hides route-handled 500 messages but preserves client errors', () => {
  const middleware = createProductionErrorResponseSanitizer({ production: true });
  const response500 = responseRecorder();
  response500.statusCode = 500;
  middleware({ requestId: 'req-route-500' }, response500, () => {});
  response500.json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'C:\\private\\db.sqlite failed' } });
  assert.equal(response500.body.error.message, '服务器内部错误');
  assert.equal(response500.body.request_id, 'req-route-500');
  assert.doesNotMatch(JSON.stringify(response500.body), /private|db\.sqlite/);

  const response400 = responseRecorder();
  response400.statusCode = 400;
  middleware({ requestId: 'req-route-400' }, response400, () => {});
  response400.json({ success: false, error: { code: 'BAD_REQUEST', message: 'Select a valid model' } });
  assert.equal(response400.body.error.message, 'Select a valid model');
  assert.equal(response400.body.request_id, 'req-route-400');
  assert.equal(response400.body.error.request_id, 'req-route-400');
});

test('unknown API routes use the standard error envelope', () => {
  const handler = createNotFoundHandler();
  const res = responseRecorder();
  handler({ path: '/api/v1/does-not-exist' }, res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.success, false);
  assert.equal(res.body.error.code, 'NOT_FOUND');
  assert.equal(res.body.error.message, '接口不存在');
  assert.equal(res.body.error.request_id, res.body.request_id);
  assert.equal(res.headers['x-request-id'], res.body.request_id);
  assert.match(res.body.request_id, /^[A-Za-z0-9._:-]{1,128}$/);
  assert.match(res.body.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test('user-facing errors strip stack frames even in development', () => {
  const entries = [];
  const handler = createErrorHandler({
    errorw(message, fields) { entries.push({ message, fields }); },
    operation() {},
  }, { production: false });
  const res = responseRecorder();
  const error = new Error('failed to open file\n    at Database.open (C:\\private\\database.sqlite:1:1)');
  handler(error, { requestId: 'req-dev-500', method: 'GET', path: '/api/v1/fail' }, res, () => {});

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error.message, 'failed to open file');
  assert.equal(res.body.error.stack, undefined);
  assert.doesNotMatch(JSON.stringify(res.body), /private|database\.sqlite|at Database\.open/);
  assert.match(entries[0].fields.stack, /database\.sqlite/);
  assert.equal(entries[0].fields.category, 'http_5xx');
});

test('timeout failures keep generic production copy and classify logs as timeout', () => {
  const entries = [];
  const operations = [];
  const handler = createErrorHandler({
    errorw(message, fields) { entries.push({ message, fields }); },
    operation(event) { operations.push(event); },
  }, { production: true });
  const res = responseRecorder();
  const error = new Error('connect ETIMEDOUT 10.0.0.1');
  error.code = 'ETIMEDOUT';
  handler(error, { requestId: 'req-timeout', method: 'GET', path: '/api/v1/ai' }, res, () => {});

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  assert.equal(res.body.error.message, '请求超时，请稍后重试');
  assert.equal(res.body.request_id, 'req-timeout');
  assert.equal(res.body.error.request_id, 'req-timeout');
  assert.equal(res.headers['x-request-id'], 'req-timeout');
  assert.equal(entries[0].fields.category, 'timeout');
  assert.equal(operations[0].category, 'timeout');
  assert.equal(operations[0].phase, 'error');
  assert.notEqual(operations[0].phase, 'cancel');
  assert.equal(operations[0].request_id, 'req-timeout');
  assert.notEqual(operations[0].operationId, 'req-timeout');
  assert.doesNotMatch(JSON.stringify(res.body), /ETIMEDOUT|10\.0\.0\.1|connect /);
});

test('cancel failures classify logs as cancel without exposing stack', () => {
  const entries = [];
  const operations = [];
  const handler = createErrorHandler({
    errorw(message, fields) { entries.push({ message, fields }); },
    operation(event) { operations.push(event); },
  }, { production: true });
  const res = responseRecorder();
  const error = new Error('aborted\n    at abort (internal.js:1:1)');
  error.code = 'ERR_CANCELED';
  error.name = 'AbortError';
  handler(error, { requestId: 'req-cancel', method: 'POST', path: '/api/v1/tasks' }, res, () => {});

  assert.equal(res.body.error.message, '操作已取消');
  assert.equal(res.body.error.stack, undefined);
  assert.equal(res.body.request_id, 'req-cancel');
  assert.equal(res.body.error.request_id, 'req-cancel');
  assert.equal(entries[0].fields.category, 'cancel');
  assert.equal(operations[0].category, 'cancel');
  assert.equal(operations[0].phase, 'cancel');
  assert.notEqual(operations[0].category, 'timeout');
  assert.equal(operations[0].request_id, 'req-cancel');
  assert.notEqual(operations[0].operationId, 'req-cancel');
  assert.doesNotMatch(JSON.stringify(res.body), /internal\.js|aborted/);
});

test('error sanitizer strips stack from development error envelopes', () => {
  const middleware = createProductionErrorResponseSanitizer({ production: false });
  const response500 = responseRecorder();
  response500.statusCode = 500;
  middleware({ requestId: 'req-dev-stack' }, response500, () => {});
  response500.json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'boom\n    at open (C:\\private\\db.sqlite:1:1)',
      stack: 'Error: boom\n    at open (C:\\private\\db.sqlite:1:1)',
    },
  });
  assert.equal(response500.body.error.message, 'boom');
  assert.equal(response500.body.error.stack, undefined);
  assert.equal(response500.body.request_id, 'req-dev-stack');
  assert.equal(response500.body.error.request_id, 'req-dev-stack');
  assert.doesNotMatch(JSON.stringify(response500.body), /private|db\.sqlite/);
});


test('client X-Request-Id is echoed on 4xx JSON and rejected unsafe ids are replaced', () => {
  const middleware = createProductionErrorResponseSanitizer({ production: false });

  const accepted = responseRecorder();
  accepted.statusCode = 404;
  const acceptedReq = { headers: { 'x-request-id': 'client-trace-1' } };
  requestContext(acceptedReq, accepted, () => {});
  middleware(acceptedReq, accepted, () => {});
  accepted.json({ success: false, error: { code: 'NOT_FOUND', message: '接口不存在' } });
  assert.equal(acceptedReq.requestId, 'client-trace-1');
  assert.equal(accepted.headers['x-request-id'], 'client-trace-1');
  assert.equal(accepted.body.request_id, 'client-trace-1');
  assert.equal(accepted.body.error.request_id, 'client-trace-1');
  assert.equal(accepted.body.error.message, '接口不存在');

  const replaced = responseRecorder();
  replaced.statusCode = 400;
  const replacedReq = { headers: { 'x-request-id': '../secret\r\nInjected: yes' } };
  requestContext(replacedReq, replaced, () => {});
  middleware(replacedReq, replaced, () => {});
  replaced.json({ success: false, error: { code: 'BAD_REQUEST', message: '参数无效' } });
  assert.match(replacedReq.requestId, /^[a-f0-9-]{36}$/);
  assert.equal(replaced.body.request_id, replacedReq.requestId);
  assert.equal(replaced.body.error.request_id, replacedReq.requestId);
  assert.doesNotMatch(JSON.stringify(replaced.body), /secret|Injected/);
});

test('response helpers reuse the existing request id instead of inventing another field', () => {
  const res = responseRecorder();
  res.setHeader('X-Request-Id', 'from-header');
  response.badRequest(res, '参数无效');
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.code, 'BAD_REQUEST');
  assert.equal(res.body.error.message, '参数无效');
  assert.equal(res.body.request_id, 'from-header');
  assert.equal(res.body.error.request_id, 'from-header');
  assert.equal(res.body.error.requestId, undefined);
  assert.equal(res.body.requestId, undefined);
});

test('development timeout and cancel copy stays Chinese and hides internals', () => {
  const timeoutHandler = createErrorHandler({ errorw() {}, operation() {} }, { production: false });
  const timeoutRes = responseRecorder();
  const timeoutError = new Error('connect ETIMEDOUT 10.0.0.1');
  timeoutError.name = 'TimeoutError';
  timeoutHandler(timeoutError, { requestId: 'req-dev-timeout', method: 'GET', path: '/api/v1/ai' }, timeoutRes, () => {});
  assert.equal(timeoutRes.body.error.message, '请求超时，请稍后重试');
  assert.equal(timeoutRes.body.request_id, 'req-dev-timeout');
  assert.doesNotMatch(JSON.stringify(timeoutRes.body), /ETIMEDOUT|10\.0\.0\.1|TimeoutError|connect /);

  const cancelHandler = createErrorHandler({
    errorw() {},
    operation() {},
  }, { production: false });
  const cancelRes = responseRecorder();
  const cancelError = new Error('aborted\n    at abort (C:\\private\\internal.js:1:1)');
  cancelError.code = 'OPERATION_CANCELLED';
  cancelError.name = 'AbortError';
  cancelHandler(cancelError, { requestId: 'req-dev-cancel', method: 'POST', path: '/api/v1/tasks' }, cancelRes, () => {});
  assert.equal(cancelRes.body.error.message, '操作已取消');
  assert.equal(cancelRes.body.error.stack, undefined);
  assert.equal(cancelRes.body.request_id, 'req-dev-cancel');
  assert.doesNotMatch(JSON.stringify(cancelRes.body), /internal\.js|aborted|private/);

  const timeoutAbortRes = responseRecorder();
  const timeoutAbortError = new Error('The operation was aborted.');
  timeoutAbortError.name = 'AbortError';
  timeoutAbortError.code = 'ECONNABORTED';
  timeoutAbortError.isTimeout = true;
  timeoutHandler(timeoutAbortError, { requestId: 'req-dev-timeout-abort', method: 'GET', path: '/api/v1/ai' }, timeoutAbortRes, () => {});
  assert.equal(timeoutAbortRes.body.error.message, '请求超时，请稍后重试');
  assert.doesNotMatch(JSON.stringify(timeoutAbortRes.body), /aborted|AbortError|ECONNABORTED/);

});

test('request context binds logger metadata to the same request id', () => {
  const lines = [];
  const originalLog = console.log;
  console.log = (msg) => { lines.push(String(msg)); };
  try {
    const res = responseRecorder();
    const req = { headers: { 'x-request-id': 'trace-bind-1' } };
    requestContext(req, res, () => {
      logger.info('inside-request', { path: '/api/v1/demo' });
    });
    logger.info('outside-request', { path: '/api/v1/demo' });
  } finally {
    console.log = originalLog;
  }
  const inside = lines.find((line) => line.includes('inside-request'));
  const outside = lines.find((line) => line.includes('outside-request'));
  assert.match(String(inside), /trace-bind-1/);
  assert.match(String(inside), /\/api\/v1\/demo/);
  assert.equal(String(outside).includes('trace-bind-1'), false);
});

test('JSON parse failures return Chinese copy and keep the request id', () => {
  const handler = createErrorHandler({ errorw() {}, operation() {} }, { production: true });
  const res = responseRecorder();
  const error = new SyntaxError("Expected property name or '}' in JSON at position 1");
  error.status = 400;
  error.type = 'entity.parse.failed';
  handler(error, { requestId: 'req-json', method: 'POST', path: '/api/v1/assets' }, res, () => {});

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.code, 'REQUEST_REJECTED');
  assert.equal(res.body.error.message, '请求数据格式无效');
  assert.equal(res.body.request_id, 'req-json');
  assert.equal(res.body.error.request_id, 'req-json');
  assert.doesNotMatch(JSON.stringify(res.body), /Expected property|position 1|SyntaxError/);
});

test('production sanitizer keeps safe timeout copy but still hides extra internals', () => {
  const middleware = createProductionErrorResponseSanitizer({ production: true });

  const timeoutRes = responseRecorder();
  timeoutRes.statusCode = 500;
  middleware({ requestId: 'req-safe-timeout' }, timeoutRes, () => {});
  timeoutRes.json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: '请求超时，请稍后重试', request_id: 'req-safe-timeout' },
    request_id: 'req-safe-timeout',
  });
  assert.equal(timeoutRes.body.error.message, '请求超时，请稍后重试');
  assert.equal(timeoutRes.body.request_id, 'req-safe-timeout');

  const leaked = responseRecorder();
  leaked.statusCode = 500;
  middleware({ requestId: 'req-leaked-timeout' }, leaked, () => {});
  leaked.json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: '请求超时，请稍后重试',
      path: 'C:\\private\\db.sqlite',
    },
    request_id: 'req-leaked-timeout',
  });
  assert.equal(leaked.body.error.message, '服务器内部错误');
  assert.doesNotMatch(JSON.stringify(leaked.body), /private|db\.sqlite/);
});
