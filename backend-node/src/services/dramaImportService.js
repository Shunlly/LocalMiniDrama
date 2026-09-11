// 项目导入服务：解析 ZIP，还原剧集数据和媒体文件
const fs = require('fs');
const path = require('path');
const storageLayout = require('./storageLayout');
const uploadService = require('./uploadService');
const {
  DEFAULT_IMPORT_LIMITS,
  DramaImportError,
  createImageValidatorProcessSpec,
  importError,
  validateImportComplexity,
  validateStagedImportMedia,
} = require('./dramaImportValidation');
const { normalizeSourceIntakeManifest } = require('./dramaImportManifest');
const { parseZip } = require('./dramaImportParse');
const {
  applyTrustedImportedAssetMetadata,
  ensureDir,
  ensureSafeDirectoryInside,
  getStoragePath,
  removeEmptyParentsInside,
} = require('./dramaImportMedia');
const { applyImportedDrama, resolveTitle } = require('./dramaImportApply');

// 校验、清单、ZIP 条目索引、归档解析、媒体落盘、实体还原与画布还原分别放在
// dramaImportValidation.js / dramaImportManifest.js / dramaImportZip.js /
// dramaImportParse.js / dramaImportMedia.js / dramaImportApply.js /
// dramaImportCanvas.js / dramaImportRestore.js。

function resolveSourceOriginalQuotaBytes(cfg, options = {}) {
  const supplied = options.sourceOriginalQuotaBytes ?? options.quotaBytes
    ?? cfg?.storage?.story_source_original_quota_bytes
    ?? process.env.LOCALMINIDRAMA_SOURCE_ORIGINAL_QUOTA_BYTES
    ?? uploadService.DEFAULT_STORY_SOURCE_ORIGINAL_QUOTA_BYTES;
  const quotaBytes = Number(supplied);
  if (!Number.isSafeInteger(quotaBytes) || quotaBytes <= 0) {
    throw importError(
      'INVALID_SOURCE_ORIGINAL_QUOTA',
      '项目导入原始素材配额必须是正整数'
    );
  }
  return quotaBytes;
}

/**
 * 导入 ZIP，创建剧集并还原所有数据
 * @param {Buffer} zipBuffer
 * @returns {{ drama_id: number, title: string }}
 */
function importDrama(db, cfg, log, zipSource, options = {}) {
  const storagePath = getStoragePath(cfg);
  ensureDir(storagePath);
  const storageStat = fs.lstatSync(storagePath);
  if (storageStat.isSymbolicLink() || !storageStat.isDirectory()) {
    throw importError('UNSAFE_STORAGE', '压缩包不安全：存储根目录不是普通目录');
  }
  const parsed = parseZip(zipSource, { limits: options.limits });
  const { data, files, limits } = parsed;
  const capacity = uploadService.assertUploadDiskCapacity(
    storagePath,
    parsed.totalUncompressedBytes,
    limits.diskReserveBytes,
    options.getAvailableBytes || uploadService.getAvailableDiskBytes
  );
  const availableForImport = Number.isFinite(capacity.availableBytes)
    ? Math.max(0, capacity.availableBytes - limits.diskReserveBytes)
    : limits.maxMaterializedBytes;
  files.setMaterializationBudget(availableForImport);

  const d = data.drama;
  const title = resolveTitle(db, d.title || '导入项目');
  const now = new Date().toISOString();
  const sourceIntakeEntries = normalizeSourceIntakeManifest(data, limits, now);
  const sourceOriginalQuotaBytes = sourceIntakeEntries.length
    ? resolveSourceOriginalQuotaBytes(cfg, options)
    : null;

  let metadata = d.metadata || {};
  if (typeof metadata === 'string') {
    try {
      metadata = JSON.parse(metadata);
    } catch (_) {
      metadata = {};
    }
  }
  metadata.storage_folder_label = storageLayout.sanitizeFolderLabel(title);
  const metaStr = JSON.stringify(metadata);

  const stagingRoot = fs.mkdtempSync(path.join(storagePath, '.import-staging-'));
  let result;
  const movedFinalPaths = [];
  const runImport = db.transaction(() => {
    result = applyImportedDrama(
      db,
      stagingRoot,
      files,
      data,
      d,
      title,
      metaStr,
      now,
      log,
      sourceIntakeEntries,
      {
        quotaBytes: sourceOriginalQuotaBytes,
        reserveBytes: limits.diskReserveBytes,
        getAvailableBytes: options.getAvailableBytes || uploadService.getAvailableDiskBytes,
      }
    );
    if (typeof options.faultInjector === 'function') options.faultInjector('before-file-commit', result);
    const trustedMediaMetadata = validateStagedImportMedia(stagingRoot, result.project_dir, limits);
    applyTrustedImportedAssetMetadata(db, result.drama_id, trustedMediaMetadata);
    const commitDirectories = [result.project_dir, ...(result.source_original_dir ? [result.source_original_dir] : [])];
    for (const relativeDirectory of commitDirectories) {
      const segments = String(relativeDirectory || '').split('/');
      const stagedPath = path.resolve(stagingRoot, ...segments);
      const finalPath = path.resolve(storagePath, ...segments);
      const stageRelation = path.relative(path.resolve(stagingRoot), stagedPath);
      const finalRelation = path.relative(path.resolve(storagePath), finalPath);
      if (
        !stageRelation || stageRelation.startsWith(`..${path.sep}`) || path.isAbsolute(stageRelation) ||
        !finalRelation || finalRelation.startsWith(`..${path.sep}`) || path.isAbsolute(finalRelation)
      ) {
        throw importError('UNSAFE_IMPORT_TARGET', '压缩包不安全：导入目录会逃出存储目录');
      }
      if (relativeDirectory === result.project_dir) ensureDir(stagedPath);
      if (!fs.existsSync(stagedPath) || !fs.lstatSync(stagedPath).isDirectory()) {
        throw importError('IMPORT_STAGE_MISSING', '压缩包导入失败：临时导入目录不完整');
      }
      ensureSafeDirectoryInside(storagePath, path.dirname(finalPath));
      if (fs.existsSync(finalPath)) {
        throw importError('IMPORT_TARGET_EXISTS', '导入目标目录已存在，拒绝覆盖');
      }
      fs.renameSync(stagedPath, finalPath);
      movedFinalPaths.push(finalPath);
    }
    if (typeof options.faultInjector === 'function') options.faultInjector('after-file-commit', result);
  });
  try {
    runImport();
    return { drama_id: result.drama_id, title: result.title };
  } catch (error) {
    for (const finalPath of movedFinalPaths.reverse()) {
      fs.rmSync(finalPath, { recursive: true, force: true });
      removeEmptyParentsInside(storagePath, path.dirname(finalPath));
    }
    if (error?.code === 'ENOSPC') throw importError('INSUFFICIENT_STORAGE', '压缩包导入失败：磁盘空间不足', error);
    throw error;
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

module.exports = {
  DEFAULT_IMPORT_LIMITS,
  DramaImportError,
  createImageValidatorProcessSpec,
  importDrama,
  parseZip,
  resolveSourceOriginalQuotaBytes,
  validateImportComplexity,
};
