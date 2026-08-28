'use strict';

const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function hasWorkspacePackages(directory) {
  return fs.existsSync(path.join(directory, 'backend-node', 'package.json'))
    && fs.existsSync(path.join(directory, 'frontweb', 'package.json'));
}

function findWorkspaceRoot(startDirectory = __dirname) {
  let current = path.resolve(startDirectory);
  let nearestPackageRoot = null;

  while (true) {
    if (hasWorkspacePackages(current)) return current;
    if (!nearestPackageRoot && fs.existsSync(path.join(current, 'package.json'))) {
      nearestPackageRoot = current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return nearestPackageRoot || path.resolve(startDirectory);
}

function canonicalDirectory(directory) {
  const resolved = path.resolve(directory);
  let canonical = resolved;
  try {
    canonical = fs.realpathSync.native(resolved);
  } catch (_) {
    // Build and test paths may not exist yet; the resolved path is still deterministic.
  }
  canonical = canonical.replaceAll('\\', '/');
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}

function readGitRevision(rootDirectory) {
  try {
    const revision = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {
      cwd: rootDirectory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2_000,
      windowsHide: true,
    }).trim();
    return /^[a-f0-9]{40,64}$/i.test(revision) ? revision.toLowerCase() : 'no-vcs';
  } catch (_) {
    return 'no-vcs';
  }
}

function createRuntimeInstanceId(options = {}) {
  const rootDirectory = options.rootDirectory || findWorkspaceRoot();
  const revision = options.revision === undefined
    ? readGitRevision(rootDirectory)
    : String(options.revision || 'no-vcs');
  const digest = createHash('sha256')
    .update(canonicalDirectory(rootDirectory))
    .update('\0')
    .update(revision)
    .digest('hex')
    .slice(0, 24);
  return `lmd-${digest}`;
}

module.exports = {
  createRuntimeInstanceId,
  findWorkspaceRoot,
  readGitRevision,
};
