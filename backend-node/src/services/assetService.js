const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../config');
const uploadService = require('./uploadService');
const storageLayout = require('./storageLayout');
const {
  normalizeFreeCanvasAssetReferences,
  normalizeFreeCanvasMediaReference,
} = require('./freeCanvasValidation');

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

function badRequest(message) {
  const error = new Error(message);
  error.code = 'BAD_REQUEST';
  return error;
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function resolveDramaScope(db, value, options = {}) {
  if (value === undefined || value === null) return null;
  const normalized = options.strictDramaId
    ? value
    : (typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw badRequest('drama_id 必须为正整数');
  }
  const drama = db.prepare(
    'SELECT id, title, created_at, metadata FROM dramas WHERE id = ? AND deleted_at IS NULL'
  ).get(normalized);
  if (!drama) throw badRequest('drama_id 对应的项目不存在');
  return drama;
}

function normalizeLocalReference(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw badRequest(`${field} 必须为安全的本地媒体引用`);
  try {
    const relative = value.startsWith('/static/') ? value.slice('/static/'.length) : value;
    return uploadService.normalizeStorageRelativeReference(relative);
  } catch (_) {
    throw badRequest(`${field} 必须为安全的本地媒体引用`);
  }
}

function isLoopbackHostname(hostname) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
}

function normalizeAssetUrlReference(value, localPath) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw badRequest('url 必须为安全的媒体 URL 或本地媒体引用');
  if (!/^https?:\/\//i.test(value)) {
    return normalizeLocalReference(value, 'url');
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch (_) {
    throw badRequest('url 必须为安全的媒体 URL 或本地媒体引用');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw badRequest('url 必须为安全的媒体 URL 或本地媒体引用');
  }
  if (isLoopbackHostname(parsed.hostname)) {
    const local = parsed.pathname.startsWith('/static/')
      ? normalizeLocalReference(parsed.pathname, 'url')
      : null;
    if (!local || local !== localPath || parsed.search || parsed.hash) {
      throw badRequest('url 不支持外部 localhost 媒体地址');
    }
    return local;
  }
  throw badRequest('远程素材 URL 需要完整的异步 DNS/私网校验，当前同步接口拒绝持久化');
}

function isAllowedProjectPath(drama, localPath) {
  if (!localPath) return true;
  if (localPath === 'library' || localPath.startsWith('library/')) return true;
  if (!drama) return localPath === 'uploads' || localPath.startsWith('uploads/');
  const currentPrefix = storageLayout.buildProjectRelativeDir(drama);
  const legacyPrefix = `dramas/${Number(drama.id)}`;
  return localPath === currentPrefix
    || localPath.startsWith(`${currentPrefix}/`)
    || localPath === legacyPrefix
    || localPath.startsWith(`${legacyPrefix}/`);
}

function assertProjectPathScope(drama, localPath, field) {
  if (!localPath) return localPath;
  if (!isAllowedProjectPath(drama, localPath)) {
    throw badRequest(`${field} 不属于当前项目或公共素材库`);
  }
  return localPath;
}

function normalizeAssetMedia(db, drama, req) {
  void db;
  const localPath = normalizeLocalReference(req.local_path, 'local_path');
  const hasRemoteTransportUrl = localPath
    && typeof req.url === 'string'
    && /^https?:\/\//i.test(req.url.trim());
  const urlPath = hasRemoteTransportUrl
    ? null
    : normalizeAssetUrlReference(req.url, localPath);
  if (localPath && urlPath && localPath !== urlPath) {
    throw badRequest('url 与 local_path 必须引用同一本地素材');
  }
  const canonicalPath = assertProjectPathScope(drama, localPath || urlPath, '媒体路径');
  return {
    localPath: canonicalPath,
    url: canonicalPath ? `/static/${canonicalPath}` : '',
  };
}

function create(db, log, req, options = {}) {
  if (!isPlainObject(req)) throw badRequest('素材请求必须为对象');
  const drama = resolveDramaScope(db, req.drama_id, options);
  const media = normalizeAssetMedia(db, drama, req);
  const now = new Date().toISOString();
  const info = db.prepare(
    `INSERT INTO assets (drama_id, name, type, category, url, local_path, file_size, mime_type, width, height, duration, image_gen_id, video_gen_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    drama?.id ?? null,
    req.name || '未命名',
    req.type || 'image',
    req.category ?? null,
    media.url,
    media.localPath,
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
  if (!isPlainObject(req)) throw badRequest('素材请求必须为对象');
  const row = db.prepare(
    'SELECT id, drama_id, local_path FROM assets WHERE id = ? AND deleted_at IS NULL'
  ).get(Number(id));
  if (!row) return null;
  let isLegacyGlobalUpload = false;
  if (Number(row.drama_id) === 0) {
    try {
      const relative = normalizeLocalReference(row.local_path, 'local_path');
      isLegacyGlobalUpload = relative === 'uploads' || relative.startsWith('uploads/');
    } catch (_) {}
  }
  const drama = row.drama_id == null || isLegacyGlobalUpload
    ? null
    : resolveDramaScope(db, Number(row.drama_id));
  const hasMediaUpdate = req.url !== undefined || req.local_path !== undefined;
  const media = hasMediaUpdate
    ? normalizeAssetMedia(db, drama, {
      ...(req.local_path !== undefined ? { local_path: req.local_path } : {}),
      ...(req.url !== undefined ? { url: req.url } : {}),
    })
    : null;
  const updates = [];
  const params = [];
  ['name', 'description', 'type', 'category', 'thumbnail_url', 'file_size', 'mime_type', 'width', 'height', 'duration', 'is_favorite'].forEach((key) => {
    if (req[key] !== undefined) {
      updates.push(key + ' = ?');
      params.push(req[key]);
    }
  });
  if (media) {
    updates.push('url = ?', 'local_path = ?');
    params.push(media.url, media.localPath);
    if (
      row.drama_id != null
      && Number(row.drama_id) === 0
      && isLegacyGlobalUpload
      && (media.localPath === 'library' || media.localPath?.startsWith('library/'))
    ) {
      updates.push('drama_id = ?');
      params.push(null);
    }
  }
  if (updates.length === 0) return getById(db, id);
  params.push(new Date().toISOString(), id);
  db.prepare('UPDATE assets SET ' + updates.join(', ') + ', updated_at = ? WHERE id = ?').run(...params);
  return getById(db, id);
}

function normalizeLocalPath(localPath) {
  if (typeof localPath !== 'string') return null;
  const raw = localPath.trim();
  if (!raw) return null;
  const relative = raw.startsWith('/static/') ? raw.slice('/static/'.length) : raw;
  try {
    return uploadService.normalizeStorageRelativeReference(relative);
  } catch (_) {
    return null;
  }
}

function localPathReferenceKey(localPath) {
  const normalized = normalizeLocalPath(localPath);
  return process.platform === 'win32' && normalized ? normalized.toLowerCase() : normalized;
}

function physicalPathKey(filePath) {
  if (typeof filePath !== 'string' || !filePath) return null;
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
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

function controlledUploadReference(localPath) {
  const normalized = normalizeLocalPath(localPath);
  if (!normalized) return null;
  const segments = normalized.split('/');
  if (segments.length < 2 || segments[segments.length - 2] !== 'uploads') return null;
  return normalized;
}

function resolveControlledUploadPath(storageRoot, localPath) {
  const normalized = controlledUploadReference(localPath);
  if (!normalized) return null;
  const segments = normalized.split('/');

  const root = path.resolve(storageRoot);
  const candidate = path.resolve(root, ...segments);
  if (!isWithinRoot(root, candidate)) return null;
  try {
    const realRoot = fs.realpathSync.native(root);
    const realCandidate = fs.realpathSync.native(candidate);
    if (!isWithinRoot(realRoot, realCandidate)) return null;
    const candidateStat = fs.statSync(candidate);
    const realCandidateStat = fs.statSync(realCandidate);
    if (
      !candidateStat.isFile()
      || candidateStat.dev !== realCandidateStat.dev
      || candidateStat.ino !== realCandidateStat.ino
    ) {
      return null;
    }
    return {
      absolutePath: candidate,
      normalizedPath: normalized,
      realPath: realCandidate,
      identity: `${candidateStat.dev}:${candidateStat.ino}`,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
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

function nodeAssetIdMatches(node, dramaId, assetId) {
  for (const field of ['assetId', 'asset_ref']) {
    if (node[field] === undefined) continue;
    try {
      const reference = normalizeFreeCanvasAssetReferences({ [field]: node[field] }, dramaId);
      if (reference.resolvedId === assetId) return true;
    } catch (error) {
      if (error?.code !== 'BAD_REQUEST') throw error;
    }
  }
  return false;
}

function freeCanvasReferencesForAsset(db, asset) {
  const assetId = Number(asset?.id);
  const assetPath = normalizeLocalPath(asset?.local_path);
  const assetPathKey = localPathReferenceKey(assetPath);
  const isLegacyGlobalUpload = Number(asset?.drama_id) === 0
    && (assetPath === 'uploads' || assetPath?.startsWith('uploads/'));
  const isGlobalAsset = asset?.drama_id == null || isLegacyGlobalUpload;
  const ownerDramaId = Number(asset?.drama_id);
  const rows = db.prepare(
    `SELECT id, metadata
       FROM dramas
      WHERE deleted_at IS NULL
        AND metadata IS NOT NULL
      ORDER BY id`
  ).all();
  const dramaIds = [];

  for (const row of rows) {
    const dramaId = Number(row.id);
    if (!isGlobalAsset && dramaId !== ownerDramaId) continue;

    let metadata;
    try {
      metadata = JSON.parse(row.metadata);
    } catch (_) {
      continue;
    }
    if (!isPlainObject(metadata)) continue;
    if (!Object.prototype.hasOwnProperty.call(metadata, 'free_canvas')) continue;
    const canvas = metadata.free_canvas;
    if (!isPlainObject(canvas) || !Array.isArray(canvas.nodes)) continue;

    let matched = false;
    for (const node of canvas.nodes) {
      if (!isPlainObject(node)) continue;
      if (nodeAssetIdMatches(node, dramaId, assetId)) {
        matched = true;
        break;
      }

      if (!assetPathKey) continue;
      const mediaFields = ['storageKey'];
      if (['image', 'video'].includes(node.type)) mediaFields.unshift('content');
      for (const field of mediaFields) {
        if (node[field] === undefined) continue;
        let candidate;
        try {
          candidate = normalizeFreeCanvasMediaReference(db, dramaId, node[field], {
            allowLegacyGlobalUploads: isGlobalAsset,
          });
        } catch (error) {
          if (error?.code !== 'BAD_REQUEST') throw error;
          continue;
        }
        if (localPathReferenceKey(candidate) === assetPathKey) {
          matched = true;
          break;
        }
      }
      if (matched) break;
    }
    if (matched) dramaIds.push(dramaId);
  }
  return dramaIds;
}

function sameControlledFile(left, right) {
  if (!left || !right) return false;
  return localPathReferenceKey(left.normalizedPath) === localPathReferenceKey(right.normalizedPath)
    && physicalPathKey(left.realPath) === physicalPathKey(right.realPath)
    && left.identity === right.identity;
}

function assetInUseError(storyboardIds, freeCanvasDramaIds = []) {
  const referenceCount = storyboardIds.length + freeCanvasDramaIds.length;
  const error = freeCanvasDramaIds.length
    ? new Error(`素材正在被 ${referenceCount} 处引用，请先移除引用后再删除`)
    : new Error(`素材正在被 ${storyboardIds.length} 个分镜引用，请先从分镜中移除后再删除`);
  error.code = 'ASSET_IN_USE';
  error.statusCode = 409;
  error.details = {
    reference_count: referenceCount,
    storyboard_ids: storyboardIds.slice(0, 20),
  };
  if (freeCanvasDramaIds.length) {
    error.details.free_canvas_drama_ids = freeCanvasDramaIds.slice(0, 20);
  }
  return error;
}

function deleteById(db, log, id, options = {}) {
  const assetId = Number(id);
  let removedPath = null;
  let removableReference = null;
  const storageRoot = configuredStorageRoot(options);
  const performDelete = db.transaction(() => {
    const row = db.prepare(
      'SELECT id, drama_id, local_path FROM assets WHERE id = ? AND deleted_at IS NULL'
    ).get(assetId);
    if (!row) return false;

    const storyboardIds = storyboardReferencesForAsset(db, row);
    const freeCanvasDramaIds = freeCanvasReferencesForAsset(db, row);
    if (storyboardIds.length || freeCanvasDramaIds.length) {
      throw assetInUseError(storyboardIds, freeCanvasDramaIds);
    }

    const result = db.prepare(
      'UPDATE assets SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL'
    ).run(new Date().toISOString(), assetId);
    if (result.changes === 0) return false;

    const cleanupReference = controlledUploadReference(row.local_path);
    if (!cleanupReference) return true;

    const sharedRows = db.prepare(
      'SELECT local_path FROM assets WHERE id <> ? AND deleted_at IS NULL AND local_path IS NOT NULL'
    ).all(assetId);
    const hasSharedReference = sharedRows.some(
      (candidate) => localPathReferenceKey(candidate.local_path) === localPathReferenceKey(cleanupReference)
    );
    if (hasSharedReference) return true;

    removableReference = cleanupReference;
    return true;
  });

  const deleted = performDelete();
  if (deleted && removableReference) {
    try {
      const eligible = resolveControlledUploadPath(storageRoot, removableReference);
      const revalidated = eligible
        ? resolveControlledUploadPath(storageRoot, removableReference)
        : null;
      if (sameControlledFile(eligible, revalidated)) {
        fs.unlinkSync(revalidated.absolutePath);
        removedPath = revalidated.absolutePath;
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        log?.warn?.('Asset file cleanup failed after database commit', {
          asset_id: assetId,
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
    drama_id: img.drama_id === 0 ? null : img.drama_id,
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
    drama_id: vid.drama_id === 0 ? null : vid.drama_id,
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
