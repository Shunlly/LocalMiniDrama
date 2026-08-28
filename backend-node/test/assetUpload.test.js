const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PassThrough } = require('stream');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');
const sharp = require('sharp');

const uploadRoutes = require('../src/routes/upload');
const uploadService = require('../src/services/uploadService');
const { getFfmpegPath } = require('../src/utils/ffmpegPath');
const { selectFixtureVideoEncoder } = require('./mediaFixture');

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

function isoBmffBytes(brand) {
  const buffer = Buffer.alloc(20);
  buffer.writeUInt32BE(buffer.length, 0);
  buffer.write('ftyp', 4, 'ascii');
  buffer.write(brand, 8, 'ascii');
  buffer.writeUInt32BE(0, 12);
  buffer.write(brand, 16, 'ascii');
  return buffer;
}

function createVideoFixture(directory, filename = 'sample.mp4', audioOnly = false) {
  const outputPath = path.join(directory, filename);
  const inputArgs = audioOnly
    ? ['-f', 'lavfi', '-i', 'sine=frequency=1000:duration=0.2', '-c:a', 'aac']
    : [
        '-f', 'lavfi', '-i', 'color=c=black:s=32x32:d=0.2',
        '-frames:v', '2', '-c:v', selectFixtureVideoEncoder(getFfmpegPath()), '-pix_fmt', 'yuv420p',
      ];
  const result = spawnSync(
    getFfmpegPath(),
    ['-hide_banner', '-loglevel', 'error', ...inputArgs, '-f', 'mp4', '-y', outputPath],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 }
  );
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return outputPath;
}

function createDb(withSchema = true) {
  const db = new Database(':memory:');
  if (withSchema) {
    db.exec(`
      CREATE TABLE dramas (
        id INTEGER PRIMARY KEY,
        title TEXT,
        deleted_at TEXT
      );
      CREATE TABLE assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        drama_id INTEGER,
        name TEXT,
        description TEXT,
        type TEXT,
        category TEXT,
        url TEXT,
        local_path TEXT,
        thumbnail_url TEXT,
        file_size INTEGER,
        mime_type TEXT,
        width INTEGER,
        height INTEGER,
        duration REAL,
        image_gen_id INTEGER,
        video_gen_id INTEGER,
        is_favorite INTEGER DEFAULT 0,
        created_at TEXT,
        updated_at TEXT,
        deleted_at TEXT
      );
    `);
  }
  return db;
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

function createLog() {
  return { info() {}, warn() {}, error() {} };
}

function filesUnder(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(fullPath));
    else files.push(fullPath);
  }
  return files;
}

function runMultipartMiddleware(middleware, contents, mimetype = 'application/octet-stream') {
  const boundary = `asset-upload-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="sample.bin"\r\nContent-Type: ${mimetype}\r\n\r\n`
  );
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([prefix, contents, suffix]);
  const req = new PassThrough();
  req.method = 'POST';
  req.url = '/assets/upload';
  req.headers = {
    'content-type': `multipart/form-data; boundary=${boundary}`,
    'content-length': String(body.length),
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err = null, nextCalled = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ err, nextCalled, req, res });
    };
    const res = createResponseCapture(() => finish());
    const timer = setTimeout(() => reject(new Error('upload middleware timed out')), 3000);
    middleware(req, res, (err) => finish(err, true));
    req.end(body);
  });
}

test('full media validation decodes supported images and probes a real video stream', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-valid-media-'));
  const sourceImage = {
    create: {
      width: 2,
      height: 2,
      channels: 3,
      background: { r: 20, g: 40, b: 60 },
    },
  };
  try {
    const imageCases = [
      [await sharp(sourceImage).jpeg().toBuffer(), 'image/jpeg', '.jpg'],
      [PNG_BYTES, 'image/png', '.png'],
      [await sharp(sourceImage).gif().toBuffer(), 'image/gif', '.gif'],
      [await sharp(sourceImage).webp().toBuffer(), 'image/webp', '.webp'],
    ];
    for (const [contents, mimeType, extension] of imageCases) {
      assert.deepEqual(await uploadService.validateAllowedUpload(contents), {
        mimeType,
        extension,
        mediaType: 'image',
      });
    }

    const videoPath = createVideoFixture(tempDir);
    assert.deepEqual(await uploadService.validateAllowedUpload(videoPath), {
      mimeType: 'video/mp4',
      extension: '.mp4',
      mediaType: 'video',
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('truncated or forged image and video containers fail full validation', async () => {
  const forgedCases = [
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.from('GIF89a', 'ascii'),
    Buffer.from('524946460400000057454250', 'hex'),
    isoBmffBytes('isom'),
  ];
  for (const contents of forgedCases) {
    await assert.rejects(
      uploadService.validateAllowedUpload(contents),
      (err) => err?.code === 'INVALID_MEDIA_CONTENT'
    );
  }
});

test('video validation rejects a real container that has no video stream', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-audio-only-'));
  try {
    const audioOnlyPath = createVideoFixture(tempDir, 'audio-only.m4a', true);
    await assert.rejects(
      uploadService.validateAllowedUpload(audioOnlyPath),
      (err) => err?.code === 'INVALID_MEDIA_CONTENT'
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('image upload ignores forged MIME and uses the decoded extension', async () => {
  const storagePath = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-image-'));
  const handlers = uploadRoutes.routes({ storage: { local_path: storagePath } }, createLog(), null);
  const req = {
    body: {},
    file: {
      buffer: PNG_BYTES,
      originalname: 'portrait.php',
      mimetype: 'application/x-msdownload',
      size: PNG_BYTES.length,
    },
  };
  const res = createResponseCapture();

  try {
    await handlers.uploadImage(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.filename, 'portrait.php');
    assert.match(res.body.data.local_path, /^uploads\/.+\.png$/);
    assert.equal(path.extname(res.body.data.local_path), '.png');
    assert.equal(fs.existsSync(path.join(storagePath, res.body.data.local_path)), true);
  } finally {
    fs.rmSync(storagePath, { recursive: true, force: true });
  }
});

test('material-center upload persists a probed video from disk and cleans its temporary file', async () => {
  const storagePath = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-asset-'));
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-upload-temp-'));
  const tempPath = path.join(tempDir, 'upload.tmp');
  createVideoFixture(tempDir, 'upload.tmp');
  const video = fs.readFileSync(tempPath);
  const db = createDb();
  const handlers = uploadRoutes.routes({ storage: { local_path: storagePath } }, createLog(), db);
  const req = {
    body: {},
    file: {
      path: tempPath,
      originalname: 'sample.jpg',
      mimetype: 'image/jpeg',
      size: video.length,
    },
  };
  const res = createResponseCapture();

  try {
    await handlers.uploadAsset(req, res);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.data.type, 'video');
    assert.equal(res.body.data.mime_type, 'video/mp4');
    assert.equal(res.body.data.name, 'sample.jpg');
    assert.match(res.body.data.local_path, /^uploads\/.+\.mp4$/);
    assert.deepEqual(fs.readFileSync(path.join(storagePath, res.body.data.local_path)), video);
    assert.equal(fs.existsSync(tempPath), false);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM assets').get().count, 1);
  } finally {
    db.close();
    fs.rmSync(storagePath, { recursive: true, force: true });
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('forged allowed MIME with unsupported content is rejected and cleaned', async () => {
  const storagePath = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-reject-'));
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-upload-temp-'));
  const tempPath = path.join(tempDir, 'upload.tmp');
  fs.writeFileSync(tempPath, Buffer.from('not-a-media-file'));
  const db = createDb();
  const handlers = uploadRoutes.routes({ storage: { local_path: storagePath } }, createLog(), db);
  const res = createResponseCapture();

  try {
    await handlers.uploadAsset({
      body: {},
      file: { path: tempPath, originalname: 'payload.mp4', mimetype: 'video/mp4', size: 16 },
    }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error.code, 'INVALID_MEDIA_CONTENT');
    assert.equal(fs.existsSync(tempPath), false);
    assert.deepEqual(filesUnder(storagePath), []);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM assets').get().count, 0);
  } finally {
    db.close();
    fs.rmSync(storagePath, { recursive: true, force: true });
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('asset database failure removes both temporary and persisted files', async () => {
  const storagePath = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-failure-'));
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-upload-temp-'));
  const tempPath = path.join(tempDir, 'upload.tmp');
  fs.writeFileSync(tempPath, PNG_BYTES);
  const db = createDb(false);
  const handlers = uploadRoutes.routes({ storage: { local_path: storagePath } }, createLog(), db);
  const res = createResponseCapture();

  try {
    await handlers.uploadAsset({
      body: {},
      file: { path: tempPath, originalname: 'image.png', mimetype: 'image/png', size: PNG_BYTES.length },
    }, res);
    assert.equal(res.statusCode, 500);
    assert.equal(fs.existsSync(tempPath), false);
    assert.deepEqual(filesUnder(storagePath), []);
  } finally {
    db.close();
    fs.rmSync(storagePath, { recursive: true, force: true });
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('asset BAD_REQUEST returns 400 and removes temporary and persisted files', async () => {
  const storagePath = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-bad-request-'));
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-upload-temp-'));
  const tempPath = path.join(tempDir, 'upload.tmp');
  fs.writeFileSync(tempPath, PNG_BYTES);
  const db = createDb();
  const handlers = uploadRoutes.routes({ storage: { local_path: storagePath } }, createLog(), db);
  const res = createResponseCapture();

  try {
    await handlers.uploadAsset({
      body: { drama_id: '0' },
      file: { path: tempPath, originalname: 'image.png', mimetype: 'image/png', size: PNG_BYTES.length },
    }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error.code, 'BAD_REQUEST');
    assert.equal(fs.existsSync(tempPath), false);
    assert.deepEqual(filesUnder(storagePath), []);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM assets').get().count, 0);
  } finally {
    db.close();
    fs.rmSync(storagePath, { recursive: true, force: true });
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('disk middleware rejects over-limit uploads without leaving temporary files', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-limit-'));
  const middleware = uploadRoutes.createMediaUploadMiddleware({
    maxBytes: 8,
    maxSizeMb: 1,
    tempDir,
  });
  try {
    const outcome = await runMultipartMiddleware(middleware, PNG_BYTES, 'image/png');
    assert.equal(outcome.nextCalled, false);
    assert.equal(outcome.res.statusCode, 413);
    assert.equal(outcome.res.body.error.code, 'FILE_TOO_LARGE');
    assert.deepEqual(filesUnder(tempDir), []);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('disk middleware keeps media out of memory and cleans after the response', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-disk-upload-'));
  const middleware = uploadRoutes.createMediaUploadMiddleware({
    maxBytes: 1024,
    maxSizeMb: 1,
    tempDir,
  });
  try {
    const outcome = await runMultipartMiddleware(middleware, PNG_BYTES, 'video/mp4');
    assert.equal(outcome.err, null);
    assert.equal(outcome.nextCalled, true);
    assert.equal(outcome.req.file.buffer, undefined);
    assert.equal(outcome.req.file.mimetype, 'image/png');
    assert.equal(fs.existsSync(outcome.req.file.path), true);
    outcome.res.emit('finish');
    assert.equal(fs.existsSync(outcome.req.file.path), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('upload admission rejects concurrent work before another body is written', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-concurrency-'));
  const middleware = uploadRoutes.createMediaUploadMiddleware({
    maxBytes: 1024,
    maxSizeMb: 1,
    maxConcurrent: 1,
    diskReserveBytes: 0,
    getAvailableBytes: () => Number.POSITIVE_INFINITY,
    tempDir,
  });
  try {
    const first = await runMultipartMiddleware(middleware, PNG_BYTES, 'image/png');
    assert.equal(first.nextCalled, true);
    const second = await runMultipartMiddleware(middleware, PNG_BYTES, 'image/png');
    assert.equal(second.nextCalled, false);
    assert.equal(second.res.statusCode, 429);
    assert.equal(second.res.body.error.code, 'UPLOAD_BUSY');
    assert.equal(filesUnder(tempDir).length, 1);

    first.res.emit('finish');
    assert.deepEqual(filesUnder(tempDir), []);

    const third = await runMultipartMiddleware(middleware, PNG_BYTES, 'image/png');
    assert.equal(third.nextCalled, true);
    third.res.emit('finish');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('upload admission preserves disk reserve and writes no temporary file', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-reserve-'));
  const middleware = uploadRoutes.createMediaUploadMiddleware({
    maxBytes: 1024,
    maxSizeMb: 1,
    diskReserveBytes: 1024,
    getAvailableBytes: () => 1024,
    tempDir,
  });
  try {
    const outcome = await runMultipartMiddleware(middleware, PNG_BYTES, 'image/png');
    assert.equal(outcome.nextCalled, false);
    assert.equal(outcome.res.statusCode, 507);
    assert.equal(outcome.res.body.error.code, 'INSUFFICIENT_STORAGE');
    assert.deepEqual(filesUnder(tempDir), []);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('disk capacity check accounts for the requested bytes and configured reserve', () => {
  assert.throws(
    () => uploadService.assertUploadDiskCapacity('unused', 50, 100, () => 149),
    (err) => err?.code === 'INSUFFICIENT_STORAGE'
  );
  assert.deepEqual(
    uploadService.assertUploadDiskCapacity('unused', 50, 100, () => 150),
    { availableBytes: 150, requiredBytes: 50, reserveBytes: 100 }
  );
});

test('原子写入在暂存异常时保留旧成品并清理暂存文件', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-atomic-write-'));
  const finalPath = path.join(root, 'image.jpg');
  fs.writeFileSync(finalPath, 'old-image');
  try {
    assert.throws(
      () => uploadService.writeFileAtomically(finalPath, (stagedPath) => {
        fs.writeFileSync(stagedPath, 'partial-image');
        throw new Error('模拟进程异常');
      }),
      /模拟进程异常/
    );
    assert.equal(fs.readFileSync(finalPath, 'utf8'), 'old-image');
    assert.deepEqual(fs.readdirSync(root), ['image.jpg']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('原子发布 rename 失败时恢复旧成品且不暴露半成品', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-atomic-rename-'));
  const finalPath = path.join(root, 'video.mp4');
  const stagedPath = path.join(root, '.video.mp4.staged');
  fs.writeFileSync(finalPath, 'old-video');
  fs.writeFileSync(stagedPath, 'new-video');
  const originalRenameSync = fs.renameSync;
  fs.renameSync = (sourcePath, destinationPath) => {
    if (path.resolve(sourcePath) === path.resolve(stagedPath)
      && path.resolve(destinationPath) === path.resolve(finalPath)) {
      const error = new Error('模拟发布中断');
      error.code = 'EIO';
      throw error;
    }
    return originalRenameSync(sourcePath, destinationPath);
  };
  try {
    assert.throws(
      () => uploadService.publishStagedFile(stagedPath, finalPath),
      /模拟发布中断/
    );
    assert.equal(fs.readFileSync(finalPath, 'utf8'), 'old-video');
    assert.equal(fs.existsSync(stagedPath), false);
    assert.equal(fs.readdirSync(root).length, 1);
  } finally {
    fs.renameSync = originalRenameSync;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('原子发布成功后只留下已验证的新成品', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-atomic-success-'));
  const finalPath = path.join(root, 'audio.mp3');
  const stagedPath = path.join(root, '.audio.mp3.staged');
  fs.writeFileSync(finalPath, 'old-audio');
  fs.writeFileSync(stagedPath, 'new-audio');
  try {
    const publication = uploadService.publishStagedFile(stagedPath, finalPath);
    publication.commit();
    assert.equal(fs.readFileSync(finalPath, 'utf8'), 'new-audio');
    assert.equal(fs.existsSync(stagedPath), false);
    assert.equal(fs.readdirSync(root).length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('image proxy upload is skipped until an upload URL is explicitly configured', async () => {
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error('network must not be called');
  };

  try {
    const result = await uploadService.uploadToImageProxy(
      PNG_BYTES,
      'image/png',
      { info() {}, warn() {}, error() {} },
      'opt-in-test'
    );
    assert.equal(result, null);
    assert.equal(fetchCalls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test('media type classification and limits remain available', () => {
  assert.equal(uploadRoutes.mediaTypeFromMime('video/webm'), 'video');
  assert.equal(uploadRoutes.mediaTypeFromMime('image/png'), 'image');
  assert.equal(uploadRoutes.MEDIA_MAX_SIZE_MB, 100);
});
