#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { loadConfig, assertSafeConfigDataPath } = require('../src/config');
const {
  DataBackupError,
  maintenancePaths,
  recoverInterruptedMaintenanceSync,
  resolveDataRoot,
} = require('../src/services/dataBackupService');
const { formatBackupCliError } = require('../src/services/backupSettingsService');
const BACKUP_PUBLIC_MESSAGES = require('../src/services/backupPublicMessages');

const PACKAGE_ROOT = path.resolve(__dirname, '..');

function backupError(code, detail, cause) {
  if (detail instanceof Error && cause === undefined) {
    cause = detail;
    detail = undefined;
  }
  return new DataBackupError(code, detail || BACKUP_PUBLIC_MESSAGES[code], cause);
}

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
    throw backupError('INVALID_ARGUMENT', `${flag} 缺少参数值。`);
  }
  return value;
}

function parseArguments(argv) {
  const parsed = { confirmed: false, inspect: false, dataRoot: null };
  const seen = new Set();
  const markSeen = (flag) => {
    if (seen.has(flag)) throw backupError('INVALID_ARGUMENT', flag + ' 不能重复指定。');
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
    throw backupError('INVALID_ARGUMENT', '未知维护恢复选项。');
  }
  return parsed;
}

function resolveConfiguredPath(value, fallback) {
  const configured = value || fallback;
  assertSafeConfigDataPath(configured, 'data path');
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
    throw backupError('MAINTENANCE_LOCK_INVALID', '维护锁不是普通文件。');
  }
  try {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    if (!lock || typeof lock !== 'object' || Array.isArray(lock)) throw new Error('invalid lock');
    return lock;
  } catch (error) {
    throw backupError(
      'MAINTENANCE_LOCK_INVALID',
      '无法安全读取维护锁。',
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
    throw backupError('CONFIRMATION_REQUIRED', '维护恢复需要使用 --yes 明确确认。');
  }
  if (!options.databasePath || !options.storagePath || !options.storySourcesPath) {
    throw backupError('INVALID_ARGUMENT', '必须提供数据库、素材和原文路径。');
  }
  if (!options.expectedOwnerScope || !Number.isInteger(options.expectedPid) || options.expectedPid <= 0) {
    throw backupError('INVALID_ARGUMENT', '必须提供检查到的作用域和 PID。');
  }

  const inspected = inspectMaintenanceLock(options.databasePath);
  if (!inspected.present) {
    throw backupError('MAINTENANCE_LOCK_MISSING');
  }
  if (
    inspected.ownerScope !== options.expectedOwnerScope ||
    inspected.pid !== options.expectedPid
  ) {
    throw backupError('MAINTENANCE_OWNER_MISMATCH');
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
    console.error(formatBackupCliError(error));
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
