/**
 * 图片只读查询：列表、详情、剧集背景图与生成作用域解析。
 * 路由仍通过 imageService 调用，本模块不改变公开 API。
 */

const dramaWriteGuard = require('./dramaWriteGuard');
const { rowToItem } = require('./imageServiceAssembly');

function imageBadRequest(message) {
  const error = new Error(message);
  error.code = 'BAD_REQUEST';
  return error;
}

const SCOPE_FIELD_LABELS = Object.freeze({
  drama_id: '项目 ID',
  storyboard_id: '分镜 ID',
});

function normalizeScopeId(rawValue, field, allowZero) {
  const label = SCOPE_FIELD_LABELS[field] || '编号';
  let value;
  if (typeof rawValue === 'number') {
    value = rawValue;
  } else if (typeof rawValue === 'string' && /^\d+$/.test(rawValue.trim())) {
    value = Number(rawValue.trim());
  } else {
    throw imageBadRequest(`${label} 无效`);
  }
  if (!Number.isSafeInteger(value) || (allowZero ? value < 0 : value <= 0)) {
    throw imageBadRequest(`${label} 无效`);
  }
  return value;
}

function resolveImageGenerationScope(db, req) {
  const hasDramaId = Object.prototype.hasOwnProperty.call(req, 'drama_id');
  const rawDramaId = req.drama_id;
  let dramaId = 0;
  const explicitGlobalEmpty = rawDramaId === null
    || (typeof rawDramaId === 'string' && rawDramaId.trim() === '');
  if (hasDramaId && !explicitGlobalEmpty) {
    dramaId = normalizeScopeId(rawDramaId, 'drama_id', true);
  }
  const storyboardId = req.storyboard_id != null
    ? normalizeScopeId(req.storyboard_id, 'storyboard_id', false)
    : null;
  if (storyboardId != null) {
    const scope = db.prepare(
      `SELECT e.drama_id
         FROM storyboards s
         JOIN episodes e ON e.id = s.episode_id AND e.deleted_at IS NULL
        WHERE s.id = ? AND s.deleted_at IS NULL`
    ).get(storyboardId);
    if (!scope || (dramaId > 0 && Number(scope.drama_id) !== dramaId)) {
      throw imageBadRequest('分镜不属于当前项目');
    }
    dramaId = Number(scope.drama_id);
  }
  return { dramaId, storyboardId };
}

function list(db, query) {
  if (query.drama_id && !dramaWriteGuard.canReadDrama(db, Number(query.drama_id))) {
    return { items: [], total: 0, page: 1, pageSize: Math.min(100, Math.max(1, parseInt(query.page_size, 10) || 20)) };
  }
  let sql = 'FROM image_generations WHERE deleted_at IS NULL';
  const params = [];
  if (query.drama_id) {
    sql += ' AND drama_id = ?';
    params.push(query.drama_id);
  }
  if (query.storyboard_id) {
    sql += ' AND storyboard_id = ?';
    params.push(query.storyboard_id);
  }
  if (query.frame_type) {
    sql += ' AND frame_type = ?';
    params.push(query.frame_type);
  }
  if (query.status) {
    sql += ' AND status = ?';
    params.push(query.status);
  }
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.page_size, 10) || 20));
  const offset = (page - 1) * pageSize;
  const rows = db.prepare('SELECT * ' + sql + ' ORDER BY created_at DESC, id DESC').all(...params);
  const visible = rows.filter((row) => dramaWriteGuard.canReadResource(db, 'image_generations', row.id));
  return { items: visible.slice(offset, offset + pageSize).map(rowToItem), total: visible.length, page, pageSize };
}

function getById(db, id) {
  if (!dramaWriteGuard.canReadResource(db, 'image_generations', id)) return null;
  const r = db.prepare('SELECT * FROM image_generations WHERE id = ? AND deleted_at IS NULL').get(Number(id));
  return r ? rowToItem(r) : null;
}

function getByIdAfterScopeValidation(db, id) {
  const r = db.prepare('SELECT * FROM image_generations WHERE id = ? AND deleted_at IS NULL').get(Number(id));
  return r ? rowToItem(r) : null;
}

function getBackgroundsForEpisode(db, episodeId) {
  if (!dramaWriteGuard.canReadResource(db, 'episodes', episodeId)) return [];
  const rows = db.prepare(
    `SELECT s.id as scene_id, s.location, s.time, s.prompt, s.image_url, s.local_path, s.status
     FROM storyboards sb
     JOIN scenes s ON s.id = sb.scene_id AND s.deleted_at IS NULL
     WHERE sb.episode_id = ? AND sb.deleted_at IS NULL
     ORDER BY sb.storyboard_number`
  ).all(episodeId);
  return rows;
}

module.exports = {
  list,
  getById,
  getByIdAfterScopeValidation,
  getBackgroundsForEpisode,
  resolveImageGenerationScope,
  normalizeScopeId,
  imageBadRequest,
};