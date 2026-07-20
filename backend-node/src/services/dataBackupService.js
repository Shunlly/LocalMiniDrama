const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const net = require('node:net');
const zlib = require('node:zlib');
const { Readable, Transform, Writable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { Worker } = require('node:worker_threads');
const Database = require('better-sqlite3');
const { updateMaintenanceHeartbeatFd } = require('./maintenanceLockFile');

const LEGACY_FORMAT_VERSION = 1;
const FORMAT_VERSION = 2;
const MANIFEST_ENTRY = 'manifest.json';
const DATABASE_ENTRY = 'database.sqlite';
const STORAGE_PREFIX = 'storage/';
const STORY_SOURCES_PREFIX = 'story_sources/';
const SQLITE_SIDECAR_SUFFIXES = Object.freeze(['-journal', '-wal', '-shm']);
const WINDOWS_DIRECTORY_SYNC_UNSUPPORTED = new Set([
  'EACCES',
  'EBADF',
  'EINVAL',
  'EISDIR',
  'ENOSYS',
  'ENOTSUP',
  'EPERM',
]);

const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const ZIP_DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP64_END_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP_END_SIGNATURE = 0x06054b50;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_DATA_DESCRIPTOR_FLAG = 0x0008;
const ZIP64_UINT32 = 0xffffffff;
const ZIP64_UINT16 = 0xffff;

const DEFAULT_LIMITS = Object.freeze({
  maxFiles: 25000,
  maxTotalBytes: 32 * 1024 * 1024 * 1024,
  maxFileBytes: 8 * 1024 * 1024 * 1024,
  maxArchiveBytes: 36 * 1024 * 1024 * 1024,
  maxPathBytes: 1024,
  maxManifestBytes: 64 * 1024,
  maxCompressionRatio: 100,
  maxPathDepth: 64,
  diskReserveBytes: 512 * 1024 * 1024,
});

const LIMIT_KEYS = Object.keys(DEFAULT_LIMITS);
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const LEGACY_MAINTENANCE_JOURNAL_VERSION = 1;
const MAINTENANCE_JOURNAL_VERSION = 2;
const MAINTENANCE_LOCK_VERSION = 2;
const MAINTENANCE_HEARTBEAT_INTERVAL_MS = 5000;
const MAINTENANCE_LOCK_STALE_MS = 30000;
const LEGACY_MAINTENANCE_LOCK_CONTRACT = 'advisory-single-host-all-localminidrama-processes-must-honor';
const MAINTENANCE_LOCK_CONTRACT = 'exclusive-lease-owner-scope-and-heartbeat-required';
const MAINTENANCE_SCOPE_ENV = 'LOCALMINIDRAMA_MAINTENANCE_SCOPE';
const EXPLICIT_MAINTENANCE_SCOPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const LEGACY_DOCKER_OWNER_SCOPE_PATTERN = /^linux:[0-9a-f]{12,64}:pid:\[[1-9][0-9]{0,19}\]$/;
const RESTORE_PHASES = new Set([
  'prepared',
  'storage_moved',
  'story_sources_moved',
  'database_moved',
  'database_installed',
  'targets_replaced',
  'verified',
  'committed',
  'rolling_back',
]);
const runtimeServiceLocks = new Map();
let runtimeExitHookInstalled = false;

class DataBackupError extends Error {
  constructor(code, publicMessage, cause) {
    super(publicMessage, cause ? { cause } : undefined);
    this.name = 'DataBackupError';
    this.code = code;
    this.publicMessage = publicMessage;
  }
}

function backupError(code, message, cause) {
  return new DataBackupError(code, message, cause);
}

function assertOperationNotAborted(signal) {
  if (signal?.aborted) {
    throw backupError('OPERATION_ABORTED', 'The data maintenance operation was interrupted.');
  }
}

function normalizeLimits(overrides = {}) {
  const limits = { ...DEFAULT_LIMITS };
  for (const key of LIMIT_KEYS) {
    if (overrides[key] === undefined) continue;
    const value = Number(overrides[key]);
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw backupError('INVALID_LIMIT', 'Backup safety limits must be positive integers.');
    }
    limits[key] = value;
  }
  if (limits.maxManifestBytes > limits.maxFileBytes) {
    throw backupError('INVALID_LIMIT', 'The manifest size limit cannot exceed the file size limit.');
  }
  return limits;
}

function randomSuffix() {
  return crypto.randomBytes(8).toString('hex');
}

function isPathInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function assertSafeTargetPaths(databasePath, storagePath, storySourcesPath) {
  const db = path.resolve(databasePath);
  const storage = path.resolve(storagePath);
  const storySources = storySourcesPath ? path.resolve(storySourcesPath) : null;
  if (
    db === path.parse(db).root || storage === path.parse(storage).root || db === storage ||
    isPathInside(storage, db) ||
    (storySources && (
      storySources === path.parse(storySources).root || storySources === db || storySources === storage ||
      isPathInside(storySources, db) || isPathInside(storage, storySources) || isPathInside(storySources, storage)
    ))
  ) {
    throw backupError('UNSAFE_TARGET', 'The configured data targets are not safe to replace.');
  }
}

function resolveStorySourcesPath(options = {}) {
  return path.resolve(options.storySourcesPath || path.join(process.cwd(), 'data', 'story_sources'));
}

function assertPortableSegment(segment) {
  if (
    !segment ||
    segment === '.' ||
    segment === '..' ||
    /[\x00-\x1f\x7f]/.test(segment) ||
    segment.includes(':') ||
    segment.endsWith('.') ||
    segment.endsWith(' ') ||
    WINDOWS_RESERVED_NAME.test(segment)
  ) {
    throw backupError('UNSAFE_ARCHIVE_PATH', 'The archive contains an unsafe or non-portable file name.');
  }
}

function validateArchiveName(name, rawName, limits) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.startsWith('/')) {
    throw backupError('UNSAFE_ARCHIVE_PATH', 'The archive contains an unsafe file path.');
  }
  if (rawName && (!Buffer.from(name, 'utf8').equals(rawName) || rawName.length > limits.maxPathBytes)) {
    throw backupError('UNSAFE_ARCHIVE_PATH', 'The archive contains an invalid encoded file path.');
  }
  const segments = name.split('/');
  if (segments.length > limits.maxPathDepth || segments.some((segment) => segment === '')) {
    throw backupError('UNSAFE_ARCHIVE_PATH', 'The archive contains an unsafe file path.');
  }
  for (const segment of segments) assertPortableSegment(segment);

  const normalized = path.posix.normalize(name);
  if (normalized !== name || path.posix.isAbsolute(normalized) || /^[a-z]:/i.test(normalized)) {
    throw backupError('UNSAFE_ARCHIVE_PATH', 'The archive contains an absolute or traversing file path.');
  }
  if (
    name !== MANIFEST_ENTRY && name !== DATABASE_ENTRY &&
    !name.startsWith(STORAGE_PREFIX) && !name.startsWith(STORY_SOURCES_PREFIX)
  ) {
    throw backupError('UNEXPECTED_ARCHIVE_ENTRY', 'The archive contains an unexpected file.');
  }
  if (name === STORAGE_PREFIX.slice(0, -1) || name === STORY_SOURCES_PREFIX.slice(0, -1)) {
    throw backupError('UNSAFE_ARCHIVE_PATH', 'The archive contains an invalid storage entry.');
  }
  return name;
}

function archiveNameForDirectory(relativePath, entryPrefix, limits) {
  const segments = relativePath.split(path.sep);
  for (const segment of segments) assertPortableSegment(segment);
  const name = `${entryPrefix}${segments.join('/')}`;
  validateArchiveName(name, Buffer.from(name, 'utf8'), limits);
  return name;
}

function fileIdentity(stat) {
  return {
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  };
}

function sameFileIdentity(stat, expected) {
  return stat.isFile() &&
    stat.dev === expected.dev &&
    stat.ino === expected.ino &&
    stat.size === expected.size &&
    stat.mtimeMs === expected.mtimeMs;
}

async function lstatIfExists(target) {
  try {
    return await fsp.lstat(target);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function lstatIfExistsSync(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function isUnsupportedDirectorySyncError(error) {
  return process.platform === 'win32' && WINDOWS_DIRECTORY_SYNC_UNSUPPORTED.has(error?.code);
}

function syncParentDirectoriesSync(...targetPaths) {
  const directories = new Set(targetPaths.map((target) => path.dirname(path.resolve(target))));
  for (const directory of directories) {
    let fd;
    try {
      fd = fs.openSync(directory, 'r');
      fs.fsyncSync(fd);
    } catch (error) {
      if (!isUnsupportedDirectorySyncError(error)) throw error;
    } finally {
      if (fd !== undefined) {
        try { fs.closeSync(fd); } catch (_) {}
      }
    }
  }
}

async function syncParentDirectories(...targetPaths) {
  const directories = new Set(targetPaths.map((target) => path.dirname(path.resolve(target))));
  for (const directory of directories) {
    let handle;
    try {
      handle = await fsp.open(directory, 'r');
      await handle.sync();
    } catch (error) {
      if (!isUnsupportedDirectorySyncError(error)) throw error;
    } finally {
      if (handle) await handle.close().catch(() => {});
    }
  }
}

function renameDurablySync(source, destination, onRenamed) {
  fs.renameSync(source, destination);
  onRenamed?.();
  syncParentDirectoriesSync(source, destination);
}

async function renameDurably(source, destination, onRenamed) {
  await fsp.rename(source, destination);
  onRenamed?.();
  await syncParentDirectories(source, destination);
}

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

function maintenancePaths(databasePath) {
  const resolved = path.resolve(databasePath);
  return {
    lockPath: `${resolved}.maintenance.lock`,
    recoveryLockPath: `${resolved}.maintenance.recovery.lock`,
    journalPath: `${resolved}.restore.journal.json`,
  };
}

function processIsRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function nativeMaintenanceOwnerScope() {
  let pidNamespace = 'native';
  if (process.platform === 'linux') {
    try {
      pidNamespace = fs.readlinkSync('/proc/self/ns/pid');
    } catch (_) {}
  }
  return `${process.platform}:${os.hostname()}:${pidNamespace}`;
}

function resolveMaintenanceOwnerScope(explicitScope) {
  const hasOption = explicitScope !== undefined && explicitScope !== null;
  const hasEnvironment = Object.hasOwn(process.env, MAINTENANCE_SCOPE_ENV);
  if (!hasOption && !hasEnvironment) {
    return { value: nativeMaintenanceOwnerScope(), explicit: false };
  }

  const value = hasOption ? explicitScope : process.env[MAINTENANCE_SCOPE_ENV];
  if (typeof value !== 'string' || !EXPLICIT_MAINTENANCE_SCOPE_PATTERN.test(value)) {
    throw backupError(
      'MAINTENANCE_SCOPE_INVALID',
      `${MAINTENANCE_SCOPE_ENV} must contain 1-128 ASCII letters, digits, dots, underscores, colons, or hyphens.`
    );
  }
  return { value, explicit: true };
}

function maintenanceLockPayload(operation, token, now = new Date(), ownerScope) {
  const timestamp = now.toISOString();
  return {
    version: MAINTENANCE_LOCK_VERSION,
    pid: process.pid,
    ownerScope: resolveMaintenanceOwnerScope(ownerScope).value,
    operation,
    token,
    createdAt: timestamp,
    heartbeatAt: timestamp,
    contract: MAINTENANCE_LOCK_CONTRACT,
  };
}

function writeMaintenanceLockFd(fd, payload) {
  const data = Buffer.from(`${JSON.stringify(payload)}\n`, 'utf8');
  fs.ftruncateSync(fd, 0);
  let offset = 0;
  while (offset < data.length) {
    offset += fs.writeSync(fd, data, offset, data.length - offset, offset);
  }
  fs.fsyncSync(fd);
}

function startMaintenanceHeartbeat(lock, options = {}) {
  const requested = Number(options.heartbeatIntervalMs);
  const intervalMs = Number.isFinite(requested) && requested > 0
    ? Math.max(100, Math.floor(requested))
    : MAINTENANCE_HEARTBEAT_INTERVAL_MS;
  lock.heartbeatTimer = setInterval(() => {
    if (lock.released) return;
    try {
      lock.payload = updateMaintenanceHeartbeatFd(lock.fd, {
        contract: MAINTENANCE_LOCK_CONTRACT,
        pid: process.pid,
        token: lock.token,
      });
    } catch (error) {
      lock.heartbeatError = error;
      options.log?.error?.('Maintenance lock heartbeat failed', { error: error.message });
    }
  }, intervalMs);
  lock.heartbeatTimer.unref?.();
}

function startMaintenanceRecoveryHeartbeat(claim, options = {}) {
  const requested = Number(options.heartbeatIntervalMs);
  const intervalMs = Number.isFinite(requested) && requested > 0
    ? Math.max(100, Math.floor(requested))
    : MAINTENANCE_HEARTBEAT_INTERVAL_MS;
  const stateBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const state = new Int32Array(stateBuffer);
  const worker = new Worker(path.join(__dirname, 'maintenanceHeartbeatWorker.js'), {
    workerData: {
      contract: MAINTENANCE_LOCK_CONTRACT,
      intervalMs,
      lockPath: claim.lockPath,
      pid: process.pid,
      stateBuffer,
      token: claim.token,
    },
  });
  worker.unref();
  worker.on('error', () => {});
  Atomics.wait(state, 0, 0, Math.max(2000, intervalMs * 2));
  if (Atomics.load(state, 0) !== 1) {
    Atomics.compareExchange(state, 0, 0, 2);
    Atomics.notify(state, 0);
    worker.terminate().catch(() => {});
    throw backupError(
      'MAINTENANCE_LOCK_FAILED',
      'The maintenance recovery heartbeat could not be started.'
    );
  }
  claim.heartbeatWorker = worker;
  claim.heartbeatState = state;
}

function stopMaintenanceRecoveryHeartbeat(claim) {
  if (!claim?.heartbeatWorker || !claim.heartbeatState) return;
  const state = claim.heartbeatState;
  if (Atomics.compareExchange(state, 0, 1, 2) === 1) {
    Atomics.notify(state, 0);
    Atomics.wait(state, 0, 2, 2000);
  }
  claim.heartbeatWorker.terminate().catch(() => {});
  claim.heartbeatWorker = null;
  claim.heartbeatState = null;
}

function assertMaintenanceLockRecoverable(lock, lockStat, options = {}) {
  if (!lock || typeof lock !== 'object' || Array.isArray(lock)) {
    throw backupError('MAINTENANCE_LOCK_INVALID', 'Maintenance lock is not a valid object.');
  }
  const pid = Number(lock.pid);
  const operation = String(lock.operation || '');
  if (!Number.isInteger(pid) || pid <= 0 || !['service', 'backup', 'restore'].includes(operation)) {
    throw backupError('MAINTENANCE_LOCK_INVALID', 'Maintenance lock fields are invalid.');
  }

  const version = Number(lock.version);
  if (!Number.isInteger(version) || ![1, MAINTENANCE_LOCK_VERSION].includes(version)) {
    throw backupError('MAINTENANCE_LOCK_INVALID', 'Maintenance lock version is invalid or unsupported.');
  }
  const heartbeatMs = Date.parse(String(lock.heartbeatAt || lock.createdAt || ''));
  if (!Number.isFinite(heartbeatMs)) {
    throw backupError('MAINTENANCE_LOCK_INVALID', 'Maintenance lock has no valid heartbeat timestamp.');
  }
  if (version === 1) {
    const legacyKeys = ['contract', 'createdAt', 'operation', 'pid', 'version'];
    const legacyTokenKeys = [...legacyKeys, 'token'];
    const actualKeys = Object.keys(lock).sort().join('\0');
    const hasLegacyShape = actualKeys === legacyKeys.sort().join('\0');
    const hasLegacyTokenShape = actualKeys === legacyTokenKeys.sort().join('\0');
    if (
      (!hasLegacyShape && !hasLegacyTokenShape) ||
      lock.contract !== LEGACY_MAINTENANCE_LOCK_CONTRACT ||
      (hasLegacyTokenShape && (typeof lock.token !== 'string' || !/^[0-9a-f]{16}$/.test(lock.token)))
    ) {
      throw backupError(
        'MAINTENANCE_LOCK_FOREIGN',
        'A legacy maintenance lock cannot be proven to use the supported single-host contract.'
      );
    }
  } else {
    if (
      typeof lock.token !== 'string' || !/^[0-9a-f]{16}$/.test(lock.token) ||
      typeof lock.ownerScope !== 'string' || !lock.ownerScope ||
      lock.contract !== MAINTENANCE_LOCK_CONTRACT
    ) {
      throw backupError('MAINTENANCE_LOCK_INVALID', 'Maintenance lease ownership fields are invalid.');
    }
  }

  const configuredStaleMs = Number(options.lockStaleMs);
  const staleMs = Number.isFinite(configuredStaleMs) && configuredStaleMs > 0
    ? configuredStaleMs
    : MAINTENANCE_LOCK_STALE_MS;
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const freshestMs = Math.max(heartbeatMs, Number(lockStat?.mtimeMs) || 0);
  if (nowMs - freshestMs <= staleMs) {
    throw backupError('MAINTENANCE_ACTIVE', 'Another LocalMiniDrama process holds a fresh maintenance lease.');
  }

  const currentScope = resolveMaintenanceOwnerScope(options.ownerScope);
  if (version === 1) {
    if (!currentScope.explicit && processIsRunning(pid)) {
      throw backupError('MAINTENANCE_ACTIVE', 'Another LocalMiniDrama process still owns the maintenance lease.');
    }
    return true;
  }

  if (lock.ownerScope === currentScope.value) {
    // Explicit scopes are shared across container PID namespaces. Once their heartbeat is stale,
    // a local PID match (usually PID 1 after a recreate) cannot prove that the old owner is alive.
    if (!currentScope.explicit && processIsRunning(pid)) {
      throw backupError('MAINTENANCE_ACTIVE', 'Another LocalMiniDrama process still owns the maintenance lease.');
    }
    return true;
  }

  if (currentScope.explicit && LEGACY_DOCKER_OWNER_SCOPE_PATTERN.test(lock.ownerScope)) {
    return true;
  }

  throw backupError(
    'MAINTENANCE_LOCK_FOREIGN',
    'A stale maintenance lock belongs to another process namespace and requires explicit operator recovery.'
  );
}

function assertRecoveryAuxPath(targetPath, candidate, label) {
  if (candidate == null) return null;
  const target = path.resolve(targetPath);
  const resolved = path.resolve(String(candidate));
  const expectedPrefix = `.${path.basename(target)}.${label}.`;
  if (path.dirname(resolved) !== path.dirname(target) || !path.basename(resolved).startsWith(expectedPrefix)) {
    throw backupError('INVALID_RESTORE_JOURNAL', 'Restore journal contains an unsafe recovery path.');
  }
  return resolved;
}

function validateRestoreJournal(raw, databasePath, storagePath, storySourcesPath) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw backupError('INVALID_RESTORE_JOURNAL', 'Restore journal is not a valid object.');
  }
  const database = path.resolve(databasePath);
  const storage = path.resolve(storagePath);
  const storySources = path.resolve(storySourcesPath);
  const legacyJournal = raw.version === LEGACY_MAINTENANCE_JOURNAL_VERSION;
  const currentJournal = raw.version === MAINTENANCE_JOURNAL_VERSION;
  if (
    (!legacyJournal && !currentJournal) || raw.operation !== 'restore' ||
    !RESTORE_PHASES.has(raw.phase) || path.resolve(String(raw.databasePath || '')) !== database ||
    path.resolve(String(raw.storagePath || '')) !== storage ||
    typeof raw.originalDatabaseExisted !== 'boolean' || typeof raw.originalStorageExisted !== 'boolean'
  ) {
    throw backupError('INVALID_RESTORE_JOURNAL', 'Restore journal does not match the configured data targets.');
  }
  const storyFields = [
    'storySourcesPath',
    'storySourcesStage',
    'storySourcesRollbackPath',
    'originalStorySourcesExisted',
    'replaceStorySources',
  ];
  if (legacyJournal && storyFields.some((key) => Object.hasOwn(raw, key))) {
    throw backupError('INVALID_RESTORE_JOURNAL', 'A legacy restore journal contains unsupported data targets.');
  }
  if (currentJournal && (
    path.resolve(String(raw.storySourcesPath || '')) !== storySources ||
    typeof raw.originalStorySourcesExisted !== 'boolean' ||
    typeof raw.replaceStorySources !== 'boolean' ||
    (raw.replaceStorySources && (!raw.storySourcesStage || !raw.storySourcesRollbackPath)) ||
    (!raw.replaceStorySources && (raw.storySourcesStage != null || raw.storySourcesRollbackPath != null))
  )) {
    throw backupError('INVALID_RESTORE_JOURNAL', 'Restore journal does not match the configured source-text target.');
  }
  const replaceStorySources = currentJournal && raw.replaceStorySources;
  return {
    ...raw,
    databasePath: database,
    storagePath: storage,
    storySourcesPath: storySources,
    replaceStorySources,
    databaseStage: assertRecoveryAuxPath(database, raw.databaseStage, 'restore-incoming'),
    storageStage: assertRecoveryAuxPath(storage, raw.storageStage, 'restore-incoming'),
    storySourcesStage: replaceStorySources
      ? assertRecoveryAuxPath(storySources, raw.storySourcesStage, 'restore-incoming')
      : null,
    oldDatabasePath: assertRecoveryAuxPath(database, raw.oldDatabasePath, 'restore-original'),
    storageRollbackPath: assertRecoveryAuxPath(storage, raw.storageRollbackPath, 'restore-rollback'),
    storySourcesRollbackPath: replaceStorySources
      ? assertRecoveryAuxPath(storySources, raw.storySourcesRollbackPath, 'restore-rollback')
      : null,
    databaseRollbackPath: assertRecoveryAuxPath(database, raw.databaseRollbackPath, 'restore-rollback'),
    originalStorySourcesExisted: replaceStorySources ? raw.originalStorySourcesExisted : false,
  };
}

function readJsonFileSync(filePath, code) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw backupError(code, 'Persistent maintenance state could not be read safely.', error);
  }
}

function removeSqliteSidecarsSync(databasePath) {
  for (const suffix of SQLITE_SIDECAR_SUFFIXES) fs.rmSync(`${databasePath}${suffix}`, { force: true });
}

function acquireMaintenanceRecoveryClaimSync(databasePath, options = {}) {
  const { recoveryLockPath } = maintenancePaths(databasePath);
  fs.mkdirSync(path.dirname(recoveryLockPath), { recursive: true });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const token = randomSuffix();
    const payload = maintenanceLockPayload('restore', token, new Date(), options.ownerScope);
    let fd;
    try {
      fd = fs.openSync(recoveryLockPath, 'wx', 0o600);
      writeMaintenanceLockFd(fd, payload);
      const claim = { fd, lockPath: recoveryLockPath, payload, token, released: false };
      try {
        startMaintenanceRecoveryHeartbeat(claim, options);
      } catch (heartbeatError) {
        try { fs.closeSync(fd); } catch (_) {}
        try { fs.rmSync(recoveryLockPath, { force: true }); } catch (_) {}
        throw heartbeatError;
      }
      return claim;
    } catch (error) {
      if (fd != null) {
        try { fs.closeSync(fd); } catch (_) {}
      }
      if (error.code !== 'EEXIST') {
        throw backupError('MAINTENANCE_LOCK_FAILED', 'The maintenance recovery lease could not be created.', error);
      }

      const claimStat = lstatIfExistsSync(recoveryLockPath);
      if (!claimStat) continue;
      if (claimStat.isSymbolicLink() || !claimStat.isFile()) {
        throw backupError('MAINTENANCE_LOCK_INVALID', 'Maintenance recovery lease is not a regular file.');
      }
      const current = readJsonFileSync(recoveryLockPath, 'MAINTENANCE_LOCK_INVALID');
      assertMaintenanceLockRecoverable(current, claimStat, options);

      const reclaimedPath = `${recoveryLockPath}.reclaimed.${randomSuffix()}`;
      try {
        renameDurablySync(recoveryLockPath, reclaimedPath);
        fs.rmSync(reclaimedPath, { force: true });
      } catch (renameError) {
        if (renameError.code === 'ENOENT') continue;
        throw backupError('MAINTENANCE_LOCK_FAILED', 'A stale maintenance recovery lease could not be reclaimed.', renameError);
      }
    }
  }

  throw backupError('MAINTENANCE_ACTIVE', 'Another LocalMiniDrama process is recovering maintenance state.');
}

function releaseMaintenanceRecoveryClaimSync(claim) {
  if (!claim || claim.released) return;
  claim.released = true;
  stopMaintenanceRecoveryHeartbeat(claim);
  try { fs.closeSync(claim.fd); } catch (_) {}
  try {
    const current = JSON.parse(fs.readFileSync(claim.lockPath, 'utf8'));
    if (current.token === claim.token && Number(current.pid) === process.pid) {
      fs.rmSync(claim.lockPath, { force: true });
    }
  } catch (_) {}
}

function recoverInterruptedMaintenanceSync(options = {}) {
  if (!options.databasePath || !options.storagePath) {
    throw backupError('INVALID_ARGUMENT', 'Database and storage locations are required for maintenance recovery.');
  }
  const expectsOwner = options.expectedOwnerScope !== undefined || options.expectedPid !== undefined;
  if (expectsOwner && (
    typeof options.expectedOwnerScope !== 'string' || !options.expectedOwnerScope ||
    !Number.isInteger(options.expectedPid) || options.expectedPid <= 0
  )) {
    throw backupError('INVALID_ARGUMENT', 'A valid expected maintenance owner scope and PID are required.');
  }
  const databasePath = path.resolve(options.databasePath);
  const storagePath = path.resolve(options.storagePath);
  const storySourcesPath = resolveStorySourcesPath(options);
  assertSafeTargetPaths(databasePath, storagePath, storySourcesPath);
  const recoveryClaim = acquireMaintenanceRecoveryClaimSync(databasePath, options);
  const { lockPath, journalPath } = maintenancePaths(databasePath);
  try {
    const lockStat = lstatIfExistsSync(lockPath);
    if (lockStat) {
      if (lockStat.isSymbolicLink() || !lockStat.isFile()) {
        throw backupError('MAINTENANCE_LOCK_INVALID', 'Maintenance lock is not a regular file.');
      }
      const lock = readJsonFileSync(lockPath, 'MAINTENANCE_LOCK_INVALID');
      assertMaintenanceLockRecoverable(lock, lockStat, options);
      if (expectsOwner && (
        lock.ownerScope !== options.expectedOwnerScope ||
        Number(lock.pid) !== options.expectedPid
      )) {
        throw backupError(
          'MAINTENANCE_OWNER_MISMATCH',
          'The maintenance lock owner changed after inspection; inspect it again.'
        );
      }
      if (
        expectsOwner && lock.ownerScope === nativeMaintenanceOwnerScope() &&
        processIsRunning(Number(lock.pid))
      ) {
        throw backupError('MAINTENANCE_ACTIVE', 'The native maintenance lease owner process is still running.');
      }
    } else if (expectsOwner) {
      throw backupError('MAINTENANCE_LOCK_MISSING', 'No maintenance lock exists.');
    }

    const journalStat = lstatIfExistsSync(journalPath);
    if (!journalStat) {
      if (lockStat) fs.rmSync(lockPath, { force: true });
      return { recovered: false };
    }
    if (journalStat.isSymbolicLink() || !journalStat.isFile()) {
      throw backupError('INVALID_RESTORE_JOURNAL', 'Restore journal is not a regular file.');
    }
    const journal = validateRestoreJournal(
      readJsonFileSync(journalPath, 'INVALID_RESTORE_JOURNAL'),
      databasePath,
      storagePath,
      storySourcesPath
    );

    try {
      if (journal.phase === 'committed') {
        if (journal.oldDatabasePath) fs.rmSync(journal.oldDatabasePath, { force: true });
        if (journal.oldDatabasePath) removeSqliteSidecarsSync(journal.oldDatabasePath);
      } else {
        if (journal.oldDatabasePath && lstatIfExistsSync(journal.oldDatabasePath)) {
          fs.rmSync(databasePath, { force: true });
          removeSqliteSidecarsSync(databasePath);
          renameDurablySync(journal.oldDatabasePath, databasePath);
          for (const suffix of SQLITE_SIDECAR_SUFFIXES) {
            const oldSidecar = `${journal.oldDatabasePath}${suffix}`;
            if (lstatIfExistsSync(oldSidecar)) renameDurablySync(oldSidecar, `${databasePath}${suffix}`);
          }
        } else if (!journal.originalDatabaseExisted) {
          fs.rmSync(databasePath, { force: true });
          removeSqliteSidecarsSync(databasePath);
        }
        if (journal.storageRollbackPath && lstatIfExistsSync(journal.storageRollbackPath)) {
          fs.rmSync(storagePath, { recursive: true, force: true });
          renameDurablySync(journal.storageRollbackPath, storagePath);
        } else if (!journal.originalStorageExisted) {
          fs.rmSync(storagePath, { recursive: true, force: true });
        }
        if (journal.replaceStorySources) {
          if (journal.storySourcesRollbackPath && lstatIfExistsSync(journal.storySourcesRollbackPath)) {
            fs.rmSync(storySourcesPath, { recursive: true, force: true });
            renameDurablySync(journal.storySourcesRollbackPath, storySourcesPath);
          } else if (!journal.originalStorySourcesExisted) {
            fs.rmSync(storySourcesPath, { recursive: true, force: true });
          }
        }
      }
      if (journal.databaseStage) fs.rmSync(journal.databaseStage, { force: true });
      if (journal.databaseStage) removeSqliteSidecarsSync(journal.databaseStage);
      if (journal.storageStage) fs.rmSync(journal.storageStage, { recursive: true, force: true });
      if (journal.storySourcesStage) fs.rmSync(journal.storySourcesStage, { recursive: true, force: true });
      fs.rmSync(journalPath, { force: true });
      fs.rmSync(lockPath, { force: true });
      options.log?.warn?.('Recovered interrupted data restore', { phase: journal.phase });
      return { recovered: true, action: journal.phase === 'committed' ? 'finalized' : 'rolled_back' };
    } catch (error) {
      if (error instanceof DataBackupError) throw error;
      throw backupError('RESTORE_RECOVERY_FAILED', 'Interrupted restore could not be recovered automatically.', error);
    }
  } finally {
    releaseMaintenanceRecoveryClaimSync(recoveryClaim);
  }
}

function releaseServiceMaintenanceLock(lock) {
  if (!lock || lock.released) return;
  lock.released = true;
  if (lock.heartbeatTimer) clearInterval(lock.heartbeatTimer);
  runtimeServiceLocks.delete(lock.lockPath);
  try { fs.closeSync(lock.fd); } catch (_) {}
  try {
    const current = JSON.parse(fs.readFileSync(lock.lockPath, 'utf8'));
    if (current.token === lock.token && Number(current.pid) === process.pid) fs.rmSync(lock.lockPath, { force: true });
  } catch (_) {}
}

function acquireServiceMaintenanceLockSync(options = {}) {
  const databasePath = path.resolve(options.databasePath || '');
  const storagePath = path.resolve(options.storagePath || '');
  const storySourcesPath = resolveStorySourcesPath(options);
  if (!options.databasePath || !options.storagePath) {
    throw backupError('INVALID_ARGUMENT', 'Database and storage locations are required for the service maintenance guard.');
  }
  const { lockPath } = maintenancePaths(databasePath);
  const existing = runtimeServiceLocks.get(lockPath);
  if (existing && !existing.released) return existing;
  recoverInterruptedMaintenanceSync({
    databasePath,
    storagePath,
    storySourcesPath,
    log: options.log,
    lockStaleMs: options.lockStaleMs,
    nowMs: options.nowMs,
    ownerScope: options.ownerScope,
  });

  let fd;
  const token = randomSuffix();
  const payload = maintenanceLockPayload('service', token, new Date(), options.ownerScope);
  try {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fd = fs.openSync(lockPath, 'wx+', 0o600);
    writeMaintenanceLockFd(fd, payload);
  } catch (error) {
    if (fd != null) {
      try { fs.closeSync(fd); } catch (_) {}
    }
    if (error.code === 'EEXIST') {
      throw backupError('MAINTENANCE_LOCKED', 'A maintenance operation started while the backend was starting.');
    }
    throw backupError('MAINTENANCE_LOCK_FAILED', 'The backend maintenance guard could not be created.', error);
  }
  const lock = {
    fd,
    lockPath,
    payload,
    token,
    released: false,
    release() { releaseServiceMaintenanceLock(lock); },
  };
  runtimeServiceLocks.set(lockPath, lock);
  startMaintenanceHeartbeat(lock, options);
  if (!runtimeExitHookInstalled) {
    runtimeExitHookInstalled = true;
    process.once('exit', () => {
      for (const active of [...runtimeServiceLocks.values()]) releaseServiceMaintenanceLock(active);
    });
  }
  return lock;
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
      throw backupError('INSUFFICIENT_STORAGE', 'Insufficient disk space for the requested backup or restore operation.');
    }
  }
}

async function chmodPrivate(target) {
  try {
    await fsp.chmod(target, 0o600);
  } catch (error) {
    if (!['ENOSYS', 'ENOTSUP', 'EPERM', 'EINVAL'].includes(error.code)) throw error;
  }
}

async function removeSqliteSidecars(databasePath, strict = false) {
  for (const suffix of SQLITE_SIDECAR_SUFFIXES) {
    try {
      await fsp.rm(`${databasePath}${suffix}`, { force: true });
    } catch (error) {
      if (strict) {
        throw backupError('TEMP_CLEANUP_FAILED', 'Temporary SQLite files could not be removed safely.', error);
      }
    }
  }
}

async function collectDirectoryFiles(rootPath, entryPrefix, limits) {
  const rootStat = await lstatIfExists(rootPath);
  if (!rootStat) return { files: [], totalBytes: 0 };
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw backupError('UNSAFE_STORAGE', 'A backup data root must be a real directory, not a symbolic link.');
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
      throw backupError('STORAGE_READ_FAILED', 'Storage files could not be enumerated safely.', error);
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
        throw backupError('STORAGE_CHANGED', 'Storage changed while the backup was being prepared.', error);
      }
      if (stat.isSymbolicLink()) {
        throw backupError('SYMLINK_REJECTED', 'Symbolic links in storage are not included in backups.');
      }
      if (stat.isDirectory()) {
        pending.push({ absolute, relative });
        continue;
      }
      if (!stat.isFile()) {
        throw backupError('SPECIAL_FILE_REJECTED', 'Storage contains a non-regular file that cannot be backed up.');
      }
      if (stat.size > limits.maxFileBytes) {
        throw backupError('FILE_LIMIT_EXCEEDED', 'A storage file exceeds the configured backup size limit.');
      }
      if (files.length + 1 > limits.maxFiles) {
        throw backupError('FILE_LIMIT_EXCEEDED', 'Storage contains more files than the configured backup limit.');
      }
      totalBytes += stat.size;
      if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxTotalBytes) {
        throw backupError('SIZE_LIMIT_EXCEEDED', 'Storage exceeds the configured total backup size limit.');
      }

      const archiveName = archiveNameForDirectory(relative, entryPrefix, limits);
      const collisionKey = archiveName.normalize('NFC').toLowerCase();
      if (names.has(collisionKey)) {
        throw backupError('DUPLICATE_ARCHIVE_PATH', 'Storage contains file names that collide on supported platforms.');
      }
      names.add(collisionKey);
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
      throw backupError('BACKUP_DATA_CHANGED', 'A backup data file changed while the backup was being prepared.');
    }
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (position < file.identity.size) {
      const length = Math.min(buffer.length, file.identity.size - position);
      const result = await handle.read(buffer, 0, length, position);
      if (result.bytesRead <= 0) {
        throw backupError('BACKUP_DATA_CHANGED', 'A backup data file changed while the backup was being prepared.');
      }
      hash.update(buffer.subarray(0, result.bytesRead));
      position += result.bytesRead;
    }
    const after = await handle.stat();
    if (position !== file.identity.size || !sameFileIdentity(after, file.identity)) {
      throw backupError('BACKUP_DATA_CHANGED', 'A backup data file changed while the backup was being prepared.');
    }
    return hash.digest('hex');
  } catch (error) {
    if (error instanceof DataBackupError) throw error;
    throw backupError('BACKUP_DATA_READ_FAILED', 'A backup data file could not be read safely.', error);
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

async function hashCollectedFiles(collection) {
  const aggregate = crypto.createHash('sha256');
  for (const file of collection.files) {
    file.sha256 = await sha256CollectedFile(file);
    aggregate.update(`${file.archiveName}\0${file.identity.size}\0${file.sha256}\n`, 'utf8');
  }
  collection.sha256 = aggregate.digest('hex');
  return collection;
}

function hashStorageFiles(collection) {
  return hashCollectedFiles(collection);
}

function hashStorySourceFiles(collection) {
  return hashCollectedFiles(collection);
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
        throw backupError('SOURCE_TEXT_REFERENCE_INVALID', 'An active source-text reference has an unsafe path.');
      }
      const segments = rawPath.split('/');
      if (segments.some((segment) => !segment)) {
        throw backupError('SOURCE_TEXT_REFERENCE_INVALID', 'An active source-text reference has an unsafe path.');
      }
      try {
        for (const segment of segments) assertPortableSegment(segment);
      } catch (error) {
        if (error instanceof DataBackupError) {
          throw backupError('SOURCE_TEXT_REFERENCE_INVALID', 'An active source-text reference has an unsafe path.');
        }
        throw error;
      }
      const candidate = path.resolve(packageRoot, ...segments);
      if (!isPathInside(storySourcesPath, candidate)) {
        throw backupError('SOURCE_TEXT_REFERENCE_INVALID', 'An active source-text reference escapes the source-text root.');
      }
      const relative = path.relative(storySourcesPath, candidate);
      const archiveName = archiveNameForDirectory(relative, STORY_SOURCES_PREFIX, limits);
      if (!archivedNames.has(archiveName)) {
        throw backupError('SOURCE_TEXT_MISSING', 'An active source-text reference points to a missing or unsafe file.');
      }
    }
    return rows.length;
  } catch (error) {
    if (error instanceof DataBackupError) throw error;
    throw backupError('SOURCE_TEXT_VALIDATION_FAILED', 'Source-text references could not be validated safely.', error);
  } finally {
    if (db) db.close();
  }
}

function sqliteIntegrityCheck(databasePath) {
  let db;
  try {
    db = new Database(databasePath, { readonly: true, fileMustExist: true });
    db.pragma('query_only = ON');
    const rows = db.pragma('integrity_check');
    if (rows.length !== 1 || String(Object.values(rows[0] || {})[0]).toLowerCase() !== 'ok') {
      throw backupError('SQLITE_INTEGRITY_FAILED', 'The SQLite database failed its integrity check.');
    }
  } catch (error) {
    if (error instanceof DataBackupError) throw error;
    throw backupError('SQLITE_INTEGRITY_FAILED', 'The SQLite database failed its integrity check.', error);
  } finally {
    if (db) db.close();
  }
}

async function createOnlineDatabaseSnapshot(databasePath, snapshotPath) {
  const sourceStat = await lstatIfExists(databasePath);
  if (!sourceStat || sourceStat.isSymbolicLink() || !sourceStat.isFile()) {
    throw backupError('DATABASE_UNAVAILABLE', 'The configured SQLite database is unavailable or unsafe.');
  }

  let db;
  try {
    db = new Database(databasePath, { readonly: true, fileMustExist: true });
    db.pragma('busy_timeout = 5000');
    await db.backup(snapshotPath);
  } catch (error) {
    throw backupError('DATABASE_BACKUP_FAILED', 'A consistent SQLite snapshot could not be created.', error);
  } finally {
    if (db) db.close();
  }
  const snapshotStat = await lstatIfExists(snapshotPath);
  if (!snapshotStat || snapshotStat.isSymbolicLink() || !snapshotStat.isFile()) {
    throw backupError('DATABASE_BACKUP_FAILED', 'A consistent SQLite snapshot could not be created.');
  }
  await chmodPrivate(snapshotPath);
  sqliteIntegrityCheck(snapshotPath);
}

async function createLockedDatabaseSnapshot(databasePath, snapshotPath) {
  const sourceBefore = await fsp.lstat(databasePath);
  if (sourceBefore.isSymbolicLink() || !sourceBefore.isFile()) {
    throw backupError('DATABASE_UNAVAILABLE', 'The configured SQLite database is unavailable or unsafe.');
  }
  try {
    await fsp.copyFile(databasePath, snapshotPath, fs.constants.COPYFILE_EXCL);
  } catch (error) {
    throw backupError('DATABASE_BACKUP_FAILED', 'A consistent SQLite snapshot could not be created.', error);
  }
  const sourceAfter = await fsp.lstat(databasePath);
  if (!sameFileIdentity(sourceAfter, fileIdentity(sourceBefore))) {
    await fsp.rm(snapshotPath, { force: true }).catch(() => {});
    throw backupError('DATABASE_CHANGED', 'The SQLite database changed while its snapshot was being created.');
  }
  await chmodPrivate(snapshotPath);
  sqliteIntegrityCheck(snapshotPath);
}

function isSensitiveBackupKey(key) {
  const text = String(key || '');
  const compact = text.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return ['auth', 'authentication', 'xauth'].includes(compact) || compact.endsWith('authentication') ||
    /api[_-]?key/i.test(text) ||
    /access[_-]?key/i.test(text) ||
    /credential/i.test(text) ||
    /secret/i.test(text) ||
    /signature/i.test(text) ||
    /^sig$/i.test(text) ||
    /password/i.test(text) ||
    /authorization/i.test(text) ||
    /cookie/i.test(text) ||
    /private[_-]?key/i.test(text) ||
    /session/i.test(text) ||
    /^token$/i.test(text) ||
    /[_-]token$/i.test(text) ||
    /Token$/.test(text);
}

const SAFE_BACKUP_HEADER_NAMES = new Set([
  'accept',
  'acceptencoding',
  'cachecontrol',
  'contenttype',
  'useragent',
]);

function backupKeyWords(key) {
  return String(key || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function isBackupHeaderContainerKey(key) {
  return backupKeyWords(key).some((word) => word === 'header' || word === 'headers');
}

function isSafeBackupHeaderName(name) {
  return SAFE_BACKUP_HEADER_NAMES.has(backupKeyWords(name).join(''));
}

const SAFE_BACKUP_URL_QUERY_PARAMETERS = new Set([
  'alt',
  'apiversion',
  'format',
  'page',
  'pagesize',
  'prettyprint',
  'responseformat',
  'version',
  'view',
]);

function normalizeBackupQueryKey(key) {
  return String(key || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function sanitizeBackupRelativeUrl(value) {
  const withoutHash = value.split('#', 1)[0];
  const queryIndex = withoutHash.indexOf('?');
  if (queryIndex < 0) return withoutHash;
  const pathname = withoutHash.slice(0, queryIndex);
  const params = new URLSearchParams(withoutHash.slice(queryIndex + 1));
  for (const key of [...params.keys()]) {
    if (!SAFE_BACKUP_URL_QUERY_PARAMETERS.has(normalizeBackupQueryKey(key))) params.delete(key);
  }
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ''}`;
}

function sanitizeBackupAbsoluteUrl(value, protocolRelative = false) {
  try {
    const parsed = new URL(protocolRelative ? `https:${value}` : value);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    if (protocolRelative) return `//${parsed.host}${parsed.pathname}`.replace(/\/$/, '');
    return parsed.toString().replace(/\/$/, '');
  } catch (_) {
    return '';
  }
}

function sanitizeBackupLocation(value) {
  if (typeof value !== 'string') return value;
  const raw = value.trim();
  if (!raw) return value;
  if (/^https?:\/\//i.test(raw)) return sanitizeBackupAbsoluteUrl(raw);
  if (raw.startsWith('//')) return sanitizeBackupAbsoluteUrl(raw, true);
  if (raw.startsWith('/') || /^[A-Za-z0-9._~-]+\/[^\s]*[?#]/.test(raw)) {
    return sanitizeBackupRelativeUrl(raw);
  }
  return value
    .replace(/https?:\/\/[^\s,"'<>[\]{}(),;]+/gi, (url) => sanitizeBackupAbsoluteUrl(url))
    .replace(/(^|[^:])(\/\/[^\s,"'<>[\]{}(),;]+)/gi, (match, prefix, url) => (
      `${prefix}${sanitizeBackupAbsoluteUrl(url, true)}`
    ))
    .replace(
      /[A-Za-z0-9._~:@%+=\/-]+\?[^\s,"'<>[\]{}(),;]+/gi,
      (url) => sanitizeBackupRelativeUrl(url)
    );
}

function sanitizeBackupUrlColumn(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const urlLike = /^https?:\/\//i.test(raw)
    || raw.startsWith('//')
    || raw.startsWith('/')
    || /^[A-Za-z0-9._~-]+\//.test(raw);
  return urlLike ? sanitizeBackupLocation(raw) : '';
}

function redactBackupHeaders(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return '';
      const headerName = entry.name ?? entry.key ?? '';
      const safe = isSafeBackupHeaderName(headerName);
      const out = {};
      for (const [key, child] of Object.entries(entry)) {
        if (key === 'name' || key === 'key') out[key] = child;
        else if (key === 'value' || key === 'values') out[key] = safe ? redactSecretObject(child, key) : '';
        else out[key] = isSensitiveBackupKey(key) ? '' : redactSecretObject(child, key);
      }
      return out;
    });
  }
  if (!value || typeof value !== 'object') return '';
  return Object.fromEntries(Object.entries(value).map(([name, child]) => [
    name,
    isSafeBackupHeaderName(name) ? redactSecretObject(child, name) : '',
  ]));
}

function redactSecretObject(value, parentKey = '') {
  if (isBackupHeaderContainerKey(parentKey)) return redactBackupHeaders(value);
  if (Array.isArray(value)) return value.map((child) => redactSecretObject(child, parentKey));
  if (typeof value === 'string') return sanitizeBackupLocation(value);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = isBackupHeaderContainerKey(key)
      ? redactBackupHeaders(child)
      : isSensitiveBackupKey(key) ? '' : redactSecretObject(child, key);
  }
  return out;
}

function redactSettingsText(value) {
  if (value == null || value === '') return value;
  try {
    return JSON.stringify(redactSecretObject(JSON.parse(value)));
  } catch (_) {
    return null;
  }
}

function redactLooseBackupText(value) {
  return sanitizeBackupLocation(String(value || ''))
    .replace(/\bBearer\s+[^\s,;}\]]+/gi, 'Bearer ')
    .replace(
    /((?:authorization|authentication|api[_-]?key|access[_-]?key|credential|password|private[_-]?key|secret|signature|token)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}\]]+)/gi,
    '$1'
    );
}

function redactStructuredBackupText(value) {
  if (value == null || value === '') return value;
  try {
    return JSON.stringify(redactSecretObject(JSON.parse(value)));
  } catch (_) {
    return redactLooseBackupText(value);
  }
}

function quoteSqlIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function backupColumnRedactionPolicy(columnName) {
  const name = String(columnName || '');
  if (isSensitiveBackupKey(name)) return 'secret';
  if (/(?:url|uri|endpoint)/i.test(name)) return 'url';
  if (/(?:json|settings|metadata|result|payload|options|headers|request|response)/i.test(name)) return 'structured';
  if (/(?:^|_)(?:reference_images|extra_images|scenes)(?:$|_)/i.test(name)) return 'structured';
  if (/(?:^|_)(?:error|message|log)(?:$|_)/i.test(name)) return 'loose';
  return null;
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
    throw backupError('SECRET_EXCLUSION_FAILED', 'Secrets could not be safely excluded from the backup snapshot.', error);
  } finally {
    if (db) db.close();
    try { fs.rmSync(rewrittenPath, { force: true }); } catch (_) {}
    try { removeSqliteSidecarsSync(rewrittenPath); } catch (_) {}
  }
  removeSqliteSidecarsSync(snapshotPath);
  sqliteIntegrityCheck(snapshotPath);
  return { excludedValues: excluded, policy: 'excluded' };
}

async function captureBackupView(databasePath, storagePath, storySourcesPath, snapshotPath, limits, options) {
  let freeze;
  let transactionStarted = false;
  try {
    assertOperationNotAborted(options?.signal);
    freeze = new Database(databasePath, { fileMustExist: true });
    freeze.pragma('busy_timeout = 0');
    const journalMode = String(freeze.pragma('journal_mode', { simple: true }) || '').toLowerCase();
    freeze.exec('BEGIN EXCLUSIVE');
    transactionStarted = true;
    await runFaultInjector(options, 'after-backup-freeze-acquired');
    assertOperationNotAborted(options?.signal);
    if (journalMode === 'wal') {
      await createOnlineDatabaseSnapshot(databasePath, snapshotPath);
    } else {
      await createLockedDatabaseSnapshot(databasePath, snapshotPath);
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
      throw backupError('DATABASE_BUSY', 'The SQLite database is in use; stop all writing processes before backup.');
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

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
    table[value] = crc >>> 0;
  }
  return table;
})();

function updateCrc32(current, buffer) {
  let crc = current;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return crc >>> 0;
}

function finishCrc32(current) {
  return (current ^ 0xffffffff) >>> 0;
}

function toSafeNumber(value, code = 'INVALID_ARCHIVE') {
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value) && value >= 0) return value;
  } else if (typeof value === 'bigint' && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(value);
  }
  throw backupError(code, 'The archive uses unsupported numeric sizes or offsets.');
}

function dosDateTime(dateValue) {
  const date = new Date(dateValue || Date.now());
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  return { dosDate, dosTime };
}

async function writeAll(handle, buffer, startPosition) {
  let offset = 0;
  while (offset < buffer.length) {
    const result = await handle.write(buffer, offset, buffer.length - offset, startPosition + offset);
    if (result.bytesWritten <= 0) throw backupError('ARCHIVE_WRITE_FAILED', 'The backup archive could not be written.');
    offset += result.bytesWritten;
  }
  return startPosition + buffer.length;
}

function createLocalZip64Extra() {
  const extra = Buffer.alloc(20);
  extra.writeUInt16LE(0x0001, 0);
  extra.writeUInt16LE(16, 2);
  extra.writeBigUInt64LE(0n, 4);
  extra.writeBigUInt64LE(0n, 12);
  return extra;
}

function createCentralZip64Extra(size, offset) {
  const extra = Buffer.alloc(28);
  extra.writeUInt16LE(0x0001, 0);
  extra.writeUInt16LE(24, 2);
  extra.writeBigUInt64LE(BigInt(size), 4);
  extra.writeBigUInt64LE(BigInt(size), 12);
  extra.writeBigUInt64LE(BigInt(offset), 20);
  return extra;
}

async function writeStoredZipEntry(archiveHandle, position, source, signal) {
  assertOperationNotAborted(signal);
  const nameBuffer = Buffer.from(source.name, 'utf8');
  if (nameBuffer.length > ZIP64_UINT16) {
    throw backupError('UNSAFE_ARCHIVE_PATH', 'A storage path is too long for a ZIP archive.');
  }
  const localOffset = position;
  const localExtra = createLocalZip64Extra();
  const { dosDate, dosTime } = dosDateTime(source.mtimeMs);
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(ZIP_LOCAL_SIGNATURE, 0);
  localHeader.writeUInt16LE(45, 4);
  localHeader.writeUInt16LE(ZIP_UTF8_FLAG, 6);
  localHeader.writeUInt16LE(0, 8);
  localHeader.writeUInt16LE(dosTime, 10);
  localHeader.writeUInt16LE(dosDate, 12);
  localHeader.writeUInt32LE(0, 14);
  localHeader.writeUInt32LE(ZIP64_UINT32, 18);
  localHeader.writeUInt32LE(ZIP64_UINT32, 22);
  localHeader.writeUInt16LE(nameBuffer.length, 26);
  localHeader.writeUInt16LE(localExtra.length, 28);
  position = await writeAll(archiveHandle, localHeader, position);
  position = await writeAll(archiveHandle, nameBuffer, position);
  position = await writeAll(archiveHandle, localExtra, position);

  let crc = 0xffffffff;
  let size = 0;
  const contentHash = source.sha256 ? crypto.createHash('sha256') : null;
  if (source.buffer) {
    crc = updateCrc32(crc, source.buffer);
    if (contentHash) contentHash.update(source.buffer);
    size = source.buffer.length;
    position = await writeAll(archiveHandle, source.buffer, position);
  } else {
    let sourceHandle;
    try {
      sourceHandle = await fsp.open(source.filePath, fs.constants.O_RDONLY);
      const before = await sourceHandle.stat();
      if (!sameFileIdentity(before, source.identity)) {
        throw backupError('STORAGE_CHANGED', 'A source file changed while the backup was being created.');
      }
      const buffer = Buffer.allocUnsafe(1024 * 1024);
      let sourcePosition = 0;
      while (sourcePosition < source.identity.size) {
        assertOperationNotAborted(signal);
        const length = Math.min(buffer.length, source.identity.size - sourcePosition);
        const result = await sourceHandle.read(buffer, 0, length, sourcePosition);
        if (result.bytesRead <= 0) {
          throw backupError('STORAGE_CHANGED', 'A source file changed while the backup was being created.');
        }
        const chunk = buffer.subarray(0, result.bytesRead);
        crc = updateCrc32(crc, chunk);
        if (contentHash) contentHash.update(chunk);
        size += result.bytesRead;
        sourcePosition += result.bytesRead;
        position = await writeAll(archiveHandle, chunk, position);
      }
      const after = await sourceHandle.stat();
      if (size !== source.identity.size || !sameFileIdentity(after, source.identity)) {
        throw backupError('STORAGE_CHANGED', 'A source file changed while the backup was being created.');
      }
    } finally {
      if (sourceHandle) await sourceHandle.close();
    }
  }

  if (contentHash && contentHash.digest('hex') !== source.sha256) {
    throw backupError('BACKUP_DATA_CHANGED', 'A backup data file changed while the backup was being created.');
  }

  assertOperationNotAborted(signal);

  const finalCrc = finishCrc32(crc);
  const crcPatch = Buffer.alloc(4);
  crcPatch.writeUInt32LE(finalCrc, 0);
  await writeAll(archiveHandle, crcPatch, localOffset + 14);
  const sizePatch = Buffer.alloc(16);
  sizePatch.writeBigUInt64LE(BigInt(size), 0);
  sizePatch.writeBigUInt64LE(BigInt(size), 8);
  await writeAll(archiveHandle, sizePatch, localOffset + 30 + nameBuffer.length + 4);
  return {
    position,
    central: { nameBuffer, localOffset, size, crc: finalCrc, dosDate, dosTime },
  };
}

async function writeZip64Archive(tempPath, sources, signal) {
  let handle;
  try {
    assertOperationNotAborted(signal);
    handle = await fsp.open(tempPath, 'wx', 0o600);
    let position = 0;
    const centralEntries = [];
    for (const source of sources) {
      assertOperationNotAborted(signal);
      const result = await writeStoredZipEntry(handle, position, source, signal);
      position = result.position;
      centralEntries.push(result.central);
    }

    const centralOffset = position;
    for (const entry of centralEntries) {
      assertOperationNotAborted(signal);
      const extra = createCentralZip64Extra(entry.size, entry.localOffset);
      const header = Buffer.alloc(46);
      header.writeUInt32LE(ZIP_CENTRAL_SIGNATURE, 0);
      header.writeUInt16LE((3 << 8) | 45, 4);
      header.writeUInt16LE(45, 6);
      header.writeUInt16LE(ZIP_UTF8_FLAG, 8);
      header.writeUInt16LE(0, 10);
      header.writeUInt16LE(entry.dosTime, 12);
      header.writeUInt16LE(entry.dosDate, 14);
      header.writeUInt32LE(entry.crc, 16);
      header.writeUInt32LE(ZIP64_UINT32, 20);
      header.writeUInt32LE(ZIP64_UINT32, 24);
      header.writeUInt16LE(entry.nameBuffer.length, 28);
      header.writeUInt16LE(extra.length, 30);
      header.writeUInt16LE(0, 32);
      header.writeUInt16LE(0, 34);
      header.writeUInt16LE(0, 36);
      header.writeUInt32LE((0o100600 << 16) >>> 0, 38);
      header.writeUInt32LE(ZIP64_UINT32, 42);
      position = await writeAll(handle, header, position);
      position = await writeAll(handle, entry.nameBuffer, position);
      position = await writeAll(handle, extra, position);
    }

    const centralSize = position - centralOffset;
    assertOperationNotAborted(signal);
    const zip64EndOffset = position;
    const zip64End = Buffer.alloc(56);
    zip64End.writeUInt32LE(ZIP64_END_SIGNATURE, 0);
    zip64End.writeBigUInt64LE(44n, 4);
    zip64End.writeUInt16LE((3 << 8) | 45, 12);
    zip64End.writeUInt16LE(45, 14);
    zip64End.writeUInt32LE(0, 16);
    zip64End.writeUInt32LE(0, 20);
    zip64End.writeBigUInt64LE(BigInt(centralEntries.length), 24);
    zip64End.writeBigUInt64LE(BigInt(centralEntries.length), 32);
    zip64End.writeBigUInt64LE(BigInt(centralSize), 40);
    zip64End.writeBigUInt64LE(BigInt(centralOffset), 48);
    position = await writeAll(handle, zip64End, position);

    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(ZIP64_LOCATOR_SIGNATURE, 0);
    locator.writeUInt32LE(0, 4);
    locator.writeBigUInt64LE(BigInt(zip64EndOffset), 8);
    locator.writeUInt32LE(1, 16);
    position = await writeAll(handle, locator, position);

    const end = Buffer.alloc(22);
    end.writeUInt32LE(ZIP_END_SIGNATURE, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(ZIP64_UINT16, 8);
    end.writeUInt16LE(ZIP64_UINT16, 10);
    end.writeUInt32LE(ZIP64_UINT32, 12);
    end.writeUInt32LE(ZIP64_UINT32, 16);
    end.writeUInt16LE(0, 20);
    await writeAll(handle, end, position);
    await handle.sync();
  } catch (error) {
    if (error instanceof DataBackupError) throw error;
    throw backupError('ARCHIVE_WRITE_FAILED', 'The backup archive could not be written.', error);
  } finally {
    if (handle) await handle.close();
  }
}

async function createDataBackup(options) {
  assertOperationNotAborted(options?.signal);
  const databasePath = path.resolve(options?.databasePath || '');
  const storagePath = path.resolve(options?.storagePath || '');
  const storySourcesPath = resolveStorySourcesPath(options);
  const outputPath = path.resolve(options?.outputPath || '');
  const limits = normalizeLimits(options?.limits);
  if (!options?.databasePath || !options?.storagePath || !options?.outputPath) {
    throw backupError('INVALID_ARGUMENT', 'Database, storage, and output locations are required.');
  }
  assertSafeTargetPaths(databasePath, storagePath, storySourcesPath);
  if (
    outputPath === databasePath || isPathInside(storagePath, outputPath) ||
    isPathInside(storySourcesPath, outputPath)
  ) {
    throw backupError('UNSAFE_OUTPUT', 'The backup output must be outside the live data targets.');
  }
  if (await lstatIfExists(outputPath)) {
    throw backupError('OUTPUT_EXISTS', 'The requested backup output already exists.');
  }

  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await assertServiceStopped(options);
  recoverInterruptedMaintenanceSync({
    databasePath,
    storagePath,
    storySourcesPath,
    log: options?.log,
    ownerScope: options?.ownerScope,
  });
  let maintenanceLock;
  try {
    maintenanceLock = await acquireMaintenanceLock(databasePath, 'backup', {
      heartbeatIntervalMs: options?.heartbeatIntervalMs,
      log: options?.log,
      ownerScope: options?.ownerScope,
    });
  } catch (error) {
    if (error instanceof DataBackupError) throw error;
    throw backupError('MAINTENANCE_LOCK_FAILED', 'Backup maintenance lock could not be acquired.', error);
  }
  let workDir = null;
  let snapshotPath = null;
  const tempArchivePath = path.join(path.dirname(outputPath), `.${path.basename(outputPath)}.${randomSuffix()}.tmp`);

  try {
    workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'localminidrama-backup-'));
    assertOperationNotAborted(options?.signal);
    snapshotPath = path.join(workDir, 'database.sqlite');
    await assertServiceStopped(options);
    const sourceDatabaseStat = await fsp.stat(databasePath);
    const snapshotWorkingBytes = sourceDatabaseStat.size * (options?.includeSecrets === true ? 1 : 2);
    if (!Number.isSafeInteger(snapshotWorkingBytes)) {
      throw backupError('SIZE_LIMIT_EXCEEDED', 'The SQLite database is too large to snapshot safely.');
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
    if (databaseStat.size > limits.maxFileBytes) {
      throw backupError('FILE_LIMIT_EXCEEDED', 'The SQLite snapshot exceeds the configured file size limit.');
    }
    const directoryFileCount = storage.files.length + storySources.files.length;
    if (directoryFileCount > limits.maxFiles) {
      throw backupError('FILE_LIMIT_EXCEEDED', 'Backup data contains more files than the configured backup limit.');
    }
    const totalBytes = databaseStat.size + storage.totalBytes + storySources.totalBytes;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxTotalBytes) {
      throw backupError('SIZE_LIMIT_EXCEEDED', 'The database and storage exceed the configured total backup size limit.');
    }
    await assertDiskAllocations(
      [{ targetPath: path.dirname(outputPath), bytes: totalBytes + limits.maxManifestBytes + (directoryFileCount * 256) }],
      limits.diskReserveBytes
    );
    const databaseSha256 = await sha256File(snapshotPath);
    assertOperationNotAborted(options?.signal);
    const createdAt = new Date().toISOString();
    const manifest = {
      formatVersion: FORMAT_VERSION,
      createdAt,
      database: {
        entry: DATABASE_ENTRY,
        sha256: databaseSha256,
        bytes: databaseStat.size,
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
        secretPolicy: security.policy,
      },
    };
    const manifestBuffer = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    if (manifestBuffer.length > limits.maxManifestBytes) {
      throw backupError('MANIFEST_LIMIT_EXCEEDED', 'The generated backup manifest is unexpectedly large.');
    }

    const sources = [
      { name: MANIFEST_ENTRY, buffer: manifestBuffer, mtimeMs: Date.now() },
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
    await writeZip64Archive(tempArchivePath, sources, options?.signal);
    assertOperationNotAborted(options?.signal);
    const archiveStat = await fsp.stat(tempArchivePath);
    if (archiveStat.size > limits.maxArchiveBytes) {
      throw backupError('ARCHIVE_LIMIT_EXCEEDED', 'The resulting backup exceeds the configured archive size limit.');
    }
    await chmodPrivate(tempArchivePath);
    assertOperationNotAborted(options?.signal);
    try {
      await fsp.link(tempArchivePath, outputPath);
      await syncParentDirectories(outputPath);
    } catch (error) {
      if (error.code === 'EEXIST') throw backupError('OUTPUT_EXISTS', 'The requested backup output already exists.');
      throw backupError('OUTPUT_COMMIT_FAILED', 'The backup output could not be created atomically without overwrite.', error);
    }
    await fsp.rm(tempArchivePath, { force: true });
    await chmodPrivate(outputPath);
    return { outputPath, manifest, archiveBytes: archiveStat.size, security };
  } catch (error) {
    if (error instanceof DataBackupError) throw error;
    throw backupError('BACKUP_FAILED', 'The data backup could not be completed.', error);
  } finally {
    await fsp.rm(tempArchivePath, { force: true }).catch(() => {});
    if (workDir) await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
    await releaseMaintenanceLock(maintenanceLock);
  }
}

async function readExactly(handle, length, position) {
  if (!Number.isSafeInteger(length) || length < 0 || !Number.isSafeInteger(position) || position < 0) {
    throw backupError('INVALID_ARCHIVE', 'The ZIP archive contains invalid offsets.');
  }
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const result = await handle.read(buffer, offset, length - offset, position + offset);
    if (result.bytesRead <= 0) {
      throw backupError('INVALID_ARCHIVE', 'The ZIP archive is truncated.');
    }
    offset += result.bytesRead;
  }
  return buffer;
}

function readUInt64Safe(buffer, offset) {
  return toSafeNumber(buffer.readBigUInt64LE(offset));
}

function findEndOfCentralDirectory(tail, tailOffset) {
  for (let index = tail.length - 22; index >= 0; index -= 1) {
    if (tail.readUInt32LE(index) !== ZIP_END_SIGNATURE) continue;
    const commentLength = tail.readUInt16LE(index + 20);
    if (index + 22 + commentLength === tail.length) {
      return { bufferOffset: index, fileOffset: tailOffset + index };
    }
  }
  throw backupError('INVALID_ARCHIVE', 'The file is not a complete ZIP archive.');
}

function readZip64Values(extra, needs) {
  let cursor = 0;
  let zip64 = null;
  while (cursor + 4 <= extra.length) {
    const id = extra.readUInt16LE(cursor);
    const size = extra.readUInt16LE(cursor + 2);
    cursor += 4;
    if (cursor + size > extra.length) {
      throw backupError('INVALID_ARCHIVE', 'The ZIP archive contains a malformed extra field.');
    }
    if (id === 0x0001) {
      if (zip64) throw backupError('INVALID_ARCHIVE', 'The ZIP archive contains duplicate ZIP64 metadata.');
      zip64 = extra.subarray(cursor, cursor + size);
    }
    cursor += size;
  }
  if (cursor !== extra.length) {
    throw backupError('INVALID_ARCHIVE', 'The ZIP archive contains a malformed extra field.');
  }
  if (!Object.values(needs).some(Boolean)) return {};
  if (!zip64) throw backupError('INVALID_ARCHIVE', 'The ZIP archive is missing required ZIP64 metadata.');

  const result = {};
  let offset = 0;
  for (const key of ['uncompressedSize', 'compressedSize', 'localOffset']) {
    if (!needs[key]) continue;
    if (offset + 8 > zip64.length) {
      throw backupError('INVALID_ARCHIVE', 'The ZIP64 metadata is truncated.');
    }
    result[key] = readUInt64Safe(zip64, offset);
    offset += 8;
  }
  if (needs.diskStart) {
    if (offset + 4 > zip64.length) {
      throw backupError('INVALID_ARCHIVE', 'The ZIP64 metadata is truncated.');
    }
    result.diskStart = zip64.readUInt32LE(offset);
  }
  return result;
}

function assertRegularZipEntry(externalAttributes) {
  const unixMode = (externalAttributes >>> 16) & 0xffff;
  const fileType = unixMode & 0xf000;
  const dosDirectory = (externalAttributes & 0x10) !== 0;
  if (dosDirectory || (fileType !== 0 && fileType !== 0x8000)) {
    throw backupError('SYMLINK_REJECTED', 'The ZIP archive contains a link or non-regular file.');
  }
}

async function readArchiveDirectory(archivePath, limits) {
  const archiveStat = await lstatIfExists(archivePath);
  if (!archiveStat || archiveStat.isSymbolicLink() || !archiveStat.isFile()) {
    throw backupError('ARCHIVE_UNAVAILABLE', 'The requested backup archive is unavailable or unsafe.');
  }
  if (archiveStat.size > limits.maxArchiveBytes) {
    throw backupError('ARCHIVE_LIMIT_EXCEEDED', 'The backup archive exceeds the configured size limit.');
  }

  let handle;
  try {
    handle = await fsp.open(archivePath, 'r');
    const openedStat = await handle.stat();
    if (!openedStat.isFile() || openedStat.size !== archiveStat.size || openedStat.dev !== archiveStat.dev || openedStat.ino !== archiveStat.ino) {
      throw backupError('ARCHIVE_CHANGED', 'The backup archive changed while it was being opened.');
    }
    if (openedStat.size < 22) throw backupError('INVALID_ARCHIVE', 'The file is not a complete ZIP archive.');

    const tailLength = Math.min(openedStat.size, 22 + ZIP64_UINT16 + 20);
    const tailOffset = openedStat.size - tailLength;
    const tail = await readExactly(handle, tailLength, tailOffset);
    const endLocation = findEndOfCentralDirectory(tail, tailOffset);
    const end = tail.subarray(endLocation.bufferOffset, endLocation.bufferOffset + 22);
    const diskNumber = end.readUInt16LE(4);
    const centralDisk = end.readUInt16LE(6);
    let entriesOnDisk = end.readUInt16LE(8);
    let entryCount = end.readUInt16LE(10);
    let centralSize = end.readUInt32LE(12);
    let centralOffset = end.readUInt32LE(16);
    if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
      throw backupError('INVALID_ARCHIVE', 'Multi-disk ZIP archives are not supported.');
    }

    const needsZip64 = entryCount === ZIP64_UINT16 || centralSize === ZIP64_UINT32 || centralOffset === ZIP64_UINT32;
    let centralBoundary = endLocation.fileOffset;
    if (needsZip64) {
      const locatorOffset = endLocation.fileOffset - 20;
      if (locatorOffset < 0) throw backupError('INVALID_ARCHIVE', 'The ZIP64 locator is missing.');
      const locator = await readExactly(handle, 20, locatorOffset);
      if (
        locator.readUInt32LE(0) !== ZIP64_LOCATOR_SIGNATURE ||
        locator.readUInt32LE(4) !== 0 ||
        locator.readUInt32LE(16) !== 1
      ) {
        throw backupError('INVALID_ARCHIVE', 'The ZIP64 locator is invalid.');
      }
      const zip64Offset = readUInt64Safe(locator, 8);
      const zip64End = await readExactly(handle, 56, zip64Offset);
      const zip64RecordSize = readUInt64Safe(zip64End, 4);
      if (
        zip64End.readUInt32LE(0) !== ZIP64_END_SIGNATURE ||
        zip64RecordSize !== 44 ||
        zip64Offset + 12 + zip64RecordSize !== locatorOffset
      ) {
        throw backupError('INVALID_ARCHIVE', 'The ZIP64 directory record is invalid.');
      }
      if (zip64End.readUInt32LE(16) !== 0 || zip64End.readUInt32LE(20) !== 0) {
        throw backupError('INVALID_ARCHIVE', 'Multi-disk ZIP archives are not supported.');
      }
      entriesOnDisk = readUInt64Safe(zip64End, 24);
      entryCount = readUInt64Safe(zip64End, 32);
      centralSize = readUInt64Safe(zip64End, 40);
      centralOffset = readUInt64Safe(zip64End, 48);
      if (entriesOnDisk !== entryCount || zip64Offset + 56 > locatorOffset) {
        throw backupError('INVALID_ARCHIVE', 'The ZIP64 directory record is inconsistent.');
      }
      centralBoundary = zip64Offset;
    }

    if (entryCount < 2 || entryCount > limits.maxFiles + 2) {
      throw backupError('FILE_LIMIT_EXCEEDED', 'The backup archive contains an invalid number of files.');
    }
    if (
      centralOffset < 0 ||
      centralSize < 0 ||
      centralOffset + centralSize > centralBoundary ||
      centralOffset + centralSize > openedStat.size
    ) {
      throw backupError('INVALID_ARCHIVE', 'The ZIP central directory points outside the archive.');
    }

    const entries = [];
    const duplicateNames = new Set();
    let position = centralOffset;
    let directoryFileCount = 0;
    let payloadBytes = 0;
    for (let index = 0; index < entryCount; index += 1) {
      if (position + 46 > centralOffset + centralSize) {
        throw backupError('INVALID_ARCHIVE', 'The ZIP central directory is truncated.');
      }
      const header = await readExactly(handle, 46, position);
      if (header.readUInt32LE(0) !== ZIP_CENTRAL_SIGNATURE) {
        throw backupError('INVALID_ARCHIVE', 'The ZIP central directory is malformed.');
      }
      const versionMadeBy = header.readUInt16LE(4);
      const versionNeeded = header.readUInt16LE(6);
      const flags = header.readUInt16LE(8);
      const method = header.readUInt16LE(10);
      const crc = header.readUInt32LE(16);
      let compressedSize = header.readUInt32LE(20);
      let uncompressedSize = header.readUInt32LE(24);
      const nameLength = header.readUInt16LE(28);
      const extraLength = header.readUInt16LE(30);
      const commentLength = header.readUInt16LE(32);
      let diskStart = header.readUInt16LE(34);
      const externalAttributes = header.readUInt32LE(38);
      let localOffset = header.readUInt32LE(42);
      const variableLength = nameLength + extraLength + commentLength;
      if (nameLength === 0 || nameLength > limits.maxPathBytes || position + 46 + variableLength > centralOffset + centralSize) {
        throw backupError('UNSAFE_ARCHIVE_PATH', 'The ZIP archive contains an invalid file name.');
      }
      const variable = await readExactly(handle, variableLength, position + 46);
      const rawName = variable.subarray(0, nameLength);
      const extra = variable.subarray(nameLength, nameLength + extraLength);
      const name = validateArchiveName(rawName.toString('utf8'), rawName, limits);
      const zip64 = readZip64Values(extra, {
        uncompressedSize: uncompressedSize === ZIP64_UINT32,
        compressedSize: compressedSize === ZIP64_UINT32,
        localOffset: localOffset === ZIP64_UINT32,
        diskStart: diskStart === ZIP64_UINT16,
      });
      if (uncompressedSize === ZIP64_UINT32) uncompressedSize = zip64.uncompressedSize;
      if (compressedSize === ZIP64_UINT32) compressedSize = zip64.compressedSize;
      if (localOffset === ZIP64_UINT32) localOffset = zip64.localOffset;
      if (diskStart === ZIP64_UINT16) diskStart = zip64.diskStart;
      if (diskStart !== 0) throw backupError('INVALID_ARCHIVE', 'Multi-disk ZIP archives are not supported.');
      const allowedFlags = ZIP_UTF8_FLAG | ZIP_DATA_DESCRIPTOR_FLAG | (method === 8 ? 0x0006 : 0);
      if ((flags & ~allowedFlags) !== 0 || ![0, 8].includes(method)) {
        throw backupError('UNSUPPORTED_ARCHIVE', 'The ZIP archive uses encryption or an unsupported compression method.');
      }
      assertRegularZipEntry(externalAttributes);
      if (uncompressedSize > limits.maxFileBytes) {
        throw backupError('FILE_LIMIT_EXCEEDED', 'A file in the backup archive exceeds the configured size limit.');
      }
      if (compressedSize > limits.maxArchiveBytes) {
        throw backupError('ARCHIVE_LIMIT_EXCEEDED', 'A compressed ZIP entry exceeds the configured size limit.');
      }
      if (method === 8 && uncompressedSize > 0 && compressedSize === 0) {
        throw backupError('INVALID_ARCHIVE', 'A compressed ZIP entry has an invalid size.');
      }
      if (method === 8 && compressedSize > 0 && uncompressedSize / compressedSize > limits.maxCompressionRatio) {
        throw backupError('COMPRESSION_LIMIT_EXCEEDED', 'A ZIP entry exceeds the configured compression ratio limit.');
      }

      const collisionKey = name.normalize('NFC').toLowerCase();
      if (duplicateNames.has(collisionKey)) {
        throw backupError('DUPLICATE_ARCHIVE_PATH', 'The ZIP archive contains duplicate or colliding file paths.');
      }
      duplicateNames.add(collisionKey);
      if (name.startsWith(STORAGE_PREFIX) || name.startsWith(STORY_SOURCES_PREFIX)) {
        directoryFileCount += 1;
      }
      if (name !== MANIFEST_ENTRY) {
        payloadBytes += uncompressedSize;
        if (!Number.isSafeInteger(payloadBytes) || payloadBytes > limits.maxTotalBytes) {
          throw backupError('SIZE_LIMIT_EXCEEDED', 'The backup archive exceeds the configured total size limit.');
        }
      }
      entries.push({
        name,
        rawName,
        versionMadeBy,
        versionNeeded,
        flags,
        method,
        crc,
        compressedSize,
        uncompressedSize,
        externalAttributes,
        localOffset,
      });
      position += 46 + variableLength;
    }

    if (position !== centralOffset + centralSize || directoryFileCount > limits.maxFiles) {
      throw backupError('INVALID_ARCHIVE', 'The ZIP central directory contains unexpected trailing data.');
    }
    if (!duplicateNames.has(MANIFEST_ENTRY) || !duplicateNames.has(DATABASE_ENTRY)) {
      throw backupError('INVALID_ARCHIVE', 'The backup archive is missing its manifest or database.');
    }

    const ranges = [];
    for (const entry of entries) {
      if (entry.localOffset + 30 > centralOffset) {
        throw backupError('INVALID_ARCHIVE', 'A ZIP entry points outside the file data region.');
      }
      const local = await readExactly(handle, 30, entry.localOffset);
      if (local.readUInt32LE(0) !== ZIP_LOCAL_SIGNATURE) {
        throw backupError('INVALID_ARCHIVE', 'A ZIP local file header is malformed.');
      }
      const localFlags = local.readUInt16LE(6);
      const localMethod = local.readUInt16LE(8);
      const localCrc = local.readUInt32LE(14);
      const localCompressed = local.readUInt32LE(18);
      const localUncompressed = local.readUInt32LE(22);
      const localNameLength = local.readUInt16LE(26);
      const localExtraLength = local.readUInt16LE(28);
      if (localFlags !== entry.flags || localMethod !== entry.method || localNameLength !== entry.rawName.length) {
        throw backupError('INVALID_ARCHIVE', 'ZIP local and central headers do not match.');
      }
      const localName = await readExactly(handle, localNameLength, entry.localOffset + 30);
      if (!localName.equals(entry.rawName)) {
        throw backupError('INVALID_ARCHIVE', 'ZIP local and central file names do not match.');
      }
      const localExtra = await readExactly(
        handle,
        localExtraLength,
        entry.localOffset + 30 + localNameLength
      );
      const localZip64 = readZip64Values(localExtra, {
        uncompressedSize: localUncompressed === ZIP64_UINT32,
        compressedSize: localCompressed === ZIP64_UINT32,
        localOffset: false,
        diskStart: false,
      });
      const resolvedLocalCompressed = localCompressed === ZIP64_UINT32
        ? localZip64.compressedSize
        : localCompressed;
      const resolvedLocalUncompressed = localUncompressed === ZIP64_UINT32
        ? localZip64.uncompressedSize
        : localUncompressed;
      const dataOffset = entry.localOffset + 30 + localNameLength + localExtraLength;
      const dataEnd = dataOffset + entry.compressedSize;
      if (!Number.isSafeInteger(dataEnd) || dataEnd > centralOffset) {
        throw backupError('INVALID_ARCHIVE', 'A ZIP entry points outside the file data region.');
      }
      let rangeEnd = dataEnd;
      if ((entry.flags & ZIP_DATA_DESCRIPTOR_FLAG) !== 0) {
        const marker = await readExactly(handle, 4, rangeEnd);
        const hasSignature = marker.readUInt32LE(0) === ZIP_DATA_DESCRIPTOR_SIGNATURE;
        let descriptorOffset = rangeEnd + (hasSignature ? 4 : 0);
        const usesZip64 = localCompressed === ZIP64_UINT32 || localUncompressed === ZIP64_UINT32 || entry.versionNeeded >= 45;
        const descriptorLength = usesZip64 ? 20 : 12;
        const descriptor = await readExactly(handle, descriptorLength, descriptorOffset);
        const descriptorCrc = descriptor.readUInt32LE(0);
        const descriptorCompressed = usesZip64 ? readUInt64Safe(descriptor, 4) : descriptor.readUInt32LE(4);
        const descriptorUncompressed = usesZip64 ? readUInt64Safe(descriptor, 12) : descriptor.readUInt32LE(8);
        if (
          descriptorCrc !== entry.crc ||
          descriptorCompressed !== entry.compressedSize ||
          descriptorUncompressed !== entry.uncompressedSize
        ) {
          throw backupError('INVALID_ARCHIVE', 'A ZIP data descriptor does not match its directory entry.');
        }
        rangeEnd = descriptorOffset + descriptorLength;
      } else if (
        localCrc !== entry.crc ||
        resolvedLocalCompressed !== entry.compressedSize ||
        resolvedLocalUncompressed !== entry.uncompressedSize
      ) {
        throw backupError('INVALID_ARCHIVE', 'ZIP local and central sizes do not match.');
      }
      if (rangeEnd > centralOffset) {
        throw backupError('INVALID_ARCHIVE', 'A ZIP entry overlaps the central directory.');
      }
      entry.dataOffset = dataOffset;
      entry.rangeEnd = rangeEnd;
      ranges.push({ start: entry.localOffset, end: rangeEnd });
    }
    ranges.sort((a, b) => a.start - b.start);
    for (let index = 1; index < ranges.length; index += 1) {
      if (ranges[index].start < ranges[index - 1].end) {
        throw backupError('INVALID_ARCHIVE', 'ZIP file entries overlap each other.');
      }
    }

    return { handle, entries, archiveStat: openedStat, payloadBytes };
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    if (error instanceof DataBackupError) throw error;
    throw backupError('INVALID_ARCHIVE', 'The backup archive could not be parsed safely.', error);
  }
}

async function consumeArchiveEntry(archive, entry, options = {}) {
  const hash = options.sha256 ? crypto.createHash('sha256') : null;
  const chunks = options.collect ? [] : null;
  let crc = 0xffffffff;
  let bytes = 0;
  const verifier = new Transform({
    transform(chunk, encoding, callback) {
      bytes += chunk.length;
      if (bytes > entry.uncompressedSize) {
        callback(backupError('INVALID_ARCHIVE', 'A ZIP entry expanded beyond its declared size.'));
        return;
      }
      crc = updateCrc32(crc, chunk);
      if (hash) hash.update(chunk);
      if (chunks) chunks.push(Buffer.from(chunk));
      callback(null, chunk);
    },
  });

  let source;
  if (entry.compressedSize === 0) {
    source = Readable.from([]);
  } else {
    source = fs.createReadStream(null, {
      fd: archive.handle.fd,
      autoClose: false,
      start: entry.dataOffset,
      end: entry.dataOffset + entry.compressedSize - 1,
    });
  }
  const streams = [source];
  if (entry.method === 8) streams.push(zlib.createInflateRaw());
  streams.push(verifier);

  if (options.destination) {
    await fsp.mkdir(path.dirname(options.destination), { recursive: true, mode: 0o700 });
    streams.push(fs.createWriteStream(options.destination, { flags: 'wx', mode: 0o600 }));
  } else {
    streams.push(new Writable({ write(chunk, encoding, callback) { callback(); } }));
  }

  try {
    await pipeline(...streams);
  } catch (error) {
    if (error instanceof DataBackupError) throw error;
    throw backupError('INVALID_ARCHIVE', 'A ZIP entry could not be decompressed safely.', error);
  }
  if (bytes !== entry.uncompressedSize || finishCrc32(crc) !== entry.crc) {
    throw backupError('INVALID_ARCHIVE', 'A ZIP entry failed its size or checksum validation.');
  }
  if (options.destination) await chmodPrivate(options.destination);
  return {
    bytes,
    buffer: chunks ? Buffer.concat(chunks, bytes) : null,
    sha256: hash ? hash.digest('hex') : null,
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactKeys(value, keys) {
  return isPlainObject(value) &&
    Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

function isNonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validateManifest(value) {
  const baseKeys = ['formatVersion', 'createdAt', 'database', 'storage', 'fileCount', 'totalBytes'];
  const allowedKeys = new Set([...baseKeys, 'security', 'storySources']);
  if (
    !isPlainObject(value) || baseKeys.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !allowedKeys.has(key))
  ) {
    throw backupError('INVALID_MANIFEST', 'The backup manifest has an invalid structure.');
  }
  if (![LEGACY_FORMAT_VERSION, FORMAT_VERSION].includes(value.formatVersion)) {
    throw backupError('UNSUPPORTED_FORMAT', 'The backup format version is not supported.');
  }
  if (
    typeof value.createdAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.createdAt) ||
    Number.isNaN(Date.parse(value.createdAt)) ||
    new Date(value.createdAt).toISOString() !== value.createdAt
  ) {
    throw backupError('INVALID_MANIFEST', 'The backup manifest has an invalid creation time.');
  }
  if (
    !hasExactKeys(value.database, ['entry', 'sha256', 'bytes']) ||
    value.database.entry !== DATABASE_ENTRY ||
    !/^[a-f0-9]{64}$/.test(value.database.sha256) ||
    !isNonNegativeSafeInteger(value.database.bytes)
  ) {
    throw backupError('INVALID_MANIFEST', 'The backup manifest has invalid database metadata.');
  }
  const storageKeys = value.formatVersion === LEGACY_FORMAT_VERSION
    ? ['entryPrefix', 'fileCount', 'totalBytes']
    : ['entryPrefix', 'fileCount', 'totalBytes', 'sha256'];
  if (
    !hasExactKeys(value.storage, storageKeys) ||
    value.storage.entryPrefix !== STORAGE_PREFIX ||
    !isNonNegativeSafeInteger(value.storage.fileCount) ||
    !isNonNegativeSafeInteger(value.storage.totalBytes) ||
    (value.formatVersion === FORMAT_VERSION && !/^[a-f0-9]{64}$/.test(value.storage.sha256)) ||
    !isNonNegativeSafeInteger(value.fileCount) ||
    !isNonNegativeSafeInteger(value.totalBytes)
  ) {
    throw backupError('INVALID_MANIFEST', 'The backup manifest has invalid file totals.');
  }
  if (value.storySources !== undefined && (
    !hasExactKeys(value.storySources, ['entryPrefix', 'fileCount', 'totalBytes', 'sha256', 'referenceCount']) ||
    value.storySources.entryPrefix !== STORY_SOURCES_PREFIX ||
    !isNonNegativeSafeInteger(value.storySources.fileCount) ||
    !isNonNegativeSafeInteger(value.storySources.totalBytes) ||
    !/^[a-f0-9]{64}$/.test(value.storySources.sha256) ||
    !isNonNegativeSafeInteger(value.storySources.referenceCount)
  )) {
    throw backupError('INVALID_MANIFEST', 'The backup manifest has invalid source-text metadata.');
  }
  const storySourceFileCount = value.storySources?.fileCount || 0;
  const storySourceBytes = value.storySources?.totalBytes || 0;
  if (
    value.fileCount !== value.storage.fileCount + storySourceFileCount + 1 ||
    value.totalBytes !== value.database.bytes + value.storage.totalBytes + storySourceBytes
  ) {
    throw backupError('INVALID_MANIFEST', 'The backup manifest file totals are inconsistent.');
  }
  if (value.security !== undefined && (
    !hasExactKeys(value.security, ['secretPolicy']) ||
    !['excluded', 'included-by-explicit-request'].includes(value.security.secretPolicy)
  )) {
    throw backupError('INVALID_MANIFEST', 'The backup manifest has an invalid secret handling policy.');
  }
  return value;
}

async function readAndValidateManifest(archive, limits) {
  const manifestEntry = archive.entries.find((entry) => entry.name === MANIFEST_ENTRY);
  if (!manifestEntry || manifestEntry.uncompressedSize > limits.maxManifestBytes) {
    throw backupError('INVALID_MANIFEST', 'The backup manifest is missing or too large.');
  }
  const result = await consumeArchiveEntry(archive, manifestEntry, { collect: true });
  let manifest;
  try {
    manifest = JSON.parse(result.buffer.toString('utf8'));
  } catch (error) {
    throw backupError('INVALID_MANIFEST', 'The backup manifest is not valid JSON.', error);
  }
  validateManifest(manifest);

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
    throw backupError('INVALID_MANIFEST', 'The backup manifest does not match the ZIP contents.');
  }
  return { manifest, databaseEntry, storageEntries, storySourceEntries };
}

function makeSiblingPath(targetPath, label) {
  return path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${label}.${Date.now()}.${randomSuffix()}`
  );
}

async function prepareRestoreStages(archivePath, databasePath, storagePath, storySourcesPath, limits) {
  const databaseStage = makeSiblingPath(databasePath, 'restore-incoming');
  const storageStage = makeSiblingPath(storagePath, 'restore-incoming');
  let storySourcesStage = null;
  let archive;
  try {
    await fsp.mkdir(path.dirname(databasePath), { recursive: true });
    await fsp.mkdir(path.dirname(storagePath), { recursive: true });
    await fsp.mkdir(path.dirname(storySourcesPath), { recursive: true });
    archive = await readArchiveDirectory(archivePath, limits);
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
      throw backupError('DATABASE_HASH_MISMATCH', 'The database snapshot does not match the backup manifest.');
    }
    sqliteIntegrityCheck(databaseStage);
    await removeSqliteSidecars(databaseStage, true);

    for (const entry of validated.storageEntries) {
      const relative = entry.name.slice(STORAGE_PREFIX.length);
      const destination = path.resolve(storageStage, ...relative.split('/'));
      if (!isPathInside(storageStage, destination)) {
        throw backupError('UNSAFE_ARCHIVE_PATH', 'A storage entry would escape the restore staging directory.');
      }
      await consumeArchiveEntry(archive, entry, { destination });
    }

    const stagedStorage = await hashStorageFiles(await collectStorageFiles(storageStage, limits));
    if (
      stagedStorage.files.length !== validated.manifest.storage.fileCount ||
      stagedStorage.totalBytes !== validated.manifest.storage.totalBytes
    ) {
      throw backupError('INVALID_ARCHIVE', 'The restored storage files do not match the backup manifest.');
    }
    const expectedNames = validated.storageEntries.map((entry) => entry.name).sort();
    const stagedNames = stagedStorage.files.map((entry) => entry.archiveName).sort();
    if (expectedNames.some((name, index) => name !== stagedNames[index])) {
      throw backupError('INVALID_ARCHIVE', 'The restored storage paths do not match the backup manifest.');
    }
    if (
      validated.manifest.formatVersion >= FORMAT_VERSION &&
      stagedStorage.sha256 !== validated.manifest.storage.sha256
    ) {
      throw backupError('STORAGE_HASH_MISMATCH', 'The storage files do not match the backup manifest.');
    }

    if (replaceStorySources) {
      for (const entry of validated.storySourceEntries) {
        const relative = entry.name.slice(STORY_SOURCES_PREFIX.length);
        const destination = path.resolve(storySourcesStage, ...relative.split('/'));
        if (!isPathInside(storySourcesStage, destination)) {
          throw backupError('UNSAFE_ARCHIVE_PATH', 'A source-text entry would escape the restore staging directory.');
        }
        await consumeArchiveEntry(archive, entry, { destination });
      }
      const stagedStorySources = await hashStorySourceFiles(
        await collectStorySourceFiles(storySourcesStage, limits)
      );
      const expectedSourceNames = validated.storySourceEntries.map((entry) => entry.name).sort();
      const stagedSourceNames = stagedStorySources.files.map((entry) => entry.archiveName).sort();
      if (
        stagedStorySources.files.length !== validated.manifest.storySources.fileCount ||
        stagedStorySources.totalBytes !== validated.manifest.storySources.totalBytes ||
        stagedStorySources.sha256 !== validated.manifest.storySources.sha256 ||
        expectedSourceNames.some((name, index) => name !== stagedSourceNames[index])
      ) {
        throw backupError('SOURCE_TEXT_HASH_MISMATCH', 'Restored source-text files do not match the backup manifest.');
      }
      const referenceCount = validateStorySourceReferences(
        databaseStage,
        storySourcesPath,
        stagedStorySources,
        limits
      );
      if (referenceCount !== validated.manifest.storySources.referenceCount) {
        throw backupError('INVALID_MANIFEST', 'The source-text reference count does not match the backup manifest.');
      }
    } else {
      const currentStorySources = await collectStorySourceFiles(storySourcesPath, limits);
      validateStorySourceReferences(databaseStage, storySourcesPath, currentStorySources, limits);
    }
    const finalArchiveStat = await archive.handle.stat();
    if (!sameFileIdentity(finalArchiveStat, fileIdentity(archive.archiveStat))) {
      throw backupError('ARCHIVE_CHANGED', 'The backup archive changed while it was being validated.');
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
    throw backupError('ARCHIVE_VALIDATION_FAILED', 'The backup archive could not be validated safely.', error);
  } finally {
    if (archive?.handle) await archive.handle.close().catch(() => {});
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
    throw backupError('SERVICE_CHECK_FAILED', 'The configured backend service port is invalid.');
  }
  let listening;
  try {
    listening = await probeTcpPort(
      normalizedProbeHost(options.serviceHost || process.env.HOST || configuredServer.host),
      port,
      options.serviceProbeTimeoutMs || 750
    );
  } catch (error) {
    throw backupError('SERVICE_CHECK_FAILED', 'The backend service state could not be confirmed safely.', error);
  }
  if (listening) {
    throw backupError('SERVICE_RUNNING', 'Stop the LocalMiniDrama backend before data backup or restore.');
  }
}

async function assertTargetDirectorySafe(targetPath) {
  const stat = await lstatIfExists(targetPath);
  if (stat && (stat.isSymbolicLink() || !stat.isDirectory())) {
    throw backupError('UNSAFE_TARGET', 'A configured data directory target is not a real directory.');
  }
}

function isSqliteBusy(error) {
  return error?.code === 'SQLITE_BUSY' || error?.code === 'SQLITE_LOCKED';
}

async function assertDatabaseAvailable(databasePath) {
  const stat = await lstatIfExists(databasePath);
  if (!stat) return;
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw backupError('UNSAFE_TARGET', 'The configured database target is unavailable or unsafe.');
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
      throw backupError('DATABASE_BUSY', 'The SQLite database is in use; stop all processes using it before restoring.');
    }
    if (error instanceof DataBackupError) throw error;
    throw backupError('DATABASE_UNAVAILABLE', 'The target SQLite database could not be opened safely.', error);
  } finally {
    if (db) {
      if (transactionStarted) {
        try { db.exec('ROLLBACK'); } catch (_) {}
      }
      db.close();
    }
  }
}

async function acquireMaintenanceLock(databasePath, operation, options = {}) {
  const { lockPath } = maintenancePaths(databasePath);
  let handle;
  const token = randomSuffix();
  const payload = maintenanceLockPayload(operation, token, new Date(), options.ownerScope);
  try {
    handle = await fsp.open(lockPath, 'wx', 0o600);
    writeMaintenanceLockFd(handle.fd, payload);
    const lock = {
      fd: handle.fd,
      handle,
      lockPath,
      payload,
      released: false,
      token,
    };
    startMaintenanceHeartbeat(lock, options);
    return lock;
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    if (error.code === 'EEXIST') {
      throw backupError('MAINTENANCE_LOCKED', 'Another maintenance operation is active, or startup recovery is required.');
    }
    throw backupError('MAINTENANCE_LOCK_FAILED', 'A maintenance lock could not be created safely.', error);
  }
}

async function releaseMaintenanceLock(lock) {
  if (!lock || lock.released) return;
  lock.released = true;
  if (lock.heartbeatTimer) clearInterval(lock.heartbeatTimer);
  await lock.handle.close().catch(() => {});
  try {
    const current = JSON.parse(await fsp.readFile(lock.lockPath, 'utf8'));
    if (current.token === lock.token && Number(current.pid) === process.pid) {
      await fsp.unlink(lock.lockPath);
    }
  } catch (_) {}
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
    throw backupError('RESTORE_JOURNAL_WRITE_FAILED', 'Restore journal could not be persisted safely.', error);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fsp.rm(tempPath, { force: true }).catch(() => {});
  }
}

async function removeRestoreJournal(databasePath) {
  await fsp.rm(maintenancePaths(databasePath).journalPath, { force: true });
}

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
      throw backupError('DATABASE_BUSY', 'The SQLite database is in use; stop all processes using it before restoring.');
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
      throw backupError('DATABASE_BUSY', 'The SQLite database is in use; stop all processes using it before restoring.');
    }
    if (error instanceof DataBackupError) throw error;
    throw backupError('ROLLBACK_PREPARE_FAILED', 'A rollback copy of the current database could not be created.', error);
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
      throw backupError('TARGET_CHANGED', 'The target database changed while restore validation was in progress.');
    }
    return;
  }
  if (!stat || !sameFileIdentity(stat, expectedIdentity)) {
    throw backupError('TARGET_CHANGED', 'The target database changed while restore validation was in progress.');
  }
}

async function moveDatabaseSidecars(databasePath, oldDatabasePath, moved) {
  for (const suffix of SQLITE_SIDECAR_SUFFIXES) {
    const source = `${databasePath}${suffix}`;
    const stat = await lstatIfExists(source);
    if (!stat) continue;
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw backupError('UNSAFE_TARGET', 'A SQLite sidecar path is not a regular file.');
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
  if (
    storage.files.length !== manifest.storage.fileCount ||
    storage.totalBytes !== manifest.storage.totalBytes ||
    (manifest.formatVersion >= FORMAT_VERSION && storage.sha256 !== manifest.storage.sha256)
  ) {
    throw backupError('RESTORE_VERIFY_FAILED', 'Restored storage failed its final verification.');
  }
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
  if (
    storySources.files.length !== manifest.storySources.fileCount ||
    storySources.totalBytes !== manifest.storySources.totalBytes ||
    storySources.sha256 !== manifest.storySources.sha256 ||
    referenceCount !== manifest.storySources.referenceCount
  ) {
    throw backupError('RESTORE_VERIFY_FAILED', 'Restored source-text data failed its final verification.');
  }
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
    throw backupError('ROLLBACK_FAILED', 'Restore failed and automatic rollback could not fully recover the original targets.', failures[0]);
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
      throw backupError('RESTORE_FINALIZE_FAILED', 'Restore committed but cleanup requires startup recovery.', error);
    }
    if (mutated) {
      if (journal) await setJournalPhase('rolling_back').catch(() => {});
      await rollbackRestoreState(state, databasePath, storagePath, storySourcesPath);
      await removeRestoreJournal(databasePath);
    } else if (journal) {
      await removeRestoreJournal(databasePath);
    }
    if (error instanceof DataBackupError && !mutated) throw error;
    throw backupError('RESTORE_FAILED', 'Restore failed; the original data was restored.', error);
  }
}

async function restoreDataBackup(options) {
  if (options?.confirmed !== true) {
    throw backupError('CONFIRMATION_REQUIRED', 'Restore requires explicit confirmation with --yes.');
  }
  if (!options?.archivePath || !options?.databasePath || !options?.storagePath) {
    throw backupError('INVALID_ARGUMENT', 'Archive, database, and storage locations are required.');
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
      limits
    );
    await assertServiceStopped(options);
    await assertDatabaseAvailable(databasePath);
    return await commitRestore(prepared, databasePath, storagePath, storySourcesPath, limits, options);
  } catch (error) {
    if (error instanceof DataBackupError) throw error;
    throw backupError('RESTORE_FAILED', 'The data restore could not be completed.', error);
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
  createDataBackup,
  maintenancePaths,
  recoverInterruptedMaintenanceSync,
  restoreDataBackup,
  __testing: Object.freeze({
    acquireMaintenanceRecoveryClaimSync,
    releaseMaintenanceRecoveryClaimSync,
  }),
};
