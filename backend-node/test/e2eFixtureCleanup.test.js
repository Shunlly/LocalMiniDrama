const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const {
  E2E_TITLE_PREFIX,
  purgeE2EFixture,
  resolveProjectStorageDirectory,
  resolveStorySourceDirectory,
} = require('../scripts/purge-e2e-fixture');

const FIXTURE_TABLES = [
  'adaptation_plans',
  'assets',
  'character_libraries',
  'characters',
  'creative_reviews',
  'dramas',
  'episode_characters',
  'episodes',
  'frame_prompts',
  'image_generations',
  'prop_libraries',
  'props',
  'provider_invocations',
  'qa_reports',
  'scene_libraries',
  'scenes',
  'skill_invocations',
  'source_items',
  'story_event_edges',
  'story_events',
  'story_sources',
  'storyboard_characters',
  'storyboard_props',
  'storyboards',
  'timeline_items',
  'timeline_tracks',
  'video_generations',
  'video_merges',
  'workflow_runs',
  'workflow_steps',
];

function createDb() {
  const db = new Database(':memory:');
  for (const file of ['01_init.sql', '23_novel2anime_workflows.sql', '24_provider_skill_pipeline.sql']) {
    db.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', file), 'utf8'));
  }
  db.exec(`
    CREATE TABLE storyboard_characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      storyboard_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      created_at TEXT
    );
    ALTER TABLE storyboards ADD COLUMN audio_local_path TEXT;
    ALTER TABLE storyboards ADD COLUMN narration_audio_local_path TEXT;
  `);
  return db;
}

function seedFixtureGraph(db, { dramaId, e2e }) {
  const base = dramaId * 100;
  const ids = {
    drama: dramaId,
    episode: base + 1,
    character: base + 2,
    scene: base + 3,
    prop: base + 4,
    storyboard: base + 5,
    imageGeneration: base + 6,
    videoGeneration: base + 7,
    videoMerge: base + 8,
    source: base + 9,
    sourceItem: base + 10,
    event: base + 11,
    track: base + 12,
    run: `run-${dramaId}`,
    step: `step-${dramaId}`,
  };
  const createdAt = '2026-07-10T00:00:00.000Z';
  const title = e2e ? `${E2E_TITLE_PREFIX}${dramaId}` : `Regular drama ${dramaId}`;
  const marker = e2e ? 'e2e' : 'keep';

  db.prepare('INSERT INTO dramas (id, title, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(ids.drama, title, JSON.stringify({ e2e }), createdAt, createdAt);
  db.prepare('INSERT INTO episodes (id, drama_id, title) VALUES (?, ?, ?)')
    .run(ids.episode, ids.drama, marker);
  db.prepare('INSERT INTO characters (id, drama_id, name) VALUES (?, ?, ?)')
    .run(ids.character, ids.drama, marker);
  db.prepare('INSERT INTO scenes (id, drama_id, episode_id, location) VALUES (?, ?, ?, ?)')
    .run(ids.scene, ids.drama, ids.episode, marker);
  db.prepare('INSERT INTO props (id, drama_id, name) VALUES (?, ?, ?)')
    .run(ids.prop, ids.drama, marker);
  db.prepare('INSERT INTO storyboards (id, episode_id, scene_id, title) VALUES (?, ?, ?, ?)')
    .run(ids.storyboard, ids.episode, ids.scene, marker);
  db.prepare('INSERT INTO episode_characters (episode_id, character_id) VALUES (?, ?)')
    .run(ids.episode, ids.character);
  db.prepare('INSERT INTO storyboard_characters (storyboard_id, character_id, created_at) VALUES (?, ?, ?)')
    .run(ids.storyboard, ids.character, createdAt);
  db.prepare('INSERT INTO storyboard_props (storyboard_id, prop_id) VALUES (?, ?)')
    .run(ids.storyboard, ids.prop);
  db.prepare('INSERT INTO frame_prompts (storyboard_id, prompt) VALUES (?, ?)')
    .run(ids.storyboard, marker);
  db.prepare(
    `INSERT INTO image_generations
     (id, storyboard_id, drama_id, scene_id, character_id, task_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    ids.imageGeneration,
    ids.storyboard,
    ids.drama,
    ids.scene,
    ids.character,
    `image-task-${dramaId}`
  );
  db.prepare(
    `INSERT INTO video_generations
     (id, drama_id, storyboard_id, scene_id, task_id)
     VALUES (?, ?, ?, ?, ?)`
  ).run(ids.videoGeneration, ids.drama, ids.storyboard, ids.scene, `video-task-${dramaId}`);
  db.prepare(
    'INSERT INTO video_merges (id, episode_id, drama_id, task_id) VALUES (?, ?, ?, ?)'
  ).run(ids.videoMerge, ids.episode, ids.drama, `merge-task-${dramaId}`);
  db.prepare(
    `INSERT INTO assets (drama_id, name, image_gen_id, video_gen_id)
     VALUES (?, ?, ?, ?)`
  ).run(ids.drama, marker, ids.imageGeneration, ids.videoGeneration);
  db.prepare('INSERT INTO character_libraries (drama_id, name) VALUES (?, ?)').run(ids.drama, marker);
  db.prepare('INSERT INTO scene_libraries (drama_id, location) VALUES (?, ?)').run(ids.drama, marker);
  db.prepare('INSERT INTO prop_libraries (drama_id, name) VALUES (?, ?)').run(ids.drama, marker);

  db.prepare(
    `INSERT INTO story_sources
     (id, drama_id, source_type, title, raw_text_path, content_hash, metadata, created_at)
     VALUES (?, ?, 'storyboard', ?, ?, ?, '{}', ?)`
  ).run(
    ids.source,
    ids.drama,
    marker,
    `data/story_sources/${ids.drama}/${marker}.txt`,
    marker,
    createdAt
  );
  db.prepare(
    `INSERT INTO source_items (id, source_id, item_type, title, created_at)
     VALUES (?, ?, 'scene', ?, ?)`
  ).run(ids.sourceItem, ids.source, marker, createdAt);
  db.prepare(
    `INSERT INTO story_events (id, drama_id, source_item_id, title, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(ids.event, ids.drama, ids.sourceItem, marker, createdAt);
  db.prepare(
    `INSERT INTO story_event_edges
     (drama_id, source_id, from_event_id, to_event_id, relation_type, created_at)
     VALUES (?, ?, ?, ?, 'next', ?)`
  ).run(ids.drama, ids.source, ids.event, ids.event, createdAt);
  db.prepare(
    `INSERT INTO adaptation_plans (drama_id, source_id, status, created_at)
     VALUES (?, ?, 'draft', ?)`
  ).run(ids.drama, ids.source, createdAt);

  db.prepare(
    `INSERT INTO workflow_runs
     (id, drama_id, episode_id, type, status, created_at, updated_at)
     VALUES (?, ?, ?, 'novel2anime', 'completed', ?, ?)`
  ).run(ids.run, ids.drama, ids.episode, createdAt, createdAt);
  db.prepare(
    `INSERT INTO workflow_steps
     (id, run_id, step_key, status, created_at, updated_at)
     VALUES (?, ?, 'source_intake', 'completed', ?, ?)`
  ).run(ids.step, ids.run, createdAt, createdAt);
  db.prepare(
    `INSERT INTO provider_invocations
     (workflow_step_id, run_id, provider_type, provider_name, mode, status, created_at)
     VALUES (?, ?, 'text', 'mock', 'mock', 'success', ?)`
  ).run(ids.step, ids.run, createdAt);
  db.prepare(
    `INSERT INTO skill_invocations
     (workflow_step_id, run_id, skill_name, status, created_at)
     VALUES (?, ?, 'localminidrama-source-intake', 'success', ?)`
  ).run(ids.step, ids.run, createdAt);
  db.prepare(
    `INSERT INTO creative_reviews
     (drama_id, run_id, source_id, role, target_type, status, created_at)
     VALUES (?, ?, ?, 'writer', 'source', 'resolved', ?)`
  ).run(ids.drama, ids.run, ids.source, createdAt);
  db.prepare(
    `INSERT INTO qa_reports (drama_id, episode_id, run_id, created_at)
     VALUES (?, ?, ?, ?)`
  ).run(ids.drama, ids.episode, ids.run, createdAt);
  db.prepare(
    `INSERT INTO timeline_tracks (id, episode_id, type, created_at, updated_at)
     VALUES (?, ?, 'video', ?, ?)`
  ).run(ids.track, ids.episode, createdAt, createdAt);
  db.prepare(
    `INSERT INTO timeline_items (track_id, storyboard_id, created_at, updated_at)
     VALUES (?, ?, ?, ?)`
  ).run(ids.track, ids.storyboard, createdAt, createdAt);

  const insertTask = db.prepare(
    `INSERT INTO async_tasks (id, type, status, resource_id)
     VALUES (?, ?, 'completed', ?)`
  );
  insertTask.run(`image-task-${dramaId}`, 'image_generation', String(ids.drama));
  insertTask.run(`video-task-${dramaId}`, 'video_generation', String(ids.drama));
  insertTask.run(`merge-task-${dramaId}`, 'video_merge', String(ids.episode));
  insertTask.run(`story-task-${dramaId}`, 'story_generation', String(ids.drama));
  insertTask.run(`storyboard-task-${dramaId}`, 'storyboard_generation', String(ids.episode));
  insertTask.run(`frame-task-${dramaId}`, 'frame_prompt_generation', String(ids.storyboard));

  return { ids, title };
}

function rowCounts(db, tables) {
  return Object.fromEntries(tables.map((table) => [
    table,
    db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
  ]));
}

test('purges one complete E2E graph and its source directory while retaining unrelated data', async (t) => {
  const db = createDb();
  const sourceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'localminidrama-e2e-purge-'));
  const storageRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'localminidrama-e2e-storage-'));
  t.after(async () => {
    db.close();
    await fsp.rm(sourceRoot, { recursive: true, force: true });
    await fsp.rm(storageRoot, { recursive: true, force: true });
  });

  const fixture = seedFixtureGraph(db, { dramaId: 1, e2e: true });
  const retained = seedFixtureGraph(db, { dramaId: 2, e2e: false });
  await fsp.mkdir(resolveStorySourceDirectory(sourceRoot, fixture.ids.drama), { recursive: true });
  await fsp.mkdir(resolveStorySourceDirectory(sourceRoot, retained.ids.drama), { recursive: true });
  await fsp.writeFile(path.join(sourceRoot, '1', 'e2e.txt'), 'fixture');
  await fsp.writeFile(path.join(sourceRoot, '2', 'keep.txt'), 'keep');
  const fixtureStorageDirectory = resolveProjectStorageDirectory(
    storageRoot,
    db.prepare('SELECT id, title, metadata, created_at FROM dramas WHERE id = ?').get(fixture.ids.drama)
  );
  const retainedStorageDirectory = resolveProjectStorageDirectory(
    storageRoot,
    db.prepare('SELECT id, title, metadata, created_at FROM dramas WHERE id = ?').get(retained.ids.drama)
  );
  await fsp.mkdir(path.join(fixtureStorageDirectory, 'images'), { recursive: true });
  await fsp.mkdir(path.join(retainedStorageDirectory, 'images'), { recursive: true });
  await fsp.writeFile(path.join(fixtureStorageDirectory, 'images', 'e2e.png'), 'fixture');
  await fsp.writeFile(path.join(retainedStorageDirectory, 'images', 'keep.png'), 'keep');
  const fixtureDialogue = `audio/tts_sb${fixture.ids.storyboard}_dialogue.mp3`;
  const fixtureNarration = `audio/tts_sb${fixture.ids.storyboard}_narration.mp3`;
  const retainedDialogue = `audio/tts_sb${retained.ids.storyboard}_dialogue.mp3`;
  await fsp.mkdir(path.join(storageRoot, 'audio'), { recursive: true });
  for (const relativePath of [fixtureDialogue, fixtureNarration, retainedDialogue]) {
    await fsp.writeFile(path.join(storageRoot, ...relativePath.split('/')), relativePath);
  }
  db.prepare(
    'UPDATE storyboards SET audio_local_path = ?, narration_audio_local_path = ? WHERE id = ?'
  ).run(fixtureDialogue, fixtureNarration, fixture.ids.storyboard);
  db.prepare('UPDATE storyboards SET audio_local_path = ? WHERE id = ?')
    .run(retainedDialogue, retained.ids.storyboard);

  const before = rowCounts(db, FIXTURE_TABLES);
  const registryCount = db.prepare('SELECT COUNT(*) AS count FROM skill_registry').get().count;
  const result = await purgeE2EFixture({
    db,
    dramaId: fixture.ids.drama,
    expectedTitle: fixture.title,
    storySourceRoot: sourceRoot,
    storageRoot,
  });

  assert.equal(result.verified, true);
  assert.deepEqual(result.residual, {});
  assert.deepEqual(result.media_cleanup, { candidates: 2, deleted: 2, missing: 0, shared: 0 });
  for (const table of FIXTURE_TABLES) {
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
      before[table] - 1,
      `${table} must remove exactly the E2E fixture row`
    );
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM async_tasks').get().count, 6);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM skill_registry').get().count, registryCount);
  assert.equal(db.prepare('SELECT title FROM dramas WHERE id = ?').get(retained.ids.drama).title, retained.title);
  await assert.rejects(fsp.lstat(path.join(sourceRoot, '1')), { code: 'ENOENT' });
  assert.equal((await fsp.readFile(path.join(sourceRoot, '2', 'keep.txt'), 'utf8')), 'keep');
  await assert.rejects(fsp.lstat(fixtureStorageDirectory), { code: 'ENOENT' });
  assert.equal((await fsp.readFile(path.join(retainedStorageDirectory, 'images', 'keep.png'), 'utf8')), 'keep');
  await assert.rejects(fsp.lstat(path.join(storageRoot, ...fixtureDialogue.split('/'))), { code: 'ENOENT' });
  await assert.rejects(fsp.lstat(path.join(storageRoot, ...fixtureNarration.split('/'))), { code: 'ENOENT' });
  assert.equal(
    await fsp.readFile(path.join(storageRoot, ...retainedDialogue.split('/')), 'utf8'),
    retainedDialogue
  );
});

test('retains fixture audio that is still referenced by unrelated project data', async (t) => {
  const db = createDb();
  const sourceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'localminidrama-e2e-shared-'));
  const storageRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'localminidrama-e2e-shared-storage-'));
  t.after(async () => {
    db.close();
    await fsp.rm(sourceRoot, { recursive: true, force: true });
    await fsp.rm(storageRoot, { recursive: true, force: true });
  });

  const fixture = seedFixtureGraph(db, { dramaId: 7, e2e: true });
  const retained = seedFixtureGraph(db, { dramaId: 8, e2e: false });
  const sharedAudio = `audio/tts_sb${fixture.ids.storyboard}_shared.mp3`;
  await fsp.mkdir(path.join(storageRoot, 'audio'), { recursive: true });
  await fsp.writeFile(path.join(storageRoot, ...sharedAudio.split('/')), 'shared');
  db.prepare('UPDATE storyboards SET audio_local_path = ? WHERE id IN (?, ?)')
    .run(sharedAudio, fixture.ids.storyboard, retained.ids.storyboard);

  const result = await purgeE2EFixture({
    db,
    dramaId: fixture.ids.drama,
    expectedTitle: fixture.title,
    storySourceRoot: sourceRoot,
    storageRoot,
  });

  assert.deepEqual(result.media_cleanup, { candidates: 1, deleted: 0, missing: 0, shared: 1 });
  assert.equal(await fsp.readFile(path.join(storageRoot, ...sharedAudio.split('/')), 'utf8'), 'shared');
  assert.equal(db.prepare('SELECT audio_local_path FROM storyboards WHERE id = ?')
    .get(retained.ids.storyboard).audio_local_path, sharedAudio);
});

test('ignores draft placeholders and safely normalizes legacy absolute audio paths', async (t) => {
  const db = createDb();
  const sourceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'localminidrama-e2e-legacy-audio-'));
  const storageRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'localminidrama-e2e-legacy-storage-'));
  t.after(async () => {
    db.close();
    await fsp.rm(sourceRoot, { recursive: true, force: true });
    await fsp.rm(storageRoot, { recursive: true, force: true });
  });

  const fixture = seedFixtureGraph(db, { dramaId: 9, e2e: true });
  await fsp.mkdir(resolveStorySourceDirectory(sourceRoot, fixture.ids.drama), { recursive: true });
  const storageDirectory = resolveProjectStorageDirectory(
    storageRoot,
    db.prepare('SELECT id, title, metadata, created_at FROM dramas WHERE id = ?').get(fixture.ids.drama),
  );
  await fsp.mkdir(storageDirectory, { recursive: true });
  const legacyAbsolute = path.join(storageRoot, 'audio', 'legacy.mp3');
  await fsp.mkdir(path.dirname(legacyAbsolute), { recursive: true });
  await fsp.writeFile(legacyAbsolute, 'legacy');
  db.prepare(
    'UPDATE storyboards SET audio_local_path = ?, narration_audio_local_path = ? WHERE id = ?',
  ).run('mock://dramas/9/storyboards/905/voice.wav', legacyAbsolute, fixture.ids.storyboard);

  const result = await purgeE2EFixture({
    db,
    dramaId: fixture.ids.drama,
    expectedTitle: fixture.title,
    storySourceRoot: sourceRoot,
    storageRoot,
  });

  assert.deepEqual(result.media_cleanup, { candidates: 1, deleted: 1, missing: 0, shared: 0 });
  await assert.rejects(fsp.lstat(legacyAbsolute), { code: 'ENOENT' });
});

test('refuses non-E2E or mismatched fixture identities without touching rows or files', async (t) => {
  const db = createDb();
  const sourceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'localminidrama-e2e-refuse-'));
  const storageRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'localminidrama-e2e-refuse-storage-'));
  t.after(async () => {
    db.close();
    await fsp.rm(sourceRoot, { recursive: true, force: true });
    await fsp.rm(storageRoot, { recursive: true, force: true });
  });

  const regular = seedFixtureGraph(db, { dramaId: 4, e2e: false });
  const e2e = seedFixtureGraph(db, { dramaId: 5, e2e: true });
  await fsp.mkdir(path.join(sourceRoot, '4'), { recursive: true });
  await fsp.mkdir(path.join(sourceRoot, '5'), { recursive: true });
  const regularStorageDirectory = resolveProjectStorageDirectory(
    storageRoot,
    db.prepare('SELECT id, title, metadata, created_at FROM dramas WHERE id = ?').get(regular.ids.drama)
  );
  const e2eStorageDirectory = resolveProjectStorageDirectory(
    storageRoot,
    db.prepare('SELECT id, title, metadata, created_at FROM dramas WHERE id = ?').get(e2e.ids.drama)
  );
  await fsp.mkdir(regularStorageDirectory, { recursive: true });
  await fsp.mkdir(e2eStorageDirectory, { recursive: true });

  await assert.rejects(
    purgeE2EFixture({
      db,
      dramaId: regular.ids.drama,
      expectedTitle: `${E2E_TITLE_PREFIX}4`,
      storySourceRoot: sourceRoot,
      storageRoot,
    }),
    /not the expected E2E fixture/
  );
  await assert.rejects(
    purgeE2EFixture({
      db,
      dramaId: e2e.ids.drama,
      expectedTitle: `${E2E_TITLE_PREFIX}wrong`,
      storySourceRoot: sourceRoot,
      storageRoot,
    }),
    /not the expected E2E fixture/
  );

  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM dramas').get().count, 2);
  assert.equal((await fsp.lstat(path.join(sourceRoot, '4'))).isDirectory(), true);
  assert.equal((await fsp.lstat(path.join(sourceRoot, '5'))).isDirectory(), true);
  assert.equal((await fsp.lstat(regularStorageDirectory)).isDirectory(), true);
  assert.equal((await fsp.lstat(e2eStorageDirectory)).isDirectory(), true);
});

test('rolls back every database delete when a late cleanup statement fails', async (t) => {
  const db = createDb();
  const sourceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'localminidrama-e2e-rollback-'));
  const storageRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'localminidrama-e2e-rollback-storage-'));
  t.after(async () => {
    db.close();
    await fsp.rm(sourceRoot, { recursive: true, force: true });
    await fsp.rm(storageRoot, { recursive: true, force: true });
  });

  const fixture = seedFixtureGraph(db, { dramaId: 6, e2e: true });
  await fsp.mkdir(path.join(sourceRoot, '6'), { recursive: true });
  await fsp.writeFile(path.join(sourceRoot, '6', 'fixture.txt'), 'fixture');
  const fixtureStorageDirectory = resolveProjectStorageDirectory(
    storageRoot,
    db.prepare('SELECT id, title, metadata, created_at FROM dramas WHERE id = ?').get(fixture.ids.drama)
  );
  await fsp.mkdir(fixtureStorageDirectory, { recursive: true });
  await fsp.writeFile(path.join(fixtureStorageDirectory, 'fixture.png'), 'fixture');
  const before = rowCounts(db, [...FIXTURE_TABLES, 'async_tasks']);
  db.exec(`
    CREATE TRIGGER reject_e2e_episode_delete
    BEFORE DELETE ON episodes
    WHEN OLD.drama_id = 6
    BEGIN
      SELECT RAISE(ABORT, 'forced cleanup failure');
    END;
  `);

  await assert.rejects(
    purgeE2EFixture({
      db,
      dramaId: fixture.ids.drama,
      expectedTitle: fixture.title,
      storySourceRoot: sourceRoot,
      storageRoot,
    }),
    /forced cleanup failure/
  );

  assert.deepEqual(rowCounts(db, [...FIXTURE_TABLES, 'async_tasks']), before);
  await assert.rejects(fsp.lstat(path.join(sourceRoot, '6')), { code: 'ENOENT' });
  await assert.rejects(fsp.lstat(fixtureStorageDirectory), { code: 'ENOENT' });
});
