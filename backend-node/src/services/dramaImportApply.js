// 项目导入实体还原编排：写入剧集、角色、场景、道具、分镜并挂接画布
const storageLayout = require('./storageLayout');
const { freeCanvasSourceDramaId } = require('./dramaImportManifest');
const {
  buildLegacyImportedFreeCanvasMaps,
  createImportedFreeCanvasMaps,
} = require('./dramaImportRestore');
const {
  restoreSourceIntakeOriginals,
  restoreStoryboardReferenceImages,
  saveExtraImages,
  saveMediaFile,
} = require('./dramaImportMedia');
const {
  buildPortableImportedFreeCanvasMaps,
  restoreImportedFreeCanvas,
} = require('./dramaImportCanvas');

/**
 * 生成不重名的剧集标题
 */
function resolveTitle(db, baseTitle) {
  const existing = db.prepare('SELECT title FROM dramas WHERE deleted_at IS NULL').all().map(r => r.title);
  if (!existing.includes(baseTitle)) return baseTitle;
  let i = 1;
  while (existing.includes(`${baseTitle} 导入${i}`)) i++;
  return `${baseTitle} 导入${i}`;
}

const IMPORT_FIRST_FRAME_TYPES = ['storyboard_first', 'first', 'first_frame'];
const IMPORT_LAST_FRAME_TYPES = ['storyboard_last', 'last', 'tail', 'last_frame'];

/** 老版 ZIP 或未写入 frame_prompts 时，从已导入的首尾帧图生记录回填提示词 */
function restoreFramePromptsFromImageGens(db, sbId, now, log) {
  const insFp = db.prepare(
    'INSERT INTO frame_prompts (storyboard_id, frame_type, prompt, description, layout, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  for (const [types, frameType] of [[IMPORT_FIRST_FRAME_TYPES, 'first'], [IMPORT_LAST_FRAME_TYPES, 'last']]) {
    const has = db.prepare('SELECT id FROM frame_prompts WHERE storyboard_id = ? AND frame_type = ?').get(sbId, frameType);
    if (has) continue;
    const ph = types.map(() => '?').join(',');
    const ig = db.prepare(
      `SELECT prompt FROM image_generations WHERE storyboard_id = ? AND deleted_at IS NULL
       AND frame_type IN (${ph}) AND prompt IS NOT NULL AND TRIM(prompt) != ''
       ORDER BY created_at DESC LIMIT 1`
    ).get(sbId, ...types);
    if (ig?.prompt?.trim()) {
      insFp.run(sbId, frameType, ig.prompt.trim(), null, null, now, now);
      try { log?.info?.('[导入] 从分镜图历史恢复帧提示词', { storyboard_id: sbId, frame_type: frameType }); } catch (_) {}
    }
  }
}

function applyImportedDrama(
  db,
  storagePath,
  files,
  data,
  d,
  title,
  metaStr,
  now,
  log,
  sourceIntakeEntries = [],
  sourceStorageOptions = {}
) {

  // ---- 创建 drama ----
  const dramaInfo = db.prepare(
    `INSERT INTO dramas (title, description, genre, style, status, tags, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    title,
    d.description || null,
    d.genre || null,
    d.style || null,
    d.status || 'draft',
    d.tags || null,
    metaStr,
    now,
    now
  );
  const dramaId = dramaInfo.lastInsertRowid;
  const projectDir = storageLayout.buildProjectRelativeDir({
    id: dramaId,
    title,
    created_at: now,
    metadata: metaStr,
  });
  const importedMetadata = JSON.parse(metaStr);
  const importedStoryboardIds = [];
  const importedImages = new Map();
  const importedVideos = new Map();

  restoreSourceIntakeOriginals(
    db,
    storagePath,
    files,
    dramaId,
    sourceIntakeEntries,
    sourceStorageOptions
  );

  // ---- 导入角色 ----
  const charNewIds = []; // 按导出顺序保存新角色 id，用于恢复分镜 character_indices
  for (let i = 0; i < (data.characters || []).length; i++) {
    const c = data.characters[i];
    if (!c.name) { charNewIds.push(null); continue; }
    const localPath = saveMediaFile(storagePath, projectDir, 'characters', files, c.image_file, 'char_imp');
    const extraImagesJson = saveExtraImages(storagePath, projectDir, 'characters', files, c.extra_image_files, 'char_extra_imp');
    const info = db.prepare(
      `INSERT INTO characters (drama_id, name, role, description, personality, appearance, voice_style, polished_prompt, local_path, extra_images, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(dramaId, c.name, c.role || null, c.description || null, c.personality || null, c.appearance || null, c.voice_style || null, c.polished_prompt || null, localPath, extraImagesJson, i, now, now);
    charNewIds.push(info.lastInsertRowid);
  }

  // ---- 导入剧集（先建好所有集，再关联角色/场景/道具） ----
  const episodeIdList = []; // 按顺序保存新集 id
  for (const ep of (data.episodes || [])) {
    const epInfo = db.prepare(
      `INSERT INTO episodes (drama_id, episode_number, title, description, script_content, duration, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(dramaId, ep.episode_number || 1, ep.title || `第${ep.episode_number || 1}集`, ep.description || null, ep.script_content || null, ep.duration || 0, now, now);
    episodeIdList.push(epInfo.lastInsertRowid);
  }

  // ---- 关联角色到所有集（episode_characters） ----
  if (charNewIds.length > 0 && episodeIdList.length > 0) {
    const insEC = db.prepare('INSERT OR IGNORE INTO episode_characters (episode_id, character_id) VALUES (?, ?)');
    for (const charId of charNewIds) {
      if (!charId) continue;
      for (const epId of episodeIdList) {
        try { insEC.run(epId, charId); } catch (_) {}
      }
    }
  }

  // ---- 导入场景（逐条保留实体身份，供分镜 scene_index 精确恢复）----
  const sceneNewIds = [];
  for (let i = 0; i < (data.scenes || []).length; i++) {
    const s = data.scenes[i];
    const epIdx = s.episode_index;
    const epId = (epIdx != null && epIdx >= 0 && episodeIdList[epIdx])
      ? episodeIdList[epIdx]
      : (episodeIdList[0] || null);
    const localPath = saveMediaFile(storagePath, projectDir, 'scenes', files, s.image_file, 'scene_imp');
    const panoramaLocalPath = saveMediaFile(
      storagePath, projectDir, 'scenes', files, s.panorama_image_file, 'scene_panorama_imp'
    );
    const panoramaImageUrl = panoramaLocalPath
      ? `/static/${panoramaLocalPath.replace(/^\//, '')}`
      : null;
    const extraImagesJson = saveExtraImages(storagePath, projectDir, 'scenes', files, s.extra_image_files, 'scene_extra_imp');
    const info = db.prepare(
      `INSERT INTO scenes
       (drama_id, episode_id, location, time, prompt, polished_prompt, local_path,
        panorama_image_url, panorama_local_path, panorama_image_id, extra_images, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
    ).run(
      dramaId, epId, s.location || '', s.time || '', s.prompt || '', s.polished_prompt || null,
      localPath, panoramaImageUrl, panoramaLocalPath, extraImagesJson, now, now
    );
    const sceneId = info.lastInsertRowid;
    if (panoramaImageUrl || panoramaLocalPath) {
      const generation = db.prepare(
        `INSERT INTO image_generations
         (drama_id, scene_id, provider, prompt, frame_type, image_url, local_path,
          status, completed_at, created_at, updated_at)
         VALUES (?, ?, 'imported', ?, 'scene_panorama', ?, ?, 'completed', ?, ?, ?)`
      ).run(
        dramaId, sceneId, 'Imported scene panorama', panoramaImageUrl, panoramaLocalPath,
        now, now, now
      );
      db.prepare('UPDATE scenes SET panorama_image_id = ? WHERE id = ?').run(generation.lastInsertRowid, sceneId);
    }
    sceneNewIds.push(sceneId);
  }

  // ---- 导入道具（带 episode_id） ----
  const propNewIds = []; // 按导出顺序保存新道具 id，用于恢复 storyboard_props
  for (const p of (data.props || [])) {
    if (!p.name) { propNewIds.push(null); continue; }
    const epIdx = p.episode_index;
    const epId = (epIdx != null && epIdx >= 0 && episodeIdList[epIdx])
      ? episodeIdList[epIdx]
      : (episodeIdList[0] || null);
    const localPath = saveMediaFile(storagePath, projectDir, 'props', files, p.image_file, 'prop_imp');
    const extraImagesJson = saveExtraImages(storagePath, projectDir, 'props', files, p.extra_image_files, 'prop_extra_imp');
    const pInfo = db.prepare(
      `INSERT INTO props (drama_id, episode_id, name, type, description, prompt, local_path, extra_images, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(dramaId, epId, p.name, p.type || null, p.description || null, p.prompt || null, localPath, extraImagesJson, now, now);
    propNewIds.push(pInfo.lastInsertRowid);
  }

  // ---- 导入分镜 ----
  for (let epIdx = 0; epIdx < (data.episodes || []).length; epIdx++) {
    const ep = data.episodes[epIdx];
    const episodeId = episodeIdList[epIdx];
    if (!episodeId) continue;

    for (const sb of (ep.storyboards || [])) {
      const sbAudioPath = saveMediaFile(storagePath, projectDir, 'audio', files, sb.audio_file, 'sb_audio_imp');
      const sbNarrationAudioPath = saveMediaFile(storagePath, projectDir, 'audio', files, sb.narration_audio_file, 'sb_narr_audio_imp');
      const sbVideoLocalPath = saveMediaFile(storagePath, projectDir, 'videos', files, sb.video_file, 'vid_imp');
      const sbReferenceImages = restoreStoryboardReferenceImages(
        storagePath,
        projectDir,
        files,
        sb.reference_images
      );

      // 还原 characters：从导出时记录的下标映射回新 ID
      const charIndices = Array.isArray(sb.character_indices) ? sb.character_indices : [];
      const sbCharIds = charIndices
        .map(idx => charNewIds[idx])
        .filter(id => id != null);
      const charactersJson = JSON.stringify(sbCharIds);

      // 还原 scene_id：从导出时记录的下标映射回新 ID
      const sbSceneId = (sb.scene_index != null && sceneNewIds[sb.scene_index])
        ? sceneNewIds[sb.scene_index]
        : null;

      // 还原 prop_ids：从导出时记录的下标映射回新 ID
      const propIndices = Array.isArray(sb.prop_indices) ? sb.prop_indices : [];
      const sbPropNewIds = propIndices
        .map(idx => propNewIds[idx])
        .filter(id => id != null);

      // 先插入分镜（首尾帧绑定ID、layout 稍后更新；image_url/local_path 由绑定逻辑设置）
      // 使用并行数组维护列名与值，确保列数与传参数量永远一致，避免“44 values for 43 columns”类错误
      const sbCols = [
        'episode_id', 'scene_id', 'storyboard_number', 'title', 'description', 'location', 'time',
        'dialogue', 'narration', 'action', 'atmosphere', 'result', 'shot_type', 'angle', 'angle_h', 'angle_v', 'angle_s',
        'movement', 'lighting_style', 'depth_of_field', 'image_prompt', 'polished_prompt', 'video_prompt', 'duration',
        'emotion', 'emotion_intensity', 'segment_index', 'segment_title', 'continuity_snapshot', 'creation_mode',
        'universal_segment_text', 'layout_description', 'first_frame_image_id', 'last_frame_image_id',
        'last_frame_image_url', 'last_frame_local_path', 'image_url', 'local_path', 'video_url', 'video_local_path',
        'reference_images', 'video_reference_image_id', 'characters',
        'audio_local_path', 'narration_audio_local_path', 'created_at', 'updated_at'
      ];
      const sbVals = [
        episodeId,
        sbSceneId,
        sb.storyboard_number || 1,
        sb.title || null,
        sb.description || null,
        sb.location || null,
        sb.time || null,
        sb.dialogue || null,
        sb.narration || null,
        sb.action || null,
        sb.atmosphere || null,
        sb.result || null,
        sb.shot_type || null,
        sb.angle || null,
        sb.angle_h || null,
        sb.angle_v || null,
        sb.angle_s || null,
        sb.movement || null,
        sb.lighting_style || null,
        sb.depth_of_field || null,
        sb.image_prompt || null,
        sb.polished_prompt || null,
        sb.video_prompt || null,
        sb.duration || 0,
        sb.emotion || null,
        sb.emotion_intensity != null ? sb.emotion_intensity : null,
        sb.segment_index ?? 0,
        sb.segment_title || null,
        sb.continuity_snapshot || null,
        sb.creation_mode === 'universal' ? 'universal' : 'classic',
        sb.universal_segment_text || null,
        sb.layout_description || null,
        null, // first_frame_image_id 后设
        null, // last_frame_image_id 后设
        null, // 仅从 ZIP 内实际尾帧绑定恢复
        null,
        null, // image_url 由首帧绑定设置
        null, // local_path 由首帧绑定设置
        null, // 不信任归档中未携带本地副本的远程视频
        sbVideoLocalPath || null,
        sbReferenceImages,
        null, // video_reference_image_id 后按 image_generations 新 ID 恢复
        charactersJson,
        sbAudioPath || null,
        sbNarrationAudioPath || null,
        now,
        now
      ];
      if (sbCols.length !== sbVals.length) {
        throw new Error('分镜导入数据列数不匹配，请重新导出后再导入');
      }
      const sbInfo = db.prepare(
        `INSERT INTO storyboards (${sbCols.join(', ')})
         VALUES (${sbCols.map(() => '?').join(', ')})`
      ).run(...sbVals);
      const sbId = sbInfo.lastInsertRowid;
      importedStoryboardIds.push(Number(sbId));

      // 还原 storyboard_props（分镜与道具的关联）
      if (sbPropNewIds.length > 0) {
        const insSP = db.prepare('INSERT OR IGNORE INTO storyboard_props (storyboard_id, prop_id) VALUES (?, ?)');
        for (const pid of sbPropNewIds) insSP.run(sbId, pid);
      }

      // 还原帧提示词（首尾帧/关键帧专用提示词 + layout 合同，必须恢复）
      if (Array.isArray(sb.frame_prompts) && sb.frame_prompts.length > 0) {
        const insFp = db.prepare('INSERT INTO frame_prompts (storyboard_id, frame_type, prompt, description, layout, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
        for (const fp of sb.frame_prompts) {
          insFp.run(sbId, fp.frame_type || 'first', fp.prompt || '', fp.description || null, fp.layout || null, fp.created_at || now, fp.updated_at || now);
        }
        try { require('../logger').info?.('[导入] 已恢复帧提示词', { storyboard_id: sbId, count: sb.frame_prompts.length }); } catch (_) {}
      }

      // 导入分镜图片完整历史（新版 v1.4+ 的 image_generations 数组；老版回退单张）
      const genOldToNew = new Map(); // original_id -> {newId, localPath}
      if (Array.isArray(sb.image_generations) && sb.image_generations.length > 0) {
        for (const gen of sb.image_generations) {
          const genLocalPath = saveMediaFile(storagePath, projectDir, 'images', files, gen.zip_file || gen.file, 'sb_imp_gen');
          const genImageUrl = null;
          if (genLocalPath) {
            const genInfo = db.prepare(
              `INSERT INTO image_generations (drama_id, storyboard_id, provider, prompt, negative_prompt, model, frame_type, size, quality, status, error_msg, image_url, local_path, created_at, updated_at, completed_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(
              dramaId,
              sbId,
              gen.provider || 'imported',
              gen.prompt || sb.image_prompt || '',
              gen.negative_prompt || null,
              gen.model || null,
              gen.frame_type || null,
              gen.size || null,
              gen.quality || null,
              gen.status || 'completed',
              gen.error_msg || null,
              genImageUrl,
              genLocalPath,
              gen.created_at || now,
              now,
              gen.completed_at || now
            );
            const newGenId = genInfo.lastInsertRowid;
            if (gen.original_id != null) {
              const restoredGeneration = {
                newId: newGenId,
                localPath: genLocalPath,
                archivePath: gen.zip_file || gen.file || null,
                imageUrl: genImageUrl,
                frameType: gen.frame_type || null,
                status: gen.status || 'completed',
              };
              genOldToNew.set(Number(gen.original_id), restoredGeneration);
              importedImages.set(Number(gen.original_id), restoredGeneration);
            }
          }
        }
      } else {
        // 老版兼容：仅单张 image_file（导入后只有这一个历史图，首尾帧绑定丢失是旧行为）
        const sbImagePath = saveMediaFile(storagePath, projectDir, 'images', files, sb.image_file, 'sb_imp');
        if (sbImagePath) {
          db.prepare(
            `INSERT INTO image_generations (drama_id, storyboard_id, provider, prompt, status, local_path, created_at, updated_at)
             VALUES (?, ?, 'imported', ?, 'completed', ?, ?, ?)`
          ).run(dramaId, sbId, sb.image_prompt || '', sbImagePath, now, now);
        }
      }

      // 导入视频（仍保持单条最新，视频首尾帧 URL 由生成时绑定）
      if (sbVideoLocalPath) {
        const videoInfo = db.prepare(
          `INSERT INTO video_generations
           (drama_id, storyboard_id, provider, prompt, status, video_url, local_path, created_at, updated_at, completed_at)
           VALUES (?, ?, 'imported', ?, 'completed', ?, ?, ?, ?, ?)`
        ).run(dramaId, sbId, sb.video_prompt || '', null, sbVideoLocalPath, now, now, now);
        const sourceVideoGenerationId = Number(sb.video_generation_original_id);
        if (Number.isSafeInteger(sourceVideoGenerationId) && sourceVideoGenerationId > 0) {
          importedVideos.set(sourceVideoGenerationId, {
            newId: Number(videoInfo.lastInsertRowid),
            localPath: sbVideoLocalPath,
            archivePath: sb.video_file || null,
            storyboardId: Number(sbId),
          });
        }
      }

      // 绑定首尾帧到 storyboards（关键：恢复 first_frame_image_id + image_url/local_path，以及 last_*）
      const now2 = new Date().toISOString();
      const firstOld = sb.first_frame_image_original_id ?? sb.first_frame_image_id;
      const lastOld = sb.last_frame_image_original_id ?? sb.last_frame_image_id;
      let boundFirst = false, boundLast = false;
      if (firstOld != null && genOldToNew.has(Number(firstOld))) {
        const { newId, localPath, imageUrl } = genOldToNew.get(Number(firstOld));
        db.prepare(
          `UPDATE storyboards SET image_url = ?, local_path = ?, first_frame_image_id = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`
        ).run(imageUrl, localPath, newId, now2, sbId);
        boundFirst = true;
      }
      if (lastOld != null && genOldToNew.has(Number(lastOld))) {
        const { newId, localPath, imageUrl } = genOldToNew.get(Number(lastOld));
        db.prepare(
          `UPDATE storyboards SET last_frame_image_url = ?, last_frame_local_path = ?, last_frame_image_id = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`
        ).run(imageUrl, localPath, newId, now2, sbId);
        boundLast = true;
      }
      const videoReferenceOld = sb.video_reference_image_original_id;
      if (videoReferenceOld != null && genOldToNew.has(Number(videoReferenceOld))) {
        const restoredReference = genOldToNew.get(Number(videoReferenceOld));
        if (
          restoredReference.status === 'completed' &&
          ['quad_grid', 'nine_grid'].includes(restoredReference.frameType)
        ) {
          db.prepare(
            'UPDATE storyboards SET video_reference_image_id = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
          ).run(restoredReference.newId, now2, sbId);
        }
      }
      if ((sb.image_generations && sb.image_generations.length) || boundFirst || boundLast) {
        try {
          require('../logger').info?.('[导入] 分镜图片历史+首尾帧绑定完成', {
            storyboard_id: sbId,
            gens_restored: genOldToNew.size,
            first_bound: boundFirst,
            last_bound: boundLast,
            had_original_first: firstOld != null,
            had_original_last: lastOld != null
          });
        } catch (_) {}
      }

      // 兼容老工程：ZIP 无 frame_prompts 时，用已导入的首/尾帧图生 prompt 回填
      restoreFramePromptsFromImageGens(db, sbId, now2, log);
    }
  }

  if (importedMetadata.free_canvas !== undefined) {
    if (
      importedMetadata.free_canvas
      && typeof importedMetadata.free_canvas === 'object'
      && !Array.isArray(importedMetadata.free_canvas)
      && importedMetadata.free_canvas.version === 1
      && Array.isArray(importedMetadata.free_canvas.nodes)
      && Array.isArray(importedMetadata.free_canvas.edges)
    ) {
      const sourceDramaId = freeCanvasSourceDramaId(importedMetadata.free_canvas, dramaId);
      const imported = {
        data,
        metadata: importedMetadata,
        storagePath,
        projectDir,
        files,
        episodeIds: episodeIdList,
        storyboardIds: importedStoryboardIds,
        sceneIds: sceneNewIds,
        images: importedImages,
        videos: importedVideos,
      };
      const maps = data.free_canvas_import !== undefined
        ? buildPortableImportedFreeCanvasMaps(db, dramaId, imported, now)
        : buildLegacyImportedFreeCanvasMaps(sourceDramaId, imported);
      restoreImportedFreeCanvas(db, dramaId, importedMetadata, maps, now);
    } else {
      restoreImportedFreeCanvas(db, dramaId, importedMetadata, createImportedFreeCanvasMaps(), now);
    }
  }

  log.info('Drama imported', { drama_id: dramaId, title });
  return {
    drama_id: dramaId,
    title,
    project_dir: projectDir,
    source_original_dir: sourceIntakeEntries.length ? `story_sources/${dramaId}` : null,
  };
}

module.exports = {
  applyImportedDrama,
  resolveTitle,
};
