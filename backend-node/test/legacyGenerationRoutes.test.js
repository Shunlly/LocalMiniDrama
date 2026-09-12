const test = require('node:test');
const assert = require('node:assert/strict');

const imageRoutes = require('../src/routes/images');
const videoRoutes = require('../src/routes/videos');
const videoMergeRoutes = require('../src/routes/videoMerges');

const log = { info() {}, warn() {}, error() {} };

function mockResponse() {
  return {
    statusCode: 0,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    getHeader() { return undefined; },
    setHeader() {},
  };
}

function assertDisabled(handler, req) {
  const res = mockResponse();
  handler(req, res);
  assert.equal(res.statusCode, 501);
  assert.equal(res.body.success, false);
  assert.equal(res.body.error.code, 'LEGACY_ENDPOINT_DISABLED');
}

test('legacy image generation shortcuts fail closed instead of reporting empty success', () => {
  const handlers = imageRoutes({}, {}, log);
  assertDisabled(handlers.scene, { params: { scene_id: '1' } });
  assertDisabled(handlers.episodeBatch, { params: { episode_id: '1' }, body: {} });
});

test('legacy video generation shortcuts fail closed instead of creating unusable tasks', () => {
  const handlers = videoRoutes({}, log);
  assertDisabled(handlers.fromImage, { params: { image_gen_id: '1' }, body: {} });
  assertDisabled(handlers.episodeBatch, { params: { episode_id: '1' }, body: {} });
});

test('direct video merge creation fails closed and directs callers to episode finalization', () => {
  const handlers = videoMergeRoutes({}, log);
  assertDisabled(handlers.create, { body: { episode_id: 1 } });
});
