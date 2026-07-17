const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../config');

const ASSET_SELECT = `
  SELECT
    a.*,
    d.title AS source_drama_title
`;

const ASSET_FROM = `
  FROM assets a
  LEFT JOIN dramas d ON d.id = a.drama_id AND d.deleted_at IS NULL
`;

function list(db, query) {
  let sql = 'WHERE a.deleted_at IS NULL';
  const params = [];
  if (query.drama_id) {
    sql += ' AND a.drama_id = ?';
    params.push(query.drama_id);
  }
  if (query.type) {
    sql += ' AND a.type = ?';
    params.push(query.type);
  }
  const keyword = String(query.keyword ?? '').trim();
  if (keyword) {
    sql += ' AND a.name LIKE ?';
    params.push(`%${keyword}%`);
  }
  const countRow = db.prepare('SELECT COUNT(*) as total ' + ASSET_FROM + ' ' + sql).get(...params);
  const total = countRow.total || 0;
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.page_size, 10) || 20));
  const offset = (page - 1) * pageSize;
  const rows = db.prepare(
    ASSET_SELECT + ' ' + ASSET_FROM + ' ' + sql + ' ORDER BY a.created_at DESC LIMIT ? OFFSET ?'
  ).all(...params, pageSize, offset);
  return { items: rows.map(rowToItem), total, page, pageSize };
}

function rowToItem(r) {
  return {
    id: r.id,
    drama_id: r.drama_id,
    name: r.name,
    type: r.type,
    category: r.category,
    url: r.url,
    local_path: r.local_path,
    file_size: r.file_size,
    mime_type: r.mime_type,
    width: r.width,
    height: r.height,
    duration: r.duration,
    image_gen_id: r.image_gen_id,
    video_gen_id: r.video_gen_id,
    source_drama_title: r.source_drama_title || null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function getById(db, id) {
  const r = db.prepare(
    ASSET_SELECT + ' ' + ASSET_FROM + ' WHERE a.id = ? AND a.deleted_at IS NULL'
  ).get(Number(id));
  return r ? rowToItem(r) : null;
}

function create(db, log, req) {
  const now = new Date().toISOString();
  const info = db.prepare(
    `INSERT INTO assets (drama_id, name, type, category, url, local_path, file_size, mime_type, width, height, duration, image_gen_id, video_gen_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    req.drama_id ?? null,
    req.name || '未命名',
    req.type || 'image',
    req.category ?? null,
    req.url || '',
    req.local_path ?? null,
    req.file_size ?? null,
    req.mime_type ?? null,
    req.width ?? null,
    req.height ?? null,
    req.duration ?? null,
    req.image_gen_id ?? null,
    req.video_gen_id ?? null,
    now,
    now
  );
  return getById(db, info.lastInsertRowid);
}

function update(db, log, id, req) {
  const row = db.prepare('SELECT id FROM assets WHERE id = ? AND deleted_at IS NULL').get(Number(id));
  if (!row) return null;
  const updates = [];
  const params = [];
  ['name', 'description', 'type', 'category', 'url', 'local_path', 'thumbnail_url', 'file_size', 'mime_type', 'width', 'height', 'duration', 'is_favorite'].forEach((key) => {
    if (req[key] !== undefined) {
      updates.push(key + ' = ?');
      params.push(req[key]);
    }
  });
  if (updates.length === 0) return getById(db, id);
  params.push(new Date().toISOString(), id);
  db.prepare('UPDATE assets SET ' + updates.join(', ') + ', updated_at = ? WHERE id = ?').run(...params);
  return getById(db, id);
}

function normalizeLocalPath(localPath) {
  const raw = String(localPath || '').trim().replace(/\\/g, '/');
  if (!raw || raw.includes('\0')) return null;
  const normalized = path.posix.normalize(raw).replace(/^\.\//, '');
  if (
    !normalized
    || normalized === '..'
    || normalized.startsWith('../')
    || path.posix.isAbsolute(normalized)
    || /^[a-zA-Z]:\//.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function localPathReferenceKey(localPath) {
  const normalized = normalizeLocalPath(localPath);
  return process.platform === 'win32' && normalized ? normalized.toLowerCase() : normalized;
}

function isWithinRoot(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function configuredStorageRoot(options = {}) {
  if (options.storageRoot) return path.resolve(options.storageRoot);
  const cfg = loadConfig();
  const rawStorage = cfg?.storage?.local_path || './data/storage';
  return path.isAbsolute(rawStorage) ? rawStorage : path.join(process.cwd(), rawStorage);
}

function resolveControlledUploadPath(storageRoot, localPath) {
  const normalized = normalizeLocalPath(localPath);
  if (!normalized) return null;
  const segments = normalized.split('/');
  if (segments.length < 2 || segments[segments.length - 2] !== 'uploads') return null;

  const root = path.resolve(storageRoot);
  const candidate = path.resolve(root, ...segments);
  if (!isWithinRoot(root, candidate)) return null;
  if (fs.existsSync(candidate)) {
    const realRoot = fs.realpathSync.native(root);
    const realCandidate = fs.realpathSync.native(candidate);
    if (!isWithinRoot(realRoot, realCandidate)) return null;
  }
  return { absolutePath: candidate, normalizedPath: normalized };
}

function storyboardReferencesForAsset(db, asset) {
  const assetId = Number(asset?.id);
  const assetPathKey = localPathReferenceKey(asset?.local_path);
  const rows = db.prepare(
    `SELECT id, reference_images
       FROM storyboards
      WHERE deleted_at IS NULL
        AND reference_images IS NOT NULL
        AND TRIM(reference_images) <> ''`
  ).all();
  const storyboardIds = [];
  for (const row of rows) {
    let references;
    try { references = JSON.parse(row.reference_images); } catch (_) { continue; }
    if (!Array.isArray(references)) continue;
    const matched = references.some((reference) => {
      if (typeof reference === 'string') {
        return assetPathKey && localPathReferenceKey(reference) === assetPathKey;
      }
      if (!reference || typeof reference !== 'object' || Array.isArray(reference)) return false;
      if (Number(reference.asset_id) === assetId) return true;
      return assetPathKey
        && localPathReferenceKey(reference.local_path || reference.image_url || reference.url) === assetPathKey;
    });
    if (matched) storyboardIds.push(Number(row.id));
  }
  return storyboardIds;
}

function assetInUseError(storyboardIds) {
  const error = new Error(`素材正在被 ${storyboardIds.length} 个分镜引用，请先从分镜中移除后再删除`);
  error.code = 'ASSET_IN_USE';
  error.statusCode = 409;
  error.details = {
    reference_count: storyboardIds.length,
    storyboard_ids: storyboardIds.slice(0, 20),
  };
  return error;
}

function deleteById(db, log, id, options = {}) {
  const assetId = Number(id);
  let removedPath = null;
  let removablePath = null;
  const performDelete = db.transaction(() => {
    const row = db.prepare(
      'SELECT id, local_path FROM assets WHERE id = ? AND deleted_at IS NULL'
    ).get(assetId);
    if (!row) return false;

    const storyboardIds = storyboardReferencesForAsset(db, row);
    if (storyboardIds.length) throw assetInUseError(storyboardIds);

    const result = db.prepare(
      'UPDATE assets SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL'
    ).run(new Date().toISOString(), assetId);
    if (result.changes === 0) return false;

    const storageRoot = configuredStorageRoot(options);
    const controlled = resolveControlledUploadPath(storageRoot, row.local_path);
    if (!controlled) return true;

    const sharedRows = db.prepare(
      'SELECT local_path FROM assets WHERE id <> ? AND deleted_at IS NULL AND local_path IS NOT NULL'
    ).all(assetId);
    const hasSharedReference = sharedRows.some(
      (candidate) => localPathReferenceKey(candidate.local_path) === localPathReferenceKey(controlled.normalizedPath)
    );
    if (hasSharedReference) return true;

    removablePath = controlled.absolutePath;
    return true;
  });

  const deleted = performDelete();
  if (deleted && removablePath) {
    try {
      fs.unlinkSync(removablePath);
      removedPath = removablePath;
    } catch (err) {
      if (err.code !== 'ENOENT') {
        log?.warn?.('Asset file cleanup failed after database commit', {
          asset_id: assetId,
          path: removablePath,
          error: err.message,
        });
      }
    }
  }
  if (deleted && log?.info) {
    log.info('Asset deleted', { asset_id: assetId, removed_file: removedPath });
  }
  return deleted;
}

function importFromImage(db, log, imageGenId) {
  const img = db.prepare('SELECT * FROM image_generations WHERE id = ? AND deleted_at IS NULL').get(Number(imageGenId));
  if (!img) return null;
  return create(db, log, {
    drama_id: img.drama_id,
    name: `图片 ${imageGenId}`,
    type: 'image',
    url: img.image_url || '',
    local_path: img.local_path,
    image_gen_id: img.id,
  });
}

function importFromVideo(db, log, videoGenId) {
  const vid = db.prepare('SELECT * FROM video_generations WHERE id = ? AND deleted_at IS NULL').get(Number(videoGenId));
  if (!vid) return null;
  return create(db, log, {
    drama_id: vid.drama_id,
    name: `视频 ${videoGenId}`,
    type: 'video',
    url: vid.video_url || '',
    local_path: vid.local_path,
    video_gen_id: vid.id,
  });
}

module.exports = {
  list,
  getById,
  create,
  update,
  deleteById,
  importFromImage,
  importFromVideo,
  storyboardReferencesForAsset,
};
