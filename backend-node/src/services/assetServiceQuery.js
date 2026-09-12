/**
 * 素材只读查询：列表、详情、网络来源查找与项目作用域校验。
 * 路由仍通过 assetService 调用，本模块不改变公开 API。
 * 列表和作用域只认 drama_id，不得把 asset_id、library_id 当成项目范围。
 */

const dramaWriteGuard = require('./dramaWriteGuard');
const { rowToItem, parseNetworkSourceMetadata } = require('./assetServiceAssembly');

function assetBadRequest(message) {
  const error = new Error(message);
  error.code = 'BAD_REQUEST';
  return error;
}

const ASSET_SELECT = `
  SELECT
    a.*,
    d.title AS source_drama_title
`;

const ASSET_FROM = `
  FROM assets a
  LEFT JOIN dramas d ON d.id = a.drama_id AND d.deleted_at IS NULL
`;

function list(db, query) {
  if (query.drama_id && !dramaWriteGuard.canReadDrama(db, Number(query.drama_id))) {
    return { items: [], total: 0, page: 1, pageSize: Math.min(100, Math.max(1, parseInt(query.page_size, 10) || 20)) };
  }
  let sql = 'WHERE a.deleted_at IS NULL';
  const params = [];
  if (query.drama_id) {
    sql += ' AND a.drama_id = ?';
    params.push(query.drama_id);
  }
  if (query.type) {
    sql += ' AND a.type = ?';
    params.push(query.type);
  }
  const keyword = String(query.keyword ?? '').trim();
  if (keyword) {
    sql += ' AND a.name LIKE ?';
    params.push(`%${keyword}%`);
  }
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.page_size, 10) || 20));
  const offset = (page - 1) * pageSize;
  const rows = db.prepare(
    ASSET_SELECT + ' ' + ASSET_FROM + ' ' + sql + ' ORDER BY a.created_at DESC, a.id DESC'
  ).all(...params);
  const visible = rows.filter((row) => dramaWriteGuard.canReadResource(db, 'assets', row.id));
  return {
    items: visible.slice(offset, offset + pageSize).map(rowToItem),
    total: visible.length,
    page,
    pageSize,
  };
}

function getById(db, id) {
  if (!dramaWriteGuard.canReadResource(db, 'assets', id)) return null;
  const r = db.prepare(
    ASSET_SELECT + ' ' + ASSET_FROM + ' WHERE a.id = ? AND a.deleted_at IS NULL'
  ).get(Number(id));
  return r ? rowToItem(r) : null;
}

function findNetworkAssetBySource(db, dramaId, source) {
  const sourceUrl = typeof source === 'string' ? source : source?.source_url;
  const openverseId = typeof source === 'object' && source
    ? String(source.openverse_id || '').trim().toLowerCase()
    : '';
  const rows = dramaId == null
    ? db.prepare('SELECT id, category FROM assets WHERE drama_id IS NULL AND deleted_at IS NULL').all()
    : db.prepare('SELECT id, category FROM assets WHERE drama_id = ? AND deleted_at IS NULL').all(dramaId);
  const match = rows.find((row) => {
    const meta = parseNetworkSourceMetadata(row.category);
    if (!meta) return false;
    if (openverseId && meta.kind === 'openverse' && String(meta.openverse_id || '').toLowerCase() === openverseId) {
      return true;
    }
    return Boolean(sourceUrl) && meta.source_url === sourceUrl;
  });
  return match ? getById(db, match.id) : null;
}

function resolveDramaScope(db, value, options = {}) {
  if (value === undefined || value === null) return null;
  const normalized = options.strictDramaId
    ? value
    : (typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw assetBadRequest('项目 ID 必须是正整数');
  }
  dramaWriteGuard.assertDramaWritable(db, normalized);
  let drama;
  try {
    drama = db.prepare(
      'SELECT id, title, created_at, metadata, trash_state FROM dramas WHERE id = ? AND deleted_at IS NULL'
    ).get(normalized);
  } catch (error) {
    if (!/no such column: trash_state/i.test(error?.message || '')) throw error;
    drama = db.prepare(
      'SELECT id, title, created_at, metadata, NULL AS trash_state FROM dramas WHERE id = ? AND deleted_at IS NULL'
    ).get(normalized);
  }
  if (!drama) throw assetBadRequest('项目不存在');
  return drama;
}

module.exports = {
  list,
  getById,
  findNetworkAssetBySource,
  resolveDramaScope,
  assetBadRequest,
};
