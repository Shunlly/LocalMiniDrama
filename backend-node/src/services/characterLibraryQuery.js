/**
 * 角色库只读查询：列表与详情。
 * 路由仍通过 characterLibraryService 调用，本模块不改变公开 API。
 * 列表作用域只认 drama_id / global，不得把 character_id、library_id 当成项目范围。
 */

const { appendSourceIdFilters } = require('./libraryDedup');
const { rowToItem } = require('./characterLibraryAssembly');

function listLibraryItems(db, query) {
  let sql = 'FROM character_libraries WHERE deleted_at IS NULL';
  const params = [];
  if (query.global === '1' || query.global === 1) {
    // 仅全局素材库（drama_id IS NULL）
    sql += ' AND drama_id IS NULL';
  } else if (query.drama_id != null && query.drama_id !== '') {
    // 本剧资源库：drama_id 与角色 ID、库项 ID 不是同一字段
    sql += ' AND drama_id = ?';
    params.push(Number(query.drama_id));
  }
  if (query.category) {
    sql += ' AND category = ?';
    params.push(query.category);
  }
  if (query.source_type) {
    sql += ' AND source_type = ?';
    params.push(query.source_type);
  }
  sql = appendSourceIdFilters(query, sql, params);
  if (query.keyword) {
    sql += ' AND (name LIKE ? OR description LIKE ?)';
    const k = '%' + query.keyword + '%';
    params.push(k, k);
  }
  const countRow = db.prepare('SELECT COUNT(*) as total ' + sql).get(...params);
  const total = countRow.total || 0;
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.page_size, 10) || 20));
  const offset = (page - 1) * pageSize;
  const rows = db.prepare('SELECT * ' + sql + ' ORDER BY created_at DESC LIMIT ? OFFSET ?').all(...params, pageSize, offset);
  return { items: rows.map(rowToItem), total, page, pageSize };
}

function getLibraryItem(db, libraryId) {
  const row = db.prepare('SELECT * FROM character_libraries WHERE id = ? AND deleted_at IS NULL').get(Number(libraryId));
  return row ? rowToItem(row) : null;
}

module.exports = {
  listLibraryItems,
  getLibraryItem,
};