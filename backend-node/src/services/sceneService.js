// 场景 CRUD 与风格覆盖；与 Go scene_handler + storyboard_composition 对齐。
// 生成、全景与从图提取描述见 sceneGeneration.js，公开 API 仍由此文件再导出。
const {
  assertEpisodeWritable,
  canReadDrama,
  canReadResource,
  runDramaWrite,
  runResourceWrite,
} = require('./dramaWriteGuard');

function applySceneStyleOverride(cfg, styleOverride) {
  const o = (styleOverride || '').toString().trim();
  if (!o) return cfg;
  return {
    ...cfg,
    style: {
      ...(cfg?.style || {}),
      default_style_zh: o,
      default_style_en: o,
      default_style: o,
    },
  };
}
function updateScene(db, log, sceneId, req) {
  const row = db.prepare('SELECT id FROM scenes WHERE id = ? AND deleted_at IS NULL').get(Number(sceneId));
  if (!row || !canReadResource(db, 'scenes', sceneId)) return { ok: false, error: '场景不存在' };
  const changed = runResourceWrite(db, 'scenes', sceneId, () => {
    const updates = [];
    const params = [];
    if (req.location != null) { updates.push('location = ?'); params.push(req.location); }
    if (req.time != null) { updates.push('time = ?'); params.push(req.time); }
    if (req.prompt != null) { updates.push('prompt = ?'); params.push(req.prompt); }
    if (req.polished_prompt != null) { updates.push('polished_prompt = ?'); params.push(req.polished_prompt); }
    if (req.polished_prompt_single != null) { updates.push('polished_prompt_single = ?'); params.push(req.polished_prompt_single); }
    if (req.image_url != null) { updates.push('image_url = ?'); params.push(req.image_url); }
    if (req.local_path !== undefined) { updates.push('local_path = ?'); params.push(req.local_path); }
    if (req.extra_images !== undefined) { updates.push('extra_images = ?'); params.push(req.extra_images ?? null); }
    if (req.ref_image !== undefined) { updates.push('ref_image = ?'); params.push(req.ref_image ?? null); }
    if (updates.length === 0) return true;
    params.push(new Date().toISOString(), Number(sceneId));
    return db.prepare('UPDATE scenes SET ' + updates.join(', ') + ', updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(...params).changes > 0;
  });
  log.info('Scene updated', { scene_id: sceneId });
  return { ok: changed !== false };
}

function updateScenePrompt(db, log, sceneId, req) {
  const row = db.prepare('SELECT id FROM scenes WHERE id = ? AND deleted_at IS NULL').get(Number(sceneId));
  if (!row || !canReadResource(db, 'scenes', sceneId)) return { ok: false, error: '场景不存在' };
  const prompt = req.prompt != null ? req.prompt : '';
  runResourceWrite(db, 'scenes', sceneId, () => db.prepare(
    'UPDATE scenes SET prompt = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
  ).run(prompt, new Date().toISOString(), Number(sceneId)));
  log.info('Scene prompt updated', { scene_id: sceneId });
  return { ok: true };
}

function deleteScene(db, log, sceneId) {
  if (!canReadResource(db, 'scenes', sceneId)) return { ok: false, error: '场景不存在' };
  const result = runResourceWrite(db, 'scenes', sceneId, () => db.prepare(
    'UPDATE scenes SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL'
  ).run(new Date().toISOString(), Number(sceneId)));
  if (result.changes === 0) return { ok: false, error: '场景不存在' };
  log.info('Scene deleted', { scene_id: sceneId });
  return { ok: true };
}

function createScene(db, log, dramaId, req) {
  const normalizedDramaId = Number(dramaId);
  const episodeId = req.episode_id != null ? Number(req.episode_id) : null;
  const info = runDramaWrite(db, normalizedDramaId, () => {
    if (episodeId != null) assertEpisodeWritable(db, episodeId, normalizedDramaId);
    const now = new Date().toISOString();
    try {
      return db.prepare(
        `INSERT INTO scenes (drama_id, episode_id, location, time, prompt, image_url, local_path, storyboard_count, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'pending', ?, ?)`
      ).run(
        normalizedDramaId,
        episodeId,
        req.location || '',
        req.time || '',
        req.prompt || '',
        req.image_url ?? null,
        req.local_path ?? null,
        now,
        now
      );
    } catch (error) {
      // 老库可能没有 episode_id 列，降级为不含 episode_id 的 INSERT。
      if ((error.message || '').includes('episode_id')) {
        return db.prepare(
          `INSERT INTO scenes (drama_id, location, time, prompt, image_url, local_path, storyboard_count, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, 'pending', ?, ?)`
        ).run(normalizedDramaId, req.location || '', req.time || '', req.prompt || '', req.image_url ?? null, req.local_path ?? null, now, now);
      }
      throw error;
    }
  });
  log.info('Scene created', { scene_id: info.lastInsertRowid, drama_id: dramaId, episode_id: episodeId });
  return getSceneById(db, info.lastInsertRowid);
}

function createSceneForEpisode(db, log, dramaId, episodeId, req) {
  return createScene(db, log, dramaId, { ...req, episode_id: episodeId });
}

function deleteScenesByEpisodeId(db, log, episodeId) {
  try {
    const episode = assertEpisodeWritable(db, episodeId);
    const result = runDramaWrite(db, episode.drama_id, () => {
      assertEpisodeWritable(db, episodeId, episode.drama_id);
      return db.prepare('UPDATE scenes SET deleted_at = ? WHERE episode_id = ? AND deleted_at IS NULL')
        .run(new Date().toISOString(), Number(episodeId));
    });
    log.info('Scenes deleted by episode', { episode_id: episodeId, count: result.changes });
    return result.changes;
  } catch (e) {
    if ((e.message || '').includes('episode_id') || e.code === 'RESOURCE_NOT_FOUND') return 0;
    throw e;
  }
}

function listByDramaId(db, dramaId) {
  if (!canReadDrama(db, dramaId)) return [];
  const rows = db.prepare(
    'SELECT * FROM scenes WHERE drama_id = ? AND deleted_at IS NULL ORDER BY id ASC'
  ).all(Number(dramaId));
  return rows.map((row) => ({
    id: row.id,
    drama_id: row.drama_id,
    episode_id: row.episode_id,
    location: row.location,
    time: row.time,
    prompt: row.prompt,
    polished_prompt: row.polished_prompt || null,
    polished_prompt_single: row.polished_prompt_single || null,
    description: row.description || null,
    image_url: row.image_url,
    local_path: row.local_path,
    panorama_image_url: row.panorama_image_url || null,
    panorama_local_path: row.panorama_local_path || null,
    panorama_image_id: row.panorama_image_id ?? null,
    extra_images: row.extra_images || null,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

function getSceneById(db, id) {
  const row = db.prepare('SELECT * FROM scenes WHERE id = ? AND deleted_at IS NULL').get(id);
  if (row && !canReadResource(db, 'scenes', id)) return null;
  return row ? {
    id: row.id,
    drama_id: row.drama_id,
    location: row.location,
    time: row.time,
    prompt: row.prompt,
    polished_prompt: row.polished_prompt || null,
    polished_prompt_single: row.polished_prompt_single || null,
    image_url: row.image_url,
    local_path: row.local_path,
    panorama_image_url: row.panorama_image_url || null,
    panorama_local_path: row.panorama_local_path || null,
    panorama_image_id: row.panorama_image_id ?? null,
    extra_images: row.extra_images || null,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at
  } : null;
}

module.exports = {
  applySceneStyleOverride,
  updateScene,
  updateScenePrompt,
  deleteScene,
  createScene,
  createSceneForEpisode,
  deleteScenesByEpisodeId,
  listByDramaId,
  getSceneById,
};

// 生成/全景公开 API 仍从此文件再导出，调用方无需改 require。
Object.assign(module.exports, require('./sceneGeneration'));
