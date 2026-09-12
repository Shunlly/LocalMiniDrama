#!/usr/bin/env node

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { loadConfig, assertSafeConfigDataPath } = require('../src/config');
const {
  DataBackupError,
  createDataBackup,
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
    '用法: npm run backup:data -- [--output <archive.zip>] [--data-root <绝对路径>] [限制]',
    '      node scripts/backup-data.js --descriptor-publication --operation-id <id> --publication-path <data.zip> [--data-root <绝对路径>] [限制]',
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
  const parsed = { limits: {} };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }
    if (arg === '--descriptor-publication') {
      if (seen.has(arg)) throw backupError('INVALID_ARGUMENT', '不能重复指定备份选项。');
      seen.add(arg);
      parsed.descriptorPublication = true;
      continue;
    }
    const valueFlags = {
      '--output': 'outputPath',
      '--data-root': 'dataRoot',
      '--operation-id': 'operationId',
      '--publication-path': 'publicationPath',
      '--publication-timeout-ms': 'publicationTimeoutMs',
      '--max-files': 'maxFiles',
      '--max-bytes': 'maxTotalBytes',
      '--max-file-bytes': 'maxFileBytes',
      '--max-archive-bytes': 'maxArchiveBytes',
    };
    const key = valueFlags[arg];
    if (!key) throw backupError('INVALID_ARGUMENT', '未知备份选项。');
    if (seen.has(arg)) throw backupError('INVALID_ARGUMENT', '不能重复指定备份选项。');
    seen.add(arg);
    const value = takeValue(argv, index, arg);
    index += 1;
    if (['outputPath', 'dataRoot', 'operationId', 'publicationPath', 'publicationTimeoutMs'].includes(key)) {
      parsed[key] = value;
    }
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

function defaultOutputPath() {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return path.join(PACKAGE_ROOT, 'data', 'backups', `localminidrama-${timestamp}.zip`);
}

function publicationTimeout(value) {
  if (value === undefined) return 120000;
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw backupError('INVALID_ARGUMENT', '发布超时必须是规范整数。');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 10 || parsed > 300000) {
    throw backupError('INVALID_ARGUMENT', '发布超时超出支持范围。');
  }
  return parsed;
}

function writeMachineMarker(marker) {
  const bytes = Buffer.from(`${JSON.stringify(marker)}\n`, 'utf8');
  if (bytes.length > 1024) {
    throw backupError('MACHINE_RESULT_TOO_LARGE');
  }
  let offset = 0;
  while (offset < bytes.length) {
    const written = fs.writeSync(2, bytes, offset, bytes.length - offset);
    if (written <= 0) {
      throw backupError('MACHINE_RESULT_WRITE_FAILED');
    }
    offset += written;
  }
}

async function waitForPublicationPath(publicationPath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const stat = await fsp.lstat(publicationPath);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw backupError('PUBLICATION_IDENTITY_MISMATCH', '备份发布路径不是普通文件。');
      }
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw backupError('PUBLICATION_TIMEOUT');
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    if (args.descriptorPublication) {
      throw backupError('INVALID_ARGUMENT', '描述符发布通道不能输出帮助信息。');
    }
    usage();
    return;
  }
  if (args.descriptorPublication && (args.outputPath || !args.operationId || !args.publicationPath)) {
    throw backupError('INVALID_ARGUMENT', '描述符发布需要操作编号和发布路径，且不能使用 --output。');
  }
  if (!args.descriptorPublication && (args.operationId || args.publicationPath || args.publicationTimeoutMs)) {
    throw backupError('INVALID_ARGUMENT', '描述符发布选项需要同时指定 --descriptor-publication。');
  }
  const config = loadConfig();
  const dataPaths = resolveDataPaths(config, args.dataRoot);
  if (args.descriptorPublication) {
    const resolvedPublicationPath = path.resolve(process.cwd(), args.publicationPath);
    if (!path.isAbsolute(args.publicationPath) || path.basename(resolvedPublicationPath) !== 'data.zip') {
      throw backupError('INVALID_ARGUMENT', '描述符发布需要绝对路径的 data.zip。');
    }
    const timeoutMs = publicationTimeout(args.publicationTimeoutMs);
    const result = await createDataBackup({
      ...dataPaths,
      limits: args.limits,
      descriptorPublication: {
        readFd: 0,
        writeFd: 1,
        publicationPath: resolvedPublicationPath,
        publicationFile: 'data.zip',
        operationId: args.operationId,
        waitForPublication: async (ready) => {
          writeMachineMarker(ready);
          await waitForPublicationPath(resolvedPublicationPath, timeoutMs);
        },
      },
    });
    writeMachineMarker(result.publication.committed);
    return;
  }
  const result = await createDataBackup({
    ...dataPaths,
    outputPath: args.outputPath ? path.resolve(process.cwd(), args.outputPath) : defaultOutputPath(),
    limits: args.limits,
  });
  console.log('数据备份已完成。');
  console.log(`备份文件：${path.basename(result.outputPath)}`);
  console.log(`文件数：${result.manifest.fileCount}`);
  console.log(`字节数：${result.manifest.totalBytes}`);
}

const descriptorInvocation = process.argv.slice(2).includes('--descriptor-publication');
main().catch((error) => {
  if (!descriptorInvocation) {
    console.error(formatBackupCliError(error));
  }
  process.exitCode = 1;
});
