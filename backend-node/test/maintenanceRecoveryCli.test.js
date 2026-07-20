const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  acquireServiceMaintenanceLockSync,
} = require('../src/services/dataBackupService');

const packageRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(packageRoot, '..');
const scriptPath = path.join(packageRoot, 'scripts', 'recover-maintenance.js');

function loadCli() {
  const workspacePackage = JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'package.json'), 'utf8'));
  assert.equal(
    workspacePackage.scripts['maintenance:recover'],
    'npm --prefix backend-node run maintenance:recover --'
  );

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
    databasePath: path.join(root, 'drama.db'),
    storagePath,
    storySourcesPath,
  };
}

async function writeLock(databasePath, overrides = {}) {
  const heartbeatAt = overrides.heartbeatAt || new Date(Date.now() - 120000).toISOString();
  const lockPath = `${databasePath}.maintenance.lock`;
  const payload = {
    version: 2,
    pid: 2147483647,
    ownerScope: 'win32:test-host:native',
    operation: 'service',
    token: '0123456789abcdef',
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
});
