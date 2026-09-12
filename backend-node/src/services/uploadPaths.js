'use strict';

// 从 uploadService 拆出的存储路径：相对引用规范化、安全解析、原子写入与磁盘容量。

const fs = require('fs');
const path = require('path');
const net = require('net');
const { randomUUID } = require('crypto');
const {
  UnsafeMediaReferenceError,
  ipv4InCidr,
  normalizedHostname,
} = require('./uploadValidation');

const DEFAULT_UPLOAD_DISK_RESERVE_BYTES = 512 * 1024 * 1024;

class InsufficientUploadStorageError extends Error {
  constructor(requiredBytes, availableBytes, reserveBytes) {
    super('存储空间不足，请清理磁盘后重试');
    this.name = 'InsufficientUploadStorageError';
    this.code = 'INSUFFICIENT_STORAGE';
    this.requiredBytes = requiredBytes;
    this.availableBytes = availableBytes;
    this.reserveBytes = reserveBytes;
  }
}

function decodeReferencePath(value) {
  let decoded = String(value || '');
  for (let count = 0; count < 3; count += 1) {
    let next;
    try {
      next = decodeURIComponent(decoded);
    } catch (_) {
      throw new UnsafeMediaReferenceError('媒体引用包含无效的百分号编码');
    }
    if (next === decoded) return decoded;
    decoded = next;
  }
  if (/%[0-9a-f]{2}/i.test(decoded)) {
    throw new UnsafeMediaReferenceError('媒体引用包含嵌套的百分号编码');
  }
  return decoded;
}

function normalizeStorageRelativeReference(value) {
  const text = String(value || '').trim();
  if (!text || text.length > 2048 || /[\u0000-\u001f\u007f?#]/.test(text)) {
    throw new UnsafeMediaReferenceError('本地媒体引用无效');
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) || path.isAbsolute(text) || /^[\\/]{2}/.test(text)) {
    throw new UnsafeMediaReferenceError('不允许使用绝对本地媒体路径');
  }
  let relative = decodeReferencePath(text).replace(/\\/g, '/');
  relative = relative.replace(/^\/+/, '');
  if (relative.toLowerCase().startsWith('static/')) relative = relative.slice('static/'.length);
  const segments = relative.split('/');
  if (!relative || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new UnsafeMediaReferenceError('本地媒体引用超出存储目录');
  }
  const normalized = path.posix.normalize(relative);
  if (normalized !== relative || path.posix.isAbsolute(normalized) || /^[a-z]:/i.test(normalized)) {
    throw new UnsafeMediaReferenceError('本地媒体引用超出存储目录');
  }
  return normalized;
}

function localReferenceFromValue(value) {
  const text = String(value || '').trim();
  if (!text) throw new UnsafeMediaReferenceError('媒体引用为空');
  if (text.startsWith('/static/')) return normalizeStorageRelativeReference(text.slice('/static/'.length));
  if (/^https?:\/\//i.test(text)) {
    let parsed;
    try {
      parsed = new URL(text);
    } catch (_) {
      throw new UnsafeMediaReferenceError('媒体 URL 无效');
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new UnsafeMediaReferenceError('媒体 URL 必须是不含凭据的 HTTP(S) 地址');
    }
    const host = normalizedHostname(parsed.hostname);
    const isKnownLocal = host === 'localhost' || host.endsWith('.localhost') || host === '::1' ||
      (net.isIP(host) === 4 && ipv4InCidr(host, '127.0.0.0', 8));
    if (isKnownLocal && parsed.pathname.startsWith('/static/')) {
      return normalizeStorageRelativeReference(parsed.pathname.slice('/static/'.length));
    }
    return null;
  }
  return normalizeStorageRelativeReference(text);
}

function inspectStorageRoot(storagePath, options = {}) {
  if (!storagePath) throw new UnsafeMediaReferenceError('本地媒体需要配置存储根目录');
  const root = path.resolve(storagePath);
  const parsed = path.parse(root);
  const segments = root.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;
  const pathsToInspect = [current];
  for (const segment of segments) {
    current = path.join(current, segment);
    pathsToInspect.push(current);
  }

  for (const candidate of pathsToInspect) {
    let stat;
    try {
      stat = fs.lstatSync(candidate);
    } catch (error) {
      if (error?.code !== 'ENOENT' || !options.create) {
        throw new UnsafeMediaReferenceError('存储根目录不可用', 'NOT_FOUND');
      }
      try {
        fs.mkdirSync(candidate);
        stat = fs.lstatSync(candidate);
      } catch (mkdirError) {
        throw new UnsafeMediaReferenceError('无法安全创建存储根目录', 'CREATE_FAILED');
      }
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new UnsafeMediaReferenceError(
        '存储根路径不能包含符号链接或非目录项',
        stat.isSymbolicLink() ? 'SYMLINK' : 'NOT_DIRECTORY'
      );
    }
  }
  return { root, rootReal: fs.realpathSync(root) };
}

function ensureStorageDirectory(storagePath, relativeDirectory) {
  const relative = normalizeStorageRelativeReference(relativeDirectory);
  const { root, rootReal } = inspectStorageRoot(storagePath, { create: true });
  let current = root;
  for (const segment of relative.split('/')) {
    current = path.join(current, segment);
    try {
      fs.mkdirSync(current);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new UnsafeMediaReferenceError(
        '存储目录不能包含符号链接或非目录项',
        stat.isSymbolicLink() ? 'SYMLINK' : 'NOT_DIRECTORY'
      );
    }
    const currentReal = fs.realpathSync(current);
    const relation = path.relative(rootReal, currentReal);
    if (relation === '..' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
      throw new UnsafeMediaReferenceError('存储目录超出根路径');
    }
  }
  return { root, rootReal, directory: current, relativePath: relative };
}

function resolveStorageReference(storagePath, value, options = {}) {
  const relativePath = localReferenceFromValue(value);
  if (!relativePath) return null;
  const { root, rootReal } = inspectStorageRoot(storagePath);
  const candidate = path.resolve(root, ...relativePath.split('/'));
  const relation = path.relative(root, candidate);
  if (!relation || relation === '..' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    throw new UnsafeMediaReferenceError('本地媒体引用超出存储目录');
  }
  if (options.mustExist === false) {
    return { relativePath, absolutePath: candidate, canonical: `/static/${relativePath}` };
  }
  let current = root;
  const segments = relativePath.split('/');
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    current = path.join(current, segment);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error?.code === 'ENOENT' && options.allowMissing) return null;
      throw new UnsafeMediaReferenceError('本地媒体文件不存在', 'NOT_FOUND');
    }
    if (stat.isSymbolicLink()) {
      throw new UnsafeMediaReferenceError('本地媒体不允许使用符号链接', 'SYMLINK');
    }
    if (index < segments.length - 1 && !stat.isDirectory()) {
      throw new UnsafeMediaReferenceError('本地媒体路径包含非目录项', 'NOT_DIRECTORY');
    }
  }
  const candidateReal = fs.realpathSync(candidate);
  const realRelation = path.relative(rootReal, candidateReal);
  const stat = fs.statSync(candidateReal);
  if (!realRelation || realRelation === '..' || realRelation.startsWith(`..${path.sep}`) || path.isAbsolute(realRelation) || !stat.isFile()) {
    throw new UnsafeMediaReferenceError('本地媒体文件不在存储目录内，或不是普通文件');
  }
  return { relativePath, absolutePath: candidateReal, canonical: `/static/${relativePath}` };
}

function sameFileIdentity(left, right) {
  if (!left || !right || !left.isFile() || !right.isFile()) return false;
  if (Number(left.ino) !== 0 || Number(right.ino) !== 0) {
    return left.dev === right.dev && left.ino === right.ino;
  }
  return left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.birthtimeMs === right.birthtimeMs;
}

function openStorageFile(storagePath, value) {
  const resolved = resolveStorageReference(storagePath, value);
  if (!resolved) throw new UnsafeMediaReferenceError('需要提供本地存储文件');
  const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
  let fd;
  try {
    fd = fs.openSync(resolved.absolutePath, fs.constants.O_RDONLY | noFollow);
    const openedStat = fs.fstatSync(fd);
    const verified = resolveStorageReference(storagePath, resolved.relativePath);
    const verifiedStat = fs.statSync(verified.absolutePath);
    if (
      verified.absolutePath !== resolved.absolutePath ||
      !sameFileIdentity(openedStat, verifiedStat)
    ) {
      throw new UnsafeMediaReferenceError('本地媒体文件在打开过程中发生变化', 'CHANGED');
    }
    return { ...verified, fd, stat: openedStat };
  } catch (error) {
    if (fd !== undefined) fs.closeSync(fd);
    throw error;
  }
}

function createSiblingStagingPath(finalPath, label = 'tmp') {
  const resolved = path.resolve(finalPath);
  return path.join(
    path.dirname(resolved),
    `.${path.basename(resolved)}.${randomUUID()}.${label}`
  );
}

function fsyncFile(filePath) {
  let fd;
  try {
    try {
      fd = fs.openSync(filePath, fs.constants.O_RDWR);
    } catch (_) {
      fd = fs.openSync(filePath, fs.constants.O_RDONLY);
    }
    fs.fsyncSync(fd);
  } catch (error) {
    if (process.platform !== 'win32' || !['EINVAL', 'EPERM', 'ENOTSUP'].includes(error?.code)) {
      throw error;
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function fsyncDirectory(directoryPath) {
  let fd;
  try {
    fd = fs.openSync(directoryPath, fs.constants.O_RDONLY);
    fs.fsyncSync(fd);
  } catch (error) {
    // Windows 不支持对目录句柄执行 fsync；文件 fsync 和同盘 rename 仍然必须成功。
    if (process.platform !== 'win32' || !['EINVAL', 'EPERM', 'EISDIR', 'ENOTSUP'].includes(error?.code)) {
      throw error;
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function removeFileQuietly(filePath) {
  if (!filePath) return;
  try {
    fs.rmSync(filePath, { force: true });
  } catch (_) {}
}

/**
 * 发布一个已完整写入的同盘暂存文件。调用方在数据库提交后调用 commit；提交失败则调用 rollback。
 */
function publishStagedFile(stagedPath, finalPath) {
  const staged = path.resolve(stagedPath);
  const final = path.resolve(finalPath);
  const finalDirectory = path.dirname(final);
  const stagedDirectory = path.dirname(staged);
  if (fs.statSync(stagedDirectory).dev !== fs.statSync(finalDirectory).dev) {
    throw new Error('暂存文件必须与最终文件位于同一文件系统');
  }
  const stagedStat = fs.statSync(staged);
  if (!stagedStat.isFile() || stagedStat.size <= 0) {
    throw new Error('暂存文件为空或不是普通文件');
  }

  fsyncFile(staged);
  let backupPath = null;
  let published = false;
  try {
    if (fs.existsSync(final)) {
      const finalStat = fs.lstatSync(final);
      if (finalStat.isSymbolicLink() || !finalStat.isFile()) {
        throw new UnsafeMediaReferenceError('本地媒体输出不是普通文件', 'OUTPUT_TYPE');
      }
      backupPath = createSiblingStagingPath(final, 'backup');
      try {
        fs.linkSync(final, backupPath);
      } catch (_) {
        fs.copyFileSync(final, backupPath, fs.constants.COPYFILE_EXCL);
        fsyncFile(backupPath);
      }
    }
    fs.renameSync(staged, final);
    published = true;
    fsyncDirectory(stagedDirectory);
    fsyncDirectory(finalDirectory);
  } catch (error) {
    if (published) removeFileQuietly(final);
    if (backupPath && fs.existsSync(backupPath)) {
      try { fs.renameSync(backupPath, final); } catch (_) {}
    }
    removeFileQuietly(staged);
    removeFileQuietly(backupPath);
    throw error;
  }

  let settled = false;
  return {
    finalPath: final,
    commit() {
      if (settled) return;
      settled = true;
      removeFileQuietly(backupPath);
      fsyncDirectory(finalDirectory);
    },
    rollback() {
      if (settled) return;
      settled = true;
      removeFileQuietly(final);
      if (backupPath && fs.existsSync(backupPath)) fs.renameSync(backupPath, final);
      fsyncDirectory(finalDirectory);
    },
  };
}

function writeFileAtomically(finalPath, writeStagedFile) {
  const stagedPath = createSiblingStagingPath(finalPath);
  let publication = null;
  try {
    writeStagedFile(stagedPath);
    publication = publishStagedFile(stagedPath, finalPath);
    publication.commit();
    return finalPath;
  } catch (error) {
    publication?.rollback();
    removeFileQuietly(stagedPath);
    throw error;
  }
}

function writeStorageBuffer(storagePath, value, buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError('本地存储输出必须是 Buffer');
  }
  const relativePath = normalizeStorageRelativeReference(value);
  const segments = relativePath.split('/');
  const filename = segments.pop();
  const parent = segments.length
    ? ensureStorageDirectory(storagePath, segments.join('/'))
    : inspectStorageRoot(storagePath, { create: true });
  const absolutePath = path.join(parent.directory || parent.root, filename);
  writeFileAtomically(absolutePath, (stagedPath) => {
    const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
    const fd = fs.openSync(
      stagedPath,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | noFollow,
      0o600
    );
    try {
      fs.writeFileSync(fd, buffer);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  });
  return resolveStorageReference(storagePath, relativePath);
}

function getExistingDiskPath(targetPath) {
  let current = path.resolve(targetPath || process.cwd());
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

function getAvailableDiskBytes(targetPath) {
  if (typeof fs.statfsSync !== 'function') return Number.POSITIVE_INFINITY;
  const stat = fs.statfsSync(getExistingDiskPath(targetPath));
  const availableBlocks = stat.bavail ?? stat.bfree;
  const availableBytes = Number(availableBlocks) * Number(stat.bsize);
  return Number.isFinite(availableBytes) ? availableBytes : Number.POSITIVE_INFINITY;
}

function assertUploadDiskCapacity(
  targetPath,
  requiredBytes,
  reserveBytes = DEFAULT_UPLOAD_DISK_RESERVE_BYTES,
  getAvailableBytes = getAvailableDiskBytes
) {
  const required = Math.max(0, Number(requiredBytes) || 0);
  const reserve = Math.max(0, Number(reserveBytes) || 0);
  let available;
  try {
    available = Number(getAvailableBytes(targetPath));
  } catch (err) {
    if (err?.code === 'ENOSPC') {
      throw new InsufficientUploadStorageError(required, 0, reserve);
    }
    throw err;
  }
  if (Number.isFinite(available) && available - required < reserve) {
    throw new InsufficientUploadStorageError(required, available, reserve);
  }
  return { availableBytes: available, requiredBytes: required, reserveBytes: reserve };
}

function isUploadStorageError(err) {
  return Boolean(err && [
    'INSUFFICIENT_STORAGE',
    'SOURCE_ORIGINAL_QUOTA_EXCEEDED',
    'ENOSPC',
  ].includes(err.code));
}

function resolveCategoryPaths(storagePath, category, projectSubdir) {
  const sub = projectSubdir && String(projectSubdir).trim();
  const relPrefix = sub
    ? `${sub.replace(/\\/g, '/')}/${category}`
    : String(category || '');
  const secured = ensureStorageDirectory(storagePath, relPrefix);
  return { dir: secured.directory, relPrefix: secured.relativePath };
}

function removeFile(filePath, log = null) {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT' && log?.warn) {
      log.warn('Failed to remove upload file', { path: filePath, error: err.message });
    }
  }
}

module.exports = {
  DEFAULT_UPLOAD_DISK_RESERVE_BYTES,
  InsufficientUploadStorageError,
  assertUploadDiskCapacity,
  decodeReferencePath,
  ensureStorageDirectory,
  fsyncDirectory,
  fsyncFile,
  getAvailableDiskBytes,
  isUploadStorageError,
  localReferenceFromValue,
  normalizeStorageRelativeReference,
  openStorageFile,
  publishStagedFile,
  removeFile,
  resolveCategoryPaths,
  resolveStorageReference,
  writeFileAtomically,
  writeStorageBuffer,
};
