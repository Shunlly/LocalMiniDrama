const RESOURCE_TABLES = new Set([
  'assets',
  'episodes',
  'storyboards',
  'image_generations',
  'video_generations',
  'video_merges',
  'props',
  'scenes',
  'characters',
]);

const MEDIA_COLUMNS = [
  ['assets', ['local_path', 'url']],
  ['episodes', ['video_url']],
  ['storyboards', [
    'local_path',
    'video_local_path',
    'audio_local_path',
    'narration_audio_local_path',
    'image_url',
    'video_url',
    'first_frame_local_path',
    'last_frame_local_path',
  ]],
  ['image_generations', ['local_path', 'image_url']],
  ['video_generations', ['local_path', 'video_url', 'image_url', 'first_frame_url', 'last_frame_url']],
  ['video_merges', ['merged_url']],
  ['props', ['local_path', 'image_url']],
  ['scenes', ['local_path', 'image_url']],
  ['characters', ['local_path', 'image_url']],
];

function createBoundaryError(code, message, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function invalidIdError(name) {
  return createBoundaryError('BAD_REQUEST', `${name} 必须引用有效 ID`, 400);
}

function getTableColumns(db, tableName) {
  try {
    return new Set(
      db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => String(column.name))
    );
  } catch (_) {
    return new Set();
  }
}

function hasTable(db, tableName) {
  try {
    return Boolean(db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
    ).get(tableName));
  } catch (_) {
    return false;
  }
}

function readDrama(db, dramaId) {
  const columns = getTableColumns(db, 'dramas');
  if (!columns.has('id')) return null;
  const select = [
    'id',
    columns.has('status') ? 'status' : 'NULL AS status',
    columns.has('deleted_at') ? 'deleted_at' : 'NULL AS deleted_at',
    columns.has('trash_state') ? 'trash_state' : 'NULL AS trash_state',
    columns.has('recycle_phase') ? 'recycle_phase' : 'NULL AS recycle_phase',
  ];
  return db.prepare(`SELECT ${select.join(', ')} FROM dramas WHERE id = ?`).get(dramaId);
}

function isNonEmptyState(value) {
  return value != null && String(value).trim() !== '';
}

function assertDramaReadable(db, dramaId) {
  const id = Number(dramaId);
  if (!Number.isInteger(id) || id <= 0) throw invalidIdError('drama_id');
  let drama;
  try {
    drama = readDrama(db, id);
  } catch (error) {
    throw createBoundaryError('DRAMA_NOT_FOUND', '项目不存在或已移入回收站', 404);
  }
  if (!drama || isNonEmptyState(drama.deleted_at)) {
    throw createBoundaryError('DRAMA_NOT_FOUND', '项目不存在或已移入回收站', 404);
  }
  const status = String(drama.status || '').trim().toLowerCase();
  const trashState = String(drama.trash_state || '').trim().toLowerCase();
  if (['trash', 'deleted'].includes(status) || ['trash', 'deleted'].includes(trashState)) {
    throw createBoundaryError('DRAMA_NOT_FOUND', '项目不存在或已移入回收站', 404);
  }
  if (['recycling', 'manual_intervention'].includes(status)
    || isNonEmptyState(drama.trash_state)
    || isNonEmptyState(drama.recycle_phase)) {
    throw createBoundaryError('DRAMA_RECYCLE_IN_PROGRESS', '项目正在回收站流程中，暂不可访问', 409);
  }
  return drama;
}

function assertDramaWritable(db, dramaId) {
  return assertDramaReadable(db, dramaId);
}

function assertResourceTable(tableName) {
  if (!RESOURCE_TABLES.has(tableName)) throw new Error('不允许校验未知资源表');
}

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function addDramaId(ids, value) {
  const id = positiveId(value);
  if (id) ids.add(id);
}

function addRelation(ids, relation, value) {
  if (value == null || Number(value) === 0) return;
  const id = positiveId(value);
  if (!id || !relation) relation.unresolved = true;
  else addDramaId(ids, id);
}

function readResource(db, tableName, resourceId) {
  assertResourceTable(tableName);
  const id = positiveId(resourceId);
  if (!id) throw invalidIdError('resource_id');
  if (!hasTable(db, tableName)) return null;
  const columns = getTableColumns(db, tableName);
  const row = db.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(id);
  if (!row) return null;

  const dramaIds = new Set();
  const relation = { unresolved: false };
  if (columns.has('drama_id')) addDramaId(dramaIds, row.drama_id);

  const addEpisodeScope = (episodeId) => {
    if (episodeId == null || Number(episodeId) === 0) return;
    if (!hasTable(db, 'episodes')) {
      relation.unresolved = true;
      return;
    }
    const episode = db.prepare(
      'SELECT drama_id, deleted_at FROM episodes WHERE id = ?'
    ).get(Number(episodeId));
    if (!episode || isNonEmptyState(episode.deleted_at)) relation.unresolved = true;
    else addDramaId(dramaIds, episode.drama_id);
  };

  if (tableName === 'episodes') {
    if (row.drama_id == null || Number(row.drama_id) === 0) relation.unresolved = true;
  } else if (tableName === 'storyboards') {
    addEpisodeScope(row.episode_id);
  } else if (['image_generations', 'video_generations'].includes(tableName)) {
    addEpisodeScope(row.episode_id);
    const storyboardId = row.storyboard_id;
    if (storyboardId != null && Number(storyboardId) !== 0) {
      if (!hasTable(db, 'storyboards')) relation.unresolved = true;
      else {
        const storyboard = db.prepare(
          `SELECT episode_id, deleted_at FROM storyboards WHERE id = ?`
        ).get(Number(storyboardId));
        if (!storyboard || isNonEmptyState(storyboard.deleted_at)) relation.unresolved = true;
        else addEpisodeScope(storyboard.episode_id);
      }
    }
    for (const [table, field] of [['scenes', 'scene_id'], ['characters', 'character_id']]) {
      if (row[field] == null || Number(row[field]) === 0) continue;
      if (!hasTable(db, table)) relation.unresolved = true;
      else {
        const linked = db.prepare(`SELECT drama_id, deleted_at FROM ${table} WHERE id = ?`)
          .get(Number(row[field]));
        if (!linked || isNonEmptyState(linked.deleted_at)) relation.unresolved = true;
        else addDramaId(dramaIds, linked.drama_id);
      }
    }
  } else if (tableName === 'video_merges') {
    addEpisodeScope(row.episode_id);
  }

  return { row, dramaIds, unresolved: relation.unresolved };
}

function assertResourceReadable(db, tableName, resourceId) {
  const resource = readResource(db, tableName, resourceId);
  if (!resource || isNonEmptyState(resource.row.deleted_at) || resource.unresolved || resource.dramaIds.size > 1) {
    throw createBoundaryError('RESOURCE_NOT_FOUND', '资源不存在或已移入回收站', 404);
  }
  for (const dramaId of resource.dramaIds) assertDramaReadable(db, dramaId);
  return resource.row;
}

function assertResourceWritable(db, tableName, resourceId) {
  const row = assertResourceReadable(db, tableName, resourceId);
  if (row.drama_id == null || Number(row.drama_id) === 0) return row;
  return row;
}

function assertResourcesWritable(db, tableName, resourceIds) {
  const ids = [...new Set((resourceIds || []).map((value) => Number(value)))];
  if (!ids.length) throw invalidIdError('resource_id');
  return ids.map((id) => assertResourceWritable(db, tableName, id));
}

function assertEpisodeReadable(db, episodeId) {
  return assertResourceReadable(db, 'episodes', episodeId);
}

function assertEpisodeWritable(db, episodeId, expectedDramaId) {
  const row = assertEpisodeReadable(db, episodeId);
  if (expectedDramaId != null && Number(row.drama_id) !== Number(expectedDramaId)) {
    throw createBoundaryError('CROSS_PROJECT_REFERENCE', '剧集与项目不匹配', 400);
  }
  return row;
}

function runDramaWrite(db, dramaId, mutation) {
  const transaction = db.transaction(() => {
    const drama = assertDramaWritable(db, dramaId);
    return mutation(drama);
  });
  return typeof transaction.immediate === 'function' ? transaction.immediate() : transaction();
}

function runResourceWrite(db, tableName, resourceId, mutation) {
  const transaction = db.transaction(() => {
    const resource = assertResourceWritable(db, tableName, resourceId);
    return mutation(resource);
  });
  return typeof transaction.immediate === 'function' ? transaction.immediate() : transaction();
}

function canReadDrama(db, dramaId) {
  try {
    assertDramaReadable(db, dramaId);
    return true;
  } catch (error) {
    if (error?.statusCode >= 400 && error?.statusCode < 500) return false;
    throw error;
  }
}

function canReadResource(db, tableName, resourceId) {
  try {
    assertResourceReadable(db, tableName, resourceId);
    return true;
  } catch (error) {
    if (error?.statusCode >= 400 && error?.statusCode < 500) return false;
    throw error;
  }
}

function normalizeMediaPath(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let text = value.trim().replace(/\\/g, '/');
  try {
    if (/^https?:\/\//i.test(text)) text = new URL(text).pathname;
  } catch (_) {
    return null;
  }
  const marker = text.indexOf('/static/');
  if (marker >= 0) text = text.slice(marker + '/static/'.length);
  else text = text.replace(/^\/+/, '');
  text = text.split('?')[0].split('#')[0];
  return text || null;
}

function isProtectedMediaPath(relativePath) {
  const first = String(relativePath || '').split('/')[0].toLowerCase();
  return first !== 'library';
}

function assertMediaPathReadable(db, relativePath) {
  const target = normalizeMediaPath(relativePath);
  if (!target) throw createBoundaryError('UNSAFE_STORAGE_PATH', '静态资源路径不被允许', 403);
  const matches = [];
  for (const [tableName, fields] of MEDIA_COLUMNS) {
    if (!hasTable(db, tableName)) continue;
    const columns = getTableColumns(db, tableName);
    const usable = fields.filter((field) => columns.has(field));
    if (!usable.length) continue;
    const rows = db.prepare(
      `SELECT id, ${usable.join(', ')} FROM ${tableName}`
      + (columns.has('deleted_at') ? ' WHERE deleted_at IS NULL' : '')
    ).all();
    for (const row of rows) {
      if (usable.some((field) => normalizeMediaPath(row[field]) === target)) {
        matches.push({ tableName, id: row.id });
      }
    }
  }
  if (matches.length) {
    if (matches.every((match) => canReadResource(db, match.tableName, match.id))) return true;
    throw createBoundaryError('RESOURCE_NOT_FOUND', '资源所属项目不可访问', 404);
  }
  if (isProtectedMediaPath(target)) {
    throw createBoundaryError('RESOURCE_NOT_FOUND', '资源未登记或所属项目不可访问', 404);
  }
  return true;
}

function isBoundaryError(error) {
  return [
    'BAD_REQUEST',
    'DRAMA_NOT_FOUND',
    'DRAMA_RECYCLE_IN_PROGRESS',
    'RESOURCE_NOT_FOUND',
    'CROSS_PROJECT_REFERENCE',
    'UNSAFE_STORAGE_PATH',
  ].includes(error?.code);
}

module.exports = {
  RESOURCE_TABLES,
  assertDramaReadable,
  assertDramaWritable,
  assertResourceReadable,
  assertResourceWritable,
  assertResourcesWritable,
  assertEpisodeReadable,
  assertEpisodeWritable,
  runDramaWrite,
  runResourceWrite,
  canReadDrama,
  canReadResource,
  assertMediaPathReadable,
  normalizeMediaPath,
  isBoundaryError,
};
