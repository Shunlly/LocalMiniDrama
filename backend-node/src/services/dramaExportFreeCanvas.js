'use strict';

/**
 * 自由画布项目导出：路径校验、媒体检查与导入清单收集。
 */

const { createHash } = require('crypto');
const path = require('path');
const uploadService = require('./uploadService');
const storageLayout = require('./storageLayout');
const { validateFreeCanvas } = require('./freeCanvasValidation');

function exportError(code, message, details = null, statusCode = 413, cause = null) {
  // 延迟加载，避免与 dramaExportService 形成循环依赖
  const { DramaExportError } = require('./dramaExportService');
  return new DramaExportError(code, message, statusCode, details, cause);
}

const FREE_CANVAS_IMPORT_MANIFEST_VERSION = 1;

const FREE_CANVAS_MEDIA_EXTENSIONS = Object.freeze({
  images: new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']),
  videos: new Set(['.mp4', '.mov', '.webm', '.mkv', '.avi']),
});
const FREE_CANVAS_VIDEO_STATUSES = new Set(['pending', 'processing', 'completed', 'failed', 'cancelled']);

function extOf(relPath) {
  if (!relPath) return '.jpg';
  return path.extname(relPath) || '.jpg';
}

function declaredCommonsEvidence(category, sourcePath) {
  if (typeof category !== 'string' || !category.startsWith('{')) return null;
  let metadata;
  try {
    metadata = JSON.parse(category);
  } catch (_) {
    return null;
  }
  if (metadata?.kind === 'openverse') return declaredOpenverseEvidence(metadata, sourcePath);
  if (metadata?.kind !== 'wikimedia_commons') return null;
  let source;
  let resolvedDownload;
  try {
    source = new URL(metadata.source_url);
    resolvedDownload = new URL(metadata.resolved_download_url);
  } catch (_) {
    source = null;
  }
  const sourceMatch = source?.pathname.match(/^\/wiki\/(.+)$/);
  let sourceTitle = '';
  try {
    sourceTitle = sourceMatch
      ? decodeURIComponent(sourceMatch[1]).replace(/_/g, ' ').normalize('NFC')
      : '';
  } catch (_) {
    sourceTitle = '';
  }
  if (
    metadata.source_provider !== 'Wikimedia Commons'
    || source?.protocol !== 'https:'
    || source?.origin !== 'https://commons.wikimedia.org'
    || source?.username
    || source?.password
    || typeof metadata.commons_title !== 'string'
    || sourceTitle !== metadata.commons_title.normalize('NFC')
    || typeof metadata.license !== 'string'
    || !metadata.license.trim()
    || metadata.license === '未注明'
    || !Number.isSafeInteger(metadata.commons_page_id)
    || metadata.commons_page_id <= 0
    || !Number.isFinite(Date.parse(metadata.commons_revision_timestamp))
    || !/^[a-f0-9]{40}$/i.test(String(metadata.commons_sha1 || ''))
    || !/^[a-f0-9]{64}$/i.test(String(metadata.content_sha256 || ''))
    || resolvedDownload?.protocol !== 'https:'
    || resolvedDownload?.username
    || resolvedDownload?.password
  ) {
    throw exportError(
      'INVALID_NETWORK_MEDIA_EVIDENCE',
      '项目导出拒绝了不完整或不一致的网络素材证据。',
      { source_path: sourcePath },
      400
    );
  }
  return {
    contentSha256: metadata.content_sha256.toLowerCase(),
    commonsSha1: metadata.commons_sha1.toLowerCase(),
  };
}


function declaredOpenverseEvidence(metadata, sourcePath) {
  let source;
  let resolvedDownload;
  let landing;
  try {
    source = new URL(metadata.source_url);
    resolvedDownload = new URL(metadata.resolved_download_url);
    landing = metadata.landing_page ? new URL(metadata.landing_page) : null;
  } catch (_) {
    source = null;
  }
  const id = String(metadata.openverse_id || '').toLowerCase();
  const sourceMatch = source?.pathname.match(/^\/image\/([0-9a-f-]{36})\/?$/i);
  const unknownLicense = '\u672a\u6ce8\u660e';
  if (
    metadata.source_provider !== 'Openverse'
    || source?.protocol !== 'https:'
    || source?.origin !== 'https://openverse.org'
    || source?.username
    || source?.password
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    || !sourceMatch
    || sourceMatch[1].toLowerCase() !== id
    || typeof metadata.license !== 'string'
    || !metadata.license.trim()
    || metadata.license === unknownLicense
    || !/^[a-f0-9]{64}$/i.test(String(metadata.content_sha256 || ''))
    || resolvedDownload?.protocol !== 'https:'
    || resolvedDownload?.username
    || resolvedDownload?.password
    || (landing && (landing.protocol !== 'https:' || landing.username || landing.password))
  ) {
    throw exportError(
      'INVALID_NETWORK_MEDIA_EVIDENCE',
      '\u9879\u76ee\u5bfc\u51fa\u62d2\u7edd\u4e86\u4e0d\u5b8c\u6574\u6216\u4e0d\u4e00\u81f4\u7684\u7f51\u7edc\u7d20\u6750\u8bc1\u636e\u3002',
      { source_path: sourcePath },
      400
    );
  }
  return {
    contentSha256: metadata.content_sha256.toLowerCase(),
    commonsSha1: null,
  };
}


function tryNormalizeFreeCanvasExportPath(value, field) {
  try {
    return normalizeFreeCanvasExportPath(value, field);
  } catch (error) {
    if (error?.code === 'INVALID_FREE_CANVAS_REFERENCE') return null;
    throw error;
  }
}

function normalizeFreeCanvasExportPath(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw exportError(
      'INVALID_FREE_CANVAS_REFERENCE',
      `项目导出拒绝了无效的自由画布 ${field}。`,
      { field },
      400
    );
  }
  const reference = value.trim().startsWith('/static/')
    ? value.trim().slice('/static/'.length)
    : value.trim();
  try {
    return uploadService.normalizeStorageRelativeReference(reference);
  } catch (error) {
    throw exportError(
      'INVALID_FREE_CANVAS_REFERENCE',
      `项目导出拒绝了不安全的自由画布 ${field}。`,
      { field },
      400,
      error
    );
  }
}

function validateFreeCanvasForExport(db, dramaId, canvas) {
  try {
    return validateFreeCanvas(db, dramaId, canvas);
  } catch (error) {
    throw exportError(
      'INVALID_FREE_CANVAS_REFERENCE',
      `项目导出拒绝了无效的自由画布数据：${String(error?.message || '校验失败')}`,
      null,
      400,
      error
    );
  }
}

function detectedFreeCanvasMediaFormat(detected) {
  const extension = String(detected?.extension || '').toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') return 'jpeg';
  return extension.startsWith('.') ? extension.slice(1) : '';
}

function assertFreeCanvasMediaExtension(sourcePath, detectedFormat) {
  const extension = path.extname(sourcePath).toLowerCase();
  const expected = extension === '.jpg' || extension === '.jpeg' ? 'jpeg' : extension.slice(1);
  if (!expected || expected !== detectedFormat) {
    throw exportError(
      'INVALID_FREE_CANVAS_MEDIA',
      '项目导出拒绝了内容与扩展名不符的自由画布媒体。',
      { source_path: sourcePath },
      400
    );
  }
}

function assertFreeCanvasMediaScope(drama, sourcePath, allowedGlobalUploadPaths) {
  if (sourcePath === 'library' || sourcePath.startsWith('library/')) return;
  if (
    (sourcePath === 'uploads' || sourcePath.startsWith('uploads/'))
    && allowedGlobalUploadPaths.has(sourcePath)
  ) {
    return;
  }
  const prefixes = [
    storageLayout.buildProjectRelativeDir(drama),
    `dramas/${Number(drama.id)}`,
  ];
  if (prefixes.some((prefix) => sourcePath === prefix || sourcePath.startsWith(`${prefix}/`))) return;
  throw exportError(
    'INVALID_FREE_CANVAS_REFERENCE',
    '项目导出拒绝了跨项目的自由画布媒体。',
    { source_path: sourcePath },
    400
  );
}

function inspectFreeCanvasMedia(buffer, sourcePath, category) {
  let detected;
  try {
    detected = uploadService.assertAllowedUpload(
      buffer,
      category === 'videos' ? 'video' : 'image'
    );
  } catch (error) {
    throw exportError(
      'INVALID_FREE_CANVAS_MEDIA',
      '项目导出拒绝了无效的自由画布媒体内容。',
      { source_path: sourcePath },
      400,
      error
    );
  }
  const detectedFormat = detectedFreeCanvasMediaFormat(detected);
  assertFreeCanvasMediaExtension(sourcePath, detectedFormat);
  return {
    sha256: createHash('sha256').update(buffer).digest('hex'),
    size: buffer.length,
    detected_format: detectedFormat,
  };
}

function parseFreeCanvasExportReference(value, sourceDramaId, field, kind) {
  let id = null;
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) {
    id = Number(value);
  } else if (typeof value === 'string') {
    const direct = new RegExp(`^${kind}:(\\d+)$`).exec(value);
    const scoped = new RegExp(`^project:(\\d+):${kind}:(\\d+)$`).exec(value);
    if (direct) id = Number(direct[1]);
    if (scoped) {
      if (Number(scoped[1]) !== Number(sourceDramaId)) {
        throw exportError(
          'INVALID_FREE_CANVAS_REFERENCE',
          `项目导出拒绝了跨项目的自由画布 ${field}。`,
          { field },
          400
        );
      }
      id = Number(scoped[2]);
    }
  }
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw exportError(
      'INVALID_FREE_CANVAS_REFERENCE',
      `项目导出拒绝了无效的自由画布 ${field}。`,
      { field },
      400
    );
  }
  return id;
}

function collectFreeCanvasImportManifest({
  db,
  drama,
  storagePath,
  archive,
  metadata,
  episodes,
  storyboardsByEp,
  scenes,
  sceneIdToIndex,
  imageFilesToPack,
  videosBySb,
}) {
  const canvas = metadata?.free_canvas;
  if (
    !canvas
    || typeof canvas !== 'object'
    || Array.isArray(canvas)
    || canvas.version !== 1
    || !Array.isArray(canvas.nodes)
  ) {
    return null;
  }

  const sourceDramaId = Number(drama.id);
  const referencedAssetIds = new Set();
  const assetMediaCategories = new Map();
  const registerAssetCategory = (assetId, category) => {
    const existing = assetMediaCategories.get(assetId);
    if (existing && existing !== category) {
      throw exportError(
        'INVALID_FREE_CANVAS_REFERENCE',
        '项目导出拒绝了被当成冲突媒体类型的自由画布资产。',
        { asset_id: assetId },
        400
      );
    }
    assetMediaCategories.set(assetId, category);
  };

  for (const node of canvas.nodes) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue;
    for (const field of ['assetId', 'asset_ref']) {
      if (node[field] == null || node[field] === '') continue;
      const assetId = parseFreeCanvasExportReference(node[field], sourceDramaId, field, 'asset');
      referencedAssetIds.add(assetId);
      if (node.type === 'image') registerAssetCategory(assetId, 'images');
      if (node.type === 'video') registerAssetCategory(assetId, 'videos');
    }
  }

  const reusableMedia = new Map();
  for (const item of imageFilesToPack) {
    const sourcePath = tryNormalizeFreeCanvasExportPath(item.localRelPath, 'media path');
    if (!sourcePath || reusableMedia.has(sourcePath)) continue;
    reusableMedia.set(sourcePath, {
      archive_path: item.zipPath,
      category: 'images',
      image_generation_id: Number(item.sourceGenerationId),
    });
  }
  for (const [storyboardId, video] of Object.entries(videosBySb)) {
    if (!video.local_path) continue;
    const sourcePath = tryNormalizeFreeCanvasExportPath(video.local_path, 'media path');
    if (!sourcePath || reusableMedia.has(sourcePath)) continue;
    reusableMedia.set(sourcePath, {
      archive_path: `media/videos/sb_${storyboardId}${extOf(video.local_path)}`,
      category: 'videos',
      video_generation_id: video.original_id || undefined,
    });
  }

  const mediaByPath = new Map();
  const addMedia = (value, category, field) => {
    if (value == null || value === '') return null;
    const sourcePath = normalizeFreeCanvasExportPath(value, field);
    const extension = path.extname(sourcePath).toLowerCase();
    if (!FREE_CANVAS_MEDIA_EXTENSIONS[category]?.has(extension)) {
      throw exportError(
        'INVALID_FREE_CANVAS_REFERENCE',
        `项目导出拒绝了不支持的自由画布 ${field}。`,
        { field },
        400
      );
    }
    const existing = mediaByPath.get(sourcePath);
    if (existing) {
      if (existing.category !== category) {
        throw exportError(
          'INVALID_FREE_CANVAS_REFERENCE',
          '项目导出拒绝了被当成冲突媒体类型的自由画布路径。',
          { field },
          400
        );
      }
      return sourcePath;
    }

    const reusable = reusableMedia.get(sourcePath);
    const entry = {
      source_path: sourcePath,
      archive_path: reusable?.category === category
        ? reusable.archive_path
        : `media/free-canvas/media_${String(mediaByPath.size + 1).padStart(4, '0')}${extension}`,
      category,
    };
    if (reusable?.category === category && reusable.image_generation_id) {
      entry.image_generation_id = reusable.image_generation_id;
    }
    if (reusable?.category === category && reusable.video_generation_id) {
      entry.video_generation_id = reusable.video_generation_id;
    }
    mediaByPath.set(sourcePath, entry);
    return sourcePath;
  };

  const selectSourceAsset = db.prepare(
    `SELECT id, name, type, category, local_path, file_size, mime_type, width, height,
            duration, image_gen_id, video_gen_id, drama_id
     FROM assets
     WHERE id = ? AND deleted_at IS NULL`
  );
  const allowedGlobalUploadPaths = new Set();
  const commonsEvidenceByPath = new Map();
  const assets = [];
  for (const sourceId of [...referencedAssetIds].sort((a, b) => a - b)) {
    const asset = selectSourceAsset.get(sourceId);
    if (!asset || (asset.drama_id != null && Number(asset.drama_id) !== sourceDramaId)) {
      throw exportError(
        'INVALID_FREE_CANVAS_REFERENCE',
        '项目导出拒绝了缺失或跨项目的自由画布资产。',
        { asset_id: sourceId },
        400
      );
    }
    if (asset.drama_id == null && asset.local_path) {
      const globalPath = normalizeFreeCanvasExportPath(asset.local_path, 'global asset local_path');
      if (globalPath === 'uploads' || globalPath.startsWith('uploads/')) {
        allowedGlobalUploadPaths.add(globalPath);
      }
    }
    const mediaCategory = assetMediaCategories.get(sourceId)
      || (String(asset.type || '').toLowerCase() === 'video' ? 'videos' : 'images');
    const sourcePath = asset.local_path
      ? addMedia(asset.local_path, mediaCategory, 'asset local_path')
      : null;
    if (assetMediaCategories.has(sourceId) && !sourcePath) {
      throw exportError(
        'INVALID_FREE_CANVAS_REFERENCE',
        '项目导出拒绝了没有本地文件的自由画布媒体。',
        { asset_id: sourceId },
        400
      );
    }
    const evidence = declaredCommonsEvidence(asset.category, sourcePath);
    if (evidence && sourcePath) {
      const existingEvidence = commonsEvidenceByPath.get(sourcePath);
      if (existingEvidence && (
        existingEvidence.contentSha256 !== evidence.contentSha256
        || existingEvidence.commonsSha1 !== evidence.commonsSha1
      )) {
        throw exportError(
          'INVALID_NETWORK_MEDIA_EVIDENCE',
          '项目导出拒绝了冲突的网络素材内容哈希。',
          { source_path: sourcePath },
          400
        );
      }
      commonsEvidenceByPath.set(sourcePath, evidence);
    }
    assets.push({
      source_id: sourceId,
      name: asset.name || '导入素材',
      type: asset.type || (mediaCategory === 'videos' ? 'video' : 'image'),
      category: asset.category || null,
      source_path: sourcePath,
      file_size: asset.file_size || null,
      mime_type: asset.mime_type || null,
      width: asset.width || null,
      height: asset.height || null,
      duration: asset.duration || null,
      image_gen_id: asset.image_gen_id || null,
      video_gen_id: asset.video_gen_id || null,
    });
  }

  const videoGenerationIds = [...new Set(
    assets.map((asset) => Number(asset.video_gen_id)).filter((id) => Number.isSafeInteger(id) && id > 0)
  )].sort((a, b) => a - b);
  const selectVideoGeneration = db.prepare(
    `SELECT id, storyboard_id, scene_id, provider, prompt, model, duration, aspect_ratio,
            status, error_msg, local_path
     FROM video_generations
     WHERE id = ? AND drama_id = ? AND deleted_at IS NULL`
  );
  const exportedStoryboardIds = new Set(
    episodes.flatMap((episode) =>
      (storyboardsByEp[episode.id] || []).map((storyboard) => Number(storyboard.id))
    )
  );
  const exportedSceneIds = new Set(scenes.map((scene) => Number(scene.id)));
  const videoGenerations = videoGenerationIds.map((sourceId) => {
    const generation = selectVideoGeneration.get(sourceId, sourceDramaId);
    if (!generation) {
      throw exportError(
        'INVALID_FREE_CANVAS_REFERENCE',
        '项目导出拒绝了缺失或跨项目的自由画布视频生成记录。',
        { video_generation_id: sourceId },
        400
      );
    }
    if (generation.storyboard_id != null && !exportedStoryboardIds.has(Number(generation.storyboard_id))) {
      throw exportError(
        'INVALID_FREE_CANVAS_REFERENCE',
        '项目导出拒绝了跨项目的自由画布视频分镜。',
        { video_generation_id: sourceId },
        400
      );
    }
    if (generation.scene_id != null && !exportedSceneIds.has(Number(generation.scene_id))) {
      throw exportError(
        'INVALID_FREE_CANVAS_REFERENCE',
        '项目导出拒绝了跨项目的自由画布视频场景。',
        { video_generation_id: sourceId },
        400
      );
    }
    const status = String(generation.status || 'completed');
    if (!FREE_CANVAS_VIDEO_STATUSES.has(status)) {
      throw exportError(
        'INVALID_FREE_CANVAS_REFERENCE',
        '项目导出拒绝了不支持的自由画布视频生成状态。',
        { video_generation_id: sourceId },
        400
      );
    }
    const linkedPaths = new Set(
      assets
        .filter((asset) => Number(asset.video_gen_id) === sourceId && asset.source_path)
        .map((asset) => asset.source_path)
    );
    if (linkedPaths.size !== 1) {
      throw exportError(
        'INVALID_FREE_CANVAS_REFERENCE',
        '项目导出拒绝了不明确的自由画布视频媒体绑定。',
        { video_generation_id: sourceId },
        400
      );
    }
    const linkedPath = [...linkedPaths][0];
    const generationPath = generation.local_path
      ? normalizeFreeCanvasExportPath(generation.local_path, 'video generation local_path')
      : linkedPath;
    if (generationPath !== linkedPath) {
      throw exportError(
        'INVALID_FREE_CANVAS_REFERENCE',
        '项目导出拒绝了资产与视频生成媒体不匹配的记录。',
        { video_generation_id: sourceId },
        400
      );
    }
    const sourcePath = addMedia(generationPath, 'videos', 'video generation local_path');
    if (!sourcePath) {
      throw exportError(
        'INVALID_FREE_CANVAS_REFERENCE',
        '项目导出拒绝了没有本地媒体的视频生成引用。',
        { video_generation_id: sourceId },
        400
      );
    }
    return {
      source_id: sourceId,
      storyboard_id: generation.storyboard_id ?? null,
      scene_id: generation.scene_id ?? null,
      provider: generation.provider || 'imported',
      prompt: generation.prompt || null,
      model: generation.model || null,
      duration: generation.duration ?? null,
      aspect_ratio: generation.aspect_ratio || null,
      status,
      error_msg: generation.error_msg || null,
      source_path: sourcePath,
    };
  });

  for (const node of canvas.nodes) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue;
    const mediaCategory = node.type === 'image' ? 'images' : node.type === 'video' ? 'videos' : null;
    if (!mediaCategory) continue;
    for (const field of ['content', 'storageKey']) {
      if (node[field] !== undefined) addMedia(node[field], mediaCategory, `node ${field}`);
    }
  }

  const media = [...mediaByPath.values()];
  const archivePaths = new Set();
  for (const entry of media) {
    const collisionKey = entry.archive_path.normalize('NFC').toLowerCase();
    if (archivePaths.has(collisionKey)) {
      throw exportError(
        'EXPORT_DUPLICATE_PATH',
        '项目导出生成了重复的自由画布压缩路径，请重试。',
        { archive_path: entry.archive_path },
        500
      );
    }
    archivePaths.add(collisionKey);
    assertFreeCanvasMediaScope(drama, entry.source_path, allowedGlobalUploadPaths);
    const buffer = archive.readStorageFile(storagePath, entry.source_path, entry.archive_path);
    if (!buffer) {
      throw exportError(
        'FREE_CANVAS_MEDIA_MISSING',
        '项目导出无法打包引用的自由画布媒体，请检查素材后重试。',
        { source_path: entry.source_path },
        400
      );
    }
    Object.assign(entry, inspectFreeCanvasMedia(buffer, entry.source_path, entry.category));
    const evidence = commonsEvidenceByPath.get(entry.source_path);
    const actualSha1 = evidence?.commonsSha1 ? createHash('sha1').update(buffer).digest('hex') : null;
    if (evidence && (evidence.contentSha256 !== entry.sha256 || (evidence.commonsSha1 && evidence.commonsSha1 !== actualSha1))) {
      throw exportError(
        'NETWORK_MEDIA_CONTENT_HASH_MISMATCH',
        '项目导出拒绝了证据与本地文件不符的网络素材。',
        { source_path: entry.source_path },
        400
      );
    }
    archive.addBuffer(entry.archive_path, buffer);
  }

  return {
    manifest_version: FREE_CANVAS_IMPORT_MANIFEST_VERSION,
    hash_algorithm: 'sha256',
    source_drama_id: sourceDramaId,
    episode_ids: episodes.map((episode) => Number(episode.id)),
    storyboard_ids: episodes.flatMap((episode) =>
      (storyboardsByEp[episode.id] || []).map((storyboard) => Number(storyboard.id))
    ),
    scene_refs: scenes.map((scene) => ({
      source_id: Number(scene.id),
      export_index: Number(sceneIdToIndex[scene.id]),
    })),
    assets,
    video_generations: videoGenerations,
    media,
  };
}

module.exports = {
  tryNormalizeFreeCanvasExportPath,
  normalizeFreeCanvasExportPath,
  validateFreeCanvasForExport,
  detectedFreeCanvasMediaFormat,
  assertFreeCanvasMediaExtension,
  assertFreeCanvasMediaScope,
  inspectFreeCanvasMedia,
  parseFreeCanvasExportReference,
  collectFreeCanvasImportManifest,
};
