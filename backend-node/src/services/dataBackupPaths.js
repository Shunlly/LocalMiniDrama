'use strict';

// 备份路径解析：数据根、原文目录、旁路临时路径和存在性探测。

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { backupError } = require('./dataBackupErrors');

function randomSuffix() {
  return crypto.randomBytes(8).toString('hex');
}

function resolveDataRoot(value) {
  if (typeof value !== 'string' || value.trim() === '' || !path.isAbsolute(value.trim())) {
    throw backupError('INVALID_DATA_ROOT');
  }
  const resolved = path.resolve(value.trim());
  if (resolved === path.parse(resolved).root) {
    throw backupError('INVALID_DATA_ROOT');
  }
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch (error) {
    throw backupError('INVALID_DATA_ROOT', error);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw backupError('INVALID_DATA_ROOT');
  }
  const realPath = path.resolve(fs.realpathSync(resolved));
  const normalize = (pathValue) => {
    const normalized = path.normalize(pathValue);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  };
  if (normalize(realPath) !== normalize(resolved)) {
    throw backupError('INVALID_DATA_ROOT');
  }
  return realPath;
}

function resolveStorySourcesPath(options = {}) {
  return path.resolve(options.storySourcesPath || path.join(process.cwd(), 'data', 'story_sources'));
}

async function lstatIfExists(target) {
  try {
    return await fsp.lstat(target);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function lstatIfExistsSync(target, options) {
  try {
    return fs.lstatSync(target, options);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function makeSiblingPath(targetPath, label) {
  return path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${label}.${Date.now()}.${randomSuffix()}`
  );
}

async function existingAncestor(targetPath) {
  let current = path.resolve(targetPath);
  while (!(await lstatIfExists(current))) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

module.exports = {
  existingAncestor,
  lstatIfExists,
  lstatIfExistsSync,
  makeSiblingPath,
  randomSuffix,
  resolveDataRoot,
  resolveStorySourcesPath,
};
