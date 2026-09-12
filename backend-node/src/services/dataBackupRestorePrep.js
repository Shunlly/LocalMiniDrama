'use strict';

const net = require('node:net');
const fsp = require('node:fs/promises');
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
  maintenancePaths,
  renameDurably,
} = require('./dataBackupMaintenance');

async function chmodPrivate(target) {
  try {
    await fsp.chmod(target, 0o600);
  } catch (error) {
    if (!['ENOSYS', 'ENOTSUP', 'EPERM', 'EINVAL'].includes(error.code)) throw error;
  }
}

function normalizedProbeHost(host) {
  const value = String(host || '127.0.0.1').trim();
  if (!value || value === '0.0.0.0' || value === '::' || value === '[::]') return '127.0.0.1';
  return value;
}

async function probeTcpPort(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (error, listening) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(listening);
    };
    socket.setTimeout(timeoutMs, () => {
      const error = new Error('Service probe timed out');
      error.code = 'ETIMEDOUT';
      finish(error);
    });
    socket.once('connect', () => finish(null, true));
    socket.once('error', (error) => {
      if (['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'EADDRNOTAVAIL'].includes(error.code)) {
        finish(null, false);
      } else {
        finish(error);
      }
    });
  });
}

async function assertServiceStopped(options = {}) {
  if (options.skipServiceCheck) return;
  let configuredServer = {};
  if (!options.servicePort || !options.serviceHost) {
    try { configuredServer = require('../config').loadConfig()?.server || {}; } catch (_) {}
  }
  const port = Number(options.servicePort || process.env.PORT || configuredServer.port || 5679);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw backupError('SERVICE_CHECK_FAILED');
  }
  let listening;
  try {
    listening = await probeTcpPort(
      normalizedProbeHost(options.serviceHost || process.env.HOST || configuredServer.host),
      port,
      options.serviceProbeTimeoutMs || 750
    );
  } catch (error) {
    throw backupError('SERVICE_CHECK_FAILED', error);
  }
  if (listening) {
    throw backupError('SERVICE_RUNNING');
  }
}

async function assertTargetDirectorySafe(targetPath) {
  const stat = await lstatIfExists(targetPath);
  if (stat && (stat.isSymbolicLink() || !stat.isDirectory())) {
    throw backupError('UNSAFE_TARGET');
  }
}

function isSqliteBusy(error) {
  return error?.code === 'SQLITE_BUSY' || error?.code === 'SQLITE_LOCKED';
}

async function assertDatabaseAvailable(databasePath) {
  const stat = await lstatIfExists(databasePath);
  if (!stat) return;
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw backupError('UNSAFE_TARGET');
  }
  let db;
  let transactionStarted = false;
  try {
    db = new Database(databasePath, { fileMustExist: true });
    db.pragma('busy_timeout = 0');
    db.exec('BEGIN EXCLUSIVE');
    transactionStarted = true;
  } catch (error) {
    if (isSqliteBusy(error)) {
      throw backupError('DATABASE_BUSY');
    }
    if (error instanceof DataBackupError) throw error;
    throw backupError('DATABASE_UNAVAILABLE', error);
  } finally {
    if (db) {
      if (transactionStarted) {
        try { db.exec('ROLLBACK'); } catch (_) {}
      }
      db.close();
    }
  }
}

async function writeRestoreJournal(journal) {
  const { journalPath } = maintenancePaths(journal.databasePath);
  const tempPath = `${journalPath}.${randomSuffix()}.tmp`;
  let handle;
  try {
    handle = await fsp.open(tempPath, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify({ ...journal, updatedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await renameDurably(tempPath, journalPath);
    await chmodPrivate(journalPath);
    return journalPath;
  } catch (error) {
    throw backupError('RESTORE_JOURNAL_WRITE_FAILED', error);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fsp.rm(tempPath, { force: true }).catch(() => {});
  }
}

async function removeRestoreJournal(databasePath) {
  await fsp.rm(maintenancePaths(databasePath).journalPath, { force: true });
}

module.exports = {
  chmodPrivate,
  normalizedProbeHost,
  probeTcpPort,
  assertServiceStopped,
  assertTargetDirectorySafe,
  isSqliteBusy,
  assertDatabaseAvailable,
  writeRestoreJournal,
  removeRestoreJournal,
};
