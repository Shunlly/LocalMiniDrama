// 对应 Go application/services/drama_service.go

const storageLayout = require('./storageLayout');
const uploadService = require('./uploadService');
const taskService = require('./taskService');
const { validateFreeCanvas, badRequest: canvasBadRequest } = require('./freeCanvasValidation');
const { PRESET_VALUES, resolveStylePreset } = require('../constants/generationStylePresets');
const seedance2AssetGuards = require('../utils/seedance2AssetGuards');
const dramaWriteGuard = require('./dramaWriteGuard');
const { randomUUID } = require('crypto');
const {
  assertBackgroundTasksAccepting,
  scheduleLegacyAsync,
} = require('./legacyAsyncSchedulerService');

const dramaRecycleRecoveryJobs = new Map();
const DRAMA_RECYCLE_RECOVERY_BASE_DELAY_MS = 1000;
const DRAMA_RECYCLE_RECOVERY_MAX_DELAY_MS = 10_000;
const DRAMA_RECYCLE_RECOVERY_MAX_ELAPSED_MS = 10 * 60 * 1000;
const DRAMA_RECYCLE_TASK_DRAIN_MAX_PASSES = 5;

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

function dramaRecycleError(message = '项目正在移入回收站，请等待当前操作完成') {
  const error = new Error(message);
  error.code = 'DRAMA_RECYCLE_IN_PROGRESS';
  error.statusCode = 409;
  return error;
}

const assertDramaWritable = dramaWriteGuard.assertDramaWritable;

function runDramaWriteTransaction(db, dramaId, mutation) {
  assertDramaWritable(db, dramaId);
  const persist = db.transaction(() => {
    assertDramaWritable(db, dramaId);
    return mutation();
  });
  return typeof persist.immediate === 'function' ? persist.immediate() : persist();
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
  if (!dramaWriteGuard.canReadDrama(db, dramaId)) return null;
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

function updateDramaUnsafe(db, log, dramaId, req) {
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

function updateDrama(db, log, dramaId, req) {
  return runDramaWriteTransaction(db, dramaId, () => updateDramaUnsafe(db, log, dramaId, req));
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

function taskScopeConflict(message, details) {
  const error = new Error(message);
  error.code = 'TASK_SCOPE_CONFLICT';
  error.statusCode = 409;
  error.details = details;
  return error;
}

function numericResourceId(value) {
  const normalized = String(value ?? '').trim();
  if (!/^[1-9]\d*$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function queryDramaIds(db, sql, ...params) {
  try {
    return db.prepare(sql).all(...params)
      .map((row) => Number(row.drama_id))
      .filter((value) => Number.isSafeInteger(value) && value > 0);
  } catch (error) {
    if (/no such table|no such column/i.test(error?.message || '')) return [];
    throw error;
  }
}

function declaredTaskDramaIds(db, task) {
  const type = String(task.type || '');
  const resource = String(task.resource_id || '').trim();
  const id = numericResourceId(resource);
  if (['character_generation', 'story_generation', 'video_generation'].includes(type)) {
    return id ? [id] : [];
  }
  if (['background_extraction', 'prop_extraction', 'storyboard_generation', 'video_merge', 'character_extraction'].includes(type)) {
    return id ? queryDramaIds(db, 'SELECT drama_id FROM episodes WHERE id = ?', id) : [];
  }
  if (type === 'frame_prompt_generation') {
    return id ? queryDramaIds(
      db,
      `SELECT episode.drama_id FROM storyboards storyboard
        JOIN episodes episode ON episode.id = storyboard.episode_id
       WHERE storyboard.id = ?`,
      id
    ) : [];
  }
  if (['prop_image_generation'].includes(type)) {
    return id ? queryDramaIds(db, 'SELECT drama_id FROM props WHERE id = ?', id) : [];
  }
  if (['character_image'].includes(type)) {
    return id ? queryDramaIds(db, 'SELECT drama_id FROM characters WHERE id = ?', id) : [];
  }
  if (type === 'image_generation') {
    const character = resource.match(/^character_(\d+)$/);
    if (character) return queryDramaIds(db, 'SELECT drama_id FROM characters WHERE id = ?', Number(character[1]));
    const scene = resource.match(/^scene_(\d+)$/);
    if (scene) return queryDramaIds(db, 'SELECT drama_id FROM scenes WHERE id = ?', Number(scene[1]));
    return id ? [id] : [];
  }
  return [];
}

function assertTaskResourceWritable(db, taskType, resourceId) {
  try {
    db.prepare('SELECT id FROM dramas LIMIT 1').get();
  } catch (error) {
    if (/no such table/i.test(error?.message || '')) return [];
    throw error;
  }
  const dramaIds = [...new Set(declaredTaskDramaIds(db, {
    type: taskType,
    resource_id: resourceId,
  }))];
  for (const dramaId of dramaIds) assertDramaWritable(db, dramaId);
  return dramaIds;
}

function relatedTaskDramaIds(db, taskId) {
  return [
    ...queryDramaIds(db, 'SELECT drama_id FROM image_generations WHERE task_id = ? AND deleted_at IS NULL', taskId),
    ...queryDramaIds(db, 'SELECT drama_id FROM video_generations WHERE task_id = ? AND deleted_at IS NULL', taskId),
    ...queryDramaIds(db, 'SELECT drama_id FROM video_merges WHERE task_id = ? AND deleted_at IS NULL', taskId),
  ];
}

function taskOwnershipRows(db, dramaId, rows, options = {}) {
  const owned = [];
  const conflicts = [];
  for (const task of rows) {
    const declared = new Set(declaredTaskDramaIds(db, task));
    const relatedValues = relatedTaskDramaIds(db, task.id);
    const related = new Set(relatedValues);
    const combined = new Set([...declared, ...related]);
    const touchesDrama = combined.has(Number(dramaId));
    const mismatched = combined.size > 1
      || (declared.size && related.size && [...declared].some((id) => !related.has(id)))
      || related.size > 1;
    const unresolved = combined.size === 0;
    if (unresolved && options.rejectUnresolved !== false) {
      conflicts.push({
        task_id: task.id,
        task_type: task.type,
        resource_id: task.resource_id || null,
        reason: 'unresolved_active_task_ownership',
      });
      continue;
    }
    if (touchesDrama && mismatched) {
      conflicts.push({
        task_id: task.id,
        task_type: task.type,
        resource_id: task.resource_id || null,
        declared_drama_ids: [...declared],
        related_drama_ids: [...related],
      });
      continue;
    }
    if (touchesDrama) owned.push(task);
  }
  if (conflicts.length) {
    throw taskScopeConflict('任务声明归属与业务关联归属不一致，已拒绝回收项目', { conflicts });
  }
  return owned;
}

function auditActiveTaskOwnership(db, dramaId) {
  let activeTasks;
  try {
    activeTasks = db.prepare(
      `SELECT id, type, resource_id, status FROM async_tasks
        WHERE status IN ('pending', 'processing', 'cancelling') AND deleted_at IS NULL`
    ).all();
  } catch (error) {
    if (/no such table/i.test(error?.message || '')) return [];
    throw error;
  }
  return taskOwnershipRows(db, dramaId, activeTasks);
}

function auditPendingCancellationOwnership(db, dramaId) {
  let rows;
  try {
    rows = db.prepare(
      `SELECT id, type, resource_id, status, cancel_state, cancel_operation_id, cancel_context
         FROM async_tasks
        WHERE deleted_at IS NULL
          AND cancel_state IS NOT NULL
          AND cancel_state != 'confirmed'
          AND (status IN ('pending', 'processing', 'cancelling') OR status = 'failed')`
    ).all();
  } catch (error) {
    if (/no such table|no such column/i.test(error?.message || '')) return [];
    throw error;
  }
  return taskOwnershipRows(db, dramaId, rows, { rejectUnresolved: true });
}

function auditProjectCancellationSafety(db, dramaId, operationId) {
  const activeTasks = auditActiveTaskOwnership(db, dramaId);
  if (activeTasks.length) return { safe: false, reason: 'active_tasks', tasks: activeTasks };
  const pending = auditPendingCancellationOwnership(db, dramaId);
  if (pending.length) {
    return {
      safe: false,
      reason: 'unconfirmed_cancellations',
      tasks: pending.map((task) => ({
        task_id: task.id,
        task_type: task.type,
        status: task.status,
        cancel_state: task.cancel_state,
        cancel_operation_id: task.cancel_operation_id || null,
        cancel_context: parseJsonColumn(task.cancel_context),
      })),
    };
  }
  const claimed = db.prepare(
    `SELECT id, status, cancel_state, cancel_operation_id
       FROM async_tasks
      WHERE deleted_at IS NULL AND cancel_operation_id = ?`
  ).all(operationId);
  const unconfirmedClaim = claimed.find((task) => task.cancel_state !== 'confirmed');
  if (unconfirmedClaim) {
    return {
      safe: false,
      reason: 'operation_confirmation_missing',
      tasks: [unconfirmedClaim],
    };
  }
  return { safe: true, tasks: [] };
}

function upgradePendingDramaCancellations(db, dramaId, operationId) {
  const candidates = auditPendingCancellationOwnership(db, dramaId);
  const context = {
    scope: 'drama_recycle',
    drama_id: Number(dramaId),
    recycle_operation_id: String(operationId),
    reason: '项目移入回收站',
  };
  const upgraded = [];
  for (const task of candidates) {
    const token = taskService.upgradeTaskCancellationContext(db, task.id, context);
    if (token) upgraded.push({ task_id: task.id, token });
  }
  return upgraded;
}

function persistDramaRemoval(db, log, id, operationId) {
  const removedAt = new Date().toISOString();
  const result = db.prepare(
    `UPDATE dramas
        SET deleted_at = ?, trash_state = NULL, recycle_phase = 'completed', updated_at = ?
      WHERE id = ? AND deleted_at IS NULL AND trash_state = 'recycling'
        AND recycle_operation_id = ?`
  ).run(removedAt, removedAt, id, operationId);
  if (!result.changes) return null;
  const row = db.prepare('SELECT * FROM dramas WHERE id = ?').get(id);
  log.info('Drama moved to trash', { drama_id: id, associated_data: 'preserved', recoverable: true });
  return row ? rowToDrama(row) : null;
}

function dramaRecycleRecoveryKey(id, operationId) {
  return `${Number(id)}:${String(operationId || '')}`;
}

function releaseDramaRecycleLock(db, log, id, operationId, reason) {
  const releasedAt = new Date().toISOString();
  const result = db.prepare(
    `UPDATE dramas
        SET trash_state = NULL, recycle_operation_id = NULL, recycle_phase = NULL,
            recycle_started_at = NULL, updated_at = ?
      WHERE id = ? AND deleted_at IS NULL AND trash_state = 'recycling'
        AND recycle_operation_id = ?`
  ).run(releasedAt, id, operationId);
  if (result.changes) {
    log.error?.('Drama recycle stopped without deleting the project', {
      drama_id: id,
      recycle_operation_id: operationId,
      reason,
    });
  }
  return result.changes > 0;
}

function markDramaRecycleManualIntervention(db, log, id, operationId, reason) {
  const markedAt = new Date().toISOString();
  const result = db.prepare(
    `UPDATE dramas
        SET recycle_phase = 'manual_intervention', updated_at = ?
      WHERE id = ? AND deleted_at IS NULL AND trash_state = 'recycling'
        AND recycle_operation_id = ?`
  ).run(markedAt, id, operationId);
  if (result.changes) {
    log.error?.('Drama recycle requires manual intervention and remains locked', {
      drama_id: id,
      recycle_operation_id: operationId,
      reason,
    });
  }
  return result.changes > 0;
}

function preserveMalformedDramaRecycleLock(db, log, id, reason) {
  const markedAt = new Date().toISOString();
  const result = db.prepare(
    `UPDATE dramas
        SET recycle_phase = 'manual_intervention', updated_at = ?
      WHERE id = ? AND deleted_at IS NULL AND trash_state = 'recycling'`
  ).run(markedAt, id);
  if (result.changes) {
    log.error?.('Drama recycle metadata is incomplete; lock preserved for manual intervention', {
      drama_id: id,
      reason,
    });
  }
  return result.changes > 0;
}

function dramaRecycleDeadlineExceeded(db, id, operationId, now = Date.now()) {
  const row = db.prepare(
    `SELECT recycle_started_at FROM dramas
      WHERE id = ? AND deleted_at IS NULL AND trash_state = 'recycling'
        AND recycle_operation_id = ?`
  ).get(id, operationId);
  if (!row) return true;
  const startedAt = Date.parse(row.recycle_started_at || '');
  return !Number.isFinite(startedAt)
    || now - startedAt >= DRAMA_RECYCLE_RECOVERY_MAX_ELAPSED_MS;
}

function scheduleDramaRecycleRecovery(db, log, id, operationId, attempt = 0) {
  const key = dramaRecycleRecoveryKey(id, operationId);
  if (dramaRecycleRecoveryJobs.has(key)) return false;
  if (dramaRecycleDeadlineExceeded(db, id, operationId)) {
    markDramaRecycleManualIntervention(db, log, id, operationId, 'recovery_deadline_exceeded');
    return false;
  }
  const normalizedAttempt = Math.max(0, Number(attempt) || 0);
  const delayMs = Math.min(
    DRAMA_RECYCLE_RECOVERY_MAX_DELAY_MS,
    DRAMA_RECYCLE_RECOVERY_BASE_DELAY_MS * (2 ** Math.min(normalizedAttempt, 10))
  );
  dramaRecycleRecoveryJobs.set(key, { attempt: normalizedAttempt, delay_ms: delayMs });
  try {
    require('./legacyAsyncSchedulerService').scheduleDelayedBackgroundTask(log, 'drama_recycle_recovery', delayMs, async () => {
      dramaRecycleRecoveryJobs.delete(key);
      const locked = db.prepare(
        `SELECT id FROM dramas
          WHERE id = ? AND deleted_at IS NULL AND trash_state = 'recycling'
            AND recycle_operation_id = ?`
      ).get(id, operationId);
      if (!locked) return;
      try {
        await continueDramaRecycle(db, log, id, operationId, {
          recoveryAttempt: normalizedAttempt + 1,
          backgroundRecovery: true,
        });
      } catch (error) {
        log.error('Deferred drama recycle recovery failed', {
          drama_id: id,
          recycle_operation_id: operationId,
          error: error.message,
        });
      }
    }, { id: key, drama_id: id, recycle_operation_id: operationId, attempt: normalizedAttempt });
  } catch (error) {
    dramaRecycleRecoveryJobs.delete(key);
    throw error;
  }
  return true;
}

async function continueDramaRecycle(db, log, id, operationId, options = {}) {
  const workflowService = require('./workflowService');
  if (dramaRecycleDeadlineExceeded(db, id, operationId)) {
    markDramaRecycleManualIntervention(db, log, id, operationId, 'recovery_deadline_exceeded');
    if (options.backgroundRecovery) return null;
    const error = new Error('项目回收等待任务退出已超过安全时限，请确认任务状态后重试');
    error.code = 'WORKFLOW_DRAIN_TIMEOUT';
    error.statusCode = 409;
    error.details = {
      project_remains_locked: true,
      recycle_phase: 'manual_intervention',
    };
    throw error;
  }
  db.prepare(
    `UPDATE dramas SET recycle_phase = 'cancelling', updated_at = ?
      WHERE id = ? AND deleted_at IS NULL AND trash_state = 'recycling' AND recycle_operation_id = ?`
  ).run(new Date().toISOString(), id, operationId);

  let workflowResult;
  try {
    workflowResult = await workflowService.cancelAndDrainDramaWorkflows(
      db, log, id, '项目移入回收站'
    );
  } catch (error) {
    if (error?.code !== 'WORKFLOW_DRAIN_TIMEOUT') throw error;
    scheduleDramaRecycleRecovery(
      db, log, id, operationId, Math.max(0, Number(options.recoveryAttempt) || 0)
    );
    if (options.backgroundRecovery) return null;
    throw error;
  }
  const cancelledTaskIds = new Set();
  for (let pass = 0; pass < DRAMA_RECYCLE_TASK_DRAIN_MAX_PASSES; pass += 1) {
    let taskRows;
    try {
      taskRows = auditActiveTaskOwnership(db, id);
    } catch (error) {
      markDramaRecycleManualIntervention(db, log, id, operationId, error.code || 'task_scope_conflict');
      throw error;
    }
    if (taskRows.length) {
      const cancelContext = {
        scope: 'drama_recycle',
        drama_id: Number(id),
        recycle_operation_id: String(operationId),
        reason: '项目移入回收站',
      };
      const cancellations = await Promise.all(
        taskRows.map((row) => {
          taskService.upgradeTaskCancellationContext(db, row.id, cancelContext);
          return taskService.cancelTask(
            db,
            log,
            row.id,
            '项目移入回收站',
            { preserveOnUncertain: true, cancelContext }
          );
        })
      );
      const failedIndex = cancellations.findIndex((result) => !result.ok);
      taskRows.forEach((row, index) => {
        if (cancellations[index]?.ok) cancelledTaskIds.add(row.id);
      });
      if (failedIndex >= 0) {
        const failed = cancellations[failedIndex];
        const remainsLocked = [
          'remote_cancel_uncertain',
          'remote_cancel_exhausted',
          'task_scope_conflict',
        ].includes(failed.reason);
        if (failed.reason === 'remote_cancel_uncertain' || failed.reason === 'remote_cancel_exhausted') {
          scheduleDramaRecycleRecovery(
            db, log, id, operationId, Math.max(0, Number(options.recoveryAttempt) || 0)
          );
        } else if (failed.reason === 'task_scope_conflict') {
          markDramaRecycleManualIntervention(db, log, id, operationId, failed.reason);
        } else {
          releaseDramaRecycleLock(db, log, id, operationId, failed.reason || 'remote_cancel_failed');
        }
        const error = new Error(failed.error || '任务取消失败，项目保持回收锁定');
        error.code = failed.reason === 'task_scope_conflict'
          ? 'TASK_SCOPE_CONFLICT'
            : remainsLocked
            ? failed.reason === 'remote_cancel_exhausted'
              ? 'REMOTE_CANCEL_EXHAUSTED'
              : 'REMOTE_CANCEL_UNCERTAIN'
            : 'REMOTE_CANCEL_FAILED';
        error.details = {
          cancelled_task_ids: [...cancelledTaskIds],
          failed_task_id: taskRows[failedIndex]?.id || null,
          cancelled_workflow_run_ids: workflowResult.cancelled_run_ids,
          project_remains_locked: remainsLocked,
        };
        if (options.backgroundRecovery && remainsLocked) return null;
        throw error;
      }
      continue;
    }

    const commit = db.transaction(() => {
      const remainingTasks = auditActiveTaskOwnership(db, id);
      if (remainingTasks.length) return { remainingTasks, removed: null };
      db.prepare(
        `UPDATE dramas SET recycle_phase = 'ready_to_commit', updated_at = ?
          WHERE id = ? AND deleted_at IS NULL AND trash_state = 'recycling'
            AND recycle_operation_id = ?`
      ).run(new Date().toISOString(), id, operationId);
      return { remainingTasks: [], removed: persistDramaRemoval(db, log, id, operationId) };
    });
    const committed = typeof commit.immediate === 'function' ? commit.immediate() : commit();
    if (committed.removed) return committed.removed;
  }

  scheduleDramaRecycleRecovery(
    db, log, id, operationId, Math.max(0, Number(options.recoveryAttempt) || 0)
  );
  if (options.backgroundRecovery) return null;
  const error = new Error('项目回收期间仍有新任务进入，已延后重试');
  error.code = 'WORKFLOW_DRAIN_TIMEOUT';
  error.statusCode = 409;
  error.details = {
    cancelled_task_ids: [...cancelledTaskIds],
    cancelled_workflow_run_ids: workflowResult.cancelled_run_ids,
    project_remains_locked: true,
  };
  throw error;
}

async function moveDramaToTrash(db, log, dramaId) {
  const id = Number(dramaId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const recyclingAt = new Date().toISOString();
  const operationId = randomUUID();
  const existing = db.prepare(
    `SELECT id, trash_state, recycle_phase FROM dramas
      WHERE id = ? AND deleted_at IS NULL`
  ).get(id);
  if (!existing) return null;
  const retryingManualIntervention = existing.trash_state === 'recycling'
    && existing.recycle_phase === 'manual_intervention';
  const claimed = retryingManualIntervention
    ? db.prepare(
        `UPDATE dramas
            SET recycle_operation_id = ?, recycle_phase = 'claimed',
                recycle_started_at = ?, updated_at = ?
          WHERE id = ? AND deleted_at IS NULL AND trash_state = 'recycling'
            AND recycle_phase = 'manual_intervention'`
      ).run(operationId, recyclingAt, recyclingAt, id)
    : db.prepare(
        `UPDATE dramas
            SET trash_state = 'recycling', recycle_operation_id = ?, recycle_phase = 'claimed',
                recycle_started_at = ?, updated_at = ?
          WHERE id = ? AND deleted_at IS NULL
            AND (trash_state IS NULL OR trash_state = '')`
      ).run(operationId, recyclingAt, recyclingAt, id);
  if (!claimed.changes) {
    const current = db.prepare(
      'SELECT id, trash_state FROM dramas WHERE id = ? AND deleted_at IS NULL'
    ).get(id);
    if (!current) return null;
    throw dramaRecycleError();
  }
  try {
    auditActiveTaskOwnership(db, id);
  } catch (error) {
    if (retryingManualIntervention) {
      markDramaRecycleManualIntervention(db, log, id, operationId, error.code || 'task_scope_conflict');
    } else {
      markDramaRecycleManualIntervention(db, log, id, operationId, error.code || 'task_scope_conflict');
    }
    throw error;
  }
  return continueDramaRecycle(db, log, id, operationId);
}

function recoverInterruptedTrashOperations(db, log) {
  const rows = db.prepare(
    `SELECT id, recycle_operation_id, recycle_phase, recycle_started_at FROM dramas
      WHERE deleted_at IS NULL AND trash_state = 'recycling'`
  ).all();
  let recovered = 0;
  for (const row of rows) {
    if (row.recycle_phase === 'claimed' || row.recycle_phase === 'cancelling') {
      if (row.recycle_operation_id) {
        scheduleDramaRecycleRecovery(db, log, Number(row.id), row.recycle_operation_id);
      } else {
        preserveMalformedDramaRecycleLock(db, log, Number(row.id), 'missing_recycle_operation_id');
      }
      recovered += 1;
      continue;
    }
    if (!row.recycle_operation_id || !row.recycle_phase) {
      preserveMalformedDramaRecycleLock(db, log, Number(row.id), 'missing_recycle_metadata');
      recovered += 1;
      continue;
    }
    if (row.recycle_phase === 'manual_intervention') {
      recovered += 1;
      continue;
    }
    scheduleDramaRecycleRecovery(db, log, Number(row.id), row.recycle_operation_id);
    recovered += 1;
  }
  if (recovered) log.warn?.('Recovered interrupted drama recycle operations', { count: recovered });
  return recovered;
}

function restoreDrama(db, log, dramaId) {
  const id = Number(dramaId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const restoredAt = new Date().toISOString();
  const result = db.prepare(
    `UPDATE dramas
        SET deleted_at = NULL, trash_state = NULL,
            recycle_phase = NULL, recycle_operation_id = NULL,
            recycle_started_at = NULL, updated_at = ?
      WHERE id = ? AND deleted_at IS NOT NULL`
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
    recycle_state: r.trash_state || null,
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

function saveOutlineUnsafe(db, log, dramaId, req) {
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

function saveOutline(db, log, dramaId, req) {
  return runDramaWriteTransaction(db, dramaId, () => saveOutlineUnsafe(db, log, dramaId, req));
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

function saveCharactersUnsafe(db, log, dramaId, req) {
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

function saveCharacters(db, log, dramaId, req) {
  return runDramaWriteTransaction(db, dramaId, () => saveCharactersUnsafe(db, log, dramaId, req));
}

function saveEpisodesUnsafe(db, log, dramaId, req) {
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

function saveEpisodes(db, log, dramaId, req) {
  return runDramaWriteTransaction(db, dramaId, () => saveEpisodesUnsafe(db, log, dramaId, req));
}

function saveProgressUnsafe(db, log, dramaId, req) {
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

function saveProgress(db, log, dramaId, req) {
  return runDramaWriteTransaction(db, dramaId, () => saveProgressUnsafe(db, log, dramaId, req));
}

/** 保存画布布局 / 工作流组到 metadata（合并现有 metadata） */
function saveCanvasLayoutUnsafe(db, log, dramaId, req) {
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
    : validateFreeCanvas(db, Number(dramaId), freeCanvas);
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

function saveCanvasLayout(db, log, dramaId, req) {
  return runDramaWriteTransaction(db, dramaId, () => saveCanvasLayoutUnsafe(db, log, dramaId, req));
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
  assertDramaWritable,
  assertTaskResourceWritable,
  createDrama,
  getDrama,
  getDramaById,
  listDramas,
  listTrashedDramas,
  updateDrama,
  moveDramaToTrash,
  recoverInterruptedTrashOperations,
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
