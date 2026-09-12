const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { once } = require('node:events');
const { spawn, spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');
const AdmZip = require('adm-zip');

const BACKUP_CLI = path.join(__dirname, '..', 'scripts', 'backup-data.js');
const MARKER_SCHEMA = 'localminidrama.backup-publication-result.v1';

async function makeCliWorkspace(t, label) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'localminidrama-backup-cli-'));
  t.after(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });
  const dataRoot = path.join(root, 'data');
  const storagePath = path.join(dataRoot, 'storage');
  const storySourcesPath = path.join(dataRoot, 'story_sources');
  await fsp.mkdir(storagePath, { recursive: true });
  await fsp.mkdir(storySourcesPath, { recursive: true });
  await fsp.writeFile(path.join(storagePath, 'asset.txt'), `${label}-asset`);
  const databasePath = path.join(dataRoot, 'drama_generator.db');
  const db = new Database(databasePath);
  db.exec('CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
  db.prepare('INSERT INTO records (value) VALUES (?)').run(label);
  db.close();
  return {
    root,
    dataRoot,
    publicationPath: path.join(root, 'checkpoint', 'data.zip'),
    temporaryPath: path.join(root, 'checkpoint', '.data.zip.retained.tmp'),
  };
}

async function unusedPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function assertCanonicalMarker(line, phase, operationId) {
  const marker = JSON.parse(line);
  assert.deepEqual(Object.keys(marker), [
    'schema',
    'operation_id',
    'phase',
    'publication_file',
    'archive_sha256',
    'archive_bytes',
    'filesystem_identity',
    'format_version',
  ]);
  assert.equal(line, JSON.stringify(marker));
  assert.equal(marker.schema, MARKER_SCHEMA);
  assert.equal(marker.operation_id, operationId);
  assert.equal(marker.phase, phase);
  assert.equal(marker.publication_file, 'data.zip');
  assert.match(marker.archive_sha256, /^[a-f0-9]{64}$/);
  assert.match(marker.archive_bytes, /^(0|[1-9][0-9]*)$/);
  assert.match(marker.filesystem_identity, /^[a-f0-9]{8}:[a-f0-9]{16}$/);
  assert.equal(marker.format_version, 2);
  return marker;
}

async function runDescriptorCli(t, workspace, options = {}) {
  await fsp.mkdir(path.dirname(workspace.publicationPath), { recursive: true });
  const archiveFd = fs.openSync(workspace.temporaryPath, 'wx+', 0o600);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    fs.closeSync(archiveFd);
  };
  t.after(() => {
    try { close(); } catch (_) {}
  });

  const operationId = options.operationId || '0123456789abcdef0123456789abcdef';
  const port = await unusedPort();
  const child = spawn(process.execPath, [
    BACKUP_CLI,
    '--descriptor-publication',
    '--operation-id', operationId,
    '--publication-path', workspace.publicationPath,
    '--publication-timeout-ms', String(options.publicationTimeoutMs || 5000),
    '--data-root', workspace.dataRoot,
  ], {
    cwd: workspace.root,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
    stdio: [archiveFd, archiveFd, 'pipe'],
    windowsHide: true,
  });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  });

  const lines = [];
  let pending = '';
  let readyResolved = false;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    pending += chunk;
    while (pending.includes('\n')) {
      const newline = pending.indexOf('\n');
      const line = pending.slice(0, newline).replace(/\r$/, '');
      pending = pending.slice(newline + 1);
      if (!line) continue;
      lines.push(line);
      try {
        const marker = JSON.parse(line);
        if (!readyResolved && marker.phase === 'ready') {
          readyResolved = true;
          resolveReady(marker);
        }
      } catch (_) {}
    }
  });

  const exit = once(child, 'exit');
  exit.then(([code, signal]) => {
    if (!readyResolved) rejectReady(new Error(`descriptor child exited before ready (${code ?? signal})`));
  });
  const readyMarker = await ready;
  if (options.onReady) {
    await options.onReady({ ...workspace, archiveFd, marker: readyMarker });
  }
  const [code, signal] = await exit;
  if (pending) lines.push(pending.replace(/\r$/, ''));
  close();
  return { code, signal, lines, operationId };
}

test('descriptor backup CLI emits only canonical ready and committed machine markers', async (t) => {
  const workspace = await makeCliWorkspace(t, 'descriptor-cli-success');
  const result = await runDescriptorCli(t, workspace, {
    onReady: async ({ temporaryPath, publicationPath }) => {
      await fsp.rename(temporaryPath, publicationPath);
    },
  });

  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
  assert.equal(result.lines.length, 2);
  const ready = assertCanonicalMarker(result.lines[0], 'ready', result.operationId);
  const committed = assertCanonicalMarker(result.lines[1], 'committed', result.operationId);
  assert.deepEqual(committed, { ...ready, phase: 'committed' });
  assert.deepEqual(new AdmZip(workspace.publicationPath).getEntries().map((entry) => entry.entryName).sort(), [
    'database.sqlite',
    'manifest.json',
    'storage/asset.txt',
  ]);
});

test('descriptor backup CLI rejects a copied publication with the same bytes and a different inode', async (t) => {
  const workspace = await makeCliWorkspace(t, 'descriptor-cli-copy');
  const result = await runDescriptorCli(t, workspace, {
    operationId: '11111111111111111111111111111111',
    onReady: async ({ temporaryPath, publicationPath }) => {
      await fsp.copyFile(temporaryPath, publicationPath);
    },
  });

  assert.equal(result.code, 1);
  assert.equal(result.lines.length, 1);
  assertCanonicalMarker(result.lines[0], 'ready', result.operationId);
});

test('descriptor backup CLI rejects changed bytes at the retained inode', async (t) => {
  const workspace = await makeCliWorkspace(t, 'descriptor-cli-mutation');
  const result = await runDescriptorCli(t, workspace, {
    operationId: '22222222222222222222222222222222',
    onReady: async ({ archiveFd, temporaryPath, publicationPath }) => {
      await fsp.rename(temporaryPath, publicationPath);
      fs.writeSync(archiveFd, Buffer.from([0x00]), 0, 1, 0);
      fs.fsyncSync(archiveFd);
    },
  });

  assert.equal(result.code, 1);
  assert.equal(result.lines.length, 1);
  assertCanonicalMarker(result.lines[0], 'ready', result.operationId);
});

test('descriptor backup CLI times out without publishing and emits no human diagnostics', async (t) => {
  const workspace = await makeCliWorkspace(t, 'descriptor-cli-timeout');
  const result = await runDescriptorCli(t, workspace, {
    operationId: '33333333333333333333333333333333',
    publicationTimeoutMs: 100,
  });

  assert.equal(result.code, 1);
  assert.equal(result.lines.length, 1);
  assertCanonicalMarker(result.lines[0], 'ready', result.operationId);
  assert.equal(await fsp.stat(workspace.publicationPath).catch(() => null), null);
});

test('descriptor backup CLI rejects malformed invocation without contaminating the machine channel', async (t) => {
  const workspace = await makeCliWorkspace(t, 'descriptor-cli-invalid');
  await fsp.mkdir(path.dirname(workspace.temporaryPath), { recursive: true });
  const archiveFd = fs.openSync(workspace.temporaryPath, 'wx+', 0o600);
  t.after(() => {
    try { fs.closeSync(archiveFd); } catch (_) {}
  });

  const result = spawnSync(process.execPath, [
    BACKUP_CLI,
    '--descriptor-publication',
    '--publication-path', workspace.publicationPath,
    '--data-root', workspace.dataRoot,
  ], {
    cwd: workspace.root,
    encoding: 'utf8',
    stdio: [archiveFd, archiveFd, 'pipe'],
    windowsHide: true,
  });
  fs.closeSync(archiveFd);

  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
});

test('descriptor backup CLI rejects help without writing human text into the archive descriptor', async (t) => {
  const workspace = await makeCliWorkspace(t, 'descriptor-cli-help');
  await fsp.mkdir(path.dirname(workspace.temporaryPath), { recursive: true });
  const archiveFd = fs.openSync(workspace.temporaryPath, 'wx+', 0o600);
  const result = spawnSync(process.execPath, [
    BACKUP_CLI,
    '--descriptor-publication',
    '--help',
  ], {
    cwd: workspace.root,
    encoding: 'utf8',
    stdio: [archiveFd, archiveFd, 'pipe'],
    windowsHide: true,
  });
  const archiveBytes = fs.fstatSync(archiveFd).size;
  fs.closeSync(archiveFd);

  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  assert.equal(archiveBytes, 0);
});
