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
const { runImportImageValidatorCli } = require('../src/services/importImageValidator');
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

test('Electron image validation uses the fixed helper mode without RunAsNode', () => {
  assert.equal(typeof dramaImportService.createImageValidatorProcessSpec, 'function');

  const spec = dramaImportService.createImageValidatorProcessSpec({
    execPath: 'C:\\Program Files\\LocalMiniDrama\\LocalMiniDrama.exe',
    electronVersion: '43.1.1',
    environment: {
      ELECTRON_RUN_AS_NODE: '1',
      LOCALMINIDRAMA_TEST_MARKER: 'kept',
    },
    projectPath: 'C:\\staging\\project',
    maxImagePixels: 4096,
    maxImageFrames: 8,
  });

  assert.equal(spec.executable, 'C:\\Program Files\\LocalMiniDrama\\LocalMiniDrama.exe');
  assert.deepEqual(spec.args, [
    '--localminidrama-import-image-validator',
    'C:\\staging\\project',
    '4096',
    '8',
  ]);
  assert.equal(spec.environment.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(spec.environment.LOCALMINIDRAMA_TEST_MARKER, 'kept');
});

test('development Electron image validation prefixes the application entry', () => {
  const spec = dramaImportService.createImageValidatorProcessSpec({
    execPath: 'C:\\project\\node_modules\\electron\\dist\\electron.exe',
    electronVersion: '43.1.1',
    defaultApp: true,
    appEntry: 'C:\\project\\desktop',
    environment: {},
    projectPath: 'C:\\staging\\project',
    maxImagePixels: 4096,
    maxImageFrames: 8,
  });

  assert.deepEqual(spec.args, [
    'C:\\project\\desktop',
    '--localminidrama-import-image-validator',
    'C:\\staging\\project',
    '4096',
    '8',
  ]);
});

test('development Electron image validation fails closed without an application entry', () => {
  assert.throws(
    () => dramaImportService.createImageValidatorProcessSpec({
      execPath: 'C:\\project\\node_modules\\electron\\dist\\electron.exe',
      electronVersion: '43.1.1',
      defaultApp: true,
      appEntry: '   ',
      environment: {},
      projectPath: 'C:\\staging\\project',
      maxImagePixels: 4096,
      maxImageFrames: 8,
    }),
    (error) => error?.code === 'MEDIA_VALIDATION_UNAVAILABLE'
      && /application entry/i.test(error.message)
  );
});

test('image validator helper rejects caller-supplied module paths', async () => {
  let output = '';
  const stdout = {
    write(value, callback) {
      output += String(value);
      callback();
    },
  };

  const exitCode = await runImportImageValidatorCli([
    'C:\\untrusted\\validator.js',
    'C:\\staging\\project',
    '4096',
    '8',
  ], stdout);

  assert.equal(exitCode, 1);
  const payload = JSON.parse(output);
  assert.equal(payload.code, 'MEDIA_VALIDATION_UNAVAILABLE');
  assert.match(payload.reason, /requires project root, pixel limit, and frame limit/);
});

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

function seedFreeCanvasSourceProject(db) {
  const now = '2026-07-27T00:00:00.000Z';
  db.prepare(
    `INSERT INTO dramas (id, title, status, metadata, created_at, updated_at)
     VALUES (1, 'Free Canvas Source', 'draft', '{}', ?, ?)`
  ).run(now, now);
  db.prepare(
    `INSERT INTO episodes (id, drama_id, episode_number, title, created_at, updated_at)
     VALUES (10, 1, 1, 'Episode 1', ?, ?)`
  ).run(now, now);
  db.prepare(
    `INSERT INTO storyboards (id, episode_id, storyboard_number, title, created_at, updated_at)
     VALUES (20, 10, 1, 'Shot 1', ?, ?)`
  ).run(now, now);
  db.prepare(
    `INSERT INTO scenes (id, drama_id, episode_id, location, time, created_at, updated_at)
     VALUES (30, 1, 10, 'Studio', 'day', ?, ?)`
  ).run(now, now);
  db.prepare(
    `INSERT INTO image_generations (id, drama_id, storyboard_id, provider, status, local_path, created_at, updated_at)
     VALUES (40, 1, 20, 'fixture', 'completed', 'projects/0001_20260727_Free_Canvas_Source/images/frame.png', ?, ?)`
  ).run(now, now);
  db.prepare(
    `INSERT INTO assets (id, drama_id, name, type, local_path, image_gen_id, created_at, updated_at)
     VALUES (50, 1, 'Frame asset', 'image', 'projects/0001_20260727_Free_Canvas_Source/images/frame.png', 40, ?, ?)`
  ).run(now, now);
}

function freeCanvasImportProject(overrides = {}) {
  const project = baseProject('Free Canvas Source');
  project.drama.metadata = {
    free_canvas: {
      version: 1,
      projectId: 1,
      dramaId: 1,
      episodeId: 10,
      nodes: [{
        id: 'free:image:frame',
        type: 'image',
        position: { x: 10, y: 20 },
        content: 'projects/0001_20260727_Free_Canvas_Source/images/frame.png',
        storageKey: 'projects/0001_20260727_Free_Canvas_Source/images/frame.png',
        assetId: 50,
        asset_ref: 50,
        storyboardId: 20,
        storyboard_ref: 20,
        episodeId: 10,
        sceneId: 30,
        apiKey: 'must-not-survive-import',
      }],
      edges: [],
    },
    ...overrides,
  };
  project.episodes.push({
    episode_number: 1,
    title: 'Episode 1',
    storyboards: [{
      storyboard_number: 1,
      title: 'Shot 1',
      image_generations: [{
        original_id: 40,
        status: 'completed',
        zip_file: 'media/frame.png',
      }],
    }],
  });
  project.scenes.push({ location: 'Studio', time: 'day' });
  return project;
}

function assertFreeCanvasImportRollback(target, archive) {
  const beforeDramaCount = target.db.prepare('SELECT COUNT(*) AS count FROM dramas').get().count;
  const beforeAssetCount = target.db.prepare('SELECT COUNT(*) AS count FROM assets').get().count;
  assert.throws(
    () => dramaImportService.importDrama(
      target.db,
      { storage: { local_path: target.storageRoot } },
      log,
      archive,
    ),
    (error) => error?.code === 'BAD_REQUEST',
  );
  assert.equal(target.db.prepare('SELECT COUNT(*) AS count FROM dramas').get().count, beforeDramaCount);
  assert.equal(target.db.prepare('SELECT COUNT(*) AS count FROM assets').get().count, beforeAssetCount);
  assert.deepEqual(fs.readdirSync(target.storageRoot), []);
}

test('legacy project ZIP import fails closed instead of guessing free canvas IDs from the live database', async (t) => {
  const target = createImportTarget(t, 'lmd-import-free-canvas-remap-');
  seedFreeCanvasSourceProject(target.db);
  const png = await sharp({
    create: { width: 8, height: 8, channels: 3, background: '#234567' },
  }).png().toBuffer();

  assertFreeCanvasImportRollback(
    target,
    makeArchive(freeCanvasImportProject(), { 'media/frame.png': png }),
  );
});

test('project ZIP import rejects an unsupported free canvas version without residue', (t) => {
  const target = createImportTarget(t, 'lmd-import-free-canvas-version-');
  const project = freeCanvasImportProject({
    free_canvas: { version: 2, nodes: [], edges: [] },
  });

  assertFreeCanvasImportRollback(target, makeArchive(project, {}));
});

test('project ZIP import rejects cross-project free canvas references without residue', (t) => {
  const target = createImportTarget(t, 'lmd-import-free-canvas-scope-');
  seedFreeCanvasSourceProject(target.db);
  const project = freeCanvasImportProject({
    free_canvas: { version: 1, projectId: 999, nodes: [], edges: [] },
  });

  assertFreeCanvasImportRollback(target, makeArchive(project, {}));
});

test('project ZIP import rejects unsafe free canvas media before remapping an asset', async (t) => {
  const target = createImportTarget(t, 'lmd-import-free-canvas-media-');
  seedFreeCanvasSourceProject(target.db);
  const project = freeCanvasImportProject();
  project.drama.metadata.free_canvas.nodes[0].content = '../outside.png';
  const png = await sharp({
    create: { width: 8, height: 8, channels: 3, background: '#765432' },
  }).png().toBuffer();

  assertFreeCanvasImportRollback(target, makeArchive(project, { 'media/frame.png': png }));
});

test('legacy project ZIP without remapped canvas references remains import-compatible', (t) => {
  const target = createImportTarget(t, 'lmd-import-free-canvas-reference-free-');
  target.db.prepare(
    `INSERT INTO dramas (title, status, metadata, created_at, updated_at)
     VALUES ('sequence placeholder', 'draft', '{}', ?, ?)`
  ).run('2026-07-27T00:00:00.000Z', '2026-07-27T00:00:00.000Z');
  target.db.prepare('DELETE FROM dramas WHERE title = ?').run('sequence placeholder');

  const project = baseProject('Legacy Reference-Free Canvas');
  project.drama.metadata = {
    free_canvas: {
      version: 1,
      projectId: 1,
      dramaId: 1,
      nodes: [{
        id: 'free:text:legacy',
        type: 'text',
        position: { x: 10, y: 20 },
        content: 'legacy note',
      }],
      edges: [],
    },
  };

  const imported = dramaImportService.importDrama(
    target.db,
    { storage: { local_path: target.storageRoot } },
    log,
    makeArchive(project, {}),
  );
  const metadata = JSON.parse(
    target.db.prepare('SELECT metadata FROM dramas WHERE id = ?').get(imported.drama_id).metadata
  );
  assert.equal(metadata.free_canvas.projectId, imported.drama_id);
  assert.equal(metadata.free_canvas.dramaId, imported.drama_id);
  assert.equal(metadata.free_canvas.nodes[0].content, 'legacy note');
});
