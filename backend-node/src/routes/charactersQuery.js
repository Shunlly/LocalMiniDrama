/**
 * 角色路由只读查询与 JSON 资产解析。
 * 角色 ID 与项目 ID、库项 ID 不是同一字段，查询键必须用角色表主键。
 */

function parseJsonValue(value) {
  if (!value) return null;
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch (_) {
    return null;
  }
}

function parseVoiceAsset(value) {
  const parsed = parseJsonValue(value);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
}

function getCharacterDetail(db, characterId) {
  const row = db.prepare(
    'SELECT id, drama_id, name, role, appearance, description, personality, voice_style, image_url, local_path, polished_prompt, four_view_image_url, identity_anchors, seedance2_asset, seedance2_voice_asset, negative_prompt, updated_at FROM characters WHERE id = ? AND deleted_at IS NULL'
  ).get(Number(characterId));
  if (!row) return null;
  row.seedance2_asset = parseJsonValue(row.seedance2_asset);
  row.seedance2_voice_asset = parseJsonValue(row.seedance2_voice_asset);
  return row;
}

function getCharacterImageSnapshot(db, characterId) {
  return db.prepare(
    'SELECT id, local_path, image_url, seedance2_asset FROM characters WHERE id = ? AND deleted_at IS NULL'
  ).get(Number(characterId));
}

function getCharacterAnchorRow(db, characterId) {
  return db.prepare(
    'SELECT id, appearance, identity_anchors FROM characters WHERE id = ? AND deleted_at IS NULL'
  ).get(Number(characterId));
}

function getCharacterVoiceRow(db, characterId) {
  return db.prepare(
    'SELECT id, drama_id, seedance2_voice_asset FROM characters WHERE id = ? AND deleted_at IS NULL'
  ).get(Number(characterId));
}

function getCharacterVoiceAssetRow(db, characterId) {
  const row = db.prepare(
    'SELECT seedance2_voice_asset FROM characters WHERE id = ? AND deleted_at IS NULL'
  ).get(Number(characterId));
  if (!row) return null;
  return { asset: parseJsonValue(row.seedance2_voice_asset) };
}

module.exports = {
  parseJsonValue,
  parseVoiceAsset,
  getCharacterDetail,
  getCharacterImageSnapshot,
  getCharacterAnchorRow,
  getCharacterVoiceRow,
  getCharacterVoiceAssetRow,
};
