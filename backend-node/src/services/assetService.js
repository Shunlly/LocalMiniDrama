// 只读查询、行装配与项目作用域校验见 assetServiceQuery.js / assetServiceAssembly.js
// 路径规范化见 assetServicePaths.js，引用检查见 assetServiceReferences.js

const fs = require('fs');
const networkMediaService = require('./networkMediaService');
const networkCleanupTimers = new WeakMap();
const dramaWriteGuard = require('./dramaWriteGuard');
const {
  parseNetworkSourceMetadata,
  encodeNetworkSourceMetadata,
  isUnchangedNetworkSource,
} = require('./assetServiceAssembly');
const {
  list,
  getById,
  findNetworkAssetBySource,
  resolveDramaScope,
  assetBadRequest: badRequest,
} = require('./assetServiceQuery');
const {
  normalizeLocalReference,
  localPathReferenceKey,
  configuredStorageRoot,
  controlledUploadReference,
  resolveControlledUploadPath,
  assertProjectPathScope,
} = require('./assetServicePaths');
const {
  storyboardReferencesForAsset,
  freeCanvasReferencesForAsset,
  sameControlledFile,
  assetInUseError,
} = require('./assetServiceReferences');

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isLoopbackHostname(hostname) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
}

function normalizeAssetUrlReference(value, localPath) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw badRequest('媒体地址必须为安全的网址或本地媒体引用');
  if (!/^https?:\/\//i.test(value)) {
    return normalizeLocalReference(value, 'url');
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch (_) {
    throw badRequest('媒体地址必须为安全的网址或本地媒体引用');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw badRequest('媒体地址必须为安全的网址或本地媒体引用');
  }
  if (isLoopbackHostname(parsed.hostname)) {
    const local = parsed.pathname.startsWith('/static/')
      ? normalizeLocalReference(parsed.pathname, 'url')
      : null;
    if (!local || local !== localPath || parsed.search || parsed.hash) {
      throw badRequest('媒体地址不支持外部本机地址');
    }
    return local;
  }
  throw badRequest('远程素材地址需要完整的域名解析和私网校验，当前同步接口拒绝持久化');
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
    throw badRequest('媒体地址与本地路径必须引用同一本地素材');
  }
  const canonicalPath = assertProjectPathScope(drama, localPath || urlPath, '媒体路径');
  return {
    localPath: canonicalPath,
    url: canonicalPath ? `/static/${canonicalPath}` : '',
  };
}

function create(db, log, req, options = {}) {
  if (!isPlainObject(req)) throw badRequest('素材请求必须为对象');
  if (parseNetworkSourceMetadata(req.category) && options.allowNetworkMetadata !== true) {
    throw badRequest('分类包含保留的网络素材来源元数据');
  }
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
  return dramaWriteGuard.runResourceWrite(db, 'assets', id, (row) => {
    if (parseNetworkSourceMetadata(row.category)) {
      const allowedNetworkUpdates = new Set(['name', 'description', 'is_favorite']);
      const protectedFields = Object.keys(req).filter((key) => !allowedNetworkUpdates.has(key));
      if (protectedFields.length > 0) {
        throw badRequest('网络素材的来源、内容和媒体属性不能通过通用更新接口修改');
      }
    }
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
    params.push(new Date().toISOString(), row.id);
    db.prepare('UPDATE assets SET ' + updates.join(', ') + ', updated_at = ? WHERE id = ? AND deleted_at IS NULL')
      .run(...params);
    return getById(db, row.id);
  });
}

function deleteById(db, log, id, options = {}) {
  const assetId = Number(id);
  let removedPath = null;
  let removableReference = null;
  const storageRoot = configuredStorageRoot(options);
  const performDelete = db.transaction(() => {
    const row = dramaWriteGuard.assertResourceWritable(db, 'assets', assetId);
    if (!row || row.deleted_at) return false;
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

async function searchNetwork(query, options = {}) {
  return networkMediaService.search(query, options.network || options);
}

async function importFromNetwork(db, log, req, options = {}) {
  if (!isPlainObject(req)) throw badRequest('素材请求必须为对象');
  const drama = resolveDramaScope(db, req.drama_id, { strictDramaId: true });
  const prepared = await networkMediaService.prepareImport(req, options.network || options);
  try {
    let reused = false;
    const persist = db.transaction(() => {
      if (drama) resolveDramaScope(db, drama.id, { strictDramaId: true });
      const existing = findNetworkAssetBySource(db, drama?.id ?? null, prepared.item);
      if (existing) {
        const previous = existing.source_metadata || {};
        const unchanged = isUnchangedNetworkSource(previous, prepared.item);
        if (!unchanged) {
          const error = new Error('该网络来源已有本地素材，但远端修订或内容已经变化，请删除旧素材后重新导入');
          error.code = 'NETWORK_MEDIA_SOURCE_CHANGED';
          error.statusCode = 409;
          throw error;
        }
        reused = true;
        return existing;
      }
      prepared.finalize();
      return create(db, log, {
        drama_id: drama?.id ?? null,
        name: prepared.item.title,
        type: prepared.item.media_type,
        category: encodeNetworkSourceMetadata(prepared.item),
        local_path: prepared.localPath,
        file_size: prepared.item.file_size,
        mime_type: prepared.item.mime_type,
        width: prepared.item.width,
        height: prepared.item.height,
      }, { allowNetworkMetadata: true, strictDramaId: true });
    });
    const asset = persist();
    if (reused) prepared.cleanup();
    log?.info?.('Network asset imported', {
      asset_id: asset.id,
      source_provider: prepared.item.source_provider || (prepared.item.kind === 'openverse' ? 'Openverse' : 'Wikimedia Commons'),
      local_path: asset.local_path,
      reused,
    });
    return asset;
  } catch (error) {
    try {
      prepared.cleanup();
    } catch (cleanupError) {
      log?.warn?.('Network asset cleanup failed', { error: cleanupError.message });
    }
    throw error;
  }
}


async function proxyNetworkThumbnail(query, options = {}) {
  return networkMediaService.proxyThumbnail(query, options.network || options);
}

function cleanupNetworkImportOrphans(db, log, options = {}) {
  let rows;
  try {
    rows = db.prepare(
      `SELECT local_path FROM assets
        WHERE local_path GLOB 'library/uploads/network_*'
          AND deleted_at IS NULL`
    ).all();
  } catch (error) {
    if (/no such table/i.test(error?.message || '')) return { removed: [], skipped: [] };
    throw error;
  }
  const result = networkMediaService.cleanupOrphans(
    rows.map((row) => row.local_path),
    options.network || options
  );
  if (result.removed.length) {
    log?.warn?.('Cleaned stale network media import files', {
      count: result.removed.length,
      files: result.removed,
    });
  }
  if (options.schedule !== false && !networkCleanupTimers.has(db)) {
    startNetworkImportOrphanCleanup(db, log, options);
  }
  return result;
}

function startNetworkImportOrphanCleanup(db, log, options = {}) {
  const existing = networkCleanupTimers.get(db);
  if (existing) return existing.controller;
  const intervalMs = Math.max(1000, Number(options.intervalMs) || networkMediaService.ORPHAN_CLEANUP_INTERVAL_MS);
  const timer = setInterval(() => {
    try {
      cleanupNetworkImportOrphans(db, log, { ...options, schedule: false });
    } catch (error) {
      log?.warn?.('Periodic network media cleanup failed', { error: error.message });
    }
  }, intervalMs);
  timer.unref?.();
  const controller = {
    isReferenced() {
      return timer.hasRef?.() ?? false;
    },
    close() {
      clearInterval(timer);
      networkCleanupTimers.delete(db);
    },
  };
  networkCleanupTimers.set(db, { timer, controller });
  return controller;
}

module.exports = {
  list,
  getById,
  create,
  update,
  deleteById,
  importFromImage,
  importFromVideo,
  searchNetwork,
  importFromNetwork,
  proxyNetworkThumbnail,
  cleanupNetworkImportOrphans,
  startNetworkImportOrphanCleanup,
  storyboardReferencesForAsset,
};
