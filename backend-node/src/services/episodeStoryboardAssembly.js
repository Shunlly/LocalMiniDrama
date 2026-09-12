/**
 * 分集分镜列表的时长规范化与媒体字段装配。
 * 查询入口仍走权限校验；镜号去重见 episodeStoryboardOrdering.js。
 */

const dramaWriteGuard = require('./dramaWriteGuard');
const { dedupeStoryboardRowsByNumber } = require('./episodeStoryboardOrdering');

/** 规范为数字秒：前端左侧用 {{ shot.duration }}s，右侧用 Math.round(duration)；避免 "5s" 导致 5ss，或非数字导致 NaN */
function normalizeDuration(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  const s = String(v).trim().replace(/s$/i, '');
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

function parseEpisodeStoryboardCharacters(characters) {
  if (!characters) return [];
  if (typeof characters !== 'string') return Array.isArray(characters) ? characters : [];
  try { return JSON.parse(characters); } catch (_) { return []; }
}

function parseEpisodeStoryboardReferenceImages(referenceImages) {
  try { return referenceImages ? JSON.parse(referenceImages) : []; } catch (_) { return []; }
}

function rowToEpisodeScene(r) {
  if (!r) return null;
  return {
    id: r.id,
    drama_id: r.drama_id,
    location: r.location,
    time: r.time,
    prompt: r.prompt,
    storyboard_count: r.storyboard_count ?? 1,
    image_url: r.image_url,
    local_path: r.local_path,
    status: r.status || 'pending',
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function loadEpisodeSceneBackground(db, sceneId) {
  if (sceneId == null) return null;
  const sceneRow = db.prepare('SELECT * FROM scenes WHERE id = ? AND deleted_at IS NULL').get(sceneId);
  return sceneRow ? rowToEpisodeScene(sceneRow) : null;
}

function assembleEpisodeStoryboard(r, background = null) {
  return {
    id: r.id,
    episode_id: r.episode_id,
    scene_id: r.scene_id,
    storyboard_number: r.storyboard_number,
    title: r.title,
    description: r.description,
    location: r.location,
    time: r.time,
    duration: normalizeDuration(r.duration),
    dialogue: r.dialogue,
    narration: r.narration ?? null,
    action: r.action,
    result: r.result,
    atmosphere: r.atmosphere,
    image_prompt: r.image_prompt,
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
    characters: parseEpisodeStoryboardCharacters(r.characters),
    composed_image: r.composed_image,
    video_url: r.video_url,
    video_local_path: r.video_local_path ?? null,
    reference_images: parseEpisodeStoryboardReferenceImages(r.reference_images),
    video_reference_image_id: r.video_reference_image_id ?? null,
    audio_local_path: r.audio_local_path ?? null,
    narration_audio_local_path: r.narration_audio_local_path ?? null,
    status: r.status || 'pending',
    created_at: r.created_at,
    updated_at: r.updated_at,
    background,
  };
}

function getStoryboardsForEpisode(db, episodeId) {
  if (!dramaWriteGuard.canReadResource(db, 'episodes', episodeId)) return [];
  const rows = dedupeStoryboardRowsByNumber(
    db.prepare(
      'SELECT * FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL ORDER BY storyboard_number ASC, id ASC'
    ).all(episodeId)
  );
  return rows.map((r) => assembleEpisodeStoryboard(r, loadEpisodeSceneBackground(db, r.scene_id)));
}

module.exports = {
  normalizeDuration,
  parseEpisodeStoryboardCharacters,
  parseEpisodeStoryboardReferenceImages,
  rowToEpisodeScene,
  assembleEpisodeStoryboard,
  getStoryboardsForEpisode,
};
