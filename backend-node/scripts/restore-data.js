#!/usr/bin/env node

const path = require('node:path');
const { loadConfig, assertSafeConfigDataPath } = require('../src/config');
const {
  DataBackupError,
  restoreDataBackup,
  resolveDataRoot,
} = require('../src/services/dataBackupService');

const PACKAGE_ROOT = path.resolve(__dirname, '..');

function usage() {
  console.log([
    'Usage: npm run restore:data -- --input <archive.zip> --yes [--data-root <absolute-directory>] [limits]',
    '',
    'Restore refuses to run while the backend port or SQLite database is in use.',
    '',
    'Limits:',
    '  --max-files <count>',
    '  --max-bytes <bytes>',
    '  --max-file-bytes <bytes>',
    '  --max-archive-bytes <bytes>',
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
    if (!key) throw new DataBackupError('INVALID_ARGUMENT', 'Unknown restore option.');
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
    throw new DataBackupError('INVALID_ARGUMENT', 'Restore requires --input <archive.zip>.');
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
  console.log('Data restore completed.');
  console.log(`Backup created: ${result.manifest.createdAt}`);
  console.log(`Files restored: ${result.manifest.fileCount}`);
  console.log(`Bytes restored: ${result.manifest.totalBytes}`);
  if (result.rollback.databasePath || result.rollback.storagePath || result.rollback.storySourcesPath) {
    console.log('A pre-restore rollback copy was retained.');
  }
}

main().catch((error) => {
  if (error instanceof DataBackupError) {
    console.error(`[${error.code}] ${error.publicMessage}`);
  } else {
    console.error('[RESTORE_FAILED] The data restore could not be completed.');
  }
  process.exitCode = 1;
});
