#!/usr/bin/env node

const path = require('node:path');
const { loadConfig, assertSafeConfigDataPath } = require('../src/config');
const {
  DataBackupError,
  restoreDataBackup,
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
    '用法: npm run restore:data -- --input <archive.zip> --yes [--data-root <绝对路径>] [限制]',
    '',
    '后端端口或 SQLite 数据库占用时，恢复会拒绝执行。',
    '',
    '限制:',
    '  --max-files <count>',
    '  --max-bytes <bytes>',
    '  --max-file-bytes <bytes>',
    '  --max-archive-bytes <bytes>',
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
  const parsed = { limits: {}, confirmed: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }
    if (arg === '--yes') {
      parsed.confirmed = true;
      continue;
    }
    const valueFlags = {
      '--input': 'archivePath',
      '--data-root': 'dataRoot',
      '--max-files': 'maxFiles',
      '--max-bytes': 'maxTotalBytes',
      '--max-file-bytes': 'maxFileBytes',
      '--max-archive-bytes': 'maxArchiveBytes',
    };
    const key = valueFlags[arg];
    if (!key) throw backupError('INVALID_ARGUMENT', '未知恢复选项。');
    const value = takeValue(argv, index, arg);
    index += 1;
    if (key === 'archivePath' || key === 'dataRoot') parsed[key] = value;
    else parsed.limits[key] = value;
  }
  return parsed;
}

function resolveConfiguredPath(value, fallback) {
  const configured = value || fallback;
  assertSafeConfigDataPath(configured, 'data path');
  return path.isAbsolute(configured) ? configured : path.resolve(PACKAGE_ROOT, configured);
}

function resolveDataPaths(config, dataRootValue) {
  if (dataRootValue) {
    const dataRoot = resolveDataRoot(dataRootValue);
    return {
      databasePath: path.join(dataRoot, 'drama_generator.db'),
      storagePath: path.join(dataRoot, 'storage'),
      storySourcesPath: path.join(dataRoot, 'story_sources'),
    };
  }
  return {
    databasePath: resolveConfiguredPath(config.database?.path, './data/drama_generator.db'),
    storagePath: resolveConfiguredPath(config.storage?.local_path, './data/storage'),
    storySourcesPath: path.join(PACKAGE_ROOT, 'data', 'story_sources'),
  };
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  if (!args.archivePath) {
    throw backupError('INVALID_ARGUMENT', '恢复需要指定 --input <archive.zip>。');
  }
  const config = loadConfig();
  const dataPaths = resolveDataPaths(config, args.dataRoot);
  const result = await restoreDataBackup({
    archivePath: path.resolve(process.cwd(), args.archivePath),
    ...dataPaths,
    confirmed: args.confirmed,
    serviceHost: process.env.HOST || config.server?.host || '127.0.0.1',
    servicePort: Number(process.env.PORT) || config.server?.port || 5679,
    limits: args.limits,
  });
  console.log('数据恢复已完成。');
  console.log(`备份创建时间：${result.manifest.createdAt}`);
  console.log(`已恢复文件数：${result.manifest.fileCount}`);
  console.log(`已恢复字节数：${result.manifest.totalBytes}`);
  if (result.rollback.databasePath || result.rollback.storagePath || result.rollback.storySourcesPath) {
    console.log('已保留恢复前的回退副本。');
  }
}

main().catch((error) => {
  console.error(formatBackupCliError(error));
  process.exitCode = 1;
});
