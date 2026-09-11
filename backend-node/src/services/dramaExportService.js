// 项目导出服务：将剧集所有数据和媒体文件打包为 ZIP
const { sanitizeProjectExport, sanitizeSourceMetadataNode } = require('./dramaExportSanitize');
const {
  collectFreeCanvasImportManifest,
  normalizeFreeCanvasExportPath,
  validateFreeCanvasForExport,
} = require('./dramaExportFreeCanvas');

const {
  getStoragePath,
  extOf,
  collectSourceIntakeOriginals,
  parseExtraImages,
  parseStoryboardReferenceImages,
  supplementFramePromptsFromImageGens,
  parseSbChars,
} = require('./dramaExportCollection');

const EXPORT_VERSION = '1.6';  // 1.6: 分镜自由参考图与宫格视频引用可随项目导入导出
const SOURCE_INTAKE_MANIFEST_VERSION = 1;
const MAX_SOURCE_METADATA_BYTES = 64 * 1024;
const DEFAULT_EXPORT_LIMITS = Object.freeze({
  maxFiles: 2000,
  maxFileBytes: 128 * 1024 * 1024,
  maxTotalUncompressedBytes: 512 * 1024 * 1024,
  maxMemoryBytes: 768 * 1024 * 1024,
});
const { collectDramaExportSnapshot } = require('./dramaExportCollect');
const { ExportArchiveBuilder } = require('./dramaExportArchive');
const { DramaExportError, exportError } = require('./dramaExportErrors');

function normalizeExportLimits(overrides = {}) {
  const aliases = {
    maxFiles: ['maxFiles', 'max_files'],
    maxFileBytes: ['maxFileBytes', 'max_file_bytes'],
    maxTotalUncompressedBytes: ['maxTotalUncompressedBytes', 'max_total_uncompressed_bytes'],
    maxMemoryBytes: ['maxMemoryBytes', 'max_memory_bytes'],
  };
  const limits = { ...DEFAULT_EXPORT_LIMITS };
  for (const [key, names] of Object.entries(aliases)) {
    const suppliedName = names.find((name) => overrides?.[name] !== undefined);
    if (!suppliedName) continue;
    const value = Number(overrides[suppliedName]);
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw exportError(
        'INVALID_EXPORT_LIMIT',
        `项目导出限制 ${suppliedName} 必须是正整数。`,
        { limit: suppliedName },
        500
      );
    }
    limits[key] = value;
  }
  return limits;
}

function resolveExportLimits(cfg, overrides = {}) {
  const storage = cfg?.storage || {};
  const nested = storage.project_export_limits
    || storage.export_limits
    || cfg?.project_export?.limits
    || cfg?.project_export
    || {};
  return normalizeExportLimits({
    maxFiles: overrides.maxFiles ?? overrides.max_files
      ?? nested.maxFiles ?? nested.max_files
      ?? storage.project_export_max_files ?? storage.export_max_files
      ?? process.env.LOCALMINIDRAMA_PROJECT_EXPORT_MAX_FILES
      ?? process.env.LOCALMINIDRAMA_EXPORT_MAX_FILES,
    maxFileBytes: overrides.maxFileBytes ?? overrides.max_file_bytes
      ?? nested.maxFileBytes ?? nested.max_file_bytes
      ?? storage.project_export_max_file_bytes ?? storage.export_max_file_bytes
      ?? process.env.LOCALMINIDRAMA_PROJECT_EXPORT_MAX_FILE_BYTES
      ?? process.env.LOCALMINIDRAMA_EXPORT_MAX_FILE_BYTES,
    maxTotalUncompressedBytes: overrides.maxTotalUncompressedBytes ?? overrides.max_total_uncompressed_bytes
      ?? nested.maxTotalUncompressedBytes ?? nested.max_total_uncompressed_bytes
      ?? storage.project_export_max_total_uncompressed_bytes ?? storage.export_max_total_uncompressed_bytes
      ?? process.env.LOCALMINIDRAMA_PROJECT_EXPORT_MAX_TOTAL_UNCOMPRESSED_BYTES
      ?? process.env.LOCALMINIDRAMA_EXPORT_MAX_TOTAL_UNCOMPRESSED_BYTES,
    maxMemoryBytes: overrides.maxMemoryBytes ?? overrides.max_memory_bytes
      ?? nested.maxMemoryBytes ?? nested.max_memory_bytes
      ?? storage.project_export_max_memory_bytes ?? storage.export_max_memory_bytes
      ?? process.env.LOCALMINIDRAMA_PROJECT_EXPORT_MAX_MEMORY_BYTES
      ?? process.env.LOCALMINIDRAMA_EXPORT_MAX_MEMORY_BYTES,
  });
}

/**
 * 导出一个剧集为 ZIP Buffer
 * @returns {Buffer}
 */
function exportDrama(db, cfg, log, dramaId, options = {}) {
  const storagePath = getStoragePath(cfg);
  const limits = resolveExportLimits(cfg, options.limits || options.exportLimits || {});

  const archive = new ExportArchiveBuilder(limits);

  const {
    drama,
    metadata,
    episodes,
    episodeIds,
    storyboardsByEp,
    allImagesBySb,
    videosBySb,
    imageFilesToPack,
    framePromptsBySb,
    characters,
    scenes,
    props,
    sourceIntakeExport,
    charIdToIndex,
    sceneIdToIndex,
    propIdToIndex,
    freeCanvasImportManifest,
    sbPropIds,
  } = collectDramaExportSnapshot(db, storagePath, dramaId, archive);

  // ---- 8. 组装 project.json ----
  // 收集 extra_images 需要打包的文件：{ localRelPath, zipPath }
  const extraFilesToPack = [];
  const panoramaFilesToPack = [];
  const referenceFilesToPack = [];

  const zipData = {
    version: EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    drama: {
      title: drama.title,
      description: drama.description,
      genre: drama.genre,
      style: drama.style,
      status: drama.status,
      tags: drama.tags,
      metadata,
    },
    source_intake: sourceIntakeExport.manifest,
    ...(freeCanvasImportManifest ? { free_canvas_import: freeCanvasImportManifest } : {}),
    episodes: episodes.map(ep => {
      const sbs = storyboardsByEp[ep.id] || [];
      return {
        episode_number: ep.episode_number,
        title: ep.title,
        description: ep.description,
        script_content: ep.script_content,
        duration: ep.duration,
        storyboards: sbs.map(sb => {
          const igsForThis = allImagesBySb[sb.id] || [];
          // 兼容：仍提供 image_file（指向首帧或最新一张），旧版导入器可继续工作
          let mainIg = igsForThis.find(g => g.id === sb.first_frame_image_id) || igsForThis[igsForThis.length - 1];
          const sbImageFile = mainIg?.local_path
            ? `media/storyboards/sb_${sb.id}_gen_${mainIg.id}${extOf(mainIg.local_path)}`
            : null;
          const vg = videosBySb[sb.id];
          const sbVideoFile = vg && vg.local_path ? `media/videos/sb_${sb.id}${extOf(vg.local_path)}` : null;
          const sbAudioFile = sb.audio_local_path
            ? `media/audio/sb_${sb.id}${extOf(sb.audio_local_path)}`
            : null;
          const sbNarrationAudioFile = sb.narration_audio_local_path
            ? `media/audio/sb_${sb.id}_narration${extOf(sb.narration_audio_local_path)}`
            : null;

          // characters: 存储角色在导出列表中的下标（而非原 ID），方便跨项目恢复
          const charIds = parseSbChars(sb.characters);
          const characterIndices = charIds
            .map(id => charIdToIndex[id])
            .filter(idx => idx !== undefined);

          // scene_id: 存储场景在导出列表中的下标
          const sceneIndex = sb.scene_id != null ? (sceneIdToIndex[sb.scene_id] ?? null) : null;

          // prop_ids: 存储道具在导出列表中的下标（storyboard_props 关联）
          const sbPropIdList = sbPropIds[sb.id] || [];
          const propIndices = sbPropIdList
            .map(id => propIdToIndex[id])
            .filter(idx => idx !== undefined);

          const referenceImages = parseStoryboardReferenceImages(sb.reference_images)
            .map((item, index) => {
              const localPath = String(item.local_path || '').trim();
              const imageUrl = String(item.image_url || item.url || '').trim() || null;
              const zipFile = localPath
                ? `media/storyboards/sb_${sb.id}_reference_${index}${extOf(localPath)}`
                : null;
              if (zipFile) referenceFilesToPack.push({ localRelPath: localPath, zipPath: zipFile });
              if (!zipFile && !imageUrl) return null;
              return {
                name: String(item.name || item.filename || `参考图 ${index + 1}`).slice(0, 200),
                image_url: imageUrl,
                zip_file: zipFile,
              };
            })
            .filter(Boolean);

          return {
            storyboard_number: sb.storyboard_number,
            title: sb.title,
            description: sb.description,
            location: sb.location,
            time: sb.time,
            dialogue: sb.dialogue,
            narration: sb.narration || null,
            action: sb.action,
            atmosphere: sb.atmosphere,
            result: sb.result,
            shot_type: sb.shot_type,
            angle: sb.angle,
            angle_h: sb.angle_h || null,
            angle_v: sb.angle_v || null,
            angle_s: sb.angle_s || null,
            movement: sb.movement,
            lighting_style: sb.lighting_style || null,
            depth_of_field: sb.depth_of_field || null,
            image_prompt: sb.image_prompt,
            polished_prompt: sb.polished_prompt || null,
            video_prompt: sb.video_prompt,
            duration: sb.duration,
            emotion: sb.emotion,
            emotion_intensity: sb.emotion_intensity,
            segment_index: sb.segment_index ?? 0,
            segment_title: sb.segment_title || null,
            continuity_snapshot: sb.continuity_snapshot || null,
            creation_mode: sb.creation_mode === 'universal' ? 'universal' : 'classic',
            universal_segment_text: sb.universal_segment_text || null,
            layout_description: sb.layout_description || null,
            // 用 original_id 记录首尾帧绑定的 image_generations 旧ID，导入时映射回新ID
            first_frame_image_original_id: sb.first_frame_image_id ?? null,
            last_frame_image_original_id: sb.last_frame_image_id ?? null,
            video_reference_image_original_id: sb.video_reference_image_id ?? null,
            reference_images: referenceImages,
            last_frame_image_url: sb.last_frame_image_url || null,
            last_frame_local_path: sb.last_frame_local_path || null,
            video_url: vg?.video_url || null,
            video_local_path: vg?.local_path || null,
            video_generation_original_id: vg?.original_id || null,
            character_indices: characterIndices,
            scene_index: sceneIndex,
            prop_indices: propIndices,
            image_file: sbImageFile,
            video_file: sbVideoFile,
            audio_file: sbAudioFile,
            narration_audio_file: sbNarrationAudioFile,
            // 完整分镜图片历史（含首尾帧），导入后可恢复 getSbAllImages + 绑定
            image_generations: igsForThis.map(ig => ({
              original_id: ig.id,
              provider: ig.provider || 'imported',
              prompt: ig.prompt || null,
              negative_prompt: ig.negative_prompt || null,
              model: ig.model || null,
              frame_type: ig.frame_type || null,
              size: ig.size || null,
              quality: ig.quality || null,
              status: ig.status || 'completed',
              error_msg: ig.error_msg || null,
              image_url: ig.image_url || null,
              created_at: ig.created_at || null,
              updated_at: ig.updated_at || null,
              completed_at: ig.completed_at || null,
              zip_file: ig.local_path
                ? `media/storyboards/sb_${sb.id}_gen_${ig.id}${extOf(ig.local_path)}`
                : null,
            })),
            // 首尾帧提示词编辑器保存的专业提示词（含 layout）
            frame_prompts: framePromptsBySb[sb.id] || [],
          };
        }),
      };
    }),
    characters: characters.map((c, idx) => {
      // 收集 extra_images 文件
      const extras = parseExtraImages(c.extra_images);
      const extraFiles = extras.map((relPath, i) => {
        const zipPath = `media/characters/extra_char_${c.id}_${i}${extOf(relPath)}`;
        extraFilesToPack.push({ localRelPath: relPath, zipPath });
        return zipPath;
      });
      return {
        name: c.name,
        role: c.role,
        description: c.description,
        personality: c.personality,
        appearance: c.appearance,
        voice_style: c.voice_style,
        polished_prompt: c.polished_prompt || null,
        image_file: c.local_path ? `media/characters/char_${c.id}${extOf(c.local_path)}` : null,
        extra_image_files: extraFiles,
      };
    }),
    scenes: scenes.map(s => {
      const epIdx = episodeIds.indexOf(s.episode_id);
      const extras = parseExtraImages(s.extra_images);
      const extraFiles = extras.map((relPath, i) => {
        const zipPath = `media/scenes/extra_scene_${s.id}_${i}${extOf(relPath)}`;
        extraFilesToPack.push({ localRelPath: relPath, zipPath });
        return zipPath;
      });
      const panoramaImageFile = s.panorama_local_path
        ? `media/scenes/panorama_scene_${s.id}${extOf(s.panorama_local_path)}`
        : null;
      if (panoramaImageFile) {
        panoramaFilesToPack.push({ localRelPath: s.panorama_local_path, zipPath: panoramaImageFile });
      }
      return {
        location: s.location,
        time: s.time,
        prompt: s.prompt,
        polished_prompt: s.polished_prompt || null,
        episode_index: epIdx >= 0 ? epIdx : null,
        image_file: s.local_path ? `media/scenes/scene_${s.id}${extOf(s.local_path)}` : null,
        panorama_image_url: s.panorama_image_url || null,
        panorama_local_path: s.panorama_local_path || null,
        panorama_image_id: s.panorama_image_id ?? null,
        panorama_image_file: panoramaImageFile,
        extra_image_files: extraFiles,
      };
    }),
    props: props.map(p => {
      const epIdx = episodeIds.indexOf(p.episode_id);
      const extras = parseExtraImages(p.extra_images);
      const extraFiles = extras.map((relPath, i) => {
        const zipPath = `media/props/extra_prop_${p.id}_${i}${extOf(relPath)}`;
        extraFilesToPack.push({ localRelPath: relPath, zipPath });
        return zipPath;
      });
      return {
        name: p.name,
        type: p.type,
        description: p.description,
        prompt: p.prompt,
        episode_index: epIdx >= 0 ? epIdx : null,
        image_file: p.local_path ? `media/props/prop_${p.id}${extOf(p.local_path)}` : null,
        extra_image_files: extraFiles,
      };
    }),
  };

  // ---- 9. 打包 ZIP ----
  const projectJson = JSON.stringify(sanitizeProjectExport(zipData), null, 2);
  const projectJsonBytes = Buffer.byteLength(projectJson, 'utf8');
  archive.assertCanAdd('project.json', projectJsonBytes);
  archive.addBuffer('project.json', Buffer.from(projectJson, 'utf8'));

  // 分镜图片完整历史（含首尾帧 first/last 专用图 + 所有历史生成）
  for (const { localRelPath, zipPath } of imageFilesToPack) {
    if (archive.archivePaths.has(zipPath)) continue;
    archive.addStorageFile(storagePath, localRelPath, zipPath);
  }

  // 分镜视频
  for (const [sbId, vg] of Object.entries(videosBySb)) {
    if (vg.local_path) {
      const archivePath = `media/videos/sb_${sbId}${extOf(vg.local_path)}`;
      if (archive.archivePaths.has(archivePath)) continue;
      archive.addStorageFile(
        storagePath,
        vg.local_path,
        archivePath
      );
    }
  }

  // 分镜对白 TTS / 解说旁白 TTS（分字段存储）
  for (const ep of episodes) {
    for (const sb of storyboardsByEp[ep.id] || []) {
      if (sb.audio_local_path) {
        archive.addStorageFile(
          storagePath,
          sb.audio_local_path,
          `media/audio/sb_${sb.id}${extOf(sb.audio_local_path)}`
        );
      }
      if (sb.narration_audio_local_path) {
        archive.addStorageFile(
          storagePath,
          sb.narration_audio_local_path,
          `media/audio/sb_${sb.id}_narration${extOf(sb.narration_audio_local_path)}`
        );
      }
    }
  }

  // 角色主图
  for (const c of characters) {
    if (c.local_path) {
      archive.addStorageFile(
        storagePath,
        c.local_path,
        `media/characters/char_${c.id}${extOf(c.local_path)}`
      );
    }
  }

  // 场景主图
  for (const s of scenes) {
    if (s.local_path) {
      archive.addStorageFile(
        storagePath,
        s.local_path,
        `media/scenes/scene_${s.id}${extOf(s.local_path)}`
      );
    }
  }

  // 分镜自由参考图（独立于 image_generations）
  for (const { localRelPath, zipPath } of referenceFilesToPack) {
    archive.addStorageFile(storagePath, localRelPath, zipPath);
  }

  // 场景全景图
  for (const { localRelPath, zipPath } of panoramaFilesToPack) {
    archive.addStorageFile(storagePath, localRelPath, zipPath);
  }

  // 道具主图
  for (const p of props) {
    if (p.local_path) {
      archive.addStorageFile(
        storagePath,
        p.local_path,
        `media/props/prop_${p.id}${extOf(p.local_path)}`
      );
    }
  }

  // extra_images（角色/场景/道具的额外参考图）
  for (const { localRelPath, zipPath } of extraFilesToPack) {
    archive.addStorageFile(storagePath, localRelPath, zipPath);
  }

  // Every manifest descriptor was bound to and archived from the exact bytes before project.json.
  for (const media of freeCanvasImportManifest?.media || []) {
    if (!archive.archivePaths.has(media.archive_path)) {
      throw exportError(
        'FREE_CANVAS_MEDIA_MISSING',
        '项目导出在完成压缩包前丢失了引用的自由画布媒体，请重试。',
        { source_path: media.source_path },
        500
      );
    }
  }

  log.info('Drama exported', {
    drama_id: dramaId,
    title: drama.title,
    source_original_count: sourceIntakeExport.manifest.sources.length,
    export_file_count: archive.fileCount,
    export_uncompressed_bytes: archive.totalUncompressedBytes,
  });
  return { buffer: archive.toBuffer(), title: drama.title };
}

module.exports = {
  DEFAULT_EXPORT_LIMITS,
  DramaExportError,
  exportDrama,
  normalizeExportLimits,
  resolveExportLimits,
};
