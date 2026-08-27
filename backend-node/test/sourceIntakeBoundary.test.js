const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const storySourceRoutes = require('../src/routes/storySources');
const sourceIntakeService = require('../src/services/sourceIntakeService');

const log = { info() {}, warn() {}, error() {} };
const previousStorySourceRoot = process.env.LOCALMINIDRAMA_TEST_STORY_SOURCE_ROOT;
const storySourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'source-intake-boundary-'));
process.env.LOCALMINIDRAMA_TEST_STORY_SOURCE_ROOT = storySourceRoot;

after(() => {
  if (previousStorySourceRoot == null) delete process.env.LOCALMINIDRAMA_TEST_STORY_SOURCE_ROOT;
  else process.env.LOCALMINIDRAMA_TEST_STORY_SOURCE_ROOT = previousStorySourceRoot;
  fs.rmSync(storySourceRoot, { recursive: true, force: true });
});

function createDb() {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO dramas
     (id, title, status, trash_state, recycle_phase, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insert.run(11, '活动项目', 'draft', null, null, now, now, null);
  insert.run(22, '待回收项目', 'draft', null, null, now, now, null);
  insert.run(33, '待删除项目', 'draft', null, null, now, now, null);
  return db;
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

function createSource(db, dramaId, title = '测试来源', options = {}) {
  return sourceIntakeService.createStorySource(db, log, {
    drama_id: dramaId,
    source_type: 'outline',
    title,
    text: '角色：林夏。地点：码头。林夏发现一封信。',
    target_episode_count: 1,
    ...options,
  });
}

function setParentState(db, dramaId, state) {
  if (state === 'recycling') {
    db.prepare(
      `UPDATE dramas SET status = 'draft', deleted_at = NULL,
       trash_state = 'recycling', recycle_phase = 'claimed' WHERE id = ?`
    ).run(dramaId);
  } else {
    db.prepare(
      `UPDATE dramas SET status = 'trash', deleted_at = ?,
       trash_state = NULL, recycle_phase = 'completed' WHERE id = ?`
    ).run(new Date().toISOString(), dramaId);
  }
}

test('来源详情和 original 按来源行的真实父项目失败关闭', () => {
  const db = createDb();
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'source-boundary-original-'));
  try {
    const routes = storySourceRoutes(db, log, { storagePath: storageRoot });
    const originalBytes = Buffer.from('retained original');
    const created = createSource(db, 11, '带原件来源', {
      original_file: { buffer: originalBytes, extension: '.txt', mime: 'text/plain' },
      original_storage: { storagePath: storageRoot },
    });
    const sourceId = created.source.id;
    assert.notEqual(sourceId, 11, '反例要求来源 ID 与父项目 ID 不相等');

    setParentState(db, 11, 'recycling');
    for (const invoke of [
      (res) => routes.get({ params: { source_id: sourceId } }, res),
      (res) => routes.downloadOriginal({ params: { source_id: sourceId } }, res),
    ]) {
      const res = mockResponse();
      invoke(res);
      assert.equal(res.statusCode, 409);
      assert.equal(res.body.error.code, 'DRAMA_RECYCLE_IN_PROGRESS');
    }

    setParentState(db, 11, 'deleted');
    for (const invoke of [
      (res) => routes.get({ params: { source_id: sourceId } }, res),
      (res) => routes.downloadOriginal({ params: { source_id: sourceId } }, res),
    ]) {
      const res = mockResponse();
      invoke(res);
      assert.equal(res.statusCode, 404);
      assert.equal(res.body.error.code, 'DRAMA_NOT_FOUND');
    }
  } finally {
    db.close();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  }
});

test('应用计划按计划行真实 drama_id 拒绝回收中和已删除项目', () => {
  for (const [dramaId, expectedCode] of [
    [22, 'DRAMA_RECYCLE_IN_PROGRESS'],
    [33, 'DRAMA_NOT_FOUND'],
  ]) {
    const db = createDb();
    try {
      const source = createSource(db, dramaId, `真实父项目来源-${dramaId}`);
      const planId = source.adaptation_plan.id;
      assert.notEqual(planId, dramaId, '反例要求计划 ID 与目标项目 ID 不相等');
      assert.notEqual(source.source.id, dramaId, '反例要求来源 ID 与目标项目 ID 不相等');
      setParentState(db, dramaId, dramaId === 22 ? 'recycling' : 'deleted');

      const routes = storySourceRoutes(db, log);
      const res = mockResponse();
      routes.applyPlan({ params: { plan_id: planId }, body: {} }, res);
      assert.equal(res.statusCode, expectedCode === 'DRAMA_NOT_FOUND' ? 404 : 409);
      assert.equal(res.body.error.code, expectedCode);
      assert.equal(
        db.prepare('SELECT COUNT(*) AS count FROM episodes WHERE drama_id = ?').get(dramaId).count,
        0
      );
      assert.equal(
        db.prepare('SELECT status FROM adaptation_plans WHERE id = ?').get(planId).status,
        'draft'
      );
    } finally {
      db.close();
    }
  }
});

test('追加剧集与计划状态在同一事务中提交', () => {
  const db = createDb();
  try {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO episodes
       (drama_id, episode_number, title, script_content, status, created_at, updated_at)
       VALUES (11, 1, '原剧集', '保持不变', 'draft', ?, ?)`
    ).run(now, now);
    const created = createSource(db, 11);
    const planId = created.adaptation_plan.id;
    db.exec(
      `CREATE TRIGGER fail_adaptation_status_update
       BEFORE UPDATE OF status ON adaptation_plans
       BEGIN SELECT RAISE(ABORT, '计划状态写入失败'); END`
    );

    assert.throws(
      () => sourceIntakeService.applyAdaptationPlanToEpisodes(db, log, planId),
      /计划状态写入失败/
    );
    assert.deepEqual(
      db.prepare(
        'SELECT episode_number, title, script_content FROM episodes WHERE drama_id = 11 AND deleted_at IS NULL ORDER BY episode_number'
      ).all(),
      [{ episode_number: 1, title: '原剧集', script_content: '保持不变' }]
    );
    assert.equal(db.prepare('SELECT status FROM adaptation_plans WHERE id = ?').get(planId).status, 'draft');
  } finally {
    db.close();
  }
});

test('覆盖剧集、分镜失效与计划状态在同一事务中提交', () => {
  const db = createDb();
  try {
    const now = new Date().toISOString();
    const episode = db.prepare(
      `INSERT INTO episodes
       (drama_id, episode_number, title, script_content, status, created_at, updated_at)
       VALUES (11, 1, '原剧集', '原内容', 'draft', ?, ?)`
    ).run(now, now);
    db.prepare(
      `INSERT INTO storyboards
       (episode_id, storyboard_number, title, status, created_at, updated_at)
       VALUES (?, 1, '原分镜', 'completed', ?, ?)`
    ).run(Number(episode.lastInsertRowid), now, now);
    const created = createSource(db, 11);
    const planId = created.adaptation_plan.id;
    db.exec(
      `CREATE TRIGGER fail_adaptation_status_update
       BEFORE UPDATE OF status ON adaptation_plans
       BEGIN SELECT RAISE(ABORT, '计划状态写入失败'); END`
    );

    assert.throws(
      () => sourceIntakeService.applyAdaptationPlanToEpisodes(db, log, planId, { overwrite: true }),
      /计划状态写入失败/
    );
    assert.deepEqual(
      db.prepare(
        'SELECT title, script_content, deleted_at FROM episodes WHERE drama_id = 11 ORDER BY id'
      ).all(),
      [{ title: '原剧集', script_content: '原内容', deleted_at: null }]
    );
    assert.equal(db.prepare('SELECT status FROM storyboards').get().status, 'completed');
    assert.equal(db.prepare('SELECT status FROM adaptation_plans WHERE id = ?').get(planId).status, 'draft');
  } finally {
    db.close();
  }
});

test('创建来源拒绝回收中和已删除项目', () => {
  for (const [dramaId, expectedCode] of [
    [22, 'DRAMA_RECYCLE_IN_PROGRESS'],
    [33, 'DRAMA_NOT_FOUND'],
  ]) {
    const db = createDb();
    try {
      setParentState(db, dramaId, dramaId === 22 ? 'recycling' : 'deleted');
      assert.throws(
        () => createSource(db, dramaId),
        (error) => error?.code === expectedCode
      );
      assert.equal(
        db.prepare('SELECT COUNT(*) AS count FROM story_sources WHERE drama_id = ?').get(dramaId).count,
        0
      );

      const routes = storySourceRoutes(db, log);
      const res = mockResponse();
      routes.createForDrama({
        params: { id: dramaId },
        body: {
          source_type: 'outline',
          title: '回收中来源',
          text: '角色：林夏。地点：码头。林夏发现一封信。',
          target_episode_count: 1,
        },
      }, res);
      assert.equal(res.statusCode, expectedCode === 'DRAMA_NOT_FOUND' ? 404 : 409);
      assert.equal(res.body.error.code, expectedCode);
    } finally {
      db.close();
    }
  }
});

