/**
 * 剧本只读查询：列表、详情、角色、统计与成片下载信息的装配入口。
 * 路由仍通过 dramaService 调用，本模块不改变公开 API。
 */

const dramaWriteGuard = require('./dramaWriteGuard');
const { PRESET_VALUES, resolveStylePreset } = require('../constants/generationStylePresets');
const {
  sanitizeImageUrl,
  rowToDrama,
  rowToEpisode,
  rowToStoryboard,
  rowToCharacter,
  rowToScene,
  rowToProp,
} = require('./dramaAssembly');

const DRAMA_GENRE_LABELS = {
  drama: '剧情',
  comedy: '喜剧',
  adventure: '冒险',
  romance: '爱情',
  thriller: '悬疑',
  action: '动作',
  horror: '恐怖',
};

function localizedDramaSearchAliases(keyword) {
  const normalized = String(keyword || '').trim().toLowerCase();
  if (!normalized) return { styles: [], genres: [] };
  const matches = (value) => String(value || '').toLowerCase().includes(normalized);
  return {
    styles: PRESET_VALUES.filter((value) => {
      const preset = resolveStylePreset(value);
      return matches(value) || matches(preset?.zh) || matches(preset?.en);
    }),
    genres: Object.entries(DRAMA_GENRE_LABELS)
      .filter(([value, label]) => matches(value) || matches(label))
      .map(([value]) => value),
  };
}

function attachDramaListFallbackCover(db, drama) {
  let candidates = [];
  try {
    candidates = db.prepare(`
      SELECT image_url, local_path, source
      FROM (
        SELECT image_url, local_path, 'character' AS source, 1 AS source_order, id
        FROM characters WHERE drama_id = ? AND deleted_at IS NULL
        UNION ALL
        SELECT image_url, local_path, 'scene' AS source, 2 AS source_order, id
        FROM scenes WHERE drama_id = ? AND deleted_at IS NULL
        UNION ALL
        SELECT image_url, local_path, 'prop' AS source, 3 AS source_order, id
        FROM props WHERE drama_id = ? AND deleted_at IS NULL
      )
      WHERE (
        TRIM(COALESCE(local_path, '')) <> ''
        AND LOWER(local_path) NOT LIKE 'placeholder://%'
        AND LOWER(local_path) NOT LIKE 'mock://%'
        AND LOWER(local_path) NOT LIKE 'data:%'
      ) OR (
        TRIM(COALESCE(image_url, '')) <> ''
        AND LOWER(image_url) NOT LIKE 'placeholder://%'
        AND LOWER(image_url) NOT LIKE 'mock://%'
        AND LOWER(image_url) NOT LIKE 'data:%'
      )
      ORDER BY source_order ASC, id ASC
      LIMIT 1
    `).all(drama.id, drama.id, drama.id);
  } catch (_) {
    return;
  }

  const candidate = candidates[0];
  if (!candidate) return;

  drama.fallback_cover_local_path = String(candidate.local_path || '').trim() || null;
  drama.fallback_cover_image_url = sanitizeImageUrl(candidate.image_url);
  drama.fallback_cover_source = candidate.source;
}

function attachEpisodeStoryboards(db, ep) {
  const { dedupeStoryboardRowsByNumber } = require('./episodeStoryboardService');
  const storyboards = dedupeStoryboardRowsByNumber(
    db.prepare(
      'SELECT * FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL ORDER BY storyboard_number ASC, id ASC'
    ).all(ep.id)
  );
  ep.storyboards = storyboards.map((s) => rowToStoryboard(s));
  try {
    const sbIds = ep.storyboards.map((s) => s.id);
    if (sbIds.length > 0) {
      const placeholders = sbIds.map(() => '?').join(',');
      const spRows = db.prepare(
        `SELECT storyboard_id, prop_id FROM storyboard_props WHERE storyboard_id IN (${placeholders})`
      ).all(...sbIds);
      const spMap = {};
      for (const row of spRows) {
        if (!spMap[row.storyboard_id]) spMap[row.storyboard_id] = [];
        spMap[row.storyboard_id].push(row.prop_id);
      }
      for (const sb of ep.storyboards) {
        sb.prop_ids = spMap[sb.id] || [];
      }
    }
  } catch (_) {}
  ep.duration = ep.storyboards.reduce((sum, s) => sum + (s.duration || 0), 0);
  if (ep.duration > 0) ep.duration = Math.ceil(ep.duration / 60);
  return ep;
}

function attachEpisodeDetail(db, ep) {
  attachEpisodeStoryboards(db, ep);
  try {
    const epChars = db.prepare(
      `SELECT c.* FROM characters c
       INNER JOIN episode_characters ec ON c.id = ec.character_id
       WHERE ec.episode_id = ? AND c.deleted_at IS NULL
       ORDER BY c.sort_order ASC, c.name ASC`
    ).all(ep.id);
    ep.characters = epChars.map((c) => rowToCharacter(c));
  } catch (_) {
    ep.characters = [];
  }
  try {
    const epScenes = db.prepare(
      'SELECT * FROM scenes WHERE episode_id = ? AND deleted_at IS NULL ORDER BY id ASC'
    ).all(ep.id);
    ep.scenes = epScenes.map((s) => rowToScene(s));
  } catch (_) {
    ep.scenes = [];
  }
  try {
    const byEpisode = db.prepare(
      'SELECT * FROM props WHERE episode_id = ? AND deleted_at IS NULL ORDER BY id ASC'
    ).all(ep.id);
    const byStoryboard = db.prepare(
      `SELECT DISTINCT p.* FROM props p
       INNER JOIN storyboard_props sp ON p.id = sp.prop_id
       INNER JOIN storyboards sb ON sb.id = sp.storyboard_id AND sb.episode_id = ? AND sb.deleted_at IS NULL
       WHERE p.deleted_at IS NULL ORDER BY p.id ASC`
    ).all(ep.id);
    const seen = new Set();
    ep.props = [];
    for (const p of byEpisode) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        ep.props.push(rowToProp(p));
      }
    }
    for (const p of byStoryboard) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        ep.props.push(rowToProp(p));
      }
    }
    ep.props.sort((a, b) => a.id - b.id);
  } catch (_) {
    ep.props = [];
  }
  return ep;
}

function getTrashRetentionPolicy() {
  return {
    recoverable: true,
    associated_data: 'preserved',
    hard_delete_supported: false,
  };
}

function getDramaById(db, id) {
  const row = db.prepare('SELECT * FROM dramas WHERE id = ? AND deleted_at IS NULL').get(id);
  return row ? rowToDrama(row) : null;
}

function getDrama(db, dramaId, baseUrl) {
  if (!dramaWriteGuard.canReadDrama(db, dramaId)) return null;
  const drama = getDramaById(db, Number(dramaId));
  if (!drama) return null;
  const episodes = db.prepare(
    'SELECT * FROM episodes WHERE drama_id = ? AND deleted_at IS NULL ORDER BY episode_number ASC'
  ).all(drama.id);
  drama.episodes = episodes.map((e) => rowToEpisode(e));
  for (const ep of drama.episodes) {
    attachEpisodeDetail(db, ep);
  }
  const characters = db.prepare(
    'SELECT * FROM characters WHERE drama_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, name ASC'
  ).all(drama.id);
  drama.characters = characters.map((c) => rowToCharacter(c));
  const scenes = db.prepare(
    'SELECT * FROM scenes WHERE drama_id = ? AND deleted_at IS NULL ORDER BY id ASC'
  ).all(drama.id);
  drama.scenes = scenes.map((s) => rowToScene(s));
  const props = db.prepare(
    'SELECT * FROM props WHERE drama_id = ? AND deleted_at IS NULL ORDER BY id ASC'
  ).all(drama.id);
  drama.props = props.map((p) => rowToProp(p));
  return drama;
}

function listDramas(db, query = {}) {
  let sql = 'FROM dramas WHERE deleted_at IS NULL';
  const params = [];
  if (query.status) {
    sql += ' AND status = ?';
    params.push(query.status);
  }
  if (query.genre) {
    sql += ' AND genre = ?';
    params.push(query.genre);
  }
  const keyword = String(query.keyword || '').trim().slice(0, 200);
  if (keyword) {
    const conditions = [
      'title LIKE ?',
      'description LIKE ?',
      'genre LIKE ?',
      'style LIKE ?',
      'tags LIKE ?',
      'metadata LIKE ?',
    ];
    const k = '%' + keyword + '%';
    const searchParams = [k, k, k, k, k, k];
    const aliases = localizedDramaSearchAliases(keyword);
    if (aliases.styles.length) {
      conditions.push(`style IN (${aliases.styles.map(() => '?').join(', ')})`);
      searchParams.push(...aliases.styles);
    }
    if (aliases.genres.length) {
      conditions.push(`genre IN (${aliases.genres.map(() => '?').join(', ')})`);
      searchParams.push(...aliases.genres);
    }
    sql += ` AND (${conditions.join(' OR ')})`;
    params.push(...searchParams);
  }
  const countRow = db.prepare('SELECT COUNT(*) as total ' + sql).get(...params);
  const total = countRow.total || 0;
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.page_size, 10) || 20));
  const offset = (page - 1) * pageSize;
  const orderBy = {
    'created-desc': 'created_at DESC, id DESC',
    'title-asc': "LOWER(COALESCE(title, '')) ASC, id ASC",
    'updated-desc': 'updated_at DESC, id DESC',
  }[String(query.sort || '')] || 'updated_at DESC, id DESC';
  const list = db.prepare(
    'SELECT * ' + sql + ` ORDER BY ${orderBy} LIMIT ? OFFSET ?`
  ).all(...params, pageSize, offset);
  const dramas = list.map((r) => rowToDrama(r));
  for (const d of dramas) {
    const episodes = db.prepare(
      'SELECT * FROM episodes WHERE drama_id = ? AND deleted_at IS NULL ORDER BY episode_number ASC'
    ).all(d.id);
    d.episodes = episodes.map((e) => attachEpisodeStoryboards(db, rowToEpisode(e)));
    attachDramaListFallbackCover(db, d);
  }
  return { dramas, total, page, pageSize };
}

function listTrashedDramas(db, query = {}) {
  let sql = 'FROM dramas WHERE deleted_at IS NOT NULL';
  const params = [];
  const keyword = String(query.keyword || '').trim();
  if (keyword) {
    sql += ' AND (title LIKE ? OR description LIKE ?)';
    const pattern = `%${keyword}%`;
    params.push(pattern, pattern);
  }

  const countRow = db.prepare('SELECT COUNT(*) as total ' + sql).get(...params);
  const total = countRow.total || 0;
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.page_size, 10) || 20));
  const offset = (page - 1) * pageSize;
  const rows = db.prepare(
    'SELECT * ' + sql + ' ORDER BY deleted_at DESC, id DESC LIMIT ? OFFSET ?'
  ).all(...params, pageSize, offset);
  const retention = getTrashRetentionPolicy();
  const dramas = rows.map((row) => ({
    ...rowToDrama(row),
    removal_policy: retention,
  }));

  return { dramas, total, page, pageSize };
}

function getDramaStats(db) {
  const total = db.prepare('SELECT COUNT(*) as c FROM dramas WHERE deleted_at IS NULL').get().c;
  const byStatus = db.prepare(
    'SELECT status, COUNT(*) as count FROM dramas WHERE deleted_at IS NULL GROUP BY status'
  ).all();
  return { total, by_status: byStatus };
}

function getCharacters(db, dramaId, episodeId) {
  const did = Number(dramaId);
  const drama = getDramaById(db, did);
  if (!drama) return null;
  let rows;
  if (episodeId) {
    const exists = db.prepare('SELECT 1 FROM episodes WHERE id = ? AND drama_id = ?').get(episodeId, did);
    if (!exists) return null;
    rows = db.prepare(
      `SELECT c.* FROM characters c
       INNER JOIN episode_characters ec ON ec.character_id = c.id
       WHERE ec.episode_id = ? AND c.deleted_at IS NULL ORDER BY c.sort_order ASC, c.name ASC`
    ).all(episodeId);
  } else {
    rows = db.prepare(
      'SELECT * FROM characters WHERE drama_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, name ASC'
    ).all(did);
  }
  const characters = rows.map((r) => rowToCharacter(r));
  for (const c of characters) {
    const img = db.prepare(
      'SELECT status, error_msg FROM image_generations WHERE character_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(c.id);
    if (img && ['pending', 'processing', 'failed'].includes(img.status)) {
      c.image_generation_status = img.status;
      if (img.error_msg) c.image_generation_error = img.error_msg;
    }
  }
  return characters;
}

function downloadEpisodeVideo(db, episodeId) {
  const ep = db.prepare(
    'SELECT id, title, episode_number, video_url FROM episodes WHERE id = ? AND deleted_at IS NULL'
  ).get(episodeId);
  if (!ep) return null;
  if (!ep.video_url) return { error: '该剧集还没有生成视频' };
  return { video_url: ep.video_url, title: ep.title, episode_number: ep.episode_number };
}

module.exports = {
  localizedDramaSearchAliases,
  getTrashRetentionPolicy,
  getDramaById,
  getDrama,
  listDramas,
  listTrashedDramas,
  getDramaStats,
  getCharacters,
  downloadEpisodeVideo,
};
