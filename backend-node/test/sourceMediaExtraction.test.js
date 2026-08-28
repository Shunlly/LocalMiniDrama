const { after, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fsp = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');
const sharp = require('sharp');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const storySourceRoutes = require('../src/routes/storySources');
const { getFfmpegPath } = require('../src/utils/ffmpegPath');
const { selectFixtureVideoEncoder } = require('./mediaFixture');
const { requestBounded } = require('../src/services/sourceMediaExtractionService');

const TEST_TOKEN = 'unit-test-token-not-a-real-key';
const previousStorySourceRoot = process.env.LOCALMINIDRAMA_TEST_STORY_SOURCE_ROOT;
const storySourceRoot = path.join(os.tmpdir(), `localminidrama-source-media-test-${process.pid}-${Date.now()}`);
const fakeExtractionServers = [];
process.env.LOCALMINIDRAMA_TEST_STORY_SOURCE_ROOT = storySourceRoot;

after(async () => {
  await Promise.all(fakeExtractionServers.splice(0).map(
    (server) => new Promise((resolve) => server.close(resolve))
  ));
  if (previousStorySourceRoot == null) delete process.env.LOCALMINIDRAMA_TEST_STORY_SOURCE_ROOT;
  else process.env.LOCALMINIDRAMA_TEST_STORY_SOURCE_ROOT = previousStorySourceRoot;
  await fsp.rm(storySourceRoot, { recursive: true, force: true });
});

function createDb() {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO dramas (id, title, description, style, status, created_at, updated_at)
     VALUES (1, 'Media Source Test', '', '', 'draft', ?, ?)`
  ).run(now, now);
  return db;
}

function addAiConfig(db, serviceType, baseUrl, options = {}) {
  const now = new Date().toISOString();
  const info = db.prepare(
    `INSERT INTO ai_service_configs
     (service_type, provider, name, base_url, api_key, model, endpoint, priority, is_default, is_active, settings, created_at, updated_at)
     VALUES (?, 'local-test', 'Local test service', ?, ?, ?, ?, 100, 1, 1, ?, ?, ?)`
  ).run(
    serviceType,
    baseUrl,
    TEST_TOKEN,
    JSON.stringify([options.model || `${serviceType}-test-model`]),
    options.endpoint || '',
    JSON.stringify(options.settings || { timeout_ms: 5000 }),
    now,
    now
  );
  return Number(info.lastInsertRowid);
}

function createLog() {
  const records = [];
  return {
    records,
    info(message, fields) { records.push({ level: 'info', message, fields }); },
    warn(message, fields) { records.push({ level: 'warn', message, fields }); },
    error(message, fields) { records.push({ level: 'error', message, fields }); },
  };
}

function mockResponse() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = String(value);
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
  };
}

function createRoutes(db, log, options = {}) {
  return storySourceRoutes(db, log, {
    storagePath: storySourceRoot,
    ...options,
  });
}

async function listFiles(root) {
  const files = [];
  async function visit(current, relative) {
    let entries;
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const child = path.join(current, entry.name);
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(child, childRelative);
      else files.push(childRelative.replace(/\\/g, '/'));
    }
  }
  await visit(root, '');
  return files.sort();
}

async function assertRetainedOriginal(result, expectedBytes, expectedMime) {
  const original = result.source.metadata.original_file;
  assert.ok(original);
  assert.match(
    original.storage_path,
    new RegExp(`^story_sources/${result.source.drama_id}/${result.source.id}/original/[0-9a-f-]+\\.[a-z0-9]+$`)
  );
  assert.match(
    original.server_filename,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]+$/
  );
  assert.equal(path.posix.basename(original.storage_path), original.server_filename);
  assert.equal(original.sha256, createHash('sha256').update(expectedBytes).digest('hex'));
  assert.equal(original.size, expectedBytes.length);
  assert.equal(original.mime, expectedMime);
  assert.equal(original.download_url, `/api/v1/story-sources/${result.source.id}/original`);

  const absolutePath = path.resolve(storySourceRoot, ...original.storage_path.split('/'));
  const relation = path.relative(path.resolve(storySourceRoot), absolutePath);
  assert.equal(relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation), false);
  assert.deepEqual(await fsp.readFile(absolutePath), expectedBytes);
  return original;
}

async function readRequest(req, maxBytes = 30 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('fake service request too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

async function startFakeExtractionService(options = {}) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    try {
      const body = await readRequest(req);
      const common = {
        path: req.url,
        method: req.method,
        content_type: String(req.headers['content-type'] || ''),
        used_test_authorization: req.headers.authorization === `Bearer ${TEST_TOKEN}`,
        body_bytes: body.length,
      };
      if (req.url === '/v1/chat/completions') {
        const payload = JSON.parse(body.toString('utf8'));
        const imageUrl = payload?.messages?.[0]?.content?.find((part) => part.type === 'image_url')?.image_url?.url || '';
        requests.push({
          ...common,
          kind: 'ocr',
          has_image_data_url: /^data:image\/(?:png|jpeg);base64,/.test(imageUrl),
          model: payload.model,
        });
        res.writeHead(options.ocrStatus || 200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(options.ocrStatus && options.ocrStatus !== 200
          ? { error: { message: 'local test failure' } }
          : { choices: [{ message: { content: options.ocrText || 'Characters: Mira\nLocation: Harbor\nMira finds a coded sign.' } }] }));
        return;
      }
      if (req.url === '/v1/audio/transcriptions') {
        const multipart = body.toString('latin1');
        requests.push({
          ...common,
          kind: 'transcription',
          has_file_part: /name="file"; filename="[^"]+"/.test(multipart),
          has_model_part: /name="model"\r\n\r\ntranscription-test-model/.test(multipart),
        });
        res.writeHead(options.transcriptionStatus || 200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(options.transcriptionStatus && options.transcriptionStatus !== 200
          ? { error: { message: 'local test failure' } }
          : { text: options.transcriptText || 'Speaker 1: The hidden door is open.' }));
        return;
      }
      requests.push({ ...common, kind: 'unknown' });
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{}');
    } catch (_) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end('{}');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  fakeExtractionServers.push(server);
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () => new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve())),
  };
}

function buildPdf(objectBodies) {
  const chunks = [Buffer.from('%PDF-1.4\n', 'ascii')];
  const offsets = [0];
  let length = chunks[0].length;
  objectBodies.forEach((body, index) => {
    offsets[index + 1] = length;
    const object = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`, 'ascii'),
      Buffer.isBuffer(body) ? body : Buffer.from(body, 'ascii'),
      Buffer.from('\nendobj\n', 'ascii'),
    ]);
    chunks.push(object);
    length += object.length;
  });
  const xrefOffset = length;
  const rows = ['xref', `0 ${objectBodies.length + 1}`, '0000000000 65535 f '];
  for (let index = 1; index <= objectBodies.length; index += 1) {
    rows.push(`${String(offsets[index]).padStart(10, '0')} 00000 n `);
  }
  chunks.push(Buffer.from(
    `${rows.join('\n')}\ntrailer\n<< /Size ${objectBodies.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
    'ascii'
  ));
  return Buffer.concat(chunks);
}

function textPdf(text) {
  const escaped = String(text).replace(/([\\()])/g, '\\$1');
  const stream = `BT\n/F1 14 Tf\n72 720 Td\n(${escaped}) Tj\nET`;
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream`,
  ]);
}

function scannedPdf() {
  const imageObject = Buffer.concat([
    Buffer.from('<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 1 >>\nstream\n', 'ascii'),
    Buffer.from([0]),
    Buffer.from('\nendstream', 'ascii'),
  ]);
  const stream = 'q\n300 0 0 300 72 400 cm\n/Im0 Do\nQ';
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>',
    imageObject,
    `<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream`,
  ]);
}

function wavAudio() {
  const samples = Buffer.alloc(320);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + samples.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(samples.length, 40);
  return Buffer.concat([header, samples]);
}

async function realVideoBuffer(directory) {
  const outputPath = path.join(directory, 'fixture-with-audio.mp4');
  const result = spawnSync(getFfmpegPath(), [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=black:s=32x32:d=0.3',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.3',
    '-shortest', '-c:v', selectFixtureVideoEncoder(getFfmpegPath()), '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    outputPath,
  ], { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 20000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const buffer = await fsp.readFile(outputPath);
  await fsp.unlink(outputPath);
  return buffer;
}

function assertSafeMetadata(metadata, extractedText) {
  const serialized = JSON.stringify(metadata);
  assert.equal(serialized.includes(TEST_TOKEN), false);
  assert.equal(serialized.includes(extractedText), false);
  assert.equal(Object.hasOwn(metadata, 'api_key'), false);
  assert.equal(Object.hasOwn(metadata, 'raw_text'), false);
}

describe('sourceMediaExtraction: Source Intake media extraction', () => {
  it('does not let a configured public extraction hostname rebind to loopback', async () => {
    await assert.rejects(
      requestBounded('http://ocr-provider.example/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }, {
        timeoutMs: 1000,
        maxResponseBytes: 1024,
        label: 'OCR service',
        trustedOrigins: ['http://ocr-provider.example'],
        networkLookup: async () => [{ address: '127.0.0.1', family: 4 }],
      }),
      /无法连接/
    );
  });

  it('extracts a text PDF with PDF.js before creating traceable Story IR', async () => {
    const db = createDb();
    const log = createLog();
    const routes = createRoutes(db, log);
    const res = mockResponse();
    const pdf = textPdf('Characters: Aria. Location: Gate. Aria discovers a secret map.');

    await routes.uploadForDrama({
      params: { id: 1 },
      body: {},
      file: { originalname: 'chapter.pdf', mimetype: 'application/pdf', size: pdf.length, buffer: pdf },
    }, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.data.source.metadata.extraction_method, 'pdf_text');
    assert.equal(res.body.data.source.metadata.page_count, 1);
    assert.match(res.body.data.items[0].raw_text, /Aria discovers a secret map/);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM story_sources').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM story_events').get().count >= 1, true);
    const retained = await assertRetainedOriginal(res.body.data, pdf, 'application/pdf');
    const download = mockResponse();
    routes.downloadOriginal({ params: { source_id: res.body.data.source.id } }, download);
    assert.equal(download.statusCode, 200);
    assert.deepEqual(download.body, pdf);
    assert.equal(download.headers['content-type'], 'application/pdf');
    assert.equal(download.headers['x-content-sha256'], retained.sha256);
    assert.equal(download.headers['cache-control'], 'private, no-store');
    assertSafeMetadata(res.body.data.source.metadata, 'Aria discovers a secret map');
    db.close();
  });

  it('renders an image-only PDF and OCRs it through a local OpenAI-compatible service', async () => {
    const fake = await startFakeExtractionService({ ocrText: 'Characters: Inez\nLocation: Archive\nInez reads the warning.' });
    const db = createDb();
    try {
      const configId = addAiConfig(db, 'ocr', fake.baseUrl);
      const routes = createRoutes(db, createLog());
      const res = mockResponse();
      const pdf = scannedPdf();
      await routes.uploadForDrama({
        params: { id: 1 }, body: {},
        file: { originalname: 'scan.pdf', mimetype: 'application/pdf', size: pdf.length, buffer: pdf },
      }, res);

      assert.equal(res.statusCode, 201);
      assert.equal(res.body.data.source.metadata.extraction_method, 'openai_compatible_ocr');
      assert.equal(res.body.data.source.metadata.ocr_page_count, 1);
      assert.equal(res.body.data.source.metadata.extraction_config_id, configId);
      assert.equal(fake.requests.length, 1);
      assert.equal(fake.requests[0].has_image_data_url, true);
      assert.equal(fake.requests[0].used_test_authorization, true);
      assertSafeMetadata(res.body.data.source.metadata, 'Inez reads the warning');
    } finally {
      db.close();
      await fake.close();
    }
  });

  it('OCRs a validated image through the local OpenAI-compatible service', async () => {
    const fake = await startFakeExtractionService();
    const db = createDb();
    try {
      addAiConfig(db, 'ocr', fake.baseUrl);
      const image = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#ffffff' } }).png().toBuffer();
      const routes = createRoutes(db, createLog());
      const res = mockResponse();
      await routes.uploadForDrama({
        params: { id: 1 },
        body: { metadata: '{"source_language":"en","api_key":"must-not-persist","raw_text":"must-not-persist"}' },
        file: { originalname: '../panel.png', mimetype: 'image/png', size: image.length, buffer: image },
      }, res);

      assert.equal(res.statusCode, 201);
      assert.equal(res.body.data.source.metadata.uploaded_filename, 'panel.png');
      assert.equal(res.body.data.source.metadata.extraction_method, 'openai_compatible_ocr');
      assert.equal(res.body.data.source.metadata.source_language, 'en');
      assert.equal(Object.hasOwn(res.body.data.source.metadata, 'api_key'), false);
      assert.equal(Object.hasOwn(res.body.data.source.metadata, 'raw_text'), false);
      assert.equal(fake.requests[0].kind, 'ocr');
      assert.equal(fake.requests[0].has_image_data_url, true);
      await assertRetainedOriginal(res.body.data, image, 'image/png');
      assertSafeMetadata(res.body.data.source.metadata, 'Mira finds a coded sign');
    } finally {
      db.close();
      await fake.close();
    }
  });

  it('transcribes validated audio through a local OpenAI-compatible service', async () => {
    const fake = await startFakeExtractionService({ transcriptText: 'Speaker 1: The train leaves at dawn.' });
    const db = createDb();
    try {
      const configId = addAiConfig(db, 'transcription', fake.baseUrl);
      const audio = wavAudio();
      const routes = createRoutes(db, createLog());
      const res = mockResponse();
      await routes.uploadForDrama({
        params: { id: 1 }, body: { source_type: 'transcript' },
        file: { originalname: 'dialogue.wav', mimetype: 'audio/wav', size: audio.length, buffer: audio },
      }, res);

      assert.equal(res.statusCode, 201);
      assert.equal(res.body.data.source.metadata.extraction_method, 'openai_compatible_transcription');
      assert.equal(res.body.data.source.metadata.extraction_config_id, configId);
      assert.equal(fake.requests[0].has_file_part, true);
      assert.equal(fake.requests[0].has_model_part, true);
      assert.match(res.body.data.items[0].raw_text, /train leaves at dawn/);
      assertSafeMetadata(res.body.data.source.metadata, 'train leaves at dawn');
    } finally {
      db.close();
      await fake.close();
    }
  });

  it('extracts a video audio track with FFmpeg before local transcription and cleans temp files', async () => {
    const fake = await startFakeExtractionService({ transcriptText: 'Narrator: The signal appears on screen.' });
    const db = createDb();
    const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'localminidrama-video-success-test-'));
    try {
      addAiConfig(db, 'transcription', fake.baseUrl);
      const routes = createRoutes(db, createLog(), {
        extractionOptions: { tempRoot },
      });
      const video = await realVideoBuffer(tempRoot);
      const res = mockResponse();
      await routes.uploadForDrama({
        params: { id: 1 }, body: { source_type: 'transcript' },
        file: { originalname: 'scene.mp4', mimetype: 'video/mp4', size: video.length, buffer: video },
      }, res);

      assert.equal(res.statusCode, 201);
      assert.equal(res.body.data.source.metadata.extraction_method, 'ffmpeg_openai_compatible_transcription');
      assert.equal(res.body.data.source.metadata.video_audio_extracted, true);
      assert.equal(res.body.data.source.metadata.video_duration_seconds > 0, true);
      await assertRetainedOriginal(res.body.data, video, 'video/mp4');
      assert.deepEqual(await fsp.readdir(tempRoot), []);
      assertSafeMetadata(res.body.data.source.metadata, 'signal appears on screen');
    } finally {
      db.close();
      await fake.close();
      await fsp.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('removes the retained original when a later Story IR database write rolls back', async () => {
    const db = createDb();
    const storageRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'localminidrama-source-rollback-'));
    const filesBefore = await listFiles(storySourceRoot);
    try {
      db.exec(`CREATE TRIGGER fail_story_source_items
        BEFORE INSERT ON source_items
        BEGIN
          SELECT RAISE(ABORT, 'forced source item failure');
        END;`);
      const routes = createRoutes(db, createLog(), { storagePath: storageRoot });
      const pdf = textPdf('Characters: Rollback. Location: Vault. Rollback opens a unique sealed file.');
      const res = mockResponse();

      await routes.uploadForDrama({
        params: { id: 1 }, body: {},
        file: { originalname: 'rollback.pdf', mimetype: 'application/pdf', size: pdf.length, buffer: pdf },
      }, res);

      assert.equal(res.statusCode, 500);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM story_sources').get().count, 0);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM source_items').get().count, 0);
      assert.deepEqual(await listFiles(storageRoot), []);
      assert.deepEqual(await listFiles(storySourceRoot), filesBefore);
    } finally {
      db.close();
      await fsp.rm(storageRoot, { recursive: true, force: true });
    }
  });

  it('enforces the per-drama original quota without leaving database rows or files', async () => {
    const db = createDb();
    const storageRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'localminidrama-source-quota-'));
    try {
      const pdf = textPdf('Characters: Quota. Location: Dock. Quota reviews the storage ledger.');
      const routes = createRoutes(db, createLog(), {
        storagePath: storageRoot,
        originalQuotaBytes: pdf.length - 1,
        getAvailableBytes: () => Number.MAX_SAFE_INTEGER,
      });
      const res = mockResponse();
      await routes.uploadForDrama({
        params: { id: 1 }, body: {},
        file: { originalname: 'quota.pdf', mimetype: 'application/pdf', size: pdf.length, buffer: pdf },
      }, res);

      assert.equal(res.statusCode, 507);
      assert.equal(res.body.error.code, 'SOURCE_ORIGINAL_QUOTA_EXCEEDED');
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM story_sources').get().count, 0);
      assert.deepEqual(await listFiles(storageRoot), []);
    } finally {
      db.close();
      await fsp.rm(storageRoot, { recursive: true, force: true });
    }
  });

  it('binds original downloads to the source directory even if database metadata is tampered', async () => {
    const db = createDb();
    const storageRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'localminidrama-source-download-path-'));
    try {
      const routes = createRoutes(db, createLog(), { storagePath: storageRoot });
      const pdf = textPdf('Characters: Bound. Location: Archive. Bound verifies the retained source.');
      const upload = mockResponse();
      await routes.uploadForDrama({
        params: { id: 1 }, body: {},
        file: { originalname: 'bound.pdf', mimetype: 'application/pdf', size: pdf.length, buffer: pdf },
      }, upload);
      assert.equal(upload.statusCode, 201);

      const metadata = upload.body.data.source.metadata;
      metadata.original_file.storage_path = '../outside.pdf';
      db.prepare('UPDATE story_sources SET metadata = ? WHERE id = ?')
        .run(JSON.stringify(metadata), upload.body.data.source.id);

      const download = mockResponse();
      routes.downloadOriginal({ params: { source_id: upload.body.data.source.id } }, download);
      assert.equal(download.statusCode, 500);
      assert.equal(download.body.error.code, 'INTERNAL_ERROR');
      assert.equal(Buffer.isBuffer(download.body), false);
    } finally {
      db.close();
      await fsp.rm(storageRoot, { recursive: true, force: true });
    }
  });

  it('rejects a symbolic-link source directory and never writes outside storage', async (t) => {
    const db = createDb();
    const storageRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'localminidrama-source-symlink-'));
    const outsideRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'localminidrama-source-outside-'));
    try {
      const dramaDirectory = path.join(storageRoot, 'story_sources', '1');
      await fsp.mkdir(dramaDirectory, { recursive: true });
      try {
        await fsp.symlink(
          outsideRoot,
          path.join(dramaDirectory, '1'),
          process.platform === 'win32' ? 'junction' : 'dir'
        );
      } catch (error) {
        if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) {
          t.skip(`symbolic links are unavailable: ${error.code}`);
          return;
        }
        throw error;
      }

      const routes = createRoutes(db, createLog(), { storagePath: storageRoot });
      const pdf = textPdf('Characters: Link. Location: Gate. Link tests a protected directory.');
      const res = mockResponse();
      await routes.uploadForDrama({
        params: { id: 1 }, body: {},
        file: { originalname: 'link.pdf', mimetype: 'application/pdf', size: pdf.length, buffer: pdf },
      }, res);

      assert.equal(res.statusCode, 500);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM story_sources').get().count, 0);
      assert.deepEqual(await listFiles(outsideRoot), []);
    } finally {
      db.close();
      await fsp.rm(storageRoot, { recursive: true, force: true });
      await fsp.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('cleans video temp files and creates no Story IR when transcription fails', async () => {
    const fake = await startFakeExtractionService({ transcriptionStatus: 503 });
    const db = createDb();
    const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'localminidrama-video-failure-test-'));
    const log = createLog();
    try {
      addAiConfig(db, 'transcription', fake.baseUrl);
      const routes = createRoutes(db, log, {
        extractionOptions: { tempRoot },
      });
      const video = await realVideoBuffer(tempRoot);
      const res = mockResponse();
      await routes.uploadForDrama({
        params: { id: 1 }, body: {},
        file: { originalname: 'failure.mp4', mimetype: 'video/mp4', size: video.length, buffer: video },
      }, res);

      assert.equal(res.statusCode, 400);
      assert.match(res.body.error.message, /转写服务.*HTTP 503/);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM story_sources').get().count, 0);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM source_items').get().count, 0);
      assert.deepEqual(await fsp.readdir(tempRoot), []);
      assert.equal(JSON.stringify(log.records).includes(TEST_TOKEN), false);
      assert.equal(JSON.stringify(log.records).includes(fake.baseUrl), false);
    } finally {
      db.close();
      await fake.close();
      await fsp.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('returns an actionable error and cleans OCR temp files when no OCR option is available', async () => {
    const db = createDb();
    const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'localminidrama-ocr-missing-test-'));
    try {
      const image = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#ffffff' } }).png().toBuffer();
      const routes = createRoutes(db, createLog(), {
        extractionOptions: { tempRoot, tesseractPath: path.join(tempRoot, 'missing-tesseract') },
      });
      const res = mockResponse();
      await routes.uploadForDrama({
        params: { id: 1 }, body: {},
        file: { originalname: 'needs-ocr.png', mimetype: 'image/png', size: image.length, buffer: image },
      }, res);

      assert.equal(res.statusCode, 400);
      assert.match(res.body.error.message, /service_type=ocr/i);
      assert.match(res.body.error.message, /Tesseract/i);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM story_sources').get().count, 0);
      assert.deepEqual(await fsp.readdir(tempRoot), []);
    } finally {
      db.close();
      await fsp.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('rejects MIME/signature mismatches before contacting OCR', async () => {
    const fake = await startFakeExtractionService();
    const db = createDb();
    try {
      addAiConfig(db, 'ocr', fake.baseUrl);
      const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
      const routes = createRoutes(db, createLog());
      const res = mockResponse();
      await routes.uploadForDrama({
        params: { id: 1 }, body: {},
        file: { originalname: 'spoof.png', mimetype: 'image/png', size: jpeg.length, buffer: jpeg },
      }, res);

      assert.equal(res.statusCode, 400);
      assert.match(res.body.error.message, /扩展名.*文件签名/);
      assert.equal(fake.requests.length, 0);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM story_sources').get().count, 0);
    } finally {
      db.close();
      await fake.close();
    }
  });
});
