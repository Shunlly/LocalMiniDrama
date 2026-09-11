/**
 * 角色路由装配：存储路径、音色资产载荷与附加图片字段。
 */
const path = require('path');
const storageLayout = require('../services/storageLayout');

const VOICE_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.ogg']);

function resolveStorageRoot(cfg) {
  const rawStorage = cfg?.storage?.local_path || './data/storage';
  return path.isAbsolute(rawStorage)
    ? rawStorage
    : path.join(process.cwd(), rawStorage);
}

function configuredDiskReserveBytes(cfg, uploadService) {
  const supplied = cfg?.storage?.upload_disk_reserve_bytes
    ?? process.env.LOCALMINIDRAMA_UPLOAD_DISK_RESERVE_BYTES;
  const value = Number(supplied);
  return Number.isFinite(value) && value >= 0
    ? value
    : uploadService.DEFAULT_UPLOAD_DISK_RESERVE_BYTES;
}

function isOwnedVoicePath(relativePath, dramaId, characterId) {
  const directory = path.posix.dirname(relativePath);
  const filename = path.posix.basename(relativePath);
  const extension = path.posix.extname(filename).toLowerCase();
  if (!VOICE_EXTENSIONS.has(extension)) return false;

  const legacyDirectory = `drama_${dramaId}/characters/voice`;
  if (directory === legacyDirectory) {
    return new RegExp(`^char_${characterId}_voice_[0-9]{10,17}\\.(?:mp3|wav|m4a|ogg)$`, 'i')
      .test(filename);
  }

  const ownedDirectory = `${legacyDirectory}/char_${characterId}`;
  return directory === ownedDirectory
    && /^[0-9]{8}T[0-9]{6}_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:mp3|wav|m4a|ogg)$/i.test(filename);
}

function removePreviousVoiceFile(uploadService, storageRoot, previousAsset, charRow, replacementPath, log) {
  const reference = previousAsset?.local_path
    || (String(previousAsset?.url || '').startsWith('/static/') ? previousAsset.url : null);
  if (!reference) return false;
  try {
    const relativePath = uploadService.normalizeStorageRelativeReference(reference);
    if (
      relativePath === replacementPath
      || !isOwnedVoicePath(relativePath, charRow.drama_id, charRow.id)
    ) {
      log?.warn?.('Skipped deletion of unowned character voice file', { character_id: charRow.id });
      return false;
    }
    const resolved = uploadService.resolveStorageReference(storageRoot, relativePath, { allowMissing: true });
    if (!resolved) return false;
    uploadService.removeFile(resolved.absolutePath, log);
    return true;
  } catch (error) {
    log?.warn?.('Skipped unsafe character voice cleanup', {
      character_id: charRow.id,
      error_code: error?.code || 'VOICE_CLEANUP_REJECTED',
    });
    return false;
  }
}

function persistCharacterImage(uploadService, cfg, log, db, dramaId, file) {
  const storagePath = resolveStorageRoot(cfg);
  const baseUrl = cfg?.storage?.base_url || '';
  const projectSubdir = storageLayout.getProjectStorageSubdir(db, dramaId);
  return uploadService.uploadFile(
    storagePath,
    baseUrl,
    log,
    file.buffer,
    file.originalname || 'image.png',
    file.mimetype,
    'characters',
    projectSubdir
  );
}

function persistCharacterVoiceFile(uploadService, cfg, log, file, charId, dramaId, source, detected) {
  const storageRoot = resolveStorageRoot(cfg);
  const saveFile = file.path
    ? uploadService.uploadFileFromPath
    : uploadService.uploadFile;
  const persisted = saveFile(
    storageRoot,
    '',
    log,
    source,
    file.originalname || 'voice-reference',
    file.mimetype,
    `char_${charId}`,
    `drama_${dramaId}/characters/voice`,
    'audio',
    detected,
    {
      reserveBytes: configuredDiskReserveBytes(cfg, uploadService),
      getAvailableBytes: uploadService.getAvailableDiskBytes,
    }
  );
  return { storageRoot, persisted };
}

function assembleVoiceAssetPayload(persisted, now) {
  return {
    status: 'active',
    url: persisted.url,
    local_path: persisted.local_path,
    certified_at: now,
    duration: persisted.duration,
    format: persisted.extension.replace('.', ''),
  };
}

function persistCharacterVoiceAsset(db, characterId, payload, now) {
  return db.prepare(
    'UPDATE characters SET seedance2_voice_asset = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
  ).run(JSON.stringify(payload), now, characterId);
}

function applyCharacterImageExtraUpdate(db, characterId, body) {
  const extraFields = [];
  const extraParams = [];
  if (body.local_path !== undefined) { extraFields.push('local_path = ?'); extraParams.push(body.local_path ?? null); }
  if (body.extra_images !== undefined) { extraFields.push('extra_images = ?'); extraParams.push(body.extra_images ?? null); }
  if (body.ref_image !== undefined) { extraFields.push('ref_image = ?'); extraParams.push(body.ref_image ?? null); }
  if (extraFields.length > 0) {
    db.prepare(`UPDATE characters SET ${extraFields.join(', ')}, updated_at = ? WHERE id = ? AND deleted_at IS NULL`).run(
      ...extraParams, new Date().toISOString(), characterId
    );
  }
}

module.exports = {
  resolveStorageRoot,
  configuredDiskReserveBytes,
  isOwnedVoicePath,
  removePreviousVoiceFile,
  persistCharacterImage,
  persistCharacterVoiceFile,
  assembleVoiceAssetPayload,
  persistCharacterVoiceAsset,
  applyCharacterImageExtraUpdate,
};
