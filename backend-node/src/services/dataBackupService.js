const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {
  FORMAT_VERSION,
} = require('./dataBackupFormatContract');
const {
  DataBackupError,
  attachCleanupErrors,
  assertOperationNotAborted,
  backupError,
  isPermissionDeniedError,
  permissionDeniedError,
  wrapUnknownBackupError,
} = require('./dataBackupErrors');
const {
  DEFAULT_LIMITS,
  MAINTENANCE_JOURNAL_VERSION,
  STORAGE_PREFIX,
  STORY_SOURCES_PREFIX,
  archiveNameForDirectory,
  assertPortableSegment,
  assertSafeTargetPaths,
  canonicalPhysicalIdentity,
  fileIdentity,
  isPathInside,
  normalizeDescriptorPublication,
  normalizeLimits,
  sameFileIdentity,
  validateManifest,
} = require('./dataBackupValidation');
const {
  assembleBackupManifest,
  assertBackupPayloadLimits,
  assertInstalledStorageMatchesManifest,
  assertInstalledStorySourcesMatchManifest,
  assertManifestMatchesArchive,
  assertStagedStorageMatchesManifest,
  assertStagedStorySourcesMatchManifest,
  assertStorySourceReferenceCount,
  buildBackupArchiveSources,
  serializeBackupManifest,
} = require('./dataBackupManifest');
const {
  existingAncestor,
  lstatIfExists,
  makeSiblingPath,
  randomSuffix,
  resolveDataRoot,
  resolveStorySourcesPath,
} = require('./dataBackupPaths');
const {
  collectStorageFiles,
  collectStorySourceFiles,
  hashStorageFiles,
  hashStorySourceFiles,
  sha256File,
} = require('./dataBackupCollection');
const {
  backupColumnRedactionPolicy,
  isSensitiveBackupKey,
  redactLooseBackupText,
  redactSettingsText,
  redactStructuredBackupText,
  sanitizeBackupLocation,
  sanitizeBackupUrlColumn,
} = require('./dataBackupRedaction');
const {
  consumeArchiveEntry,
  createDescriptorArchive,
  readArchiveDirectory,
  writeZip64Archive,
  writeZip64ArchiveToHandle,
} = require('./dataBackupZip');
const {
  SQLITE_SIDECAR_SUFFIXES,
  acquireMaintenanceLock,
  acquireMaintenanceRecoveryClaimSync,
  acquireServiceMaintenanceLockSync,
  assertExternalMaintenanceLease,
  assertServiceMaintenanceLockActiveSync,
  claimOwnedRegularPathSync,
  createExternalMaintenanceLease,
  getRuntimeServiceMaintenanceLock,
  maintenanceLeaseFileIdentity,
  maintenancePaths,
  nativeMaintenanceOwnerScope,
  recoverInterruptedMaintenanceSync,
  releaseMaintenanceLock,
  releaseMaintenanceRecoveryClaimSync,
  removeOwnedClaimSync,
  removeSqliteSidecarsSync,
  renameDurably,
  renameDurablySync,
  syncParentDirectories,
} = require('./dataBackupMaintenance');

const {
  chmodPrivate,
  assertServiceStopped,
  assertTargetDirectorySafe,
  assertDatabaseAvailable,
  isSqliteBusy,
  writeRestoreJournal,
  removeRestoreJournal,
} = require('./dataBackupRestorePrep');

const {
  sqliteIntegrityCheck,
  createOnlineDatabaseSnapshot,
  createLockedDatabaseSnapshot,
  excludeSecretsFromSnapshot,
  isReadonlySqliteError,
  openExclusiveBackupFreeze,
  snapshotReadonlyDatabase,
  validateStorySourceReferences,
} = require('./dataBackupSnapshot');

const {
  runFaultInjector,
  commitRestore,
} = require('./dataBackupRestoreCommit');

const {
  assertDiskAllocations,
  removeSqliteSidecars,
  prepareRestoreStages,
} = require('./dataBackupRestorePrepare');

async function captureBackupView(databasePath, storagePath, storySourcesPath, snapshotPath, limits, options) {
  let freeze;
  let transactionStarted = false;
  try {
    assertOperationNotAborted(options?.signal);
    try {
      freeze = openExclusiveBackupFreeze(databasePath);
      transactionStarted = true;
      const journalMode = String(freeze.pragma('journal_mode', { simple: true }) || '').toLowerCase();
      await runFaultInjector(options, 'after-backup-freeze-acquired');
      assertOperationNotAborted(options?.signal);
      if (journalMode === 'wal') {
        await createOnlineDatabaseSnapshot(databasePath, snapshotPath);
      } else {
        await createLockedDatabaseSnapshot(databasePath, snapshotPath);
      }
    } catch (error) {
      if (freeze) {
        if (transactionStarted) {
          try { freeze.exec('ROLLBACK'); } catch (_) {}
        }
        try { freeze.close(); } catch (_) {}
        freeze = null;
        transactionStarted = false;
      }
      const canFallbackToOnlineSnapshot = isReadonlySqliteError(error)
        || ['EACCES', 'EPERM', 'SQLITE_READONLY', 'SQLITE_CANTOPEN'].includes(String(error?.code || ''))
        || (options?.externalMaintenanceLease && isSqliteBusy(error));
      if (!canFallbackToOnlineSnapshot) {
        throw error;
      }
      await snapshotReadonlyDatabase(databasePath, snapshotPath);
      await runFaultInjector(options, 'after-backup-freeze-acquired');
      assertOperationNotAborted(options?.signal);
    }
    await runFaultInjector(options, 'after-backup-database-snapshot');
    assertOperationNotAborted(options?.signal);
    const storage = await hashStorageFiles(await collectStorageFiles(storagePath, limits));
    assertOperationNotAborted(options?.signal);
    const storySources = await hashStorySourceFiles(await collectStorySourceFiles(storySourcesPath, limits));
    assertOperationNotAborted(options?.signal);
    storySources.referenceCount = validateStorySourceReferences(
      snapshotPath,
      storySourcesPath,
      storySources,
      limits
    );
    await runFaultInjector(options, 'after-backup-storage-captured');
    assertOperationNotAborted(options?.signal);
    return { storage, storySources };
  } catch (error) {
    if (isSqliteBusy(error)) {
      throw backupError('DATABASE_BUSY');
    }
    throw error;
  } finally {
    if (freeze) {
      if (transactionStarted) {
        try { freeze.exec('ROLLBACK'); } catch (_) {}
      }
      freeze.close();
    }
  }
}

async function createDataBackup(options) {
  assertOperationNotAborted(options?.signal);
  const databasePath = path.resolve(options?.databasePath || '');
  const storagePath = path.resolve(options?.storagePath || '');
  const storySourcesPath = resolveStorySourcesPath(options);
  const descriptorPublication = options?.descriptorPublication == null
    ? null
    : normalizeDescriptorPublication(options.descriptorPublication);
  if (descriptorPublication && options?.outputPath != null) {
    throw backupError('INVALID_ARGUMENT');
  }
  const outputPath = descriptorPublication
    ? descriptorPublication.publicationPath
    : path.resolve(options?.outputPath || '');
  const limits = normalizeLimits(options?.limits);
  if (!options?.databasePath || !options?.storagePath || (!descriptorPublication && !options?.outputPath)) {
    throw backupError('INVALID_ARGUMENT');
  }
  assertSafeTargetPaths(databasePath, storagePath, storySourcesPath);
  if (
    outputPath === databasePath || isPathInside(storagePath, outputPath) ||
    isPathInside(storySourcesPath, outputPath)
  ) {
    throw backupError('UNSAFE_OUTPUT');
  }
  if (await lstatIfExists(outputPath)) {
    throw backupError('OUTPUT_EXISTS');
  }

  if (descriptorPublication) {
    const parentStat = await fsp.lstat(path.dirname(outputPath)).catch((error) => {
      throw backupError('INVALID_DESCRIPTOR_PUBLICATION', error);
    });
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
      throw backupError('INVALID_DESCRIPTOR_PUBLICATION');
    }
  } else {
    await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  }
  const externalMaintenanceLease = options?.externalMaintenanceLease == null
    ? null
    : assertExternalMaintenanceLease(databasePath, options.externalMaintenanceLease);
  let maintenanceLock;
  if (!externalMaintenanceLease) {
    await assertServiceStopped(options);
    recoverInterruptedMaintenanceSync({
      databasePath,
      storagePath,
      storySourcesPath,
      log: options?.log,
      ownerScope: options?.ownerScope,
    });
    try {
      maintenanceLock = await acquireMaintenanceLock(databasePath, 'backup', {
        heartbeatIntervalMs: options?.heartbeatIntervalMs,
        log: options?.log,
        ownerScope: options?.ownerScope,
      });
    } catch (error) {
      if (error instanceof DataBackupError) throw error;
      throw backupError('MAINTENANCE_LOCK_FAILED', error);
    }
  }
  let workDir = null;
  let snapshotPath = null;
  let outputLinked = false;
  let outputIdentity = null;
  const tempArchivePath = descriptorPublication
    ? null
    : path.join(path.dirname(outputPath), `.${path.basename(outputPath)}.${randomSuffix()}.tmp`);

  try {
    workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'localminidrama-backup-'));
    assertOperationNotAborted(options?.signal);
    snapshotPath = path.join(workDir, 'database.sqlite');
    if (externalMaintenanceLease) assertExternalMaintenanceLease(databasePath, externalMaintenanceLease);
    else await assertServiceStopped(options);
    const sourceDatabaseStat = await fsp.stat(databasePath);
    const snapshotWorkingBytes = sourceDatabaseStat.size * (options?.includeSecrets === true ? 1 : 2);
    if (!Number.isSafeInteger(snapshotWorkingBytes)) {
      throw backupError('SIZE_LIMIT_EXCEEDED');
    }
    await assertDiskAllocations(
      [{ targetPath: workDir, bytes: snapshotWorkingBytes }],
      limits.diskReserveBytes
    );
    const captured = await captureBackupView(
      databasePath,
      storagePath,
      storySourcesPath,
      snapshotPath,
      limits,
      options
    );
    assertOperationNotAborted(options?.signal);
    const { storage, storySources } = captured;
    const security = options?.includeSecrets === true
      ? { policy: 'included-by-explicit-request', excludedValues: 0 }
      : excludeSecretsFromSnapshot(snapshotPath);
    assertOperationNotAborted(options?.signal);
    const databaseStat = await fsp.stat(snapshotPath);
    const { directoryFileCount, totalBytes } = assertBackupPayloadLimits({
      databaseBytes: databaseStat.size,
      storage,
      storySources,
      limits,
    });
    await assertDiskAllocations(
      [{ targetPath: path.dirname(outputPath), bytes: totalBytes + limits.maxManifestBytes + (directoryFileCount * 256) }],
      limits.diskReserveBytes
    );
    const databaseSha256 = await sha256File(snapshotPath);
    assertOperationNotAborted(options?.signal);
    const createdAt = new Date().toISOString();
    const manifest = assembleBackupManifest({
      createdAt,
      databaseSha256,
      databaseBytes: databaseStat.size,
      storage,
      storySources,
      secretPolicy: security.policy,
    });
    const manifestBuffer = serializeBackupManifest(manifest, limits);

    const sources = buildBackupArchiveSources({
      manifestBuffer,
      snapshotPath,
      databaseStat,
      storage,
      storySources,
    });
    if (descriptorPublication) {
      const publication = await createDescriptorArchive(
        descriptorPublication,
        sources,
        limits,
        options?.signal
      );
      if (externalMaintenanceLease) assertExternalMaintenanceLease(databasePath, externalMaintenanceLease);
      await runFaultInjector(options, 'after-backup-output-linked');
      if (externalMaintenanceLease) assertExternalMaintenanceLease(databasePath, externalMaintenanceLease);
      return {
        outputPath,
        manifest,
        archiveBytes: publication.archiveBytes,
        security,
        publication: {
          ready: publication.ready,
          committed: publication.committed,
        },
      };
    }

    await writeZip64Archive(tempArchivePath, sources, options?.signal);
    assertOperationNotAborted(options?.signal);
    const archiveStat = await fsp.stat(tempArchivePath);
    if (archiveStat.size > limits.maxArchiveBytes) {
      throw backupError('ARCHIVE_LIMIT_EXCEEDED');
    }
    await chmodPrivate(tempArchivePath);
    assertOperationNotAborted(options?.signal);
    if (externalMaintenanceLease) assertExternalMaintenanceLease(databasePath, externalMaintenanceLease);
    try {
      await fsp.link(tempArchivePath, outputPath);
      outputLinked = true;
      const outputStat = await fsp.lstat(outputPath, { bigint: true });
      if (!outputStat.isFile() || outputStat.isSymbolicLink()) {
        throw backupError('OUTPUT_COMMIT_FAILED');
      }
      outputIdentity = maintenanceLeaseFileIdentity(outputStat);
      await syncParentDirectories(outputPath);
    } catch (error) {
      if (error.code === 'EEXIST') throw backupError('OUTPUT_EXISTS');
      if (isPermissionDeniedError(error)) throw permissionDeniedError(error);
      throw backupError('OUTPUT_COMMIT_FAILED', error);
    }
    await runFaultInjector(options, 'after-backup-output-linked');
    if (externalMaintenanceLease) assertExternalMaintenanceLease(databasePath, externalMaintenanceLease);
    await fsp.rm(tempArchivePath, { force: true });
    await chmodPrivate(outputPath);
    if (externalMaintenanceLease) assertExternalMaintenanceLease(databasePath, externalMaintenanceLease);
    return { outputPath, manifest, archiveBytes: archiveStat.size, security };
  } catch (error) {
    const primaryError = wrapUnknownBackupError(
      error,
      'BACKUP_FAILED',
    );
    if (outputLinked) {
      try {
        const claim = claimOwnedRegularPathSync(outputPath, outputIdentity, 'OUTPUT_CLEANUP_FAILED');
        removeOwnedClaimSync(claim, outputIdentity, 'OUTPUT_CLEANUP_FAILED');
        outputLinked = false;
      } catch (cleanupError) {
        try {
          attachCleanupErrors(primaryError, [cleanupError]);
        } catch (_) {}
      }
    }
    throw primaryError;
  } finally {
    if (tempArchivePath) await fsp.rm(tempArchivePath, { force: true }).catch(() => {});
    if (workDir) await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
    await releaseMaintenanceLock(maintenanceLock);
  }
}

async function restoreDataBackup(options) {
  if (options?.confirmed !== true) {
    throw backupError('CONFIRMATION_REQUIRED');
  }
  if (!options?.archivePath || !options?.databasePath || !options?.storagePath) {
    throw backupError('INVALID_ARGUMENT');
  }
  const archivePath = path.resolve(options.archivePath);
  const databasePath = path.resolve(options.databasePath);
  const storagePath = path.resolve(options.storagePath);
  const storySourcesPath = resolveStorySourcesPath(options);
  const limits = normalizeLimits(options.limits);
  assertSafeTargetPaths(databasePath, storagePath, storySourcesPath);
  await assertTargetDirectorySafe(storagePath);
  await assertTargetDirectorySafe(storySourcesPath);
  await fsp.mkdir(path.dirname(databasePath), { recursive: true });
  await fsp.mkdir(path.dirname(storagePath), { recursive: true });
  await fsp.mkdir(path.dirname(storySourcesPath), { recursive: true });

  let lock;
  let prepared;
  try {
    await assertServiceStopped(options);
    recoverInterruptedMaintenanceSync({
      databasePath,
      storagePath,
      storySourcesPath,
      log: options?.log,
      ownerScope: options?.ownerScope,
    });
    lock = await acquireMaintenanceLock(databasePath, 'restore', {
      heartbeatIntervalMs: options?.heartbeatIntervalMs,
      log: options?.log,
      ownerScope: options?.ownerScope,
    });
    await assertServiceStopped(options);
    await assertDatabaseAvailable(databasePath);
    prepared = await prepareRestoreStages(
      archivePath,
      databasePath,
      storagePath,
      storySourcesPath,
      limits,
      options.archiveHandle || null
    );
    await assertServiceStopped(options);
    await assertDatabaseAvailable(databasePath);
    return await commitRestore(prepared, databasePath, storagePath, storySourcesPath, limits, options);
  } catch (error) {
    if (error instanceof DataBackupError) throw error;
    throw wrapUnknownBackupError(
      error,
      'RESTORE_FAILED',
    );
  } finally {
    const recoveryPending = Boolean(await lstatIfExists(maintenancePaths(databasePath).journalPath).catch(() => null));
    if (!recoveryPending) {
      if (prepared?.databaseStage) await fsp.rm(prepared.databaseStage, { force: true }).catch(() => {});
      if (prepared?.databaseStage) await removeSqliteSidecars(prepared.databaseStage);
      if (prepared?.storageStage) await fsp.rm(prepared.storageStage, { recursive: true, force: true }).catch(() => {});
      if (prepared?.storySourcesStage) {
        await fsp.rm(prepared.storySourcesStage, { recursive: true, force: true }).catch(() => {});
      }
    }
    await releaseMaintenanceLock(lock);
  }
}

module.exports = {
  FORMAT_VERSION,
  DEFAULT_LIMITS,
  DataBackupError,
  acquireServiceMaintenanceLockSync,
  assertServiceMaintenanceLockActiveSync,
  assertServiceStopped,
  createExternalMaintenanceLease,
  getRuntimeServiceMaintenanceLock,
  createDataBackup,
  writeZip64ArchiveToHandle,
  maintenancePaths,
  nativeMaintenanceOwnerScope,
  recoverInterruptedMaintenanceSync,
  restoreDataBackup,
  resolveDataRoot,
  __testing: Object.freeze({
    acquireMaintenanceRecoveryClaimSync,
    backupError,
    canonicalPhysicalIdentity,
    releaseMaintenanceRecoveryClaimSync,
  }),
};
