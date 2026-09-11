'use strict';

// 备份维护锁：独占租约、心跳、恢复认领，以及中断恢复。

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Worker } = require('node:worker_threads');
const { updateMaintenanceHeartbeatFd } = require('./maintenanceLockFile');
const {
  DataBackupError,
  attachCleanupErrors,
  backupError,
} = require('./dataBackupErrors');
const {
  assertSafeTargetPaths,
  validateRestoreJournal,
} = require('./dataBackupValidation');
const {
  lstatIfExistsSync,
  randomSuffix,
  resolveStorySourcesPath,
} = require('./dataBackupPaths');

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

const MAINTENANCE_LOCK_VERSION = 2;
const EXTERNAL_MAINTENANCE_LEASE_SCHEMA = 'localminidrama.maintenance-lease.v2';
const MAX_MAINTENANCE_LEASE_BYTES = 64 * 1024;
const MAINTENANCE_HEARTBEAT_INTERVAL_MS = 5000;
const MAINTENANCE_LOCK_STALE_MS = 30000;
const LEGACY_MAINTENANCE_LOCK_CONTRACT = 'advisory-single-host-all-localminidrama-processes-must-honor';
const MAINTENANCE_LOCK_CONTRACT = 'exclusive-lease-owner-scope-and-heartbeat-required';
const MAINTENANCE_SCOPE_ENV = 'LOCALMINIDRAMA_MAINTENANCE_SCOPE';
const EXPLICIT_MAINTENANCE_SCOPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const LEGACY_DOCKER_OWNER_SCOPE_PATTERN = /^linux:[0-9a-f]{12,64}:pid:\[[1-9][0-9]{0,19}\]$/;
const runtimeServiceLocks = new Map();
let runtimeExitHookInstalled = false;

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
      assertServiceMaintenanceLockPath(lock);
      lock.payload = updateMaintenanceHeartbeatFd(lock.fd, {
        contract: MAINTENANCE_LOCK_CONTRACT,
        pid: process.pid,
        token: lock.token,
      });
      assertServiceMaintenanceLockPath(lock);
    } catch (error) {
      lock.heartbeatError = error instanceof DataBackupError
        ? error
        : backupError('MAINTENANCE_LEASE_INVALID', error);
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
    throw backupError('MAINTENANCE_LOCK_FAILED');
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
    throw backupError('MAINTENANCE_LOCK_INVALID');
  }
  const pid = Number(lock.pid);
  const operation = String(lock.operation || '');
  if (!Number.isInteger(pid) || pid <= 0 || !['service', 'backup', 'restore'].includes(operation)) {
    throw backupError('MAINTENANCE_LOCK_INVALID');
  }

  const version = Number(lock.version);
  if (!Number.isInteger(version) || ![1, MAINTENANCE_LOCK_VERSION].includes(version)) {
    throw backupError('MAINTENANCE_LOCK_INVALID');
  }
  const heartbeatMs = Date.parse(String(lock.heartbeatAt || lock.createdAt || ''));
  if (!Number.isFinite(heartbeatMs)) {
    throw backupError('MAINTENANCE_LOCK_INVALID');
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
      throw backupError('MAINTENANCE_LOCK_FOREIGN');
    }
  } else {
    if (
      typeof lock.token !== 'string' || !/^[0-9a-f]{16}$/.test(lock.token) ||
      typeof lock.ownerScope !== 'string' || !lock.ownerScope ||
      lock.contract !== MAINTENANCE_LOCK_CONTRACT
    ) {
      throw backupError('MAINTENANCE_LOCK_INVALID');
    }
  }

  const configuredStaleMs = Number(options.lockStaleMs);
  const staleMs = Number.isFinite(configuredStaleMs) && configuredStaleMs > 0
    ? configuredStaleMs
    : MAINTENANCE_LOCK_STALE_MS;
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const freshestMs = Math.max(heartbeatMs, Number(lockStat?.mtimeMs) || 0);
  if (nowMs - freshestMs <= staleMs) {
    throw backupError('MAINTENANCE_ACTIVE');
  }

  const currentScope = resolveMaintenanceOwnerScope(options.ownerScope);
  if (version === 1) {
    if (!currentScope.explicit && processIsRunning(pid)) {
      throw backupError('MAINTENANCE_ACTIVE');
    }
    return true;
  }

  if (lock.ownerScope === currentScope.value) {
    // 显式作用域会跨容器 PID 命名空间共享。心跳过期后，本地 PID 匹配
    // （容器重建后常见为 PID 1）不能证明旧持有者仍存活。
    if (!currentScope.explicit && processIsRunning(pid)) {
      throw backupError('MAINTENANCE_ACTIVE');
    }
    return true;
  }

  // 过期的 linux:<hex>:pid:[...] 锁只能由操作员确认后回收。
  // Docker 默认显式作用域不得把容器 hostname 形态的 native 锁当成可自动迁移对象，
  // 否则暂停中的旧容器仍可能与新实例双写同一数据目录。

  // 操作员显式确认后，允许回收过期的跨命名空间服务/恢复租约；自动启动路径仍失败关闭。
  if (
    typeof options.expectedOwnerScope === 'string' && options.expectedOwnerScope &&
    Number.isInteger(options.expectedPid) && options.expectedPid > 0 &&
    lock.ownerScope === options.expectedOwnerScope &&
    Number(lock.pid) === options.expectedPid
  ) {
    return true;
  }

  throw backupError('MAINTENANCE_LOCK_FOREIGN');
}

function readJsonFileSync(filePath, code) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw backupError(code, error);
  }
}

function maintenanceLeaseFileIdentity(stat) {
  return Object.freeze({
    device: stat.dev.toString(10),
    inode: stat.ino.toString(10),
  });
}

function sameMaintenanceLeaseFile(stat, identity) {
  return stat.isFile() && !stat.isSymbolicLink() &&
    stat.dev.toString(10) === identity.device &&
    stat.ino.toString(10) === identity.inode;
}

function assertServiceMaintenanceLockPath(lock) {
  try {
    const descriptorStat = fs.fstatSync(lock.fd, { bigint: true });
    const pathStat = fs.lstatSync(lock.lockPath, { bigint: true });
    if (
      !sameMaintenanceLeaseFile(descriptorStat, lock.identity) ||
      !sameMaintenanceLeaseFile(pathStat, lock.identity)
    ) {
      throw backupError('MAINTENANCE_LEASE_INVALID');
    }
  } catch (error) {
    if (error instanceof DataBackupError) throw error;
    throw backupError('MAINTENANCE_LEASE_INVALID', error);
  }
  return lock;
}

function sameMaintenanceLeaseSnapshot(left, right) {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs;
}

function readExternalMaintenanceLeaseSync(lockPath, identity) {
  let lastInstability = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let fd;
    let unstable = false;
    try {
      fd = fs.openSync(lockPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const descriptorBefore = fs.fstatSync(fd, { bigint: true });
      const pathBefore = fs.lstatSync(lockPath, { bigint: true });
      if (
        !sameMaintenanceLeaseFile(descriptorBefore, identity) ||
        !sameMaintenanceLeaseFile(pathBefore, identity)
      ) {
        throw backupError('MAINTENANCE_LEASE_INVALID');
      }
      if (
        descriptorBefore.size <= 0n ||
        descriptorBefore.size > BigInt(MAX_MAINTENANCE_LEASE_BYTES)
      ) {
        throw backupError('MAINTENANCE_LEASE_INVALID');
      }
      if (!sameMaintenanceLeaseSnapshot(descriptorBefore, pathBefore)) {
        unstable = true;
        lastInstability = '读取前租约已变化。';
        continue;
      }

      const data = Buffer.alloc(Number(descriptorBefore.size));
      let offset = 0;
      while (offset < data.length) {
        const bytesRead = fs.readSync(fd, data, offset, data.length - offset, offset);
        if (bytesRead === 0) {
          throw backupError('MAINTENANCE_LEASE_INVALID');
        }
        offset += bytesRead;
      }
      if (fs.readSync(fd, Buffer.alloc(1), 0, 1, data.length) !== 0) {
        throw backupError('MAINTENANCE_LEASE_INVALID');
      }

      const descriptorAfter = fs.fstatSync(fd, { bigint: true });
      const pathAfter = fs.lstatSync(lockPath, { bigint: true });
      if (
        !sameMaintenanceLeaseFile(descriptorAfter, identity) ||
        !sameMaintenanceLeaseFile(pathAfter, identity)
      ) {
        throw backupError('MAINTENANCE_LEASE_INVALID');
      }
      if (
        !sameMaintenanceLeaseSnapshot(descriptorBefore, descriptorAfter) ||
        !sameMaintenanceLeaseSnapshot(descriptorAfter, pathAfter)
      ) {
        unstable = true;
        lastInstability = '读取中租约已变化。';
        continue;
      }
      try {
        return JSON.parse(data.toString('utf8'));
      } catch (error) {
        throw backupError('MAINTENANCE_LEASE_INVALID', error);
      }
    } catch (error) {
      if (error instanceof DataBackupError) throw error;
      throw backupError('MAINTENANCE_LEASE_INVALID', error);
    } finally {
      if (fd != null) {
        try { fs.closeSync(fd); } catch (_) {}
      }
    }
    if (!unstable) break;
  }
  throw backupError(
    'MAINTENANCE_LEASE_INVALID',
    lastInstability || '无法一致读取外部维护租约。'
  );
}

function restoreRegularClaimWithoutOverwriteSync(claimPath, targetPath, identity) {
  const claimStat = fs.lstatSync(claimPath, { bigint: true });
  if (!sameMaintenanceLeaseFile(claimStat, identity)) return false;
  fs.linkSync(claimPath, targetPath);
  const restoredStat = fs.lstatSync(targetPath, { bigint: true });
  if (!sameMaintenanceLeaseFile(restoredStat, identity)) {
    throw backupError('PATH_CLAIM_RESTORE_FAILED');
  }
  fs.rmSync(claimPath);
  syncParentDirectoriesSync(claimPath, targetPath);
  return true;
}

function maintenanceClaimReplacementType(stat) {
  if (stat.isSymbolicLink()) return 'symbolic-link';
  if (stat.isDirectory()) return 'directory';
  return 'unsupported';
}

function writeMaintenanceQuarantineMarkerSync(targetPath, claim, claimStat) {
  const payload = {
    schema: 'localminidrama.maintenance-quarantine.v1',
    claimDirectory: path.basename(claim.directoryPath),
    claimEntry: path.basename(claim.claimPath),
    replacementType: maintenanceClaimReplacementType(claimStat),
    contract: 'manual-inspection-required',
  };
  let fd;
  let primaryError = null;
  try {
    fd = fs.openSync(targetPath, 'wx', 0o600);
    writeMaintenanceLockFd(fd, payload);
  } catch (error) {
    if (fd == null && error.code === 'EEXIST') return false;
    primaryError = error;
  }
  if (fd != null) {
    try {
      fs.closeSync(fd);
    } catch (error) {
      if (!primaryError) primaryError = error;
    }
  }
  if (primaryError) throw primaryError;
  syncParentDirectoriesSync(targetPath);
  return true;
}

function createPrivateClaimSync(targetPath, code) {
  let directoryPath;
  try {
    directoryPath = fs.mkdtempSync(path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.claim-`));
    try { fs.chmodSync(directoryPath, 0o700); } catch (error) {
      if (!['ENOSYS', 'ENOTSUP', 'EPERM', 'EINVAL'].includes(error.code)) throw error;
    }
    const directoryStat = fs.lstatSync(directoryPath, { bigint: true });
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) throw new Error('私有认领目录无效。');
    return {
      claimPath: path.join(directoryPath, 'owned'),
      directoryIdentity: maintenanceLeaseFileIdentity(directoryStat),
      directoryPath,
    };
  } catch (error) {
    if (directoryPath) {
      try { fs.rmdirSync(directoryPath); } catch (_) {}
    }
    throw backupError(code, error);
  }
}

function sameMaintenanceLeaseDirectory(stat, identity) {
  return stat.isDirectory() && !stat.isSymbolicLink() &&
    stat.dev.toString(10) === identity.device &&
    stat.ino.toString(10) === identity.inode;
}

function removePrivateClaimDirectorySync(claim) {
  const directoryStat = fs.lstatSync(claim.directoryPath, { bigint: true });
  if (!sameMaintenanceLeaseDirectory(directoryStat, claim.directoryIdentity)) {
    throw new Error('私有认领目录身份已变化。');
  }
  fs.rmdirSync(claim.directoryPath);
  syncParentDirectoriesSync(claim.directoryPath);
}

function claimOwnedRegularPathSync(targetPath, identity, code) {
  const claim = createPrivateClaimSync(targetPath, code);
  try {
    renameDurablySync(targetPath, claim.claimPath);
  } catch (error) {
    try { removePrivateClaimDirectorySync(claim); } catch (_) {}
    throw backupError(code, error);
  }

  let claimStat;
  try {
    claimStat = fs.lstatSync(claim.claimPath, { bigint: true });
  } catch (error) {
    throw backupError(code, error);
  }
  if (sameMaintenanceLeaseFile(claimStat, identity)) return claim;

  const replacementIdentity = claimStat.isFile() && !claimStat.isSymbolicLink()
    ? maintenanceLeaseFileIdentity(claimStat)
    : null;
  let restoreError = null;
  if (replacementIdentity) {
    try {
      restoreRegularClaimWithoutOverwriteSync(claim.claimPath, targetPath, replacementIdentity);
      removePrivateClaimDirectorySync(claim);
    } catch (error) {
      restoreError = error;
    }
  } else {
    try {
      writeMaintenanceQuarantineMarkerSync(targetPath, claim, claimStat);
    } catch (error) {
      restoreError = error;
    }
  }
  throw backupError(code, restoreError || undefined);
}

function removeOwnedClaimSync(claim, identity, code) {
  try {
    const directoryStat = fs.lstatSync(claim.directoryPath, { bigint: true });
    if (!sameMaintenanceLeaseDirectory(directoryStat, claim.directoryIdentity)) {
      throw new Error('私有认领目录身份已变化。');
    }
    const finalStat = fs.lstatSync(claim.claimPath, { bigint: true });
    if (!sameMaintenanceLeaseFile(finalStat, identity)) throw new Error('私有认领文件身份已变化。');
    // 随机 0700 目录能排除其他操作系统身份。同一账户下的进程仍处于本地操作者
    // 信任边界内，可以改动该目录。
    fs.rmSync(claim.claimPath);
    removePrivateClaimDirectorySync(claim);
  } catch (error) {
    throw backupError(code, error);
  }
}

function assertExternalMaintenanceLeaseState(lockPath, value) {
  const persisted = readExternalMaintenanceLeaseSync(lockPath, value);
  for (const field of ['contract', 'ownerScope', 'pid', 'token', 'version']) {
    if (persisted?.[field] !== value[field]) {
      throw backupError('MAINTENANCE_LEASE_INVALID');
    }
  }
  if (persisted.operation !== 'service') {
    throw backupError('MAINTENANCE_LEASE_INVALID');
  }
  const createdAt = Date.parse(String(persisted.createdAt || ''));
  const heartbeatAt = Date.parse(String(persisted.heartbeatAt || ''));
  const now = Date.now();
  if (
    !Number.isFinite(createdAt) || !Number.isFinite(heartbeatAt) ||
    heartbeatAt < createdAt || now - heartbeatAt > MAINTENANCE_LOCK_STALE_MS ||
    heartbeatAt - now > MAINTENANCE_LOCK_STALE_MS
  ) {
    throw backupError('MAINTENANCE_LEASE_INVALID');
  }
  return value;
}

function assertExternalMaintenanceLease(databasePath, value) {
  const expectedKeys = ['contract', 'device', 'inode', 'ownerScope', 'pid', 'schema', 'token', 'version'];
  if (
    !value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).sort().join('\0') !== expectedKeys.join('\0') ||
    value.schema !== EXTERNAL_MAINTENANCE_LEASE_SCHEMA ||
    value.contract !== MAINTENANCE_LOCK_CONTRACT ||
    value.version !== MAINTENANCE_LOCK_VERSION ||
    typeof value.token !== 'string' || !/^[0-9a-f]{16}$/.test(value.token) ||
    typeof value.device !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value.device) ||
    typeof value.inode !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value.inode) ||
    typeof value.ownerScope !== 'string' || !value.ownerScope || value.ownerScope.length > 512 ||
    !Number.isSafeInteger(value.pid) || value.pid <= 0
  ) {
    throw backupError('MAINTENANCE_LEASE_INVALID');
  }

  const { lockPath } = maintenancePaths(databasePath);
  return assertExternalMaintenanceLeaseState(lockPath, value);
}

function removeSqliteSidecarsSync(databasePath) {
  for (const suffix of SQLITE_SIDECAR_SUFFIXES) fs.rmSync(`${databasePath}${suffix}`, { force: true });
}

function acquireMaintenanceRecoveryClaimSync(databasePath, options = {}) {
  const { recoveryLockPath } = maintenancePaths(databasePath);
  fs.mkdirSync(path.dirname(recoveryLockPath), { recursive: true });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const token = randomSuffix();
    // 必须传未解析的 ownerScope。原生 Linux pid 命名空间含方括号，不能当作显式作用域。
    const payload = maintenanceLockPayload('restore', token, new Date(), options.ownerScope);
    let fd;
    try {
      fd = fs.openSync(recoveryLockPath, 'wx', 0o600);
      writeMaintenanceLockFd(fd, payload);
      const claim = {
        fd,
        identity: maintenanceLeaseFileIdentity(fs.fstatSync(fd, { bigint: true })),
        lockPath: recoveryLockPath,
        payload,
        token,
        released: false,
      };
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
        throw backupError('MAINTENANCE_LOCK_FAILED', error);
      }

      const claimStat = lstatIfExistsSync(recoveryLockPath, { bigint: true });
      if (!claimStat) continue;
      if (claimStat.isSymbolicLink() || !claimStat.isFile()) {
        throw backupError('MAINTENANCE_LOCK_INVALID');
      }
      const current = readJsonFileSync(recoveryLockPath, 'MAINTENANCE_LOCK_INVALID');
      // 回收恢复租约时不得把原生 pid 命名空间当作显式作用域；过期租约按自身 owner/pid 确认。
      assertMaintenanceLockRecoverable(current, claimStat, {
        ownerScope: options.ownerScope,
        expectedOwnerScope: current?.ownerScope,
        expectedPid: Number(current?.pid),
        lockStaleMs: options.lockStaleMs,
        nowMs: options.nowMs,
      });

      const staleIdentity = maintenanceLeaseFileIdentity(claimStat);
      let staleClaim;
      try {
        staleClaim = claimOwnedRegularPathSync(recoveryLockPath, staleIdentity, 'MAINTENANCE_ACTIVE');
      } catch (claimError) {
        if (claimError?.cause?.code === 'ENOENT') continue;
        throw claimError;
      }
      removeOwnedClaimSync(staleClaim, staleIdentity, 'MAINTENANCE_LOCK_FAILED');
    }
  }

  throw backupError('MAINTENANCE_ACTIVE');
}

function releaseMaintenanceRecoveryClaimSync(claim) {
  if (!claim || claim.released) return;
  claim.released = true;
  stopMaintenanceRecoveryHeartbeat(claim);
  let ownedClaim = null;
  let primaryError = null;
  const cleanupErrors = [];
  let descriptorValidated = false;
  try {
    const descriptorStat = fs.fstatSync(claim.fd, { bigint: true });
    if (!claim.identity || !sameMaintenanceLeaseFile(descriptorStat, claim.identity)) {
      throw backupError('MAINTENANCE_LOCK_RELEASE_FAILED');
    }
    descriptorValidated = true;
  } catch (error) {
    primaryError = error instanceof DataBackupError && error.code === 'MAINTENANCE_LOCK_RELEASE_FAILED'
      ? error
      : backupError('MAINTENANCE_LOCK_RELEASE_FAILED', error);
  }
  // Windows 主机上的 Docker 绑定挂载会推迟对仍打开文件的重命名。下面的原子认领
  // 在关闭该描述符后仍会核验持久化文件身份。
  let descriptorClosed = false;
  try {
    fs.closeSync(claim.fd);
    descriptorClosed = true;
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (!primaryError && descriptorValidated && descriptorClosed) {
    try {
      ownedClaim = claimOwnedRegularPathSync(claim.lockPath, claim.identity, 'MAINTENANCE_LOCK_RELEASE_FAILED');
    } catch (error) {
      primaryError = error instanceof DataBackupError && error.code === 'MAINTENANCE_LOCK_RELEASE_FAILED'
        ? error
        : backupError('MAINTENANCE_LOCK_RELEASE_FAILED', error);
    }
  }
  if (ownedClaim) {
    try {
      removeOwnedClaimSync(ownedClaim, claim.identity, 'MAINTENANCE_LOCK_RELEASE_FAILED');
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (!primaryError && cleanupErrors.length > 0) {
    primaryError = backupError('MAINTENANCE_LOCK_RELEASE_FAILED', cleanupErrors.shift());
  }
  if (primaryError) throw attachCleanupErrors(primaryError, cleanupErrors);
}

function recoverInterruptedMaintenanceSync(options = {}) {
  if (!options.databasePath || !options.storagePath) {
    throw backupError('INVALID_ARGUMENT');
  }
  const expectsOwner = options.expectedOwnerScope !== undefined || options.expectedPid !== undefined;
  if (expectsOwner && (
    typeof options.expectedOwnerScope !== 'string' || !options.expectedOwnerScope ||
    !Number.isInteger(options.expectedPid) || options.expectedPid <= 0
  )) {
    throw backupError('INVALID_ARGUMENT');
  }
  const databasePath = path.resolve(options.databasePath);
  const storagePath = path.resolve(options.storagePath);
  const storySourcesPath = resolveStorySourcesPath(options);
  assertSafeTargetPaths(databasePath, storagePath, storySourcesPath);
  const recoveryClaim = acquireMaintenanceRecoveryClaimSync(databasePath, options);
  const { lockPath, journalPath } = maintenancePaths(databasePath);
  let recoveryFailed = false;
  let recoveryError = null;
  try {
    const lockStat = lstatIfExistsSync(lockPath);
    if (lockStat) {
      if (lockStat.isSymbolicLink() || !lockStat.isFile()) {
        throw backupError('MAINTENANCE_LOCK_INVALID');
      }
      const lock = readJsonFileSync(lockPath, 'MAINTENANCE_LOCK_INVALID');
      assertMaintenanceLockRecoverable(lock, lockStat, options);
      if (expectsOwner && (
        lock.ownerScope !== options.expectedOwnerScope ||
        Number(lock.pid) !== options.expectedPid
      )) {
        throw backupError('MAINTENANCE_OWNER_MISMATCH');
      }
      if (
        expectsOwner && lock.ownerScope === nativeMaintenanceOwnerScope() &&
        processIsRunning(Number(lock.pid))
      ) {
        throw backupError('MAINTENANCE_ACTIVE');
      }
    } else if (expectsOwner) {
      throw backupError('MAINTENANCE_LOCK_MISSING');
    }

    const journalStat = lstatIfExistsSync(journalPath);
    if (!journalStat) {
      if (lockStat) fs.rmSync(lockPath, { force: true });
      return { recovered: false };
    }
    if (journalStat.isSymbolicLink() || !journalStat.isFile()) {
      throw backupError('INVALID_RESTORE_JOURNAL');
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
      throw backupError('RESTORE_RECOVERY_FAILED', error);
    }
  } catch (error) {
    recoveryFailed = true;
    recoveryError = error;
    throw error;
  } finally {
    try {
      releaseMaintenanceRecoveryClaimSync(recoveryClaim);
    } catch (releaseError) {
      if (!recoveryFailed) throw releaseError;
      try { attachCleanupErrors(recoveryError, [releaseError]); } catch (_) {}
    }
  }
}

function releaseServiceMaintenanceLock(lock) {
  if (!lock || lock.released) return;
  lock.released = true;
  if (lock.heartbeatTimer) clearInterval(lock.heartbeatTimer);
  runtimeServiceLocks.delete(lock.lockPath);
  let claim = null;
  let primaryError = lock.heartbeatError
    ? backupError('MAINTENANCE_LOCK_RELEASE_FAILED', lock.heartbeatError)
    : null;
  const cleanupErrors = [];
  let descriptorValidated = false;
  try {
    if (primaryError) throw primaryError;
    const descriptorStat = fs.fstatSync(lock.fd, { bigint: true });
    const current = readExternalMaintenanceLeaseSync(lock.lockPath, lock.identity);
    if (!sameMaintenanceLeaseFile(descriptorStat, lock.identity) || current.token !== lock.token || Number(current.pid) !== process.pid) {
      throw backupError('MAINTENANCE_LOCK_RELEASE_FAILED');
    }
    descriptorValidated = true;
  } catch (error) {
    if (!primaryError) {
      primaryError = error instanceof DataBackupError && error.code === 'MAINTENANCE_LOCK_RELEASE_FAILED'
        ? error
        : backupError('MAINTENANCE_LOCK_RELEASE_FAILED', error);
    } else if (error !== primaryError) {
      cleanupErrors.push(error);
    }
  }
  // 与恢复租约相同：先关闭描述符再认领，以兼容 Docker 绑定挂载。
  let descriptorClosed = false;
  try {
    fs.closeSync(lock.fd);
    descriptorClosed = true;
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (!primaryError && descriptorValidated && descriptorClosed) {
    try {
      claim = claimOwnedRegularPathSync(lock.lockPath, lock.identity, 'MAINTENANCE_LOCK_RELEASE_FAILED');
    } catch (error) {
      primaryError = error instanceof DataBackupError && error.code === 'MAINTENANCE_LOCK_RELEASE_FAILED'
        ? error
        : backupError('MAINTENANCE_LOCK_RELEASE_FAILED', error);
    }
  }
  if (claim) {
    try {
      removeOwnedClaimSync(claim, lock.identity, 'MAINTENANCE_LOCK_RELEASE_FAILED');
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (!primaryError && cleanupErrors.length > 0) {
    const cleanupError = cleanupErrors.shift();
    primaryError = cleanupError instanceof DataBackupError && cleanupError.code === 'MAINTENANCE_LOCK_RELEASE_FAILED'
      ? cleanupError
      : backupError('MAINTENANCE_LOCK_RELEASE_FAILED', cleanupError);
  }
  if (primaryError) throw attachCleanupErrors(primaryError, cleanupErrors);
}

function abandonServiceMaintenanceLock(lock) {
  if (!lock || lock.released) return;
  lock.released = true;
  if (lock.heartbeatTimer) clearInterval(lock.heartbeatTimer);
  runtimeServiceLocks.delete(lock.lockPath);
  try { fs.closeSync(lock.fd); } catch (_) {}
}

function releaseRuntimeServiceLocksOnExit() {
  let failureCount = 0;
  for (const active of [...runtimeServiceLocks.values()]) {
    try {
      if (active.externalLeaseIssued) abandonServiceMaintenanceLock(active);
      else releaseServiceMaintenanceLock(active);
    } catch (_) {
      failureCount += 1;
    }
  }
  if (failureCount > 0) {
    try {
      fs.writeSync(2, `Maintenance guard cleanup failed for ${failureCount} lock(s); persistent evidence was retained.\n`);
    } catch (_) {}
  }
}

function serviceMaintenanceLease(lock) {
  const payload = lock?.payload;
  if (
    !lock || lock.released || lock.heartbeatError || !payload || payload.version !== MAINTENANCE_LOCK_VERSION ||
    payload.operation !== 'service' || payload.contract !== MAINTENANCE_LOCK_CONTRACT ||
    typeof payload.token !== 'string' || !/^[0-9a-f]{16}$/.test(payload.token) ||
    typeof payload.ownerScope !== 'string' || !payload.ownerScope ||
    !Number.isSafeInteger(payload.pid) || payload.pid <= 0
  ) {
    throw backupError('MAINTENANCE_LEASE_INVALID');
  }
  assertServiceMaintenanceLockPath(lock);
  let descriptorStat;
  try {
    descriptorStat = fs.fstatSync(lock.fd, { bigint: true });
  } catch (error) {
    throw backupError('MAINTENANCE_LEASE_INVALID', error);
  }
  const identity = maintenanceLeaseFileIdentity(descriptorStat);
  if (!sameMaintenanceLeaseFile(descriptorStat, lock.identity || identity)) {
    throw backupError('MAINTENANCE_LEASE_INVALID');
  }
  const lease = Object.freeze({
    schema: EXTERNAL_MAINTENANCE_LEASE_SCHEMA,
    contract: payload.contract,
    device: identity.device,
    inode: identity.inode,
    ownerScope: payload.ownerScope,
    pid: payload.pid,
    token: payload.token,
    version: payload.version,
  });
  return assertExternalMaintenanceLeaseState(lock.lockPath, lease);
}

function assertServiceMaintenanceLockActiveSync(lock) {
  return serviceMaintenanceLease(lock);
}

function createExternalMaintenanceLease(lock) {
  const validatedLease = serviceMaintenanceLease(lock);
  lock.externalLeaseIssued = true;
  return validatedLease;
}

function getRuntimeServiceMaintenanceLock(databasePath) {
  if (!databasePath) return null;
  const { lockPath } = maintenancePaths(path.resolve(databasePath));
  const existing = runtimeServiceLocks.get(lockPath);
  if (!existing || existing.released) return null;
  return existing;
}

function acquireServiceMaintenanceLockSync(options = {}) {
  const databasePath = path.resolve(options.databasePath || '');
  const storagePath = path.resolve(options.storagePath || '');
  const storySourcesPath = resolveStorySourcesPath(options);
  if (!options.databasePath || !options.storagePath) {
    throw backupError('INVALID_ARGUMENT');
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
      throw backupError('MAINTENANCE_LOCKED');
    }
    throw backupError('MAINTENANCE_LOCK_FAILED', error);
  }
  const lock = {
    fd,
    identity: maintenanceLeaseFileIdentity(fs.fstatSync(fd, { bigint: true })),
    lockPath,
    payload,
    token,
    released: false,
    abandon() { abandonServiceMaintenanceLock(lock); },
    release() { releaseServiceMaintenanceLock(lock); },
  };
  runtimeServiceLocks.set(lockPath, lock);
  startMaintenanceHeartbeat(lock, options);
  if (!runtimeExitHookInstalled) {
    runtimeExitHookInstalled = true;
    process.once('exit', releaseRuntimeServiceLocksOnExit);
  }
  return lock;
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
      throw backupError('MAINTENANCE_LOCKED');
    }
    throw backupError('MAINTENANCE_LOCK_FAILED', error);
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

module.exports = {
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
  syncParentDirectoriesSync,
};
