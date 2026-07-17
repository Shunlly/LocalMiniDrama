'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { FUSE_POLICY } = require('../scripts/electron-fuses');
const {
  artifactNames,
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

test('release scan requires Setup, Portable, and Unpacked artifacts from one version', () => {
  assert.deepEqual(artifactNames('1.3.0'), {
    portable: 'LocalMiniDrama-Portable-1.3.0-x64.exe',
    setup: 'LocalMiniDrama-Setup-1.3.0-x64.exe',
    unpacked: 'LocalMiniDrama-Unpacked-1.3.0-x64.zip',
  });
});
