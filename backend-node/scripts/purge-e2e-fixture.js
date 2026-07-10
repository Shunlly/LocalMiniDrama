#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');
const Database = require('better-sqlite3');
const storageLayout = require('../src/services/storageLayout');

const E2E_TITLE_PREFIX = 'E2E Novel2Anime ';
const E2E_PURGE_CONFIRMATION = 'LOCALMINIDRAMA_E2E_PURGE';

function normalizeDramaId(value) {
  const dramaId = Number(value);
  if (!Number.isSafeInteger(dramaId) || dramaId <= 0) {
    throw new Error('E2E fixture purge requires a positive integer drama id');
  }
  return dramaId;
}

function parseMetadata(value) {
  if (value && typeof value === 'object') return value;
  try {
    return JSON.parse(value || '{}');
  } catch (_) {
    return {};
  }
}

function assertE2EFixture(db, dramaId, expectedTitle) {
  if (typeof expectedTitle !== 'string' || !expectedTitle.startsWith(E2E_TITLE_PREFIX)) {
    throw new Error(`E2E fixture title must start with ${JSON.stringify(E2E_TITLE_PREFIX)}`);
  }

  const row = db.prepare('SELECT id, title, metadata, created_at FROM dramas WHERE id = ?').get(dramaId);
  const metadata = parseMetadata(row?.metadata);
  if (!row || row.title !== expectedTitle || metadata.e2e !== true) {
    throw new Error(`Refusing to purge drama ${dramaId}: it is not the expected E2E fixture`);
  }
  return row;
}

function quoteIdentifier(value) {
  if (!/^[a-z][a-z0-9_]*$/i.test(value)) {
    throw new Error(`Unsafe SQLite identifier: ${value}`);
  }
  return `"${value}"`;
}

function uniqueValues(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined))];
}

function tableColumns(db, table, cache) {
  if (cache.has(table)) return cache.get(table);
  const exists = db.prepare(
    "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?"
  ).get(table);
  const columns = exists
    ? new Set(db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all().map((row) => row.name))
    : null;
  cache.set(table, columns);
  return columns;
}

function buildWhere(db, table, filters, cache) {
  const columns = tableColumns(db, table, cache);
  if (!columns) return null;

  const clauses = [];
  const params = [];
  for (const filter of filters) {
    const values = uniqueValues(filter.values || []);
    if (!columns.has(filter.column) || values.length === 0) continue;
    clauses.push(`${quoteIdentifier(filter.column)} IN (${values.map(() => '?').join(', ')})`);
    params.push(...values);
  }

  if (clauses.length === 0) return null;
  return { sql: clauses.map((clause) => `(${clause})`).join(' OR '), params };
}

function selectValues(db, table, column, filters, cache) {
  const columns = tableColumns(db, table, cache);
  if (!columns?.has(column)) return [];
  const where = buildWhere(db, table, filters, cache);
  if (!where) return [];
  return uniqueValues(db.prepare(
    `SELECT ${quoteIdentifier(column)} AS value FROM ${quoteIdentifier(table)} WHERE ${where.sql}`
  ).all(...where.params).map((row) => row.value));
}

function collectFixtureContext(db, dramaId, cache) {
  const dramaFilter = [{ column: 'drama_id', values: [dramaId] }];
  const episodeIds = selectValues(db, 'episodes', 'id', dramaFilter, cache);
  const sourceIds = selectValues(db, 'story_sources', 'id', dramaFilter, cache);
  const sourceItemIds = selectValues(
    db,
    'source_items',
    'id',
    [{ column: 'source_id', values: sourceIds }],
    cache
  );
  const eventIds = selectValues(db, 'story_events', 'id', [
    ...dramaFilter,
    { column: 'source_item_id', values: sourceItemIds },
  ], cache);
  const characterIds = selectValues(db, 'characters', 'id', dramaFilter, cache);
  const sceneIds = selectValues(db, 'scenes', 'id', dramaFilter, cache);
  const propIds = selectValues(db, 'props', 'id', dramaFilter, cache);
  const runIds = selectValues(db, 'workflow_runs', 'id', [
    ...dramaFilter,
    { column: 'episode_id', values: episodeIds },
  ], cache);
  const workflowStepIds = selectValues(
    db,
    'workflow_steps',
    'id',
    [{ column: 'run_id', values: runIds }],
    cache
  );
  const storyboardIds = selectValues(db, 'storyboards', 'id', [
    { column: 'episode_id', values: episodeIds },
    { column: 'scene_id', values: sceneIds },
  ], cache);
  const trackIds = selectValues(
    db,
    'timeline_tracks',
    'id',
    [{ column: 'episode_id', values: episodeIds }],
    cache
  );
  const imageGenerationIds = selectValues(db, 'image_generations', 'id', [
    ...dramaFilter,
    { column: 'episode_id', values: episodeIds },
    { column: 'storyboard_id', values: storyboardIds },
    { column: 'scene_id', values: sceneIds },
    { column: 'character_id', values: characterIds },
  ], cache);
  const videoGenerationIds = selectValues(db, 'video_generations', 'id', [
    ...dramaFilter,
    { column: 'storyboard_id', values: storyboardIds },
    { column: 'scene_id', values: sceneIds },
  ], cache);
  const videoMergeIds = selectValues(db, 'video_merges', 'id', [
    ...dramaFilter,
    { column: 'episode_id', values: episodeIds },
  ], cache);
  const taskIds = uniqueValues([
    ...selectValues(db, 'image_generations', 'task_id', [
      { column: 'id', values: imageGenerationIds },
    ], cache),
    ...selectValues(db, 'video_generations', 'task_id', [
      { column: 'id', values: videoGenerationIds },
    ], cache),
    ...selectValues(db, 'video_merges', 'task_id', [
      { column: 'id', values: videoMergeIds },
    ], cache),
  ].filter(Boolean));

  return {
    dramaId,
    episodeIds,
    sourceIds,
    sourceItemIds,
    eventIds,
    characterIds,
    sceneIds,
    propIds,
    runIds,
    workflowStepIds,
    storyboardIds,
    trackIds,
    imageGenerationIds,
    videoGenerationIds,
    videoMergeIds,
    taskIds,
  };
}

function cleanupTargets(context) {
  const drama = [{ column: 'drama_id', values: [context.dramaId] }];
  return [
    { table: 'provider_invocations', filters: [
      { column: 'run_id', values: context.runIds },
      { column: 'workflow_step_id', values: context.workflowStepIds },
    ] },
    { table: 'skill_invocations', filters: [
      { column: 'run_id', values: context.runIds },
      { column: 'workflow_step_id', values: context.workflowStepIds },
    ] },
    { table: 'workflow_steps', filters: [{ column: 'run_id', values: context.runIds }] },
    { table: 'creative_reviews', filters: [
      ...drama,
      { column: 'run_id', values: context.runIds },
      { column: 'source_id', values: context.sourceIds },
    ] },
    { table: 'qa_reports', filters: [
      ...drama,
      { column: 'episode_id', values: context.episodeIds },
      { column: 'run_id', values: context.runIds },
    ] },
    { table: 'timeline_items', filters: [
      { column: 'track_id', values: context.trackIds },
      { column: 'storyboard_id', values: context.storyboardIds },
    ] },
    { table: 'timeline_tracks', filters: [{ column: 'episode_id', values: context.episodeIds }] },
    { table: 'frame_prompts', filters: [{ column: 'storyboard_id', values: context.storyboardIds }] },
    { table: 'storyboard_characters', filters: [
      { column: 'storyboard_id', values: context.storyboardIds },
      { column: 'character_id', values: context.characterIds },
    ] },
    { table: 'storyboard_props', filters: [
      { column: 'storyboard_id', values: context.storyboardIds },
      { column: 'prop_id', values: context.propIds },
    ] },
    { table: 'episode_characters', filters: [
      { column: 'episode_id', values: context.episodeIds },
      { column: 'character_id', values: context.characterIds },
    ] },
    { table: 'assets', filters: [
      ...drama,
      { column: 'image_gen_id', values: context.imageGenerationIds },
      { column: 'video_gen_id', values: context.videoGenerationIds },
    ] },
    { table: 'image_generations', filters: [
      ...drama,
      { column: 'id', values: context.imageGenerationIds },
    ] },
    { table: 'video_generations', filters: [
      ...drama,
      { column: 'id', values: context.videoGenerationIds },
    ] },
    { table: 'video_merges', filters: [
      ...drama,
      { column: 'id', values: context.videoMergeIds },
    ] },
    { table: 'story_event_edges', filters: [
      ...drama,
      { column: 'source_id', values: context.sourceIds },
      { column: 'from_event_id', values: context.eventIds },
      { column: 'to_event_id', values: context.eventIds },
    ] },
    { table: 'story_events', filters: [
      ...drama,
      { column: 'id', values: context.eventIds },
      { column: 'source_item_id', values: context.sourceItemIds },
    ] },
    { table: 'source_items', filters: [{ column: 'source_id', values: context.sourceIds }] },
    { table: 'adaptation_plans', filters: [
      ...drama,
      { column: 'source_id', values: context.sourceIds },
    ] },
    { table: 'story_sources', filters: [...drama, { column: 'id', values: context.sourceIds }] },
    { table: 'storyboards', filters: [{ column: 'id', values: context.storyboardIds }] },
    { table: 'character_libraries', filters: drama },
    { table: 'scene_libraries', filters: drama },
    { table: 'prop_libraries', filters: drama },
    { table: 'characters', filters: [...drama, { column: 'id', values: context.characterIds }] },
    { table: 'scenes', filters: [...drama, { column: 'id', values: context.sceneIds }] },
    { table: 'props', filters: [...drama, { column: 'id', values: context.propIds }] },
    { table: 'workflow_runs', filters: [...drama, { column: 'id', values: context.runIds }] },
    { table: 'episodes', filters: [...drama, { column: 'id', values: context.episodeIds }] },
    { table: 'dramas', filters: [{ column: 'id', values: [context.dramaId] }] },
  ];
}

function buildTaskWhere(db, context, cache) {
  const columns = tableColumns(db, 'async_tasks', cache);
  if (!columns) return null;
  const clauses = [];
  const params = [];

  function addValues(column, values) {
    const normalized = uniqueValues(values);
    if (!columns.has(column) || normalized.length === 0) return;
    clauses.push(`${quoteIdentifier(column)} IN (${normalized.map(() => '?').join(', ')})`);
    params.push(...normalized);
  }

  function addTypedResources(types, resources) {
    const normalizedTypes = uniqueValues(types);
    const normalizedResources = uniqueValues(resources).map(String);
    if (!columns.has('type') || !columns.has('resource_id') || normalizedResources.length === 0) return;
    clauses.push(
      `(${quoteIdentifier('type')} IN (${normalizedTypes.map(() => '?').join(', ')}) AND ` +
      `${quoteIdentifier('resource_id')} IN (${normalizedResources.map(() => '?').join(', ')}))`
    );
    params.push(...normalizedTypes, ...normalizedResources);
  }

  addValues('id', context.taskIds);
  addTypedResources(['story_generation', 'character_generation'], [context.dramaId]);
  addTypedResources(
    ['storyboard_generation', 'background_extraction', 'prop_extraction', 'character_extraction', 'video_merge'],
    context.episodeIds
  );
  addTypedResources(['frame_prompt_generation'], context.storyboardIds);
  addTypedResources(['prop_image_generation'], context.propIds);
  addTypedResources(['character_image'], context.characterIds);

  if (clauses.length === 0) return null;
  return { sql: clauses.map((clause) => `(${clause})`).join(' OR '), params };
}

function deleteTarget(db, target, cache) {
  const where = buildWhere(db, target.table, target.filters, cache);
  if (!where) return 0;
  return db.prepare(
    `DELETE FROM ${quoteIdentifier(target.table)} WHERE ${where.sql}`
  ).run(...where.params).changes;
}

function countTarget(db, target, cache) {
  const where = buildWhere(db, target.table, target.filters, cache);
  if (!where) return 0;
  return db.prepare(
    `SELECT COUNT(*) AS count FROM ${quoteIdentifier(target.table)} WHERE ${where.sql}`
  ).get(...where.params).count;
}

function deleteTasks(db, context, cache) {
  const where = buildTaskWhere(db, context, cache);
  if (!where) return 0;
  return db.prepare(`DELETE FROM async_tasks WHERE ${where.sql}`).run(...where.params).changes;
}

function countTasks(db, context, cache) {
  const where = buildTaskWhere(db, context, cache);
  if (!where) return 0;
  return db.prepare(`SELECT COUNT(*) AS count FROM async_tasks WHERE ${where.sql}`).get(...where.params).count;
}

function resolveStorySourceDirectory(storySourceRoot, dramaId) {
  const normalizedId = normalizeDramaId(dramaId);
  const root = path.resolve(storySourceRoot);
  const target = path.resolve(root, String(normalizedId));
  if (path.dirname(target) !== root || path.basename(target) !== String(normalizedId)) {
    throw new Error(`Refusing unsafe story source directory: ${target}`);
  }
  return target;
}

function resolveProjectStorageDirectory(storageRoot, dramaRow) {
  if (!storageRoot) throw new Error('E2E fixture purge requires a storage root');
  if (!dramaRow?.id) throw new Error('E2E fixture purge requires a drama row');

  const root = path.resolve(storageRoot);
  const projectsRoot = path.resolve(root, storageLayout.PROJECTS);
  const relativeDirectory = storageLayout.buildProjectRelativeDir(dramaRow);
  const target = path.resolve(root, ...relativeDirectory.split('/'));
  if (path.dirname(target) !== projectsRoot || !path.basename(target)) {
    throw new Error(`Refusing unsafe project storage directory: ${target}`);
  }
  return target;
}

async function removeStorySourceDirectory(storySourceRoot, dramaId) {
  const target = resolveStorySourceDirectory(storySourceRoot, dramaId);
  let stat;
  try {
    stat = await fs.lstat(target);
  } catch (error) {
    if (error?.code === 'ENOENT') return target;
    throw error;
  }
  if (stat.isSymbolicLink()) {
    throw new Error(`Refusing to remove symlinked story source directory: ${target}`);
  }
  await fs.rm(target, { recursive: true, force: true });
  return target;
}

async function assertStorySourceDirectoryMissing(storySourceRoot, dramaId) {
  const target = resolveStorySourceDirectory(storySourceRoot, dramaId);
  try {
    await fs.lstat(target);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  throw new Error(`E2E fixture story source directory still exists: ${target}`);
}

async function removeProjectStorageDirectory(storageRoot, dramaRow) {
  const target = resolveProjectStorageDirectory(storageRoot, dramaRow);
  let stat;
  try {
    stat = await fs.lstat(target);
  } catch (error) {
    if (error?.code === 'ENOENT') return target;
    throw error;
  }
  if (stat.isSymbolicLink()) {
    throw new Error(`Refusing to remove symlinked project storage directory: ${target}`);
  }

  const projectsRoot = path.dirname(target);
  const [realProjectsRoot, realTarget] = await Promise.all([
    fs.realpath(projectsRoot),
    fs.realpath(target),
  ]);
  if (path.dirname(realTarget) !== realProjectsRoot) {
    throw new Error(`Refusing project storage directory outside controlled root: ${realTarget}`);
  }
  await fs.rm(target, { recursive: true, force: true });
  return target;
}

async function assertProjectStorageDirectoryMissing(storageRoot, dramaRow) {
  const target = resolveProjectStorageDirectory(storageRoot, dramaRow);
  try {
    await fs.lstat(target);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  throw new Error(`E2E fixture project storage directory still exists: ${target}`);
}

async function purgeE2EFixture({ db, dramaId, expectedTitle, storySourceRoot, storageRoot }) {
  const normalizedId = normalizeDramaId(dramaId);
  const dramaRow = assertE2EFixture(db, normalizedId, expectedTitle);
  resolveProjectStorageDirectory(storageRoot, dramaRow);
  await removeStorySourceDirectory(storySourceRoot, normalizedId);
  await removeProjectStorageDirectory(storageRoot, dramaRow);

  const purge = db.transaction(() => {
    assertE2EFixture(db, normalizedId, expectedTitle);
    const cache = new Map();
    const context = collectFixtureContext(db, normalizedId, cache);
    const targets = cleanupTargets(context);
    const deleted = {};

    deleted.async_tasks = deleteTasks(db, context, cache);
    for (const target of targets) {
      deleted[target.table] = (deleted[target.table] || 0) + deleteTarget(db, target, cache);
    }

    const residual = {};
    const taskResidual = countTasks(db, context, cache);
    if (taskResidual) residual.async_tasks = taskResidual;
    for (const target of targets) {
      const count = countTarget(db, target, cache);
      if (count) residual[target.table] = count;
    }
    if (Object.keys(residual).length > 0) {
      throw new Error(`E2E fixture database residue remains: ${JSON.stringify(residual)}`);
    }

    return { deleted, residual };
  });

  const result = purge();
  await assertStorySourceDirectoryMissing(storySourceRoot, normalizedId);
  await assertProjectStorageDirectoryMissing(storageRoot, dramaRow);
  return {
    drama_id: normalizedId,
    title: expectedTitle,
    deleted: result.deleted,
    residual: result.residual,
    verified: true,
  };
}

function parseArgs(argv) {
  const parsed = { confirm: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--confirm-local-e2e') {
      parsed.confirm = true;
    } else if (arg === '--drama-id') {
      parsed.dramaId = argv[++index];
    } else if (arg === '--expected-title') {
      parsed.expectedTitle = argv[++index];
    } else {
      throw new Error(`Unknown E2E fixture purge argument: ${arg}`);
    }
  }
  return parsed;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.confirm || process.env[E2E_PURGE_CONFIRMATION] !== '1') {
    throw new Error('E2E fixture purge requires explicit local Docker confirmation');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('E2E fixture purge is disabled in production');
  }

  const dramaId = normalizeDramaId(args.dramaId);
  const dbPath = path.resolve(process.cwd(), 'data', 'drama_generator.db');
  const storySourceRoot = path.resolve(process.cwd(), 'data', 'story_sources');
  const storageRoot = path.resolve(process.cwd(), 'data', 'storage');
  const db = new Database(dbPath);
  db.pragma('busy_timeout = 5000');
  try {
    const result = await purgeE2EFixture({
      db,
      dramaId,
      expectedTitle: args.expectedTitle,
      storySourceRoot,
      storageRoot,
    });
    console.log(JSON.stringify(result));
  } finally {
    db.close();
  }
}

module.exports = {
  E2E_PURGE_CONFIRMATION,
  E2E_TITLE_PREFIX,
  assertE2EFixture,
  collectFixtureContext,
  main,
  normalizeDramaId,
  purgeE2EFixture,
  resolveProjectStorageDirectory,
  resolveStorySourceDirectory,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
