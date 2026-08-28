const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');

const workflowRoutes = require('../src/routes/workflows');
const timelineRoutes = require('../src/routes/timelines');
const timelineService = require('../src/services/timelineService');

const log = { error() {} };

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY, title TEXT, status TEXT, deleted_at TEXT,
      trash_state TEXT, recycle_phase TEXT
    );
    CREATE TABLE episodes (
      id INTEGER PRIMARY KEY, drama_id INTEGER, episode_number INTEGER, title TEXT,
      video_url TEXT, status TEXT, deleted_at TEXT
    );
    CREATE TABLE workflow_runs (
      id TEXT PRIMARY KEY, drama_id INTEGER, episode_id INTEGER, type TEXT, status TEXT,
      progress INTEGER, current_step TEXT, input_json TEXT, output_json TEXT, error TEXT,
      started_at TEXT, completed_at TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT
    );
    CREATE TABLE workflow_steps (
      id TEXT PRIMARY KEY, run_id TEXT, step_key TEXT, status TEXT, attempts INTEGER,
      input_json TEXT, output_json TEXT, error TEXT, sort_order INTEGER,
      started_at TEXT, completed_at TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE provider_invocations (
      id INTEGER PRIMARY KEY, run_id TEXT, workflow_step_id TEXT, provider_type TEXT,
      provider_name TEXT, model TEXT, mode TEXT, status TEXT, cost_estimate REAL, cost_kind TEXT
    );
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY, episode_id INTEGER, storyboard_number INTEGER, title TEXT,
      dialogue TEXT, narration TEXT, action TEXT, video_url TEXT, image_url TEXT,
      audio_local_path TEXT, narration_audio_local_path TEXT, deleted_at TEXT
    );
    CREATE TABLE timeline_tracks (
      id INTEGER PRIMARY KEY, episode_id INTEGER, type TEXT, name TEXT, sort_order INTEGER,
      status TEXT, metadata TEXT
    );
    CREATE TABLE timeline_items (
      id INTEGER PRIMARY KEY, track_id INTEGER, storyboard_id INTEGER, start_sec REAL,
      end_sec REAL, source_path TEXT, metadata TEXT
    );

    INSERT INTO dramas VALUES
      (1, '活动项目', 'draft', NULL, NULL, NULL),
      (2, '回收中项目', 'draft', NULL, 'recycling', 'cancelling'),
      (3, '已删除项目', 'trash', '2026-08-01', NULL, 'completed'),
      (4, '另一活动项目', 'draft', NULL, NULL, NULL);
    INSERT INTO episodes VALUES
      (101, 1, 1, '活动剧集', NULL, 'draft', NULL),
      (202, 2, 1, '回收中剧集', NULL, 'draft', NULL),
      (303, 3, 1, '已删除剧集', NULL, 'draft', NULL),
      (404, 4, 1, '另一活动剧集', NULL, 'draft', NULL);

    INSERT INTO workflow_runs
      (id, drama_id, episode_id, type, status, progress, input_json, output_json, created_at, updated_at)
    VALUES
      ('active', 1, 101, 'novel2anime', 'completed', 100, '{}', '{}', '2026-08-01T05:00:00Z', '2026-08-01T05:00:00Z'),
      ('active-no-episode', 1, NULL, 'novel2anime', 'completed', 100, '{}', '{}', '2026-08-01T04:00:00Z', '2026-08-01T04:00:00Z'),
      ('recycling', 2, 202, 'novel2anime', 'completed', 100, '{}', '{}', '2026-08-01T09:00:00Z', '2026-08-01T09:00:00Z'),
      ('deleted', 3, 303, 'novel2anime', 'completed', 100, '{}', '{}', '2026-08-01T08:00:00Z', '2026-08-01T08:00:00Z'),
      ('cross-project-dirty', 1, 404, 'novel2anime', 'completed', 100, '{}', '{}', '2026-08-01T07:00:00Z', '2026-08-01T07:00:00Z'),
      ('missing-episode-dirty', 1, 999, 'novel2anime', 'completed', 100, '{}', '{}', '2026-08-01T06:00:00Z', '2026-08-01T06:00:00Z');

    INSERT INTO storyboards VALUES
      (1001, 101, 1, '活动分镜', '活动字幕', '', '', '', '', '', '', NULL),
      (2002, 202, 1, '回收中分镜', '回收字幕', '', '', '', '', '', '', NULL),
      (4004, 404, 1, '跨项目分镜', '不应泄漏', '', '', '', '', '', '', NULL),
      (1002, 101, 2, '已删除分镜', '不应泄漏', '', '', '', '', '', '', '2026-08-01');
    INSERT INTO timeline_tracks VALUES
      (11, 101, 'subtitle', '活动字幕轨', 10, 'ready', '{}'),
      (22, 202, 'subtitle', '回收字幕轨', 10, 'ready', '{}'),
      (33, 303, 'subtitle', '已删除字幕轨', 10, 'ready', '{}');
    INSERT INTO timeline_items VALUES
      (111, 11, 1001, 0, 1, '', '{}'),
      (112, 11, NULL, 1, 2, '独立时间线文本', '{}'),
      (221, 22, 2002, 0, 1, '', '{}');
  `);
  return db;
}

function responseRecorder() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = String(value); },
    getHeader(name) { return this.headers[String(name).toLowerCase()]; },
  };
}

test('工作流列表和详情隐藏回收、删除及父子归属冲突记录', () => {
  const db = createDb();
  const routes = workflowRoutes(db, log);
  try {
    const listResponse = responseRecorder();
    routes.list({ query: { limit: 2 } }, listResponse);
    assert.equal(listResponse.statusCode, 200);
    assert.deepEqual(listResponse.body.data.map((run) => run.id), ['active', 'active-no-episode']);

    const filteredResponse = responseRecorder();
    routes.list({ query: { drama_id: 2, limit: 20 } }, filteredResponse);
    assert.deepEqual(filteredResponse.body.data, []);

    for (const runId of ['recycling', 'deleted', 'cross-project-dirty', 'missing-episode-dirty']) {
      const detailResponse = responseRecorder();
      routes.get({ params: { run_id: runId } }, detailResponse);
      assert.equal(detailResponse.statusCode, 404, runId);
    }

    const activeResponse = responseRecorder();
    routes.get({ params: { run_id: 'active' } }, activeResponse);
    assert.equal(activeResponse.statusCode, 200);
    assert.equal(activeResponse.body.data.id, 'active');
  } finally {
    db.close();
  }
});

test('工作流动作路由无法绕过父项目和 episode 读取边界', () => {
  const db = createDb();
  const routes = workflowRoutes(db, log);
  try {
    const originalStatuses = new Map(
      db.prepare('SELECT id, status FROM workflow_runs').all().map((row) => [row.id, row.status])
    );
    for (const handler of ['retry', 'cancel', 'pause', 'resume']) {
      for (const runId of ['recycling', 'deleted', 'cross-project-dirty', 'missing-episode-dirty']) {
        const res = responseRecorder();
        routes[handler]({ params: { run_id: runId }, body: {} }, res);
        assert.equal(res.statusCode, 404, `${handler}:${runId}`);
        assert.equal(res.body.error.code, 'NOT_FOUND', `${handler}:${runId}`);
      }
    }
    const currentStatuses = db.prepare('SELECT id, status FROM workflow_runs').all();
    for (const row of currentStatuses) assert.equal(row.status, originalStatuses.get(row.id), row.id);
  } finally {
    db.close();
  }
});

test('时间线详情和导出隐藏回收中及已删除父项目，同时保留独立时间线项', () => {
  const db = createDb();
  try {
    const active = timelineService.getEpisodeTimeline(db, 101);
    assert.equal(active.episode.drama_id, 1);
    assert.deepEqual(active.tracks[0].items.map((item) => item.id), [111, 112]);
    assert.equal(timelineService.exportEpisodeSrt(db, 101).content.includes('独立时间线文本'), true);
    assert.equal(timelineService.getEpisodeTimeline(db, 202), null);
    assert.equal(timelineService.exportEpisodeSrt(db, 202), null);
    assert.equal(timelineService.getEpisodeTimeline(db, 303), null);
    assert.equal(timelineService.getDramaTimeline(db, 2), null);
    assert.equal(timelineService.exportDramaManifest(db, 3), null);
  } finally {
    db.close();
  }
});

test('时间线真实路由对回收和删除项目的详情与导出统一返回 404', () => {
  const db = createDb();
  const routes = timelineRoutes(db, log);
  try {
    const requests = [
      ['getEpisodeTimeline', { params: { episode_id: 202 } }],
      ['exportEpisodeSrt', { params: { episode_id: 303 } }],
      ['getDramaTimeline', { params: { id: 2 } }],
      ['exportDramaManifest', { params: { id: 3 } }],
    ];
    for (const [handler, request] of requests) {
      const res = responseRecorder();
      routes[handler](request, res);
      assert.equal(res.statusCode, 404, handler);
      assert.equal(res.body.error.code, 'NOT_FOUND', handler);
    }
  } finally {
    db.close();
  }
});

test('时间线遇到跨 episode、已删除或缺失 storyboard 的历史脏数据时整体失败关闭', () => {
  for (const storyboardId of [4004, 1002, 9999]) {
    const db = createDb();
    try {
      db.prepare(
        'INSERT INTO timeline_items (id, track_id, storyboard_id, start_sec, end_sec, source_path, metadata) VALUES (?, 11, ?, 2, 3, ?, ?)'
      ).run(9000 + storyboardId, storyboardId, '脏数据', '{}');
      assert.equal(timelineService.getEpisodeTimeline(db, 101), null);
      assert.equal(timelineService.exportEpisodeSrt(db, 101), null);
      assert.equal(timelineService.getDramaTimeline(db, 1), null);
      assert.equal(timelineService.exportDramaManifest(db, 1), null);
    } finally {
      db.close();
    }
  }
});

test('workflow list treats novel2anime as a family prefix so repair runs stay visible', () => {
  const db = createDb();
  const routes = workflowRoutes(db, log);
  try {
    db.prepare(`
      INSERT INTO workflow_runs
        (id, drama_id, episode_id, type, status, progress, input_json, output_json, created_at, updated_at)
      VALUES
        ('repair-latest', 1, 101, 'novel2anime:repair_storyboards', 'failed', 40, '{}', '{}', '2026-08-01T06:00:00Z', '2026-08-01T06:00:00Z')
    `).run();

    const family = responseRecorder();
    routes.list({ query: { drama_id: 1, type: 'novel2anime', limit: 20 } }, family);
    assert.equal(family.statusCode, 200);
    assert.deepEqual(family.body.data.map((run) => run.id), ['repair-latest', 'active', 'active-no-episode']);

    const exact = responseRecorder();
    routes.list({ query: { drama_id: 1, type: 'novel2anime:repair_storyboards', limit: 20 } }, exact);
    assert.deepEqual(exact.body.data.map((run) => run.id), ['repair-latest']);

    const other = responseRecorder();
    routes.list({ query: { drama_id: 1, type: 'other', limit: 20 } }, other);
    assert.deepEqual(other.body.data, []);
  } finally {
    db.close();
  }
});
