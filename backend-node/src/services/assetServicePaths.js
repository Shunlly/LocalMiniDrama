/**
 * 素材路径规范化：本地引用、项目作用域与受控上传文件解析。
 * 路由仍通过 assetService 调用，本模块不改变公开 API。
 */

const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../config');
const uploadService = require('./uploadService');
const storageLayout = require('./storageLayout');
const { assetBadRequest: badRequest } = require('./assetServiceQuery');

function normalizeLocalReference(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw badRequest(`${field === 'local_path' ? '本地路径' : field === 'url' ? '媒体地址' : '媒体路径'} 必须为安全的本地媒体引用`);
  try {
    const relative = value.startsWith('/static/') ? value.slice('/static/'.length) : value;
    return uploadService.normalizeStorageRelativeReference(relative);
  } catch (_) {
    throw badRequest(`${field === 'local_path' ? '本地路径' : field === 'url' ? '媒体地址' : '媒体路径'} 必须为安全的本地媒体引用`);
  }
}

function normalizeLocalPath(localPath) {
  if (typeof localPath !== 'string') return null;
  const raw = localPath.trim();
  if (!raw) return null;
  const relative = raw.startsWith('/static/') ? raw.slice('/static/'.length) : raw;
  try {
    return uploadService.normalizeStorageRelativeReference(relative);
  } catch (_) {
    return null;
  }
}

function localPathReferenceKey(localPath) {
  const normalized = normalizeLocalPath(localPath);
  return process.platform === 'win32' && normalized ? normalized.toLowerCase() : normalized;
}

function physicalPathKey(filePath) {
  if (typeof filePath !== 'string' || !filePath) return null;
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isWithinRoot(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function configuredStorageRoot(options = {}) {
  if (options.storageRoot) return path.resolve(options.storageRoot);
  const cfg = loadConfig();
  const rawStorage = cfg?.storage?.local_path || './data/storage';
  return path.isAbsolute(rawStorage) ? rawStorage : path.join(process.cwd(), rawStorage);
}

function controlledUploadReference(localPath) {
  const normalized = normalizeLocalPath(localPath);
  if (!normalized) return null;
  const segments = normalized.split('/');
  if (segments.length < 2 || segments[segments.length - 2] !== 'uploads') return null;
  return normalized;
}

function resolveControlledUploadPath(storageRoot, localPath) {
  const normalized = controlledUploadReference(localPath);
  if (!normalized) return null;
  const segments = normalized.split('/');

  const root = path.resolve(storageRoot);
  const candidate = path.resolve(root, ...segments);
  if (!isWithinRoot(root, candidate)) return null;
  try {
    const realRoot = fs.realpathSync.native(root);
    const realCandidate = fs.realpathSync.native(candidate);
    if (!isWithinRoot(realRoot, realCandidate)) return null;
    const candidateStat = fs.statSync(candidate);
    const realCandidateStat = fs.statSync(realCandidate);
    if (
      !candidateStat.isFile()
      || candidateStat.dev !== realCandidateStat.dev
      || candidateStat.ino !== realCandidateStat.ino
    ) {
      return null;
    }
    return {
      absolutePath: candidate,
      normalizedPath: normalized,
      realPath: realCandidate,
      identity: `${candidateStat.dev}:${candidateStat.ino}`,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function isAllowedProjectPath(drama, localPath) {
  if (!localPath) return true;
  if (localPath === 'library' || localPath.startsWith('library/')) return true;
  if (!drama) return localPath === 'uploads' || localPath.startsWith('uploads/');
  const currentPrefix = storageLayout.buildProjectRelativeDir(drama);
  const legacyPrefix = `dramas/${Number(drama.id)}`;
  return localPath === currentPrefix
    || localPath.startsWith(`${currentPrefix}/`)
    || localPath === legacyPrefix
    || localPath.startsWith(`${legacyPrefix}/`);
}

function assertProjectPathScope(drama, localPath, field) {
  if (!localPath) return localPath;
  if (!isAllowedProjectPath(drama, localPath)) {
    throw badRequest(`${field} 不属于当前项目或公共素材库`);
  }
  return localPath;
}

module.exports = {
  normalizeLocalReference,
  normalizeLocalPath,
  localPathReferenceKey,
  physicalPathKey,
  isWithinRoot,
  configuredStorageRoot,
  controlledUploadReference,
  resolveControlledUploadPath,
  isAllowedProjectPath,
  assertProjectPathScope,
};
