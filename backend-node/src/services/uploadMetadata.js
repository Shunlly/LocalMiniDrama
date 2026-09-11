'use strict';

// 从 uploadService 拆出的上传元数据装配：落盘结果、原始素材绑定与完整性字段。

const fs = require('fs');
const path = require('path');
const { createHash, randomUUID } = require('crypto');
const {
  DEFAULT_UPLOAD_DISK_RESERVE_BYTES,
  assertUploadDiskCapacity,
  ensureStorageDirectory,
  getAvailableDiskBytes,
  normalizeStorageRelativeReference,
  openStorageFile,
  removeFile,
  resolveCategoryPaths,
  writeFileAtomically,
} = require('./uploadPaths');

const DEFAULT_STORY_SOURCE_ORIGINAL_QUOTA_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_STORY_SOURCE_ORIGINAL_BYTES = 20 * 1024 * 1024;

class StorySourceStorageError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StorySourceStorageError';
    this.code = code;
  }
}

function assembleDetectedUploadResult(baseUrl, relativePath, absolutePath, detected) {
  const url = baseUrl ? `${baseUrl.replace(/\/$/, '')}/${relativePath}` : `/static/${relativePath}`;
  return {
    url,
    local_path: relativePath,
    absolute_path: absolutePath,
    mime_type: detected.mimeType,
    extension: detected.extension,
    media_type: detected.mediaType,
    ...(Number.isFinite(detected.duration) ? { duration: detected.duration } : {}),
  };
}

function assembleStorySourceOriginalMetadata({
  relativePath,
  serverFilename,
  sha256,
  size,
  mime,
  sourceId,
}) {
  return {
    storage_path: relativePath,
    server_filename: serverFilename,
    sha256,
    size,
    mime,
    download_url: `/api/v1/story-sources/${sourceId}/original`,
  };
}

function storySourceStorageId(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new StorySourceStorageError('UNSAFE_SOURCE_STORAGE', `${label} 必须为正整数`);
  }
  return parsed;
}

function sourceOriginalExtension(source) {
  const allowed = new Set([
    '.txt', '.md', '.csv', '.tsv', '.srt', '.vtt', '.ass', '.json',
    '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif',
    '.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.oga',
    '.mp4', '.mov', '.mkv', '.avi', '.webm', '.ogv',
  ]);
  const supplied = String(source?.extension || '').trim().toLowerCase();
  if (allowed.has(supplied)) return supplied === '.jpeg' ? '.jpg' : supplied;
  const format = String(source?.format || '').trim().toLowerCase();
  const byFormat = {
    jpeg: '.jpg',
    ogg_audio: '.ogg',
    ogg_video: '.ogv',
  };
  const inferred = byFormat[format] || `.${format || 'txt'}`;
  if (!allowed.has(inferred)) {
    throw new StorySourceStorageError('UNSAFE_SOURCE_STORAGE', '检测到的素材扩展名不受支持');
  }
  return inferred;
}

function sourceOriginalMime(value) {
  const mime = String(value || '').trim().toLowerCase();
  if (
    mime.length > 200 ||
    !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(mime)
  ) {
    throw new StorySourceStorageError('UNSAFE_SOURCE_STORAGE', '检测到的素材媒体类型无效');
  }
  return mime;
}

function ensureSecureStorageDirectory(storagePath, relativeDirectory) {
  try {
    const secured = ensureStorageDirectory(storagePath, relativeDirectory);
    return {
      root: secured.root,
      rootReal: secured.rootReal,
      directory: secured.directory,
      relativeDirectory: secured.relativePath,
    };
  } catch (error) {
    if (error?.code === 'UNSAFE_MEDIA_REFERENCE') {
      throw new StorySourceStorageError('UNSAFE_SOURCE_STORAGE', error.message);
    }
    throw error;
  }
}

function directoryFileBytes(directory, stopAfter = Number.MAX_SAFE_INTEGER) {
  if (!fs.existsSync(directory)) return 0;
  const pending = [directory];
  let total = 0;
  while (pending.length) {
    const current = pending.pop();
    const currentStat = fs.lstatSync(current);
    if (currentStat.isSymbolicLink()) {
      throw new StorySourceStorageError(
        'UNSAFE_SOURCE_STORAGE',
        '素材源存储不能包含符号链接'
      );
    }
    if (currentStat.isFile()) {
      total += currentStat.size;
      if (total > stopAfter) return total;
      continue;
    }
    if (!currentStat.isDirectory()) {
      throw new StorySourceStorageError(
        'UNSAFE_SOURCE_STORAGE',
        '素材源存储只能包含普通文件和目录'
      );
    }
    for (const entry of fs.readdirSync(current)) {
      pending.push(path.join(current, entry));
    }
  }
  return total;
}

function persistStorySourceOriginal(storagePath, dramaIdValue, sourceIdValue, source, options = {}) {
  const dramaId = storySourceStorageId(dramaIdValue, 'drama_id');
  const sourceId = storySourceStorageId(sourceIdValue, 'source_id');
  if (!Buffer.isBuffer(source?.buffer) || source.buffer.length === 0) {
    throw new StorySourceStorageError('INVALID_SOURCE_ORIGINAL', '原始素材为空或不可用');
  }
  const maxBytes = Math.max(1, Number(options.maxBytes) || MAX_STORY_SOURCE_ORIGINAL_BYTES);
  if (source.buffer.length > maxBytes) {
    throw new StorySourceStorageError('SOURCE_ORIGINAL_TOO_LARGE', '原始素材超过上传大小限制');
  }

  const quotaBytes = Math.max(1, Number(options.quotaBytes) || DEFAULT_STORY_SOURCE_ORIGINAL_QUOTA_BYTES);
  const dramaRelativeDirectory = `story_sources/${dramaId}`;
  const dramaDirectory = ensureSecureStorageDirectory(storagePath, dramaRelativeDirectory);
  const existingBytes = directoryFileBytes(dramaDirectory.directory, quotaBytes);
  if (existingBytes + source.buffer.length > quotaBytes) {
    throw new StorySourceStorageError(
      'SOURCE_ORIGINAL_QUOTA_EXCEEDED',
      '该项目的原始素材配额已用尽'
    );
  }
  assertUploadDiskCapacity(
    dramaDirectory.root,
    source.buffer.length,
    options.reserveBytes ?? DEFAULT_UPLOAD_DISK_RESERVE_BYTES,
    options.getAvailableBytes ?? getAvailableDiskBytes
  );

  const sourceRelativeDirectory = `${dramaRelativeDirectory}/${sourceId}`;
  const sourceDirectory = ensureSecureStorageDirectory(storagePath, sourceRelativeDirectory);
  const originalRelativeDirectory = `${sourceRelativeDirectory}/original`;
  const originalDirectory = ensureSecureStorageDirectory(storagePath, originalRelativeDirectory);
  const extension = sourceOriginalExtension(source);
  const mime = sourceOriginalMime(source.mime);
  const serverFilename = `${randomUUID()}${extension}`;
  const relativePath = `${originalRelativeDirectory}/${serverFilename}`;
  const absolutePath = path.join(originalDirectory.directory, serverFilename);
  const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
  const flags = fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | noFollow;
  try {
    writeFileAtomically(absolutePath, (stagedPath) => {
      const fd = fs.openSync(stagedPath, flags, 0o600);
      try {
        fs.writeFileSync(fd, source.buffer);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    });
    const written = fs.lstatSync(absolutePath);
    if (written.isSymbolicLink() || !written.isFile() || written.size !== source.buffer.length) {
      throw new StorySourceStorageError('SOURCE_ORIGINAL_WRITE_FAILED', '原始素材未能安全写入');
    }
  } catch (error) {
    try { fs.unlinkSync(absolutePath); } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') throw cleanupError;
    }
    throw error;
  }

  const sha256 = createHash('sha256').update(source.buffer).digest('hex');
  return {
    absolutePath,
    cleanupDirectories: [originalDirectory.directory, sourceDirectory.directory],
    metadata: assembleStorySourceOriginalMetadata({
      relativePath,
      serverFilename,
      sha256,
      size: source.buffer.length,
      mime,
      sourceId,
    }),
  };
}

function removeStorySourceOriginal(artifact, log = null) {
  if (!artifact) return;
  removeFile(artifact.absolutePath, log);
  for (const directory of artifact.cleanupDirectories || []) {
    try {
      fs.rmdirSync(directory);
    } catch (error) {
      if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code) && log?.warn) {
        log.warn('Failed to remove empty story source directory', { error: error.message });
      }
    }
  }
}

function readStorySourceOriginal(storagePath, source) {
  const dramaId = storySourceStorageId(source?.drama_id, 'drama_id');
  const sourceId = storySourceStorageId(source?.id, 'source_id');
  const metadata = source?.metadata?.original_file;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new StorySourceStorageError('SOURCE_ORIGINAL_NOT_FOUND', '该素材源没有保留原始文件');
  }
  const expectedDirectory = `story_sources/${dramaId}/${sourceId}/original`;
  const relativePath = normalizeStorageRelativeReference(metadata.storage_path);
  const serverFilename = String(metadata.server_filename || '');
  if (
    path.posix.dirname(relativePath) !== expectedDirectory ||
    path.posix.basename(relativePath) !== serverFilename ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$/.test(serverFilename)
  ) {
    throw new StorySourceStorageError('UNSAFE_SOURCE_STORAGE', '原始素材元数据未绑定到该素材源');
  }
  const expectedSize = Number(metadata.size);
  const expectedHash = String(metadata.sha256 || '').toLowerCase();
  const mime = sourceOriginalMime(metadata.mime);
  if (
    !Number.isSafeInteger(expectedSize) ||
    expectedSize <= 0 ||
    expectedSize > MAX_STORY_SOURCE_ORIGINAL_BYTES ||
    !/^[0-9a-f]{64}$/.test(expectedHash)
  ) {
    throw new StorySourceStorageError('UNSAFE_SOURCE_STORAGE', '原始素材完整性元数据无效');
  }

  const opened = openStorageFile(storagePath, relativePath);
  let fd = opened.fd;
  try {
    const before = opened.stat;
    if (!before.isFile() || before.size !== expectedSize) {
      throw new StorySourceStorageError('SOURCE_ORIGINAL_INTEGRITY_FAILED', '保留的原始素材大小与元数据不一致');
    }
    const buffer = fs.readFileSync(fd);
    const after = fs.fstatSync(fd);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw new StorySourceStorageError('SOURCE_ORIGINAL_INTEGRITY_FAILED', '保留的原始素材在读取时发生变化');
    }
    const actualHash = createHash('sha256').update(buffer).digest('hex');
    if (actualHash !== expectedHash) {
      throw new StorySourceStorageError('SOURCE_ORIGINAL_INTEGRITY_FAILED', '保留的原始素材哈希与元数据不一致');
    }
    return {
      buffer,
      mime,
      serverFilename,
      sha256: expectedHash,
      size: expectedSize,
    };
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function persistDetectedUpload(storagePath, baseUrl, log, category, projectSubdir, detected, writeFile) {
  const { dir: categoryPath, relPrefix } = resolveCategoryPaths(storagePath, category, projectSubdir);
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  const name = `${timestamp}_${randomUUID()}${detected.extension}`;
  const filePath = path.join(categoryPath, name);
  const relativePath = `${relPrefix}/${name}`.replace(/\\/g, '/');
  try {
    writeFile(filePath);
    const opened = openStorageFile(storagePath, relativePath);
    fs.closeSync(opened.fd);
  } catch (err) {
    removeFile(filePath, log);
    throw err;
  }
  const result = assembleDetectedUploadResult(baseUrl, relativePath, filePath, detected);
  log.info('File uploaded', { path: filePath, url: result.url, mime_type: detected.mimeType });
  return result;
}

module.exports = {
  DEFAULT_STORY_SOURCE_ORIGINAL_QUOTA_BYTES,
  MAX_STORY_SOURCE_ORIGINAL_BYTES,
  StorySourceStorageError,
  assembleDetectedUploadResult,
  assembleStorySourceOriginalMetadata,
  persistDetectedUpload,
  persistStorySourceOriginal,
  readStorySourceOriginal,
  removeStorySourceOriginal,
  sourceOriginalExtension,
  sourceOriginalMime,
  storySourceStorageId,
};
