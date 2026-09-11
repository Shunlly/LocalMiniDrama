// 角色库：与 Go character_library_service 对齐
// 只读查询、行装配、去重校验、SD2/即梦素材中心注册与生成/提示词见
// characterLibraryQuery.js / characterLibraryAssembly.js / characterLibraryDedup.js /
// characterLibrarySd2.js / characterLibraryGeneration.js
const seedance2AssetGuards = require('../utils/seedance2AssetGuards');
const {
  insertLibraryItem,
  normalizeSourceId,
} = require('./libraryDedup');
const { listLibraryItems, getLibraryItem } = require('./characterLibraryQuery');
const { loadCharacterForLibrary, upsertCharacterLibraryItem } = require('./characterLibraryDedup');
const {
  registerCharacterJimengMaterialAsset,
  refreshCharacterJimengMaterialAsset,
} = require('./characterLibrarySd2');
const {
  generateCharacterImage,
  batchGenerateCharacterImages,
  generateCharacterFourViewImage,
  generateCharacterPromptOnly,
  extractAppearanceFromImage,
} = require('./characterLibraryGeneration');

function createLibraryItem(db, log, req) {
  const now = new Date().toISOString();
  const sourceType = req.source_type || 'generated';
  const info = insertLibraryItem(db, 'character_libraries', {
    drama_id: req.drama_id ?? null,
    name: req.name || '',
    category: req.category ?? null,
    image_url: req.image_url || '',
    local_path: req.local_path ?? null,
    description: req.description ?? null,
    tags: req.tags ?? null,
    source_type: sourceType,
    source_id: normalizeSourceId(req.source_id) || null,
    created_at: now,
    updated_at: now,
  });
  log.info('Library item created', { item_id: info.lastInsertRowid });
  return getLibraryItem(db, String(info.lastInsertRowid));
}

function updateLibraryItem(db, log, id, req) {
  const row = db.prepare('SELECT id FROM character_libraries WHERE id = ? AND deleted_at IS NULL').get(Number(id));
  if (!row) return null;
  const updates = [];
  const params = [];
  if (req.name != null) { updates.push('name = ?'); params.push(req.name); }
  if (req.category != null) { updates.push('category = ?'); params.push(req.category); }
  if (req.description != null) { updates.push('description = ?'); params.push(req.description); }
  if (req.tags != null) { updates.push('tags = ?'); params.push(req.tags); }
  if (req.image_url != null) { updates.push('image_url = ?'); params.push(req.image_url); }
  if (req.local_path != null) { updates.push('local_path = ?'); params.push(req.local_path); }
  if (req.source_type != null) { updates.push('source_type = ?'); params.push(req.source_type); }
  if (req.source_id != null) { updates.push('source_id = ?'); params.push(normalizeSourceId(req.source_id)); }
  if (updates.length === 0) return getLibraryItem(db, id);
  params.push(new Date().toISOString(), Number(id));
  db.prepare('UPDATE character_libraries SET ' + updates.join(', ') + ', updated_at = ? WHERE id = ?').run(...params);
  log.info('Library item updated', { item_id: id });
  return getLibraryItem(db, id);
}

function deleteLibraryItem(db, log, id) {
  const now = new Date().toISOString();
  const result = db.prepare('UPDATE character_libraries SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(now, Number(id));
  if (result.changes === 0) return false;
  log.info('Library item deleted', { item_id: id });
  return true;
}

function applyLibraryItemToCharacter(db, log, characterId, libraryItemId) {
  const item = getLibraryItem(db, libraryItemId);
  if (!item) return { ok: false, error: '角色库项不存在' };
  const charRow = db
    .prepare('SELECT id, drama_id, local_path, image_url, seedance2_asset FROM characters WHERE id = ? AND deleted_at IS NULL')
    .get(Number(characterId));
  if (!charRow) return { ok: false, error: '角色不存在' };
  const drama = db.prepare('SELECT id FROM dramas WHERE id = ? AND deleted_at IS NULL').get(charRow.drama_id);
  if (!drama) return { ok: false, error: '无权限' };
  seedance2AssetGuards.markStaleOnCharacterMainImageDrift(db, log, charRow, {
    image_url: item.image_url || null,
    local_path: item.local_path || null,
  });
  const now = new Date().toISOString();
  db.prepare('UPDATE characters SET image_url = ?, local_path = ?, updated_at = ? WHERE id = ?').run(
    item.image_url || null,
    item.local_path || null,
    now,
    Number(characterId)
  );
  log.info('Library item applied to character', { character_id: characterId, library_item_id: libraryItemId });
  return { ok: true };
}

function uploadCharacterImage(db, log, characterId, imageUrl, opts = {}) {
  const charRow = db
    .prepare('SELECT id, drama_id, local_path, image_url, seedance2_asset FROM characters WHERE id = ? AND deleted_at IS NULL')
    .get(Number(characterId));
  if (!charRow) return { ok: false, error: '角色不存在' };
  const drama = db.prepare('SELECT id FROM dramas WHERE id = ? AND deleted_at IS NULL').get(charRow.drama_id);
  if (!drama) return { ok: false, error: '无权限' };
  if (!opts.skipStaleMark) {
    seedance2AssetGuards.markStaleOnCharacterMainImageDrift(db, log, charRow, { image_url: imageUrl });
  }
  const now = new Date().toISOString();
  db.prepare('UPDATE characters SET image_url = ?, updated_at = ? WHERE id = ?').run(imageUrl || null, now, Number(characterId));
  log.info('Character image uploaded', { character_id: characterId });
  return { ok: true };
}

// 加入本剧资源库（带 drama_id）
function addCharacterToLibrary(db, log, characterId, category) {
  const loaded = loadCharacterForLibrary(db, characterId, { requireWritableDrama: true });
  if (!loaded.ok) return loaded;
  const now = new Date().toISOString();
  const result = upsertCharacterLibraryItem(db, {
    charRow: loaded.charRow,
    dramaId: loaded.charRow.drama_id,
    category,
    now,
    includeCategory: true,
  });
  if (result.duplicated) {
    log.info('Character library item reused', {
      character_id: characterId,
      drama_id: loaded.charRow.drama_id,
      library_item_id: result.item.id,
    });
  } else {
    log.info('Character added to drama library', {
      character_id: characterId,
      drama_id: loaded.charRow.drama_id,
      library_item_id: result.item.id,
    });
  }
  return { ok: true, item: result.item, duplicated: result.duplicated };
}

// 加入全局素材库（drama_id = NULL）
function addCharacterToMaterialLibrary(db, log, characterId) {
  const loaded = loadCharacterForLibrary(db, characterId);
  if (!loaded.ok) return loaded;
  const now = new Date().toISOString();
  const result = upsertCharacterLibraryItem(db, {
    charRow: loaded.charRow,
    dramaId: null,
    now,
    includeCategory: false,
  });
  if (result.duplicated) {
    log.info('Character material library item reused', {
      character_id: characterId,
      library_item_id: result.item.id,
    });
  } else {
    log.info('Character added to material library (global)', {
      character_id: characterId,
      library_item_id: result.item.id,
    });
  }
  return { ok: true, item: result.item, duplicated: result.duplicated };
}

function updateCharacter(db, log, characterId, req) {
  const charRow = db
    .prepare('SELECT id, drama_id, local_path, image_url, seedance2_asset FROM characters WHERE id = ? AND deleted_at IS NULL')
    .get(Number(characterId));
  if (!charRow) return { ok: false, error: '角色不存在' };
  const drama = db.prepare('SELECT id FROM dramas WHERE id = ? AND deleted_at IS NULL').get(charRow.drama_id);
  if (!drama) return { ok: false, error: '无权限' };
  const updates = [];
  const params = [];
  if (req.name != null) { updates.push('name = ?'); params.push(req.name); }
  if (req.role != null) { updates.push('role = ?'); params.push(req.role); }
  if (req.appearance != null) { updates.push('appearance = ?'); params.push(req.appearance); }
  if (req.personality != null) { updates.push('personality = ?'); params.push(req.personality); }
  if (req.description != null) { updates.push('description = ?'); params.push(req.description); }
  if (req.image_url != null) { updates.push('image_url = ?'); params.push(req.image_url); }
  if (req.local_path != null) { updates.push('local_path = ?'); params.push(req.local_path); }
  if (req.polished_prompt != null) { updates.push('polished_prompt = ?'); params.push(req.polished_prompt); }
  if (req.stages != null) { updates.push('stages = ?'); params.push(typeof req.stages === 'string' ? req.stages : JSON.stringify(req.stages)); }
  if (req.negative_prompt !== undefined) { updates.push('negative_prompt = ?'); params.push(req.negative_prompt); }
  if (updates.length === 0) return { ok: true };
  if (req.image_url != null || req.local_path != null) {
    seedance2AssetGuards.markStaleOnCharacterMainImageDrift(db, log, charRow, {
      image_url: req.image_url != null ? req.image_url : charRow.image_url,
      local_path: req.local_path != null ? req.local_path : charRow.local_path,
    });
  }
  params.push(new Date().toISOString(), characterId);
  db.prepare('UPDATE characters SET ' + updates.join(', ') + ', updated_at = ? WHERE id = ?').run(...params);
  log.info('Character updated', { character_id: characterId });
  return { ok: true };
}

function deleteCharacter(db, log, characterId) {
  const charRow = db.prepare('SELECT id, drama_id FROM characters WHERE id = ? AND deleted_at IS NULL').get(Number(characterId));
  if (!charRow) return { ok: false, error: '角色不存在' };
  const drama = db.prepare('SELECT id FROM dramas WHERE id = ? AND deleted_at IS NULL').get(charRow.drama_id);
  if (!drama) return { ok: false, error: '无权限' };
  const now = new Date().toISOString();
  db.prepare('UPDATE characters SET deleted_at = ? WHERE id = ?').run(now, Number(characterId));
  log.info('Character deleted', { id: characterId });
  return { ok: true };
}

module.exports = {
  listLibraryItems,
  createLibraryItem,
  getLibraryItem,
  updateLibraryItem,
  deleteLibraryItem,
  applyLibraryItemToCharacter,
  uploadCharacterImage,
  addCharacterToLibrary,
  addCharacterToMaterialLibrary,
  updateCharacter,
  deleteCharacter,
  generateCharacterImage,
  batchGenerateCharacterImages,
  generateCharacterFourViewImage,
  generateCharacterPromptOnly,
  extractAppearanceFromImage,
  registerCharacterJimengMaterialAsset,
  refreshCharacterJimengMaterialAsset,
};
