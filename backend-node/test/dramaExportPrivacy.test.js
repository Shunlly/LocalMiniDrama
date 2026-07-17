const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const AdmZip = require('adm-zip');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const dramaExportService = require('../src/services/dramaExportService');
const dramaImportService = require('../src/services/dramaImportService');

const log = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

const SYNTHETIC_MARKERS = Object.freeze({
  apiKey: 'LMD_SYNTHETIC_EXPORT_API_KEY_21A7',
  clientSecret: 'LMD_SYNTHETIC_EXPORT_CLIENT_SECRET_32B8',
  authorization: 'LMD_SYNTHETIC_EXPORT_AUTHORIZATION_43C9',
  cookie: 'LMD_SYNTHETIC_EXPORT_COOKIE_54DA',
  userinfo: 'LMD_SYNTHETIC_EXPORT_USERINFO_65EB',
  absoluteQuery: 'LMD_SYNTHETIC_EXPORT_ABSOLUTE_QUERY_76FC',
  protocolQuery: 'LMD_SYNTHETIC_EXPORT_PROTOCOL_QUERY_870D',
  relativeQuery: 'LMD_SYNTHETIC_EXPORT_RELATIVE_QUERY_981E',
  malformedUrl: 'LMD_SYNTHETIC_EXPORT_MALFORMED_URL_A92F',
  oauthCode: 'LMD_SYNTHETIC_EXPORT_OAUTH_CODE_BA30',
  structuredSecret: 'LMD_SYNTHETIC_EXPORT_STRUCTURED_SECRET_CB41',
});

function makeDb() {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  return db;
}

test('project export recursively removes sensitive keys and sanitizes every supported URL form', (t) => {
  const sourceStorage = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-export-privacy-source-'));
  const targetStorage = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-export-privacy-target-'));
  const sourceDb = makeDb();
  const targetDb = makeDb();
  t.after(() => {
    sourceDb.close();
    targetDb.close();
    fs.rmSync(sourceStorage, { recursive: true, force: true });
    fs.rmSync(targetStorage, { recursive: true, force: true });
  });

  const ordinaryMediaUrl =
    'https://cdn.example.test/ordinary.png?style=cinematic&download=1&variant=poster#hero';
  const metadata = {
    api_key: SYNTHETIC_MARKERS.apiKey,
    ordinary_media_url: ordinaryMediaUrl,
    userinfo_media_url:
      `https://viewer:${SYNTHETIC_MARKERS.userinfo}@cdn.example.test/frame.png`
      + `?style=cinematic&token=${SYNTHETIC_MARKERS.absoluteQuery}&width=1280#preview`,
    protocol_relative_media_url:
      `//preview:${SYNTHETIC_MARKERS.userinfo}@cdn.example.test/reference.png`
      + `?format=webp&X-Amz-Credential=${SYNTHETIC_MARKERS.protocolQuery}&variant=poster`,
    root_relative_media_url:
      `/static/reference.png?width=640&access_token=${SYNTHETIC_MARKERS.relativeQuery}`
      + '&variant=poster#frame',
    path_relative_media_url:
      `media/storyboards/frame.png?download=1&api_key=${SYNTHETIC_MARKERS.relativeQuery}&cache=keep`,
    parent_relative_media_url:
      `../shared/voice.mp3?quality=high&Authorization=${SYNTHETIC_MARKERS.relativeQuery}`,
    dot_relative_media_url:
      `./thumb.jpg?maxTokens=${SYNTHETIC_MARKERS.relativeQuery}&fit=cover`,
    filename_media_url:
      `poster.png?signature=${SYNTHETIC_MARKERS.relativeQuery}&fit=cover`,
    query_only_media_url:
      `?token=${SYNTHETIC_MARKERS.relativeQuery}&code=${SYNTHETIC_MARKERS.oauthCode}&view=grid`,
    malformed_media_url:
      `https://[invalid.example/frame.png?token=${SYNTHETIC_MARKERS.malformedUrl}`,
    nested: {
      clientSecret: SYNTHETIC_MARKERS.clientSecret,
      safe_label: 'retained nested metadata',
      tokenizer_label: 'retained non-sensitive key name',
      items: [{
        authorization: SYNTHETIC_MARKERS.authorization,
        Cookie: SYNTHETIC_MARKERS.cookie,
        session_id: SYNTHETIC_MARKERS.authorization,
        media_url:
          `https://assets.example.test/item.png?crop=fill&credential=${SYNTHETIC_MARKERS.absoluteQuery}`,
      }],
    },
  };

  const now = '2026-07-17T09:30:00.000Z';
  sourceDb.prepare(
    `INSERT INTO dramas (id, title, status, metadata, created_at, updated_at)
     VALUES (1, 'Privacy export fixture', 'draft', ?, ?, ?)`
  ).run(JSON.stringify(metadata), now, now);
  const episodeId = Number(sourceDb.prepare(
    `INSERT INTO episodes (drama_id, episode_number, title, created_at, updated_at)
     VALUES (1, 1, 'Importable episode', ?, ?)`
  ).run(now, now).lastInsertRowid);
  const storyboardId = Number(sourceDb.prepare(
    `INSERT INTO storyboards
     (episode_id, storyboard_number, title, video_url, continuity_snapshot, created_at, updated_at)
     VALUES (?, 1, 'Sanitized storyboard', ?, ?, ?, ?)`
  ).run(
    episodeId,
    `https://video.example.test/clip.mp4?download=1&access_token=${SYNTHETIC_MARKERS.absoluteQuery}`,
    JSON.stringify({
      apiKey: SYNTHETIC_MARKERS.structuredSecret,
      retained_state: 'same wardrobe',
      media_url: `/static/continuity.png?token=${SYNTHETIC_MARKERS.structuredSecret}&view=full`,
    }),
    now,
    now
  ).lastInsertRowid);
  sourceDb.prepare(
    `INSERT INTO image_generations
     (storyboard_id, image_url, status, created_at, updated_at)
     VALUES (?, ?, 'completed', ?, ?)`
  ).run(
    storyboardId,
    `//images.example.test/frame.png?style=painted&sig=${SYNTHETIC_MARKERS.protocolQuery}`,
    now,
    now
  );
  sourceDb.prepare(
    `INSERT INTO scenes
     (drama_id, episode_id, location, time, panorama_image_url, created_at, updated_at)
     VALUES (1, ?, 'Privacy stage', 'Day', ?, ?, ?)`
  ).run(
    episodeId,
    `/static/panorama.jpg?quality=high&token=${SYNTHETIC_MARKERS.relativeQuery}`,
    now,
    now
  );

  const exported = dramaExportService.exportDrama(
    sourceDb,
    { storage: { local_path: sourceStorage } },
    log,
    1
  );
  const projectText = new AdmZip(exported.buffer).readAsText('project.json');
  for (const marker of Object.values(SYNTHETIC_MARKERS)) {
    assert.equal(projectText.includes(marker), false, `project.json leaked ${marker}`);
  }

  const project = JSON.parse(projectText);
  const exportedMetadata = project.drama.metadata;
  assert.equal(Object.hasOwn(exportedMetadata, 'api_key'), false);
  assert.equal(Object.hasOwn(exportedMetadata.nested, 'clientSecret'), false);
  assert.equal(Object.hasOwn(exportedMetadata.nested.items[0], 'authorization'), false);
  assert.equal(Object.hasOwn(exportedMetadata.nested.items[0], 'Cookie'), false);
  assert.equal(Object.hasOwn(exportedMetadata.nested.items[0], 'session_id'), false);
  assert.equal(exportedMetadata.nested.safe_label, 'retained nested metadata');
  assert.equal(exportedMetadata.nested.tokenizer_label, 'retained non-sensitive key name');

  assert.equal(exportedMetadata.ordinary_media_url, ordinaryMediaUrl);
  assert.equal(
    exportedMetadata.userinfo_media_url,
    'https://cdn.example.test/frame.png?style=cinematic&width=1280#preview'
  );
  assert.equal(
    exportedMetadata.protocol_relative_media_url,
    '//cdn.example.test/reference.png?format=webp&variant=poster'
  );
  assert.equal(
    exportedMetadata.root_relative_media_url,
    '/static/reference.png?width=640&variant=poster#frame'
  );
  assert.equal(
    exportedMetadata.path_relative_media_url,
    'media/storyboards/frame.png?download=1&cache=keep'
  );
  assert.equal(exportedMetadata.parent_relative_media_url, '../shared/voice.mp3?quality=high');
  assert.equal(exportedMetadata.dot_relative_media_url, './thumb.jpg?fit=cover');
  assert.equal(exportedMetadata.filename_media_url, 'poster.png?fit=cover');
  assert.equal(exportedMetadata.query_only_media_url, '?view=grid');
  assert.equal(exportedMetadata.malformed_media_url, null);
  assert.equal(
    exportedMetadata.nested.items[0].media_url,
    'https://assets.example.test/item.png?crop=fill'
  );

  const storyboard = project.episodes[0].storyboards[0];
  assert.equal(storyboard.video_url, 'https://video.example.test/clip.mp4?download=1');
  assert.deepEqual(JSON.parse(storyboard.continuity_snapshot), {
    retained_state: 'same wardrobe',
    media_url: '/static/continuity.png?view=full',
  });
  assert.equal(
    storyboard.image_generations[0].image_url,
    '//images.example.test/frame.png?style=painted'
  );
  assert.equal(project.scenes[0].panorama_image_url, '/static/panorama.jpg?quality=high');

  const imported = dramaImportService.importDrama(
    targetDb,
    { storage: { local_path: targetStorage } },
    log,
    exported.buffer
  );
  assert.equal(imported.title, 'Privacy export fixture');
  assert.equal(
    targetDb.prepare('SELECT COUNT(*) AS count FROM episodes WHERE drama_id = ?').get(imported.drama_id).count,
    1
  );
  const importedMetadata = JSON.parse(
    targetDb.prepare('SELECT metadata FROM dramas WHERE id = ?').get(imported.drama_id).metadata
  );
  assert.equal(importedMetadata.ordinary_media_url, ordinaryMediaUrl);
  assert.equal(Object.hasOwn(importedMetadata, 'api_key'), false);
  assert.equal(importedMetadata.nested.safe_label, 'retained nested metadata');
});
