'use strict';

// 备份清单装配：生成、序列化，并对照压缩包或已安装数据校验。

const crypto = require('node:crypto');
const { FORMAT_VERSION } = require('./dataBackupFormatContract');
const { backupError } = require('./dataBackupErrors');
const {
  DATABASE_ENTRY,
  MANIFEST_ENTRY,
  STORAGE_PREFIX,
  STORY_SOURCES_PREFIX,
  fileIdentity,
} = require('./dataBackupValidation');

function assertBackupPayloadLimits({ databaseBytes, storage, storySources, limits }) {
  if (databaseBytes > limits.maxFileBytes) {
    throw backupError('FILE_LIMIT_EXCEEDED');
  }
  const directoryFileCount = storage.files.length + storySources.files.length;
  if (directoryFileCount > limits.maxFiles) {
    throw backupError('FILE_LIMIT_EXCEEDED');
  }
  const totalBytes = databaseBytes + storage.totalBytes + storySources.totalBytes;
  if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxTotalBytes) {
    throw backupError('SIZE_LIMIT_EXCEEDED');
  }
  return { directoryFileCount, totalBytes };
}

function assembleBackupManifest({
  createdAt,
  databaseSha256,
  databaseBytes,
  storage,
  storySources,
  secretPolicy,
}) {
  const directoryFileCount = storage.files.length + storySources.files.length;
  const totalBytes = databaseBytes + storage.totalBytes + storySources.totalBytes;
  return {
    formatVersion: FORMAT_VERSION,
    createdAt,
    database: {
      entry: DATABASE_ENTRY,
      sha256: databaseSha256,
      bytes: databaseBytes,
    },
    storage: {
      entryPrefix: STORAGE_PREFIX,
      fileCount: storage.files.length,
      totalBytes: storage.totalBytes,
      sha256: storage.sha256,
    },
    storySources: {
      entryPrefix: STORY_SOURCES_PREFIX,
      fileCount: storySources.files.length,
      totalBytes: storySources.totalBytes,
      sha256: storySources.sha256,
      referenceCount: storySources.referenceCount,
    },
    fileCount: directoryFileCount + 1,
    totalBytes,
    security: {
      secretPolicy,
    },
  };
}

function serializeBackupManifest(manifest, limits) {
  const manifestBuffer = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  if (manifestBuffer.length > limits.maxManifestBytes) {
    throw backupError('MANIFEST_LIMIT_EXCEEDED');
  }
  return manifestBuffer;
}

function buildBackupArchiveSources({
  manifestBuffer,
  snapshotPath,
  databaseStat,
  storage,
  storySources,
  now = Date.now(),
}) {
  return [
    { name: MANIFEST_ENTRY, buffer: manifestBuffer, mtimeMs: now },
    { name: DATABASE_ENTRY, filePath: snapshotPath, identity: fileIdentity(databaseStat), mtimeMs: databaseStat.mtimeMs },
    ...storage.files.map((file) => ({
      name: file.archiveName,
      filePath: file.absolute,
      identity: file.identity,
      sha256: file.sha256,
      mtimeMs: file.identity.mtimeMs,
    })),
    ...storySources.files.map((file) => ({
      name: file.archiveName,
      filePath: file.absolute,
      identity: file.identity,
      sha256: file.sha256,
      mtimeMs: file.identity.mtimeMs,
    })),
  ];
}

function digestBackupCollectionSha256(files) {
  const aggregate = crypto.createHash('sha256');
  for (const file of files) {
    aggregate.update(`${file.archiveName}\0${file.identity.size}\0${file.sha256}\n`, 'utf8');
  }
  return aggregate.digest('hex');
}

function assertManifestMatchesArchive(manifest, archive) {
  const databaseEntry = archive.entries.find((entry) => entry.name === DATABASE_ENTRY);
  const storageEntries = archive.entries.filter((entry) => entry.name.startsWith(STORAGE_PREFIX));
  const storySourceEntries = archive.entries.filter((entry) => entry.name.startsWith(STORY_SOURCES_PREFIX));
  const storageBytes = storageEntries.reduce((sum, entry) => sum + entry.uncompressedSize, 0);
  const storySourceBytes = storySourceEntries.reduce((sum, entry) => sum + entry.uncompressedSize, 0);
  if (
    databaseEntry.uncompressedSize !== manifest.database.bytes ||
    storageEntries.length !== manifest.storage.fileCount ||
    storageBytes !== manifest.storage.totalBytes ||
    storySourceEntries.length !== (manifest.storySources?.fileCount || 0) ||
    storySourceBytes !== (manifest.storySources?.totalBytes || 0) ||
    manifest.fileCount !== archive.entries.length - 1 ||
    manifest.totalBytes !== archive.payloadBytes
  ) {
    throw backupError('INVALID_MANIFEST');
  }
  return { databaseEntry, storageEntries, storySourceEntries };
}

function assertStagedStorageMatchesManifest(stagedStorage, manifest, storageEntries) {
  if (
    stagedStorage.files.length !== manifest.storage.fileCount ||
    stagedStorage.totalBytes !== manifest.storage.totalBytes
  ) {
    throw backupError('INVALID_ARCHIVE');
  }
  const expectedNames = storageEntries.map((entry) => entry.name).sort();
  const stagedNames = stagedStorage.files.map((entry) => entry.archiveName).sort();
  if (expectedNames.some((name, index) => name !== stagedNames[index])) {
    throw backupError('INVALID_ARCHIVE');
  }
  if (
    manifest.formatVersion >= FORMAT_VERSION &&
    stagedStorage.sha256 !== manifest.storage.sha256
  ) {
    throw backupError('STORAGE_HASH_MISMATCH');
  }
}

function assertStagedStorySourcesMatchManifest(stagedStorySources, manifest, storySourceEntries) {
  const expectedSourceNames = storySourceEntries.map((entry) => entry.name).sort();
  const stagedSourceNames = stagedStorySources.files.map((entry) => entry.archiveName).sort();
  if (
    stagedStorySources.files.length !== manifest.storySources.fileCount ||
    stagedStorySources.totalBytes !== manifest.storySources.totalBytes ||
    stagedStorySources.sha256 !== manifest.storySources.sha256 ||
    expectedSourceNames.some((name, index) => name !== stagedSourceNames[index])
  ) {
    throw backupError('SOURCE_TEXT_HASH_MISMATCH');
  }
}

function assertStorySourceReferenceCount(referenceCount, manifest) {
  if (referenceCount !== manifest.storySources.referenceCount) {
    throw backupError('INVALID_MANIFEST');
  }
}

function assertInstalledStorageMatchesManifest(storage, manifest) {
  if (
    storage.files.length !== manifest.storage.fileCount ||
    storage.totalBytes !== manifest.storage.totalBytes ||
    (manifest.formatVersion >= FORMAT_VERSION && storage.sha256 !== manifest.storage.sha256)
  ) {
    throw backupError('RESTORE_VERIFY_FAILED');
  }
}

function assertInstalledStorySourcesMatchManifest(storySources, referenceCount, manifest) {
  if (
    storySources.files.length !== manifest.storySources.fileCount ||
    storySources.totalBytes !== manifest.storySources.totalBytes ||
    storySources.sha256 !== manifest.storySources.sha256 ||
    referenceCount !== manifest.storySources.referenceCount
  ) {
    throw backupError('RESTORE_VERIFY_FAILED');
  }
}

module.exports = {
  assembleBackupManifest,
  assertBackupPayloadLimits,
  assertInstalledStorageMatchesManifest,
  assertInstalledStorySourcesMatchManifest,
  assertManifestMatchesArchive,
  assertStagedStorageMatchesManifest,
  assertStagedStorySourcesMatchManifest,
  assertStorySourceReferenceCount,
  buildBackupArchiveSources,
  digestBackupCollectionSha256,
  serializeBackupManifest,
};
