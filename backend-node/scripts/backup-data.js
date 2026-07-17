#!/usr/bin/env node

const path = require('node:path');
const { loadConfig } = require('../src/config');
const {
  DataBackupError,
  createDataBackup,
} = require('../src/services/dataBackupService');

const PACKAGE_ROOT = path.resolve(__dirname, '..');

function usage() {
  console.log([
    'Usage: npm run backup:data -- [--output <archive.zip>] [limits]',
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
  const parsed = { limits: {} };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }
    const valueFlags = {
      '--output': 'outputPath',
      '--max-files': 'maxFiles',
      '--max-bytes': 'maxTotalBytes',
      '--max-file-bytes': 'maxFileBytes',
      '--max-archive-bytes': 'maxArchiveBytes',
    };
    const key = valueFlags[arg];
    if (!key) throw new DataBackupError('INVALID_ARGUMENT', 'Unknown backup option.');
    const value = takeValue(argv, index, arg);
    index += 1;
    if (key === 'outputPath') parsed.outputPath = value;
    else parsed.limits[key] = value;
  }
  return parsed;
}

function resolveConfiguredPath(value, fallback) {
  const configured = value || fallback;
  return path.isAbsolute(configured) ? configured : path.resolve(PACKAGE_ROOT, configured);
}

function defaultOutputPath() {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return path.join(PACKAGE_ROOT, 'data', 'backups', `localminidrama-${timestamp}.zip`);
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  const config = loadConfig();
  const result = await createDataBackup({
    databasePath: resolveConfiguredPath(config.database?.path, './data/drama_generator.db'),
    storagePath: resolveConfiguredPath(config.storage?.local_path, './data/storage'),
    storySourcesPath: path.join(PACKAGE_ROOT, 'data', 'story_sources'),
    outputPath: args.outputPath ? path.resolve(process.cwd(), args.outputPath) : defaultOutputPath(),
    limits: args.limits,
  });
  console.log('Data backup completed.');
  console.log(`Archive: ${path.basename(result.outputPath)}`);
  console.log(`Files: ${result.manifest.fileCount}`);
  console.log(`Bytes: ${result.manifest.totalBytes}`);
}

main().catch((error) => {
  if (error instanceof DataBackupError) {
    console.error(`[${error.code}] ${error.publicMessage}`);
  } else {
    console.error('[BACKUP_FAILED] The data backup could not be completed.');
  }
  process.exitCode = 1;
});
