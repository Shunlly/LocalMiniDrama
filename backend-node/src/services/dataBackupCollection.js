'use strict';

// 备份文件收集：遍历存储/原文目录并计算集合哈希。

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Writable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { DataBackupError, backupError } = require('./dataBackupErrors');
const {
  STORAGE_PREFIX,
  STORY_SOURCES_PREFIX,
  archiveNameForDirectory,
  assertUnusedArchiveCollisionKey,
  fileIdentity,
  sameFileIdentity,
} = require('./dataBackupValidation');
const { digestBackupCollectionSha256 } = require('./dataBackupManifest');
const { lstatIfExists } = require('./dataBackupPaths');

async function collectDirectoryFiles(rootPath, entryPrefix, limits) {
  const rootStat = await lstatIfExists(rootPath);
  if (!rootStat) return { files: [], totalBytes: 0 };
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw backupError('UNSAFE_STORAGE');
  }

  const files = [];
  const names = new Set();
  let totalBytes = 0;
  const pending = [{ absolute: rootPath, relative: '' }];

  while (pending.length > 0) {
    const current = pending.pop();
    let entries;
    try {
      entries = await fsp.readdir(current.absolute, { withFileTypes: true });
    } catch (error) {
      throw backupError('STORAGE_READ_FAILED', error);
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      const relative = current.relative ? path.join(current.relative, entry.name) : entry.name;
      const absolute = path.join(current.absolute, entry.name);
      let stat;
      try {
        stat = await fsp.lstat(absolute);
      } catch (error) {
        throw backupError('STORAGE_CHANGED', error);
      }
      if (stat.isSymbolicLink()) {
        throw backupError('SYMLINK_REJECTED');
      }
      if (stat.isDirectory()) {
        pending.push({ absolute, relative });
        continue;
      }
      if (!stat.isFile()) {
        throw backupError('SPECIAL_FILE_REJECTED');
      }
      if (stat.size > limits.maxFileBytes) {
        throw backupError('FILE_LIMIT_EXCEEDED');
      }
      if (files.length + 1 > limits.maxFiles) {
        throw backupError('FILE_LIMIT_EXCEEDED');
      }
      totalBytes += stat.size;
      if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxTotalBytes) {
        throw backupError('SIZE_LIMIT_EXCEEDED');
      }

      const archiveName = archiveNameForDirectory(relative, entryPrefix, limits);
      assertUnusedArchiveCollisionKey(names, archiveName);
      files.push({ absolute, archiveName, identity: fileIdentity(stat) });
    }
  }

  files.sort((a, b) => a.archiveName.localeCompare(b.archiveName));
  return { files, totalBytes };
}

function collectStorageFiles(storagePath, limits) {
  return collectDirectoryFiles(storagePath, STORAGE_PREFIX, limits);
}

function collectStorySourceFiles(storySourcesPath, limits) {
  return collectDirectoryFiles(storySourcesPath, STORY_SOURCES_PREFIX, limits);
}

async function sha256CollectedFile(file) {
  let handle;
  try {
    handle = await fsp.open(file.absolute, fs.constants.O_RDONLY);
    const before = await handle.stat();
    if (!sameFileIdentity(before, file.identity)) {
      throw backupError('BACKUP_DATA_CHANGED');
    }
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (position < file.identity.size) {
      const length = Math.min(buffer.length, file.identity.size - position);
      const result = await handle.read(buffer, 0, length, position);
      if (result.bytesRead <= 0) {
        throw backupError('BACKUP_DATA_CHANGED');
      }
      hash.update(buffer.subarray(0, result.bytesRead));
      position += result.bytesRead;
    }
    const after = await handle.stat();
    if (position !== file.identity.size || !sameFileIdentity(after, file.identity)) {
      throw backupError('BACKUP_DATA_CHANGED');
    }
    return hash.digest('hex');
  } catch (error) {
    if (error instanceof DataBackupError) throw error;
    throw backupError('BACKUP_DATA_READ_FAILED', error);
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

async function hashCollectedFiles(collection) {
  for (const file of collection.files) {
    file.sha256 = await sha256CollectedFile(file);
  }
  collection.sha256 = digestBackupCollectionSha256(collection.files);
  return collection;
}

function hashStorageFiles(collection) {
  return hashCollectedFiles(collection);
}

function hashStorySourceFiles(collection) {
  return hashCollectedFiles(collection);
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(filePath), new Writable({
    write(chunk, encoding, callback) {
      hash.update(chunk);
      callback();
    },
  }));
  return hash.digest('hex');
}

module.exports = {
  collectDirectoryFiles,
  collectStorageFiles,
  collectStorySourceFiles,
  hashCollectedFiles,
  hashStorageFiles,
  hashStorySourceFiles,
  sha256CollectedFile,
  sha256File,
};
