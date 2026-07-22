#!/usr/bin/env node

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { loadConfig } = require('../src/config');
const {
  DataBackupError,
  createDataBackup,
} = require('../src/services/dataBackupService');

const PACKAGE_ROOT = path.resolve(__dirname, '..');

function usage() {
  console.log([
    'Usage: npm run backup:data -- [--output <archive.zip>] [--data-root <directory>] [limits]',
    '       node scripts/backup-data.js --descriptor-publication --operation-id <id> --publication-path <data.zip> [--data-root <directory>] [limits]',
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
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }
    if (arg === '--descriptor-publication') {
      if (seen.has(arg)) throw new DataBackupError('INVALID_ARGUMENT', 'Duplicate backup options are not allowed.');
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
    if (!key) throw new DataBackupError('INVALID_ARGUMENT', 'Unknown backup option.');
    if (seen.has(arg)) throw new DataBackupError('INVALID_ARGUMENT', 'Duplicate backup options are not allowed.');
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
  return path.isAbsolute(configured) ? configured : path.resolve(PACKAGE_ROOT, configured);
}

function resolveDataPaths(config, dataRootValue) {
  if (dataRootValue) {
    const dataRoot = path.resolve(process.cwd(), dataRootValue);
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
    throw new DataBackupError('INVALID_ARGUMENT', 'The publication timeout must be a canonical integer.');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 10 || parsed > 300000) {
    throw new DataBackupError('INVALID_ARGUMENT', 'The publication timeout is outside the supported range.');
  }
  return parsed;
}

function writeMachineMarker(marker) {
  const bytes = Buffer.from(`${JSON.stringify(marker)}\n`, 'utf8');
  if (bytes.length > 1024) {
    throw new DataBackupError('MACHINE_RESULT_TOO_LARGE', 'The backup publication result exceeded its machine-channel bound.');
  }
  let offset = 0;
  while (offset < bytes.length) {
    const written = fs.writeSync(2, bytes, offset, bytes.length - offset);
    if (written <= 0) {
      throw new DataBackupError('MACHINE_RESULT_WRITE_FAILED', 'The backup publication result could not be written.');
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
        throw new DataBackupError('PUBLICATION_IDENTITY_MISMATCH', 'The backup publication path is not a regular file.');
      }
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new DataBackupError('PUBLICATION_TIMEOUT', 'The backup publication path was not committed before the deadline.');
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    if (args.descriptorPublication) {
      throw new DataBackupError('INVALID_ARGUMENT', 'Help output is unavailable on the descriptor publication channel.');
    }
    usage();
    return;
  }
  if (args.descriptorPublication && (args.outputPath || !args.operationId || !args.publicationPath)) {
    throw new DataBackupError(
      'INVALID_ARGUMENT',
      'Descriptor publication requires an operation id and publication path, without --output.'
    );
  }
  if (!args.descriptorPublication && (args.operationId || args.publicationPath || args.publicationTimeoutMs)) {
    throw new DataBackupError('INVALID_ARGUMENT', 'Descriptor publication options require --descriptor-publication.');
  }
  const config = loadConfig();
  const dataPaths = resolveDataPaths(config, args.dataRoot);
  if (args.descriptorPublication) {
    const resolvedPublicationPath = path.resolve(process.cwd(), args.publicationPath);
    if (!path.isAbsolute(args.publicationPath) || path.basename(resolvedPublicationPath) !== 'data.zip') {
      throw new DataBackupError('INVALID_ARGUMENT', 'Descriptor publication requires an absolute data.zip path.');
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
  console.log('Data backup completed.');
  console.log(`Archive: ${path.basename(result.outputPath)}`);
  console.log(`Files: ${result.manifest.fileCount}`);
  console.log(`Bytes: ${result.manifest.totalBytes}`);
}

const descriptorInvocation = process.argv.slice(2).includes('--descriptor-publication');
main().catch((error) => {
  if (!descriptorInvocation) {
    if (error instanceof DataBackupError) {
      console.error(`[${error.code}] ${error.publicMessage}`);
    } else {
      console.error('[BACKUP_FAILED] The data backup could not be completed.');
    }
  }
  process.exitCode = 1;
});
