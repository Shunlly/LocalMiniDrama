/**
 * 素材接入只读查询：来源列表/详情、事件边与改编方案读取。
 * 路由仍通过 sourceIntakeService 调用，本模块不改变公开 API。
 */

const dramaWriteGuard = require('./dramaWriteGuard');
const { rowToSource, rowToItem, rowToEvent, rowToPlan } = require('./sourceIntakeServiceAssembly');

function listSourcesByDrama(db, dramaId) {
  const rows = db.prepare(
    `SELECT * FROM story_sources WHERE drama_id = ? AND deleted_at IS NULL ORDER BY created_at DESC, id DESC`
  ).all(Number(dramaId));
  return rows.map(rowToSource);
}

function getSourceById(db, sourceId) {
  const row = db.prepare('SELECT * FROM story_sources WHERE id = ? AND deleted_at IS NULL').get(Number(sourceId));
  if (!row) return null;
  dramaWriteGuard.assertDramaReadable(db, row.drama_id);
  return rowToSource(row);
}

function getSourceDetail(db, sourceId) {
  const source = getSourceById(db, sourceId);
  if (!source) return null;
  const items = db.prepare('SELECT * FROM source_items WHERE source_id = ? ORDER BY item_no ASC, id ASC').all(source.id).map(rowToItem);
  const itemIds = items.map((item) => item.id);
  let events = [];
  if (itemIds.length) {
    const placeholders = itemIds.map(() => '?').join(',');
    events = db.prepare(`SELECT * FROM story_events WHERE source_item_id IN (${placeholders}) ORDER BY event_no ASC, id ASC`).all(...itemIds).map(rowToEvent);
  }
  const eventEdges = getEventEdgesForSource(db, source.id);
  const plans = db.prepare('SELECT * FROM adaptation_plans WHERE source_id = ? ORDER BY created_at DESC, id DESC').all(source.id).map(rowToPlan);
  return { source, items, events, event_edges: eventEdges, adaptation_plans: plans };
}

function getEventEdgesForSource(db, sourceId) {
  try {
    return db.prepare(
      `SELECT * FROM story_event_edges
       WHERE source_id = ?
       ORDER BY id ASC`
    ).all(Number(sourceId)).map((row) => ({
      id: row.id,
      drama_id: row.drama_id,
      source_id: row.source_id,
      from_event_id: row.from_event_id,
      to_event_id: row.to_event_id,
      relation_type: row.relation_type,
      description: row.description,
      created_at: row.created_at,
    }));
  } catch (_) {
    return [];
  }
}

function getLatestPlanForSource(db, sourceId) {
  const row = db.prepare(
    `SELECT * FROM adaptation_plans WHERE source_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`
  ).get(Number(sourceId));
  return row ? rowToPlan(row) : null;
}

function getAdaptationPlanById(db, planId) {
  const row = db.prepare('SELECT * FROM adaptation_plans WHERE id = ?').get(Number(planId));
  return row ? rowToPlan(row) : null;
}

module.exports = {
  listSourcesByDrama,
  getSourceById,
  getSourceDetail,
  getEventEdgesForSource,
  getLatestPlanForSource,
  getAdaptationPlanById,
};
