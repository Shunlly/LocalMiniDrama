const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const AdmZip = require('adm-zip');
const Database = require('better-sqlite3');
const sharp = require('sharp');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const dramaImportService = require('../src/services/dramaImportService');
const { getFfmpegPath } = require('../src/utils/ffmpegPath');
const { selectFixtureVideoEncoder } = require('./mediaFixture');

const log = { debug() {}, info() {}, warn() {}, error() {} };

function createImportTarget(t, prefix) {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  t.after(() => {
    db.close();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });
  return { db, storageRoot };
}

function makeArchive(project, files) {
  const zip = new AdmZip();
  zip.addFile('project.json', Buffer.from(JSON.stringify(project)));
  for (const [archivePath, contents] of Object.entries(files)) {
    zip.addFile(archivePath, contents);
  }
  return zip.toBuffer();
}

function baseProject(title) {
  return {
    version: '1.6',
    drama: { title, status: 'draft', metadata: {} },
    characters: [],
    episodes: [],
    scenes: [],
    props: [],
  };
}

function assertRejectedImportIsClean(target, archive, expectedCode, options = {}) {
  assert.throws(
    () => dramaImportService.importDrama(
      target.db,
      { storage: { local_path: target.storageRoot } },
      log,
      archive,
      options
    ),
    (error) => error?.name === 'DramaImportError' && error?.code === expectedCode
  );
  assert.equal(target.db.prepare('SELECT COUNT(*) AS count FROM dramas').get().count, 0);
  assert.deepEqual(fs.readdirSync(target.storageRoot), []);
}

function runFfmpeg(args) {
  const result = spawnSync(getFfmpegPath(), args, {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    timeout: 15000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, String(result.stderr || result.stdout || 'FFmpeg fixture generation failed'));
}

test('project ZIP import rejects a fake PNG before commit and removes staging files', (t) => {
  const target = createImportTarget(t, 'lmd-import-fake-png-');
  const project = baseProject('Fake PNG');
  project.characters.push({ name: 'Lead', image_file: 'media/lead.png' });
  const fakePng = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('not-a-decodable-png'),
  ]);

  assertRejectedImportIsClean(
    target,
    makeArchive(project, { 'media/lead.png': fakePng }),
    'INVALID_MEDIA_CONTENT'
  );
});

test('project ZIP import rejects malformed audiovisual content before commit', (t) => {
  const target = createImportTarget(t, 'lmd-import-fake-video-');
  const project = baseProject('Fake Video');
  project.episodes.push({
    episode_number: 1,
    title: 'Episode 1',
    storyboards: [{ storyboard_number: 1, duration: 1, video_file: 'media/shot.mp4' }],
  });

  assertRejectedImportIsClean(
    target,
    makeArchive(project, { 'media/shot.mp4': Buffer.from('not-an-mp4-container') }),
    'INVALID_MEDIA_CONTENT'
  );
});

test('project ZIP import enforces decoded pixel and animated frame limits', async (t) => {
  const pixelTarget = createImportTarget(t, 'lmd-import-pixel-limit-');
  const pixelProject = baseProject('Pixel Limit');
  pixelProject.characters.push({ name: 'Lead', image_file: 'media/lead.png' });
  const png = await sharp({
    create: { width: 16, height: 16, channels: 3, background: '#224466' },
  }).png().toBuffer();
  assertRejectedImportIsClean(
    pixelTarget,
    makeArchive(pixelProject, { 'media/lead.png': png }),
    'IMPORT_IMAGE_LIMIT_EXCEEDED',
    { limits: { maxImagePixels: 128 } }
  );

  const frameTarget = createImportTarget(t, 'lmd-import-frame-limit-');
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-import-gif-fixture-'));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  const gifPath = path.join(fixtureRoot, 'animated.gif');
  runFfmpeg([
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=size=16x16:rate=10:duration=0.2',
    '-y', gifPath,
  ]);
  const frameProject = baseProject('Frame Limit');
  frameProject.characters.push({ name: 'Lead', image_file: 'media/lead.gif' });
  assertRejectedImportIsClean(
    frameTarget,
    makeArchive(frameProject, { 'media/lead.gif': fs.readFileSync(gifPath) }),
    'IMPORT_IMAGE_LIMIT_EXCEEDED',
    { limits: { maxImageFrames: 1 } }
  );
});

test('project ZIP import accepts fully decodable image, video, and audio fixtures', async (t) => {
  const target = createImportTarget(t, 'lmd-import-valid-media-');
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-import-media-fixture-'));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

  const png = await sharp({
    create: {
      width: 24,
      height: 16,
      channels: 3,
      background: '#2f7d5c',
    },
  }).png().toBuffer();

  const videoPath = path.join(fixtureRoot, 'shot.mp4');
  const audioPath = path.join(fixtureRoot, 'voice.wav');
  const ffmpegPath = getFfmpegPath();
  runFfmpeg([
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=blue:s=64x48:r=10:d=0.5',
    '-t', '0.5', '-c:v', selectFixtureVideoEncoder(ffmpegPath), '-pix_fmt', 'yuv420p',
    '-an', '-y', videoPath,
  ]);
  runFfmpeg([
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=0.5',
    '-c:a', 'pcm_s16le', '-y', audioPath,
  ]);

  const project = baseProject('Valid Media');
  project.characters.push({ name: 'Lead', image_file: 'media/lead.png' });
  project.episodes.push({
    episode_number: 1,
    title: 'Episode 1',
    storyboards: [{
      storyboard_number: 1,
      title: 'Shot 1',
      duration: 1,
      audio_file: 'media/voice.wav',
      video_file: 'media/shot.mp4',
    }],
  });
  const archive = makeArchive(project, {
    'media/lead.png': png,
    'media/voice.wav': fs.readFileSync(audioPath),
    'media/shot.mp4': fs.readFileSync(videoPath),
  });

  const imported = dramaImportService.importDrama(
    target.db,
    { storage: { local_path: target.storageRoot } },
    log,
    archive
  );
  const character = target.db.prepare(
    'SELECT local_path FROM characters WHERE drama_id = ?'
  ).get(imported.drama_id);
  const storyboard = target.db.prepare(
    `SELECT s.audio_local_path, s.video_local_path
     FROM storyboards s
     JOIN episodes e ON e.id = s.episode_id
     WHERE e.drama_id = ?`
  ).get(imported.drama_id);

  assert.ok(character?.local_path);
  assert.ok(storyboard?.audio_local_path);
  assert.ok(storyboard?.video_local_path);
  for (const relativePath of [character.local_path, storyboard.audio_local_path, storyboard.video_local_path]) {
    assert.equal(fs.statSync(path.join(target.storageRoot, relativePath)).isFile(), true);
  }
  assert.equal(
    fs.readdirSync(target.storageRoot).some((name) => name.startsWith('.import-staging-')),
    false
  );
});
