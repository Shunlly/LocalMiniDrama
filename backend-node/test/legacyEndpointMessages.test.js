const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const imageRoutes = require('../src/routes/images');
const videoRoutes = require('../src/routes/videos');
const videoMergeRoutes = require('../src/routes/videoMerges');

const log = { info() {}, warn() {}, error() {} };

const leftoverEnglish = [
  'Use POST /api/v1/videos with storyboard_id and frame references.',
  'Submit POST /api/v1/videos once for each storyboard.',
  'Use POST /api/v1/scenes/generate-image with scene_id.',
  'Use POST /api/v1/episodes/:episode_id/finalize to start an FFmpeg merge.',
];

const expected = {
  videosFromImage: '请改为调用 POST /api/v1/videos，并传入 storyboard_id 与帧参考',
  videosEpisodeBatch: '请改为对每个分镜单独调用 POST /api/v1/videos',
  imagesScene: '请改为调用 POST /api/v1/scenes/generate-image，并传入 scene_id',
  imagesEpisodeBatch: '请改为对每个分镜单独调用 POST /api/v1/images',
  videoMergesCreate: '请改为调用 POST /api/v1/episodes/:episode_id/finalize 启动 FFmpeg 合成',
};

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

function assertLegacyDisabled(handler, req, message) {
  const res = mockResponse();
  handler(req, res);
  assert.equal(res.statusCode, 501);
  assert.equal(res.body.success, false);
  assert.equal(res.body.error.code, 'LEGACY_ENDPOINT_DISABLED');
  assert.equal(res.body.error.message, message);
  assert.match(message, /[\u4e00-\u9fff]/);
  assert.doesNotMatch(message, /\b(Use|Submit)\b/);
}

test('legacy 501 messages stay Chinese and keep LEGACY_ENDPOINT_DISABLED', () => {
  const images = imageRoutes({}, {}, log);
  const videos = videoRoutes({}, log);
  const videoMerges = videoMergeRoutes({}, log);

  assertLegacyDisabled(videos.fromImage, { params: { image_gen_id: '1' }, body: {} }, expected.videosFromImage);
  assertLegacyDisabled(videos.episodeBatch, { params: { episode_id: '1' }, body: {} }, expected.videosEpisodeBatch);
  assertLegacyDisabled(images.scene, { params: { scene_id: '1' } }, expected.imagesScene);
  assertLegacyDisabled(images.episodeBatch, { params: { episode_id: '1' }, body: {} }, expected.imagesEpisodeBatch);
  assertLegacyDisabled(videoMerges.create, { body: { episode_id: 1 } }, expected.videoMergesCreate);
});

test('legacy route sources no longer return leftover English 501 copy', () => {
  const sources = [
    fs.readFileSync(path.join(__dirname, '../src/routes/videos.js'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '../src/routes/images.js'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '../src/routes/videoMerges.js'), 'utf8'),
  ].join('\n');

  for (const phrase of leftoverEnglish) {
    assert.equal(sources.includes(phrase), false, phrase);
  }
  assert.match(sources, /请改为调用 POST \/api\/v1\/videos/);
  assert.match(sources, /请改为对每个分镜单独调用 POST \/api\/v1\/videos/);
  assert.match(sources, /请改为调用 POST \/api\/v1\/scenes\/generate-image/);
  assert.match(sources, /请改为对每个分镜单独调用 POST \/api\/v1\/images/);
  assert.match(sources, /请改为调用 POST \/api\/v1\/episodes\/:episode_id\/finalize/);
});
