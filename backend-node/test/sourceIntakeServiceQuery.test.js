const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const sourceIntakeService = require('../src/services/sourceIntakeService');
const query = require('../src/services/sourceIntakeServiceQuery');
const { rowToSource, rowToPlan } = require('../src/services/sourceIntakeServiceAssembly');

const DRAMA_ACTIVE = 11;
const DRAMA_RECYCLING = 22;
const DRAMA_OTHER = 33;
const SOURCE_ACTIVE = 101;
const SOURCE_RECYCLING = 202;
const SOURCE_OTHER = 303;
const SOURCE_DELETED = 404;
const ITEM_ACTIVE = 1001;
const ITEM_MISBOUND = 1101;
const ITEM_OTHER = 2002;
const EVENT_ACTIVE = 3003;
const EVENT_OTHER = 4004;
const PLAN_ACTIVE = 5005;
const PLAN_OLDER = 5004;
const PLAN_OTHER = 6006;
const EPISODE_ACTIVE = 7007;
const EDGE_ACTIVE = 8008;
const EDGE_OTHER = 9009;

function createDb() {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const now = '2026-01-01T00:00:00.000Z';
  const insertDrama = db.prepare(
    `INSERT INTO dramas
     (id, title, status, trash_state, recycle_phase, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertDrama.run(DRAMA_ACTIVE, '活动项目', 'draft', null, null, now, now, null);
  insertDrama.run(DRAMA_RECYCLING, '回收中项目', 'draft', 'recycling', 'claimed', now, now, null);
  insertDrama.run(DRAMA_OTHER, '其他项目', 'draft', null, null, now, now, null);

  db.prepare(
    `INSERT INTO episodes
     (id, drama_id, episode_number, title, script_content, status, created_at, updated_at)
     VALUES (?, ?, 1, '活动剧集', '原内容', 'draft', ?, ?)`
  ).run(EPISODE_ACTIVE, DRAMA_ACTIVE, now, now);

  const insertSource = db.prepare(
    `INSERT INTO story_sources
     (id, drama_id, source_type, title, raw_text_path, content_hash, metadata, created_at, deleted_at)
     VALUES (?, ?, 'outline', ?, 'data/a.txt', 'hash', ?, ?, ?)`
  );
  insertSource.run(SOURCE_ACTIVE, DRAMA_ACTIVE, '活动来源', '{"lang":"zh"}', now, null);
  insertSource.run(SOURCE_RECYCLING, DRAMA_RECYCLING, '回收中来源', '{}', now, null);
  insertSource.run(SOURCE_OTHER, DRAMA_OTHER, '其他来源', '{}', now, null);
  insertSource.run(SOURCE_DELETED, DRAMA_ACTIVE, '已删来源', '{}', now, now);

  const insertItem = db.prepare(
    `INSERT INTO source_items
     (id, source_id, item_type, item_no, title, raw_text, summary, status, created_at, updated_at)
     VALUES (?, ?, 'outline', ?, ?, ?, ?, 'ready', ?, ?)`
  );
  insertItem.run(ITEM_ACTIVE, SOURCE_ACTIVE, 1, '活动条目', '林夏发现一封信', '林夏发现一封信', now, now);
  // 反例：条目的 source_id 等于活动项目 ID，不能被当成活动来源的条目。
  insertItem.run(ITEM_MISBOUND, SOURCE_DELETED, 9, '错绑条目', '不该出现', '不该出现', now, now);
  insertItem.run(ITEM_OTHER, SOURCE_OTHER, 1, '其他条目', '顾言离开', '顾言离开', now, now);

  const insertEvent = db.prepare(
    `INSERT INTO story_events
     (id, drama_id, source_item_id, event_no, title, detail, characters, location, tension, hook_score, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 2, 3, ?)`
  );
  insertEvent.run(EVENT_ACTIVE, DRAMA_ACTIVE, ITEM_ACTIVE, 1, '发现信件', '林夏发现一封信', '["林夏"]', '码头', now);
  // 反例：事件挂在其他条目上，即使 drama_id 相同也不能并入活动来源详情。
  insertEvent.run(EVENT_OTHER, DRAMA_ACTIVE, ITEM_MISBOUND, 1, '其他事件', '顾言离开', '["顾言"]', '山道', now);

  const insertPlan = db.prepare(
    `INSERT INTO adaptation_plans
     (id, drama_id, source_id, target_episode_count, style, plan_json, status, created_at, updated_at)
     VALUES (?, ?, ?, 1, 'realistic', '{}', 'draft', ?, ?)`
  );
  insertPlan.run(PLAN_OLDER, DRAMA_ACTIVE, SOURCE_ACTIVE, '2026-01-01T00:00:00.000Z', now);
  insertPlan.run(PLAN_ACTIVE, DRAMA_ACTIVE, SOURCE_ACTIVE, '2026-01-02T00:00:00.000Z', now);
  insertPlan.run(PLAN_OTHER, DRAMA_OTHER, SOURCE_OTHER, now, now);

  const insertEdge = db.prepare(
    `INSERT INTO story_event_edges
     (id, drama_id, source_id, from_event_id, to_event_id, relation_type, description, created_at)
     VALUES (?, ?, ?, ?, ?, 'next', 'edge', ?)`
  );
  insertEdge.run(EDGE_ACTIVE, DRAMA_ACTIVE, SOURCE_ACTIVE, EVENT_ACTIVE, EVENT_ACTIVE, now);
  insertEdge.run(EDGE_OTHER, DRAMA_ACTIVE, SOURCE_DELETED, EVENT_OTHER, EVENT_OTHER, now);
  return db;
}

test('跨模块 ID 在测试数据中互不相等', () => {
  const ids = [
    DRAMA_ACTIVE, DRAMA_RECYCLING, DRAMA_OTHER,
    SOURCE_ACTIVE, SOURCE_RECYCLING, SOURCE_OTHER, SOURCE_DELETED,
    ITEM_ACTIVE, ITEM_MISBOUND, ITEM_OTHER,
    EVENT_ACTIVE, EVENT_OTHER,
    PLAN_ACTIVE, PLAN_OLDER, PLAN_OTHER,
    EPISODE_ACTIVE, EDGE_ACTIVE, EDGE_OTHER,
  ];
  assert.equal(new Set(ids).size, ids.length);
  assert.notEqual(DRAMA_ACTIVE, SOURCE_ACTIVE);
  assert.notEqual(SOURCE_ACTIVE, EPISODE_ACTIVE);
  assert.notEqual(DRAMA_ACTIVE, EPISODE_ACTIVE);
});

test('sourceIntakeService 公开查询 API 仍指向查询模块的同一函数', () => {
  assert.equal(sourceIntakeService.listSourcesByDrama, query.listSourcesByDrama);
  assert.equal(sourceIntakeService.getSourceById, query.getSourceById);
  assert.equal(sourceIntakeService.getSourceDetail, query.getSourceDetail);
  assert.equal(sourceIntakeService.getEventEdgesForSource, query.getEventEdgesForSource);
  assert.equal(sourceIntakeService.getLatestPlanForSource, query.getLatestPlanForSource);
  assert.equal(sourceIntakeService.getAdaptationPlanById, query.getAdaptationPlanById);
});

test('列表按 drama_id 过滤，不把 source_id 或 episode_id 当成项目编号', () => {
  const db = createDb();
  try {
    const listed = query.listSourcesByDrama(db, DRAMA_ACTIVE);
    assert.deepEqual(listed.map((item) => item.id), [SOURCE_ACTIVE]);
    assert.equal(listed[0].drama_id, DRAMA_ACTIVE);
    assert.deepEqual(query.listSourcesByDrama(db, SOURCE_ACTIVE), []);
    assert.deepEqual(query.listSourcesByDrama(db, EPISODE_ACTIVE), []);
    assert.deepEqual(query.listSourcesByDrama(db, DRAMA_OTHER).map((item) => item.id), [SOURCE_OTHER]);
  } finally {
    db.close();
  }
});

test('详情读取用来源行真实 source_id，拒绝用项目或剧集编号冒充', () => {
  const db = createDb();
  try {
    const source = query.getSourceById(db, SOURCE_ACTIVE);
    assert.deepEqual(source, rowToSource(db.prepare('SELECT * FROM story_sources WHERE id = ?').get(SOURCE_ACTIVE)));
    assert.equal(query.getSourceById(db, DRAMA_ACTIVE), null);
    assert.equal(query.getSourceById(db, EPISODE_ACTIVE), null);
    assert.equal(query.getSourceById(db, SOURCE_DELETED), null);

    const detail = query.getSourceDetail(db, SOURCE_ACTIVE);
    assert.equal(detail.source.id, SOURCE_ACTIVE);
    assert.deepEqual(detail.items.map((item) => item.id), [ITEM_ACTIVE]);
    assert.equal(detail.items.some((item) => item.id === ITEM_MISBOUND), false);
    assert.deepEqual(detail.events.map((event) => event.id), [EVENT_ACTIVE]);
    assert.equal(detail.events.some((event) => event.id === EVENT_OTHER), false);
    assert.deepEqual(detail.adaptation_plans.map((plan) => plan.id), [PLAN_ACTIVE, PLAN_OLDER]);
    assert.deepEqual(detail.event_edges.map((edge) => edge.id), [EDGE_ACTIVE]);
    assert.equal(query.getSourceDetail(db, DRAMA_ACTIVE), null);
    assert.equal(query.getSourceDetail(db, EPISODE_ACTIVE), null);
  } finally {
    db.close();
  }
});

test('来源详情按来源行真实父项目失败关闭', () => {
  const db = createDb();
  try {
    assert.throws(
      () => query.getSourceById(db, SOURCE_RECYCLING),
      (error) => error.code === 'DRAMA_RECYCLE_IN_PROGRESS'
    );
    assert.throws(
      () => query.getSourceDetail(db, SOURCE_RECYCLING),
      (error) => error.code === 'DRAMA_RECYCLE_IN_PROGRESS'
    );
  } finally {
    db.close();
  }
});

test('事件边和改编方案按 source_id 读取，不用 drama_id 或 episode_id 代替', () => {
  const db = createDb();
  try {
    const edges = query.getEventEdgesForSource(db, SOURCE_ACTIVE);
    assert.deepEqual(edges.map((edge) => edge.id), [EDGE_ACTIVE]);
    assert.equal(edges[0].drama_id, DRAMA_ACTIVE);
    assert.equal(edges[0].source_id, SOURCE_ACTIVE);
    assert.deepEqual(query.getEventEdgesForSource(db, DRAMA_ACTIVE), []);
    assert.deepEqual(query.getEventEdgesForSource(db, EPISODE_ACTIVE), []);

    const latest = query.getLatestPlanForSource(db, SOURCE_ACTIVE);
    assert.equal(latest.id, PLAN_ACTIVE);
    assert.equal(latest.source_id, SOURCE_ACTIVE);
    assert.equal(query.getLatestPlanForSource(db, DRAMA_ACTIVE), null);
    assert.equal(query.getLatestPlanForSource(db, EPISODE_ACTIVE), null);

    const plan = query.getAdaptationPlanById(db, PLAN_ACTIVE);
    assert.deepEqual(plan, rowToPlan(db.prepare('SELECT * FROM adaptation_plans WHERE id = ?').get(PLAN_ACTIVE)));
    assert.equal(plan.drama_id, DRAMA_ACTIVE);
    assert.equal(plan.source_id, SOURCE_ACTIVE);
    assert.equal(query.getAdaptationPlanById(db, SOURCE_ACTIVE), null);
    assert.equal(query.getAdaptationPlanById(db, DRAMA_ACTIVE), null);
    assert.equal(query.getAdaptationPlanById(db, EPISODE_ACTIVE), null);
  } finally {
    db.close();
  }
});
