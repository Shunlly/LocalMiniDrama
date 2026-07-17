const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const aiClient = require('../src/services/aiClient');
const aiConfigService = require('../src/services/aiConfigService');
const imageClient = require('../src/services/imageClient');
const sceneService = require('../src/services/sceneService');
const storyboardService = require('../src/services/storyboardService');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);
const log = { info() {}, warn() {}, error() {} };

function config(overrides = {}) {
  return {
    id: 1,
    service_type: 'image',
    provider: 'openai',
    base_url: 'https://provider.example/v1',
    endpoint: '/images/generations',
    api_key: 'test-key',
    model: ['image-model'],
    default_model: 'image-model',
    is_active: true,
    is_default: true,
    ...overrides,
  };
}

test('image and vision references reject absolute storage escapes and private URLs', async (t) => {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-visual-security-'));
  const outside = path.join(os.tmpdir(), `lmd-visual-outside-${Date.now()}.png`);
  fs.writeFileSync(outside, PNG);
  const originalListConfigs = aiConfigService.listConfigs;
  aiConfigService.listConfigs = () => [config()];
  t.after(() => {
    aiConfigService.listConfigs = originalListConfigs;
    fs.rmSync(storage, { recursive: true, force: true });
    fs.rmSync(outside, { force: true });
  });

  await assert.rejects(
    imageClient.callImageApi({}, log, {
      prompt: 'test',
      model: 'image-model',
      imageServiceType: 'image',
      reference_image_urls: [outside],
      storage_local_path: storage,
    }),
    (error) => error?.code === 'UNSAFE_MEDIA_REFERENCE'
  );
  await assert.rejects(
    aiClient.generateTextWithVision({}, log, 'image', 'test', '', { localAbsPath: outside }),
    (error) => error?.code === 'UNSAFE_MEDIA_REFERENCE'
  );
  await assert.rejects(
    imageClient.callImageApi({}, log, {
      prompt: 'test',
      model: 'image-model',
      imageServiceType: 'image',
      reference_image_urls: ['http://169.254.169.254/latest/meta-data'],
      storage_local_path: storage,
    }),
    (error) => error?.code === 'UNSAFE_MEDIA_REFERENCE'
  );
});

test('image references preserve the exact enabled private provider origin exception', async (t) => {
  let submittedBody = null;
  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/ref.png') {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': PNG.length });
      res.end(PNG);
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    submittedBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const originalListConfigs = aiConfigService.listConfigs;
  aiConfigService.listConfigs = () => [config({ base_url: origin })];
  t.after(async () => {
    aiConfigService.listConfigs = originalListConfigs;
    await new Promise((resolve) => server.close(resolve));
  });

  const result = await imageClient.callImageApi({}, log, {
    prompt: 'test',
    model: 'image-model',
    imageServiceType: 'image',
    reference_image_urls: [`${origin}/ref.png`],
  });
  assert.match(result.image_url, /^data:image\/png;base64,/);
  assert.match(submittedBody.image[0], /^data:image\/png;base64,/);
});

test('AI HTTP helpers pin trusted providers and enforce a response size limit', async (t) => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ value: 'x'.repeat(4096) }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise((resolve) => server.close(resolve)));

  await assert.rejects(
    aiClient.postJSONWithTimeout(`${origin}/v1`, {}, {}, 2000, {
      trustedOrigins: [origin],
      maxResponseBytes: 128,
    }),
    (error) => error?.code === 'UNSAFE_MEDIA_REFERENCE'
  );
});

test('pinned DNS requests support Node auto-family lookup without re-resolving', async (t) => {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/media') {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': PNG.length });
      res.end(PNG);
      return;
    }
    for await (const _chunk of req) {}
    const body = Buffer.from('{"ok":true}');
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': body.length });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const origin = `http://pinned-provider.test:${server.address().port}`;
  const lookupCalls = [];
  const lookup = async (hostname, options) => {
    lookupCalls.push({ hostname, all: options?.all === true });
    return [{ address: '127.0.0.1', family: 4 }];
  };

  const providerResponse = await aiClient.postJSONWithTimeout(`${origin}/v1`, {}, {}, 2000, {
    trustedOrigins: [origin],
    allowPrivateOrigins: [origin],
    lookup,
  });
  assert.equal(providerResponse.statusCode, 200);

  const mediaResponse = await require('../src/services/uploadService').downloadBufferViaNodeHttp(
    `${origin}/media`,
    2000,
    0,
    { trustedOrigins: [origin], allowPrivateOrigins: [origin], lookup, maxBytes: 1024 }
  );
  assert.deepEqual(mediaResponse.buffer, PNG);
  assert.deepEqual(lookupCalls, [
    { hostname: 'pinned-provider.test', all: true },
    { hostname: 'pinned-provider.test', all: true },
  ]);
});

test('scene and storyboard entry points reject unsafe media references', () => {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-entry-security-'));
  const outside = path.join(os.tmpdir(), `lmd-entry-outside-${Date.now()}.mp4`);
  fs.writeFileSync(outside, Buffer.from('outside'));
  try {
    assert.throws(
      () => sceneService.resolveScenePanoramaSource(
        { local_path: outside },
        { storage: { local_path: storage } }
      ),
      (error) => error?.code === 'UNSAFE_MEDIA_REFERENCE'
    );
    assert.throws(
      () => storyboardService.normalizeStoryboardVideoReference(outside),
      /storage/
    );
    assert.throws(
      () => storyboardService.normalizeStoryboardVideoReference('http://127.0.0.1/private.mp4'),
      /公网 HTTP\(S\)/
    );
  } finally {
    fs.rmSync(storage, { recursive: true, force: true });
    fs.rmSync(outside, { force: true });
  }
});
