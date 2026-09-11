'use strict';

const {
  FREE_CANVAS_IMPORT_MANIFEST_VERSION,
  declaredFreeCanvasDramaId,
  freeCanvasCommonsEvidence,
  freeCanvasAssetCategory,
  freeCanvasImportFieldLabel,
  freeCanvasManifestArray,
  freeCanvasManifestId,
  freeCanvasManifestNumber,
  freeCanvasManifestString,
  freeCanvasSourceDramaId,
  normalizeFreeCanvasArchivePath,
  normalizeFreeCanvasDetectedFormat,
  normalizeFreeCanvasManifestSourcePath,
  normalizeFreeCanvasVideoStatus,
  parseFreeCanvasReferenceId,
} = require('./dramaImportFreeCanvasManifestFields');

const { badRequest: freeCanvasBadRequest } = require('./freeCanvasValidation');
/** 自由画布导入清单正文装配 */
function normalizeFreeCanvasImportManifest(data, canvas) {
  const input = data.free_canvas_import;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw freeCanvasBadRequest('自由画布导入数据必须为对象');
  }
  if (input.manifest_version !== FREE_CANVAS_IMPORT_MANIFEST_VERSION) {
    throw freeCanvasBadRequest('自由画布导入清单版本不受支持');
  }
  if (
    input.hash_algorithm !== undefined && input.hash_algorithm !== 'sha256'
    || (Array.isArray(input.media) && input.media.length > 0 && input.hash_algorithm !== 'sha256')
  ) {
    throw freeCanvasBadRequest('自由画布导入哈希算法不受支持');
  }

  const sourceDramaId = freeCanvasManifestId(input.source_drama_id, 'source_drama_id');
  const declaredDramaId = declaredFreeCanvasDramaId(canvas);
  if (declaredDramaId != null && declaredDramaId !== sourceDramaId) {
    throw freeCanvasBadRequest('自由画布导入源项目与画布项目引用不一致');
  }

  const episodeIds = freeCanvasManifestArray(input.episode_ids, 'episode_ids')
    .map((id, index) => freeCanvasManifestId(id, `episode_ids[${index}]`));
  const expectedEpisodeCount = Array.isArray(data.episodes) ? data.episodes.length : 0;
  if (episodeIds.length !== expectedEpisodeCount || new Set(episodeIds).size !== episodeIds.length) {
    throw freeCanvasBadRequest('自由画布导入剧集列表与导出剧集不一致');
  }

  const storyboardIds = freeCanvasManifestArray(input.storyboard_ids, 'storyboard_ids')
    .map((id, index) => freeCanvasManifestId(id, `storyboard_ids[${index}]`));
  const expectedStoryboardCount = (data.episodes || []).reduce(
    (count, episode) => count + (Array.isArray(episode?.storyboards) ? episode.storyboards.length : 0),
    0
  );
  if (storyboardIds.length !== expectedStoryboardCount || new Set(storyboardIds).size !== storyboardIds.length) {
    throw freeCanvasBadRequest('自由画布导入分镜列表与导出分镜不一致');
  }

  const sceneRefs = freeCanvasManifestArray(input.scene_refs, 'scene_refs').map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw freeCanvasBadRequest('自由画布导入场景引用必须为对象');
    }
    const exportIndex = entry.export_index;
    if (
      !Number.isSafeInteger(exportIndex)
      || exportIndex < 0
      || exportIndex >= (Array.isArray(data.scenes) ? data.scenes.length : 0)
    ) {
      throw freeCanvasBadRequest('自由画布导入场景导出序号无效');
    }
    return {
      sourceId: freeCanvasManifestId(entry.source_id, `scene_refs[${index}].source_id`),
      exportIndex,
    };
  });
  if (new Set(sceneRefs.map((entry) => entry.sourceId)).size !== sceneRefs.length) {
    throw freeCanvasBadRequest('自由画布导入场景引用包含重复源标识');
  }

  const referencedAssetIds = new Set();
  const assetCategories = new Map();
  const expectedMediaCategories = new Map();
  const registerExpectedMedia = (value, category, field) => {
    if (value === undefined || value === null || value === '') return null;
    const sourcePath = normalizeFreeCanvasManifestSourcePath(value, field);
    const existing = expectedMediaCategories.get(sourcePath);
    if (existing && existing !== category) {
      throw freeCanvasBadRequest('自由画布导入同一本地媒体不能同时作为图片和视频');
    }
    expectedMediaCategories.set(sourcePath, category);
    return sourcePath;
  };
  const registerAssetCategory = (sourceId, category) => {
    const existing = assetCategories.get(sourceId);
    if (existing && existing !== category) {
      throw freeCanvasBadRequest('自由画布素材不能同时作为图片和视频');
    }
    assetCategories.set(sourceId, category);
  };

  for (const node of canvas.nodes || []) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue;
    for (const field of ['assetId', 'asset_ref']) {
      if (node[field] === undefined) continue;
      const sourceId = parseFreeCanvasReferenceId(node[field], sourceDramaId, field, 'asset');
      referencedAssetIds.add(sourceId);
      if (node.type === 'image') registerAssetCategory(sourceId, 'images');
      if (node.type === 'video') registerAssetCategory(sourceId, 'videos');
    }
    const mediaCategory = node.type === 'image' ? 'images' : node.type === 'video' ? 'videos' : null;
    if (!mediaCategory) continue;
    for (const field of ['content', 'storageKey']) {
      if (node[field] !== undefined) registerExpectedMedia(node[field], mediaCategory, `node ${field}`);
    }
  }

  const assets = freeCanvasManifestArray(input.assets, 'assets').map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw freeCanvasBadRequest('自由画布导入素材必须为对象');
    }
    const sourceId = freeCanvasManifestId(entry.source_id, `assets[${index}].source_id`);
    const mediaCategory = assetCategories.get(sourceId)
      || (String(entry.type || '').toLowerCase() === 'video' ? 'videos' : 'images');
    const sourcePath = entry.source_path == null
      ? null
      : registerExpectedMedia(entry.source_path, mediaCategory, `assets[${index}].source_path`);
    if (assetCategories.has(sourceId) && !sourcePath) {
      throw freeCanvasBadRequest('自由画布导入画布媒体素材缺少本地路径');
    }
    return {
      sourceId,
      name: freeCanvasManifestString(entry.name, `assets[${index}].name`, 500, '导入素材'),
      type: freeCanvasManifestString(entry.type, `assets[${index}].type`, 64, mediaCategory === 'videos' ? 'video' : 'image'),
      category: freeCanvasAssetCategory(entry.category, `assets[${index}].category`),
      sourcePath,
      fileSize: freeCanvasManifestNumber(entry.file_size, `assets[${index}].file_size`, { integer: true }),
      mimeType: freeCanvasManifestString(entry.mime_type, `assets[${index}].mime_type`, 256),
      width: freeCanvasManifestNumber(entry.width, `assets[${index}].width`, { integer: true }),
      height: freeCanvasManifestNumber(entry.height, `assets[${index}].height`, { integer: true }),
      duration: freeCanvasManifestNumber(entry.duration, `assets[${index}].duration`),
      imageGenId: freeCanvasManifestId(entry.image_gen_id, `assets[${index}].image_gen_id`, true),
      videoGenId: freeCanvasManifestId(entry.video_gen_id, `assets[${index}].video_gen_id`, true),
    };
  });
  const assetIds = assets.map((asset) => asset.sourceId);
  if (
    new Set(assetIds).size !== assetIds.length
    || assetIds.some((id) => !referencedAssetIds.has(id))
    || [...referencedAssetIds].some((id) => !assetIds.includes(id))
  ) {
    throw freeCanvasBadRequest('自由画布导入素材与画布素材引用不一致');
  }

  const expectedVideoGenerationIds = new Set(
    assets.map((asset) => asset.videoGenId).filter((id) => id != null)
  );
  const videoGenerations = freeCanvasManifestArray(input.video_generations, 'video_generations')
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw freeCanvasBadRequest('自由画布导入视频生成记录必须为对象');
      }
      return {
        sourceId: freeCanvasManifestId(entry.source_id, `video_generations[${index}].source_id`),
        storyboardId: freeCanvasManifestId(entry.storyboard_id, `video_generations[${index}].storyboard_id`, true),
        sceneId: freeCanvasManifestId(entry.scene_id, `video_generations[${index}].scene_id`, true),
        provider: freeCanvasManifestString(entry.provider, `video_generations[${index}].provider`, 128, 'imported'),
        prompt: freeCanvasManifestString(entry.prompt, `video_generations[${index}].prompt`, 50000),
        model: freeCanvasManifestString(entry.model, `video_generations[${index}].model`, 500),
        duration: freeCanvasManifestNumber(entry.duration, `video_generations[${index}].duration`),
        aspectRatio: freeCanvasManifestString(entry.aspect_ratio, `video_generations[${index}].aspect_ratio`, 64),
        status: normalizeFreeCanvasVideoStatus(entry.status, `video_generations[${index}].status`),
        errorMsg: freeCanvasManifestString(entry.error_msg, `video_generations[${index}].error_msg`, 2000),
        sourcePath: registerExpectedMedia(
          entry.source_path,
          'videos',
          `video_generations[${index}].source_path`
        ),
      };
    });
  const videoGenerationIds = videoGenerations.map((generation) => generation.sourceId);
  if (
    new Set(videoGenerationIds).size !== videoGenerationIds.length
    || videoGenerationIds.some((id) => !expectedVideoGenerationIds.has(id))
    || [...expectedVideoGenerationIds].some((id) => !videoGenerationIds.includes(id))
  ) {
    throw freeCanvasBadRequest('自由画布导入视频生成记录与素材引用不一致');
  }
  const videoGenerationById = new Map(
    videoGenerations.map((generation) => [generation.sourceId, generation])
  );
  for (const asset of assets) {
    if (asset.videoGenId == null) continue;
    const generation = videoGenerationById.get(asset.videoGenId);
    if (!asset.sourcePath || !generation || generation.sourcePath !== asset.sourcePath) {
      throw freeCanvasBadRequest('自由画布导入素材与视频生成媒体必须一致');
    }
  }

  const media = freeCanvasManifestArray(input.media, 'media').map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw freeCanvasBadRequest('自由画布导入媒体记录必须为对象');
    }
    if (!['images', 'videos'].includes(entry.category)) {
      throw freeCanvasBadRequest('自由画布导入媒体分类不受支持');
    }
    const archivePath = normalizeFreeCanvasArchivePath(
      entry.archive_path,
      `media[${index}].archive_path`
    );
    const size = freeCanvasManifestNumber(entry.size, `media[${index}].size`, { integer: true });
    const sha256 = freeCanvasManifestString(entry.sha256, `media[${index}].sha256`, 64);
    if (!Number.isSafeInteger(size) || size <= 0) {
      throw freeCanvasBadRequest('自由画布导入媒体大小必须为正整数');
    }
    if (!/^[a-f0-9]{64}$/.test(String(sha256 || ''))) {
      throw freeCanvasBadRequest('自由画布导入媒体哈希无效');
    }
    return {
      sourcePath: normalizeFreeCanvasManifestSourcePath(entry.source_path, `media[${index}].source_path`),
      archivePath,
      category: entry.category,
      size,
      sha256,
      detectedFormat: normalizeFreeCanvasDetectedFormat(
        entry.detected_format,
        entry.category,
        archivePath,
        `media[${index}].detected_format`
      ),
      imageGenerationId: freeCanvasManifestId(
        entry.image_generation_id,
        `media[${index}].image_generation_id`,
        true
      ),
      videoGenerationId: freeCanvasManifestId(
        entry.video_generation_id,
        `media[${index}].video_generation_id`,
        true
      ),
    };
  });
  const mediaByPath = new Map();
  const archivePaths = new Set();
  for (const entry of media) {
    if (mediaByPath.has(entry.sourcePath)) {
      throw freeCanvasBadRequest('自由画布导入媒体包含重复源路径');
    }
    const archiveCollisionKey = entry.archivePath.normalize('NFC').toLowerCase();
    if (archivePaths.has(archiveCollisionKey)) {
      throw freeCanvasBadRequest('自由画布导入媒体包含重复归档路径');
    }
    archivePaths.add(archiveCollisionKey);
    const expectedCategory = expectedMediaCategories.get(entry.sourcePath);
    if (!expectedCategory || expectedCategory !== entry.category) {
      throw freeCanvasBadRequest('自由画布导入媒体与画布媒体引用不一致');
    }
    if (entry.videoGenerationId != null) {
      const generation = videoGenerationById.get(entry.videoGenerationId);
      if (generation && generation.sourcePath !== entry.sourcePath) {
        throw freeCanvasBadRequest('自由画布导入视频生成媒体绑定不一致');
      }
    }
    mediaByPath.set(entry.sourcePath, entry);
  }
  if ([...expectedMediaCategories].some(([sourcePath]) => !mediaByPath.has(sourcePath))) {
    throw freeCanvasBadRequest('自由画布导入缺少画布引用的媒体归档');
  }
  for (const asset of assets) {
    if (!asset.sourcePath) continue;
    const evidence = freeCanvasCommonsEvidence(asset.category);
    if (!evidence) continue;
    const archivedMedia = mediaByPath.get(asset.sourcePath);
    if (evidence.contentSha256 !== archivedMedia?.sha256?.toLowerCase()) {
      throw freeCanvasBadRequest('自由画布导入网络素材内容哈希与媒体归档不一致');
    }
    if (evidence.commonsSha1) {
      if (archivedMedia.commonsSha1 && archivedMedia.commonsSha1 !== evidence.commonsSha1) {
        throw freeCanvasBadRequest('自由画布导入同一媒体包含冲突的网络素材校验值');
      }
      archivedMedia.commonsSha1 = evidence.commonsSha1;
    }
  }

  return {
    sourceDramaId,
    episodeIds,
    storyboardIds,
    sceneRefs,
    assets,
    videoGenerations,
    media,
    mediaByPath,
  };
}

module.exports = {
  declaredFreeCanvasDramaId,
  freeCanvasAssetCategory,
  freeCanvasImportFieldLabel,
  freeCanvasSourceDramaId,
  normalizeFreeCanvasImportManifest,
  normalizeFreeCanvasManifestSourcePath,
  parseFreeCanvasReferenceId,
};
