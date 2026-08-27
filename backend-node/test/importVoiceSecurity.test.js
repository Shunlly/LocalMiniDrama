const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { spawnSync } = require('node:child_process');
const AdmZip = require('adm-zip');
const Database = require('better-sqlite3');

const characterRoutes = require('../src/routes/characters');
const uploadRoutes = require('../src/routes/upload');
const dramaImportService = require('../src/services/dramaImportService');
const uploadService = require('../src/services/uploadService');
const { getFfmpegPath } = require('../src/utils/ffmpegPath');

const log = { info() {}, warn() {}, error() {} };

function makeImportZip(project) {
  const zip = new AdmZip();
  zip.addFile('project.json', Buffer.from(JSON.stringify(project)));
  return zip.toBuffer();
}

function createResponseCapture(onJson = null) {
  const res = new EventEmitter();
  res.statusCode = 0;
  res.body = null;
  res.status = function status(code) {
    this.statusCode = code;
    return this;
  };
  res.json = function json(body) {
    this.body = body;
    if (onJson) onJson();
    return this;
  };
  return res;
}

function filesUnder(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(absolutePath));
    else files.push(absolutePath);
  }
  return files;
}

function createAudioFixture(directory, filename = 'voice.wav') {
  const outputPath = path.join(directory, filename);
  const result = spawnSync(
    getFfmpegPath(),
    [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.25',
      '-c:a', 'pcm_s16le', '-y', outputPath,
    ],
    { encoding: 'utf8', maxBuffer: 1024 * 1024, windowsHide: true }
  );
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return outputPath;
}

function createCharacterDb(previousAsset = null) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY,
      deleted_at TEXT,
      trash_state TEXT,
      recycle_phase TEXT
    );
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER NOT NULL,
      seedance2_voice_asset TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
  `);
  db.prepare('INSERT INTO dramas (id) VALUES (11)').run();
  db.prepare(
    'INSERT INTO characters (id, drama_id, seedance2_voice_asset) VALUES (?, ?, ?)'
  ).run(7, 11, previousAsset ? JSON.stringify(previousAsset) : null);
  return db;
}

function writeLegacyVoice(storageRoot, filename = 'char_7_voice_1700000000000.wav') {
  const relativePath = `drama_11/characters/voice/${filename}`;
  const absolutePath = path.join(storageRoot, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, Buffer.from('previous voice'));
  return { relativePath, absolutePath };
}

async function invokeVoiceUpload({ db, storageRoot, sourcePath, service = uploadService }) {
  const handlers = characterRoutes(
    db,
    { storage: { local_path: storageRoot, upload_disk_reserve_bytes: 0 } },
    log,
    service
  );
  const req = {
    params: { id: '7' },
    file: {
      path: sourcePath,
      originalname: 'declared-as-text.txt',
      mimetype: 'text/plain',
      size: fs.statSync(sourcePath).size,
    },
  };
  const res = createResponseCapture();
  await handlers.sd2VoiceUpload(req, res);
  return { req, res };
}

function runMultipartMiddleware(middleware, contents, mimetype = 'application/octet-stream') {
  const boundary = `voice-upload-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="voice.wav"\r\nContent-Type: ${mimetype}\r\n\r\n`
    ),
    contents,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const req = new PassThrough();
  req.method = 'POST';
  req.url = '/characters/7/sd2-voice-upload';
  req.headers = {
    'content-type': `multipart/form-data; boundary=${boundary}`,
    'content-length': String(body.length),
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error = null, nextCalled = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ error, nextCalled, req, res });
    };
    const res = createResponseCapture(() => finish());
    const timer = setTimeout(() => reject(new Error('audio upload middleware timed out')), 5000);
    middleware(req, res, (error) => finish(error, true));
    req.end(body);
  });
}

test('project import rejects per-entity, total-entity, and product complexity before a transaction', (t) => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-import-cardinality-'));
  t.after(() => fs.rmSync(storageRoot, { recursive: true, force: true }));

  const perEntityArchive = makeImportZip({
    drama: { title: 'Too many characters' },
    characters: [{ name: 'A' }, { name: 'B' }],
  });
  assert.throws(
    () => dramaImportService.parseZip(perEntityArchive, { limits: { maxCharacters: 1 } }),
    (error) => error?.code === 'IMPORT_ENTITY_LIMIT_EXCEEDED'
      && error?.statusCode === 413
      && error?.details?.name === 'characters'
      && error?.details?.actual === 2
      && error?.details?.limit === 1
  );

  const totalArchive = makeImportZip({
    drama: { title: 'Too many total entities' },
    characters: [{ name: 'A' }],
    episodes: [{ episode_number: 1 }],
    scenes: [{ location: 'Room' }],
  });
  assert.throws(
    () => dramaImportService.parseZip(totalArchive, { limits: { maxTotalEntities: 3 } }),
    (error) => error?.code === 'IMPORT_TOTAL_ENTITY_LIMIT_EXCEEDED'
      && error?.details?.name === 'total'
      && error?.details?.actual === 4
  );

  const productArchive = makeImportZip({
    drama: { title: 'Relationship product' },
    characters: [{ name: 'A' }, { name: 'B' }],
    episodes: [{ episode_number: 1 }, { episode_number: 2 }],
  });
  let transactionCalled = false;
  const db = {
    transaction() {
      transactionCalled = true;
      throw new Error('transaction must not be created');
    },
    prepare() {
      throw new Error('database must not be queried');
    },
  };
  assert.throws(
    () => dramaImportService.importDrama(
      db,
      { storage: { local_path: storageRoot } },
      log,
      productArchive,
      {
        limits: { maxEpisodeCharacterLinks: 3 },
        getAvailableBytes: () => Number.POSITIVE_INFINITY,
      }
    ),
    (error) => error?.code === 'IMPORT_RELATIONSHIP_LIMIT_EXCEEDED'
      && error?.details?.name === 'episode_characters'
      && error?.details?.actual === 4
  );
  assert.equal(transactionCalled, false);
  assert.deepEqual(fs.readdirSync(storageRoot), []);
});

test('voice validation requires both a supported magic signature and a real ffprobe audio stream', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-voice-probe-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const validPath = createAudioFixture(root);
  const detected = await uploadService.validateAllowedUpload(validPath, 'audio');
  assert.equal(detected.mimeType, 'audio/wav');
  assert.equal(detected.extension, '.wav');
  assert.equal(detected.mediaType, 'audio');
  assert.ok(detected.duration > 0);
  await assert.rejects(
    uploadService.validateAllowedUpload(validPath),
    (error) => error?.code === 'INVALID_MEDIA_CONTENT'
  );

  const forged = Buffer.alloc(64, 0x41);
  forged.write('RIFF', 0, 'ascii');
  forged.writeUInt32LE(forged.length - 8, 4);
  forged.write('WAVE', 8, 'ascii');
  await assert.rejects(
    uploadService.validateAllowedUpload(forged, 'audio'),
    (error) => error?.code === 'INVALID_MEDIA_CONTENT'
  );
});

test('voice middleware rejects forged audio and preserves its disk admission reserve', async (t) => {
  const forgedTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-voice-forged-'));
  const reserveTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-voice-reserve-'));
  t.after(() => {
    fs.rmSync(forgedTemp, { recursive: true, force: true });
    fs.rmSync(reserveTemp, { recursive: true, force: true });
  });

  const forged = Buffer.alloc(64, 0x41);
  forged.write('RIFF', 0, 'ascii');
  forged.write('WAVE', 8, 'ascii');
  const forgedOutcome = await runMultipartMiddleware(
    uploadRoutes.createAudioUploadMiddleware({
      tempDir: forgedTemp,
      diskReserveBytes: 0,
      getAvailableBytes: () => Number.POSITIVE_INFINITY,
    }),
    forged,
    'audio/wav'
  );
  assert.equal(forgedOutcome.nextCalled, false);
  assert.equal(forgedOutcome.res.statusCode, 400);
  assert.equal(forgedOutcome.res.body.error.code, 'INVALID_MEDIA_CONTENT');
  assert.deepEqual(filesUnder(forgedTemp), []);

  const reserveOutcome = await runMultipartMiddleware(
    uploadRoutes.createAudioUploadMiddleware({
      tempDir: reserveTemp,
      diskReserveBytes: 1024,
      getAvailableBytes: () => 1024,
    }),
    Buffer.from('body is rejected before multer writes it'),
    'audio/wav'
  );
  assert.equal(reserveOutcome.nextCalled, false);
  assert.equal(reserveOutcome.res.statusCode, 507);
  assert.equal(reserveOutcome.res.body.error.code, 'INSUFFICIENT_STORAGE');
  assert.deepEqual(filesUnder(reserveTemp), []);
});

test('successful voice replacement reclaims the previous owned file', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-voice-replace-'));
  const storageRoot = path.join(root, 'storage');
  fs.mkdirSync(storageRoot);
  const oldFile = writeLegacyVoice(storageRoot);
  const db = createCharacterDb({
    status: 'active',
    url: `/static/${oldFile.relativePath}`,
    local_path: oldFile.relativePath,
  });
  const sourcePath = createAudioFixture(root, 'replacement.wav');
  const sourceBytes = fs.readFileSync(sourcePath);
  t.after(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const { res } = await invokeVoiceUpload({ db, storageRoot, sourcePath });
  assert.equal(res.statusCode, 200);
  assert.equal(fs.existsSync(oldFile.absolutePath), false);
  assert.equal(fs.existsSync(sourcePath), false);
  const asset = JSON.parse(
    db.prepare('SELECT seedance2_voice_asset FROM characters WHERE id = 7').get().seedance2_voice_asset
  );
  assert.match(asset.local_path, /^drama_11\/characters\/voice\/char_7\/.+\.wav$/);
  assert.deepEqual(fs.readFileSync(path.join(storageRoot, ...asset.local_path.split('/'))), sourceBytes);
  assert.ok(asset.duration > 0);
});

test('voice replacement keeps the old file when final storage admission fails', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-voice-no-space-'));
  const storageRoot = path.join(root, 'storage');
  fs.mkdirSync(storageRoot);
  const oldFile = writeLegacyVoice(storageRoot);
  const previousAsset = { local_path: oldFile.relativePath, url: `/static/${oldFile.relativePath}` };
  const db = createCharacterDb(previousAsset);
  const sourcePath = createAudioFixture(root, 'replacement.wav');
  const constrainedService = {
    ...uploadService,
    getAvailableDiskBytes: () => 0,
  };
  t.after(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const { res } = await invokeVoiceUpload({
    db,
    storageRoot,
    sourcePath,
    service: constrainedService,
  });
  assert.equal(res.statusCode, 507);
  assert.equal(res.body.error.code, 'INSUFFICIENT_STORAGE');
  assert.equal(fs.existsSync(oldFile.absolutePath), true);
  assert.equal(fs.existsSync(sourcePath), false);
  assert.deepEqual(
    JSON.parse(db.prepare('SELECT seedance2_voice_asset FROM characters WHERE id = 7').get().seedance2_voice_asset),
    previousAsset
  );
  assert.deepEqual(filesUnder(storageRoot), [oldFile.absolutePath]);
});

test('voice replacement rolls back the new file and retains the old one when the database update fails', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-voice-db-failure-'));
  const storageRoot = path.join(root, 'storage');
  fs.mkdirSync(storageRoot);
  const oldFile = writeLegacyVoice(storageRoot);
  const previousAsset = { local_path: oldFile.relativePath, url: `/static/${oldFile.relativePath}` };
  const db = createCharacterDb(previousAsset);
  db.exec(`
    CREATE TRIGGER reject_voice_update
    BEFORE UPDATE OF seedance2_voice_asset ON characters
    BEGIN
      SELECT RAISE(ABORT, 'injected voice update failure');
    END;
  `);
  const sourcePath = createAudioFixture(root, 'replacement.wav');
  t.after(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const { res } = await invokeVoiceUpload({ db, storageRoot, sourcePath });
  assert.equal(res.statusCode, 500);
  assert.equal(fs.existsSync(oldFile.absolutePath), true);
  assert.equal(fs.existsSync(sourcePath), false);
  assert.deepEqual(filesUnder(storageRoot), [oldFile.absolutePath]);
  assert.deepEqual(
    JSON.parse(db.prepare('SELECT seedance2_voice_asset FROM characters WHERE id = 7').get().seedance2_voice_asset),
    previousAsset
  );
});

test('voice replacement never deletes an old path outside controlled character storage', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-voice-boundary-'));
  const storageRoot = path.join(root, 'storage');
  fs.mkdirSync(storageRoot);
  const outsidePath = path.join(root, 'outside.wav');
  fs.writeFileSync(outsidePath, Buffer.from('outside sentinel'));
  const db = createCharacterDb({ local_path: outsidePath, url: `/static/${outsidePath}` });
  const sourcePath = createAudioFixture(root, 'replacement.wav');
  t.after(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const { res } = await invokeVoiceUpload({ db, storageRoot, sourcePath });
  assert.equal(res.statusCode, 200);
  assert.equal(fs.readFileSync(outsidePath, 'utf8'), 'outside sentinel');
  const asset = JSON.parse(
    db.prepare('SELECT seedance2_voice_asset FROM characters WHERE id = 7').get().seedance2_voice_asset
  );
  assert.notEqual(asset.local_path, outsidePath);
  assert.equal(fs.existsSync(path.join(storageRoot, ...asset.local_path.split('/'))), true);
});
