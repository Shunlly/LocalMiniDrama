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
  lstatIfExists,
  randomSuffix,
} = require('./dataBackupPaths');
const {
  STORY_SOURCES_PREFIX,
  archiveNameForDirectory,
  assertPortableSegment,
  fileIdentity,
  isPathInside,
  sameFileIdentity,
} = require('./dataBackupValidation');
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
  removeSqliteSidecarsSync,
  renameDurablySync,
} = require('./dataBackupMaintenance');
const {
  chmodPrivate,
} = require('./dataBackupRestorePrep');

function chmodPrivateSync(target) {
  try {
    fs.chmodSync(target, 0o600);
  } catch (error) {
    if (!['ENOSYS', 'ENOTSUP', 'EPERM', 'EINVAL'].includes(error.code)) throw error;
  }
}

function syncFileSync(target) {
  const fd = fs.openSync(target, 'r+');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function sqliteIntegrityCheck(databasePath) {
  let db;
  try {
    db = new Database(databasePath, { readonly: true, fileMustExist: true });
    db.pragma('query_only = ON');
    const rows = db.pragma('integrity_check');
    if (rows.length !== 1 || String(Object.values(rows[0] || {})[0]).toLowerCase() !== 'ok') {
      throw backupError('SQLITE_INTEGRITY_FAILED');
    }
  } catch (error) {
    if (error instanceof DataBackupError) throw error;
    throw backupError('SQLITE_INTEGRITY_FAILED', error);
  } finally {
    if (db) db.close();
  }
}

async function createOnlineDatabaseSnapshot(databasePath, snapshotPath) {
  const sourceStat = await lstatIfExists(databasePath);
  if (!sourceStat || sourceStat.isSymbolicLink() || !sourceStat.isFile()) {
    throw backupError('DATABASE_UNAVAILABLE');
  }

  let db;
  try {
    db = new Database(databasePath, { readonly: true, fileMustExist: true });
    db.pragma('busy_timeout = 5000');
    await db.backup(snapshotPath);
  } catch (error) {
    throw backupError('DATABASE_BACKUP_FAILED', error);
  } finally {
    if (db) db.close();
  }
  const snapshotStat = await lstatIfExists(snapshotPath);
  if (!snapshotStat || snapshotStat.isSymbolicLink() || !snapshotStat.isFile()) {
    throw backupError('DATABASE_BACKUP_FAILED');
  }
  await chmodPrivate(snapshotPath);
  sqliteIntegrityCheck(snapshotPath);
}

async function createLockedDatabaseSnapshot(databasePath, snapshotPath) {
  const sourceBefore = await fsp.lstat(databasePath);
  if (sourceBefore.isSymbolicLink() || !sourceBefore.isFile()) {
    throw backupError('DATABASE_UNAVAILABLE');
  }
  try {
    await fsp.copyFile(databasePath, snapshotPath, fs.constants.COPYFILE_EXCL);
  } catch (error) {
    throw backupError('DATABASE_BACKUP_FAILED', error);
  }
  const sourceAfter = await fsp.lstat(databasePath);
  if (!sameFileIdentity(sourceAfter, fileIdentity(sourceBefore))) {
    await fsp.rm(snapshotPath, { force: true }).catch(() => {});
    throw backupError('DATABASE_CHANGED');
  }
  await chmodPrivate(snapshotPath);
  sqliteIntegrityCheck(snapshotPath);
}

function quoteSqlIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function redactRemainingBackupTables(db) {
  let excluded = 0;
  const skipped = new Set(['ai_service_configs', 'global_settings']);
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all();
  for (const { name: tableName } of tables) {
    if (skipped.has(tableName)) continue;
    const table = quoteSqlIdentifier(tableName);
    const columns = db.pragma(`table_info(${table})`);
    for (const column of columns) {
      const policy = backupColumnRedactionPolicy(column.name);
      if (!policy) continue;
      const quotedColumn = quoteSqlIdentifier(column.name);
      const rows = db.prepare(
        `SELECT rowid AS __backup_rowid, ${quotedColumn} AS value FROM ${table} WHERE ${quotedColumn} IS NOT NULL`
      ).all();
      const update = db.prepare(`UPDATE ${table} SET ${quotedColumn} = ? WHERE rowid = ?`);
      for (const row of rows) {
        if (typeof row.value !== 'string') continue;
        const next = policy === 'secret'
          ? ''
          : policy === 'url'
            ? sanitizeBackupLocation(row.value)
            : policy === 'structured'
              ? redactStructuredBackupText(row.value)
              : redactLooseBackupText(row.value);
        if (next !== row.value) {
          update.run(next, row.__backup_rowid);
          excluded += 1;
        }
      }
    }
  }
  return excluded;
}

function tableExists(db, tableName) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

function excludeSecretsFromSnapshot(snapshotPath) {
  let db;
  let excluded = 0;
  const rewrittenPath = `${snapshotPath}.redacted.${randomSuffix()}`;
  try {
    db = new Database(snapshotPath, { fileMustExist: true });
    db.pragma('journal_mode = MEMORY');
    db.pragma('secure_delete = ON');
    const redact = db.transaction(() => {
      if (tableExists(db, 'ai_service_configs')) {
        const columns = new Set(db.pragma('table_info(ai_service_configs)').map((column) => column.name));
        const redactedColumns = ['api_key', 'settings', 'base_url', 'endpoint', 'query_endpoint']
          .filter((column) => columns.has(column));
        if (redactedColumns.length > 0) {
          const rows = db.prepare(
            `SELECT id, ${redactedColumns.map((column) => `"${column}"`).join(', ')} FROM ai_service_configs`
          ).all();
          const update = db.prepare(
            `UPDATE ai_service_configs SET ${redactedColumns.map((column) => `"${column}" = ?`).join(', ')} WHERE id = ?`
          );
          for (const row of rows) {
            const next = redactedColumns.map((column) => {
              if (column === 'api_key') return '';
              if (column === 'settings') return redactSettingsText(row.settings);
              return sanitizeBackupUrlColumn(row[column]);
            });
            redactedColumns.forEach((column, index) => {
              if (next[index] !== row[column]) excluded += 1;
            });
            update.run(...next, row.id);
          }
        }
      }
      if (tableExists(db, 'global_settings')) {
        const rows = db.prepare('SELECT key, value FROM global_settings').all();
        const update = db.prepare('UPDATE global_settings SET value = ? WHERE key = ?');
        for (const row of rows) {
          let next = redactSettingsText(row.value);
          if (isSensitiveBackupKey(row.key) || next === null) next = JSON.stringify('');
          if (next !== row.value) {
            excluded += 1;
            update.run(next, row.key);
          }
        }
      }
      excluded += redactRemainingBackupTables(db);
    });
    redact();
    db.prepare('VACUUM INTO ?').run(rewrittenPath);
    db.close();
    db = null;

    removeSqliteSidecarsSync(rewrittenPath);
    chmodPrivateSync(rewrittenPath);
    sqliteIntegrityCheck(rewrittenPath);
    syncFileSync(rewrittenPath);

    removeSqliteSidecarsSync(snapshotPath);
    fs.rmSync(snapshotPath, { force: true });
    renameDurablySync(rewrittenPath, snapshotPath);
  } catch (error) {
    if (error instanceof DataBackupError) throw error;
    throw backupError('SECRET_EXCLUSION_FAILED', error);
  } finally {
    if (db) db.close();
    try { fs.rmSync(rewrittenPath, { force: true }); } catch (_) {}
    try { removeSqliteSidecarsSync(rewrittenPath); } catch (_) {}
  }
  removeSqliteSidecarsSync(snapshotPath);
  sqliteIntegrityCheck(snapshotPath);
  return { excludedValues: excluded, policy: 'excluded' };
}

function isReadonlySqliteError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return code.includes('READONLY') || /readonly|read-only|EROFS/i.test(message);
}

function openExclusiveBackupFreeze(databasePath) {
  const db = new Database(databasePath, { fileMustExist: true });
  db.pragma('busy_timeout = 0');
  db.exec('BEGIN EXCLUSIVE');
  return db;
}

async function snapshotReadonlyDatabase(databasePath, snapshotPath) {
  try {
    await createOnlineDatabaseSnapshot(databasePath, snapshotPath);
  } catch (_) {
    await createLockedDatabaseSnapshot(databasePath, snapshotPath);
  }
}

function validateStorySourceReferences(databasePath, storySourcesPath, storySources, limits) {
  let db;
  try {
    db = new Database(databasePath, { readonly: true, fileMustExist: true });
    db.pragma('query_only = ON');
    if (!tableExists(db, 'story_sources')) return 0;
    const columns = new Set(db.pragma('table_info(story_sources)').map((column) => column.name));
    if (!columns.has('raw_text_path')) return 0;
    const clauses = [
      'source.raw_text_path IS NOT NULL',
      "TRIM(source.raw_text_path) <> ''",
    ];
    if (columns.has('deleted_at')) clauses.unshift('source.deleted_at IS NULL');

    let dramaJoin = '';
    if (columns.has('drama_id') && tableExists(db, 'dramas')) {
      const dramaColumns = new Set(db.pragma('table_info(dramas)').map((column) => column.name));
      if (dramaColumns.has('id') && dramaColumns.has('deleted_at')) {
        dramaJoin = 'LEFT JOIN dramas AS drama ON drama.id = source.drama_id';
        // Legacy trash entries may outlive their source file; active projects remain fail-closed.
        clauses.unshift('(drama.id IS NULL OR drama.deleted_at IS NULL)');
      }
    }
    const rows = db.prepare(
      `SELECT source.id, source.raw_text_path
       FROM story_sources AS source
       ${dramaJoin}
       WHERE ${clauses.join(' AND ')}
       ORDER BY source.id`
    ).all();
    const archivedNames = new Set(storySources.files.map((file) => file.archiveName));
    const packageRoot = path.dirname(path.dirname(path.resolve(storySourcesPath)));

    for (const row of rows) {
      const rawPath = row.raw_text_path;
      if (
        typeof rawPath !== 'string' || path.isAbsolute(rawPath) || rawPath.includes('\\') ||
        /[\x00-\x1f\x7f]/.test(rawPath)
      ) {
        throw backupError('SOURCE_TEXT_REFERENCE_INVALID');
      }
      const segments = rawPath.split('/');
      if (segments.some((segment) => !segment)) {
        throw backupError('SOURCE_TEXT_REFERENCE_INVALID');
      }
      try {
        for (const segment of segments) assertPortableSegment(segment);
      } catch (error) {
        if (error instanceof DataBackupError) {
          throw backupError('SOURCE_TEXT_REFERENCE_INVALID');
        }
        throw error;
      }
      const candidate = path.resolve(packageRoot, ...segments);
      if (!isPathInside(storySourcesPath, candidate)) {
        throw backupError('SOURCE_TEXT_REFERENCE_INVALID');
      }
      const relative = path.relative(storySourcesPath, candidate);
      const archiveName = archiveNameForDirectory(relative, STORY_SOURCES_PREFIX, limits);
      if (!archivedNames.has(archiveName)) {
        throw backupError('SOURCE_TEXT_MISSING');
      }
    }
    return rows.length;
  } catch (error) {
    if (error instanceof DataBackupError) throw error;
    throw backupError('SOURCE_TEXT_VALIDATION_FAILED', error);
  } finally {
    if (db) db.close();
  }
}

module.exports = {
  chmodPrivateSync,
  syncFileSync,
  sqliteIntegrityCheck,
  createOnlineDatabaseSnapshot,
  createLockedDatabaseSnapshot,
  quoteSqlIdentifier,
  redactRemainingBackupTables,
  tableExists,
  excludeSecretsFromSnapshot,
  isReadonlySqliteError,
  openExclusiveBackupFreeze,
  snapshotReadonlyDatabase,
  validateStorySourceReferences,
};
