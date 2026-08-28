const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createErrorHandler,
  createNotFoundHandler,
  createProductionErrorResponseSanitizer,
  initializeWithMaintenanceGuard,
  requestContext,
} = require('../src/app');
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
  assert.doesNotMatch(JSON.stringify(res.body), /private|database\.sqlite|upstream token/);
  assert.match(entries[0].fields.error, /database\.sqlite/);
  assert.equal(entries[0].fields.request_id, 'req-500');
  assert.equal(operations[0].operation, 'http_request');
  assert.equal(operations[0].phase, 'error');
  assert.equal(operations[0].code, 'INTERNAL_ERROR');
});

test('expected client errors retain actionable messages', () => {
  const handler = createErrorHandler({ errorw() {} }, { production: true });
  const res = responseRecorder();
  const error = new Error('reference image URL must be public');
  error.code = 'BAD_REQUEST';
  handler(error, { requestId: 'req-400', method: 'POST', path: '/api/v1/videos' }, res, () => {});

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.code, 'BAD_REQUEST');
  assert.equal(res.body.error.message, 'reference image URL must be public');
  assert.equal(res.body.error.request_id, 'req-400');
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
});

test('unknown API routes use the standard error envelope', () => {
  const handler = createNotFoundHandler();
  const res = responseRecorder();
  handler({ path: '/api/v1/does-not-exist' }, res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.success, false);
  assert.deepEqual(res.body.error, {
    code: 'NOT_FOUND',
    message: '接口不存在',
  });
  assert.match(res.body.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});
