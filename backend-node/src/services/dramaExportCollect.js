'use strict';

const {
  collectFreeCanvasImportManifest,
  normalizeFreeCanvasExportPath,
  validateFreeCanvasForExport,
} = require('./dramaExportFreeCanvas');
const {
  extOf,
  collectSourceIntakeOriginals,
  supplementFramePromptsFromImageGens,
} = require('./dramaExportCollection');

function collectDramaExportSnapshot(db, storagePath, dramaId, archive) {
// ---- 1. 读取 drama 基本信息 ----
const drama = db.prepare('SELECT * FROM dramas WHERE id = ? AND deleted_at IS NULL').get(Number(dramaId));
if (!drama) throw new Error('剧本不存在');

let metadata = {};
try { metadata = drama.metadata ? (typeof drama.metadata === 'string' ? JSON.parse(drama.metadata) : drama.metadata) : {}; } catch (_) {}
if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) metadata = {};
if (Object.prototype.hasOwnProperty.call(metadata, 'free_canvas')) {
  metadata = {
    ...metadata,
    free_canvas: validateFreeCanvasForExport(db, Number(dramaId), metadata.free_canvas),
  };
}

// ---- 2. 读取所有剧集 ----
const episodes = db.prepare(
  'SELECT * FROM episodes WHERE drama_id = ? AND deleted_at IS NULL ORDER BY episode_number'
).all(Number(dramaId));

// ---- 3. 读取各集分镜 ----
const episodeIds = episodes.map(e => e.id);
const storyboardsByEp = {};
for (const ep of episodes) {
  storyboardsByEp[ep.id] = db.prepare(
    'SELECT * FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL ORDER BY storyboard_number'
  ).all(ep.id);
}

// ---- 4. 读取分镜图（完整历史 + 首尾帧 first/last）和视频（取最新完成的） ----
const allStoryboards = Object.values(storyboardsByEp).flat();
const allSbIds = allStoryboards.map(s => s.id);
const storyboardsById = new Map(allStoryboards.map(sb => [sb.id, sb]));
const allImagesBySb = {};  // sbId -> 所有 image_generations 记录（用于导出历史和首尾帧绑定）
const videosBySb = {};
for (const sbId of allSbIds) {
  // 导出所有非删除的图片生成记录（含历史、首尾帧、各种 frame_type），仅打包有 local_path 的文件
  const igs = db.prepare(
    "SELECT * FROM image_generations WHERE storyboard_id = ? AND deleted_at IS NULL ORDER BY created_at ASC"
  ).all(sbId);
  allImagesBySb[sbId] = igs.filter(Boolean);

  const vg = db.prepare(
    `SELECT id, video_url, local_path FROM video_generations
     WHERE storyboard_id = ? AND status = 'completed' AND deleted_at IS NULL
     ORDER BY COALESCE(NULLIF(completed_at, ''), NULLIF(updated_at, ''), NULLIF(created_at, ''), '') DESC, id DESC
     LIMIT 1`
  ).get(sbId);
  const sb = storyboardsById.get(sbId);
  const storyboardVideoLocalPath = String(sb?.video_local_path || '').trim();
  const selectedVideoLocalPath = storyboardVideoLocalPath || vg?.local_path || null;
  const generationVideoLocalPath = String(vg?.local_path || '').trim();
  const selectedVideoGenerationId = selectedVideoLocalPath && generationVideoLocalPath
    && normalizeFreeCanvasExportPath(selectedVideoLocalPath, 'storyboard video_local_path')
      === normalizeFreeCanvasExportPath(generationVideoLocalPath, 'video generation local_path')
    ? vg.id
    : null;
  const video = {
    video_url: sb?.video_url || vg?.video_url || null,
    local_path: selectedVideoLocalPath,
    original_id: selectedVideoGenerationId,
  };
  if (video.video_url || video.local_path) videosBySb[sbId] = video;
}

// 收集需要打包的分镜图片文件（完整历史）
const imageFilesToPack = [];
for (const [sbIdStr, igs] of Object.entries(allImagesBySb)) {
  const sbId = Number(sbIdStr);
  for (const ig of igs) {
    if (!ig.local_path) continue;
    const zipPath = `media/storyboards/sb_${sbId}_gen_${ig.id}${extOf(ig.local_path)}`;
    imageFilesToPack.push({ localRelPath: ig.local_path, zipPath, sourceGenerationId: ig.id });
  }
}

// 预查询各分镜的帧提示词（首尾帧专用提示词编辑器内容，必须导出否则导入后丢失）
const framePromptsBySb = {};
for (const sbId of allSbIds) {
  try {
    const fps = db.prepare('SELECT frame_type, prompt, description, layout, created_at, updated_at FROM frame_prompts WHERE storyboard_id = ? ORDER BY created_at ASC').all(sbId);
    framePromptsBySb[sbId] = supplementFramePromptsFromImageGens(db, sbId, fps);
  } catch (_) { framePromptsBySb[sbId] = []; }
}

// ---- 5. 读取角色 ----
const characters = db.prepare(
  'SELECT * FROM characters WHERE drama_id = ? AND deleted_at IS NULL ORDER BY sort_order, id'
).all(Number(dramaId));

// ---- 6. 读取场景 ----
const scenes = db.prepare(
  'SELECT * FROM scenes WHERE drama_id = ? AND deleted_at IS NULL ORDER BY id'
).all(Number(dramaId));

// ---- 7. 读取道具 ----
const props = db.prepare(
  'SELECT * FROM props WHERE drama_id = ? AND deleted_at IS NULL ORDER BY id'
).all(Number(dramaId));

const sourceIntakeExport = collectSourceIntakeOriginals(db, storagePath, dramaId, archive);

// ---- 构建 ID → 导出数组下标 的映射（用于分镜 characters/scene_id/prop_ids 跨项目还原） ----
const charIdToIndex = {};
characters.forEach((c, idx) => { charIdToIndex[c.id] = idx; });
const sceneIdToIndex = {};
scenes.forEach((s, idx) => { sceneIdToIndex[s.id] = idx; });
const propIdToIndex = {};
props.forEach((p, idx) => { propIdToIndex[p.id] = idx; });

const freeCanvasImportManifest = collectFreeCanvasImportManifest({
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
});

// ---- 读取所有分镜的道具关联（storyboard_props） ----
const allSbIdsForProps = Object.values(storyboardsByEp).flat().map(s => s.id);
const sbPropIds = {}; // storyboard_id → prop_id[]
if (allSbIdsForProps.length > 0) {
  const placeholders = allSbIdsForProps.map(() => '?').join(',');
  const spRows = db.prepare(
    `SELECT storyboard_id, prop_id FROM storyboard_props WHERE storyboard_id IN (${placeholders})`
  ).all(...allSbIdsForProps);
  for (const row of spRows) {
    if (!sbPropIds[row.storyboard_id]) sbPropIds[row.storyboard_id] = [];
    sbPropIds[row.storyboard_id].push(row.prop_id);
  }
}


  return {
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
  };
}

module.exports = {
  collectDramaExportSnapshot,
};
