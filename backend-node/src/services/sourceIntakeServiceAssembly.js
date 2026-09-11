/**
 * 素材接入行装配：JSON 列解析、元数据清洗与数据库行到接口对象的映射。
 * 路由仍通过 sourceIntakeService 调用，本模块不改变公开 API。
 */

function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function toJson(value) {
  return JSON.stringify(value == null ? {} : value);
}

function normalizeMetadata(value) {
  const parsed = parseJson(value, {});
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function trimText(value, max = 500) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return text.slice(0, max - 3).trimEnd() + '...';
}

function rowToSource(row) {
  return {
    id: row.id,
    drama_id: row.drama_id,
    source_type: row.source_type,
    title: row.title,
    raw_text_path: row.raw_text_path,
    content_hash: row.content_hash,
    metadata: parseJson(row.metadata, {}),
    created_at: row.created_at,
  };
}

function rowToItem(row) {
  return {
    id: row.id,
    source_id: row.source_id,
    item_type: row.item_type,
    item_no: row.item_no,
    title: row.title,
    raw_text: row.raw_text,
    summary: row.summary,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function rowToEvent(row) {
  return {
    id: row.id,
    drama_id: row.drama_id,
    source_item_id: row.source_item_id,
    event_no: row.event_no,
    title: row.title,
    detail: row.detail,
    characters: parseJson(row.characters, []),
    location: row.location,
    tension: row.tension,
    hook_score: row.hook_score,
    created_at: row.created_at,
  };
}

function rowToPlan(row) {
  return {
    id: row.id,
    drama_id: row.drama_id,
    source_id: row.source_id,
    target_episode_count: row.target_episode_count,
    style: row.style,
    plan_json: parseJson(row.plan_json, {}),
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

module.exports = {
  parseJson,
  toJson,
  normalizeMetadata,
  trimText,
  rowToSource,
  rowToItem,
  rowToEvent,
  rowToPlan,
};
