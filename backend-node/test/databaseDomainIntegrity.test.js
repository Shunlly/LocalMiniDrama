const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { getDb, closeDb } = require('../src/db');
const {
  DOMAIN_INTEGRITY_ERROR_CODE,
  auditNovel2AnimeDomainIntegrity,
  runMigrationsAndEnsure,
} = require('../src/db/migrate');

function createDb(t) {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  t.after(() => db.close());
  return db;
}

function insertDrama(db, id, title) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO dramas (id, title, status, created_at, updated_at)
     VALUES (?, ?, 'draft', ?, ?)`
  ).run(id, title, now, now);
  const episode = db.prepare(
    `INSERT INTO episodes (drama_id, episode_number, title, status, created_at, updated_at)
     VALUES (?, 1, ?, 'draft', ?, ?)`
  ).run(id, `${title} episode`, now, now);
  const episodeId = Number(episode.lastInsertRowid);
  const storyboard = db.prepare(
    `INSERT INTO storyboards
       (episode_id, storyboard_number, title, status, created_at, updated_at)
     VALUES (?, 1, ?, 'draft', ?, ?)`
  ).run(episodeId, `${title} shot`, now, now);
  return { dramaId: id, episodeId, storyboardId: Number(storyboard.lastInsertRowid), now };
}

function insertSourceGraph(db, parent, suffix) {
  const source = db.prepare(
    `INSERT INTO story_sources
       (drama_id, source_type, title, content_hash, metadata, created_at)
     VALUES (?, 'storyboard', ?, ?, '{}', ?)`
  ).run(parent.dramaId, `source-${suffix}`, `hash-${suffix}`, parent.now);
  const sourceId = Number(source.lastInsertRowid);
  const insertItem = db.prepare(
    `INSERT INTO source_items
       (source_id, item_type, item_no, title, raw_text, status, created_at, updated_at)
     VALUES (?, 'storyboard', ?, ?, ?, 'ready', ?, ?)`
  );
  const firstItem = insertItem.run(sourceId, 1, `item-${suffix}-1`, 'first', parent.now, parent.now);
  const secondItem = insertItem.run(sourceId, 2, `item-${suffix}-2`, 'second', parent.now, parent.now);
  const insertEvent = db.prepare(
    `INSERT INTO story_events
       (drama_id, source_item_id, event_no, title, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const firstEvent = insertEvent.run(
    parent.dramaId,
    Number(firstItem.lastInsertRowid),
    1,
    `event-${suffix}-1`,
    'first',
    parent.now
  );
  const secondEvent = insertEvent.run(
    parent.dramaId,
    Number(secondItem.lastInsertRowid),
    2,
    `event-${suffix}-2`,
    'second',
    parent.now
  );
  const firstEventId = Number(firstEvent.lastInsertRowid);
  const secondEventId = Number(secondEvent.lastInsertRowid);
  db.prepare(
    `INSERT INTO story_event_edges
       (drama_id, source_id, from_event_id, to_event_id, relation_type, created_at)
     VALUES (?, ?, ?, ?, 'next', ?)`
  ).run(parent.dramaId, sourceId, firstEventId, secondEventId, parent.now);
  const plan = db.prepare(
    `INSERT INTO adaptation_plans
       (drama_id, source_id, target_episode_count, status, created_at, updated_at)
     VALUES (?, ?, 1, 'draft', ?, ?)`
  ).run(parent.dramaId, sourceId, parent.now, parent.now);
  return {
    sourceId,
    firstItemId: Number(firstItem.lastInsertRowid),
    secondItemId: Number(secondItem.lastInsertRowid),
    firstEventId,
    secondEventId,
    planId: Number(plan.lastInsertRowid),
  };
}

function insertWorkflowGraph(db, parent, suffix) {
  const runId = `run-${suffix}`;
  const stepId = `step-${suffix}`;
  db.prepare(
    `INSERT INTO workflow_runs
       (id, drama_id, episode_id, type, status, created_at, updated_at)
     VALUES (?, ?, ?, 'novel2anime', 'pending', ?, ?)`
  ).run(runId, parent.dramaId, parent.episodeId, parent.now, parent.now);
  db.prepare(
    `INSERT INTO workflow_steps
       (id, run_id, step_key, status, created_at, updated_at)
     VALUES (?, ?, 'source_intake', 'pending', ?, ?)`
  ).run(stepId, runId, parent.now, parent.now);
  const provider = db.prepare(
    `INSERT INTO provider_invocations
       (workflow_step_id, run_id, provider_type, provider_name, mode, status, created_at)
     VALUES (?, ?, 'text', 'fixture', 'production', 'success', ?)`
  ).run(stepId, runId, parent.now);
  const skill = db.prepare(
    `INSERT INTO skill_invocations
       (workflow_step_id, run_id, skill_name, status, created_at)
     VALUES (?, ?, 'localminidrama-source-intake', 'success', ?)`
  ).run(stepId, runId, parent.now);
  const qa = db.prepare(
    `INSERT INTO qa_reports (drama_id, episode_id, run_id, score, passed, created_at)
     VALUES (?, ?, ?, 100, 1, ?)`
  ).run(parent.dramaId, parent.episodeId, runId, parent.now);
  return {
    runId,
    stepId,
    providerId: Number(provider.lastInsertRowid),
    skillId: Number(skill.lastInsertRowid),
    qaId: Number(qa.lastInsertRowid),
  };
}

function insertTimelineGraph(db, parent, suffix) {
  const track = db.prepare(
    `INSERT INTO timeline_tracks
       (episode_id, type, name, sort_order, created_at, updated_at)
     VALUES (?, 'video', ?, 10, ?, ?)`
  ).run(parent.episodeId, `video-${suffix}`, parent.now, parent.now);
  const trackId = Number(track.lastInsertRowid);
  const item = db.prepare(
    `INSERT INTO timeline_items
       (track_id, storyboard_id, start_sec, end_sec, created_at, updated_at)
     VALUES (?, ?, 0, 1, ?, ?)`
  ).run(trackId, parent.storyboardId, parent.now, parent.now);
  return { trackId, itemId: Number(item.lastInsertRowid) };
}

function seedGraph(db) {
  const first = insertDrama(db, 101, 'first');
  const second = insertDrama(db, 202, 'second');
  return {
    first,
    second,
    firstSource: insertSourceGraph(db, first, 'first'),
    secondSource: insertSourceGraph(db, second, 'second'),
    firstWorkflow: insertWorkflowGraph(db, first, 'first'),
    secondWorkflow: insertWorkflowGraph(db, second, 'second'),
    firstTimeline: insertTimelineGraph(db, first, 'first'),
    secondTimeline: insertTimelineGraph(db, second, 'second'),
  };
}

function expectDomainConstraint(action, detail) {
  assert.throws(action, (error) => {
    assert.match(error.message, /domain_integrity:/);
    assert.match(error.message, new RegExp(detail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    return true;
  });
}

test('configured SQLite connections explicitly enable foreign key enforcement', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-db-integrity-'));
  t.after(() => {
    closeDb();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const db = getDb({ type: 'sqlite', path: path.join(root, 'test.db') });
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
});

test('migration installs once, reruns idempotently, and keeps its audit clean', (t) => {
  const db = createDb(t);
  const firstTriggers = db.prepare(
    "SELECT name, sql FROM sqlite_schema WHERE type = 'trigger' AND name LIKE 'trg_n2a_%' ORDER BY name"
  ).all();
  const firstIndexes = db.prepare(
    "SELECT name, sql FROM sqlite_schema WHERE type = 'index' AND name LIKE 'ux_n2a_%' ORDER BY name"
  ).all();
  assert.equal(firstTriggers.length, 44);
  assert.equal(firstIndexes.length, 4);

  runMigrationsAndEnsure(db);

  assert.deepEqual(db.prepare(
    "SELECT name, sql FROM sqlite_schema WHERE type = 'trigger' AND name LIKE 'trg_n2a_%' ORDER BY name"
  ).all(), firstTriggers);
  assert.deepEqual(db.prepare(
    "SELECT name, sql FROM sqlite_schema WHERE type = 'index' AND name LIKE 'ux_n2a_%' ORDER BY name"
  ).all(), firstIndexes);
  assert.deepEqual(auditNovel2AnimeDomainIntegrity(db), []);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
});

test('valid domain graph and soft-deleted parents remain writable and recoverable', (t) => {
  const db = createDb(t);
  const graph = seedGraph(db);
  const deletedAt = new Date().toISOString();
  db.prepare('UPDATE dramas SET deleted_at = ? WHERE id = ?').run(deletedAt, graph.first.dramaId);
  db.prepare('UPDATE episodes SET deleted_at = ? WHERE id = ?').run(deletedAt, graph.first.episodeId);
  db.prepare('UPDATE story_sources SET deleted_at = ? WHERE id = ?').run(deletedAt, graph.firstSource.sourceId);
  db.prepare('UPDATE workflow_runs SET deleted_at = ? WHERE id = ?').run(deletedAt, graph.firstWorkflow.runId);

  db.prepare(
    `INSERT INTO source_items
       (source_id, item_type, item_no, title, status, created_at, updated_at)
     VALUES (?, 'storyboard', 3, 'post-delete item', 'ready', ?, ?)`
  ).run(graph.firstSource.sourceId, deletedAt, deletedAt);
  db.prepare(
    `INSERT INTO workflow_steps
       (id, run_id, step_key, status, created_at, updated_at)
     VALUES ('step-first-2', ?, 'adaptation_plan', 'pending', ?, ?)`
  ).run(graph.firstWorkflow.runId, deletedAt, deletedAt);
  db.prepare(
    `INSERT INTO timeline_tracks
       (episode_id, type, name, created_at, updated_at)
     VALUES (?, 'subtitle', 'Subtitles', ?, ?)`
  ).run(graph.first.episodeId, deletedAt, deletedAt);

  assert.deepEqual(auditNovel2AnimeDomainIntegrity(db), []);
  db.prepare('UPDATE dramas SET deleted_at = NULL WHERE id = ?').run(graph.first.dramaId);
  db.prepare('UPDATE episodes SET deleted_at = NULL WHERE id = ?').run(graph.first.episodeId);
  db.prepare('UPDATE story_sources SET deleted_at = NULL WHERE id = ?').run(graph.firstSource.sourceId);
  db.prepare('UPDATE workflow_runs SET deleted_at = NULL WHERE id = ?').run(graph.firstWorkflow.runId);
  assert.deepEqual(auditNovel2AnimeDomainIntegrity(db), []);
});

test('insert and update triggers reject orphaned and cross-scope domain rows', (t) => {
  const db = createDb(t);
  const graph = seedGraph(db);
  const now = graph.first.now;

  expectDomainConstraint(() => db.prepare(
    "INSERT INTO workflow_steps (id, run_id, step_key, status, created_at, updated_at) VALUES ('orphan-step', 'missing', 'x', 'pending', ?, ?)"
  ).run(now, now), 'workflow_steps.run_id');
  expectDomainConstraint(() => db.prepare(
    "INSERT INTO timeline_tracks (episode_id, type, created_at) VALUES (999999, 'voice', ?)"
  ).run(now), 'timeline_tracks.episode_id');
  expectDomainConstraint(() => db.prepare(
    'INSERT INTO timeline_items (track_id, storyboard_id, created_at) VALUES (999999, ?, ?)'
  ).run(graph.first.storyboardId, now), 'timeline_items.track_id');
  expectDomainConstraint(() => db.prepare(
    'INSERT INTO timeline_items (track_id, storyboard_id, created_at) VALUES (?, 999999, ?)'
  ).run(graph.firstTimeline.trackId, now), 'timeline_items.storyboard_id');
  expectDomainConstraint(() => db.prepare(
    'INSERT INTO timeline_items (track_id, storyboard_id, created_at) VALUES (?, ?, ?)'
  ).run(graph.firstTimeline.trackId, graph.second.storyboardId, now), 'timeline_items storyboard episode');
  expectDomainConstraint(() => db.prepare(
    "INSERT INTO qa_reports (drama_id, run_id, created_at) VALUES (?, 'missing', ?)"
  ).run(graph.first.dramaId, now), 'qa_reports.run_id');
  expectDomainConstraint(() => db.prepare(
    `INSERT INTO provider_invocations
       (run_id, provider_type, provider_name, mode, status, created_at)
     VALUES ('missing', 'text', 'fixture', 'production', 'success', ?)`
  ).run(now), 'provider_invocations.run_id');
  expectDomainConstraint(() => db.prepare(
    `INSERT INTO provider_invocations
       (workflow_step_id, run_id, provider_type, provider_name, mode, status, created_at)
     VALUES ('missing', ?, 'text', 'fixture', 'production', 'success', ?)`
  ).run(graph.firstWorkflow.runId, now), 'provider_invocations.workflow_step_id');
  expectDomainConstraint(() => db.prepare(
    `INSERT INTO provider_invocations
       (workflow_step_id, run_id, provider_type, provider_name, mode, status, created_at)
     VALUES (?, ?, 'text', 'fixture', 'production', 'success', ?)`
  ).run(graph.firstWorkflow.stepId, graph.secondWorkflow.runId, now), 'provider_invocations step run');
  expectDomainConstraint(() => db.prepare(
    `INSERT INTO skill_invocations
       (workflow_step_id, run_id, skill_name, status, created_at)
     VALUES (?, ?, 'fixture-skill', 'success', ?)`
  ).run(graph.firstWorkflow.stepId, graph.secondWorkflow.runId, now), 'skill_invocations step run');
  expectDomainConstraint(() => db.prepare(
    "INSERT INTO story_sources (drama_id, source_type, created_at) VALUES (999999, 'text', ?)"
  ).run(now), 'story_sources.drama_id');
  expectDomainConstraint(() => db.prepare(
    "INSERT INTO source_items (source_id, item_type, item_no, status, created_at) VALUES (999999, 'text', 1, 'ready', ?)"
  ).run(now), 'source_items.source_id');
  expectDomainConstraint(() => db.prepare(
    'INSERT INTO story_events (drama_id, source_item_id, created_at) VALUES (?, ?, ?)'
  ).run(graph.second.dramaId, graph.firstSource.firstItemId, now), 'story_events source drama');
  expectDomainConstraint(() => db.prepare(
    "INSERT INTO adaptation_plans (drama_id, source_id, status, created_at) VALUES (?, ?, 'draft', ?)"
  ).run(graph.second.dramaId, graph.firstSource.sourceId, now), 'adaptation_plans source drama');
  expectDomainConstraint(() => db.prepare(
    `INSERT INTO story_event_edges
       (drama_id, source_id, from_event_id, to_event_id, relation_type, created_at)
     VALUES (?, ?, ?, ?, 'causes', ?)`
  ).run(
    graph.first.dramaId,
    graph.firstSource.sourceId,
    graph.firstSource.firstEventId,
    graph.secondSource.firstEventId,
    now
  ), 'story_event_edges event drama');

  expectDomainConstraint(() => db.prepare(
    'UPDATE workflow_steps SET run_id = ? WHERE id = ?'
  ).run(graph.secondWorkflow.runId, graph.firstWorkflow.stepId), 'workflow_steps dependent run');
  expectDomainConstraint(() => db.prepare(
    'UPDATE timeline_tracks SET episode_id = ? WHERE id = ?'
  ).run(graph.second.episodeId, graph.firstTimeline.trackId), 'timeline_tracks dependent episode');
  expectDomainConstraint(() => db.prepare(
    'UPDATE story_sources SET drama_id = ? WHERE id = ?'
  ).run(graph.second.dramaId, graph.firstSource.sourceId), 'story_sources dependent drama');
  assert.deepEqual(auditNovel2AnimeDomainIntegrity(db), []);
});

test('unique indexes reject duplicate workflow, timeline, source, and event-edge keys', (t) => {
  const db = createDb(t);
  const graph = seedGraph(db);
  const now = graph.first.now;

  assert.throws(() => db.prepare(
    `INSERT INTO workflow_steps
       (id, run_id, step_key, status, created_at, updated_at)
     VALUES ('duplicate-step', ?, 'source_intake', 'pending', ?, ?)`
  ).run(graph.firstWorkflow.runId, now, now), /UNIQUE constraint failed/);
  assert.throws(() => db.prepare(
    `INSERT INTO timeline_tracks (episode_id, type, created_at, updated_at)
     VALUES (?, 'video', ?, ?)`
  ).run(graph.first.episodeId, now, now), /UNIQUE constraint failed/);
  assert.throws(() => db.prepare(
    `INSERT INTO source_items
       (source_id, item_type, item_no, status, created_at)
     VALUES (?, 'storyboard', 1, 'ready', ?)`
  ).run(graph.firstSource.sourceId, now), /UNIQUE constraint failed/);
  assert.throws(() => db.prepare(
    `INSERT INTO story_event_edges
       (drama_id, source_id, from_event_id, to_event_id, relation_type, created_at)
     VALUES (?, ?, ?, ?, 'next', ?)`
  ).run(
    graph.first.dramaId,
    graph.firstSource.sourceId,
    graph.firstSource.firstEventId,
    graph.firstSource.secondEventId,
    now
  ), /UNIQUE constraint failed/);
});

test('hard deletes and parent id rewrites are restricted while soft deletion is unaffected', (t) => {
  const db = createDb(t);
  const graph = seedGraph(db);

  expectDomainConstraint(() => db.prepare('DELETE FROM dramas WHERE id = ?').run(graph.first.dramaId), 'dramas has dependents');
  expectDomainConstraint(() => db.prepare('DELETE FROM episodes WHERE id = ?').run(graph.first.episodeId), 'episodes has dependents');
  expectDomainConstraint(() => db.prepare('DELETE FROM storyboards WHERE id = ?').run(graph.first.storyboardId), 'storyboards has timeline items');
  expectDomainConstraint(() => db.prepare('DELETE FROM story_sources WHERE id = ?').run(graph.firstSource.sourceId), 'story_sources has dependents');
  expectDomainConstraint(() => db.prepare('DELETE FROM source_items WHERE id = ?').run(graph.firstSource.firstItemId), 'source_items has events');
  expectDomainConstraint(() => db.prepare('DELETE FROM story_events WHERE id = ?').run(graph.firstSource.firstEventId), 'story_events has edges');
  expectDomainConstraint(() => db.prepare('DELETE FROM workflow_runs WHERE id = ?').run(graph.firstWorkflow.runId), 'workflow_runs has dependents');
  expectDomainConstraint(() => db.prepare('DELETE FROM workflow_steps WHERE id = ?').run(graph.firstWorkflow.stepId), 'workflow_steps has dependents');
  expectDomainConstraint(() => db.prepare('DELETE FROM timeline_tracks WHERE id = ?').run(graph.firstTimeline.trackId), 'timeline_tracks has items');
  expectDomainConstraint(() => db.prepare('UPDATE workflow_runs SET id = ? WHERE id = ?').run('rewritten', graph.firstWorkflow.runId), 'workflow_runs id has dependents');

  const empty = insertDrama(db, 303, 'empty');
  db.prepare('DELETE FROM storyboards WHERE id = ?').run(empty.storyboardId);
  db.prepare('DELETE FROM episodes WHERE id = ?').run(empty.episodeId);
  db.prepare('DELETE FROM dramas WHERE id = ?').run(empty.dramaId);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM dramas WHERE id = ?').get(empty.dramaId).count, 0);
});

test('legacy orphan audit blocks startup atomically and preserves every offending row', (t) => {
  const db = createDb(t);
  const graph = seedGraph(db);
  db.exec('DROP TRIGGER trg_n2a_workflow_steps_parent_insert');
  db.prepare(
    `INSERT INTO workflow_steps
       (id, run_id, step_key, status, created_at, updated_at)
     VALUES ('legacy-orphan-step', 'missing-run', 'legacy', 'pending', ?, ?)`
  ).run(graph.first.now, graph.first.now);

  const audit = auditNovel2AnimeDomainIntegrity(db);
  assert.deepEqual(audit, [{
    code: 'workflow_steps_missing_run',
    count: 1,
    samples: ['legacy-orphan-step'],
  }]);
  assert.throws(() => runMigrationsAndEnsure(db), (error) => {
    assert.equal(error.code, DOMAIN_INTEGRITY_ERROR_CODE);
    assert.match(error.message, /not deleted or auto-repaired/);
    assert.match(error.message, /workflow_steps_missing_run=1/);
    assert.deepEqual(error.violations, audit);
    return true;
  });
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM workflow_steps WHERE id = 'legacy-orphan-step'").get().count, 1);
  assert.equal(db.prepare(
    "SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'trigger' AND name = 'trg_n2a_workflow_steps_parent_insert'"
  ).get().count, 0, 'failed install must not partially recreate triggers');
});

test('legacy duplicate audit reports keys and does not discard user data', (t) => {
  const db = createDb(t);
  const graph = seedGraph(db);
  db.exec('DROP INDEX ux_n2a_workflow_steps_run_key');
  db.prepare(
    `INSERT INTO workflow_steps
       (id, run_id, step_key, status, created_at, updated_at)
     VALUES ('legacy-duplicate-step', ?, 'source_intake', 'pending', ?, ?)`
  ).run(graph.firstWorkflow.runId, graph.first.now, graph.first.now);

  assert.throws(() => runMigrationsAndEnsure(db), (error) => {
    assert.equal(error.code, DOMAIN_INTEGRITY_ERROR_CODE);
    const duplicate = error.violations.find((item) => item.code === 'workflow_steps_duplicate_key');
    assert.deepEqual(duplicate, {
      code: 'workflow_steps_duplicate_key',
      count: 1,
      samples: [`${graph.firstWorkflow.runId}:source_intake`],
    });
    return true;
  });
  assert.equal(db.prepare(
    "SELECT COUNT(*) AS count FROM workflow_steps WHERE run_id = ? AND step_key = 'source_intake'"
  ).get(graph.firstWorkflow.runId).count, 2);
  assert.equal(db.prepare(
    "SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'index' AND name = 'ux_n2a_workflow_steps_run_key'"
  ).get().count, 0, 'failed install must not partially recreate unique indexes');
});
