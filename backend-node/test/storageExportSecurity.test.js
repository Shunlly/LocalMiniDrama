const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const AdmZip = require('adm-zip');
const Database = require('better-sqlite3');

const { createStorageStaticMiddleware } = require('../src/app');
const dramaRoutes = require('../src/routes/drama');
const dramaExportService = require('../src/services/dramaExportService');
const uploadService = require('../src/services/uploadService');
const { runMigrationsAndEnsure } = require('../src/db/migrate');

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);
const log = { debug() {}, info() {}, warn() {}, warnw() {}, error() {} };

function createDirectoryLink(target, link) {
  fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}

function skipUnavailableSymlink(t, error) {
  if (!['EPERM', 'EACCES', 'ENOTSUP', 'ENOSYS'].includes(error?.code)) return false;
  t.skip(`symbolic links are unavailable: ${error.code}`);
  return true;
}

function makeExportFixture(t) {
  const storagePath = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-export-limits-'));
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const now = '2026-07-16T12:00:00.000Z';
  db.prepare(
    `INSERT INTO dramas (id, title, status, metadata, created_at, updated_at)
     VALUES (1, 'Export limits', 'draft', '{}', ?, ?)`
  ).run(now, now);
  const mediaPath = 'projects/export/characters/hero.png';
  fs.mkdirSync(path.join(storagePath, path.dirname(mediaPath)), { recursive: true });
  fs.writeFileSync(path.join(storagePath, mediaPath), Buffer.alloc(16 * 1024, 0x41));
  db.prepare(
    `INSERT INTO characters (drama_id, name, local_path, sort_order, created_at, updated_at)
     VALUES (1, 'Hero', ?, 0, ?, ?)`
  ).run(mediaPath, now, now);
  t.after(() => {
    db.close();
    fs.rmSync(storagePath, { recursive: true, force: true });
  });
  return { db, storagePath, mediaPath };
}

test('generic upload rejects a symlinked storage directory without writing outside', (t) => {
  const storagePath = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-upload-link-'));
  const outsidePath = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-upload-outside-'));
  t.after(() => {
    fs.rmSync(storagePath, { recursive: true, force: true });
    fs.rmSync(outsidePath, { recursive: true, force: true });
  });
  try {
    createDirectoryLink(outsidePath, path.join(storagePath, 'uploads'));
  } catch (error) {
    if (skipUnavailableSymlink(t, error)) return;
    throw error;
  }

  assert.throws(
    () => uploadService.uploadFile(
      storagePath,
      '',
      log,
      PNG_BYTES,
      'image.png',
      'image/png',
      'uploads',
      null,
      'image',
      uploadService.assertAllowedUpload(PNG_BYTES, 'image'),
      { reserveBytes: 0, getAvailableBytes: () => Number.POSITIVE_INFINITY }
    ),
    (error) => error?.code === 'UNSAFE_MEDIA_REFERENCE' && error?.reason === 'SYMLINK'
  );
  assert.deepEqual(fs.readdirSync(outsidePath), []);
});

test('storage root creation stops before an ancestor symlink', (t) => {
  const containerPath = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-storage-root-link-'));
  const outsidePath = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-storage-root-outside-'));
  t.after(() => {
    fs.rmSync(containerPath, { recursive: true, force: true });
    fs.rmSync(outsidePath, { recursive: true, force: true });
  });
  const linkedParent = path.join(containerPath, 'linked-parent');
  try {
    createDirectoryLink(outsidePath, linkedParent);
  } catch (error) {
    if (skipUnavailableSymlink(t, error)) return;
    throw error;
  }

  assert.throws(
    () => uploadService.ensureStorageDirectory(
      path.join(linkedParent, 'new-storage-root'),
      'uploads'
    ),
    (error) => error?.code === 'UNSAFE_MEDIA_REFERENCE' && error?.reason === 'SYMLINK'
  );
  assert.equal(fs.existsSync(path.join(outsidePath, 'new-storage-root')), false);
});

test('static storage serves regular files but never follows a directory symlink', async (t) => {
  const storagePath = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-static-link-'));
  const outsidePath = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-static-outside-'));
  t.after(() => {
    fs.rmSync(storagePath, { recursive: true, force: true });
    fs.rmSync(outsidePath, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(storagePath, 'safe'));
  fs.writeFileSync(path.join(storagePath, 'safe', 'public.txt'), 'public-data');
  for (const filename of ['active.html', 'active.js', 'active.svg', 'active.xml', 'unknown.bin']) {
    fs.writeFileSync(path.join(storagePath, 'safe', filename), '<script>top.location="https://example.invalid"</script>');
  }
  const unicodeDirectory = path.join(storagePath, '项目 素材');
  fs.mkdirSync(unicodeDirectory);
  fs.writeFileSync(path.join(unicodeDirectory, '成片.mp4'), Buffer.from('video-data'));
  fs.writeFileSync(path.join(outsidePath, 'secret.txt'), 'outside-secret');
  try {
    createDirectoryLink(outsidePath, path.join(storagePath, 'linked'));
  } catch (error) {
    if (skipUnavailableSymlink(t, error)) return;
    throw error;
  }

  const app = express();
  app.use('/static', createStorageStaticMiddleware(storagePath, log));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const safe = await fetch(`${origin}/static/safe/public.txt`);
  assert.equal(safe.status, 200);
  assert.match(safe.headers.get('content-type'), /^text\/plain/);
  assert.equal(await safe.text(), 'public-data');

  for (const filename of ['active.html', 'active.js', 'active.svg', 'active.xml', 'unknown.bin']) {
    const activeContent = await fetch(`${origin}/static/safe/${filename}`);
    assert.equal(activeContent.status, 200);
    assert.equal(activeContent.headers.get('content-type'), 'application/octet-stream');
    assert.equal(activeContent.headers.get('content-disposition'), 'attachment');
    assert.equal(activeContent.headers.get('x-content-type-options'), 'nosniff');
  }

  const unicodeVideo = await fetch(`${origin}/static/${encodeURIComponent('项目 素材')}/${encodeURIComponent('成片.mp4')}`, {
    headers: { Range: 'bytes=0-3' },
  });
  assert.equal(unicodeVideo.status, 206);
  assert.equal(unicodeVideo.headers.get('content-type'), 'video/mp4');
  assert.equal(unicodeVideo.headers.get('content-range'), 'bytes 0-3/10');
  assert.deepEqual(Buffer.from(await unicodeVideo.arrayBuffer()), Buffer.from('vide'));

  const rejected = await fetch(`${origin}/static/linked/secret.txt`);
  const rejectedBody = await rejected.text();
  assert.equal(rejected.status, 403);
  assert.equal(JSON.parse(rejectedBody).error.code, 'UNSAFE_STORAGE_PATH');
  assert.equal(rejectedBody.includes('outside-secret'), false);
});

test('project export enforces every configured budget with structured route errors', (t) => {
  const fixture = makeExportFixture(t);
  const baseConfig = { storage: { local_path: fixture.storagePath } };
  const baseline = dramaExportService.exportDrama(fixture.db, baseConfig, log, 1);
  const baselineZip = new AdmZip(baseline.buffer);
  const projectBytes = baselineZip.readFile('project.json').length;
  const mediaBytes = baselineZip.readFile('media/characters/char_1.png').length;

  const cases = [
    [{ max_files: 1 }, 'EXPORT_FILE_COUNT_LIMIT'],
    [{ max_file_bytes: mediaBytes - 1 }, 'EXPORT_FILE_SIZE_LIMIT'],
    [{ max_total_uncompressed_bytes: projectBytes + mediaBytes - 1 }, 'EXPORT_TOTAL_SIZE_LIMIT'],
    [{ max_memory_bytes: (projectBytes * 2) + 1100 }, 'EXPORT_MEMORY_LIMIT'],
  ];
  for (const [limits, code] of cases) {
    assert.throws(
      () => dramaExportService.exportDrama(
        fixture.db,
        { storage: { ...baseConfig.storage, project_export_limits: limits } },
        log,
        1
      ),
      (error) => error?.name === 'DramaExportError'
        && error?.code === code
        && error?.statusCode === 413
    );
  }

  const handlers = dramaRoutes(
    fixture.db,
    { storage: { ...baseConfig.storage, project_export_limits: { max_files: 1 } } },
    log
  );
  const responseState = { statusCode: 200, body: null };
  const res = {
    setHeader() {},
    status(value) { responseState.statusCode = value; return this; },
    json(value) { responseState.body = value; return this; },
    send() { throw new Error('over-limit export must not send a ZIP'); },
  };
  handlers.exportDrama({ params: { id: '1' } }, res);
  assert.equal(responseState.statusCode, 413);
  assert.equal(responseState.body.error.code, 'EXPORT_FILE_COUNT_LIMIT');
});

test('project export skips Draft placeholder history and packages the durable Production image', (t) => {
  const fixture = makeExportFixture(t);
  const now = '2026-07-16T12:00:00.000Z';
  const realPath = 'projects/export/storyboards/shot.png';
  fs.mkdirSync(path.join(fixture.storagePath, path.dirname(realPath)), { recursive: true });
  fs.writeFileSync(path.join(fixture.storagePath, realPath), PNG_BYTES);
  fixture.db.prepare(
    `INSERT INTO episodes (id, drama_id, episode_number, title, status, created_at, updated_at)
     VALUES (1, 1, 1, 'Episode 1', 'draft', ?, ?)`
  ).run(now, now);
  fixture.db.prepare(
    `INSERT INTO storyboards
       (id, episode_id, storyboard_number, title, status, created_at, updated_at)
     VALUES (1, 1, 1, 'Shot 1', 'media_ready', ?, ?)`
  ).run(now, now);
  const draftImage = fixture.db.prepare(
    `INSERT INTO image_generations
       (drama_id, storyboard_id, provider, prompt, frame_type, status, local_path, completed_at, created_at, updated_at)
     VALUES (1, 1, 'mock', 'draft', 'storyboard_first', 'completed', 'mock://dramas/1/storyboards/1/image.png', ?, ?, ?)`
  ).run(now, now, now);
  const productionImage = fixture.db.prepare(
    `INSERT INTO image_generations
       (drama_id, storyboard_id, provider, prompt, frame_type, status, local_path, completed_at, created_at, updated_at)
     VALUES (1, 1, 'openai', 'production', 'storyboard_first', 'completed', ?, ?, ?, ?)`
  ).run(realPath, now, now, now);
  fixture.db.prepare(
    'UPDATE storyboards SET first_frame_image_id = ?, local_path = ? WHERE id = 1'
  ).run(Number(productionImage.lastInsertRowid), realPath);

  const exported = dramaExportService.exportDrama(
    fixture.db,
    { storage: { local_path: fixture.storagePath } },
    log,
    1
  );
  const entries = new AdmZip(exported.buffer).getEntries().map((entry) => entry.entryName);
  assert.ok(entries.includes(`media/storyboards/sb_1_gen_${productionImage.lastInsertRowid}.png`));
  assert.equal(entries.includes(`media/storyboards/sb_1_gen_${draftImage.lastInsertRowid}.png`), false);
});

test('project export rejects media reached through a storage symlink', (t) => {
  const fixture = makeExportFixture(t);
  const baseConfig = { storage: { local_path: fixture.storagePath } };
  const outsidePath = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-export-outside-'));
  t.after(() => fs.rmSync(outsidePath, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outsidePath, 'secret.png'), 'outside-export-secret');
  fs.rmSync(path.join(fixture.storagePath, 'projects'), { recursive: true, force: true });
  try {
    createDirectoryLink(outsidePath, path.join(fixture.storagePath, 'projects'));
  } catch (error) {
    if (skipUnavailableSymlink(t, error)) return;
    throw error;
  }
  fixture.db.prepare('UPDATE characters SET local_path = ? WHERE id = 1')
    .run('projects/secret.png');
  assert.throws(
    () => dramaExportService.exportDrama(fixture.db, baseConfig, log, 1),
    (error) => error?.code === 'UNSAFE_EXPORT_STORAGE'
      && error?.statusCode === 400
      && error?.details?.archive_path === 'media/characters/char_1.png'
      && error?.details?.reason === 'SYMLINK'
  );
});
