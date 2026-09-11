/**
 * 分镜路由只读查询：润色上下文、邻镜、风格与本地主图路径。
 * 路由仍从 storyboards.js 导出，本模块不改变公开 API。
 */
const uploadService = require('../services/uploadService');

function clipClassicCtx(s, maxLen) {
  if (s == null) return '';
  const t = String(s).trim();
  if (!t) return '';
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen)}…`;
}

function loadImagePolishStoryboard(db, sbId) {
  return db.prepare(
    'SELECT id, episode_id, storyboard_number, image_prompt, action, dialogue, result, atmosphere, shot_type FROM storyboards WHERE id = ? AND deleted_at IS NULL'
  ).get(sbId);
}

function loadPhotographyParamRows(db, episodeId) {
  return db.prepare(
    'SELECT id, angle_s, shot_type, atmosphere, time, description, action, movement, lighting_style, depth_of_field FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL ORDER BY storyboard_number ASC'
  ).all(episodeId);
}

/**
 * 分镜主图路径：storyboards.local_path 常与图生记录不同步（图在 image_generations），按存在性解析。
 * @returns {{ relativePath: string, absolutePath: string }|null} 本地存储目录内的安全图片路径
 */
function resolveStoryboardImageLocalPath(db, storageBase, storyboardId, sbRow) {
  const tryRel = (rel) => {
    if (!rel || !String(rel).trim()) return null;
    try {
      return uploadService.resolveStorageReference(storageBase, rel);
    } catch (_) {
      return null;
    }
  };
  const fromSb = tryRel(sbRow?.local_path);
  if (fromSb) return fromSb;
  const ig = db.prepare(
    `SELECT local_path FROM image_generations
     WHERE storyboard_id = ? AND status = 'completed' AND deleted_at IS NULL
       AND local_path IS NOT NULL AND TRIM(local_path) != ''
     ORDER BY id DESC
     LIMIT 1`
  ).get(storyboardId);
  return tryRel(ig?.local_path);
}

function loadMergedDramaStyle(db, episodeId) {
  let dramaId = null;
  try {
    const ep = db.prepare('SELECT drama_id FROM episodes WHERE id = ? AND deleted_at IS NULL').get(episodeId);
    dramaId = ep?.drama_id ?? null;
  } catch (_) {}

  let styleEn = '';
  let styleZh = '';
  let videoRatio = '9:16';
  try {
    const loadConfig = require('../config').loadConfig;
    const { mergeCfgStyleWithDrama } = require('../utils/dramaStyleMerge');
    let cfg = loadConfig();
    const dr = dramaId
      ? db.prepare('SELECT style, metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(dramaId)
      : null;
    cfg = mergeCfgStyleWithDrama(cfg, dr || {});
    styleEn = (cfg?.style?.default_style_en || cfg?.style?.default_style || '').trim();
    styleZh = (cfg?.style?.default_style_zh || '').trim();
    try {
      const meta = dr?.metadata ? JSON.parse(dr.metadata) : {};
      if (meta?.aspect_ratio && String(meta.aspect_ratio).trim()) {
        videoRatio = String(meta.aspect_ratio).trim().replace(/\uFF1A/g, ':');
      }
    } catch (_) {}
  } catch (_) {}
  return { dramaId, styleEn, styleZh, videoRatio };
}

function loadNeighborContinuity(db, sb) {
  let prevDesc = '(first shot)';
  let nextDesc = '(last shot)';
  let prevContinuityState = null;
  if (sb.episode_id == null || sb.storyboard_number == null) {
    return { prevDesc, nextDesc, prevContinuityState };
  }
  const prevShot = db.prepare(
    'SELECT action, location, time, continuity_snapshot FROM storyboards WHERE episode_id = ? AND storyboard_number < ? AND deleted_at IS NULL ORDER BY storyboard_number DESC LIMIT 1'
  ).get(sb.episode_id, sb.storyboard_number);
  const nextShot = db.prepare(
    'SELECT action, location, time FROM storyboards WHERE episode_id = ? AND storyboard_number > ? AND deleted_at IS NULL ORDER BY storyboard_number ASC LIMIT 1'
  ).get(sb.episode_id, sb.storyboard_number);
  if (prevShot) {
    prevDesc = (prevShot.action || [prevShot.location, prevShot.time].filter(Boolean).join(' ')).slice(0, 120).trim() || '(first shot)';
    if (prevShot.continuity_snapshot) {
      try { prevContinuityState = JSON.parse(prevShot.continuity_snapshot); } catch (_) {}
    }
  }
  if (nextShot) nextDesc = (nextShot.action || [nextShot.location, nextShot.time].filter(Boolean).join(' ')).slice(0, 120).trim() || '(last shot)';
  return { prevDesc, nextDesc, prevContinuityState };
}

function loadCharacterAssetNames(db, sbId) {
  try {
    const nameSet = new Set();
    const sbFull = db.prepare('SELECT characters FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(sbId);
    if (sbFull?.characters) {
      const parsed = JSON.parse(sbFull.characters);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const cid = typeof item === 'object' && item != null ? item.id : item;
          const c = db.prepare('SELECT name FROM characters WHERE id = ? AND deleted_at IS NULL').get(Number(cid));
          if (c?.name) nameSet.add(c.name);
        }
      }
    }
    const libLinks = db.prepare('SELECT character_id FROM storyboard_characters WHERE storyboard_id = ?').all(sbId);
    for (const link of libLinks) {
      const lib = db.prepare('SELECT name FROM character_libraries WHERE id = ? AND deleted_at IS NULL').get(link.character_id);
      if (lib?.name) nameSet.add(lib.name);
    }
    return [...nameSet].join(', ');
  } catch (_) {
    return '';
  }
}

function loadEpisodeScript(db, episodeId) {
  try {
    const ep = db.prepare('SELECT script_content, title FROM episodes WHERE id = ? AND deleted_at IS NULL').get(episodeId);
    return (ep?.script_content && String(ep.script_content).trim()) || '';
  } catch (_) {
    return '';
  }
}

const NEIGHBOR_POLISH_COLUMNS = 'storyboard_number, title, description, action, dialogue, narration, video_prompt, universal_segment_text';

function loadNeighborPolishRows(db, episodeId, storyboardNumber) {
  let prevRow = null;
  let nextRow = null;
  try {
    prevRow = db.prepare(
      `SELECT ${NEIGHBOR_POLISH_COLUMNS}
       FROM storyboards WHERE episode_id = ? AND storyboard_number < ? AND deleted_at IS NULL
       ORDER BY storyboard_number DESC LIMIT 1`
    ).get(episodeId, storyboardNumber);
    nextRow = db.prepare(
      `SELECT ${NEIGHBOR_POLISH_COLUMNS}
       FROM storyboards WHERE episode_id = ? AND storyboard_number > ? AND deleted_at IS NULL
       ORDER BY storyboard_number ASC LIMIT 1`
    ).get(episodeId, storyboardNumber);
  } catch (_) {}
  return { prevRow, nextRow };
}

function loadClassicProjectContext(db, dramaId, episodeId) {
  let dramaTitle = '';
  let episodeTitle = '';
  let shotTotalInEpisode = 0;
  try {
    if (dramaId) {
      const drT = db.prepare('SELECT title FROM dramas WHERE id = ? AND deleted_at IS NULL').get(dramaId);
      dramaTitle = drT?.title != null ? String(drT.title).trim() : '';
    }
    const epT = db.prepare('SELECT title FROM episodes WHERE id = ? AND deleted_at IS NULL').get(episodeId);
    episodeTitle = epT?.title != null ? String(epT.title).trim() : '';
    const cnt = db.prepare('SELECT COUNT(*) AS n FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL').get(episodeId);
    shotTotalInEpisode = cnt?.n != null ? Number(cnt.n) : 0;
  } catch (_) {}
  return { dramaTitle, episodeTitle, shotTotalInEpisode };
}

function loadLinkedSceneText(db, sceneId) {
  try {
    if (!sceneId) return '';
    const sc = db.prepare('SELECT location, time, prompt FROM scenes WHERE id = ? AND deleted_at IS NULL').get(sceneId);
    if (!sc) return '';
    const bits = [sc.location, sc.time].filter((x) => x != null && String(x).trim());
    const head = bits.join('，');
    const pr = sc.prompt != null ? String(sc.prompt).trim() : '';
    return [head, pr ? `场景库文案摘要：${clipClassicCtx(pr, 280)}` : ''].filter(Boolean).join('；');
  } catch (_) {
    return '';
  }
}

module.exports = {
  loadImagePolishStoryboard,
  loadPhotographyParamRows,
  resolveStoryboardImageLocalPath,
  loadMergedDramaStyle,
  loadNeighborContinuity,
  loadCharacterAssetNames,
  loadEpisodeScript,
  loadNeighborPolishRows,
  loadClassicProjectContext,
  loadLinkedSceneText,
};
