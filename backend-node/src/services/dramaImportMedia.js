// 项目导入媒体落盘：安全目录、素材原件与归档媒体写入
const fs = require('fs');
const path = require('path');
const { createHash, randomUUID } = require('crypto');
const uploadService = require('./uploadService');
const sourceMediaExtractionService = require('./sourceMediaExtractionService');
const storyboardService = require('./storyboardService');
const { IMPORT_MEDIA_EXTENSIONS, importError } = require('./dramaImportValidation');

function getStoragePath(cfg) {
  const raw = cfg?.storage?.local_path || './data/storage';
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function ensureSafeDirectoryInside(root, directory) {
  const resolvedRoot = path.resolve(root);
  const resolvedDirectory = path.resolve(directory);
  const relative = path.relative(resolvedRoot, resolvedDirectory);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw importError('UNSAFE_IMPORT_TARGET', '压缩包不安全：媒体目录会逃出存储目录');
  }
  const rootReal = fs.realpathSync(resolvedRoot);
  let current = resolvedRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) fs.mkdirSync(current);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw importError('UNSAFE_IMPORT_TARGET', '压缩包不安全：媒体目录不能包含符号链接');
    }
    const currentReal = fs.realpathSync(current);
    const realRelation = path.relative(rootReal, currentReal);
    if (realRelation === '..' || realRelation.startsWith(`..${path.sep}`) || path.isAbsolute(realRelation)) {
      throw importError('UNSAFE_IMPORT_TARGET', '压缩包不安全：媒体目录会逃出存储目录');
    }
  }
}

function removeEmptyParentsInside(root, startDirectory) {
  const resolvedRoot = path.resolve(root);
  let current = path.resolve(startDirectory);
  while (current !== resolvedRoot) {
    const relation = path.relative(resolvedRoot, current);
    if (relation === '..' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) return;
    try {
      fs.rmdirSync(current);
    } catch (error) {
      if (['ENOENT'].includes(error.code)) {
        current = path.dirname(current);
        continue;
      }
      if (['ENOTEMPTY', 'EEXIST'].includes(error.code)) return;
      throw error;
    }
    current = path.dirname(current);
  }
}

function restoreSourceIntakeOriginals(db, storagePath, files, dramaId, entries, options = {}) {
  for (const entry of entries) {
    const buffer = files.read(entry.original.archive_path);
    if (!buffer) {
      throw importError('SOURCE_ORIGINAL_MISSING', '素材导入原始文件不在压缩包中');
    }
    if (buffer.length !== entry.original.size) {
      throw importError('SOURCE_ORIGINAL_SIZE_MISMATCH', '素材导入原始文件大小校验失败');
    }
    const actualHash = createHash('sha256').update(buffer).digest('hex');
    if (actualHash !== entry.original.sha256) {
      throw importError('SOURCE_ORIGINAL_HASH_MISMATCH', '素材导入原始文件哈希校验失败');
    }

    let descriptor;
    try {
      descriptor = sourceMediaExtractionService.inspectUploadedFile({
        buffer,
        originalname: `original${entry.original.extension}`,
        mimetype: entry.original.mime,
        size: buffer.length,
      });
    } catch (error) {
      throw importError(
        'SOURCE_ORIGINAL_MIME_MISMATCH',
        '素材导入原始文件与路径或类型不一致',
        error
      );
    }

    files.reserveMaterialized(buffer.length);
    const metadata = {
      ...entry.metadata,
      imported_via: 'project_archive',
      archive_source_ref: entry.source_ref,
    };
    const sourceInfo = db.prepare(
      `INSERT INTO story_sources
       (drama_id, source_type, title, raw_text_path, content_hash, metadata, created_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?)`
    ).run(
      dramaId,
      entry.source_type,
      entry.title,
      entry.content_hash,
      JSON.stringify(metadata),
      entry.created_at
    );
    const sourceId = Number(sourceInfo.lastInsertRowid);
    const artifact = uploadService.persistStorySourceOriginal(
      storagePath,
      dramaId,
      sourceId,
      {
        buffer,
        extension: descriptor.extension,
        format: descriptor.format,
        mime: descriptor.mime,
      },
      {
        maxBytes: sourceMediaExtractionService.MAX_SOURCE_UPLOAD_BYTES,
        quotaBytes: options.quotaBytes,
        reserveBytes: options.reserveBytes,
        getAvailableBytes: options.getAvailableBytes,
      }
    );
    metadata.original_file = artifact.metadata;
    db.prepare('UPDATE story_sources SET metadata = ? WHERE id = ?')
      .run(JSON.stringify(metadata), sourceId);
  }
}

function applyTrustedImportedAssetMetadata(db, dramaId, trustedMetadata) {
  if (!(trustedMetadata instanceof Map) || trustedMetadata.size === 0) return;
  const update = db.prepare(
    `UPDATE assets
     SET file_size = ?, mime_type = ?, width = ?, height = ?, duration = ?
     WHERE drama_id = ? AND local_path = ? AND deleted_at IS NULL`
  );
  for (const [localPath, metadata] of trustedMetadata) {
    update.run(
      metadata.fileSize,
      metadata.mimeType,
      metadata.width,
      metadata.height,
      metadata.duration,
      dramaId,
      localPath
    );
  }
}

/**
 * 保存媒体文件到 storage，返回相对路径
 * @param {string} projectDir 如 projects/0001_20250324_剧名，与工程内其它媒体一致
 */
function saveMediaFile(storagePath, projectDir, category, files, zipPath, prefix) {
  if (!zipPath) return null;
  const buf = files.read(zipPath);
  if (!buf) return null;
  const ext = path.extname(String(zipPath)).toLowerCase();
  if (!IMPORT_MEDIA_EXTENSIONS[category]?.has(ext)) {
    throw importError('UNSUPPORTED_MEDIA_TYPE', '压缩包不安全：媒体扩展名不受支持');
  }
  files.reserveMaterialized(buf.length);
  const categoryPath = path.join(storagePath, projectDir, category);
  const storageRoot = path.resolve(storagePath);
  const resolvedCategory = path.resolve(categoryPath);
  const relation = path.relative(storageRoot, resolvedCategory);
  if (!relation || relation === '..' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    throw importError('UNSAFE_IMPORT_TARGET', '压缩包不安全：媒体目标会逃出临时导入目录');
  }
  ensureDir(categoryPath);
  const name = `${prefix}_${randomUUID().slice(0, 8)}${ext}`;
  const abs = path.join(categoryPath, name);
  fs.writeFileSync(abs, buf, { flag: 'wx' });
  return `${projectDir}/${category}/${name}`.replace(/\\/g, '/');
}

/**
 * 批量保存 extra_image_files 数组，返回本地路径 JSON 字符串
 */
function saveExtraImages(storagePath, projectDir, category, files, zipPaths, prefix) {
  if (!Array.isArray(zipPaths) || zipPaths.length === 0) return null;
  const localPaths = [];
  for (const zipPath of zipPaths) {
    const localPath = saveMediaFile(storagePath, projectDir, category, files, zipPath, prefix);
    if (localPath) localPaths.push(localPath);
  }
  return localPaths.length > 0 ? JSON.stringify(localPaths) : null;
}

function restoreStoryboardReferenceImages(storagePath, projectDir, files, items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const restored = [];
  for (let index = 0; index < Math.min(items.length, 10); index++) {
    const item = items[index];
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const localPath = saveMediaFile(
      storagePath,
      projectDir,
      'references',
      files,
      item.zip_file || item.file,
      'sb_ref_imp'
    );
    if (!localPath) continue;
    restored.push({
      name: String(item.name || item.filename || `参考图 ${index + 1}`).slice(0, 200),
      local_path: localPath,
      image_url: null,
    });
  }
  if (restored.length === 0) return null;
  return storyboardService.normalizeReferenceImages(restored);
}

module.exports = {
  applyTrustedImportedAssetMetadata,
  ensureDir,
  ensureSafeDirectoryInside,
  getStoragePath,
  removeEmptyParentsInside,
  restoreSourceIntakeOriginals,
  restoreStoryboardReferenceImages,
  saveExtraImages,
  saveMediaFile,
};
