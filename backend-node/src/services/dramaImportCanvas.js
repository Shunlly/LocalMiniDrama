// 项目导入自由画布编排：校验归档媒体、建立可移植映射并写回 metadata
const { createHash } = require('crypto');
const uploadService = require('./uploadService');
const { validateFreeCanvas, badRequest: freeCanvasBadRequest } = require('./freeCanvasValidation');
const { normalizeFreeCanvasImportManifest } = require('./dramaImportManifest');
const {
  createImportedFreeCanvasMaps,
  remapImportedFreeCanvas,
} = require('./dramaImportRestore');
const { saveMediaFile } = require('./dramaImportMedia');

function restoreImportedFreeCanvas(db, dramaId, metadata, maps, now) {
  const canvas = metadata?.free_canvas;
  if (canvas === undefined) return metadata;
  if (!canvas || typeof canvas !== 'object' || Array.isArray(canvas) || canvas.version !== 1) {
    // 畸形或未知结构仍走保存路径的错误约定。
    metadata.free_canvas = validateFreeCanvas(db, dramaId, canvas);
    return metadata;
  }

  const remapped = remapImportedFreeCanvas(canvas, maps, dramaId);
  metadata.free_canvas = validateFreeCanvas(db, dramaId, remapped);
  db.prepare('UPDATE dramas SET metadata = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(metadata), now, dramaId);
  return metadata;
}

function verifyFreeCanvasArchiveMedia(files, media) {
  let buffer;
  try {
    buffer = files.read(media.archivePath);
  } catch (_) {
    throw freeCanvasBadRequest('自由画布导入媒体归档路径无效');
  }
  if (!buffer) throw freeCanvasBadRequest('自由画布导入缺少画布引用的媒体归档文件');
  if (buffer.length !== media.size) {
    throw freeCanvasBadRequest('自由画布导入媒体大小与归档实际大小不一致');
  }
  const actualHash = createHash('sha256').update(buffer).digest('hex');
  if (actualHash !== media.sha256) {
    throw freeCanvasBadRequest('自由画布导入媒体哈希校验失败');
  }
  if (media.commonsSha1) {
    const actualSha1 = createHash('sha1').update(buffer).digest('hex');
    if (actualSha1 !== media.commonsSha1) {
      throw freeCanvasBadRequest('自由画布导入媒体完整性校验失败');
    }
  }

  let detected;
  try {
    detected = uploadService.assertAllowedUpload(
      buffer,
      media.category === 'videos' ? 'video' : 'image'
    );
  } catch (_) {
    throw freeCanvasBadRequest('自由画布导入媒体格式或类型无效');
  }
  const detectedFormat = detected.extension === '.jpg' || detected.extension === '.jpeg'
    ? 'jpeg'
    : String(detected.extension || '').replace(/^\./, '');
  if (detectedFormat !== media.detectedFormat) {
    throw freeCanvasBadRequest('自由画布导入媒体检测格式与归档内容不一致');
  }
  return {
    fileSize: buffer.length,
    mimeType: detected.mimeType,
    detectedFormat,
  };
}

function buildPortableImportedFreeCanvasMaps(db, dramaId, imported, now) {
  const manifest = normalizeFreeCanvasImportManifest(imported.data, imported.metadata.free_canvas);
  const maps = createImportedFreeCanvasMaps(manifest.sourceDramaId);

  manifest.episodeIds.forEach((sourceId, index) => {
    const targetId = imported.episodeIds[index];
    if (targetId == null) throw freeCanvasBadRequest('自由画布导入剧集列表无法映射');
    maps.episodes.set(sourceId, Number(targetId));
  });
  manifest.storyboardIds.forEach((sourceId, index) => {
    const targetId = imported.storyboardIds[index];
    if (targetId == null) throw freeCanvasBadRequest('自由画布导入分镜列表无法映射');
    maps.storyboards.set(sourceId, Number(targetId));
  });
  for (const sceneRef of manifest.sceneRefs) {
    const targetId = imported.sceneIds[sceneRef.exportIndex];
    if (targetId == null) throw freeCanvasBadRequest('自由画布导入场景引用无法映射');
    maps.scenes.set(sceneRef.sourceId, Number(targetId));
  }

  for (const media of manifest.media) {
    media.trustedMetadata = verifyFreeCanvasArchiveMedia(imported.files, media);
    let restored = null;
    if (media.imageGenerationId != null) {
      const candidate = imported.images.get(media.imageGenerationId);
      if (candidate?.archivePath === media.archivePath && candidate.localPath) restored = candidate.localPath;
    }
    if (media.videoGenerationId != null) {
      const candidate = imported.videos.get(media.videoGenerationId);
      if (candidate?.archivePath === media.archivePath && candidate.localPath) {
        if (restored && restored !== candidate.localPath) {
          throw freeCanvasBadRequest('自由画布导入媒体生成记录映射不一致');
        }
        restored = candidate.localPath;
      }
    }
    if (!restored) {
      try {
        restored = saveMediaFile(
          imported.storagePath,
          imported.projectDir,
          media.category,
          imported.files,
          media.archivePath,
          media.category === 'videos' ? 'canvas_vid_imp' : 'canvas_img_imp'
        );
      } catch (error) {
        if (['UNSAFE_ARCHIVE_PATH', 'UNSUPPORTED_MEDIA_TYPE'].includes(error?.code)) {
          throw freeCanvasBadRequest('自由画布导入媒体归档引用无效');
        }
        throw error;
      }
    }
    if (!restored) throw freeCanvasBadRequest('自由画布导入缺少画布媒体归档文件');
    maps.paths.set(media.sourcePath, restored);
  }

  const insertVideo = db.prepare(
    `INSERT INTO video_generations
     (drama_id, storyboard_id, provider, prompt, model, duration, aspect_ratio, status,
      video_url, local_path, scene_id, completed_at, error_msg, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`
  );
  const updateVideo = db.prepare(
    `UPDATE video_generations
     SET drama_id = ?, storyboard_id = ?, provider = ?, prompt = ?, model = ?, duration = ?,
         aspect_ratio = ?, status = ?, video_url = NULL, local_path = ?, scene_id = ?,
         completed_at = ?, error_msg = ?, updated_at = ?
     WHERE id = ? AND deleted_at IS NULL`
  );
  for (const generation of manifest.videoGenerations) {
    const storyboardId = generation.storyboardId == null
      ? null
      : maps.storyboards.get(generation.storyboardId);
    const sceneId = generation.sceneId == null ? null : maps.scenes.get(generation.sceneId);
    if (generation.storyboardId != null && storyboardId == null) {
      throw freeCanvasBadRequest('自由画布导入视频生成分镜引用无法映射');
    }
    if (generation.sceneId != null && sceneId == null) {
      throw freeCanvasBadRequest('自由画布导入视频生成场景引用无法映射');
    }
    const localPath = maps.paths.get(generation.sourcePath);
    if (!localPath) throw freeCanvasBadRequest('自由画布导入视频生成媒体无法映射');

    const media = manifest.mediaByPath.get(generation.sourcePath);
    const candidate = imported.videos.get(generation.sourceId);
    const canReuse = Boolean(
      candidate?.newId
      && candidate.localPath === localPath
      && candidate.archivePath === media?.archivePath
      && (
        (candidate.storyboardId == null && storyboardId == null)
        || (
          candidate.storyboardId != null
          && storyboardId != null
          && Number(candidate.storyboardId) === Number(storyboardId)
        )
      )
    );
    const completedAt = generation.status === 'completed' ? now : null;
    if (candidate?.newId) {
      if (!canReuse) {
        throw freeCanvasBadRequest('自由画布导入视频生成记录不一致');
      }
      updateVideo.run(
        dramaId,
        storyboardId,
        generation.provider,
        generation.prompt,
        generation.model,
        generation.duration,
        generation.aspectRatio,
        generation.status,
        localPath,
        sceneId,
        completedAt,
        generation.errorMsg,
        now,
        candidate.newId
      );
      maps.videos.set(generation.sourceId, Number(candidate.newId));
      continue;
    }

    const info = insertVideo.run(
      dramaId,
      storyboardId,
      generation.provider,
      generation.prompt,
      generation.model,
      generation.duration,
      generation.aspectRatio,
      generation.status,
      localPath,
      sceneId,
      completedAt,
      generation.errorMsg,
      now,
      now
    );
    maps.videos.set(generation.sourceId, Number(info.lastInsertRowid));
  }

  const insertAsset = db.prepare(
    `INSERT INTO assets (drama_id, name, type, category, url, local_path, file_size, mime_type,
                         width, height, duration, image_gen_id, video_gen_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const sourceAsset of manifest.assets) {
    const localPath = sourceAsset.sourcePath == null ? null : maps.paths.get(sourceAsset.sourcePath);
    if (sourceAsset.sourcePath != null && !localPath) {
      throw freeCanvasBadRequest('自由画布导入素材媒体无法映射');
    }
    const image = sourceAsset.imageGenId == null ? null : imported.images.get(sourceAsset.imageGenId);
    const videoGenerationId = sourceAsset.videoGenId == null
      ? null
      : maps.videos.get(sourceAsset.videoGenId);
    if (sourceAsset.videoGenId != null && videoGenerationId == null) {
      throw freeCanvasBadRequest('自由画布导入素材视频生成引用无法映射');
    }
    const trustedMedia = sourceAsset.sourcePath == null
      ? null
      : manifest.mediaByPath.get(sourceAsset.sourcePath)?.trustedMetadata;
    const info = insertAsset.run(
      dramaId,
      sourceAsset.name,
      sourceAsset.type,
      sourceAsset.category,
      localPath ? `/static/${localPath}` : null,
      localPath,
      trustedMedia?.fileSize ?? null,
      trustedMedia?.mimeType ?? null,
      null,
      null,
      null,
      image?.newId || null,
      videoGenerationId,
      now,
      now
    );
    const newId = Number(info.lastInsertRowid);
    maps.assets.set(sourceAsset.sourceId, newId);
    maps.importedAssets.set(newId, { id: newId, drama_id: dramaId, local_path: localPath });
    maps.sourceAssetPaths.set(sourceAsset.sourceId, sourceAsset.sourcePath);
  }
  return maps;
}

module.exports = {
  buildPortableImportedFreeCanvasMaps,
  restoreImportedFreeCanvas,
};
