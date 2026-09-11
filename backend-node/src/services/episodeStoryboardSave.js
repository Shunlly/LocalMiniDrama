/**
 * 分集分镜保存：将 AI 分镜写入 storyboards，并按 storyboard_id 重建视频提示词。
 */

const dramaWriteGuard = require('./dramaWriteGuard');
const { normalizeStoryboardShotNumber } = require('./episodeStoryboardOrdering');
const {
  generateVideoPrompt,
  deriveStoryboardFieldsFromAi,
} = require('./episodeStoryboardGeneration');

/** 用最终解析的分镜对象覆盖已存在的行（修正流式增量先入库时缺 narration 等字段的问题） */
function updateStoryboardRowFromDerived(db, existingId, episodeIdNum, d, sb, now) {
  db.prepare(
    `UPDATE storyboards SET
      scene_id = ?, title = ?, description = ?, location = ?, time = ?, duration = ?,
      dialogue = ?, narration = ?, action = ?, result = ?, atmosphere = ?,
      image_prompt = ?, video_prompt = ?, characters = ?,
      shot_type = ?, angle = ?, angle_h = ?, angle_v = ?, angle_s = ?, movement = ?,
      lighting_style = ?, depth_of_field = ?, segment_index = ?, segment_title = ?,
      creation_mode = ?, universal_segment_text = ?,
      updated_at = ?
     WHERE id = ? AND episode_id = ? AND deleted_at IS NULL`
  ).run(
    d.sceneId,
    d.title || null,
    d.description,
    sb.location ?? null,
    sb.time ?? null,
    sb.duration ?? 5,
    d.dialogue || null,
    d.narration || null,
    d.action || null,
    d.result || null,
    sb.atmosphere ?? null,
    d.imagePrompt,
    d.videoPrompt,
    d.charactersJson,
    d.shotType || null,
    d.angle,
    d.angleH,
    d.angleV,
    d.angleS,
    d.movement || null,
    d.lightingStyle,
    d.depthOfField,
    d.segmentIndex,
    d.segmentTitle,
    d.creationMode || 'classic',
    d.universalSegmentText != null ? d.universalSegmentText : null,
    now,
    existingId,
    episodeIdNum
  );
  try {
    db.prepare('DELETE FROM storyboard_props WHERE storyboard_id = ?').run(existingId);
    if (d.propIds.length > 0) {
      const insProp = db.prepare('INSERT OR IGNORE INTO storyboard_props (storyboard_id, prop_id) VALUES (?, ?)');
      for (const pid of d.propIds) insProp.run(existingId, pid);
    }
  } catch (_) {}
}

/**
 * 将单个分镜对象插入 DB。
 * 返回插入后的 id，出错则返回 null（不抛异常）。
 */
function insertOneStoryboard(db, episodeIdNum, sb, style, videoRatio, now, deriveOpts = {}) {
  const d = deriveStoryboardFieldsFromAi(sb, style, videoRatio, deriveOpts);
  const shotNumber = d.shotNumber;
  try {
    db.prepare(
      `INSERT INTO storyboards (episode_id, scene_id, storyboard_number, title, description, location, time, duration, dialogue, narration, action, result, atmosphere, image_prompt, video_prompt, characters, shot_type, angle, angle_h, angle_v, angle_s, movement, lighting_style, depth_of_field, segment_index, segment_title, creation_mode, universal_segment_text, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
    ).run(
      episodeIdNum, d.sceneId, shotNumber, d.title || null, d.description,
      sb.location ?? null, sb.time ?? null, sb.duration ?? 5,
      d.dialogue || null, d.narration || null, d.action || null, d.result || null, sb.atmosphere ?? null,
      d.imagePrompt, d.videoPrompt, d.charactersJson,
      d.shotType || null, d.angle, d.angleH, d.angleV, d.angleS,
      d.movement || null, d.lightingStyle, d.depthOfField, d.segmentIndex, d.segmentTitle,
      d.creationMode || 'classic',
      d.universalSegmentText != null ? d.universalSegmentText : null,
      now, now
    );
    const newId = db.prepare('SELECT last_insert_rowid() as id').get().id;
    if (d.propIds.length > 0) {
      try {
        const insProp = db.prepare('INSERT OR IGNORE INTO storyboard_props (storyboard_id, prop_id) VALUES (?, ?)');
        for (const pid of d.propIds) insProp.run(newId, pid);
      } catch (_) {}
    }
    return newId;
  } catch (_) {
    return null;
  }
}

/**
 * @param {Set|null} skipShotNumbers - 已通过增量流式保存的 storyboard_number 集合，跳过重复插入
 */
function saveStoryboards(db, log, episodeId, storyboards, cfg, styleOverride, skipShotNumbers = null, deriveOpts = {}) {
  const episodeIdNum = Number(episodeId);
  if (storyboards.length === 0) {
    throw new Error('AI生成分镜失败：返回的分镜数量为0');
  }
  const style = (styleOverride && String(styleOverride).trim()) || cfg?.style?.default_style || '';
  const videoRatio = cfg?.style?.default_video_ratio || '16:9';
  const now = new Date().toISOString();

  // 全量替换必须由调用方放在事务中，确保旧分镜与新分镜一起提交或回滚。
  if (skipShotNumbers === null) {
    const existing = db.prepare('SELECT id FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL').all(episodeIdNum);
    if (existing.length > 0) {
      db.prepare('UPDATE storyboards SET deleted_at = ? WHERE episode_id = ?').run(now, episodeIdNum);
    }
  }

  const saved = [];
  const processedInSave = new Set();
  for (const sb of storyboards) {
    const shotNumber = normalizeStoryboardShotNumber(sb);
    if (shotNumber > 0 && processedInSave.has(shotNumber)) {
      log.warn('Duplicate storyboard_number in final AI batch, skipping extra row', {
        episode_id: episodeIdNum,
        storyboard_number: shotNumber,
      });
      continue;
    }

    // 已由增量流式保存过的分镜：必须用**最终完整 JSON** 再 UPDATE 一行（否则首镜常在流式阶段缺 narration 等字段且永不修正）
    if (skipShotNumbers && skipShotNumbers.has(shotNumber)) {
      const existing = db.prepare(
        'SELECT * FROM storyboards WHERE episode_id = ? AND storyboard_number = ? AND deleted_at IS NULL'
      ).get(episodeIdNum, shotNumber);
      if (existing) {
        const d = deriveStoryboardFieldsFromAi(sb, style, videoRatio, deriveOpts);
        updateStoryboardRowFromDerived(db, existing.id, episodeIdNum, d, sb, now);
        log.info('Storyboard merged from final parse after incremental save', {
          episode_id: episodeIdNum,
          storyboard_id: existing.id,
          storyboard_number: shotNumber,
        });
        const refreshed = db.prepare(
          'SELECT * FROM storyboards WHERE id = ? AND deleted_at IS NULL'
        ).get(existing.id);
        let propIds = [];
        try {
          const propLinks = db.prepare('SELECT prop_id FROM storyboard_props WHERE storyboard_id = ?').all(refreshed.id);
          propIds = propLinks.map((p) => p.prop_id);
        } catch (_) {}
        saved.push({
          id: refreshed.id,
          episode_id: episodeIdNum,
          scene_id: refreshed.scene_id,
          storyboard_number: shotNumber,
          title: refreshed.title,
          description: refreshed.description,
          location: refreshed.location,
          time: refreshed.time,
          duration: refreshed.duration,
          dialogue: refreshed.dialogue,
          narration: refreshed.narration ?? null,
          action: refreshed.action,
          result: refreshed.result,
          atmosphere: refreshed.atmosphere,
          image_prompt: refreshed.image_prompt,
          video_prompt: refreshed.video_prompt,
          shot_type: refreshed.shot_type,
          angle: refreshed.angle,
          movement: refreshed.movement,
          segment_index: refreshed.segment_index ?? 0,
          segment_title: refreshed.segment_title ?? null,
          creation_mode: refreshed.creation_mode === 'universal' ? 'universal' : 'classic',
          universal_segment_text: refreshed.universal_segment_text ?? null,
          characters: (() => { try { return JSON.parse(refreshed.characters || '[]'); } catch (_) { return []; } })(),
          prop_ids: propIds,
          status: refreshed.status,
          created_at: refreshed.created_at,
          updated_at: refreshed.updated_at,
        });
        if (shotNumber > 0) processedInSave.add(shotNumber);
        continue;
      }
      // 流式阶段已登记镜号但库中无行（竞态/异常）：不再 INSERT 重复行
      if (shotNumber > 0) {
        log.warn('Incremental shot missing in DB at final save, skipping insert', {
          episode_id: episodeIdNum,
          storyboard_number: shotNumber,
        });
        continue;
      }
    }

    const d = deriveStoryboardFieldsFromAi(sb, style, videoRatio, deriveOpts);

    try {
      db.prepare(
        `INSERT INTO storyboards (episode_id, scene_id, storyboard_number, title, description, location, time, duration, dialogue, narration, action, result, atmosphere, image_prompt, video_prompt, characters, shot_type, angle, angle_h, angle_v, angle_s, movement, lighting_style, depth_of_field, segment_index, segment_title, creation_mode, universal_segment_text, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
      ).run(
        episodeIdNum, d.sceneId, shotNumber, d.title || null, d.description,
        sb.location ?? null, sb.time ?? null, sb.duration ?? 5,
        d.dialogue || null, d.narration || null, d.action || null, d.result || null, sb.atmosphere ?? null,
        d.imagePrompt, d.videoPrompt, d.charactersJson,
        d.shotType || null, d.angle, d.angleH, d.angleV, d.angleS,
        d.movement || null, d.lightingStyle, d.depthOfField, d.segmentIndex, d.segmentTitle,
        d.creationMode || 'classic',
        d.universalSegmentText != null ? d.universalSegmentText : null,
        now, now
      );
    } catch (e) {
      if ((e.message || '').includes('shot_type') || (e.message || '').includes('angle') || (e.message || '').includes('movement') || (e.message || '').includes('result') || (e.message || '').includes('segment') || (e.message || '').includes('narration')) {
        db.prepare(
          `INSERT INTO storyboards (episode_id, scene_id, storyboard_number, title, description, location, time, duration, dialogue, action, atmosphere, image_prompt, video_prompt, characters, creation_mode, universal_segment_text, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
        ).run(
          episodeIdNum, d.sceneId, shotNumber, d.title || null, d.description,
          sb.location ?? null, sb.time ?? null, sb.duration ?? 5,
          d.dialogue || null, d.action || null, sb.atmosphere ?? null,
          d.imagePrompt, d.videoPrompt, d.charactersJson,
          d.creationMode || 'classic',
          d.universalSegmentText != null ? d.universalSegmentText : null,
          now, now
        );
      } else {
        throw e;
      }
    }
    const id = db.prepare('SELECT last_insert_rowid() as id').get().id;
    if (d.propIds.length > 0) {
      try {
        const insProp = db.prepare('INSERT OR IGNORE INTO storyboard_props (storyboard_id, prop_id) VALUES (?, ?)');
        for (const pid of d.propIds) insProp.run(id, pid);
      } catch (_) {}
    }
    saved.push({
      id,
      episode_id: episodeIdNum,
      scene_id: d.sceneId,
      storyboard_number: shotNumber,
      title: d.title || null,
      description: d.description,
      location: sb.location ?? null,
      time: sb.time ?? null,
      duration: sb.duration ?? 5,
      dialogue: d.dialogue || null,
      narration: d.narration || null,
      action: d.action || null,
      result: d.result || null,
      atmosphere: sb.atmosphere ?? null,
      image_prompt: d.imagePrompt,
      video_prompt: d.videoPrompt,
      shot_type: d.shotType || null,
      angle: d.angle,
      movement: d.movement || null,
      segment_index: d.segmentIndex,
      segment_title: d.segmentTitle,
      creation_mode: d.creationMode || 'classic',
      universal_segment_text: d.universalSegmentText != null ? d.universalSegmentText : null,
      characters: Array.isArray(sb.characters) ? sb.characters : [],
      prop_ids: d.propIds,
      status: 'pending',
      created_at: now,
      updated_at: now,
    });
    if (shotNumber > 0) processedInSave.add(shotNumber);
  }
  log.info('Storyboards saved', { episode_id: episodeId, count: saved.length });
  return saved;
}

function rebuildVideoPromptForStoryboard(db, log, storyboardId) {
  const sbId = Number(storyboardId);
  if (!Number.isFinite(sbId) || sbId <= 0) return null;
  if (!dramaWriteGuard.canReadResource(db, 'storyboards', sbId)) return null;

  const row = db.prepare(
    `SELECT s.*, e.drama_id
     FROM storyboards s
     JOIN episodes e ON e.id = s.episode_id AND e.deleted_at IS NULL
     WHERE s.id = ? AND s.deleted_at IS NULL`
  ).get(sbId);
  if (!row) return null;

  const loadConfig = require('../config').loadConfig;
  const cfg = loadConfig();
  const drama = row.drama_id
    ? db.prepare('SELECT style, metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(row.drama_id)
    : null;
  const { resolvedStreamStyleFromDrama } = require('../utils/dramaStyleMerge');
  const finalStyle = resolvedStreamStyleFromDrama('', drama) || cfg?.style?.default_style || '';

  let dramaAspectRatio = null;
  try {
    if (drama?.metadata) {
      const meta = typeof drama.metadata === 'string' ? JSON.parse(drama.metadata) : drama.metadata;
      if (meta?.aspect_ratio) dramaAspectRatio = meta.aspect_ratio;
    }
  } catch (_) {}

  const videoRatio = dramaAspectRatio || cfg?.style?.default_video_ratio || '16:9';

  // 视频提示词只按分镜行拼装；角色声线/外貌附加字段当前不会进入 generateVideoPrompt。
  const videoPrompt = generateVideoPrompt(row, finalStyle, videoRatio);
  const now = new Date().toISOString();
  db.prepare('UPDATE storyboards SET video_prompt = ?, updated_at = ? WHERE id = ?').run(videoPrompt, now, sbId);

  if (log?.info) {
    log.info('[分镜] 已按最新规则重建 video_prompt', {
      id: sbId,
      len: videoPrompt.length,
    });
  }

  const storyboardService = require('./storyboardService');
  return storyboardService.getStoryboardById(db, sbId);
}

module.exports = {
  updateStoryboardRowFromDerived,
  insertOneStoryboard,
  saveStoryboards,
  rebuildVideoPromptForStoryboard,
};
