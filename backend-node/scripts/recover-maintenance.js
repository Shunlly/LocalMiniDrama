#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('../src/config');
const {
  DataBackupError,
  maintenancePaths,
  recoverInterruptedMaintenanceSync,
} = require('../src/services/dataBackupService');

const PACKAGE_ROOT = path.resolve(__dirname, '..');

function usage() {
  console.log([
    'Inspect: npm run maintenance:recover -- --inspect',
    'Recover: npm run maintenance:recover -- --owner-scope <scope> --pid <pid> --yes',
    '',
    'Stop every LocalMiniDrama backend before recovery. Inspect first, then pass the exact owner scope and PID.',
  ].join('\n'));
}

function takeValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new DataBackupError('INVALID_ARGUMENT', `${flag} requires a value.`);
  }
  return value;
}

function parseArguments(argv) {
  const parsed = { confirmed: false, inspect: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }
    if (arg === '--inspect') {
      parsed.inspect = true;
      continue;
    }
    if (arg === '--yes') {
      parsed.confirmed = true;
      continue;
    }
    if (arg === '--owner-scope') {
      parsed.expectedOwnerScope = takeValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--pid') {
      parsed.expectedPid = Number(takeValue(argv, index, arg));
      index += 1;
      continue;
    }
    throw new DataBackupError('INVALID_ARGUMENT', 'Unknown maintenance recovery option.');
  }
  return parsed;
}

function resolveConfiguredPath(value, fallback) {
  const configured = value || fallback;
  return path.isAbsolute(configured) ? configured : path.resolve(PACKAGE_ROOT, configured);
}

function readMaintenanceLock(databasePath) {
  const { lockPath } = maintenancePaths(databasePath);
  let stat;
  try {
    stat = fs.lstatSync(lockPath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new DataBackupError('MAINTENANCE_LOCK_INVALID', 'Maintenance lock is not a regular file.');
  }
  try {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    if (!lock || typeof lock !== 'object' || Array.isArray(lock)) throw new Error('invalid lock');
    return lock;
  } catch (error) {
    throw new DataBackupError(
      'MAINTENANCE_LOCK_INVALID',
      'Maintenance lock could not be read safely.',
      error
    );
  }
}

function inspectMaintenanceLock(databasePath) {
  const lock = readMaintenanceLock(databasePath);
  if (!lock) return { present: false };
  return {
    present: true,
    version: Number(lock.version),
    pid: Number(lock.pid),
    ownerScope: String(lock.ownerScope || ''),
    operation: String(lock.operation || ''),
    heartbeatAt: String(lock.heartbeatAt || lock.createdAt || ''),
  };
}

function recoverMaintenanceLock(options = {}) {
  if (options.confirmed !== true) {
    throw new DataBackupError('CONFIRMATION_REQUIRED', 'Maintenance recovery requires explicit confirmation with --yes.');
  }
  if (!options.databasePath || !options.storagePath || !options.storySourcesPath) {
    throw new DataBackupError('INVALID_ARGUMENT', 'Database, storage, and source-text locations are required.');
  }
  if (!options.expectedOwnerScope || !Number.isInteger(options.expectedPid) || options.expectedPid <= 0) {
    throw new DataBackupError('INVALID_ARGUMENT', 'The inspected owner scope and PID are required.');
  }

  const inspected = inspectMaintenanceLock(options.databasePath);
  if (!inspected.present) {
    throw new DataBackupError('MAINTENANCE_LOCK_MISSING', 'No maintenance lock exists.');
  }
  if (
    inspected.ownerScope !== options.expectedOwnerScope ||
    inspected.pid !== options.expectedPid
  ) {
    throw new DataBackupError(
      'MAINTENANCE_OWNER_MISMATCH',
      'The maintenance lock owner changed after inspection; inspect it again.'
    );
  }

  const recovered = recoverInterruptedMaintenanceSync({
    databasePath: options.databasePath,
    storagePath: options.storagePath,
    storySourcesPath: options.storySourcesPath,
    ownerScope: inspected.ownerScope,
    expectedOwnerScope: inspected.ownerScope,
    expectedPid: inspected.pid,
  });
  return {
    ...recovered,
    ownerScope: inspected.ownerScope,
    pid: inspected.pid,
  };
}

function configuredPaths() {
  const config = loadConfig();
  return {
    databasePath: resolveConfiguredPath(config.database?.path, './data/drama_generator.db'),
    storagePath: resolveConfiguredPath(config.storage?.local_path, './data/storage'),
    storySourcesPath: path.join(PACKAGE_ROOT, 'data', 'story_sources'),
  };
}

function printInspection(inspected) {
  if (!inspected.present) {
    console.log('No maintenance lock found.');
    return;
  }
  console.log(`Owner scope: ${inspected.ownerScope}`);
  console.log(`PID: ${inspected.pid}`);
  console.log(`Operation: ${inspected.operation}`);
  console.log(`Heartbeat: ${inspected.heartbeatAt}`);
}

function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  const paths = configuredPaths();
  if (args.inspect) {
    printInspection(inspectMaintenanceLock(paths.databasePath));
    return;
  }
  const result = recoverMaintenanceLock({ ...paths, ...args });
  console.log('Stale maintenance state recovered.');
  console.log(`Owner scope: ${result.ownerScope}`);
  console.log(`PID: ${result.pid}`);
  console.log(`Restore journal recovered: ${result.recovered ? 'yes' : 'no'}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    if (error instanceof DataBackupError) {
      console.error(`[${error.code}] ${error.publicMessage}`);
    } else {
      console.error('[MAINTENANCE_RECOVERY_FAILED] Maintenance state could not be recovered.');
    }
    process.exitCode = 1;
  }
}

module.exports = {
  inspectMaintenanceLock,
  parseArguments,
  recoverMaintenanceLock,
};
