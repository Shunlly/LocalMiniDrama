// 分镜：create, update, delete；帧提示词 get/save

const uploadService = require('./uploadService');

/**
 * 将分镜勾选的角色（dramas.characters 表 id）同步到 storyboard_characters（角色库 id），
 * 便于帧提示词与图生参考图与 UI 一致；按角色名匹配本剧或全局角色库。
 */
function parseDramaCharacterIds(charactersValue) {
  if (charactersValue === undefined || charactersValue === null) return null;
  if (Array.isArray(charactersValue)) {
    return charactersValue
      .map((x) => Number(typeof x === 'object' && x != null ? x.id : x))
      .filter((n) => Number.isFinite(n));
  }
  if (typeof charactersValue === 'string') {
    try {
      const arr = JSON.parse(charactersValue);
      if (!Array.isArray(arr)) return [];
      return arr
        .map((x) => Number(typeof x === 'object' && x != null ? x.id : x))
        .filter((n) => Number.isFinite(n));
    } catch (_) {
      return [];
    }
  }
  return [];
}

function syncStoryboardCharacterLinks(db, storyboardId, dramaCharacterIds) {
  const sid = Number(storyboardId);
  db.prepare('DELETE FROM storyboard_characters WHERE storyboard_id = ?').run(sid);
  const ids = Array.isArray(dramaCharacterIds) ? dramaCharacterIds.map((n) => Number(n)).filter((n) => Number.isFinite(n)) : [];
  if (ids.length === 0) return;
  const sb = db.prepare(
    `SELECT e.drama_id FROM storyboards s JOIN episodes e ON e.id = s.episode_id WHERE s.id = ? AND s.deleted_at IS NULL`
  ).get(sid);
  const dramaId = sb?.drama_id != null ? Number(sb.drama_id) : null;
  const now = new Date().toISOString();
  const ins = db.prepare('INSERT OR IGNORE INTO storyboard_characters (storyboard_id, character_id, created_at) VALUES (?, ?, ?)');
  for (const cid of ids.slice(0, 20)) {
    const crow = db.prepare('SELECT name FROM characters WHERE id = ? AND deleted_at IS NULL').get(cid);
    const name = (crow?.name || '').trim();
    if (!name) continue;
    let lib = null;
    if (dramaId) {
      lib = db.prepare(
        'SELECT id FROM character_libraries WHERE deleted_at IS NULL AND drama_id = ? AND TRIM(name) = ? LIMIT 1'
      ).get(dramaId, name);
    }
    if (!lib) {
      lib = db.prepare(
        'SELECT id FROM character_libraries WHERE deleted_at IS NULL AND drama_id IS NULL AND TRIM(name) = ? LIMIT 1'
      ).get(name);
    }
    if (lib) ins.run(sid, lib.id, now);
  }
}

function badRequest(message) {
  const error = new Error(message);
  error.code = 'BAD_REQUEST';
  return error;
}

function storageRoot() {
  const cfg = require('../config').loadConfig();
  const raw = cfg?.storage?.local_path || './data/storage';
  const path = require('path');
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

function normalizeStoryboardVideoReference(value, localOnly = false) {
  if (value == null || String(value).trim() === '') return null;
  const text = String(value).trim();
  if (/^https?:\/\//i.test(text)) {
    if (localOnly) throw badRequest('视频本地路径必须位于 storage 内');
    try {
      return uploadService.assertPublicHttpUrlSyntax(text).toString();
    } catch (_) {
      throw badRequest('视频 URL 必须是无凭据的公网 HTTP(S) 地址');
    }
  }
  try {
    const resolved = uploadService.resolveStorageReference(storageRoot(), text, { mustExist: false });
    if (!resolved) throw new Error('not local');
    return resolved.relativePath;
  } catch (_) {
    throw badRequest('视频路径必须是 storage 内的相对路径');
  }
}

function normalizeStoryboardAudioReference(value) {
  if (value == null || String(value).trim() === '') return null;
  try {
    const resolved = uploadService.resolveStorageReference(storageRoot(), String(value).trim());
    if (!resolved) throw new Error('not local');
    const opened = uploadService.openStorageFile(storageRoot(), resolved.relativePath);
    try {
      if (!opened.stat.isFile() || opened.stat.size <= 0) throw new Error('invalid audio file');
    } finally {
      require('fs').closeSync(opened.fd);
    }
    return resolved.relativePath;
  } catch (_) {
    throw badRequest('音频路径必须指向 storage 内已存在的普通文件');
  }
}

function normalizeReferenceImages(value) {
  let items = value;
  if (typeof items === 'string') {
    try { items = JSON.parse(items); } catch (_) { throw badRequest('参考图数据格式无效'); }
  }
  if (items == null || items === '') return null;
  if (!Array.isArray(items)) throw badRequest('参考图必须是数组');
  if (items.length > 10) throw badRequest('每个分镜最多保存 10 张自由参考图');
  const normalized = [];
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw badRequest('参考图条目无效');
    let localPath = String(item.local_path || '').trim();
    const imageUrl = String(item.image_url || item.url || '').trim();
    if (localPath) {
      try { localPath = uploadService.normalizeStorageRelativeReference(localPath); }
      catch (_) { throw badRequest('参考图本地路径无效'); }
    }
    if (imageUrl.startsWith('/static/')) {
      try { uploadService.normalizeStorageRelativeReference(imageUrl.slice('/static/'.length)); }
      catch (_) { throw badRequest('参考图静态地址无效'); }
    } else if (imageUrl) {
      try { uploadService.assertPublicHttpUrlSyntax(imageUrl); }
      catch (_) { throw badRequest('参考图 URL 必须是无凭据的公网 HTTP(S) 地址'); }
    }
    if (!localPath && !imageUrl) throw badRequest('参考图缺少可用地址');
    const normalizedItem = {
      name: String(item.name || item.filename || '参考图').replace(/[\r\n\0]/g, ' ').trim().slice(0, 200) || '参考图',
      local_path: localPath || null,
      image_url: imageUrl || null,
    };
    if (item.asset_id != null && item.asset_id !== '') {
      const assetId = Number(item.asset_id);
      if (!Number.isSafeInteger(assetId) || assetId <= 0) throw badRequest('参考图素材 ID 无效');
      normalizedItem.asset_id = assetId;
    }
    if (item.source_drama_id != null && item.source_drama_id !== '') {
      const sourceDramaId = Number(item.source_drama_id);
      if (!Number.isSafeInteger(sourceDramaId) || sourceDramaId <= 0) throw badRequest('参考图来源项目 ID 无效');
      normalizedItem.source_drama_id = sourceDramaId;
    }
    const sourceDramaTitle = String(item.source_drama_title || '').replace(/[\r\n\0]/g, ' ').trim().slice(0, 200);
    if (sourceDramaTitle) normalizedItem.source_drama_title = sourceDramaTitle;
    normalized.push(normalizedItem);
  }
  return JSON.stringify(normalized);
}

function validateVideoReferenceImage(db, storyboardId, value) {
  if (value == null || value === '') return null;
  const imageId = Number(value);
  if (!Number.isInteger(imageId) || imageId <= 0) throw badRequest('宫格视频参考图 ID 无效');
  const row = db.prepare(
    `SELECT id FROM image_generations
      WHERE id = ? AND storyboard_id = ? AND status = 'completed' AND deleted_at IS NULL
        AND frame_type IN ('quad_grid', 'nine_grid')`
  ).get(imageId, Number(storyboardId));
  if (!row) throw badRequest('宫格视频参考图不存在或不属于当前分镜');
  return imageId;
}

function createStoryboard(db, log, req) {
  const now = new Date().toISOString();
  const episodeId = Number(req.episode_id);
  const num = Number(req.storyboard_number ?? 0) || 0;
  const info = db.prepare(
    `INSERT INTO storyboards (episode_id, scene_id, storyboard_number, title, description, location, time, duration, dialogue, action, result, atmosphere, image_prompt, video_prompt, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).run(
    episodeId,
    req.scene_id ?? null,
    num,
    req.title ?? null,
    req.description ?? null,
    req.location ?? null,
    req.time ?? null,
    req.duration ?? 0,
    req.dialogue ?? null,
    req.action ?? null,
    req.result ?? null,
    req.atmosphere ?? null,
    req.image_prompt ?? null,
    req.video_prompt ?? null,
    now,
    now
  );
  log.info('Storyboard created', { id: info.lastInsertRowid, episode_id: episodeId });
  return getStoryboardById(db, info.lastInsertRowid);
}

function updateStoryboard(db, log, id, req) {
  const row = db.prepare('SELECT id FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(Number(id));
  if (!row) return null;
  const allowed = ['title', 'description', 'location', 'time', 'duration', 'dialogue', 'narration', 'action', 'result', 'atmosphere', 'image_prompt', 'polished_prompt', 'video_prompt', 'scene_id', 'characters', 'composed_image', 'image_url', 'local_path', 'main_panel_idx', 'video_url', 'video_local_path', 'audio_local_path', 'narration_audio_local_path', 'status', 'shot_type', 'angle', 'angle_h', 'angle_v', 'angle_s', 'movement', 'segment_index', 'segment_title', 'creation_mode', 'universal_segment_text', 'layout_description', 'first_frame_image_id', 'last_frame_image_id', 'last_frame_image_url', 'last_frame_local_path'];
  const updates = [];
  const params = [];
  // 前端可能传 character_ids，与 characters 统一：存为 JSON 字符串
  const charactersValue = req.character_ids !== undefined ? req.character_ids : req.characters;
  let parsedDramaCharIdsForSync = null;
  if (charactersValue !== undefined) {
    updates.push('characters = ?');
    const jsonStr = Array.isArray(charactersValue) ? JSON.stringify(charactersValue) : (typeof charactersValue === 'string' ? charactersValue : '[]');
    params.push(jsonStr);
    parsedDramaCharIdsForSync = parseDramaCharacterIds(charactersValue) ?? [];
  }
  if (req.reference_images !== undefined) {
    updates.push('reference_images = ?');
    params.push(normalizeReferenceImages(req.reference_images));
  }
  if (req.video_reference_image_id !== undefined) {
    updates.push('video_reference_image_id = ?');
    params.push(validateVideoReferenceImage(db, id, req.video_reference_image_id));
  }
  for (const key of allowed) {
    if (key === 'characters') continue;
    if (req[key] !== undefined) {
      updates.push(key + ' = ?');
      let val = req[key];
      if (key === 'video_url') val = normalizeStoryboardVideoReference(val, false);
      if (key === 'video_local_path') val = normalizeStoryboardVideoReference(val, true);
      if (key === 'audio_local_path' || key === 'narration_audio_local_path') {
        val = normalizeStoryboardAudioReference(val);
      }
      params.push(val);
    }
  }
  if (updates.length === 0 && req.prop_ids === undefined) return getStoryboardById(db, id);
  if (updates.length > 0) {
    params.push(new Date().toISOString(), id);
    db.prepare('UPDATE storyboards SET ' + updates.join(', ') + ', updated_at = ? WHERE id = ?').run(...params);
  }
  // 角色勾选变更：只同步 storyboard_characters，不删除 frame_prompts。
  // 用户手动保存的首/尾帧提示词应保留；图生时 framePromptSanitize 会按当前勾选剔除未出场角色名。
  if (parsedDramaCharIdsForSync !== null) {
    try {
      syncStoryboardCharacterLinks(db, id, parsedDramaCharIdsForSync);
    } catch (e) {
      log.warn('syncStoryboardCharacterLinks failed', { id, message: e.message });
    }
  }
  // 道具关联：写入 storyboard_props 表
  if (req.prop_ids !== undefined) {
    const propIds = Array.isArray(req.prop_ids) ? req.prop_ids : [];
    db.prepare('DELETE FROM storyboard_props WHERE storyboard_id = ?').run(Number(id));
    const ins = db.prepare('INSERT OR IGNORE INTO storyboard_props (storyboard_id, prop_id) VALUES (?, ?)');
    for (const pid of propIds) ins.run(Number(id), Number(pid));
  }
  log.info('Storyboard updated', { id });
  return getStoryboardById(db, id);
}

function normalizeEpisodeStoryboardNumbers(db, episodeId, now = new Date().toISOString()) {
  const rows = db.prepare(
    `SELECT id, storyboard_number
     FROM storyboards
     WHERE episode_id = ? AND deleted_at IS NULL
     ORDER BY storyboard_number ASC, id ASC`
  ).all(Number(episodeId));
  const update = db.prepare(
    'UPDATE storyboards SET storyboard_number = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
  );
  let changes = 0;
  rows.forEach((row, index) => {
    const nextNumber = index + 1;
    if (Number(row.storyboard_number) === nextNumber) return;
    changes += update.run(nextNumber, now, row.id).changes;
  });
  return changes;
}

function deleteStoryboard(db, log, id) {
  const storyboardId = Number(id);
  const deleted = db.transaction(() => {
    const target = db.prepare(
      'SELECT id, episode_id FROM storyboards WHERE id = ? AND deleted_at IS NULL'
    ).get(storyboardId);
    if (!target) return null;

    const now = new Date().toISOString();
    const result = db.prepare(
      'UPDATE storyboards SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
    ).run(now, now, storyboardId);
    if (result.changes === 0) return null;
    const reordered = normalizeEpisodeStoryboardNumbers(db, target.episode_id, now);
    return { episodeId: target.episode_id, reordered };
  })();
  if (!deleted) return false;
  log.info('Storyboard deleted', { id: storyboardId, episode_id: deleted.episodeId, reordered: deleted.reordered });
  return true;
}

function getStoryboardById(db, id) {
  const r = db.prepare('SELECT * FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(Number(id));
  if (!r) return null;
  let characters = [];
  if (r.characters) {
    if (typeof r.characters === 'string') {
      try { characters = JSON.parse(r.characters); } catch (_) {}
    } else if (Array.isArray(r.characters)) characters = r.characters;
  }
  let propIds = [];
  try {
    const propLinks = db.prepare('SELECT prop_id FROM storyboard_props WHERE storyboard_id = ?').all(Number(id));
    propIds = propLinks.map((p) => p.prop_id);
  } catch (_) {}
  return {
    id: r.id,
    episode_id: r.episode_id,
    scene_id: r.scene_id,
    storyboard_number: r.storyboard_number,
    title: r.title,
    description: r.description,
    location: r.location,
    time: r.time,
    duration: r.duration ?? 0,
    dialogue: r.dialogue,
    narration: r.narration ?? null,
    action: r.action,
    result: r.result ?? null,
    atmosphere: r.atmosphere,
    image_prompt: r.image_prompt,
    polished_prompt: r.polished_prompt ?? null,
    video_prompt: r.video_prompt,
    shot_type: r.shot_type,
    angle: r.angle,
    angle_h: r.angle_h ?? null,
    angle_v: r.angle_v ?? null,
    angle_s: r.angle_s ?? null,
    movement: r.movement,
    segment_index: r.segment_index ?? 0,
    segment_title: r.segment_title ?? null,
    creation_mode: r.creation_mode === 'universal' ? 'universal' : 'classic',
    universal_segment_text: r.universal_segment_text ?? null,
    layout_description: r.layout_description ?? null,
    first_frame_image_id: r.first_frame_image_id ?? null,
    last_frame_image_id: r.last_frame_image_id ?? null,
    last_frame_image_url: r.last_frame_image_url ?? null,
    last_frame_local_path: r.last_frame_local_path ?? null,
    characters,
    prop_ids: propIds,
    composed_image: r.composed_image,
    image_url: r.image_url ?? null,
    local_path: r.local_path ?? null,
    main_panel_idx: r.main_panel_idx != null ? Number(r.main_panel_idx) : null,
    video_url: r.video_url,
    video_local_path: r.video_local_path ?? null,
    reference_images: (() => {
      try { return r.reference_images ? JSON.parse(r.reference_images) : []; } catch (_) { return []; }
    })(),
    video_reference_image_id: r.video_reference_image_id ?? null,
    audio_local_path: r.audio_local_path ?? null,
    narration_audio_local_path: r.narration_audio_local_path ?? null,
    status: r.status || 'pending',
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function getFramePrompts(db, storyboardId) {
  const rows = db.prepare(
    'SELECT * FROM frame_prompts WHERE storyboard_id = ? ORDER BY created_at ASC'
  ).all(Number(storyboardId));
  return rows.map((r) => ({
    id: r.id,
    storyboard_id: r.storyboard_id,
    frame_type: r.frame_type,
    prompt: r.prompt,
    description: r.description,
    layout: r.layout,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

function saveFramePrompt(db, log, storyboardId, frameType, prompt, description, layout) {
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT id FROM frame_prompts WHERE storyboard_id = ? AND frame_type = ?').get(Number(storyboardId), frameType);
  if (existing) {
    db.prepare('UPDATE frame_prompts SET prompt = ?, description = ?, layout = ?, updated_at = ? WHERE id = ?').run(
      prompt,
      description ?? null,
      layout ?? null,
      now,
      existing.id
    );
    return getFramePrompts(db, storyboardId);
  }
  db.prepare(
    `INSERT INTO frame_prompts (storyboard_id, frame_type, prompt, description, layout, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(Number(storyboardId), frameType, prompt, description ?? null, layout ?? null, now, now);
  log.info('Frame prompt saved', { storyboard_id: storyboardId, frame_type: frameType });
  return getFramePrompts(db, storyboardId);
}

/** 在指定分镜前插入一个空白分镜：先把同 episode 中 number >= target 的全部 +1，再创建新分镜 */
function insertBeforeStoryboard(db, log, targetId) {
  const normalizedTargetId = Number(targetId);
  const inserted = db.transaction(() => {
    let target = db.prepare(
      'SELECT id, episode_id, storyboard_number, segment_index, segment_title FROM storyboards WHERE id = ? AND deleted_at IS NULL'
    ).get(normalizedTargetId);
    if (!target) return null;

    const now = new Date().toISOString();
    normalizeEpisodeStoryboardNumbers(db, target.episode_id, now);
    target = db.prepare(
      'SELECT id, episode_id, storyboard_number, segment_index, segment_title FROM storyboards WHERE id = ? AND deleted_at IS NULL'
    ).get(normalizedTargetId);
    db.prepare(
      'UPDATE storyboards SET storyboard_number = storyboard_number + 1, updated_at = ? WHERE episode_id = ? AND storyboard_number >= ? AND deleted_at IS NULL'
    ).run(now, target.episode_id, target.storyboard_number);

    const info = db.prepare(
      `INSERT INTO storyboards (episode_id, storyboard_number, segment_index, segment_title, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?)`
    ).run(target.episode_id, target.storyboard_number, target.segment_index ?? null, target.segment_title ?? null, now, now);
    return { id: info.lastInsertRowid, episodeId: target.episode_id };
  })();
  if (!inserted) return null;

  log.info('Storyboard inserted before', {
    new_id: inserted.id,
    before_id: normalizedTargetId,
    episode_id: inserted.episodeId,
  });
  return getStoryboardById(db, inserted.id);
}

module.exports = {
  createStoryboard,
  insertBeforeStoryboard,
  updateStoryboard,
  deleteStoryboard,
  normalizeEpisodeStoryboardNumbers,
  getStoryboardById,
  getFramePrompts,
  saveFramePrompt,
  normalizeReferenceImages,
  normalizeStoryboardAudioReference,
  normalizeStoryboardVideoReference,
  validateVideoReferenceImage,
};
