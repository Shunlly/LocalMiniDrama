'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const LEGACY_USER_DATA_DIRECTORY = 'LocalMiniDrama';
const DEVELOPMENT_USER_DATA_DIRECTORY = 'localminidrama-desktop-dev';
const PACKAGED_USER_DATA_DIRECTORY = 'localminidrama-desktop';
const LEGACY_DEVELOPMENT_DIRECTORIES = new Set(['backups', 'storage', 'story_sources']);
const LEGACY_DATABASE_FILE = /^drama_generator\.db(?:-journal|-shm|-wal)?$/;
const LEGACY_BACKEND_DISPOSABLE_DIRECTORIES = new Set([
  'configs',
  'logs',
  'migrations',
  'prompts',
  'scripts',
  'src',
  'tools',
]);

function normalizeRelativePath(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function isSameOrWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function resolveDesktopUserDataDir(options) {
  const environment = options.environment || {};
  const override = String(environment.LOCALMINIDRAMA_USER_DATA_DIR || '').trim();
  if (override) return path.resolve(override);
  const directory = options.isPackaged
    ? PACKAGED_USER_DATA_DIRECTORY
    : DEVELOPMENT_USER_DATA_DIRECTORY;
  return path.resolve(options.appDataDir, directory);
}

function planLegacyUserDataMigration(options) {
  const source = path.resolve(
    options.legacyUserDataDir || path.join(options.appDataDir, LEGACY_USER_DATA_DIRECTORY)
  );
  const destination = path.resolve(options.userDataDir);

  if (options.enabled === false) {
    return { source, destination, shouldMigrate: false, reason: 'disabled' };
  }
  if (source === destination) {
    return { source, destination, shouldMigrate: false, reason: 'same-directory' };
  }
  if (!options.legacyExists) {
    return { source, destination, shouldMigrate: false, reason: 'legacy-missing' };
  }
  if (options.destinationExists) {
    return { source, destination, shouldMigrate: false, reason: 'destination-exists' };
  }
  return { source, destination, shouldMigrate: true, reason: 'ready' };
}

function migrateLegacyUserData(options) {
  const fileSystem = options.fileSystem || fs;
  const preliminary = planLegacyUserDataMigration({
    ...options,
    legacyExists: false,
    destinationExists: false,
  });
  const plan = planLegacyUserDataMigration({
    ...options,
    legacyUserDataDir: preliminary.source,
    legacyExists: fileSystem.existsSync(preliminary.source),
    destinationExists: fileSystem.existsSync(preliminary.destination),
  });

  if (!plan.shouldMigrate) return { ...plan, migrated: false };

  try {
    fileSystem.renameSync(plan.source, plan.destination);
    return { ...plan, migrated: true, reason: 'migrated' };
  } catch (error) {
    return { ...plan, migrated: false, reason: 'rename-failed', error };
  }
}

function unrecognizedDevelopmentData(role, absolute) {
  const prefix = role === 'destination'
    ? 'Legacy development data conflict: unrecognized destination data'
    : 'Unrecognized legacy development data';
  return new Error(`${prefix}: ${absolute}`);
}

function assertRealDirectoryIfPresent(directory, role) {
  if (!fs.existsSync(directory)) return false;
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw unrecognizedDevelopmentData(role, `${directory} must be a real directory`);
  }
  return true;
}

function collectFiles(directory, root, files, role) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw unrecognizedDevelopmentData(role, `symbolic link ${absolute}`);
    }
    if (entry.isDirectory()) {
      collectFiles(absolute, root, files, role);
      continue;
    }
    if (!entry.isFile()) {
      throw unrecognizedDevelopmentData(role, absolute);
    }
    files.push(normalizeRelativePath(path.relative(root, absolute)));
  }
}

function assertRecognizedLegacyBackendRoot(legacyBackendRoot) {
  if (!assertRealDirectoryIfPresent(legacyBackendRoot, 'source')) return;
  for (const entry of fs.readdirSync(legacyBackendRoot, { withFileTypes: true })) {
    if (
      !entry.isSymbolicLink() &&
      entry.isDirectory() &&
      (entry.name === 'data' || LEGACY_BACKEND_DISPOSABLE_DIRECTORIES.has(entry.name))
    ) {
      continue;
    }
    throw unrecognizedDevelopmentData('source', path.join(legacyBackendRoot, entry.name));
  }
}

function collectLegacyDevelopmentFiles(legacyBackendRoot, role = 'source') {
  if (!assertRealDirectoryIfPresent(legacyBackendRoot, role)) return [];
  const dataRoot = path.join(legacyBackendRoot, 'data');
  if (!fs.existsSync(dataRoot)) return [];
  const dataStat = fs.lstatSync(dataRoot);
  if (dataStat.isSymbolicLink() || !dataStat.isDirectory()) {
    throw unrecognizedDevelopmentData(role, dataRoot);
  }

  const files = [];
  for (const entry of fs.readdirSync(dataRoot, { withFileTypes: true })) {
    const absolute = path.join(dataRoot, entry.name);
    if (entry.isSymbolicLink()) {
      throw unrecognizedDevelopmentData(role, `symbolic link ${absolute}`);
    }
    if (entry.isFile() && LEGACY_DATABASE_FILE.test(entry.name)) {
      files.push(`data/${entry.name}`);
      continue;
    }
    if (entry.isDirectory() && LEGACY_DEVELOPMENT_DIRECTORIES.has(entry.name)) {
      collectFiles(absolute, legacyBackendRoot, files, role);
      continue;
    }
    throw unrecognizedDevelopmentData(role, absolute);
  }
  return files.sort();
}

function fileFingerprint(filePath) {
  const before = fs.lstatSync(filePath);
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new Error(`Legacy development data must be a regular file: ${filePath}`);
  }

  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const descriptor = fs.openSync(filePath, 'r');
  let after;
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
    after = fs.fstatSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
    throw new Error(`Legacy development data changed while being read: ${filePath}`);
  }
  return `${after.size}:${hash.digest('hex')}`;
}

function filesEqual(first, second, firstFingerprint = fileFingerprint(first)) {
  const secondFingerprint = fileFingerprint(second);
  return firstFingerprint === secondFingerprint;
}

function assertDestinationPathIsSafe(destinationRoot, relativePath) {
  let current = destinationRoot;
  for (const part of relativePath.split('/').slice(0, -1)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) continue;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`Legacy development data conflict at ${current}`);
    }
  }
}

function migrateLegacyDevelopmentData(options) {
  const legacyBackendRoot = path.resolve(options.legacyBackendRoot);
  const userDataDir = path.resolve(options.userDataDir);
  const destinationBackendRoot = path.join(userDataDir, 'backend');
  if (
    isSameOrWithin(legacyBackendRoot, destinationBackendRoot)
    || isSameOrWithin(destinationBackendRoot, legacyBackendRoot)
  ) {
    throw new Error('Legacy development source and destination must be separate trees');
  }
  if (fs.existsSync(userDataDir)) {
    assertRealDirectoryIfPresent(userDataDir, 'destination');
  }
  assertRecognizedLegacyBackendRoot(legacyBackendRoot);
  const files = collectLegacyDevelopmentFiles(legacyBackendRoot, 'source');

  if (files.length === 0) {
    return {
      source: legacyBackendRoot,
      destination: destinationBackendRoot,
      migrated: false,
      reason: 'legacy-data-missing',
      files,
    };
  }

  const sourceFingerprints = new Map(files.map((relativePath) => [
    relativePath,
    fileFingerprint(path.join(legacyBackendRoot, relativePath)),
  ]));
  const destinationFiles = collectLegacyDevelopmentFiles(destinationBackendRoot, 'destination');
  const sourceFileSet = new Set(files);
  const destinationOnly = destinationFiles.find((relativePath) => !sourceFileSet.has(relativePath));
  if (destinationOnly) {
    throw new Error(`Legacy development data conflict at ${path.join(destinationBackendRoot, destinationOnly)}`);
  }

  const pending = [];
  for (const relativePath of files) {
    const source = path.join(legacyBackendRoot, relativePath);
    const destination = path.join(destinationBackendRoot, relativePath);
    assertDestinationPathIsSafe(destinationBackendRoot, relativePath);
    if (!fs.existsSync(destination)) {
      pending.push({ source, destination, relativePath });
      continue;
    }
    const stat = fs.lstatSync(destination);
    if (
      stat.isSymbolicLink() ||
      !stat.isFile() ||
      !filesEqual(source, destination, sourceFingerprints.get(relativePath))
    ) {
      throw new Error(`Legacy development data conflict at ${destination}`);
    }
  }

  if (pending.length === 0) {
    return {
      source: legacyBackendRoot,
      destination: destinationBackendRoot,
      migrated: false,
      reason: 'already-migrated',
      files,
    };
  }

  const copied = [];
  for (const item of pending) {
    fs.mkdirSync(path.dirname(item.destination), { recursive: true });
    try {
      fs.copyFileSync(item.source, item.destination, fs.constants.COPYFILE_EXCL);
      copied.push(item.destination);
    } catch (error) {
      if (
        error.code !== 'EEXIST'
        || !fs.existsSync(item.destination)
        || !filesEqual(
          item.source,
          item.destination,
          sourceFingerprints.get(item.relativePath)
        )
      ) {
        throw error;
      }
    }
    if (!filesEqual(item.source, item.destination, sourceFingerprints.get(item.relativePath))) {
      if (copied.includes(item.destination)) fs.rmSync(item.destination, { force: true });
      throw new Error(`Legacy development data copy verification failed at ${item.destination}`);
    }
  }

  const changedSource = files.find((relativePath) => (
    fileFingerprint(path.join(legacyBackendRoot, relativePath)) !== sourceFingerprints.get(relativePath)
  ));
  if (changedSource) {
    for (const destination of copied) fs.rmSync(destination, { force: true });
    throw new Error(`Legacy development data changed during migration: ${changedSource}`);
  }

  return {
    source: legacyBackendRoot,
    destination: destinationBackendRoot,
    migrated: true,
    reason: 'migrated',
    files,
  };
}

module.exports = {
  DEVELOPMENT_USER_DATA_DIRECTORY,
  LEGACY_USER_DATA_DIRECTORY,
  PACKAGED_USER_DATA_DIRECTORY,
  migrateLegacyDevelopmentData,
  migrateLegacyUserData,
  planLegacyUserDataMigration,
  resolveDesktopUserDataDir,
};
