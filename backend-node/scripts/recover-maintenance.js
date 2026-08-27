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
    '检查：npm run maintenance:recover -- --inspect [--data-root <绝对路径>]',
    '恢复：npm run maintenance:recover -- --data-root <绝对路径> --owner-scope <scope> --pid <pid> --yes',
    '',
    '恢复前必须停止所有 LocalMiniDrama 后端。先检查，再传入完全匹配的作用域和 PID。',
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
  const parsed = { confirmed: false, inspect: false, dataRoot: null };
  const seen = new Set();
  const markSeen = (flag) => {
    if (seen.has(flag)) throw new DataBackupError('INVALID_ARGUMENT', flag + ' 不能重复指定。');
    seen.add(flag);
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      markSeen(arg);
      parsed.help = true;
      continue;
    }
    if (arg === '--inspect') {
      markSeen(arg);
      parsed.inspect = true;
      continue;
    }
    if (arg === '--yes') {
      markSeen(arg);
      parsed.confirmed = true;
      continue;
    }
    if (arg === '--owner-scope') {
      markSeen(arg);
      parsed.expectedOwnerScope = takeValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--pid') {
      markSeen(arg);
      parsed.expectedPid = Number(takeValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg === '--data-root') {
      markSeen(arg);
      parsed.dataRoot = takeValue(argv, index, arg);
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

function resolveDataRoot(value) {
  if (typeof value !== 'string' || value.trim() === '' || !path.isAbsolute(value.trim())) {
    throw new DataBackupError('INVALID_DATA_ROOT', '数据根目录必须是已存在的绝对路径。');
  }
  const resolved = path.resolve(value.trim());
  if (resolved === path.parse(resolved).root) {
    throw new DataBackupError('INVALID_DATA_ROOT', '数据根目录不能是文件系统根目录。');
  }
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch (error) {
    throw new DataBackupError('INVALID_DATA_ROOT', '数据根目录不存在或不可读取。', error);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new DataBackupError('INVALID_DATA_ROOT', '数据根目录必须是非符号链接目录。');
  }
  const realPath = path.resolve(fs.realpathSync(resolved));
  const normalize = (pathValue) => {
    const normalized = path.normalize(pathValue);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  };
  if (normalize(realPath) !== normalize(resolved)) {
    throw new DataBackupError('INVALID_DATA_ROOT', '数据根目录不能通过符号链接或联接访问。');
  }
  return realPath;
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

  const recoveryOptions = {
    databasePath: options.databasePath,
    storagePath: options.storagePath,
    storySourcesPath: options.storySourcesPath,
    expectedOwnerScope: inspected.ownerScope,
    expectedPid: inspected.pid,
  };
  const recovered = recoverInterruptedMaintenanceSync(recoveryOptions);
  return {
    ...recovered,
    ownerScope: inspected.ownerScope,
    pid: inspected.pid,
  };
}

function configuredPaths(dataRoot = null) {
  if (dataRoot !== null && dataRoot !== undefined) {
    const root = resolveDataRoot(dataRoot);
    return {
      dataRoot: root,
      databasePath: path.join(root, 'drama_generator.db'),
      storagePath: path.join(root, 'storage'),
      storySourcesPath: path.join(root, 'story_sources'),
    };
  }
  const config = loadConfig();
  return {
    databasePath: resolveConfiguredPath(config.database?.path, './data/drama_generator.db'),
    storagePath: resolveConfiguredPath(config.storage?.local_path, './data/storage'),
    storySourcesPath: path.join(PACKAGE_ROOT, 'data', 'story_sources'),
  };
}

function printInspection(inspected) {
  if (!inspected.present) {
    console.log('未找到维护租约。');
    return;
  }
  console.log('作用域：' + inspected.ownerScope);
  console.log('PID：' + inspected.pid);
  console.log('操作：' + inspected.operation);
  console.log('心跳：' + inspected.heartbeatAt);
}

function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  const paths = configuredPaths(args.dataRoot);
  if (args.inspect) {
    printInspection(inspectMaintenanceLock(paths.databasePath));
    return;
  }
  const result = recoverMaintenanceLock({ ...paths, ...args });
  console.log('已恢复过期维护状态。');
  console.log('作用域：' + result.ownerScope);
  console.log('PID：' + result.pid);
  console.log('恢复还原日志：' + (result.recovered ? '是' : '否'));
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
  configuredPaths,
  resolveDataRoot,
  recoverMaintenanceLock,
};
