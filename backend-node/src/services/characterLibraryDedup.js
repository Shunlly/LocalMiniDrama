/**
 * 角色库去重校验：按项目范围与角色来源查找或复用库项。
 * drama_id / library_id / character_id 语义不同，不得互换。
 */

const {
  findExistingLibraryItem,
  insertLibraryItem,
  normalizeSourceId,
  updateLibraryItem: updateExistingLibraryItem,
} = require('./libraryDedup');
const { resolveImageUrl } = require('./characterLibraryAssembly');
const { getLibraryItem } = require('./characterLibraryQuery');

const CHARACTER_SOURCE_TYPE = 'character';

function loadCharacterForLibrary(db, characterId, { requireWritableDrama = false } = {}) {
  const charRow = db.prepare('SELECT * FROM characters WHERE id = ? AND deleted_at IS NULL').get(Number(characterId));
  if (!charRow) return { ok: false, error: '角色不存在' };
  if (requireWritableDrama) {
    const drama = db.prepare('SELECT id FROM dramas WHERE id = ? AND deleted_at IS NULL').get(charRow.drama_id);
    if (!drama) return { ok: false, error: '无权限' };
  }
  if (!charRow.image_url && !charRow.local_path) return { ok: false, error: '角色还没有形象图片' };
  return { ok: true, charRow };
}

function buildCharacterLibraryFields(charRow, { dramaId, category, now, includeCategory }) {
  const imageUrl = resolveImageUrl(charRow.image_url, charRow.local_path);
  const fields = {
    drama_id: dramaId,
    name: charRow.name,
    image_url: imageUrl,
    local_path: charRow.local_path || null,
    description: charRow.description || null,
    source_type: CHARACTER_SOURCE_TYPE,
    source_id: normalizeSourceId(charRow.id),
    updated_at: now,
  };
  if (includeCategory) fields.category = category ?? null;
  return fields;
}

function findExistingCharacterLibraryItem(db, { dramaId, charRow }) {
  return findExistingLibraryItem(db, 'character_libraries', {
    dramaId,
    sourceType: CHARACTER_SOURCE_TYPE,
    sourceId: charRow.id,
    imageUrl: resolveImageUrl(charRow.image_url, charRow.local_path),
    localPath: charRow.local_path,
  });
}

function upsertCharacterLibraryItem(db, { charRow, dramaId, category, now, includeCategory }) {
  const fields = buildCharacterLibraryFields(charRow, { dramaId, category, now, includeCategory });
  const existing = findExistingCharacterLibraryItem(db, { dramaId, charRow });
  if (existing) {
    updateExistingLibraryItem(db, 'character_libraries', existing.id, fields);
    return {
      duplicated: true,
      item: getLibraryItem(db, String(existing.id)),
    };
  }
  const info = insertLibraryItem(db, 'character_libraries', { ...fields, created_at: now });
  return {
    duplicated: false,
    item: getLibraryItem(db, String(info.lastInsertRowid)),
  };
}

module.exports = {
  loadCharacterForLibrary,
  buildCharacterLibraryFields,
  findExistingCharacterLibraryItem,
  upsertCharacterLibraryItem,
};