'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { FUSE_POLICY } = require('../scripts/electron-fuses');
const {
  artifactNames,
  createVerifiedZip,
  parseFuseReport,
} = require('../scripts/verify-windows-artifacts');

test('release fuse report recognizes every Electron 43 fuse and its required state', () => {
  const lines = ['Analyzing app: LocalMiniDrama.exe', 'Fuse Version: v1'];
  for (const [name, enabled] of Object.entries(FUSE_POLICY)) {
    lines.push(`  ${name} is ${enabled ? 'Enabled' : 'Disabled'}`);
  }
  assert.deepEqual(parseFuseReport(lines.join('\n')), Object.fromEntries(
    Object.entries(FUSE_POLICY).map(([name, enabled]) => [name, enabled ? 'Enabled' : 'Disabled'])
  ));
  assert.equal(Object.hasOwn(FUSE_POLICY, 'WasmTrapHandlers'), true);
  assert.equal(FUSE_POLICY.WasmTrapHandlers, false);
});

test('release fuse report ignores ANSI styling emitted by the Node 20 fuse CLI', () => {
  const lines = ['Analyzing app: \u001b[36mLocalMiniDrama.exe\u001b[39m', 'Fuse Version: \u001b[36mv1\u001b[39m'];
  for (const [name, enabled] of Object.entries(FUSE_POLICY)) {
    const state = enabled ? '\u001b[32mEnabled\u001b[39m' : '\u001b[31mDisabled\u001b[39m';
    lines.push(`  \u001b[33m${name}\u001b[39m is ${state}`);
  }
  assert.deepEqual(parseFuseReport(lines.join('\r\n')), Object.fromEntries(
    Object.entries(FUSE_POLICY).map(([name, enabled]) => [name, enabled ? 'Enabled' : 'Disabled'])
  ));
});

test('release scan requires Setup, Portable, and Unpacked artifacts from one version', () => {
  assert.deepEqual(artifactNames('1.3.0'), {
    portable: 'LocalMiniDrama-Portable-1.3.0-x64.exe',
    setup: 'LocalMiniDrama-Setup-1.3.0-x64.exe',
    unpacked: 'LocalMiniDrama-Unpacked-1.3.0-x64.zip',
  });
});

test('Unpacked ZIP packaging retries a failed CRC test and accepts only a verified archive', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-archive-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'candidate.zip');
  let writes = 0;
  let checks = 0;

  const result = await createVerifiedZip(directory, output, {
    sevenZip: '7za',
    archiveWriter: async (_format, archivePath) => {
      writes += 1;
      fs.writeFileSync(archivePath, `attempt-${writes}`);
    },
    runCommand: () => {
      checks += 1;
      if (checks === 1) throw new Error('CRC Failed');
    },
  });

  assert.equal(result.attempts, 2);
  assert.equal(writes, 2);
  assert.equal(checks, 2);
  assert.equal(fs.readFileSync(output, 'utf8'), 'attempt-2');
});

test('Unpacked ZIP packaging removes an archive that fails CRC validation twice', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-archive-failure-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'candidate.zip');

  await assert.rejects(
    createVerifiedZip(directory, output, {
      sevenZip: '7za',
      archiveWriter: async (_format, archivePath) => fs.writeFileSync(archivePath, 'invalid'),
      runCommand: () => { throw new Error('CRC Failed'); },
    }),
    /failed CRC validation after two attempts/
  );
  assert.equal(fs.existsSync(output), false);
});
