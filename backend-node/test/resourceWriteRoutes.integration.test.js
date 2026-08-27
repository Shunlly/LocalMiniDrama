const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../src/app');

function writeTestConfig(root, databasePath, storagePath) {
  const configPath = path.join(root, 'config.yaml');
  const config = [
    'app:',
    '  name: LocalMiniDrama resource route integration test',
    '  version: 0.0.0-test',
    '  debug: false',
    '  language: zh',
    'server:',
    '  host: 127.0.0.1',
    '  cors_origins: []',
    'database:',
    '  type: sqlite',
    `  path: ${JSON.stringify(databasePath)}`,
    'storage:',
    '  type: local',
    `  local_path: ${JSON.stringify(storagePath)}`,
    'vendor_lock:',
    '  enabled: false',
    '',
  ].join('\n');
  fs.writeFileSync(configPath, config, 'utf8');
  return configPath;
}

function seedFixture(db) {
  const now = '2026-08-03T00:00:00.000Z';
  const insertDrama = db.prepare(
    `INSERT INTO dramas
       (id, title, status, created_at, updated_at, deleted_at, trash_state, recycle_phase)
     VALUES (?, ?, 'draft', ?, ?, NULL, ?, ?)`
  );
  insertDrama.run(101, '活动项目', now, now, null, null);
  insertDrama.run(202, '回收中项目', now, now, 'recycling', 'claimed');

  const insertEpisode = db.prepare(
    `INSERT INTO episodes
       (id, drama_id, episode_number, title, status, created_at, updated_at, deleted_at)
     VALUES (?, ?, 1, ?, 'draft', ?, ?, NULL)`
  );
  insertEpisode.run(1001, 101, '活动项目第一集', now, now);
  insertEpisode.run(2002, 202, '回收中项目第一集', now, now);

  const insertCharacter = db.prepare(
    `INSERT INTO characters
       (id, drama_id, name, role, appearance, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, '主角', '原始外观', ?, ?, NULL)`
  );
  insertCharacter.run(1101, 101, '活动角色', now, now);
  insertCharacter.run(2201, 202, '回收角色', now, now);

  const insertScene = db.prepare(
    `INSERT INTO scenes
       (id, drama_id, episode_id, location, time, status, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, '白天', 'draft', ?, ?, NULL)`
  );
  insertScene.run(1102, 101, 1001, '活动场景', now, now);
  insertScene.run(2202, 202, 2002, '回收场景', now, now);

  const insertProp = db.prepare(
    `INSERT INTO props
       (id, drama_id, episode_id, name, type, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, '关键道具', ?, ?, NULL)`
  );
  insertProp.run(1103, 101, 1001, '活动道具', now, now);
  insertProp.run(2203, 202, 2002, '回收道具', now, now);

  const insertAsset = db.prepare(
    `INSERT INTO assets
       (id, drama_id, name, type, category, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, 'image', 'local', ?, ?, NULL)`
  );
  insertAsset.run(1104, 101, '活动素材', now, now);
  insertAsset.run(2204, 202, '回收素材', now, now);

  const insertMerge = db.prepare(
    `INSERT INTO video_merges
       (id, episode_id, drama_id, title, provider, status, scenes, created_at, deleted_at)
     VALUES (?, ?, ?, ?, 'ffmpeg', 'completed', '[]', ?, NULL)`
  );
  insertMerge.run(1105, 1001, 101, '活动合成', now);
  insertMerge.run(2205, 2002, 202, '回收合成', now);
}

function readRow(db, table, id) {
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
}

async function request(baseUrl, pathname, options = {}) {
  const headers = {
    Origin: baseUrl,
    ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers || {}),
  };
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers,
    body: options.body === undefined
      ? undefined
      : (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (_) {
    body = text;
  }
  return { response, body };
}

test('真实 Express 应用对项目子资源写入口执行统一回收边界', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-resource-write-routes-'));
  const databasePath = path.join(root, 'data', 'routes.sqlite');
  const storagePath = path.join(root, 'storage');
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  fs.mkdirSync(storagePath, { recursive: true });

  const previousConfigPath = process.env.LOCALMINIDRAMA_CONFIG_PATH;
  process.env.LOCALMINIDRAMA_CONFIG_PATH = writeTestConfig(root, databasePath, storagePath);

  let runtime;
  let server;
  t.after(async () => {
    if (server?.listening) {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    runtime?.close();
    if (previousConfigPath === undefined) delete process.env.LOCALMINIDRAMA_CONFIG_PATH;
    else process.env.LOCALMINIDRAMA_CONFIG_PATH = previousConfigPath;
    fs.rmSync(root, { recursive: true, force: true });
  });

  runtime = createApp();
  seedFixture(runtime.db);
  server = await new Promise((resolve, reject) => {
    const listeningServer = runtime.app.listen(0, '127.0.0.1', () => resolve(listeningServer));
    listeningServer.once('error', reject);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const cases = [
    {
      name: '角色更新',
      table: 'characters',
      activeId: 1101,
      recyclingId: 2201,
      path: (id) => `/api/v1/characters/${id}`,
      method: 'PUT',
      body: { name: '已更新角色' },
      assertActive(row) { assert.equal(row.name, '已更新角色'); },
    },
    {
      name: '场景更新',
      table: 'scenes',
      activeId: 1102,
      recyclingId: 2202,
      path: (id) => `/api/v1/scenes/${id}`,
      method: 'PUT',
      body: { location: '已更新场景' },
      assertActive(row) { assert.equal(row.location, '已更新场景'); },
    },
    {
      name: '道具更新',
      table: 'props',
      activeId: 1103,
      recyclingId: 2203,
      path: (id) => `/api/v1/props/${id}`,
      method: 'PUT',
      body: { name: '已更新道具' },
      assertActive(row) { assert.equal(row.name, '已更新道具'); },
    },
    {
      name: '素材更新',
      table: 'assets',
      activeId: 1104,
      recyclingId: 2204,
      path: (id) => `/api/v1/assets/${id}`,
      method: 'PUT',
      body: { name: '已更新素材' },
      assertActive(row) { assert.equal(row.name, '已更新素材'); },
    },
    {
      name: '视频合成删除',
      table: 'video_merges',
      activeId: 1105,
      recyclingId: 2205,
      path: (id) => `/api/v1/video-merges/${id}`,
      method: 'DELETE',
      assertActive(row) { assert.ok(row.deleted_at); },
    },
  ];

  for (const routeCase of cases) {
    await t.test(`${routeCase.name}：活动项目可达，回收中项目拒绝且数据不变`, async () => {
      const active = await request(baseUrl, routeCase.path(routeCase.activeId), {
        method: routeCase.method,
        ...(routeCase.body === undefined ? {} : { body: routeCase.body }),
      });
      assert.equal(active.response.status, 200, JSON.stringify(active.body));
      assert.equal(active.body?.success, true);
      routeCase.assertActive(readRow(runtime.db, routeCase.table, routeCase.activeId));

      const before = readRow(runtime.db, routeCase.table, routeCase.recyclingId);
      const blocked = await request(baseUrl, routeCase.path(routeCase.recyclingId), {
        method: routeCase.method,
        ...(routeCase.body === undefined ? {} : { body: routeCase.body }),
      });
      assert.deepEqual(readRow(runtime.db, routeCase.table, routeCase.recyclingId), before);
      assert.ok(
        [404, 409].includes(blocked.response.status),
        `回收边界应返回 404/409，实际为 ${blocked.response.status}: ${JSON.stringify(blocked.body)}`
      );
      assert.equal(blocked.body?.success, false);
    });
  }

  await t.test('未注册的 API URL 经过全局 404 中间件', async () => {
    const result = await request(baseUrl, '/api/v1/resource-write-route-that-does-not-exist');
    assert.equal(result.response.status, 404);
    assert.deepEqual(
      { success: result.body?.success, code: result.body?.error?.code },
      { success: false, code: 'NOT_FOUND' }
    );
  });

  await t.test('路由前的 JSON 解析异常经过全局错误中间件', async () => {
    const result = await request(baseUrl, '/api/v1/assets', {
      method: 'POST',
      body: '{',
    });
    assert.equal(result.response.status, 400);
    assert.equal(result.body?.success, false);
    assert.equal(result.body?.error?.code, 'REQUEST_REJECTED');
    assert.equal(result.body?.request_id, result.response.headers.get('x-request-id'));
  });
});
