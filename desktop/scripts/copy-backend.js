'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { sanitizeRuntimeConfigFile } = require('../../scripts/runtime-config-policy.cjs');

const repoRoot = path.join(__dirname, '..', '..');
const DEFAULT_SOURCE_ROOT = path.join(repoRoot, 'backend-node');
const DEFAULT_DESTINATION_ROOT = path.join(__dirname, '..', 'backend-app');
const DEFAULT_INITIAL_MIGRATIONS_ROOT = path.join(__dirname, 'initial-migrations');

const DIRECTORY_ALLOWLIST = Object.freeze([
  Object.freeze({ relativePath: 'src', extensions: Object.freeze(['.js']) }),
  Object.freeze({ relativePath: 'migrations', extensions: Object.freeze(['.sql']) }),
  Object.freeze({ relativePath: 'prompts', extensions: Object.freeze(['.md']) }),
]);
const FILE_ALLOWLIST = Object.freeze(['configs/config.yaml']);

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative !== '' &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' &&
    !path.isAbsolute(relative)
  );
}

function normalizeRelativePath(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function isAllowedBackendFile(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  if (FILE_ALLOWLIST.includes(normalized)) return true;
  return DIRECTORY_ALLOWLIST.some((rule) => (
    normalized.startsWith(`${rule.relativePath}/`) &&
    rule.extensions.includes(path.posix.extname(normalized).toLowerCase())
  ));
}

function assertSafeRoots(sourceRoot, destinationRoot) {
  const source = path.resolve(sourceRoot);
  const destination = path.resolve(destinationRoot);
  if (
    source === destination ||
    isWithin(source, destination) ||
    isWithin(destination, source) ||
    destination === path.parse(destination).root
  ) {
    throw new Error('Backend source and destination must be separate sibling trees');
  }
}

function assertRealDirectory(directory, label) {
  if (!fs.existsSync(directory)) throw new Error(`${label} is missing: ${directory}`);
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label} must be a real directory: ${directory}`);
  }
}

function copyAllowedDirectory(sourceRoot, destinationRoot, rule) {
  const sourceDirectory = path.join(sourceRoot, rule.relativePath);
  const destinationDirectory = path.join(destinationRoot, rule.relativePath);
  assertRealDirectory(sourceDirectory, `Required backend resource ${rule.relativePath}`);

  const visit = (source, destination) => {
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      const sourcePath = path.join(source, entry.name);
      const destinationPath = path.join(destination, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Symbolic links are not allowed in backend resources: ${sourcePath}`);
      }
      if (entry.isDirectory()) {
        visit(sourcePath, destinationPath);
        continue;
      }
      if (entry.isFile() && rule.extensions.includes(path.extname(entry.name).toLowerCase())) {
        fs.copyFileSync(sourcePath, destinationPath);
      }
    }
  };

  visit(sourceDirectory, destinationDirectory);
}

function copyAllowedFile(sourceRoot, destinationRoot, relativePath) {
  const source = path.join(sourceRoot, relativePath);
  assertRealDirectory(path.dirname(source), `Required backend resource parent ${relativePath}`);
  if (!fs.existsSync(source)) throw new Error(`Required backend resource is missing: ${source}`);
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Required backend resource must be a real file: ${source}`);
  }
  const destination = path.join(destinationRoot, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (normalizeRelativePath(relativePath) === 'configs/config.yaml') {
    sanitizeRuntimeConfigFile(source, destination);
  } else {
    fs.copyFileSync(source, destination);
  }
}

function listFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Symbolic links are not allowed in backend-app: ${absolute}`);
      }
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(normalizeRelativePath(path.relative(root, absolute)));
    }
  };
  visit(root);
  return files.sort();
}

function assertAllowlistedDestination(destinationRoot) {
  const files = listFiles(destinationRoot);
  const unexpected = files.filter((relativePath) => !isAllowedBackendFile(relativePath));
  if (unexpected.length) {
    throw new Error(`Unexpected backend-app files: ${unexpected.join(', ')}`);
  }
  return files;
}

function mergeInitialMigrations(initialMigrationsRoot, destinationRoot) {
  if (!fs.existsSync(initialMigrationsRoot)) return 0;
  assertRealDirectory(initialMigrationsRoot, 'Initial migrations directory');

  const migrationsDestination = path.join(destinationRoot, 'migrations');
  fs.mkdirSync(migrationsDestination, { recursive: true });
  let merged = 0;
  for (const entry of fs.readdirSync(initialMigrationsRoot, { withFileTypes: true })) {
    const source = path.join(initialMigrationsRoot, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Symbolic links are not allowed in initial migrations: ${source}`);
    }
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.sql') continue;
    const destination = path.join(migrationsDestination, entry.name);
    if (fs.existsSync(destination)) continue;
    fs.copyFileSync(source, destination);
    merged += 1;
  }
  return merged;
}

function copyBackend(options = {}) {
  const sourceRoot = path.resolve(options.sourceRoot || DEFAULT_SOURCE_ROOT);
  const destinationRoot = path.resolve(options.destinationRoot || DEFAULT_DESTINATION_ROOT);
  const initialMigrationsRoot = path.resolve(
    options.initialMigrationsRoot || DEFAULT_INITIAL_MIGRATIONS_ROOT
  );

  assertSafeRoots(sourceRoot, destinationRoot);
  assertRealDirectory(sourceRoot, 'backend-node');

  if (fs.existsSync(destinationRoot)) fs.rmSync(destinationRoot, { recursive: true });
  fs.mkdirSync(destinationRoot, { recursive: true });

  for (const rule of DIRECTORY_ALLOWLIST) {
    copyAllowedDirectory(sourceRoot, destinationRoot, rule);
  }
  for (const relativePath of FILE_ALLOWLIST) {
    copyAllowedFile(sourceRoot, destinationRoot, relativePath);
  }

  const mergedInitialMigrations = mergeInitialMigrations(initialMigrationsRoot, destinationRoot);
  const files = assertAllowlistedDestination(destinationRoot);
  return { sourceRoot, destinationRoot, mergedInitialMigrations, files };
}

if (require.main === module) {
  try {
    const result = copyBackend();
    console.log(
      `Copied allowlisted backend resources -> desktop/backend-app ` +
      `(merged ${result.mergedInitialMigrations} initial migration(s))`
    );
  } catch (error) {
    console.error(`[copy-backend] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  DIRECTORY_ALLOWLIST,
  FILE_ALLOWLIST,
  assertAllowlistedDestination,
  copyBackend,
  isAllowedBackendFile,
};
