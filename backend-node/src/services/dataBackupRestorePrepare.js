'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const {
  DataBackupError,
  backupError,
} = require('./dataBackupErrors');
const {
  MANIFEST_ENTRY,
  STORAGE_PREFIX,
  STORY_SOURCES_PREFIX,
  fileIdentity,
  isPathInside,
  sameFileIdentity,
  validateManifest,
} = require('./dataBackupValidation');
const {
  assertManifestMatchesArchive,
  assertStagedStorageMatchesManifest,
  assertStagedStorySourcesMatchManifest,
  assertStorySourceReferenceCount,
} = require('./dataBackupManifest');
const {
  existingAncestor,
  lstatIfExists,
  makeSiblingPath,
} = require('./dataBackupPaths');
const {
  collectStorageFiles,
  collectStorySourceFiles,
  hashStorageFiles,
  hashStorySourceFiles,
} = require('./dataBackupCollection');
const {
  consumeArchiveEntry,
  readArchiveDirectory,
} = require('./dataBackupZip');
const {
  SQLITE_SIDECAR_SUFFIXES,
} = require('./dataBackupMaintenance');
const {
  sqliteIntegrityCheck,
  validateStorySourceReferences,
} = require('./dataBackupSnapshot');

async function assertDiskAllocations(allocations, reserveBytes) {
  if (typeof fsp.statfs !== 'function') return;
  const groups = new Map();
  for (const allocation of allocations) {
    const bytes = Math.max(0, Number(allocation.bytes) || 0);
    const existing = await existingAncestor(allocation.targetPath);
    const stat = await fsp.stat(existing);
    const key = `${stat.dev}`;
    const group = groups.get(key) || { existing, bytes: 0 };
    group.bytes += bytes;
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const statfs = await fsp.statfs(group.existing);
    const available = Number(statfs.bavail ?? statfs.bfree) * Number(statfs.bsize);
    if (Number.isFinite(available) && available - group.bytes < reserveBytes) {
      throw backupError('INSUFFICIENT_STORAGE');
    }
  }
}

async function removeSqliteSidecars(databasePath, strict = false) {
  for (const suffix of SQLITE_SIDECAR_SUFFIXES) {
    try {
      await fsp.rm(`${databasePath}${suffix}`, { force: true });
    } catch (error) {
      if (strict) {
        throw backupError('TEMP_CLEANUP_FAILED', error);
      }
    }
  }
}

async function readAndValidateManifest(archive, limits) {
  const manifestEntry = archive.entries.find((entry) => entry.name === MANIFEST_ENTRY);
  if (!manifestEntry || manifestEntry.uncompressedSize > limits.maxManifestBytes) {
    throw backupError('INVALID_MANIFEST');
  }
  const result = await consumeArchiveEntry(archive, manifestEntry, { collect: true });
  let manifest;
  try {
    manifest = JSON.parse(result.buffer.toString('utf8'));
  } catch (error) {
    throw backupError('INVALID_MANIFEST', error);
  }
  validateManifest(manifest);
  const matched = assertManifestMatchesArchive(manifest, archive);
  return { manifest, ...matched };
}

async function prepareRestoreStages(
  archivePath,
  databasePath,
  storagePath,
  storySourcesPath,
  limits,
  archiveHandle = null
) {
  const databaseStage = makeSiblingPath(databasePath, 'restore-incoming');
  const storageStage = makeSiblingPath(storagePath, 'restore-incoming');
  let storySourcesStage = null;
  let archive;
  try {
    await fsp.mkdir(path.dirname(databasePath), { recursive: true });
    await fsp.mkdir(path.dirname(storagePath), { recursive: true });
    await fsp.mkdir(path.dirname(storySourcesPath), { recursive: true });
    archive = await readArchiveDirectory(archivePath, limits, archiveHandle);
    const validated = await readAndValidateManifest(archive, limits);
    const replaceStorySources = Boolean(validated.manifest.storySources);
    if (replaceStorySources) storySourcesStage = makeSiblingPath(storySourcesPath, 'restore-incoming');
    const existingDatabase = await lstatIfExists(databasePath);
    const allocations = [
      {
        targetPath: path.dirname(databasePath),
        bytes: validated.databaseEntry.uncompressedSize + (existingDatabase?.isFile() ? existingDatabase.size : 0),
      },
      { targetPath: path.dirname(storagePath), bytes: validated.manifest.storage.totalBytes },
    ];
    if (replaceStorySources) {
      allocations.push({
        targetPath: path.dirname(storySourcesPath),
        bytes: validated.manifest.storySources.totalBytes,
      });
    }
    await assertDiskAllocations(allocations, limits.diskReserveBytes);
    await fsp.mkdir(storageStage, { mode: 0o700 });
    if (storySourcesStage) await fsp.mkdir(storySourcesStage, { mode: 0o700 });

    const databaseResult = await consumeArchiveEntry(archive, validated.databaseEntry, {
      destination: databaseStage,
      sha256: true,
    });
    if (databaseResult.sha256 !== validated.manifest.database.sha256) {
      throw backupError('DATABASE_HASH_MISMATCH');
    }
    sqliteIntegrityCheck(databaseStage);
    await removeSqliteSidecars(databaseStage, true);

    for (const entry of validated.storageEntries) {
      const relative = entry.name.slice(STORAGE_PREFIX.length);
      const destination = path.resolve(storageStage, ...relative.split('/'));
      if (!isPathInside(storageStage, destination)) {
        throw backupError('UNSAFE_ARCHIVE_PATH');
      }
      await consumeArchiveEntry(archive, entry, { destination });
    }

    const stagedStorage = await hashStorageFiles(await collectStorageFiles(storageStage, limits));
    assertStagedStorageMatchesManifest(stagedStorage, validated.manifest, validated.storageEntries);

    if (replaceStorySources) {
      for (const entry of validated.storySourceEntries) {
        const relative = entry.name.slice(STORY_SOURCES_PREFIX.length);
        const destination = path.resolve(storySourcesStage, ...relative.split('/'));
        if (!isPathInside(storySourcesStage, destination)) {
          throw backupError('UNSAFE_ARCHIVE_PATH');
        }
        await consumeArchiveEntry(archive, entry, { destination });
      }
      const stagedStorySources = await hashStorySourceFiles(
        await collectStorySourceFiles(storySourcesStage, limits)
      );
      assertStagedStorySourcesMatchManifest(stagedStorySources, validated.manifest, validated.storySourceEntries);
      const referenceCount = validateStorySourceReferences(
        databaseStage,
        storySourcesPath,
        stagedStorySources,
        limits
      );
      assertStorySourceReferenceCount(referenceCount, validated.manifest);
    } else {
      const currentStorySources = await collectStorySourceFiles(storySourcesPath, limits);
      validateStorySourceReferences(databaseStage, storySourcesPath, currentStorySources, limits);
    }
    const finalArchiveStat = await archive.handle.stat();
    if (!sameFileIdentity(finalArchiveStat, fileIdentity(archive.archiveStat))) {
      throw backupError('ARCHIVE_CHANGED');
    }

    return {
      databaseStage,
      storageStage,
      storySourcesStage,
      replaceStorySources,
      manifest: validated.manifest,
    };
  } catch (error) {
    await fsp.rm(databaseStage, { force: true }).catch(() => {});
    await removeSqliteSidecars(databaseStage);
    await fsp.rm(storageStage, { recursive: true, force: true }).catch(() => {});
    if (storySourcesStage) {
      await fsp.rm(storySourcesStage, { recursive: true, force: true }).catch(() => {});
    }
    if (error instanceof DataBackupError) throw error;
    throw backupError('ARCHIVE_VALIDATION_FAILED', error);
  } finally {
    if (archive?.ownsHandle && archive.handle) await archive.handle.close().catch(() => {});
  }
}

module.exports = {
  assertDiskAllocations,
  removeSqliteSidecars,
  readAndValidateManifest,
  prepareRestoreStages,
};
