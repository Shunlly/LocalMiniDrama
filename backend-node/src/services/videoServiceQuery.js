/**
 * 视频只读查询：列表、详情与生成作用域解析。
 * 路由仍通过 videoService 调用，本模块不改变公开 API。
 */

const dramaWriteGuard = require('./dramaWriteGuard');
const { rowToItem } = require('./videoServiceAssembly');

function videoBadRequest(message) {
  const error = new Error(message);
  error.code = 'BAD_REQUEST';
  return error;
}

const SCOPE_FIELD_LABELS = Object.freeze({
  drama_id: '项目 ID',
  storyboard_id: '分镜 ID',
  stored_drama_id: '历史项目编号',
});

function normalizeScopeId(rawValue, field, allowZero) {
  const label = SCOPE_FIELD_LABELS[field] || '编号';
  let value;
  if (typeof rawValue === 'number') {
    value = rawValue;
  } else if (typeof rawValue === 'string' && /^\d+$/.test(rawValue.trim())) {
    value = Number(rawValue.trim());
  } else {
    throw videoBadRequest(`${label} 无效`);
  }
  if (!Number.isSafeInteger(value) || (allowZero ? value < 0 : value <= 0)) {
    throw videoBadRequest(`${label} 无效`);
  }
  return value;
}

function assertDramaAcceptsVideoWrites(db, dramaId) {
  if (!(dramaId > 0)) return;
  dramaWriteGuard.assertDramaWritable(db, dramaId);
}

/**
 * 解析视频生成的真实作用域。分镜作用域以其未删除的 episode/drama 链路为准，
 * 不信任请求或历史任务行中可被污染的 drama_id。
 */
function resolveVideoGenerationScope(db, body) {
  const hasDramaId = Object.prototype.hasOwnProperty.call(body, 'drama_id');
  const rawDramaId = body.drama_id;
  const explicitGlobalEmpty = rawDramaId === null
    || (typeof rawDramaId === 'string' && rawDramaId.trim() === '');
  let dramaId = 0;
  if (hasDramaId && !explicitGlobalEmpty) {
    dramaId = normalizeScopeId(rawDramaId, 'drama_id', true);
    assertDramaAcceptsVideoWrites(db, dramaId);
  }

  const storyboardId = body.storyboard_id != null
    ? normalizeScopeId(body.storyboard_id, 'storyboard_id', false)
    : null;
  if (storyboardId == null) return { dramaId, storyboardId };

  const scope = db.prepare(
    `SELECT e.drama_id
       FROM storyboards s
       JOIN episodes e ON e.id = s.episode_id AND e.deleted_at IS NULL
     JOIN dramas d ON d.id = e.drama_id AND d.deleted_at IS NULL
      WHERE s.id = ? AND s.deleted_at IS NULL`
  ).get(storyboardId);
  if (!scope || (dramaId > 0 && Number(scope.drama_id) !== dramaId)) {
    throw videoBadRequest('分镜不存在或不属于当前项目');
  }
  assertDramaAcceptsVideoWrites(db, Number(scope.drama_id));
  return { dramaId: Number(scope.drama_id), storyboardId };
}

function normalizeStoredDramaId(value) {
  if (value == null || value === '') return 0;
  return normalizeScopeId(value, 'stored_drama_id', true);
}

function list(db, query) {
  if (query.drama_id && !dramaWriteGuard.canReadDrama(db, Number(query.drama_id))) {
    return { items: [], total: 0, page: 1, pageSize: Math.min(100, Math.max(1, parseInt(query.page_size, 10) || 20)) };
  }
  let sql = 'FROM video_generations WHERE deleted_at IS NULL';
  const params = [];
  if (query.drama_id) {
    sql += ' AND drama_id = ?';
    params.push(query.drama_id);
  }
  if (query.storyboard_id) {
    sql += ' AND storyboard_id = ?';
    params.push(query.storyboard_id);
  }
  // 与 Go 前端行为对齐：请求 status=processing 时，同时包含“刚结束”的记录（5 分钟内变为 completed/failed），
  // 这样轮询刷新后任务不会从列表消失，无需改 Vue
  if (query.status === 'processing') {
    sql += " AND (status = 'processing' OR (status IN ('completed','failed') AND updated_at >= datetime('now', '-5 minutes')))";
  } else if (query.status) {
    sql += ' AND status = ?';
    params.push(query.status);
  }
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.page_size, 10) || 20));
  const offset = (page - 1) * pageSize;
  const rows = db.prepare('SELECT * ' + sql + ' ORDER BY created_at DESC, id DESC').all(...params);
  const visible = rows.filter((row) => dramaWriteGuard.canReadResource(db, 'video_generations', row.id));
  return { items: visible.slice(offset, offset + pageSize).map(rowToItem), total: visible.length, page, pageSize };
}

function getById(db, id) {
  if (!dramaWriteGuard.canReadResource(db, 'video_generations', id)) return null;
  const r = db.prepare('SELECT * FROM video_generations WHERE id = ? AND deleted_at IS NULL').get(Number(id));
  return r ? rowToItem(r) : null;
}

function getByIdAfterScopeValidation(db, id) {
  const r = db.prepare('SELECT * FROM video_generations WHERE id = ? AND deleted_at IS NULL').get(Number(id));
  return r ? rowToItem(r) : null;
}

module.exports = {
  list,
  getById,
  getByIdAfterScopeValidation,
  resolveVideoGenerationScope,
  normalizeScopeId,
  normalizeStoredDramaId,
  assertDramaAcceptsVideoWrites,
  videoBadRequest,
};
