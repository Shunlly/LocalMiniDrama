const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const imageRoutes = require('../src/routes/images');
const storySourceRoutes = require('../src/routes/storySources');
const characterRoutes = require('../src/routes/characters');
const sceneRoutes = require('../src/routes/scenes');
const uploadService = require('../src/services/uploadService');
const ttsService = require('../src/services/ttsService');
const sourceIntakeService = require('../src/services/sourceIntakeService');
const sceneService = require('../src/services/sceneService');
const { buildProviderErrorMessage, toSafeProviderErrorMessage } = require('../src/services/providerErrorSanitizer');

const silentLog = { info() {}, warn() {}, error() {}, errorw() {} };

const DRAMA_ID = 11;
const OTHER_DRAMA_ID = 22;
const EPISODE_ID = 1101;
const STORYBOARD_ID = 3301;
const OTHER_STORYBOARD_ID = 4401;
const CHARACTER_ID = 5501;
const SCENE_ID = 6601;

const leftoverEnglish = [
  'Media URL must be credential-free HTTP(S).',
  'This story source has no retained original.',
  'No TTS provider is configured',
  'text cannot be empty',
  'storyboard_id must belong to drama_id',
  'idempotency_key belongs to another drama or storyboard',
  '${field} is invalid',
  'Image generation did not complete',
  'Video generation did not complete',
  'source text is required',
  'unsafe scene source image',
  'scene source image required',
  'Production QA failed with score',
  'Video merge task no longer accepts completion',
  'Static storage path is not allowed',
  'stream failed',
  'provider reported an error; check provider configuration and retry',
  'Unsafe media reference.',
];

function hasCjk(text) {
  return /[\u4e00-\u9fff]/.test(String(text || ''));
}

function mockResponse() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = String(value);
      return this;
    },
    getHeader(name) {
      return this.headers[String(name).toLowerCase()];
    },
  };
}

function createDb() {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO dramas (id, title, status, created_at, updated_at, deleted_at, trash_state, recycle_phase)
     VALUES (?, ?, 'draft', ?, ?, NULL, NULL, NULL)`
  ).run(DRAMA_ID, '\u4e3b\u9879\u76ee', now, now);
  db.prepare(
    `INSERT INTO dramas (id, title, status, created_at, updated_at, deleted_at, trash_state, recycle_phase)
     VALUES (?, ?, 'draft', ?, ?, NULL, NULL, NULL)`
  ).run(OTHER_DRAMA_ID, '\u53e6\u4e00\u4e2a\u9879\u76ee', now, now);
  db.prepare(
    `INSERT INTO episodes (id, drama_id, episode_number, title, created_at, updated_at, deleted_at)
     VALUES (?, ?, 1, '\u7b2c\u4e00\u96c6', ?, ?, NULL)`
  ).run(EPISODE_ID, DRAMA_ID, now, now);
  db.prepare(
    `INSERT INTO episodes (id, drama_id, episode_number, title, created_at, updated_at, deleted_at)
     VALUES (?, ?, 1, '\u53e6\u4e00\u96c6', ?, ?, NULL)`
  ).run(2201, OTHER_DRAMA_ID, now, now);
  db.prepare(
    `INSERT INTO storyboards (id, episode_id, title, created_at, updated_at, deleted_at)
     VALUES (?, ?, '\u4e3b\u5206\u955c', ?, ?, NULL)`
  ).run(STORYBOARD_ID, EPISODE_ID, now, now);
  db.prepare(
    `INSERT INTO storyboards (id, episode_id, title, created_at, updated_at, deleted_at)
     VALUES (?, ?, '\u53e6\u4e00\u5206\u955c', ?, ?, NULL)`
  ).run(OTHER_STORYBOARD_ID, 2201, now, now);
  db.prepare(
    `INSERT INTO characters (id, drama_id, name, appearance, created_at, updated_at, deleted_at)
     VALUES (?, ?, '\u6797\u590f', '\u9ed1\u53d1', ?, ?, NULL)`
  ).run(CHARACTER_ID, DRAMA_ID, now, now);
  db.prepare(
    `INSERT INTO scenes (id, drama_id, episode_id, location, status, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, '\u7801\u5934', 'draft', ?, ?, NULL)`
  ).run(SCENE_ID, DRAMA_ID, EPISODE_ID, now, now);
  return db;
}

test('\u5269\u4f59\u7528\u6237\u9519\u8bef\u6e90\u7801\u4e0d\u518d\u5305\u542b\u5df2\u5217\u51fa\u7684\u82f1\u6587\u53e5\u5b50', () => {
  const files = [
    'services/uploadService.js',
    'services/ttsService.js',
    'services/imageService.js',
    'services/videoService.js',
    'services/sourceIntakeService.js',
    'services/sceneService.js',
    'services/dramaWriteGuard.js',
    'services/videoMergeService.js',
    'services/providerErrorSanitizer.js',
    'routes/storyboards.js',
    'routes/aiConfig.js',
    'app.js',
  ];
  for (const name of files) {
    const source = fs.readFileSync(path.join(__dirname, '../src', name), 'utf8');
    for (const phrase of leftoverEnglish) {
      assert.equal(source.includes(phrase), false, `${name} \u4ecd\u5305\u542b\uff1a${phrase}`);
    }
  }
});

test('\u56fe\u7247\u751f\u6210\u8de8\u9879\u76ee ID \u4e0d\u76f8\u7b49\u65f6\u8fd4\u56de\u4e2d\u6587 BAD_REQUEST', () => {
  assert.notEqual(DRAMA_ID, OTHER_DRAMA_ID);
  assert.notEqual(DRAMA_ID, EPISODE_ID);
  assert.notEqual(DRAMA_ID, STORYBOARD_ID);
  assert.notEqual(EPISODE_ID, STORYBOARD_ID);
  assert.notEqual(STORYBOARD_ID, OTHER_STORYBOARD_ID);

  const db = createDb();
  try {
    const res = mockResponse();
    imageRoutes(db, {}, silentLog).create({
      body: {
        drama_id: DRAMA_ID,
        storyboard_id: OTHER_STORYBOARD_ID,
        prompt: '\u8de8\u9879\u76ee\u63d0\u793a\u8bcd',
      },
    }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error.code, 'BAD_REQUEST');
    assert.match(res.body.error.message, /storyboard_id/);
    assert.match(res.body.error.message, /drama_id/);
    assert.equal(hasCjk(res.body.error.message), true);

    const invalid = mockResponse();
    imageRoutes(db, {}, silentLog).create({
      body: { drama_id: { nested: EPISODE_ID }, prompt: '\u65e0\u6548\u9879\u76ee ID' },
    }, invalid);
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.body.error.code, 'BAD_REQUEST');
    assert.match(invalid.body.error.message, /drama_id.*\u65e0\u6548/);
  } finally {
    db.close();
  }
});

test('TTS / \u7d20\u6750\u6e90 / \u573a\u666f\u5168\u666f / \u4e0a\u4f20\u9519\u8bef\u4e3a\u53ef\u64cd\u4f5c\u7b80\u4f53\u4e2d\u6587', async () => {
  const db = createDb();
  try {
    await assert.rejects(
      () => ttsService.synthesize(db, silentLog, { text: '   ', storage_base: '.' }),
      (error) => error.code === 'BAD_REQUEST' && error.message === 'text \u4e0d\u80fd\u4e3a\u7a7a'
    );
    await assert.rejects(
      () => ttsService.synthesize(db, silentLog, { text: '\u65c1\u767d', storage_base: '.' }),
      (error) => error.code === 'BAD_REQUEST' && /\u672a\u914d\u7f6e TTS/.test(error.message)
    );

    assert.throws(
      () => sourceIntakeService.createStorySource(db, silentLog, {
        drama_id: DRAMA_ID,
        episode_id: EPISODE_ID,
        text: '   ',
      }),
      (error) => error.code === 'BAD_REQUEST' && error.message === '\u7d20\u6750\u6587\u672c\u4e0d\u80fd\u4e3a\u7a7a'
    );

    const emptyRoute = mockResponse();
    storySourceRoutes(db, silentLog).createForDrama(
      { params: { id: String(DRAMA_ID) }, body: { text: '', title: '\u7a7a\u6587\u672c' } },
      emptyRoute
    );
    assert.equal(emptyRoute.statusCode, 400);
    assert.equal(emptyRoute.body.error.code, 'BAD_REQUEST');
    assert.equal(emptyRoute.body.error.message, '\u7d20\u6750\u6587\u672c\u4e0d\u80fd\u4e3a\u7a7a');

    const panorama = sceneService.generateScenePanoramaImage(db, silentLog, SCENE_ID);
    assert.equal(panorama.ok, false);
    assert.equal(panorama.error, '\u8bf7\u5148\u4e3a\u573a\u666f\u51c6\u5907\u53ef\u7528\u7684\u4e3b\u56fe\uff0c\u518d\u751f\u6210\u5168\u666f\u56fe');
    const panoramaRes = mockResponse();
    sceneRoutes(db, silentLog, {}).generatePanorama(
      { params: { scene_id: String(SCENE_ID) }, body: {} },
      panoramaRes
    );
    assert.equal(panoramaRes.statusCode, 400);
    assert.equal(panoramaRes.body.error.code, 'BAD_REQUEST');
    assert.equal(panoramaRes.body.error.message, '\u8bf7\u5148\u4e3a\u573a\u666f\u51c6\u5907\u53ef\u7528\u7684\u4e3b\u56fe\uff0c\u518d\u751f\u6210\u5168\u666f\u56fe');

    assert.throws(
      () => uploadService.assertPublicHttpUrlSyntax('http://127.0.0.1/private.png'),
      (error) => error.code === 'UNSAFE_MEDIA_REFERENCE'
        && /公网|HTTP/.test(error.message)
        && hasCjk(error.message)
    );
    assert.throws(
      () => uploadService.assertPublicHttpUrlSyntax('ftp://example.com/a.png'),
      (error) => error.code === 'UNSAFE_MEDIA_REFERENCE'
        && /HTTP\(S\)/.test(error.message)
        && hasCjk(error.message)
    );
  } finally {
    db.close();
  }
});

test('\u89d2\u8272\u672a\u6388\u6743\u4e0d\u518d\u628a\u82f1\u6587 unauthorized \u8fd4\u56de\u7ed9\u524d\u7aef', async () => {
  const db = createDb();
  try {
    assert.notEqual(CHARACTER_ID, DRAMA_ID);
    assert.notEqual(CHARACTER_ID, EPISODE_ID);
    db.prepare('UPDATE dramas SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), DRAMA_ID);
    const res = mockResponse();
    await characterRoutes(db, {}, silentLog, {}).generatePrompt(
      { params: { id: String(CHARACTER_ID) }, body: {} },
      res
    );
    assert.notEqual(res.body?.error?.message, 'unauthorized');
    assert.equal(hasCjk(res.body.error.message), true);
    assert.match(res.body.error.message, /\u4e0d\u5b58\u5728|\u65e0\u6743\u9650|\u4e0d\u53ef\u7528/);
    assert.doesNotMatch(res.body.error.message, /\bunauthorized\b/i);
  } finally {
    db.close();
  }
});

test('Provider \u8131\u654f\u9519\u8bef\u548c\u9759\u6001 404 \u5bf9\u7528\u6237\u4f7f\u7528\u7b80\u4f53\u4e2d\u6587', () => {
  const message = buildProviderErrorMessage({
    provider: 'OpenAI',
    operation: '\u8fde\u63a5\u6d4b\u8bd5',
    status: 401,
  });
  assert.match(message, /OpenAI/);
  assert.match(message, /\u8fde\u63a5\u6d4b\u8bd5/);
  assert.match(message, /\u5931\u8d25/);
  assert.match(message, /\u8ba4\u8bc1\u5931\u8d25/);
  assert.equal(hasCjk(message), true);

  const forged = toSafeProviderErrorMessage(
    new Error('OpenAI \u8fde\u63a5\u6d4b\u8bd5 \u5931\u8d25 (sk-secret)\uff1aProvider \u8fd4\u56de\u9519\u8bef\uff0c\u8bf7\u68c0\u67e5\u914d\u7f6e\u540e\u91cd\u8bd5\u3002'),
    { provider: 'OpenAI', operation: '\u8fde\u63a5\u6d4b\u8bd5' }
  );
  assert.doesNotMatch(forged, /sk-secret/);
  assert.match(forged, /\u5931\u8d25/);

  const appSource = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  assert.match(appSource, /\u672a\u627e\u5230\u8d44\u6e90/);
  assert.match(appSource, /\u8d44\u6e90\u8def\u5f84\u65e0\u6548/);
  assert.equal(appSource.includes("send('Not Found')"), false);
});
