const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const dataBackupService = require('../src/services/dataBackupService');
const { DataBackupError } = require('../src/services/dataBackupErrors');
const maintenance = require('../src/services/dataBackupMaintenance');

function expectCode(code) {
  return (error) => error instanceof DataBackupError && error.code === code;
}

function signature(fn) {
  const text = Function.prototype.toString.call(fn);
  const match = text.match(/^(async )?function ([^(]+)\(([^)]*)\)/);
  assert.ok(match, '无法解析函数签名');
  return {
    async: Boolean(match[1]),
    name: match[2].trim(),
    params: match[3].split(',').map((part) => part.trim()).filter(Boolean),
  };
}

async function makeWorkspace(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'lmd-backup-maintenance-'));
  t.after(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });
  const databasePath = path.join(root, 'live', 'drama.db');
  const storagePath = path.join(root, 'live', 'storage');
  const storySourcesPath = path.join(root, 'live', 'story_sources');
  await fsp.mkdir(path.dirname(databasePath), { recursive: true });
  await fsp.mkdir(storagePath, { recursive: true });
  await fsp.mkdir(storySourcesPath, { recursive: true });
  return { root, databasePath, storagePath, storySourcesPath };
}

test('dataBackupService 仍导出同一维护锁/租约/恢复认领函数，备份/恢复入口仍留在服务模块', () => {
  assert.equal(dataBackupService.acquireServiceMaintenanceLockSync, maintenance.acquireServiceMaintenanceLockSync);
  assert.equal(dataBackupService.assertServiceMaintenanceLockActiveSync, maintenance.assertServiceMaintenanceLockActiveSync);
  assert.equal(dataBackupService.createExternalMaintenanceLease, maintenance.createExternalMaintenanceLease);
  assert.equal(dataBackupService.getRuntimeServiceMaintenanceLock, maintenance.getRuntimeServiceMaintenanceLock);
  assert.equal(dataBackupService.maintenancePaths, maintenance.maintenancePaths);
  assert.equal(dataBackupService.nativeMaintenanceOwnerScope, maintenance.nativeMaintenanceOwnerScope);
  assert.equal(dataBackupService.recoverInterruptedMaintenanceSync, maintenance.recoverInterruptedMaintenanceSync);
  assert.equal(dataBackupService.__testing.acquireMaintenanceRecoveryClaimSync, maintenance.acquireMaintenanceRecoveryClaimSync);
  assert.equal(dataBackupService.__testing.releaseMaintenanceRecoveryClaimSync, maintenance.releaseMaintenanceRecoveryClaimSync);
  assert.equal(Object.hasOwn(dataBackupService, 'createDataBackup'), true);
  assert.equal(Object.hasOwn(dataBackupService, 'restoreDataBackup'), true);
  assert.equal(Object.hasOwn(maintenance, 'createDataBackup'), false);
  assert.equal(Object.hasOwn(maintenance, 'restoreDataBackup'), false);
  assert.deepEqual(signature(dataBackupService.createDataBackup), {
    async: true,
    name: 'createDataBackup',
    params: ['options'],
  });
  assert.deepEqual(signature(dataBackupService.restoreDataBackup), {
    async: true,
    name: 'restoreDataBackup',
    params: ['options'],
  });
  assert.deepEqual(signature(maintenance.acquireServiceMaintenanceLockSync), {
    async: false,
    name: 'acquireServiceMaintenanceLockSync',
    params: ['options = {}'],
  });
  assert.deepEqual(signature(maintenance.recoverInterruptedMaintenanceSync), {
    async: false,
    name: 'recoverInterruptedMaintenanceSync',
    params: ['options = {}'],
  });
  assert.deepEqual(Object.keys(maintenance).sort(), [
    'SQLITE_SIDECAR_SUFFIXES',
    'acquireMaintenanceLock',
    'acquireMaintenanceRecoveryClaimSync',
    'acquireServiceMaintenanceLockSync',
    'assertExternalMaintenanceLease',
    'assertServiceMaintenanceLockActiveSync',
    'claimOwnedRegularPathSync',
    'createExternalMaintenanceLease',
    'getRuntimeServiceMaintenanceLock',
    'maintenanceLeaseFileIdentity',
    'maintenancePaths',
    'nativeMaintenanceOwnerScope',
    'recoverInterruptedMaintenanceSync',
    'releaseMaintenanceLock',
    'releaseMaintenanceRecoveryClaimSync',
    'removeOwnedClaimSync',
    'removeSqliteSidecarsSync',
    'renameDurably',
    'renameDurablySync',
    'syncParentDirectories',
    'syncParentDirectoriesSync',
  ]);
});

test('maintenancePaths 与 nativeMaintenanceOwnerScope 按数据库路径和本机身份生成', async (t) => {
  const workspace = await makeWorkspace(t);
  const paths = maintenance.maintenancePaths(workspace.databasePath);
  assert.equal(paths.lockPath, `${path.resolve(workspace.databasePath)}.maintenance.lock`);
  assert.equal(paths.recoveryLockPath, `${path.resolve(workspace.databasePath)}.maintenance.recovery.lock`);
  assert.equal(paths.journalPath, `${path.resolve(workspace.databasePath)}.restore.journal.json`);
  const scope = maintenance.nativeMaintenanceOwnerScope();
  assert.equal(scope.startsWith(`${process.platform}:`), true);
  assert.match(scope, new RegExp(`^${process.platform}:`));
});

test('服务维护锁可复用、释放后删除锁文件，并签发外部租约', async (t) => {
  const workspace = await makeWorkspace(t);
  assert.equal(maintenance.getRuntimeServiceMaintenanceLock(workspace.databasePath), null);
  const guard = maintenance.acquireServiceMaintenanceLockSync(workspace);
  t.after(() => {
    try { guard.release(); } catch (_) {}
  });
  assert.equal(maintenance.acquireServiceMaintenanceLockSync(workspace), guard);
  assert.equal(maintenance.getRuntimeServiceMaintenanceLock(workspace.databasePath), guard);
  const { lockPath } = maintenance.maintenancePaths(workspace.databasePath);
  assert.equal(fs.statSync(lockPath).isFile(), true);
  const lease = maintenance.createExternalMaintenanceLease(guard);
  assert.equal(lease.schema, 'localminidrama.maintenance-lease.v2');
  assert.equal(lease.token, guard.token);
  assert.equal(lease.pid, process.pid);
  assert.deepEqual(maintenance.assertServiceMaintenanceLockActiveSync(guard), lease);
  assert.throws(
    () => maintenance.assertExternalMaintenanceLease(workspace.databasePath, { token: 'nope' }),
    expectCode('MAINTENANCE_LEASE_INVALID'),
  );
  guard.release();
  assert.equal(fs.existsSync(lockPath), false);
  assert.equal(maintenance.getRuntimeServiceMaintenanceLock(workspace.databasePath), null);
  assert.throws(() => maintenance.assertServiceMaintenanceLockActiveSync(guard), expectCode('MAINTENANCE_LEASE_INVALID'));
});

test('无锁无日志时 recoverInterruptedMaintenanceSync 返回未恢复，缺参则失败', async (t) => {
  const workspace = await makeWorkspace(t);
  assert.throws(() => maintenance.recoverInterruptedMaintenanceSync({}), expectCode('INVALID_ARGUMENT'));
  assert.deepEqual(maintenance.recoverInterruptedMaintenanceSync(workspace), { recovered: false });
});

test('恢复认领独占锁文件，释放后可再次恢复探测', async (t) => {
  const workspace = await makeWorkspace(t);
  const claim = maintenance.acquireMaintenanceRecoveryClaimSync(workspace.databasePath, {
    ownerScope: 'localminidrama-test-scope',
  });
  t.after(() => {
    try { maintenance.releaseMaintenanceRecoveryClaimSync(claim); } catch (_) {}
  });
  const { recoveryLockPath } = maintenance.maintenancePaths(workspace.databasePath);
  assert.equal(fs.statSync(recoveryLockPath).isFile(), true);
  assert.throws(
    () => maintenance.acquireMaintenanceRecoveryClaimSync(workspace.databasePath, {
      ownerScope: 'localminidrama-test-scope',
    }),
    expectCode('MAINTENANCE_ACTIVE'),
  );
  maintenance.releaseMaintenanceRecoveryClaimSync(claim);
  assert.equal(fs.existsSync(recoveryLockPath), false);
  assert.deepEqual(maintenance.recoverInterruptedMaintenanceSync({
    ...workspace,
    ownerScope: 'localminidrama-test-scope',
  }), { recovered: false });
});

test('备份/恢复维护锁与服务锁互斥，释放后删除锁文件', async (t) => {
  const workspace = await makeWorkspace(t);
  const guard = maintenance.acquireServiceMaintenanceLockSync(workspace);
  t.after(() => {
    try { guard.release(); } catch (_) {}
  });
  await assert.rejects(
    () => maintenance.acquireMaintenanceLock(workspace.databasePath, 'backup'),
    expectCode('MAINTENANCE_LOCKED'),
  );
  guard.release();
  const lock = await maintenance.acquireMaintenanceLock(workspace.databasePath, 'restore');
  t.after(async () => {
    try { await maintenance.releaseMaintenanceLock(lock); } catch (_) {}
  });
  const { lockPath } = maintenance.maintenancePaths(workspace.databasePath);
  assert.equal(fs.statSync(lockPath).isFile(), true);
  await maintenance.releaseMaintenanceLock(lock);
  assert.equal(fs.existsSync(lockPath), false);
});

test('认领普通文件后按身份删除，并清理 SQLite sidecar', async (t) => {
  const workspace = await makeWorkspace(t);
  const target = path.join(workspace.root, 'owned.txt');
  await fsp.writeFile(target, 'payload');
  const identity = maintenance.maintenanceLeaseFileIdentity(fs.lstatSync(target, { bigint: true }));
  const claim = maintenance.claimOwnedRegularPathSync(target, identity, 'OUTPUT_CLEANUP_FAILED');
  assert.equal(fs.existsSync(target), false);
  assert.equal(fs.readFileSync(claim.claimPath, 'utf8'), 'payload');
  maintenance.removeOwnedClaimSync(claim, identity, 'OUTPUT_CLEANUP_FAILED');
  assert.equal(fs.existsSync(claim.claimPath), false);
  assert.equal(fs.existsSync(claim.directoryPath), false);

  const databasePath = path.join(workspace.root, 'sidecar.db');
  await fsp.writeFile(databasePath, 'db');
  await fsp.writeFile(`${databasePath}-wal`, 'wal');
  await fsp.writeFile(`${databasePath}-shm`, 'shm');
  await fsp.writeFile(`${databasePath}-journal`, 'journal');
  maintenance.removeSqliteSidecarsSync(databasePath);
  assert.equal(fs.existsSync(databasePath), true);
  assert.equal(fs.existsSync(`${databasePath}-wal`), false);
  assert.equal(fs.existsSync(`${databasePath}-shm`), false);
  assert.equal(fs.existsSync(`${databasePath}-journal`), false);
  assert.deepEqual(maintenance.SQLITE_SIDECAR_SUFFIXES, Object.freeze(['-journal', '-wal', '-shm']));

  const source = path.join(workspace.root, 'from.txt');
  const destination = path.join(workspace.root, 'to.txt');
  await fsp.writeFile(source, 'moved');
  maintenance.renameDurablySync(source, destination);
  assert.equal(fs.existsSync(source), false);
  assert.equal(fs.readFileSync(destination, 'utf8'), 'moved');
});
