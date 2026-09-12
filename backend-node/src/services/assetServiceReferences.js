/**
 * 素材引用检查：分镜参考图、自由画布节点与受控文件同一性。
 * 路由仍通过 assetService 调用，本模块不改变公开 API。
 */

const {
  normalizeFreeCanvasAssetReferences,
  normalizeFreeCanvasMediaReference,
} = require('./freeCanvasValidation');
const {
  normalizeLocalPath,
  localPathReferenceKey,
  physicalPathKey,
} = require('./assetServicePaths');

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
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

module.exports = {
  storyboardReferencesForAsset,
  freeCanvasReferencesForAsset,
  nodeAssetIdMatches,
  sameControlledFile,
  assetInUseError,
};
