'use strict';

// 备份校验：路径、限制、清单、恢复日志、压缩条目和描述符发布入参。

const path = require('node:path');
const {
  FORMAT_VERSION,
  LEGACY_FORMAT_VERSION,
  SUPPORTED_FORMAT_VERSIONS,
} = require('./dataBackupFormatContract');
const { backupError } = require('./dataBackupErrors');

const MANIFEST_ENTRY = 'manifest.json';
const DATABASE_ENTRY = 'database.sqlite';
const STORAGE_PREFIX = 'storage/';
const STORY_SOURCES_PREFIX = 'story_sources/';

const BACKUP_PUBLICATION_RESULT_SCHEMA = 'localminidrama.backup-publication-result.v1';
const BACKUP_PUBLICATION_FILE = 'data.zip';
const BACKUP_PUBLICATION_OPERATION_PATTERN = /^[a-f0-9]{32}$/;

const DEFAULT_LIMITS = Object.freeze({
  maxFiles: 25000,
  maxTotalBytes: 32 * 1024 * 1024 * 1024,
  maxFileBytes: 8 * 1024 * 1024 * 1024,
  maxArchiveBytes: 36 * 1024 * 1024 * 1024,
  maxPathBytes: 1024,
  maxManifestBytes: 64 * 1024,
  maxCompressionRatio: 100,
  maxPathDepth: 64,
  diskReserveBytes: 512 * 1024 * 1024,
});

const LIMIT_KEYS = Object.keys(DEFAULT_LIMITS);
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const LEGACY_MAINTENANCE_JOURNAL_VERSION = 1;
const MAINTENANCE_JOURNAL_VERSION = 2;
const RESTORE_PHASES = new Set([
  'prepared',
  'storage_moved',
  'story_sources_moved',
  'database_moved',
  'database_installed',
  'targets_replaced',
  'verified',
  'committed',
  'rolling_back',
]);

function normalizeLimits(overrides = {}) {
  const limits = { ...DEFAULT_LIMITS };
  for (const key of LIMIT_KEYS) {
    if (overrides[key] === undefined) continue;
    const value = Number(overrides[key]);
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw backupError('INVALID_LIMIT');
    }
    limits[key] = value;
  }
  if (limits.maxManifestBytes > limits.maxFileBytes) {
    throw backupError('INVALID_LIMIT');
  }
  return limits;
}

function isPathInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function assertSafeTargetPaths(databasePath, storagePath, storySourcesPath) {
  const db = path.resolve(databasePath);
  const storage = path.resolve(storagePath);
  const storySources = storySourcesPath ? path.resolve(storySourcesPath) : null;
  if (
    db === path.parse(db).root || storage === path.parse(storage).root || db === storage ||
    isPathInside(storage, db) ||
    (storySources && (
      storySources === path.parse(storySources).root || storySources === db || storySources === storage ||
      isPathInside(storySources, db) || isPathInside(storage, storySources) || isPathInside(storySources, storage)
    ))
  ) {
    throw backupError('UNSAFE_TARGET');
  }
}

function assertPortableSegment(segment) {
  if (
    !segment ||
    segment === '.' ||
    segment === '..' ||
    /[\x00-\x1f\x7f]/.test(segment) ||
    segment.includes(':') ||
    segment.endsWith('.') ||
    segment.endsWith(' ') ||
    WINDOWS_RESERVED_NAME.test(segment)
  ) {
    throw backupError('UNSAFE_ARCHIVE_PATH');
  }
}

function validateArchiveName(name, rawName, limits) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.startsWith('/')) {
    throw backupError('UNSAFE_ARCHIVE_PATH');
  }
  if (rawName && (!Buffer.from(name, 'utf8').equals(rawName) || rawName.length > limits.maxPathBytes)) {
    throw backupError('UNSAFE_ARCHIVE_PATH');
  }
  const segments = name.split('/');
  if (segments.length > limits.maxPathDepth || segments.some((segment) => segment === '')) {
    throw backupError('UNSAFE_ARCHIVE_PATH');
  }
  for (const segment of segments) assertPortableSegment(segment);

  const normalized = path.posix.normalize(name);
  if (normalized !== name || path.posix.isAbsolute(normalized) || /^[a-z]:/i.test(normalized)) {
    throw backupError('UNSAFE_ARCHIVE_PATH');
  }
  if (
    name !== MANIFEST_ENTRY && name !== DATABASE_ENTRY &&
    !name.startsWith(STORAGE_PREFIX) && !name.startsWith(STORY_SOURCES_PREFIX)
  ) {
    throw backupError('UNEXPECTED_ARCHIVE_ENTRY');
  }
  if (name === STORAGE_PREFIX.slice(0, -1) || name === STORY_SOURCES_PREFIX.slice(0, -1)) {
    throw backupError('UNSAFE_ARCHIVE_PATH');
  }
  return name;
}

function archiveNameForDirectory(relativePath, entryPrefix, limits) {
  const segments = relativePath.split(path.sep);
  for (const segment of segments) assertPortableSegment(segment);
  const name = `${entryPrefix}${segments.join('/')}`;
  validateArchiveName(name, Buffer.from(name, 'utf8'), limits);
  return name;
}

function fileIdentity(stat) {
  return {
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  };
}

function sameFileIdentity(stat, expected) {
  return stat.isFile() &&
    stat.dev === expected.dev &&
    stat.ino === expected.ino &&
    stat.size === expected.size &&
    stat.mtimeMs === expected.mtimeMs;
}

function archiveNameCollisionKey(name) {
  return name.normalize('NFC').toLowerCase();
}

function assertUnusedArchiveCollisionKey(names, name) {
  const collisionKey = archiveNameCollisionKey(name);
  if (names.has(collisionKey)) {
    throw backupError('DUPLICATE_ARCHIVE_PATH');
  }
  names.add(collisionKey);
  return collisionKey;
}

function assertRecoveryAuxPath(targetPath, candidate, label) {
  if (candidate == null) return null;
  const target = path.resolve(targetPath);
  const resolved = path.resolve(String(candidate));
  const expectedPrefix = `.${path.basename(target)}.${label}.`;
  if (path.dirname(resolved) !== path.dirname(target) || !path.basename(resolved).startsWith(expectedPrefix)) {
    throw backupError('INVALID_RESTORE_JOURNAL');
  }
  return resolved;
}

function validateRestoreJournal(raw, databasePath, storagePath, storySourcesPath) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw backupError('INVALID_RESTORE_JOURNAL');
  }
  const database = path.resolve(databasePath);
  const storage = path.resolve(storagePath);
  const storySources = path.resolve(storySourcesPath);
  const legacyJournal = raw.version === LEGACY_MAINTENANCE_JOURNAL_VERSION;
  const currentJournal = raw.version === MAINTENANCE_JOURNAL_VERSION;
  if (
    (!legacyJournal && !currentJournal) || raw.operation !== 'restore' ||
    !RESTORE_PHASES.has(raw.phase) || path.resolve(String(raw.databasePath || '')) !== database ||
    path.resolve(String(raw.storagePath || '')) !== storage ||
    typeof raw.originalDatabaseExisted !== 'boolean' || typeof raw.originalStorageExisted !== 'boolean'
  ) {
    throw backupError('INVALID_RESTORE_JOURNAL');
  }
  const storyFields = [
    'storySourcesPath',
    'storySourcesStage',
    'storySourcesRollbackPath',
    'originalStorySourcesExisted',
    'replaceStorySources',
  ];
  if (legacyJournal && storyFields.some((key) => Object.hasOwn(raw, key))) {
    throw backupError('INVALID_RESTORE_JOURNAL');
  }
  if (currentJournal && (
    path.resolve(String(raw.storySourcesPath || '')) !== storySources ||
    typeof raw.originalStorySourcesExisted !== 'boolean' ||
    typeof raw.replaceStorySources !== 'boolean' ||
    (raw.replaceStorySources && (!raw.storySourcesStage || !raw.storySourcesRollbackPath)) ||
    (!raw.replaceStorySources && (raw.storySourcesStage != null || raw.storySourcesRollbackPath != null))
  )) {
    throw backupError('INVALID_RESTORE_JOURNAL');
  }
  const replaceStorySources = currentJournal && raw.replaceStorySources;
  return {
    ...raw,
    databasePath: database,
    storagePath: storage,
    storySourcesPath: storySources,
    replaceStorySources,
    databaseStage: assertRecoveryAuxPath(database, raw.databaseStage, 'restore-incoming'),
    storageStage: assertRecoveryAuxPath(storage, raw.storageStage, 'restore-incoming'),
    storySourcesStage: replaceStorySources
      ? assertRecoveryAuxPath(storySources, raw.storySourcesStage, 'restore-incoming')
      : null,
    oldDatabasePath: assertRecoveryAuxPath(database, raw.oldDatabasePath, 'restore-original'),
    storageRollbackPath: assertRecoveryAuxPath(storage, raw.storageRollbackPath, 'restore-rollback'),
    storySourcesRollbackPath: replaceStorySources
      ? assertRecoveryAuxPath(storySources, raw.storySourcesRollbackPath, 'restore-rollback')
      : null,
    databaseRollbackPath: assertRecoveryAuxPath(database, raw.databaseRollbackPath, 'restore-rollback'),
    originalStorySourcesExisted: replaceStorySources ? raw.originalStorySourcesExisted : false,
  };
}

function toSafeNumber(value, code = 'INVALID_ARCHIVE') {
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value) && value >= 0) return value;
  } else if (typeof value === 'bigint' && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(value);
  }
  throw backupError(code, '压缩包使用了不支持的数值大小或偏移。');
}

function canonicalPhysicalIdentity(stat) {
  const dev = BigInt.asUintN(32, BigInt(stat.dev));
  const ino = BigInt.asUintN(64, BigInt(stat.ino));
  return `${dev.toString(16).padStart(8, '0')}:${ino.toString(16).padStart(16, '0')}`;
}

function descriptorSize(stat, code = 'INVALID_DESCRIPTOR_PUBLICATION') {
  if (typeof stat.size !== 'bigint' || stat.size < 0n || stat.size > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw backupError(code, '描述符备份大小不受支持。');
  }
  return Number(stat.size);
}

function assertRegularDescriptorStat(stat) {
  if (!stat?.isFile?.()) {
    throw backupError('INVALID_DESCRIPTOR_PUBLICATION');
  }
}

function sameDescriptorIdentity(left, right) {
  return canonicalPhysicalIdentity(left) === canonicalPhysicalIdentity(right);
}

function normalizeDescriptorPublication(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw backupError('INVALID_DESCRIPTOR_PUBLICATION');
  }
  const {
    readFd,
    writeFd,
    publicationPath,
    publicationFile,
    operationId,
    waitForPublication,
  } = value;
  if (!Number.isInteger(readFd) || readFd < 0 || !Number.isInteger(writeFd) || writeFd < 0 || readFd === writeFd) {
    throw backupError('INVALID_DESCRIPTOR_PUBLICATION');
  }
  if (
    typeof publicationPath !== 'string' || !path.isAbsolute(publicationPath) ||
    typeof publicationFile !== 'string' || publicationFile !== BACKUP_PUBLICATION_FILE ||
    path.basename(publicationPath) !== publicationFile
  ) {
    throw backupError('INVALID_DESCRIPTOR_PUBLICATION');
  }
  if (typeof operationId !== 'string' || !BACKUP_PUBLICATION_OPERATION_PATTERN.test(operationId)) {
    throw backupError('INVALID_DESCRIPTOR_PUBLICATION');
  }
  if (typeof waitForPublication !== 'function') {
    throw backupError('INVALID_DESCRIPTOR_PUBLICATION');
  }
  return Object.freeze({
    readFd,
    writeFd,
    publicationPath: path.resolve(publicationPath),
    publicationFile,
    operationId,
    waitForPublication,
  });
}

function assertRegularZipEntry(externalAttributes) {
  const unixMode = (externalAttributes >>> 16) & 0xffff;
  const fileType = unixMode & 0xf000;
  const dosDirectory = (externalAttributes & 0x10) !== 0;
  if (dosDirectory || (fileType !== 0 && fileType !== 0x8000)) {
    throw backupError('SYMLINK_REJECTED');
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactKeys(value, keys) {
  return isPlainObject(value) &&
    Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

function isNonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validateManifest(value) {
  const baseKeys = ['formatVersion', 'createdAt', 'database', 'storage', 'fileCount', 'totalBytes'];
  const allowedKeys = new Set([...baseKeys, 'security', 'storySources']);
  if (
    !isPlainObject(value) || baseKeys.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !allowedKeys.has(key))
  ) {
    throw backupError('INVALID_MANIFEST');
  }
  if (!SUPPORTED_FORMAT_VERSIONS.includes(value.formatVersion)) {
    throw backupError('UNSUPPORTED_FORMAT');
  }
  if (
    typeof value.createdAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.createdAt) ||
    Number.isNaN(Date.parse(value.createdAt)) ||
    new Date(value.createdAt).toISOString() !== value.createdAt
  ) {
    throw backupError('INVALID_MANIFEST');
  }
  if (
    !hasExactKeys(value.database, ['entry', 'sha256', 'bytes']) ||
    value.database.entry !== DATABASE_ENTRY ||
    !/^[a-f0-9]{64}$/.test(value.database.sha256) ||
    !isNonNegativeSafeInteger(value.database.bytes)
  ) {
    throw backupError('INVALID_MANIFEST');
  }
  const storageKeys = value.formatVersion === LEGACY_FORMAT_VERSION
    ? ['entryPrefix', 'fileCount', 'totalBytes']
    : ['entryPrefix', 'fileCount', 'totalBytes', 'sha256'];
  if (
    !hasExactKeys(value.storage, storageKeys) ||
    value.storage.entryPrefix !== STORAGE_PREFIX ||
    !isNonNegativeSafeInteger(value.storage.fileCount) ||
    !isNonNegativeSafeInteger(value.storage.totalBytes) ||
    (value.formatVersion === FORMAT_VERSION && !/^[a-f0-9]{64}$/.test(value.storage.sha256)) ||
    !isNonNegativeSafeInteger(value.fileCount) ||
    !isNonNegativeSafeInteger(value.totalBytes)
  ) {
    throw backupError('INVALID_MANIFEST');
  }
  if (value.storySources !== undefined && (
    !hasExactKeys(value.storySources, ['entryPrefix', 'fileCount', 'totalBytes', 'sha256', 'referenceCount']) ||
    value.storySources.entryPrefix !== STORY_SOURCES_PREFIX ||
    !isNonNegativeSafeInteger(value.storySources.fileCount) ||
    !isNonNegativeSafeInteger(value.storySources.totalBytes) ||
    !/^[a-f0-9]{64}$/.test(value.storySources.sha256) ||
    !isNonNegativeSafeInteger(value.storySources.referenceCount)
  )) {
    throw backupError('INVALID_MANIFEST');
  }
  const storySourceFileCount = value.storySources?.fileCount || 0;
  const storySourceBytes = value.storySources?.totalBytes || 0;
  if (
    value.fileCount !== value.storage.fileCount + storySourceFileCount + 1 ||
    value.totalBytes !== value.database.bytes + value.storage.totalBytes + storySourceBytes
  ) {
    throw backupError('INVALID_MANIFEST');
  }
  if (value.security !== undefined && (
    !hasExactKeys(value.security, ['secretPolicy']) ||
    !['excluded', 'included-by-explicit-request'].includes(value.security.secretPolicy)
  )) {
    throw backupError('INVALID_MANIFEST');
  }
  return value;
}

module.exports = {
  BACKUP_PUBLICATION_FILE,
  BACKUP_PUBLICATION_RESULT_SCHEMA,
  DATABASE_ENTRY,
  DEFAULT_LIMITS,
  MAINTENANCE_JOURNAL_VERSION,
  MANIFEST_ENTRY,
  STORAGE_PREFIX,
  STORY_SOURCES_PREFIX,
  archiveNameCollisionKey,
  archiveNameForDirectory,
  assertPortableSegment,
  assertRegularDescriptorStat,
  assertRegularZipEntry,
  assertSafeTargetPaths,
  assertUnusedArchiveCollisionKey,
  canonicalPhysicalIdentity,
  descriptorSize,
  fileIdentity,
  isPathInside,
  normalizeDescriptorPublication,
  normalizeLimits,
  sameDescriptorIdentity,
  sameFileIdentity,
  toSafeNumber,
  validateArchiveName,
  validateManifest,
  validateRestoreJournal,
};
