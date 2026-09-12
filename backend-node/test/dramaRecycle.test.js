const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const dramaRecycle = require('../src/services/dramaRecycle');
const dramaService = require('../src/services/dramaService');

const log = {
  info() {},
  warn() {},
  error() {},
  errorw() {},
};

const DRAMA_ID = 7;
const OTHER_DRAMA_ID = 3;
const EPISODE_ID = 99;
const STORYBOARD_ID = 55;
const PROP_ID = 41;
const CHARACTER_ID = 13;
const SCENE_ID = 17;
const OPERATION_ID = 'op-recycle-A';
const OTHER_OPERATION_ID = 'op-recycle-B';

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      description TEXT,
      genre TEXT,
      style TEXT DEFAULT 'realistic',
      tags TEXT,
      thumbnail TEXT,
      total_episodes INTEGER DEFAULT 1,
      total_duration INTEGER DEFAULT 0,
      status TEXT DEFAULT 'draft',
      metadata TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT,
      trash_state TEXT,
      recycle_operation_id TEXT,
      recycle_phase TEXT,
      recycle_started_at TEXT
    );
    CREATE TABLE episodes (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY,
      episode_id INTEGER NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE props (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE scenes (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE async_tasks (
      id TEXT PRIMARY KEY,
      type TEXT,
      resource_id TEXT,
      status TEXT,
      deleted_at TEXT
    );
    CREATE TABLE image_generations (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      task_id TEXT,
      deleted_at TEXT
    );
    CREATE TABLE video_generations (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      task_id TEXT,
      deleted_at TEXT
    );
    CREATE TABLE video_merges (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      episode_id INTEGER,
      task_id TEXT,
      deleted_at TEXT
    );
  `);
  return db;
}

function seedProjects(db) {
  const now = '2026-07-01T00:00:00.000Z';
  db.prepare(`
    INSERT INTO dramas (id, title, status, metadata, created_at, updated_at)
    VALUES (?, ?, 'draft', '{}', ?, ?)
  `).run(DRAMA_ID, '主项目', now, now);
  db.prepare(`
    INSERT INTO dramas (id, title, status, metadata, created_at, updated_at)
    VALUES (?, ?, 'draft', '{}', ?, ?)
  `).run(OTHER_DRAMA_ID, '对照项目', now, now);
  db.prepare('INSERT INTO episodes (id, drama_id) VALUES (?, ?)').run(EPISODE_ID, DRAMA_ID);
  db.prepare('INSERT INTO storyboards (id, episode_id) VALUES (?, ?)').run(STORYBOARD_ID, EPISODE_ID);
  db.prepare('INSERT INTO props (id, drama_id) VALUES (?, ?)').run(PROP_ID, DRAMA_ID);
  db.prepare('INSERT INTO characters (id, drama_id) VALUES (?, ?)').run(CHARACTER_ID, DRAMA_ID);
  db.prepare('INSERT INTO scenes (id, drama_id) VALUES (?, ?)').run(SCENE_ID, DRAMA_ID);
}

function assertDistinctIds() {
  const ids = [DRAMA_ID, OTHER_DRAMA_ID, EPISODE_ID, STORYBOARD_ID, PROP_ID, CHARACTER_ID, SCENE_ID];
  assert.equal(new Set(ids).size, ids.length);
  assert.notEqual(String(DRAMA_ID), OPERATION_ID);
  assert.notEqual(String(EPISODE_ID), OPERATION_ID);
  assert.notEqual(OPERATION_ID, OTHER_OPERATION_ID);
}

function markRecycling(db, dramaId, operationId, phase = 'cancelling', startedAt = '2026-07-01T00:00:00.000Z') {
  db.prepare(`
    UPDATE dramas
       SET trash_state = 'recycling',
           recycle_operation_id = ?,
           recycle_phase = ?,
           recycle_started_at = ?,
           updated_at = ?
     WHERE id = ?
  `).run(operationId, phase, startedAt, startedAt, dramaId);
}

test('dramaService 再导出与 dramaRecycle 是同一批公开函数', () => {
  assert.equal(dramaService.moveDramaToTrash, dramaRecycle.moveDramaToTrash);
  assert.equal(dramaService.restoreDrama, dramaRecycle.restoreDrama);
  assert.equal(dramaService.recoverInterruptedTrashOperations, dramaRecycle.recoverInterruptedTrashOperations);
});

test('declaredTaskDramaIds 按 episode 真实归属解析，不把 episode_id 当 drama_id', () => {
  assertDistinctIds();
  const db = createDb();
  try {
    seedProjects(db);
    const episodeResource = String(EPISODE_ID);
    for (const type of [
      'background_extraction',
      'prop_extraction',
      'storyboard_generation',
      'video_merge',
      'character_extraction',
    ]) {
      assert.deepEqual(
        dramaRecycle.declaredTaskDramaIds(db, { type, resource_id: episodeResource }),
        [DRAMA_ID],
        type
      );
    }
    assert.deepEqual(
      dramaRecycle.declaredTaskDramaIds(db, {
        type: 'frame_prompt_generation',
        resource_id: String(STORYBOARD_ID),
      }),
      [DRAMA_ID]
    );
    const videoGenerationByEpisodeResource = dramaRecycle.declaredTaskDramaIds(db, {
      type: 'video_generation',
      resource_id: episodeResource,
    });
    // video_generation 的 resource_id 本身就是 drama_id，不能走 episode 表反查。
    assert.deepEqual(videoGenerationByEpisodeResource, [EPISODE_ID]);
    assert.notDeepEqual(videoGenerationByEpisodeResource, [DRAMA_ID]);
    assert.deepEqual(
      dramaRecycle.declaredTaskDramaIds(db, {
        type: 'story_generation',
        resource_id: String(DRAMA_ID),
      }),
      [DRAMA_ID]
    );
    assert.deepEqual(
      dramaRecycle.declaredTaskDramaIds(db, {
        type: 'prop_image_generation',
        resource_id: String(PROP_ID),
      }),
      [DRAMA_ID]
    );
    assert.deepEqual(
      dramaRecycle.declaredTaskDramaIds(db, {
        type: 'character_image',
        resource_id: String(CHARACTER_ID),
      }),
      [DRAMA_ID]
    );
    assert.deepEqual(
      dramaRecycle.declaredTaskDramaIds(db, {
        type: 'image_generation',
        resource_id: 'character_' + CHARACTER_ID,
      }),
      [DRAMA_ID]
    );
    assert.deepEqual(
      dramaRecycle.declaredTaskDramaIds(db, {
        type: 'image_generation',
        resource_id: 'scene_' + SCENE_ID,
      }),
      [DRAMA_ID]
    );
  } finally {
    db.close();
  }
});

test('relatedTaskDramaIds 读取业务表 drama_id，不把 episode_id 当 drama_id', () => {
  assertDistinctIds();
  const db = createDb();
  try {
    seedProjects(db);
    db.prepare(`
      INSERT INTO video_merges (id, drama_id, episode_id, task_id, deleted_at)
      VALUES (1, ?, ?, ?, NULL)
    `).run(DRAMA_ID, EPISODE_ID, OPERATION_ID);
    db.prepare(`
      INSERT INTO video_generations (id, drama_id, task_id, deleted_at)
      VALUES (2, ?, ?, NULL)
    `).run(OTHER_DRAMA_ID, OTHER_OPERATION_ID);
    assert.deepEqual(dramaRecycle.relatedTaskDramaIds(db, OPERATION_ID), [DRAMA_ID]);
    assert.deepEqual(dramaRecycle.relatedTaskDramaIds(db, OTHER_OPERATION_ID), [OTHER_DRAMA_ID]);
    assert.deepEqual(dramaRecycle.relatedTaskDramaIds(db, String(EPISODE_ID)), []);
  } finally {
    db.close();
  }
});

test('persistDramaRemoval 只提交匹配的 drama_id 与 operationId', () => {
  assertDistinctIds();
  const db = createDb();
  try {
    seedProjects(db);
    markRecycling(db, DRAMA_ID, OPERATION_ID, 'ready_to_commit');
    assert.equal(dramaRecycle.persistDramaRemoval(db, log, EPISODE_ID, OPERATION_ID), null);
    assert.equal(dramaRecycle.persistDramaRemoval(db, log, DRAMA_ID, OTHER_OPERATION_ID), null);
    assert.equal(dramaRecycle.persistDramaRemoval(db, log, OTHER_DRAMA_ID, OPERATION_ID), null);
    const row = db.prepare('SELECT deleted_at, trash_state FROM dramas WHERE id = ?').get(DRAMA_ID);
    assert.equal(row.deleted_at, null);
    assert.equal(row.trash_state, 'recycling');

    const removed = dramaRecycle.persistDramaRemoval(db, log, DRAMA_ID, OPERATION_ID);
    assert.equal(removed.id, DRAMA_ID);
    assert.equal(removed.is_removed, true);
    assert.equal(
      db.prepare('SELECT deleted_at FROM dramas WHERE id = ?').get(OTHER_DRAMA_ID).deleted_at,
      null
    );
  } finally {
    db.close();
  }
});

test('回收锁函数只认 drama_id 加 operationId，不会误伤对照项目', () => {
  assertDistinctIds();
  const db = createDb();
  try {
    seedProjects(db);
    markRecycling(db, DRAMA_ID, OPERATION_ID, 'cancelling');
    markRecycling(db, OTHER_DRAMA_ID, OTHER_OPERATION_ID, 'cancelling');

    assert.equal(
      dramaRecycle.releaseDramaRecycleLock(db, log, EPISODE_ID, OPERATION_ID, 'wrong_id'),
      false
    );
    assert.equal(
      dramaRecycle.markDramaRecycleManualIntervention(db, log, EPISODE_ID, OPERATION_ID, 'wrong_id'),
      false
    );
    assert.equal(
      dramaRecycle.releaseDramaRecycleLock(db, log, DRAMA_ID, OTHER_OPERATION_ID, 'wrong_op'),
      false
    );
    assert.equal(
      dramaRecycle.markDramaRecycleManualIntervention(db, log, DRAMA_ID, OPERATION_ID, 'need_help'),
      true
    );
    assert.equal(
      db.prepare('SELECT recycle_phase FROM dramas WHERE id = ?').get(DRAMA_ID).recycle_phase,
      'manual_intervention'
    );
    assert.equal(
      db.prepare('SELECT recycle_phase FROM dramas WHERE id = ?').get(OTHER_DRAMA_ID).recycle_phase,
      'cancelling'
    );
    assert.equal(
      dramaRecycle.releaseDramaRecycleLock(db, log, DRAMA_ID, OPERATION_ID, 'give_up'),
      true
    );
    assert.deepEqual(
      db.prepare('SELECT trash_state, recycle_operation_id, recycle_phase FROM dramas WHERE id = ?').get(DRAMA_ID),
      { trash_state: null, recycle_operation_id: null, recycle_phase: null }
    );
    assert.equal(
      db.prepare('SELECT trash_state FROM dramas WHERE id = ?').get(OTHER_DRAMA_ID).trash_state,
      'recycling'
    );
  } finally {
    db.close();
  }
});

test('restoreDrama 按 drama_id 恢复，不会把 episode_id 当成项目 ID', () => {
  assertDistinctIds();
  const db = createDb();
  try {
    seedProjects(db);
    db.prepare(`
      UPDATE dramas
         SET deleted_at = ?, trash_state = NULL, recycle_phase = 'completed'
       WHERE id = ?
    `).run('2026-07-02T00:00:00.000Z', DRAMA_ID);

    assert.equal(dramaRecycle.restoreDrama(db, log, EPISODE_ID), null);
    assert.equal(dramaService.restoreDrama(db, log, EPISODE_ID), null);
    assert.ok(db.prepare('SELECT deleted_at FROM dramas WHERE id = ?').get(DRAMA_ID).deleted_at);

    const restored = dramaService.restoreDrama(db, log, DRAMA_ID);
    assert.equal(restored.id, DRAMA_ID);
    assert.equal(restored.is_removed, false);
    assert.equal(db.prepare('SELECT deleted_at FROM dramas WHERE id = ?').get(OTHER_DRAMA_ID).deleted_at, null);
  } finally {
    db.close();
  }
});

test('moveDramaToTrash 只回收目标项目，即使 episode_id 等于其他数字 ID', async () => {
  assertDistinctIds();
  const db = createDb();
  try {
    seedProjects(db);
    const removed = await dramaRecycle.moveDramaToTrash(db, log, DRAMA_ID);
    assert.equal(removed.id, DRAMA_ID);
    assert.equal(removed.is_removed, true);
    const other = db.prepare('SELECT deleted_at, trash_state FROM dramas WHERE id = ?').get(OTHER_DRAMA_ID);
    assert.equal(other.deleted_at, null);
    assert.equal(other.trash_state, null);
    assert.equal(await dramaRecycle.moveDramaToTrash(db, log, EPISODE_ID), null);
  } finally {
    db.close();
  }
});

test('auditActiveTaskOwnership 把 episode 任务归到真实项目', () => {
  assertDistinctIds();
  const db = createDb();
  try {
    seedProjects(db);
    db.prepare(`
      INSERT INTO async_tasks (id, type, resource_id, status, deleted_at)
      VALUES (?, 'character_extraction', ?, 'processing', NULL)
    `).run(OPERATION_ID, String(EPISODE_ID));
    const ownedByDrama = dramaRecycle.auditActiveTaskOwnership(db, DRAMA_ID);
    const ownedByOther = dramaRecycle.auditActiveTaskOwnership(db, OTHER_DRAMA_ID);
    const ownedByEpisode = dramaRecycle.auditActiveTaskOwnership(db, EPISODE_ID);
    assert.equal(ownedByDrama.length, 1);
    assert.equal(ownedByDrama[0].id, OPERATION_ID);
    assert.deepEqual(ownedByOther, []);
    assert.deepEqual(ownedByEpisode, []);
  } finally {
    db.close();
  }
});

test('超期恢复按 dramas.id 和 operationId 标记人工介入，不使用 episode_id', () => {
  assertDistinctIds();
  const db = createDb();
  try {
    seedProjects(db);
    const expiredAt = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    markRecycling(db, DRAMA_ID, OPERATION_ID, 'claimed', expiredAt);
    assert.equal(dramaRecycle.dramaRecycleDeadlineExceeded(db, EPISODE_ID, OPERATION_ID), true);
    assert.equal(dramaRecycle.dramaRecycleDeadlineExceeded(db, DRAMA_ID, OTHER_OPERATION_ID), true);
    assert.equal(dramaRecycle.dramaRecycleDeadlineExceeded(db, DRAMA_ID, OPERATION_ID), true);
    assert.equal(dramaRecycle.recoverInterruptedTrashOperations(db, log), 1);
    const row = db.prepare(
      'SELECT trash_state, recycle_operation_id, recycle_phase FROM dramas WHERE id = ?'
    ).get(DRAMA_ID);
    assert.equal(row.trash_state, 'recycling');
    assert.equal(row.recycle_operation_id, OPERATION_ID);
    assert.equal(row.recycle_phase, 'manual_intervention');
    assert.equal(
      db.prepare('SELECT recycle_phase FROM dramas WHERE id = ?').get(OTHER_DRAMA_ID).recycle_phase,
      null
    );
  } finally {
    db.close();
  }
});

test('dramaRecycleRecoveryKey 区分 drama_id 与 operationId', () => {
  assertDistinctIds();
  assert.equal(dramaRecycle.dramaRecycleRecoveryKey(DRAMA_ID, OPERATION_ID), `${DRAMA_ID}:${OPERATION_ID}`);
  assert.notEqual(
    dramaRecycle.dramaRecycleRecoveryKey(DRAMA_ID, OPERATION_ID),
    dramaRecycle.dramaRecycleRecoveryKey(EPISODE_ID, OPERATION_ID)
  );
  assert.notEqual(
    dramaRecycle.dramaRecycleRecoveryKey(DRAMA_ID, OPERATION_ID),
    dramaRecycle.dramaRecycleRecoveryKey(DRAMA_ID, OTHER_OPERATION_ID)
  );
});
