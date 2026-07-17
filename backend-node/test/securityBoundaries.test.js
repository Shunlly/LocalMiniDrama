const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const Database = require('better-sqlite3');
const AdmZip = require('adm-zip');

const uploadService = require('../src/services/uploadService');
const videoClient = require('../src/services/videoClient');
const dramaImportService = require('../src/services/dramaImportService');
const { runMigrationsAndEnsure } = require('../src/db/migrate');
const { createProviderNetworkBoundary } = require('../src/routes');
const { VALID_PNG_BYTES } = require('./mediaFixture');

const log = { info() {}, warn() {}, error() {}, errorw() {} };

function privateLookup() {
  return Promise.resolve([{ address: '169.254.169.254', family: 4 }]);
}

function lanLookup() {
  return Promise.resolve([{ address: '10.0.0.8', family: 4 }]);
}

function mixedLookup() {
  return Promise.resolve([
    { address: '93.184.216.34', family: 4 },
    { address: '10.0.0.8', family: 4 },
  ]);
}

function publicLookup() {
  return Promise.resolve([{ address: '93.184.216.34', family: 4 }]);
}

test('rejects private DNS answers, metadata targets, and mixed public/private answers', async () => {
  await assert.rejects(
    uploadService.validatePublicHttpUrl('https://media.example/image.png', { lookup: privateLookup }),
    (error) => error?.code === 'UNSAFE_MEDIA_REFERENCE'
  );
  await assert.rejects(
    uploadService.validatePublicHttpUrl('https://media.example/image.png', { lookup: mixedLookup }),
    (error) => error?.code === 'UNSAFE_MEDIA_REFERENCE'
  );
  await assert.rejects(
    uploadService.validatePublicHttpUrl('http://169.254.169.254/latest/meta-data'),
    (error) => error?.code === 'UNSAFE_MEDIA_REFERENCE'
  );
  await assert.rejects(
    uploadService.validatePublicHttpUrl('http://[::1]/secret'),
    (error) => error?.code === 'UNSAFE_MEDIA_REFERENCE'
  );
  await assert.rejects(
    uploadService.validatePublicHttpUrl('http://[fec0::1]/secret'),
    (error) => error?.code === 'UNSAFE_MEDIA_REFERENCE'
  );
  await assert.rejects(
    uploadService.validatePublicHttpUrl('https://media.example/image.png', {
      lookup: async () => [{ address: 'not-an-ip', family: 4 }],
    }),
    (error) => error?.code === 'UNSAFE_MEDIA_REFERENCE'
  );
});

test('allows private media only for an exact explicitly trusted provider origin', async () => {
  const trusted = await uploadService.validatePublicHttpUrl('http://e2e-provider:5688/v1/media/output.mp4', {
    trustedOrigins: ['http://e2e-provider:5688/v1'],
    lookup: lanLookup,
  });
  assert.equal(trusted.trustedOrigin, true);

  await assert.rejects(
    uploadService.validatePublicHttpUrl('http://e2e-provider:5689/v1/media/output.mp4', {
      trustedOrigins: ['http://e2e-provider:5688/v1'],
      lookup: lanLookup,
    }),
    (error) => error?.code === 'UNSAFE_MEDIA_REFERENCE'
  );
});

test('revalidates redirect targets and rejects a trusted origin redirect to metadata', async (t) => {
  const server = http.createServer((_req, res) => {
    res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data' });
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;

  await assert.rejects(
    uploadService.downloadBufferViaNodeHttp(`${origin}/media`, 2000, 0, { trustedOrigins: [origin] }),
    (error) => error?.code === 'UNSAFE_MEDIA_REFERENCE'
  );
});

test('local references cannot use absolute paths, encoded traversal, or storage symlinks', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-media-boundary-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-media-outside-'));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(root, 'projects'), { recursive: true });
  fs.writeFileSync(path.join(root, 'projects', 'safe.png'), 'safe');
  fs.writeFileSync(path.join(outside, 'secret.png'), 'secret');

  assert.equal(
    uploadService.resolveStorageReference(root, '/static/projects/safe.png').relativePath,
    'projects/safe.png'
  );
  assert.throws(
    () => uploadService.resolveStorageReference(root, path.join(root, 'projects', 'safe.png')),
    (error) => error?.code === 'UNSAFE_MEDIA_REFERENCE'
  );
  assert.throws(
    () => uploadService.resolveStorageReference(root, '/static/%252e%252e/secret.png'),
    (error) => error?.code === 'UNSAFE_MEDIA_REFERENCE'
  );

  const link = path.join(root, 'projects', 'linked.png');
  try {
    fs.symlinkSync(path.join(outside, 'secret.png'), link, 'file');
    assert.throws(
      () => uploadService.resolveStorageReference(root, 'projects/linked.png'),
      (error) => error?.code === 'UNSAFE_MEDIA_REFERENCE'
    );
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
  }
});

test('video provider boundary repeats DNS validation for user reference media', async () => {
  await assert.rejects(
    videoClient.validateVideoMediaReferences({
      image_url: 'https://user-media.example/frame.png',
      media_dns_lookup: privateLookup,
    }),
    (error) => error?.code === 'UNSAFE_MEDIA_REFERENCE'
  );
  const validated = await videoClient.validateVideoMediaReferences({
    image_url: 'https://user-media.example/frame.png',
    media_dns_lookup: publicLookup,
  });
  assert.equal(validated.image_url, 'https://user-media.example/frame.png');
});

test('private provider dispatch requires an exact enabled saved origin', async () => {
  const activeProvider = {
    base_url: 'http://e2e-provider:5688/v1',
    is_active: true,
  };
  const validated = await videoClient.validateProviderRequestUrl(
    'http://e2e-provider:5688/v1/videos',
    activeProvider,
    { lookup: lanLookup }
  );
  assert.equal(validated.trustedOrigin, true);

  await assert.rejects(
    videoClient.validateProviderRequestUrl(
      'http://e2e-provider:5688/v1/videos',
      { ...activeProvider, is_active: false },
      { lookup: lanLookup }
    ),
    (error) => error?.code === 'UNSAFE_MEDIA_REFERENCE'
  );
  await assert.rejects(
    videoClient.validateProviderRequestUrl(
      'http://metadata:80/latest',
      activeProvider,
      { lookup: privateLookup }
    ),
    (error) => error?.code === 'UNSAFE_MEDIA_REFERENCE'
  );
});

test('provider network routes reject unsaved or inactive private origins', async (t) => {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  t.after(() => db.close());
  const insert = db.prepare(
    'INSERT INTO ai_service_configs (service_type, provider, name, base_url, is_active) VALUES (?, ?, ?, ?, ?)'
  );
  const activeId = Number(insert.run('video', 'local', 'active', 'http://127.0.0.1:5688/v1', 1).lastInsertRowid);
  const inactiveId = Number(insert.run('video', 'local', 'inactive', 'http://127.0.0.1:5689/v1', 0).lastInsertRowid);
  const boundary = createProviderNetworkBoundary(db);

  async function invoke(body) {
    let nextCalled = false;
    const recorded = { statusCode: null, body: null };
    const res = {
      status(value) { recorded.statusCode = value; return this; },
      json(value) { recorded.body = value; return this; },
    };
    await boundary({ body }, res, () => { nextCalled = true; });
    return { ...recorded, nextCalled };
  }

  assert.equal((await invoke({ base_url: 'http://127.0.0.1:5688/v1' })).statusCode, 400);
  assert.equal((await invoke({ base_url: 'https://public-provider.example/v1' })).statusCode, 400);
  assert.equal((await invoke({ config_id: inactiveId })).statusCode, 400);
  assert.equal((await invoke({ config_id: activeId })).nextCalled, true);
  assert.equal((await invoke({ config_id: activeId, base_url: 'http://127.0.0.1:5689/v1' })).statusCode, 400);
});

test('Jimeng adapter cannot read an absolute image path outside storage', async (t) => {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-jimeng-storage-'));
  const outside = path.join(os.tmpdir(), `lmd-jimeng-secret-${Date.now()}.png`);
  fs.writeFileSync(outside, 'not-an-image-secret');
  t.after(() => {
    fs.rmSync(storage, { recursive: true, force: true });
    fs.rmSync(outside, { force: true });
  });

  await assert.rejects(
    videoClient.resolveJimengApiImageBuffer(outside, '', storage, log, 1, 0),
    (error) => error?.code === 'UNSAFE_MEDIA_REFERENCE'
  );
});

function makeImportZip(project, files = {}) {
  const zip = new AdmZip();
  zip.addFile('project.json', Buffer.from(JSON.stringify(project)));
  for (const [name, value] of Object.entries(files)) zip.addFile(name, Buffer.from(value));
  return zip.toBuffer();
}

test('rejects ZIP bombs by compression ratio before extracting entries', () => {
  const archive = makeImportZip(
    { drama: { title: 'Bomb' }, characters: [{ name: 'A', image_file: 'media/a.png' }] },
    { 'media/a.png': Buffer.alloc(1024 * 1024, 0x41) }
  );
  assert.throws(
    () => dramaImportService.parseZip(archive, { limits: { maxCompressionRatio: 5 } }),
    (error) => error?.code === 'COMPRESSION_RATIO_LIMIT'
  );
});

test('enforces ZIP upload, entry-count, per-entry, and total expansion limits', () => {
  const archive = makeImportZip(
    { drama: { title: 'Limits' }, characters: [{ name: 'A', image_file: 'media/a.png' }] },
    { 'media/a.png': Buffer.from(Array.from({ length: 128 }, (_, index) => index)) }
  );
  assert.throws(
    () => dramaImportService.parseZip(archive, { limits: { maxArchiveBytes: archive.length - 1 } }),
    (error) => error?.code === 'ARCHIVE_TOO_LARGE'
  );
  assert.throws(
    () => dramaImportService.parseZip(archive, { limits: { maxEntries: 1 } }),
    (error) => error?.code === 'ENTRY_LIMIT_EXCEEDED'
  );
  assert.throws(
    () => dramaImportService.parseZip(archive, { limits: { maxEntryBytes: 64 } }),
    (error) => error?.code === 'ENTRY_SIZE_LIMIT'
  );
  assert.throws(
    () => dramaImportService.parseZip(archive, { limits: { maxTotalUncompressedBytes: 128 } }),
    (error) => error?.code === 'TOTAL_SIZE_LIMIT'
  );
});

test('rolls back database rows and committed media directory when import commit fails', (t) => {
  const storagePath = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-import-rollback-'));
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  t.after(() => {
    db.close();
    fs.rmSync(storagePath, { recursive: true, force: true });
  });
  const archive = makeImportZip(
    { drama: { title: 'Rollback' }, characters: [{ name: 'A', image_file: 'media/a.png' }] },
    { 'media/a.png': VALID_PNG_BYTES }
  );

  assert.throws(
    () => dramaImportService.importDrama(db, { storage: { local_path: storagePath } }, log, archive, {
      getAvailableBytes: () => Number.POSITIVE_INFINITY,
      faultInjector(step) {
        if (step === 'after-file-commit') throw new Error('injected import commit failure');
      },
    }),
    /injected import commit failure/
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM dramas').get().count, 0);
  const remaining = fs.readdirSync(storagePath);
  assert.equal(remaining.some((name) => name.startsWith('.import-staging-')), false);
  const projects = path.join(storagePath, 'projects');
  assert.deepEqual(fs.existsSync(projects) ? fs.readdirSync(projects) : [], []);
});

test('import commit rejects a symlinked projects directory', (t) => {
  const storagePath = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-import-symlink-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-import-target-'));
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  t.after(() => {
    db.close();
    fs.rmSync(storagePath, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  try {
    fs.symlinkSync(outside, path.join(storagePath, 'projects'), 'junction');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
      t.skip('symlinks are unavailable in this environment');
      return;
    }
    throw error;
  }

  const archive = makeImportZip({ drama: { title: 'Symlink target' }, episodes: [] });
  assert.throws(
    () => dramaImportService.importDrama(db, { storage: { local_path: storagePath } }, log, archive, {
      getAvailableBytes: () => Number.POSITIVE_INFINITY,
    }),
    (error) => error?.code === 'UNSAFE_IMPORT_TARGET'
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM dramas').get().count, 0);
  assert.deepEqual(fs.readdirSync(outside), []);
});
