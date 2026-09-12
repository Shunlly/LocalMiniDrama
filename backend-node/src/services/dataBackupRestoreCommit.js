'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const Database = require('better-sqlite3');
const {
  DataBackupError,
  backupError,
} = require('./dataBackupErrors');
const {
  MAINTENANCE_JOURNAL_VERSION,
  fileIdentity,
  sameFileIdentity,
} = require('./dataBackupValidation');
const {
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
  assertInstalledStorageMatchesManifest,
  assertInstalledStorySourcesMatchManifest,
} = require('./dataBackupManifest');
const {
  SQLITE_SIDECAR_SUFFIXES,
  renameDurably,
} = require('./dataBackupMaintenance');
const {
  chmodPrivate,
  assertServiceStopped,
  assertDatabaseAvailable,
  assertTargetDirectorySafe,
  isSqliteBusy,
  writeRestoreJournal,
  removeRestoreJournal,
} = require('./dataBackupRestorePrep');
const {
  sqliteIntegrityCheck,
  validateStorySourceReferences,
} = require('./dataBackupSnapshot');
const {
  removeSqliteSidecars,
} = require('./dataBackupRestorePrepare');

async function prepareDatabaseRollback(databasePath) {
  const sourceStat = await lstatIfExists(databasePath);
  if (!sourceStat) return null;
  const rollbackPath = makeSiblingPath(databasePath, 'restore-rollback');
  let db;
  let transactionStarted = false;
  try {
    db = new Database(databasePath, { fileMustExist: true });
    db.pragma('busy_timeout = 0');
    const checkpoint = db.pragma('wal_checkpoint(TRUNCATE)')[0] || {};
    if (Number(checkpoint.busy || 0) !== 0) {
      throw backupError('DATABASE_BUSY');
    }
    db.exec('BEGIN EXCLUSIVE');
    transactionStarted = true;
    await fsp.copyFile(databasePath, rollbackPath, fs.constants.COPYFILE_EXCL);
    await chmodPrivate(rollbackPath);
    sqliteIntegrityCheck(rollbackPath);
    await removeSqliteSidecars(rollbackPath);
    const stableStat = await fsp.stat(databasePath);
    return { rollbackPath, identity: fileIdentity(stableStat) };
  } catch (error) {
    await fsp.rm(rollbackPath, { force: true }).catch(() => {});
    await removeSqliteSidecars(rollbackPath);
    if (isSqliteBusy(error)) {
      throw backupError('DATABASE_BUSY');
    }
    if (error instanceof DataBackupError) throw error;
    throw backupError('ROLLBACK_PREPARE_FAILED', error);
  } finally {
    if (db) {
      if (transactionStarted) {
        try { db.exec('ROLLBACK'); } catch (_) {}
      }
      db.close();
    }
  }
}

async function assertDatabaseUnchanged(databasePath, expectedIdentity) {
  const stat = await lstatIfExists(databasePath);
  if (!expectedIdentity) {
    if (stat) {
      throw backupError('TARGET_CHANGED');
    }
    return;
  }
  if (!stat || !sameFileIdentity(stat, expectedIdentity)) {
    throw backupError('TARGET_CHANGED');
  }
}

async function moveDatabaseSidecars(databasePath, oldDatabasePath, moved) {
  for (const suffix of SQLITE_SIDECAR_SUFFIXES) {
    const source = `${databasePath}${suffix}`;
    const stat = await lstatIfExists(source);
    if (!stat) continue;
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw backupError('UNSAFE_TARGET');
    }
    const destination = `${oldDatabasePath}${suffix}`;
    await renameDurably(source, destination, () => {
      moved.push({ source, destination });
    });
  }
}

async function runFaultInjector(options, step) {
  if (typeof options?.faultInjector === 'function') {
    await options.faultInjector(step);
  }
}

async function verifyInstalledStorage(storagePath, manifest, limits) {
  const storage = await hashStorageFiles(await collectStorageFiles(storagePath, limits));
  assertInstalledStorageMatchesManifest(storage, manifest);
}

async function verifyInstalledStorySources(databasePath, storySourcesPath, manifest, limits) {
  if (!manifest.storySources) return;
  const storySources = await hashStorySourceFiles(await collectStorySourceFiles(storySourcesPath, limits));
  const referenceCount = validateStorySourceReferences(
    databasePath,
    storySourcesPath,
    storySources,
    limits
  );
  assertInstalledStorySourcesMatchManifest(storySources, referenceCount, manifest);
}

async function rollbackRestoreState(state, databasePath, storagePath, storySourcesPath) {
  const failures = [];
  if (state.installedStorySources) {
    try {
      await fsp.rm(storySourcesPath, { recursive: true, force: true });
      state.installedStorySources = false;
    } catch (error) {
      failures.push(error);
    }
  }
  if (state.movedStorySources) {
    try {
      await renameDurably(state.storySourcesRollbackPath, storySourcesPath, () => {
        state.movedStorySources = false;
      });
    } catch (error) {
      failures.push(error);
    }
  }
  if (state.installedStorage) {
    try {
      await fsp.rm(storagePath, { recursive: true, force: true });
      state.installedStorage = false;
    } catch (error) {
      failures.push(error);
    }
  }
  if (state.movedStorage) {
    try {
      await renameDurably(state.storageRollbackPath, storagePath, () => {
        state.movedStorage = false;
      });
    } catch (error) {
      failures.push(error);
    }
  }
  if (state.installedDatabase) {
    try {
      await fsp.rm(databasePath, { force: true });
      await fsp.rm(`${databasePath}-wal`, { force: true });
      await fsp.rm(`${databasePath}-shm`, { force: true });
      state.installedDatabase = false;
    } catch (error) {
      failures.push(error);
    }
  }
  if (state.movedDatabase) {
    try {
      await renameDurably(state.oldDatabasePath, databasePath, () => {
        state.movedDatabase = false;
      });
    } catch (error) {
      failures.push(error);
    }
  }
  for (const sidecar of [...state.movedSidecars].reverse()) {
    try {
      await renameDurably(sidecar.destination, sidecar.source);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw backupError('ROLLBACK_FAILED', failures[0]);
  }
}

async function commitRestore(prepared, databasePath, storagePath, storySourcesPath, limits, options) {
  const state = {
    installedDatabase: false,
    installedStorage: false,
    installedStorySources: false,
    movedDatabase: false,
    movedStorage: false,
    movedStorySources: false,
    movedSidecars: [],
    oldDatabasePath: makeSiblingPath(databasePath, 'restore-original'),
    storageRollbackPath: makeSiblingPath(storagePath, 'restore-rollback'),
    storySourcesRollbackPath: makeSiblingPath(storySourcesPath, 'restore-rollback'),
  };
  let databaseRollback = null;
  let mutated = false;
  let journal = null;
  const setJournalPhase = async (phase) => {
    journal.phase = phase;
    await writeRestoreJournal(journal);
  };
  try {
    databaseRollback = await prepareDatabaseRollback(databasePath);
    await runFaultInjector(options, 'after-rollback-prepared');
    await assertServiceStopped(options);
    await assertDatabaseAvailable(databasePath);
    await assertDatabaseUnchanged(databasePath, databaseRollback?.identity);
    await assertTargetDirectorySafe(storagePath);
    if (prepared.replaceStorySources) await assertTargetDirectorySafe(storySourcesPath);

    const storageStat = await lstatIfExists(storagePath);
    const storySourcesStat = prepared.replaceStorySources ? await lstatIfExists(storySourcesPath) : null;
    journal = {
      version: MAINTENANCE_JOURNAL_VERSION,
      operation: 'restore',
      phase: 'prepared',
      databasePath,
      storagePath,
      storySourcesPath,
      databaseStage: prepared.databaseStage,
      storageStage: prepared.storageStage,
      storySourcesStage: prepared.replaceStorySources ? prepared.storySourcesStage : null,
      oldDatabasePath: state.oldDatabasePath,
      storageRollbackPath: state.storageRollbackPath,
      storySourcesRollbackPath: prepared.replaceStorySources ? state.storySourcesRollbackPath : null,
      databaseRollbackPath: databaseRollback?.rollbackPath || null,
      originalDatabaseExisted: Boolean(databaseRollback),
      originalStorageExisted: Boolean(storageStat),
      originalStorySourcesExisted: Boolean(storySourcesStat),
      replaceStorySources: prepared.replaceStorySources,
      createdAt: new Date().toISOString(),
    };
    await writeRestoreJournal(journal);
    if (storageStat) {
      await renameDurably(storagePath, state.storageRollbackPath, () => {
        state.movedStorage = true;
        mutated = true;
      });
    }
    await setJournalPhase('storage_moved');
    await runFaultInjector(options, 'after-storage-moved');
    if (prepared.replaceStorySources && storySourcesStat) {
      await renameDurably(storySourcesPath, state.storySourcesRollbackPath, () => {
        state.movedStorySources = true;
        mutated = true;
      });
    }
    if (prepared.replaceStorySources) await setJournalPhase('story_sources_moved');
    await runFaultInjector(options, 'after-story-sources-moved');
    await assertServiceStopped(options);
    await assertDatabaseAvailable(databasePath);
    await assertDatabaseUnchanged(databasePath, databaseRollback?.identity);

    if (await lstatIfExists(databasePath)) {
      await renameDurably(databasePath, state.oldDatabasePath, () => {
        state.movedDatabase = true;
        mutated = true;
      });
      await moveDatabaseSidecars(databasePath, state.oldDatabasePath, state.movedSidecars);
    }
    await setJournalPhase('database_moved');
    await renameDurably(prepared.databaseStage, databasePath, () => {
      state.installedDatabase = true;
      mutated = true;
    });
    await chmodPrivate(databasePath);
    await setJournalPhase('database_installed');
    await renameDurably(prepared.storageStage, storagePath, () => {
      state.installedStorage = true;
    });
    if (prepared.replaceStorySources) {
      await renameDurably(prepared.storySourcesStage, storySourcesPath, () => {
        state.installedStorySources = true;
      });
    }
    await setJournalPhase('targets_replaced');
    await runFaultInjector(options, 'after-targets-replaced');

    sqliteIntegrityCheck(databasePath);
    await verifyInstalledStorage(storagePath, prepared.manifest, limits);
    await verifyInstalledStorySources(databasePath, storySourcesPath, prepared.manifest, limits);
    await setJournalPhase('verified');
    await runFaultInjector(options, 'after-final-verification');

    await setJournalPhase('committed');
    if (state.movedDatabase) await fsp.rm(state.oldDatabasePath, { force: true }).catch(() => {});
    for (const sidecar of state.movedSidecars) {
      await fsp.rm(sidecar.destination, { force: true }).catch(() => {});
    }
    await removeRestoreJournal(databasePath);
    return {
      manifest: prepared.manifest,
      rollback: {
        databasePath: databaseRollback?.rollbackPath || null,
        storagePath: state.movedStorage ? state.storageRollbackPath : null,
        storySourcesPath: state.movedStorySources ? state.storySourcesRollbackPath : null,
      },
    };
  } catch (error) {
    if (journal?.phase === 'committed') {
      throw backupError('RESTORE_FINALIZE_FAILED', error);
    }
    if (mutated) {
      if (journal) await setJournalPhase('rolling_back').catch(() => {});
      await rollbackRestoreState(state, databasePath, storagePath, storySourcesPath);
      await removeRestoreJournal(databasePath);
    } else if (journal) {
      await removeRestoreJournal(databasePath);
    }
    if (error instanceof DataBackupError && !mutated) throw error;
    throw backupError('RESTORE_FAILED', error);
  }
}

module.exports = {
  runFaultInjector,
  prepareDatabaseRollback,
  assertDatabaseUnchanged,
  moveDatabaseSidecars,
  verifyInstalledStorage,
  verifyInstalledStorySources,
  rollbackRestoreState,
  commitRestore,
};
