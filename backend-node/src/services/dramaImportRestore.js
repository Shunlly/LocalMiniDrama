// 项目导入还原映射：自由画布 ID/路径映射与旧版 ZIP 引用检查
const { badRequest: freeCanvasBadRequest } = require('./freeCanvasValidation');
const {
  declaredFreeCanvasDramaId,
  freeCanvasImportFieldLabel,
  freeCanvasSourceDramaId,
  normalizeFreeCanvasManifestSourcePath,
  parseFreeCanvasReferenceId,
} = require('./dramaImportManifest');

function mapImportedFreeCanvasId(value, map, sourceDramaId, field, kind) {
  if (value === undefined) return undefined;
  if (sourceDramaId == null) {
    throw freeCanvasBadRequest(`自由画布导入${freeCanvasImportFieldLabel(field)}缺少可验证的源项目引用`);
  }
  const sourceId = parseFreeCanvasReferenceId(value, sourceDramaId, field, kind);
  const mapped = map.get(sourceId);
  if (mapped == null) throw freeCanvasBadRequest(`自由画布导入${freeCanvasImportFieldLabel(field)}无法映射到导入项目`);
  return mapped;
}

function mapImportedFreeCanvasPath(value, pathMap) {
  if (typeof value !== 'string') return value;
  try {
    const normalized = normalizeFreeCanvasManifestSourcePath(value, 'node media');
    return pathMap.get(normalized) || value;
  } catch (_) {
    return value;
  }
}

function createImportedFreeCanvasMaps(sourceDramaId = null) {
  return {
    sourceDramaId,
    episodes: new Map(),
    storyboards: new Map(),
    scenes: new Map(),
    assets: new Map(),
    videos: new Map(),
    paths: new Map(),
    importedAssets: new Map(),
    sourceAssetPaths: new Map(),
  };
}

function remapImportedFreeCanvas(canvas, maps, dramaId) {
  const declaredDramaId = declaredFreeCanvasDramaId(canvas);
  if (maps.sourceDramaId != null && declaredDramaId != null && maps.sourceDramaId !== declaredDramaId) {
    throw freeCanvasBadRequest('自由画布导入源项目与画布项目引用不一致');
  }
  const sourceDramaId = maps.sourceDramaId ?? freeCanvasSourceDramaId(canvas, dramaId);
  const remapped = { ...canvas, projectId: dramaId, dramaId };
  if (canvas.episodeId !== undefined) {
    remapped.episodeId = mapImportedFreeCanvasId(
      canvas.episodeId,
      maps.episodes,
      sourceDramaId,
      'episodeId',
      'episode'
    );
  }
  remapped.nodes = canvas.nodes?.map((node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return node;
    const next = { ...node };
    const sourceAssetValue = node.assetId !== undefined ? node.assetId : node.asset_ref;
    const sourceAssetId = sourceAssetValue === undefined || sourceDramaId == null
      ? null
      : parseFreeCanvasReferenceId(
        sourceAssetValue,
        sourceDramaId,
        node.assetId !== undefined ? 'assetId' : 'asset_ref',
        'asset'
      );
    if (node.assetId !== undefined) {
      next.assetId = mapImportedFreeCanvasId(node.assetId, maps.assets, sourceDramaId, 'assetId', 'asset');
    }
    if (node.asset_ref !== undefined) {
      next.asset_ref = mapImportedFreeCanvasId(node.asset_ref, maps.assets, sourceDramaId, 'asset_ref', 'asset');
    }
    if (node.storyboardId !== undefined) {
      next.storyboardId = mapImportedFreeCanvasId(
        node.storyboardId,
        maps.storyboards,
        sourceDramaId,
        'storyboardId',
        'storyboard'
      );
    }
    if (node.storyboard_ref !== undefined) {
      next.storyboard_ref = mapImportedFreeCanvasId(
        node.storyboard_ref,
        maps.storyboards,
        sourceDramaId,
        'storyboard_ref',
        'storyboard'
      );
    }
    if (node.episodeId !== undefined) {
      next.episodeId = mapImportedFreeCanvasId(node.episodeId, maps.episodes, sourceDramaId, 'episodeId', 'episode');
    }
    if (node.sceneId !== undefined) {
      next.sceneId = mapImportedFreeCanvasId(node.sceneId, maps.scenes, sourceDramaId, 'sceneId', 'scene');
    }
    next.content = mapImportedFreeCanvasPath(next.content, maps.paths);
    next.storageKey = mapImportedFreeCanvasPath(next.storageKey, maps.paths);
    const assetId = next.assetId ?? next.asset_ref;
    const asset = assetId == null ? null : maps.importedAssets.get(Number(assetId));
    if ((next.type === 'image' || next.type === 'video') && asset?.local_path) {
      const sourceAssetPath = maps.sourceAssetPaths.get(sourceAssetId);
      for (const field of ['content', 'storageKey']) {
        if (node[field] === undefined) continue;
        const sourceValue = normalizeFreeCanvasManifestSourcePath(node[field], `node ${field}`);
        if (sourceValue !== sourceAssetPath) {
          throw freeCanvasBadRequest(`自由画布导入${freeCanvasImportFieldLabel(`node ${field}`)}必须与素材本地路径一致`);
        }
      }
      next.content = asset.local_path;
      next.storageKey = asset.local_path;
    }
    return next;
  });
  return remapped;
}

function buildLegacyImportedFreeCanvasMaps(sourceDramaId, imported) {
  const maps = createImportedFreeCanvasMaps(sourceDramaId);
  const canvas = imported.metadata?.free_canvas;
  if (canvas === undefined) return maps;

  const hasProjectId = canvas?.projectId !== undefined;
  const hasDramaId = canvas?.dramaId !== undefined;
  if (hasProjectId !== hasDramaId) {
    throw freeCanvasBadRequest('旧版 ZIP 自由画布缺少一致的项目身份声明');
  }
  const hasRootReference = canvas?.episodeId !== undefined;
  const hasNodeReference = Array.isArray(canvas?.nodes) && canvas.nodes.some((node) => (
    node && typeof node === 'object' && !Array.isArray(node) && (
      node.assetId !== undefined
      || node.asset_ref !== undefined
      || node.storyboardId !== undefined
      || node.storyboard_ref !== undefined
      || node.episodeId !== undefined
      || node.sceneId !== undefined
      || node.storageKey !== undefined
      || (['image', 'video'].includes(node.type) && node.content !== undefined)
    )
  ));
  if (hasRootReference || hasNodeReference) {
    throw freeCanvasBadRequest('旧版 ZIP 自由画布包含无法验证的引用，缺少导入清单');
  }
  return maps;
}

module.exports = {
  buildLegacyImportedFreeCanvasMaps,
  createImportedFreeCanvasMaps,
  mapImportedFreeCanvasId,
  mapImportedFreeCanvasPath,
  remapImportedFreeCanvas,
};
