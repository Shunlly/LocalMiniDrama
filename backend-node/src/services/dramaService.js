// 对应 Go application/services/drama_service.go

const storageLayout = require('./storageLayout');
const uploadService = require('./uploadService');
const { PRESET_VALUES, resolveStylePreset } = require('../constants/generationStylePresets');
const seedance2AssetGuards = require('../utils/seedance2AssetGuards');
const {
  assertBackgroundTasksAccepting,
  scheduleLegacyAsync,
} = require('./legacyAsyncSchedulerService');

/**
 * 清理 image_url：如果数据库中存储的是 base64 data URL，则返回 null。
 * 图片应通过 local_path → /static/{local_path} 访问，base64 不应通过 API 透传（会严重膨胀响应体）。
 */
function sanitizeImageUrl(url) {
  if (!url) return null;
  if (String(url).startsWith('data:')) return null;
  return url;
}

function parseJsonColumn(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}

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

function createDrama(db, log, req) {
  const now = new Date().toISOString();
  let meta = {};
  if (req.metadata) {
    try {
      meta =
        typeof req.metadata === 'string'
          ? JSON.parse(req.metadata)
          : { ...req.metadata };
    } catch (_) {
      meta = {};
    }
  }
  if (!meta.storage_folder_label) {
    meta.storage_folder_label = storageLayout.sanitizeFolderLabel(req.title || '');
  }
  const metadataStr = Object.keys(meta).length ? JSON.stringify(meta) : null;
  const stmt = db.prepare(`
    INSERT INTO dramas (title, description, genre, style, metadata, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)
  `);
  const info = stmt.run(
    req.title || '',
    req.description || null,
    req.genre || null,
    req.style || 'realistic',
    metadataStr,
    now,
    now
  );
  const id = info.lastInsertRowid;
  log.info('Drama created', { drama_id: id });
  return getDramaById(db, id);
}

function getDramaById(db, id) {
  const row = db.prepare('SELECT * FROM dramas WHERE id = ? AND deleted_at IS NULL').get(id);
  return row ? rowToDrama(row) : null;
}

function getDrama(db, dramaId, baseUrl) {
  const drama = getDramaById(db, Number(dramaId));
  if (!drama) return null;
  // 加载 episodes、characters、scenes、props、storyboards（简化：只查当前 drama 的）
  const episodes = db.prepare(
    'SELECT * FROM episodes WHERE drama_id = ? AND deleted_at IS NULL ORDER BY episode_number ASC'
  ).all(drama.id);
  drama.episodes = episodes.map((e) => rowToEpisode(e));
  const { dedupeStoryboardRowsByNumber } = require('./episodeStoryboardService');
  for (const ep of drama.episodes) {
    const storyboards = dedupeStoryboardRowsByNumber(
      db.prepare(
        'SELECT * FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL ORDER BY storyboard_number ASC, id ASC'
      ).all(ep.id)
    );
    ep.storyboards = storyboards.map((s) => rowToStoryboard(s));
    // 批量加载 storyboard_props，附加到对应分镜
    try {
      const sbIds = ep.storyboards.map((s) => s.id);
      if (sbIds.length > 0) {
        const placeholders = sbIds.map(() => '?').join(',');
        const spRows = db.prepare(`SELECT storyboard_id, prop_id FROM storyboard_props WHERE storyboard_id IN (${placeholders})`).all(...sbIds);
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
    if (ep.duration > 0) ep.duration = Math.ceil(ep.duration / 60); // 转为分钟
    // 本集关联的角色（与 Go Preload("Episodes.Characters") 一致）
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
    // 本集关联的场景（与 Go Preload("Episodes.Scenes") 一致，用于提取完成后展示）
    try {
      const epScenes = db.prepare(
        'SELECT * FROM scenes WHERE episode_id = ? AND deleted_at IS NULL ORDER BY id ASC'
      ).all(ep.id);
      ep.scenes = epScenes.map((s) => rowToScene(s));
    } catch (_) {
      ep.scenes = [];
    }
    // 本集关联的道具：本集提取的（episode_id=本集）+ 本集分镜中出现的（storyboard_props），合并去重
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
    d.episodes = episodes.map((e) => {
      const ep = rowToEpisode(e);
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
          const spRows = db.prepare(`SELECT storyboard_id, prop_id FROM storyboard_props WHERE storyboard_id IN (${placeholders})`).all(...sbIds);
          const spMap = {};
          for (const row of spRows) {
            if (!spMap[row.storyboard_id]) spMap[row.storyboard_id] = [];
            spMap[row.storyboard_id].push(row.prop_id);
          }
          for (const sb of ep.storyboards) sb.prop_ids = spMap[sb.id] || [];
        }
      } catch (_) {}
      ep.duration = ep.storyboards.reduce((sum, s) => sum + (s.duration || 0), 0);
      if (ep.duration > 0) ep.duration = Math.ceil(ep.duration / 60);
      return ep;
    });
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

function updateDrama(db, log, dramaId, req) {
  const drama = getDramaById(db, Number(dramaId));
  if (!drama) return null;
  const updates = [];
  const params = [];
  if (req.title != null) {
    updates.push('title = ?');
    params.push(req.title);
  }
  if (req.description != null) {
    updates.push('description = ?');
    params.push(req.description || null);
  }
  if (req.genre != null) {
    updates.push('genre = ?');
    params.push(req.genre || null);
  }
  if (req.status != null) {
    updates.push('status = ?');
    params.push(req.status);
  }
  if (updates.length === 0) return drama;
  params.push(new Date().toISOString(), dramaId);
  db.prepare(
    'UPDATE dramas SET ' + updates.join(', ') + ', updated_at = ? WHERE id = ?'
  ).run(...params);
  log.info('Drama updated', { drama_id: dramaId });
  return getDramaById(db, dramaId);
}

function generateStoryboard(db, log, episodeId, options) {
  const episodeStoryboardService = require('./episodeStoryboardService');
  const { model, style, storyboard_count, video_duration, aspect_ratio, include_narration, universal_omni_storyboard } = options || {};
  // 转换可能为字符串的数字
  const count = storyboard_count ? Number(storyboard_count) : undefined;
  const duration = video_duration ? Number(video_duration) : undefined;
  return episodeStoryboardService.generateStoryboard(
    db,
    log,
    episodeId,
    model || undefined,
    style,
    count,
    duration,
    aspect_ratio,
    include_narration,
    universal_omni_storyboard
  );
}

function getTrashRetentionPolicy() {
  return {
    recoverable: true,
    associated_data: 'preserved',
    hard_delete_supported: false,
  };
}

function moveDramaToTrash(db, log, dramaId) {
  const id = Number(dramaId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const removedAt = new Date().toISOString();
  const result = db.prepare(
    'UPDATE dramas SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL'
  ).run(removedAt, id);
  if (result.changes === 0) return null;

  const row = db.prepare('SELECT * FROM dramas WHERE id = ? AND deleted_at IS NOT NULL').get(id);
  log.info('Drama moved to trash', {
    drama_id: id,
    associated_data: 'preserved',
    recoverable: true,
  });
  return row ? rowToDrama(row) : null;
}

function restoreDrama(db, log, dramaId) {
  const id = Number(dramaId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const restoredAt = new Date().toISOString();
  const result = db.prepare(
    'UPDATE dramas SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL'
  ).run(restoredAt, id);
  if (result.changes === 0) return null;

  log.info('Drama restored from trash', {
    drama_id: id,
    associated_data: 'preserved',
  });
  return getDramaById(db, id);
}

function getDramaStats(db) {
  const total = db.prepare('SELECT COUNT(*) as c FROM dramas WHERE deleted_at IS NULL').get().c;
  const byStatus = db.prepare(
    'SELECT status, COUNT(*) as count FROM dramas WHERE deleted_at IS NULL GROUP BY status'
  ).all();
  return { total, by_status: byStatus };
}

function rowToDrama(r) {
  let metadata = r.metadata;
  if (typeof metadata === 'string') {
    try {
      metadata = JSON.parse(metadata);
    } catch (e) {
      metadata = {};
    }
  }
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    genre: r.genre,
    style: r.style || 'realistic',
    total_episodes: r.total_episodes ?? 1,
    total_duration: r.total_duration ?? 0,
    status: r.status || 'draft',
    thumbnail: r.thumbnail,
    tags: r.tags,
    metadata: metadata || {},
    created_at: r.created_at,
    updated_at: r.updated_at,
    removed_at: r.deleted_at || null,
    is_removed: Boolean(r.deleted_at),
  };
}

function rowToEpisode(r) {
  return {
    id: r.id,
    drama_id: r.drama_id,
    episode_number: r.episode_number,
    title: r.title,
    script_content: r.script_content,
    description: r.description,
    duration: r.duration ?? 0,
    status: r.status || 'draft',
    video_url: r.video_url,
    thumbnail: r.thumbnail,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function parseStoryboardCharacters(charactersStr) {
  if (!charactersStr || typeof charactersStr !== 'string') return [];
  try {
    const parsed = JSON.parse(charactersStr);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((c) => (typeof c === 'object' && c != null && c.id != null ? Number(c.id) : Number(c))).filter((n) => Number.isFinite(n));
  } catch (_) {
    return [];
  }
}

function rowToStoryboard(r) {
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
    continuity_snapshot: r.continuity_snapshot ?? null,
    video_prompt: r.video_prompt,
      shot_type: r.shot_type ?? null,
      angle: r.angle ?? null,
      angle_h: r.angle_h ?? null,
      angle_v: r.angle_v ?? null,
      angle_s: r.angle_s ?? null,
      movement: r.movement ?? null,
      lighting_style: r.lighting_style ?? null,
      depth_of_field: r.depth_of_field ?? null,
      segment_index: r.segment_index ?? 0,
      segment_title: r.segment_title ?? null,
      creation_mode: r.creation_mode === 'universal' ? 'universal' : 'classic',
      universal_segment_text: r.universal_segment_text ?? null,
      layout_description: r.layout_description ?? null,
      first_frame_image_id: r.first_frame_image_id ?? null,
      last_frame_image_id: r.last_frame_image_id ?? null,
      last_frame_image_url: sanitizeImageUrl(r.last_frame_image_url),
      last_frame_local_path: r.last_frame_local_path ?? null,
      characters: parseStoryboardCharacters(r.characters),
      composed_image: r.composed_image,
      image_url: sanitizeImageUrl(r.image_url),
      local_path: r.local_path ?? null,
      main_panel_idx: r.main_panel_idx != null ? Number(r.main_panel_idx) : null,
      video_url: r.video_url,
      video_local_path: r.video_local_path ?? null,
      reference_images: parseJsonColumn(r.reference_images) || [],
      video_reference_image_id: r.video_reference_image_id ?? null,
      audio_local_path: r.audio_local_path ?? null,
      narration_audio_local_path: r.narration_audio_local_path ?? null,
      status: r.status || 'pending',
      error_msg: r.error_msg,
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
}

function rowToCharacter(r) {
  return {
    id: r.id,
    drama_id: r.drama_id,
    name: r.name,
    role: r.role,
    description: r.description,
    appearance: r.appearance,
    personality: r.personality,
    voice_style: r.voice_style,
    image_url: sanitizeImageUrl(r.image_url),
    local_path: r.local_path,
    extra_images: r.extra_images || null,
    ref_image: r.ref_image || null,
    reference_images: r.reference_images,
    seed_value: r.seed_value,
    sort_order: r.sort_order ?? 0,
    error_msg: r.error_msg,
    polished_prompt: r.polished_prompt || null,
    negative_prompt: r.negative_prompt || null,
    four_view_image_url: r.four_view_image_url || null,
    seedance2_asset: parseJsonColumn(r.seedance2_asset),
    seedance2_voice_asset: parseJsonColumn(r.seedance2_voice_asset),
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function rowToScene(r) {
  return {
    id: r.id,
    drama_id: r.drama_id,
    location: r.location,
    time: r.time,
    prompt: r.prompt,
    polished_prompt: r.polished_prompt || null,
    negative_prompt: r.negative_prompt || null,
    storyboard_count: r.storyboard_count ?? 1,
    image_url: sanitizeImageUrl(r.image_url),
    local_path: r.local_path,
    extra_images: r.extra_images || null,
    ref_image: r.ref_image || null,
    status: r.status || 'pending',
    error_msg: r.error_msg,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function rowToProp(r) {
  return {
    id: r.id,
    drama_id: r.drama_id,
    name: r.name,
    type: r.type,
    description: r.description,
    prompt: r.prompt,
    image_url: sanitizeImageUrl(r.image_url),
    local_path: r.local_path,
    extra_images: r.extra_images || null,
    ref_image: r.ref_image || null,
    negative_prompt: r.negative_prompt || null,
    error_msg: r.error_msg,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function saveOutline(db, log, dramaId, req) {
  const drama = getDramaById(db, Number(dramaId));
  if (!drama) return false;
  const now = new Date().toISOString();
  const tagsStr = Array.isArray(req.tags) ? JSON.stringify(req.tags) : null;
  // Merge new metadata with existing metadata
  let existingMetadata = {};
  if (drama.metadata) {
    try {
      existingMetadata = typeof drama.metadata === 'string' ? JSON.parse(drama.metadata) : drama.metadata;
    } catch (e) {
      existingMetadata = {};
    }
  }
  let newMetadata = {};
  if (req.metadata) {
    try {
      newMetadata = typeof req.metadata === 'string' ? JSON.parse(req.metadata) : req.metadata;
    } catch (e) {
      newMetadata = {};
    }
  }
  const mergedMetadata = { ...existingMetadata, ...newMetadata };

  // 与 mergeCfgStyleWithDrama 一致：提示词优先读 metadata.style_prompt_*。仅改 dramas.style 而不带画风长文案时，
  // 若仍保留旧的 metadata 画风，会出现「列表/首页 badge 已是新 style，角色提示词却仍用旧画风」。
  if (req.style !== undefined) {
    const styleVal = String(req.style || '').trim();
    const hasExplicitStylePrompt =
      req.metadata &&
      typeof req.metadata === 'object' &&
      !Array.isArray(req.metadata) &&
      ('style_prompt_zh' in req.metadata || 'style_prompt_en' in req.metadata);
    if (!hasExplicitStylePrompt && styleVal) {
      const preset = resolveStylePreset(styleVal);
      if (preset) {
        mergedMetadata.style_prompt_zh = preset.zh;
        mergedMetadata.style_prompt_en = preset.en;
      }
    }
  }

  const metadataStr = JSON.stringify(mergedMetadata);
  
  db.prepare(
    `UPDATE dramas SET title = ?, description = ?, genre = ?, tags = ?, style = ?, metadata = ?, updated_at = ? WHERE id = ?`
  ).run(
    req.title || drama.title, 
    req.summary ?? drama.description, 
    req.genre !== undefined ? req.genre : drama.genre, 
    tagsStr, 
    req.style !== undefined ? req.style : drama.style, 
    metadataStr, 
    now, 
    dramaId
  );
  log.info('Outline saved', { drama_id: dramaId, style: req.style, genre: req.genre, metadata: mergedMetadata });
  return true;
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

function saveCharacters(db, log, dramaId, req) {
  const did = Number(dramaId);
  const drama = getDramaById(db, did);
  if (!drama) return false;
  if (req.episode_id) {
    const ep = db.prepare('SELECT 1 FROM episodes WHERE id = ? AND drama_id = ?').get(req.episode_id, did);
    if (!ep) return false;
  }
  const characterIds = [];
  const chars = req.characters || [];
  for (const char of chars) {
    if (char.id) {
      const ex = db.prepare('SELECT id FROM characters WHERE id = ? AND drama_id = ?').get(char.id, did);
      if (ex) {
        characterIds.push(ex.id);
        // 只更新文本字段；image_url / local_path 仅在调用方显式传入时才覆盖，防止漏传字段清空已有图片
        const imgFields = [];
        const imgParams = [];
        if ('image_url' in char) { imgFields.push('image_url = ?'); imgParams.push(char.image_url ?? null); }
        if ('local_path' in char) { imgFields.push('local_path = ?'); imgParams.push(char.local_path ?? null); }
        if (imgFields.length > 0) {
          const prevC = db
            .prepare('SELECT id, local_path, image_url, seedance2_asset FROM characters WHERE id = ? AND deleted_at IS NULL')
            .get(char.id);
          if (prevC) {
            seedance2AssetGuards.markStaleOnCharacterMainImageDrift(db, log, prevC, {
              image_url: 'image_url' in char ? char.image_url : prevC.image_url,
              local_path: 'local_path' in char ? char.local_path : prevC.local_path,
            });
          }
        }
        const imgSql = imgFields.length > 0 ? ', ' + imgFields.join(', ') : '';
        let setCore = 'name = ?, role = ?, description = ?, personality = ?, appearance = ?';
        const coreParams = [char.name, char.role ?? null, char.description ?? null, char.personality ?? null, char.appearance ?? null];
        if ('negative_prompt' in char) {
          setCore += ', negative_prompt = ?';
          coreParams.push(char.negative_prompt ?? null);
        }
        db.prepare(
          `UPDATE characters SET ${setCore}${imgSql}, updated_at = ? WHERE id = ?`
        ).run(...coreParams, ...imgParams, new Date().toISOString(), char.id);
        continue;
      }
    }
    const byName = db.prepare('SELECT id FROM characters WHERE drama_id = ? AND name = ?').get(did, char.name);
    if (byName) {
      characterIds.push(byName.id);
      // 如果通过名字找到已存在的角色（包含软删除的），也要更新它的信息并复活
      const imgFieldsN = [];
      const imgParamsN = [];
      if ('image_url' in char) { imgFieldsN.push('image_url = ?'); imgParamsN.push(char.image_url ?? null); }
      if ('local_path' in char) { imgFieldsN.push('local_path = ?'); imgParamsN.push(char.local_path ?? null); }
      if (imgFieldsN.length > 0) {
        const prevN = db
          .prepare('SELECT id, local_path, image_url, seedance2_asset FROM characters WHERE id = ?')
          .get(byName.id);
        if (prevN) {
          seedance2AssetGuards.markStaleOnCharacterMainImageDrift(db, log, prevN, {
            image_url: 'image_url' in char ? char.image_url : prevN.image_url,
            local_path: 'local_path' in char ? char.local_path : prevN.local_path,
          });
        }
      }
      const imgSqlN = imgFieldsN.length > 0 ? ', ' + imgFieldsN.join(', ') : '';
      let setCoreN = 'role = ?, description = ?, personality = ?, appearance = ?';
      const coreParamsN = [char.role ?? null, char.description ?? null, char.personality ?? null, char.appearance ?? null];
      if ('negative_prompt' in char) {
        setCoreN += ', negative_prompt = ?';
        coreParamsN.push(char.negative_prompt ?? null);
      }
      db.prepare(
        `UPDATE characters SET ${setCoreN}${imgSqlN}, updated_at = ?, deleted_at = NULL WHERE id = ?`
      ).run(...coreParamsN, ...imgParamsN, new Date().toISOString(), byName.id);
      continue;
    }
    const now = new Date().toISOString();
    const info = db.prepare(
      `INSERT INTO characters (drama_id, name, role, description, personality, appearance, image_url, local_path, negative_prompt, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    ).run(did, char.name, char.role ?? null, char.description ?? null, char.personality ?? null, char.appearance ?? null, char.image_url ?? null, char.local_path ?? null, char.negative_prompt ?? null, now, now);
    characterIds.push(info.lastInsertRowid);
  }
  if (req.episode_id && characterIds.length > 0) {
    db.prepare('DELETE FROM episode_characters WHERE episode_id = ?').run(req.episode_id);
    const ins = db.prepare('INSERT OR IGNORE INTO episode_characters (episode_id, character_id) VALUES (?, ?)');
    for (const cid of characterIds) ins.run(req.episode_id, cid);
  }
  db.prepare('UPDATE dramas SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), did);
  log.info('Characters saved', { drama_id: dramaId, count: chars.length });
  return true;
}

function saveEpisodes(db, log, dramaId, req) {
  const did = Number(dramaId);
  const drama = getDramaById(db, did);
  if (!drama) return false;
  const episodes = req.episodes || [];
  const now = new Date().toISOString();

  // 按 episode_number upsert：保留已有分集的 id，避免关联数据（角色/场景/道具/分镜）孤岛化
  const keptNumbers = new Set();
  for (const ep of episodes) {
    const num = ep.episode_number ?? 0;
    keptNumbers.add(num);
    // 查找已有的（包含软删除的，以防重新激活）
    const existing = db.prepare(
      'SELECT id FROM episodes WHERE drama_id = ? AND episode_number = ? ORDER BY deleted_at IS NOT NULL ASC, id ASC LIMIT 1'
    ).get(did, num);
    if (existing) {
      // 更新已有分集，保留 id
      db.prepare(
        `UPDATE episodes SET title = ?, script_content = ?, description = ?, duration = ?, deleted_at = NULL, updated_at = ? WHERE id = ?`
      ).run(ep.title || '', ep.script_content ?? null, ep.description ?? null, ep.duration ?? 0, now, existing.id);
    } else {
      // 新增
      db.prepare(
        `INSERT INTO episodes (drama_id, episode_number, title, script_content, description, duration, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)`
      ).run(did, num, ep.title || '', ep.script_content ?? null, ep.description ?? null, ep.duration ?? 0, now, now);
    }
  }

  // 软删除本次未提交的分集（如用户删掉了某一集）
  const liveEpisodes = db.prepare(
    'SELECT id, episode_number FROM episodes WHERE drama_id = ? AND deleted_at IS NULL'
  ).all(did);
  for (const row of liveEpisodes) {
    if (!keptNumbers.has(row.episode_number)) {
      db.prepare('UPDATE episodes SET deleted_at = ? WHERE id = ?').run(now, row.id);
    }
  }

  db.prepare('UPDATE dramas SET updated_at = ? WHERE id = ?').run(now, did);
  log.info('Episodes saved', { drama_id: dramaId, count: episodes.length });
  return true;
}

function saveProgress(db, log, dramaId, req) {
  const drama = getDramaById(db, Number(dramaId));
  if (!drama) return false;
  // getDramaById 已通过 rowToDrama 把 metadata 解析为对象，不能对 object 再 JSON.parse，否则进 catch 得到 {} 会整表覆盖掉画风等字段
  const meta = storageLayout.parseMetadata(drama.metadata);
  meta.current_step = req.current_step;
  if (req.step_data) meta.step_data = req.step_data;
  const now = new Date().toISOString();
  db.prepare('UPDATE dramas SET metadata = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(meta), now, dramaId);
  log.info('Progress saved', { drama_id: dramaId, step: req.current_step });
  return true;
}

const FREE_CANVAS_NODE_TYPES = new Set(['text', 'image', 'video', 'config', 'reference']);
const FREE_CANVAS_NODE_FIELDS = new Set([
  'content',
  'text',
  'label',
  'title',
  'name',
  'description',
  'prompt',
  'storageKey',
  'asset_ref',
  'storyboard_ref',
  'assetId',
  'storyboardId',
  'episodeId',
  'sceneId',
  'width',
  'height',
  'zIndex',
  'collapsed',
  'locked',
]);
const FREE_CANVAS_EDGE_FIELDS = new Set(['type', 'label', 'animated']);
const FREE_CANVAS_ROOT_FIELDS = new Set(['projectId', 'dramaId', 'episodeId', 'title']);
const FREE_CANVAS_SENSITIVE_KEYS = new Set([
  'apikey',
  'authorization',
  'headers',
  'requestheaders',
  'responseheaders',
  'providerresponse',
  'rawproviderresponse',
  'rawresponse',
  'response',
  'token',
  'secret',
  'password',
  'credential',
  'credentials',
  'cookie',
  'cookies',
]);
const MAX_FREE_CANVAS_NODES = 500;
const MAX_FREE_CANVAS_EDGES = 1000;
const MAX_FREE_CANVAS_TEXT_LENGTH = 50000;
const MAX_FREE_CANVAS_DIMENSION = 10000;
const MAX_FREE_CANVAS_DEPTH = 20;

function canvasBadRequest(message) {
  const err = new Error(message);
  err.code = 'BAD_REQUEST';
  return err;
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function normalizedCanvasKey(key) {
  return String(key).replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function isSensitiveCanvasKey(key) {
  return FREE_CANVAS_SENSITIVE_KEYS.has(normalizedCanvasKey(key));
}

function isRuntimeMediaUrl(value) {
  return typeof value === 'string' && /^(?:blob:|data:)/i.test(value);
}

function sanitizeFreeCanvasValue(value, seen = new WeakSet(), depth = 0) {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    return undefined;
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw canvasBadRequest('free_canvas 包含非有限数值');
    return value;
  }
  if (typeof value === 'string') return isRuntimeMediaUrl(value) ? undefined : value;
  if (typeof value !== 'object') return undefined;
  if (depth >= MAX_FREE_CANVAS_DEPTH || seen.has(value)) {
    throw canvasBadRequest('free_canvas 包含过深或循环数据');
  }

  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    result = value
      .map((entry) => sanitizeFreeCanvasValue(entry, seen, depth + 1))
      .filter((entry) => entry !== undefined);
  } else {
    result = {};
    for (const [key, entry] of Object.entries(value)) {
      if (isSensitiveCanvasKey(key)) continue;
      const sanitized = sanitizeFreeCanvasValue(entry, seen, depth + 1);
      if (sanitized !== undefined) result[key] = sanitized;
    }
  }
  seen.delete(value);
  return result;
}

function assertCanvasString(value, field, { optional = false } = {}) {
  if (value === undefined && optional) return undefined;
  if (typeof value !== 'string' || !value || value.length > MAX_FREE_CANVAS_TEXT_LENGTH) {
    throw canvasBadRequest(`${field} 必须为非空且受限的字符串`);
  }
  return value;
}

function optionalScopedId(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = typeof value === 'number'
    ? value
    : (typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw canvasBadRequest(`${field} 必须为正整数引用`);
  }
  return normalized;
}

function optionalOpaqueReferenceId(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string' && !/^\d+$/.test(value)) return null;
  return optionalScopedId(value, field);
}

function assertScopedFreeCanvasReference(db, dramaId, table, id, field) {
  if (id == null) return;
  const row = db.prepare(
    `SELECT 1 FROM ${table} WHERE ${table}.id = ? AND ${table}.deleted_at IS NULL`
  ).get(id);
  if (!row) throw canvasBadRequest(`${field} 引用不存在`);
  const owner = db.prepare(
    table === 'storyboards'
      ? `SELECT e.drama_id FROM storyboards s JOIN episodes e ON e.id = s.episode_id AND e.deleted_at IS NULL WHERE s.id = ? AND s.deleted_at IS NULL`
      : `SELECT drama_id FROM ${table} WHERE id = ? AND deleted_at IS NULL`
  ).get(id);
  if (!owner || Number(owner.drama_id) !== Number(dramaId)) {
    throw canvasBadRequest(`${field} 不属于当前项目`);
  }
}

function assertAssetReferenceScope(db, dramaId, id, field) {
  if (id == null) return;
  const asset = db.prepare('SELECT drama_id FROM assets WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!asset) throw canvasBadRequest(`${field} 引用不存在`);
  if (asset.drama_id != null && Number(asset.drama_id) !== Number(dramaId)) {
    throw canvasBadRequest(`${field} 不属于当前项目`);
  }
}

function sanitizeFreeCanvasNode(db, dramaId, input, ids) {
  if (!isPlainObject(input)) throw canvasBadRequest('free_canvas 节点必须为对象');
  const id = assertCanvasString(input.id, 'free_canvas node id');
  if (ids.has(id)) throw canvasBadRequest('free_canvas node id 必须唯一');
  ids.add(id);
  if (!FREE_CANVAS_NODE_TYPES.has(input.type)) {
    throw canvasBadRequest('free_canvas node type 不受支持');
  }
  if (!isPlainObject(input.position) || !Number.isFinite(input.position.x) || !Number.isFinite(input.position.y)) {
    throw canvasBadRequest('free_canvas node position 必须包含有限坐标');
  }

  const node = {
    id,
    type: input.type,
    position: { x: input.position.x, y: input.position.y },
  };
  for (const field of FREE_CANVAS_NODE_FIELDS) {
    if (input[field] === undefined) continue;
    if ((field === 'width' || field === 'height')) {
      if (!Number.isFinite(input[field]) || input[field] <= 0 || input[field] > MAX_FREE_CANVAS_DIMENSION) {
        throw canvasBadRequest(`free_canvas node ${field} 必须为正且受限的数值`);
      }
      node[field] = input[field];
      continue;
    }
    const value = sanitizeFreeCanvasValue(input[field]);
    if (typeof value === 'string' && value.length > MAX_FREE_CANVAS_TEXT_LENGTH) {
      throw canvasBadRequest(`free_canvas node ${field} 超出长度限制`);
    }
    if (value !== undefined) node[field] = value;
  }

  const assetId = optionalScopedId(node.assetId, 'assetId');
  const assetRefId = optionalOpaqueReferenceId(node.asset_ref, 'asset_ref');
  const storyboardId = optionalScopedId(node.storyboardId, 'storyboardId');
  const storyboardRefId = optionalOpaqueReferenceId(node.storyboard_ref, 'storyboard_ref');
  const episodeId = optionalScopedId(node.episodeId, 'episode');
  const sceneId = optionalScopedId(node.sceneId, 'scene');
  assertAssetReferenceScope(db, dramaId, assetId, 'asset');
  assertAssetReferenceScope(db, dramaId, assetRefId, 'asset_ref');
  assertScopedFreeCanvasReference(db, dramaId, 'storyboards', storyboardId, 'storyboard');
  assertScopedFreeCanvasReference(db, dramaId, 'storyboards', storyboardRefId, 'storyboard_ref');
  assertScopedFreeCanvasReference(db, dramaId, 'episodes', episodeId, 'episode');
  assertScopedFreeCanvasReference(db, dramaId, 'scenes', sceneId, 'scene');
  return node;
}

function sanitizeFreeCanvas(db, dramaId, input) {
  if (!isPlainObject(input)) throw canvasBadRequest('free_canvas 必须为对象');
  if (input.version !== 1) throw canvasBadRequest('free_canvas version 不受支持');
  if (input.mode !== undefined && (typeof input.mode !== 'string' || input.mode.length > 64)) {
    throw canvasBadRequest('free_canvas mode 必须为受限字符串');
  }
  if (!Array.isArray(input.nodes) || !Array.isArray(input.edges)) {
    throw canvasBadRequest('free_canvas nodes 和 edges 必须为数组');
  }
  if (input.nodes.length > MAX_FREE_CANVAS_NODES || input.edges.length > MAX_FREE_CANVAS_EDGES) {
    throw canvasBadRequest('free_canvas 超出节点或边数量限制');
  }
  for (const field of ['projectId', 'dramaId']) {
    if (input[field] !== undefined && optionalScopedId(input[field], field) !== Number(dramaId)) {
      throw canvasBadRequest(`free_canvas ${field} 不属于当前项目`);
    }
  }

  const nodes = [];
  const nodeIds = new Set();
  for (const node of input.nodes) nodes.push(sanitizeFreeCanvasNode(db, dramaId, node, nodeIds));
  const edgeIds = new Set();
  const edges = input.edges.map((edge) => {
    if (!isPlainObject(edge)) throw canvasBadRequest('free_canvas edge 必须为对象');
    const id = assertCanvasString(edge.id, 'free_canvas edge id');
    if (edgeIds.has(id)) throw canvasBadRequest('free_canvas edge id 必须唯一');
    edgeIds.add(id);
    const source = assertCanvasString(edge.source, 'free_canvas edge source');
    const target = assertCanvasString(edge.target, 'free_canvas edge target');
    if (!nodeIds.has(source) || !nodeIds.has(target)) {
      throw canvasBadRequest('free_canvas edge 引用了不存在的节点');
    }
    const result = { id, source, target };
    for (const field of FREE_CANVAS_EDGE_FIELDS) {
      const value = sanitizeFreeCanvasValue(edge[field]);
      if (typeof value === 'string' && value.length > MAX_FREE_CANVAS_TEXT_LENGTH) {
        throw canvasBadRequest(`free_canvas edge ${field} 超出长度限制`);
      }
      if (value !== undefined) result[field] = value;
    }
    return result;
  });

  const result = { version: 1, mode: input.mode || 'production' };
  for (const field of FREE_CANVAS_ROOT_FIELDS) {
    const value = sanitizeFreeCanvasValue(input[field]);
    if (value !== undefined) result[field] = value;
  }
  result.nodes = nodes;
  result.edges = edges;
  return result;
}

/** 保存画布布局 / 工作流组到 metadata（合并现有 metadata） */
function saveCanvasLayout(db, log, dramaId, req) {
  const drama = getDramaById(db, Number(dramaId));
  if (!drama) return null;
  const layout = req?.canvas_layout;
  const freeCanvas = req?.free_canvas;
  const workflowGroups = req?.workflow_groups;
  if (
    (layout == null || typeof layout !== 'object' || Array.isArray(layout)) &&
    freeCanvas === undefined &&
    workflowGroups === undefined
  ) {
    throw canvasBadRequest('请提供 canvas_layout、free_canvas 或 workflow_groups');
  }
  if (layout != null && (typeof layout !== 'object' || Array.isArray(layout))) {
    throw canvasBadRequest('canvas_layout 必须为对象');
  }
  if (workflowGroups !== undefined && !Array.isArray(workflowGroups)) {
    throw canvasBadRequest('workflow_groups 必须为数组');
  }
  const validatedFreeCanvas = freeCanvas === undefined
    ? undefined
    : sanitizeFreeCanvas(db, Number(dramaId), freeCanvas);
  const meta = storageLayout.parseMetadata(drama.metadata);
  if (layout) meta.canvas_layout = layout;
  if (validatedFreeCanvas !== undefined) meta.free_canvas = validatedFreeCanvas;
  if (workflowGroups !== undefined) meta.workflow_groups = workflowGroups;
  const now = new Date().toISOString();
  db.prepare('UPDATE dramas SET metadata = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(meta), now, dramaId);
  log.info('Canvas state saved', {
    drama_id: dramaId,
    node_count: layout ? Object.keys(layout.nodes || {}).length : undefined,
    free_node_count: validatedFreeCanvas ? validatedFreeCanvas.nodes.length : undefined,
    workflow_group_count: workflowGroups ? workflowGroups.length : undefined,
  });
  return getDrama(db, dramaId);
}

/**
 * 取某分镜的视频地址：优先使用用户手动选定的 storyboard.video_url，否则取最新完成的 video_generations 记录
 */
function getVideoUrlForStoryboard(db, storyboardId, baseUrl) {
  // 1. 获取 storyboard 表中的视频信息（代表用户选定或上次同步的结果）
  const sb = db.prepare('SELECT video_url, video_local_path, updated_at FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(storyboardId);
  
  // 2. 获取 video_generations 表中最新完成的记录
  const vg = db.prepare(
    "SELECT video_url, local_path, completed_at, updated_at, created_at FROM video_generations WHERE storyboard_id = ? AND status = 'completed' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1"
  ).get(storyboardId);

  // 辅助函数：构造完整 URL，优先使用本地路径（避免远程URL过期导致无法合并）
  const buildUrl = (videoUrl, localPath) => {
    const cfg = require('../config').loadConfig();
    const rawStorage = cfg?.storage?.local_path || './data/storage';
    const path = require('path');
    const storageRoot = path.isAbsolute(rawStorage) ? rawStorage : path.join(process.cwd(), rawStorage);
    for (const candidate of [localPath, videoUrl]) {
      const value = String(candidate || '').trim();
      if (!value) continue;
      try {
        const local = uploadService.resolveStorageReference(storageRoot, value);
        if (local) return local.relativePath;
      } catch (error) {
        if (!/^https?:\/\//i.test(value) || value.startsWith('/static/')) continue;
      }
      if (/^https?:\/\//i.test(value)) {
        try { return uploadService.assertPublicHttpUrlSyntax(value).toString(); } catch (_) { continue; }
      }
    }
    return null;
  };

  const sbUrl = sb ? buildUrl(sb.video_url, sb.video_local_path) : null;
  const vgUrl = vg ? buildUrl(vg.video_url, vg.local_path) : null;

  // 策略：比较时间，取最新的
  // 如果只有其中一个有 URL，直接用那个
  if (sbUrl && !vgUrl) return sbUrl;
  if (!sbUrl && vgUrl) return vgUrl;
  if (!sbUrl && !vgUrl) return null;

  // 都有 URL，比较时间
  // sb 使用 updated_at
  // vg 使用 completed_at > updated_at > created_at
  const sbTime = sb.updated_at || '1970-01-01';
  const vgTime = vg.completed_at || vg.updated_at || vg.created_at || '1970-01-01';

  // 如果生成记录的时间比分镜更新时间还晚（说明是重新生成的，且可能没回写），则优先用生成记录
  if (vgTime > sbTime) {
    return vgUrl;
  }
  
  // 否则依然以 storyboard 为准（可能是用户手动修改过，或者已经回写过）
  return sbUrl;
}

function findActiveEpisodeMerge(db, episodeId) {
  return db.prepare(
    `SELECT merge.id AS merge_id, merge.task_id, merge.scenes, merge.status
       FROM video_merges merge
       LEFT JOIN async_tasks task
         ON task.id = merge.task_id
        AND task.deleted_at IS NULL
      WHERE merge.episode_id = ?
        AND merge.deleted_at IS NULL
        AND (
          merge.status = 'qa_pending'
          OR (
            merge.status IN ('pending', 'processing')
            AND task.status IN ('pending', 'processing')
          )
        )
      ORDER BY merge.id DESC
      LIMIT 1`
  ).get(Number(episodeId));
}

function activeMergeResponse(activeMerge, episodeId) {
  let scenesCount = 0;
  try {
    const activeScenes = JSON.parse(activeMerge.scenes || '[]');
    scenesCount = Array.isArray(activeScenes) ? activeScenes.length : 0;
  } catch (_) {}
  return {
    message: activeMerge.status === 'qa_pending'
      ? '本集视频已合成，正在等待质量检查'
      : '本集已有视频合成任务正在处理',
    merge_id: activeMerge.merge_id,
    episode_id: Number(episodeId),
    scenes_count: scenesCount,
    task_id: activeMerge.task_id,
    reused: true,
  };
}

function finalizeEpisode(db, log, episodeId, baseUrl, body = {}) {
  const ep = db.prepare(
    'SELECT id, drama_id, episode_number, status, video_url, updated_at FROM episodes WHERE id = ? AND deleted_at IS NULL'
  ).get(episodeId);
  if (!ep) return null;
  const activeMerge = findActiveEpisodeMerge(db, episodeId);
  if (activeMerge) return activeMergeResponse(activeMerge, episodeId);
  const drama = db.prepare('SELECT title FROM dramas WHERE id = ? AND deleted_at IS NULL').get(ep.drama_id);
  const storyboards = db.prepare(
    'SELECT id, storyboard_number, duration FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL ORDER BY storyboard_number ASC'
  ).all(episodeId);
  const videoMergeService = require('./videoMergeService');
  const scenes = [];
  for (let i = 0; i < storyboards.length; i++) {
    const sb = storyboards[i];
    const videoUrl = getVideoUrlForStoryboard(db, sb.id, baseUrl);
    if (!videoUrl) {
      log.warn('Finalize skip storyboard (no video)', { storyboard_id: sb.id, storyboard_number: sb.storyboard_number });
      continue;
    }
    scenes.push({
      scene_id: sb.id,
      video_url: videoUrl,
      duration: Number(sb.duration) || 5,
      order: i,
    });
  }
  if (scenes.length === 0) {
    log.warn('Finalize no scenes with video', { episode_id: episodeId });
    return { message: '本集没有可合成的视频片段', merge_id: null, episode_id: episodeId, scenes_count: 0, task_id: null };
  }
  const title = drama && drama.title ? `${drama.title} - 第${ep.episode_number ?? episodeId}集` : null;
  const mergeReq = {
    episode_id: episodeId,
    drama_id: ep.drama_id,
    title,
    scenes,
    provider: 'ffmpeg',
    mode: 'strict_production',
    merge_options: {
      burn_narration_subtitles: !!(body && body.burn_narration_subtitles),
      burn_dialogue_audio: !!(body && body.burn_dialogue_audio),
      watermark_text: (body && body.watermark_text != null)
        ? String(body.watermark_text).trim().slice(0, 200)
        : '',
    },
  };
  assertBackgroundTasksAccepting();
  const createMerge = db.transaction(() => {
    const concurrentMerge = findActiveEpisodeMerge(db, episodeId);
    if (concurrentMerge) return { activeMerge: concurrentMerge };
    const created = videoMergeService.create(db, log, mergeReq);
    const mergeId = created.merge_id || created.id;
    db.prepare('UPDATE episodes SET status = ? WHERE id = ?').run('processing', episodeId);
    return { created, mergeId };
  });
  const persisted = createMerge();
  if (persisted.activeMerge) return activeMergeResponse(persisted.activeMerge, episodeId);
  const { created, mergeId } = persisted;
  try {
    scheduleLegacyAsync(
      log,
      'episode_video_merge',
      () => videoMergeService.processVideoMerge(db, log, mergeId, baseUrl),
      { merge_id: mergeId, episode_id: Number(episodeId) }
    );
  } catch (error) {
    const now = new Date().toISOString();
    const failUnscheduledMerge = db.transaction(() => {
      db.prepare(
        `UPDATE video_merges
            SET status = 'failed', completed_at = ?, error_msg = ?
          WHERE id = ?`
      ).run(now, String(error?.message || error).slice(0, 4000), mergeId);
      require('./taskService').updateTaskError(db, created.task_id, error?.message || String(error));
      db.prepare(
        `UPDATE episodes
            SET status = ?, video_url = ?, updated_at = ?
          WHERE id = ?
            AND ? = (SELECT id FROM video_merges WHERE episode_id = ? ORDER BY id DESC LIMIT 1)`
      ).run(ep.status, ep.video_url, ep.updated_at, episodeId, mergeId, episodeId);
    });
    failUnscheduledMerge();
    throw error;
  }
  return {
    message: '视频合成任务已创建，正在后台处理',
    merge_id: mergeId,
    episode_id: episodeId,
    scenes_count: scenes.length,
    task_id: created.task_id,
  };
}

function downloadEpisodeVideo(db, episodeId) {
  const ep = db.prepare('SELECT id, title, episode_number, video_url FROM episodes WHERE id = ? AND deleted_at IS NULL').get(episodeId);
  if (!ep) return null;
  if (!ep.video_url) return { error: '该剧集还没有生成视频' };
  return { video_url: ep.video_url, title: ep.title, episode_number: ep.episode_number };
}

module.exports = {
  createDrama,
  getDrama,
  getDramaById,
  listDramas,
  listTrashedDramas,
  updateDrama,
  moveDramaToTrash,
  restoreDrama,
  getTrashRetentionPolicy,
  getDramaStats,
  saveOutline,
  getCharacters,
  saveCharacters,
  saveEpisodes,
  saveProgress,
  saveCanvasLayout,
  finalizeEpisode,
  downloadEpisodeVideo,
  generateStoryboard,
};
