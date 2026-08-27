const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  acquireServiceMaintenanceLockSync,
} = require('../src/services/dataBackupService');

const packageRoot = path.resolve(__dirname, '..');
const scriptPath = path.join(packageRoot, 'scripts', 'recover-maintenance.js');

function loadCli() {
  const backendPackage = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  assert.equal(backendPackage.scripts['maintenance:recover'], 'node scripts/recover-maintenance.js');
  assert.equal(fs.existsSync(scriptPath), true, 'maintenance recovery CLI must exist');
  return require(scriptPath);
}

async function makeWorkspace(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'localminidrama-maintenance-cli-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const storagePath = path.join(root, 'storage');
  const storySourcesPath = path.join(root, 'story_sources');
  await fsp.mkdir(storagePath);
  await fsp.mkdir(storySourcesPath);
  return {
    dataRoot: root,
    databasePath: path.join(root, 'drama.db'),
    storagePath,
    storySourcesPath,
  };
}

test('maintenance recovery CLI resolves every target from an explicit data root', async (t) => {
  const { configuredPaths, parseArguments, resolveDataRoot } = loadCli();
  const workspace = await makeWorkspace(t);
  const args = parseArguments([
    '--data-root', workspace.dataRoot,
    '--inspect',
    '--owner-scope', 'scope',
    '--pid', '42',
    '--yes',
  ]);
  assert.deepEqual(args, {
    confirmed: true,
    inspect: true,
    dataRoot: workspace.dataRoot,
    expectedOwnerScope: 'scope',
    expectedPid: 42,
  });
  assert.deepEqual(configuredPaths(workspace.dataRoot), {
    dataRoot: workspace.dataRoot,
    databasePath: path.join(workspace.dataRoot, 'drama_generator.db'),
    storagePath: path.join(workspace.dataRoot, 'storage'),
    storySourcesPath: path.join(workspace.dataRoot, 'story_sources'),
  });
  assert.equal(resolveDataRoot(workspace.dataRoot), workspace.dataRoot);
  assert.throws(() => resolveDataRoot('relative-data-root'), /绝对路径/);
  assert.throws(() => parseArguments(['--data-root', workspace.dataRoot, '--data-root', workspace.dataRoot]), /不能重复/);

  const paths = configuredPaths(workspace.dataRoot);
  const { payload } = await writeLock(paths.databasePath);
  const result = spawnSync(process.execPath, [scriptPath, '--inspect', '--data-root', workspace.dataRoot], {
    cwd: packageRoot,
    env: { ...process.env, LOCALMINIDRAMA_CONFIG_PATH: path.join(workspace.dataRoot, 'missing-config.yaml') },
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(payload.ownerScope));
  assert.doesNotMatch(result.stdout, new RegExp(payload.token));
});

async function writeLock(databasePath, overrides = {}) {
  const heartbeatAt = overrides.heartbeatAt || new Date(Date.now() - 120000).toISOString();
  const lockPath = `${databasePath}.maintenance.lock`;
  const payload = {
    version: 2,
    pid: 2147483647,
    ownerScope: 'win32:test-host:native',
    operation: 'service',
    token: 'a'.repeat(16),
    createdAt: heartbeatAt,
    heartbeatAt,
    contract: 'exclusive-lease-owner-scope-and-heartbeat-required',
    ...overrides,
  };
  await fsp.writeFile(lockPath, `${JSON.stringify(payload)}\n`, { flag: 'wx' });
  const timestamp = new Date(heartbeatAt);
  await fsp.utimes(lockPath, timestamp, timestamp);
  return { lockPath, payload };
}

test('maintenance recovery inspection never exposes the lease token', async (t) => {
  const { inspectMaintenanceLock } = loadCli();
  const workspace = await makeWorkspace(t);
  const { payload } = await writeLock(workspace.databasePath);

  const inspected = inspectMaintenanceLock(workspace.databasePath);

  assert.deepEqual(inspected, {
    present: true,
    version: payload.version,
    pid: payload.pid,
    ownerScope: payload.ownerScope,
    operation: payload.operation,
    heartbeatAt: payload.heartbeatAt,
  });
  assert.equal(JSON.stringify(inspected).includes(payload.token), false);
});

test('maintenance recovery requires confirmation and the exact inspected owner', async (t) => {
  const { recoverMaintenanceLock } = loadCli();
  const workspace = await makeWorkspace(t);
  const { lockPath, payload } = await writeLock(workspace.databasePath);

  assert.throws(
    () => recoverMaintenanceLock({
      ...workspace,
      expectedOwnerScope: payload.ownerScope,
      expectedPid: payload.pid,
    }),
    (error) => error?.code === 'CONFIRMATION_REQUIRED'
  );
  assert.ok(await fsp.stat(lockPath));

  assert.throws(
    () => recoverMaintenanceLock({
      ...workspace,
      confirmed: true,
      expectedOwnerScope: 'win32:another-host:native',
      expectedPid: payload.pid,
    }),
    (error) => error?.code === 'MAINTENANCE_OWNER_MISMATCH'
  );
  assert.ok(await fsp.stat(lockPath));

  assert.throws(
    () => recoverMaintenanceLock({
      ...workspace,
      confirmed: true,
      expectedOwnerScope: payload.ownerScope,
      expectedPid: payload.pid - 1,
    }),
    (error) => error?.code === 'MAINTENANCE_OWNER_MISMATCH'
  );
  assert.ok(await fsp.stat(lockPath));

});

test('maintenance recovery removes only an exact stale foreign lease', async (t) => {
  const { recoverMaintenanceLock } = loadCli();
  const workspace = await makeWorkspace(t);
  const { lockPath, payload } = await writeLock(workspace.databasePath);

  const result = recoverMaintenanceLock({
    ...workspace,
    confirmed: true,
    expectedOwnerScope: payload.ownerScope,
    expectedPid: payload.pid,
  });

  assert.deepEqual(result, {
    recovered: false,
    ownerScope: payload.ownerScope,
    pid: payload.pid,
  });
  assert.equal(await fsp.stat(lockPath).catch(() => null), null);
});

test('operator recovery reclaims a stale Docker service lock despite a native restore lease', async (t) => {
  const { recoverMaintenanceLock } = loadCli();
  const workspace = await makeWorkspace(t);
  const stale = new Date(Date.now() - 120000);
  const { lockPath, payload } = await writeLock(workspace.databasePath, {
    ownerScope: 'localminidrama-docker-backend',
    pid: 7,
    operation: 'service',
    heartbeatAt: stale.toISOString(),
  });
  const recoveryLockPath = `${workspace.databasePath}.maintenance.recovery.lock`;
  const recoveryPayload = {
    version: 2,
    pid: 14120,
    ownerScope: `win32:${require('node:os').hostname()}:native`,
    operation: 'restore',
    token: 'b'.repeat(16),
    createdAt: stale.toISOString(),
    heartbeatAt: stale.toISOString(),
    contract: 'exclusive-lease-owner-scope-and-heartbeat-required',
  };
  await fsp.writeFile(recoveryLockPath, `${JSON.stringify(recoveryPayload)}\n`, { flag: 'wx' });
  await fsp.utimes(recoveryLockPath, stale, stale);

  const result = recoverMaintenanceLock({
    ...workspace,
    confirmed: true,
    expectedOwnerScope: payload.ownerScope,
    expectedPid: payload.pid,
  });

  assert.deepEqual(result, {
    recovered: false,
    ownerScope: payload.ownerScope,
    pid: payload.pid,
  });
  assert.equal(await fsp.stat(lockPath).catch(() => null), null);
  assert.equal(await fsp.stat(recoveryLockPath).catch(() => null), null);
});

test('maintenance recovery keeps a fresh lease intact', async (t) => {
  const { recoverMaintenanceLock } = loadCli();
  const workspace = await makeWorkspace(t);
  const heartbeatAt = new Date().toISOString();
  const { lockPath, payload } = await writeLock(workspace.databasePath, { heartbeatAt });

  assert.throws(
    () => recoverMaintenanceLock({
      ...workspace,
      confirmed: true,
      expectedOwnerScope: payload.ownerScope,
      expectedPid: payload.pid,
    }),
    (error) => error?.code === 'MAINTENANCE_ACTIVE'
  );
  assert.ok(await fsp.stat(lockPath));
});

test('maintenance recovery never reclaims a stale-looking native lease with a live PID', async (t) => {
  const { recoverMaintenanceLock } = loadCli();
  const workspace = await makeWorkspace(t);
  const guard = acquireServiceMaintenanceLockSync(workspace);
  const lockPath = `${workspace.databasePath}.maintenance.lock`;
  const payload = JSON.parse(await fsp.readFile(lockPath, 'utf8'));
  guard.release();

  const heartbeatAt = new Date(Date.now() - 120000).toISOString();
  await writeLock(workspace.databasePath, {
    ...payload,
    pid: process.pid,
    heartbeatAt,
  });

  assert.throws(
    () => recoverMaintenanceLock({
      ...workspace,
      confirmed: true,
      expectedOwnerScope: payload.ownerScope,
      expectedPid: process.pid,
    }),
    (error) => error?.code === 'MAINTENANCE_ACTIVE'
  );
  assert.ok(await fsp.stat(lockPath));

  const deadPid = 2147483647;
  await fsp.writeFile(lockPath, `${JSON.stringify({
    ...payload,
    pid: deadPid,
    heartbeatAt,
  })}\n`);
  await fsp.utimes(lockPath, new Date(heartbeatAt), new Date(heartbeatAt));
  assert.deepEqual(
    recoverMaintenanceLock({
      ...workspace,
      confirmed: true,
      expectedOwnerScope: payload.ownerScope,
      expectedPid: deadPid,
    }),
    { recovered: false, ownerScope: payload.ownerScope, pid: deadPid }
  );
  assert.equal(await fsp.stat(lockPath).catch(() => null), null);
});

test('操作员可以恢复含方括号的 Linux native 锁', async (t) => {
  const { recoverMaintenanceLock } = loadCli();
  const workspace = await makeWorkspace(t);
  const { lockPath, payload } = await writeLock(workspace.databasePath, {
    ownerScope: 'linux:0123456789ab:pid:[4026532911]',
    pid: 7,
  });

  const result = recoverMaintenanceLock({
    ...workspace,
    confirmed: true,
    expectedOwnerScope: payload.ownerScope,
    expectedPid: payload.pid,
  });

  assert.deepEqual(result, {
    recovered: false,
    ownerScope: payload.ownerScope,
    pid: payload.pid,
  });
  assert.equal(await fsp.stat(lockPath).catch(() => null), null);
});

