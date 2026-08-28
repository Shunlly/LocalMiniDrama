'use strict';

const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const express = require('express');

const assetService = require('../src/services/assetService');
const networkMediaService = require('../src/services/networkMediaService');
const { secureHttpFetch } = require('../src/services/secureHttpFetch');
const { setupRouter } = require('../src/routes');

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);
const SOURCE_URL = 'https://commons.wikimedia.org/wiki/File%3ASafe_Test.png';
const DOWNLOAD_URL = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Safe_Test.png';
const PNG_SHA1 = createHash('sha1').update(PNG_BYTES).digest('hex');

function createDb({ valid = true } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY,
      title TEXT,
      created_at TEXT,
      metadata TEXT,
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
      deleted_at TEXT${valid ? '' : ', required_value TEXT NOT NULL'}
    );
  `);
  return db;
}

function createDbWithRecycleState() {
  const db = createDb();
  db.exec('ALTER TABLE dramas ADD COLUMN trash_state TEXT');
  return db;
}

function commonsPayload(overrides = {}) {
  return {
    query: {
      pages: [{
        pageid: 10,
        ns: 6,
        title: 'File:Safe Test.png',
        imageinfo: [{
          url: DOWNLOAD_URL,
          thumburl: 'https://upload.wikimedia.org/thumb/Safe_Test.png',
          mime: 'image/png',
          size: PNG_BYTES.length,
          width: 1,
          height: 1,
          timestamp: '2026-08-02T00:00:00Z',
          sha1: PNG_SHA1,
          extmetadata: {
            Artist: { value: '<a href="/wiki/User:Alice">Alice &amp; Bob</a>' },
            LicenseShortName: { value: 'CC BY-SA 4.0' },
            LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0/' },
          },
          ...overrides,
        }],
      }],
    },
  };
}

function response(body, options = {}) {
  return new Response(body, {
    status: options.status || 200,
    headers: { 'content-type': options.contentType || 'application/json' },
  });
}

function mockCommonsFetch(options = {}) {
  const calls = [];
  const fetch = async (url, _request, networkOptions) => {
    const target = String(url);
    calls.push({ url: target, networkOptions });
    if (target.startsWith(networkMediaService.COMMONS_API_URL)) {
      return response(JSON.stringify(options.payload || commonsPayload()));
    }
    const mediaResponse = response(options.buffer || PNG_BYTES, {
      contentType: options.contentType || 'image/png',
    });
    Object.defineProperty(mediaResponse, 'url', { value: options.finalUrl || DOWNLOAD_URL });
    return mediaResponse;
  };
  return { calls, fetch };
}

function filesUnder(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath || entry.path, entry.name));
}

function closeServer(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

test('网络搜索仅返回支持的 Commons 媒体并保留作者与许可元数据', async () => {
  const mock = mockCommonsFetch();
  const result = await networkMediaService.search({
    keyword: ' safe test ',
    media_type: 'image',
    page_size: 10,
  }, { fetch: mock.fetch });

  assert.equal(result.source, 'Wikimedia Commons');
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0], {
    title: 'Safe Test.png',
    thumbnail_url: 'https://upload.wikimedia.org/thumb/Safe_Test.png',
    source_url: SOURCE_URL,
    download_url: DOWNLOAD_URL,
    author: 'Alice & Bob',
    license: 'CC BY-SA 4.0',
    license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    commons_page_id: 10,
    commons_revision_timestamp: '2026-08-02T00:00:00Z',
    commons_sha1: PNG_SHA1,
    media_type: 'image',
    width: 1,
    height: 1,
  });
  assert.equal(mock.calls[0].networkOptions.requireHttpsForPublic, true);
  assert.equal(mock.calls[0].networkOptions.maxBytes, 2 * 1024 * 1024);
});

test('网络搜索接受规范 type 参数、兼容旧参数并拒绝冲突值', async () => {
  const byType = await networkMediaService.search({ keyword: 'safe', type: 'image' }, {
    fetch: mockCommonsFetch().fetch,
  });
  const byLegacyType = await networkMediaService.search({ keyword: 'safe', media_type: 'image' }, {
    fetch: mockCommonsFetch().fetch,
  });
  assert.equal(byType.items.length, 1);
  assert.equal(byLegacyType.items.length, 1);
  await assert.rejects(
    networkMediaService.search({ keyword: 'safe', type: 'image', media_type: 'video' }),
    (error) => error?.code === 'BAD_REQUEST'
  );
});

test('网络请求在连接前拒绝解析到私网地址的 Commons 主机', async () => {
  let lookupCalls = 0;
  await assert.rejects(
    networkMediaService.search({ keyword: 'private target' }, {
      lookup: async () => {
        lookupCalls += 1;
        return [{ address: '127.0.0.1', family: 4 }];
      },
    }),
    (error) => error?.code === 'UNSAFE_NETWORK_MEDIA_URL'
  );
  assert.equal(lookupCalls, 1);
});

test('安全下载逐跳复验重定向并拒绝跳向私网', async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data' });
    res.end();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const sourceOrigin = `http://network-media.test:${server.address().port}`;
  try {
    await assert.rejects(
      secureHttpFetch(`${sourceOrigin}/asset`, {}, {
        trustedOrigins: [sourceOrigin],
        allowPrivateOrigins: [sourceOrigin],
        lookup: async (hostname) => [{
          address: hostname === 'network-media.test' ? '127.0.0.1' : '169.254.169.254',
          family: 4,
        }],
      }),
      (error) => error?.code === 'UNSAFE_MEDIA_REFERENCE'
    );
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('导入拒绝过大声明、错误 Content-Type 和伪造媒体内容', async (t) => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-network-reject-'));
  t.after(() => fs.rmSync(storageRoot, { recursive: true, force: true }));

  const oversized = mockCommonsFetch({
    payload: commonsPayload({ size: networkMediaService.MAX_IMAGE_BYTES + 1 }),
  });
  await assert.rejects(
    networkMediaService.prepareImport({ source_url: SOURCE_URL }, {
      fetch: oversized.fetch,
      storageRoot,
    }),
    (error) => error?.code === 'NETWORK_MEDIA_TOO_LARGE' && error.statusCode === 413
  );
  assert.equal(oversized.calls.length, 1);

  const wrongType = mockCommonsFetch({ contentType: 'text/html' });
  await assert.rejects(
    networkMediaService.prepareImport({ source_url: SOURCE_URL }, {
      fetch: wrongType.fetch,
      storageRoot,
    }),
    (error) => error?.code === 'NETWORK_MEDIA_INVALID_CONTENT_TYPE'
  );

  const forged = mockCommonsFetch({ buffer: Buffer.from('not a png') });
  await assert.rejects(
    networkMediaService.prepareImport({ source_url: SOURCE_URL }, {
      fetch: forged.fetch,
      storageRoot,
    }),
    (error) => error?.code === 'NETWORK_MEDIA_INVALID_CONTENT'
  );
  assert.deepEqual(filesUnder(storageRoot), []);
});

test('导入拒绝没有可验证许可信息的 Commons 素材', async (t) => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-network-license-'));
  t.after(() => fs.rmSync(storageRoot, { recursive: true, force: true }));
  const mock = mockCommonsFetch({
    payload: commonsPayload({
      extmetadata: { Artist: { value: 'Unknown' } },
    }),
  });

  await assert.rejects(
    networkMediaService.prepareImport({ source_url: SOURCE_URL }, {
      fetch: mock.fetch,
      storageRoot,
    }),
    (error) => error?.code === 'NETWORK_MEDIA_LICENSE_MISSING' && error.statusCode === 422
  );
  assert.equal(mock.calls.length, 1);
  assert.deepEqual(filesUnder(storageRoot), []);
});

test('导入拒绝缺失或不匹配的 Commons SHA-1', async (t) => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-network-hash-'));
  t.after(() => fs.rmSync(storageRoot, { recursive: true, force: true }));
  for (const sha1 of ['', 'a'.repeat(40)]) {
    const mock = mockCommonsFetch({ payload: commonsPayload({ sha1 }) });
    await assert.rejects(
      networkMediaService.prepareImport({ source_url: SOURCE_URL }, { fetch: mock.fetch, storageRoot }),
      (error) => error?.code === (sha1 ? 'NETWORK_MEDIA_HASH_MISMATCH' : 'NETWORK_MEDIA_HASH_MISSING')
    );
  }
  assert.deepEqual(filesUnder(storageRoot), []);
});

test('导入忽略客户端伪造字段，以 Commons 权威元数据原子落盘并落库', async (t) => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-network-import-'));
  const db = createDb();
  const mock = mockCommonsFetch();
  t.after(() => {
    db.close();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  const item = await assetService.importFromNetwork(db, null, {
    source_url: SOURCE_URL,
    download_url: 'https://attacker.example/private',
    title: '伪造标题',
    author: '伪造作者',
    license: '伪造许可',
    media_type: 'image',
  }, { network: { fetch: mock.fetch, storageRoot } });

  assert.equal(item.name, 'Safe Test.png');
  assert.equal(item.author, 'Alice & Bob');
  assert.equal(item.license, 'CC BY-SA 4.0');
  assert.equal(item.source_url, SOURCE_URL);
  assert.equal(item.source_provider, 'Wikimedia Commons');
  assert.equal(item.license_url, 'https://creativecommons.org/licenses/by-sa/4.0/');
  assert.equal(item.source_metadata.commons_page_id, 10);
  assert.equal(item.source_metadata.commons_revision_timestamp, '2026-08-02T00:00:00Z');
  assert.equal(item.source_metadata.commons_sha1, PNG_SHA1);
  assert.equal(
    item.source_metadata.content_sha256,
    createHash('sha256').update(PNG_BYTES).digest('hex')
  );
  assert.equal(item.source_metadata.resolved_download_url, DOWNLOAD_URL);
  assert.match(item.local_path, /^library\/uploads\/network_[0-9a-f-]+\.png$/);
  assert.deepEqual(fs.readFileSync(path.join(storageRoot, item.local_path)), PNG_BYTES);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM assets').get().count, 1);
  assert.equal(mock.calls.some((call) => call.url.includes('attacker.example')), false);
  assert.equal(filesUnder(storageRoot).some((file) => file.endsWith('.part')), false);

  const storedCategory = db.prepare('SELECT category FROM assets WHERE id = ?').get(item.id).category;
  assert.throws(
    () => assetService.create(db, null, { name: '伪造来源', category: storedCategory }),
    (error) => error?.code === 'BAD_REQUEST'
  );
  assert.throws(
    () => assetService.update(db, null, item.id, { category: 'ordinary' }),
    (error) => error?.code === 'BAD_REQUEST'
  );
  for (const mutation of [
    { local_path: 'library/replacement.png' },
    { url: '/static/library/replacement.png' },
    { type: 'video' },
    { mime_type: 'video/mp4' },
  ]) {
    assert.throws(
      () => assetService.update(db, null, item.id, mutation),
      (error) => error?.code === 'BAD_REQUEST'
    );
  }
  const renamed = assetService.update(db, null, item.id, { name: '新的展示名称', is_favorite: 1 });
  assert.equal(renamed.name, '新的展示名称');
  assert.equal(renamed.local_path, item.local_path);
  assert.equal(assetService.getById(db, item.id).license, 'CC BY-SA 4.0');
});

test('网络导入保留已验证的项目归属，并在下载前拒绝无效项目', async (t) => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-network-scope-'));
  const db = createDb();
  db.prepare('INSERT INTO dramas (id, title, created_at) VALUES (?, ?, ?)').run(7, '归属项目', new Date().toISOString());
  const mock = mockCommonsFetch();
  t.after(() => {
    db.close();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  const item = await assetService.importFromNetwork(db, null, {
    source_url: SOURCE_URL,
    drama_id: 7,
  }, { network: { fetch: mock.fetch, storageRoot } });
  assert.equal(item.drama_id, 7);
  assert.equal(db.prepare('SELECT drama_id FROM assets WHERE id = ?').get(item.id).drama_id, 7);

  let invalidFetchCalls = 0;
  await assert.rejects(
    assetService.importFromNetwork(db, null, { source_url: SOURCE_URL, drama_id: 999 }, {
      network: {
        storageRoot,
        fetch: async () => { invalidFetchCalls += 1; },
      },
    }),
    (error) => error?.code === 'DRAMA_NOT_FOUND' && error.statusCode === 404
  );
  assert.equal(invalidFetchCalls, 0);
});

test('网络素材下载期间项目进入回收状态时拒绝最终入库并清理文件', async (t) => {
  const db = createDbWithRecycleState();
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-network-recycle-'));
  t.after(() => {
    db.close();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });
  db.prepare(
    'INSERT INTO dramas (id, title, created_at, metadata, deleted_at, trash_state) VALUES (?, ?, ?, ?, NULL, NULL)'
  ).run(7, '回收竞态项目', new Date().toISOString(), '{}');
  const mock = mockCommonsFetch();
  let fetchCalls = 0;
  const fetch = async (...args) => {
    const result = await mock.fetch(...args);
    fetchCalls += 1;
    if (fetchCalls === 2) db.prepare("UPDATE dramas SET trash_state = 'recycling' WHERE id = 7").run();
    return result;
  };

  await assert.rejects(
    assetService.importFromNetwork(db, null, { drama_id: 7, source_url: SOURCE_URL }, {
      network: { fetch, storageRoot },
    }),
    (error) => error?.code === 'DRAMA_RECYCLE_IN_PROGRESS' && error.statusCode === 409
  );

  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM assets').get().count, 0);
  assert.deepEqual(filesUnder(storageRoot), []);
});

test('同一项目重复导入同一 Commons 来源时幂等复用记录并清理重复文件', async (t) => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-network-idempotent-'));
  const db = createDb();
  db.prepare('INSERT INTO dramas (id, title, created_at) VALUES (?, ?, ?)').run(8, '幂等项目', new Date().toISOString());
  const mock = mockCommonsFetch();
  t.after(() => {
    db.close();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  const first = await assetService.importFromNetwork(db, null, { source_url: SOURCE_URL, drama_id: 8 }, {
    network: { fetch: mock.fetch, storageRoot },
  });
  const second = await assetService.importFromNetwork(db, null, { source_url: SOURCE_URL, drama_id: 8 }, {
    network: { fetch: mock.fetch, storageRoot },
  });

  assert.equal(second.id, first.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM assets').get().count, 1);
  assert.equal(filesUnder(storageRoot).length, 1);
});

test('同一来源的修订或内容变化会显式冲突且保留旧素材', async (t) => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-network-version-'));
  const db = createDb();
  const firstMock = mockCommonsFetch();
  t.after(() => {
    db.close();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });
  const first = await assetService.importFromNetwork(db, null, { source_url: SOURCE_URL }, {
    network: { fetch: firstMock.fetch, storageRoot },
  });
  const changedMock = mockCommonsFetch({
    payload: commonsPayload({ timestamp: '2026-08-03T00:00:00Z' }),
  });
  await assert.rejects(
    assetService.importFromNetwork(db, null, { source_url: SOURCE_URL }, {
      network: { fetch: changedMock.fetch, storageRoot },
    }),
    (error) => error?.code === 'NETWORK_MEDIA_SOURCE_CHANGED' && error.statusCode === 409
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM assets').get().count, 1);
  assert.deepEqual(fs.readFileSync(path.join(storageRoot, first.local_path)), PNG_BYTES);
  assert.equal(filesUnder(storageRoot).length, 1);
});

test('数据库失败时回滚记录并清除临时文件和已提交文件', async (t) => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-network-cleanup-'));
  const db = createDb({ valid: false });
  const mock = mockCommonsFetch();
  t.after(() => {
    db.close();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  await assert.rejects(
    assetService.importFromNetwork(db, null, { source_url: SOURCE_URL }, {
      network: { fetch: mock.fetch, storageRoot },
    }),
    /NOT NULL constraint failed/
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM assets').get().count, 0);
  assert.deepEqual(filesUnder(storageRoot), []);
});

test('启动清理仅删除过期且无数据库引用的受控网络素材文件', (t) => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-network-orphans-'));
  const db = createDb();
  const directory = path.join(storageRoot, 'library', 'uploads');
  fs.mkdirSync(directory, { recursive: true });
  const referencedName = `network_${randomUUID()}.png`;
  const orphanName = `network_${randomUUID()}.png`;
  const partName = `.network_${randomUUID()}.part`;
  const unrelatedName = 'keep-me.png';
  for (const name of [referencedName, orphanName, partName, unrelatedName]) {
    fs.writeFileSync(path.join(directory, name), PNG_BYTES);
  }
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
  for (const name of [referencedName, orphanName, partName, unrelatedName]) {
    fs.utimesSync(path.join(directory, name), old, old);
  }
  db.prepare(
    `INSERT INTO assets (name, type, local_path, created_at, updated_at)
     VALUES ('已引用', 'image', ?, ?, ?)`
  ).run(`library/uploads/${referencedName}`, old.toISOString(), old.toISOString());
  t.after(() => {
    db.close();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  const result = assetService.cleanupNetworkImportOrphans(db, null, {
    storageRoot,
    nowMs: Date.now(),
    schedule: false,
  });

  assert.deepEqual(new Set(result.removed), new Set([
    `library/uploads/${orphanName}`,
    `library/uploads/${partName}`,
  ]));
  assert.equal(fs.existsSync(path.join(directory, referencedName)), true);
  assert.equal(fs.existsSync(path.join(directory, unrelatedName)), true);
});

test('孤儿清理拒绝中间目录联接，且周期清理可关闭并不阻止退出', async (t) => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-network-link-root-'));
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-network-link-outside-'));
  const db = createDb();
  const outsideUploads = path.join(outsideRoot, 'uploads');
  fs.mkdirSync(outsideUploads);
  const outsideName = `network_${randomUUID()}.png`;
  fs.writeFileSync(path.join(outsideUploads, outsideName), PNG_BYTES);
  try {
    fs.symlinkSync(outsideRoot, path.join(storageRoot, 'library'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error?.code === 'EPERM') {
      db.close();
      fs.rmSync(storageRoot, { recursive: true, force: true });
      fs.rmSync(outsideRoot, { recursive: true, force: true });
      t.skip('当前环境不允许创建目录联接');
      return;
    }
    throw error;
  }
  t.after(() => {
    db.close();
    fs.rmSync(storageRoot, { recursive: true, force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  });
  assert.throws(
    () => networkMediaService.cleanupOrphans([], { storageRoot, nowMs: Date.now() + 2 * 60 * 60 * 1000 }),
    (error) => error?.code === 'NETWORK_MEDIA_STORAGE_UNSAFE'
  );
  assert.equal(fs.existsSync(path.join(outsideUploads, outsideName)), true);

  const cleanRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-network-periodic-'));
  t.after(() => fs.rmSync(cleanRoot, { recursive: true, force: true }));
  const controller = assetService.startNetworkImportOrphanCleanup(db, null, {
    storageRoot: cleanRoot,
    intervalMs: 1000,
  });
  assert.equal(typeof controller.close, 'function');
  assert.equal(controller.isReferenced(), false);
  controller.close();
});

test('总路由真实挂载网络搜索和导入，静态路径不会落入 assets/:id', async (t) => {
  const db = createDb();
  const originalSearch = assetService.searchNetwork;
  const originalImport = assetService.importFromNetwork;
  assetService.searchNetwork = async (query) => ({ items: [], keyword: query.keyword });
  assetService.importFromNetwork = async (_db, _log, body) => ({ id: 99, name: body.title });
  t.after(() => {
    assetService.searchNetwork = originalSearch;
    assetService.importFromNetwork = originalImport;
    db.close();
  });

  const app = express();
  app.use(express.json());
  app.use('/api/v1', setupRouter({ storage: {}, server: {} }, db, {
    info() {},
    warn() {},
    error() {},
  }));
  const server = app.listen(0, '127.0.0.1');
  t.after(async () => {
    if (server.listening) await closeServer(server);
  });
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1/assets`;

  const searchResponse = await fetch(`${baseUrl}/network-search?keyword=route`);
  const searchBody = await searchResponse.json();
  assert.equal(searchResponse.status, 200);
  assert.deepEqual(searchBody.data, { items: [], keyword: 'route' });

  const importResponse = await fetch(`${baseUrl}/network-import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'route import' }),
  });
  const importBody = await importResponse.json();
  assert.equal(importResponse.status, 201);
  assert.deepEqual(importBody.data, { id: 99, name: 'route import' });
});
