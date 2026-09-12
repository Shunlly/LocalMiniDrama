const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const dataBackupService = require('../src/services/dataBackupService');
const {
  DataBackupError,
  backupError,
} = require('../src/services/dataBackupErrors');
const {
  DEFAULT_LIMITS,
  archiveNameCollisionKey,
  assertRegularZipEntry,
  assertSafeTargetPaths,
  assertUnusedArchiveCollisionKey,
  canonicalPhysicalIdentity,
  fileIdentity,
  isPathInside,
  normalizeDescriptorPublication,
  normalizeLimits,
  sameFileIdentity,
  toSafeNumber,
  validateArchiveName,
  validateManifest,
  validateRestoreJournal,
} = require('../src/services/dataBackupValidation');

const PUBLIC_EXPORTS = [
  'DEFAULT_LIMITS',
  'DataBackupError',
  'FORMAT_VERSION',
  '__testing',
  'acquireServiceMaintenanceLockSync',
  'assertServiceMaintenanceLockActiveSync',
  'assertServiceStopped',
  'createDataBackup',
  'createExternalMaintenanceLease',
  'getRuntimeServiceMaintenanceLock',
  'maintenancePaths',
  'nativeMaintenanceOwnerScope',
  'recoverInterruptedMaintenanceSync',
  'resolveDataRoot',
  'restoreDataBackup',
  'writeZip64ArchiveToHandle',
];

function expectCode(code) {
  return (error) => error instanceof DataBackupError && error.code === code;
}

function hex(seed) {
  return String(seed).repeat(64).slice(0, 64);
}

function validManifest(overrides = {}) {
  return {
    formatVersion: 2,
    createdAt: '2026-01-02T03:04:05.006Z',
    database: {
      entry: 'database.sqlite',
      sha256: hex('a'),
      bytes: 20,
    },
    storage: {
      entryPrefix: 'storage/',
      fileCount: 1,
      totalBytes: 10,
      sha256: hex('b'),
    },
    storySources: {
      entryPrefix: 'story_sources/',
      fileCount: 0,
      totalBytes: 0,
      sha256: hex('c'),
      referenceCount: 0,
    },
    fileCount: 2,
    totalBytes: 30,
    security: {
      secretPolicy: 'excluded',
    },
    ...overrides,
  };
}

test('数据备份公开 API 仍从 dataBackupService 原样导出', () => {
  assert.deepEqual(Object.keys(dataBackupService).sort(), PUBLIC_EXPORTS);
  assert.equal(dataBackupService.DEFAULT_LIMITS, DEFAULT_LIMITS);
  assert.equal(dataBackupService.DataBackupError, DataBackupError);
  assert.equal(dataBackupService.__testing.backupError, backupError);
  assert.equal(dataBackupService.__testing.canonicalPhysicalIdentity, canonicalPhysicalIdentity);
  assert.deepEqual(Object.keys(dataBackupService.__testing).sort(), [
    'acquireMaintenanceRecoveryClaimSync',
    'backupError',
    'canonicalPhysicalIdentity',
    'releaseMaintenanceRecoveryClaimSync',
  ]);
});

test('backupError 对已映射错误码使用简体中文，忽略英文入参', () => {
  const mapped = backupError('INVALID_MANIFEST', 'The backup manifest is not valid JSON.');
  assert.equal(mapped instanceof DataBackupError, true);
  assert.equal(mapped.code, 'INVALID_MANIFEST');
  assert.match(mapped.publicMessage, /备份清单/);
  assert.doesNotMatch(mapped.publicMessage, /manifest/i);
});

test('normalizeLimits 拒绝非正整数，且不改写默认上限', () => {
  assert.throws(() => normalizeLimits({ maxFiles: 0 }), expectCode('INVALID_LIMIT'));
  assert.throws(() => normalizeLimits({ maxFiles: 1.5 }), expectCode('INVALID_LIMIT'));
  assert.throws(
    () => normalizeLimits({ maxManifestBytes: DEFAULT_LIMITS.maxFileBytes + 1 }),
    expectCode('INVALID_LIMIT'),
  );
  const limits = normalizeLimits({ maxFiles: 2 });
  limits.maxFiles = 1;
  assert.equal(DEFAULT_LIMITS.maxFiles, 25000);
  assert.equal(normalizeLimits().maxFiles, 25000);
});

test('assertSafeTargetPaths 把数据库、存储和原文目录当作不同路径', () => {
  const root = path.resolve('/backup-validation-root');
  const databasePath = path.join(root, 'live', 'drama.db');
  const storagePath = path.join(root, 'live', 'storage');
  const storySourcesPath = path.join(root, 'live', 'story_sources');
  assert.notEqual(databasePath, storagePath);
  assert.notEqual(storagePath, storySourcesPath);
  assert.doesNotThrow(() => assertSafeTargetPaths(databasePath, storagePath, storySourcesPath));
  assert.throws(
    () => assertSafeTargetPaths(databasePath, databasePath, storySourcesPath),
    expectCode('UNSAFE_TARGET'),
  );
  assert.throws(
    () => assertSafeTargetPaths(databasePath, storagePath, path.join(storagePath, 'nested')),
    expectCode('UNSAFE_TARGET'),
  );
});

test('isPathInside 只接受真正位于根目录内的路径', () => {
  const root = path.resolve('/backup-path-root', 'storage');
  assert.equal(isPathInside(root, path.join(root, 'images', 'cover.txt')), true);
  assert.equal(isPathInside(root, root), false);
  assert.equal(isPathInside(root, path.join(root, '..', 'outside.txt')), false);
});

test('validateArchiveName 拒绝穿越、保留名和意外条目', () => {
  const limits = normalizeLimits();
  const ok = 'storage/images/cover.txt';
  assert.equal(validateArchiveName(ok, Buffer.from(ok, 'utf8'), limits), ok);
  assert.throws(
    () => validateArchiveName('storage/../outside.txt', Buffer.from('storage/../outside.txt'), limits),
    expectCode('UNSAFE_ARCHIVE_PATH'),
  );
  assert.throws(
    () => validateArchiveName('storage/CON.txt', Buffer.from('storage/CON.txt'), limits),
    expectCode('UNSAFE_ARCHIVE_PATH'),
  );
  assert.throws(
    () => validateArchiveName('other/file.txt', Buffer.from('other/file.txt'), limits),
    expectCode('UNEXPECTED_ARCHIVE_ENTRY'),
  );
});

test('压缩包条目名冲突按 NFC 小写比较，不把大小写不同视为不同文件', () => {
  const names = new Set();
  assertUnusedArchiveCollisionKey(names, 'storage/Photo.PNG');
  assert.throws(
    () => assertUnusedArchiveCollisionKey(names, 'storage/photo.png'),
    expectCode('DUPLICATE_ARCHIVE_PATH'),
  );
  assert.equal(archiveNameCollisionKey('storage/e\u0301.txt'), archiveNameCollisionKey('storage/\u00e9.txt'));
});

test('validateManifest 接受现行清单并拒绝多余字段、错误合计和旧格式缺哈希', () => {
  assert.deepEqual(validateManifest(validManifest()), validManifest());
  assert.throws(() => validateManifest(validManifest({ extra: true })), expectCode('INVALID_MANIFEST'));
  assert.throws(() => validateManifest(validManifest({ fileCount: 3 })), expectCode('INVALID_MANIFEST'));
  assert.throws(() => validateManifest(validManifest({ formatVersion: 99 })), expectCode('UNSUPPORTED_FORMAT'));
  const legacy = validManifest({
    formatVersion: 1,
    storage: { entryPrefix: 'storage/', fileCount: 1, totalBytes: 10 },
  });
  delete legacy.storySources;
  assert.deepEqual(validateManifest(legacy).formatVersion, 1);
  assert.throws(
    () => validateManifest(validManifest({
      storage: { entryPrefix: 'storage/', fileCount: 1, totalBytes: 10 },
    })),
    expectCode('INVALID_MANIFEST'),
  );
});

test('validateRestoreJournal 区分 v1/v2，且要求辅助路径落在目标旁', () => {
  const databasePath = path.resolve('/restore-db-root', 'drama.db');
  const storagePath = path.resolve('/restore-storage-root', 'storage');
  const storySourcesPath = path.resolve('/restore-source-root', 'story_sources');
  assert.notEqual(databasePath, storagePath);
  assert.notEqual(storagePath, storySourcesPath);

  const legacy = validateRestoreJournal({
    version: 1,
    operation: 'restore',
    phase: 'prepared',
    databasePath,
    storagePath,
    originalDatabaseExisted: true,
    originalStorageExisted: false,
  }, databasePath, storagePath, storySourcesPath);
  assert.equal(legacy.replaceStorySources, false);
  assert.equal(legacy.storySourcesStage, null);

  assert.throws(
    () => validateRestoreJournal({
      version: 1,
      operation: 'restore',
      phase: 'prepared',
      databasePath,
      storagePath,
      originalDatabaseExisted: true,
      originalStorageExisted: false,
      storySourcesPath,
    }, databasePath, storagePath, storySourcesPath),
    expectCode('INVALID_RESTORE_JOURNAL'),
  );

  const incoming = path.join(path.dirname(storagePath), `.${path.basename(storagePath)}.restore-incoming.1.deadbeef`);
  const rollback = path.join(path.dirname(storagePath), `.${path.basename(storagePath)}.restore-rollback.1.deadbeef`);
  const current = validateRestoreJournal({
    version: 2,
    operation: 'restore',
    phase: 'prepared',
    databasePath,
    storagePath,
    storySourcesPath,
    originalDatabaseExisted: false,
    originalStorageExisted: true,
    originalStorySourcesExisted: false,
    replaceStorySources: false,
    storageStage: incoming,
    storageRollbackPath: rollback,
  }, databasePath, storagePath, storySourcesPath);
  assert.equal(current.replaceStorySources, false);
  assert.equal(current.storageStage, incoming);

  assert.throws(
    () => validateRestoreJournal({
      version: 2,
      operation: 'restore',
      phase: 'prepared',
      databasePath,
      storagePath,
      storySourcesPath,
      originalDatabaseExisted: false,
      originalStorageExisted: true,
      originalStorySourcesExisted: false,
      replaceStorySources: false,
      storageStage: path.join(storagePath, 'not-sibling'),
    }, databasePath, storagePath, storySourcesPath),
    expectCode('INVALID_RESTORE_JOURNAL'),
  );
});

test('assertRegularZipEntry 拒绝符号链接和目录项', () => {
  assert.doesNotThrow(() => assertRegularZipEntry(0));
  assert.doesNotThrow(() => assertRegularZipEntry((0o100644 << 16) >>> 0));
  assert.throws(() => assertRegularZipEntry((0o120777 << 16) >>> 0), expectCode('SYMLINK_REJECTED'));
  assert.throws(() => assertRegularZipEntry(0x10), expectCode('SYMLINK_REJECTED'));
});

test('toSafeNumber 只接受非负安全整数', () => {
  assert.equal(toSafeNumber(0), 0);
  assert.equal(toSafeNumber(10n), 10);
  assert.throws(() => toSafeNumber(-1), expectCode('INVALID_ARCHIVE'));
  assert.throws(() => toSafeNumber(2n ** 53n), expectCode('INVALID_ARCHIVE'));
});

test('fileIdentity 比较要求设备、inode、大小和修改时间都一致', () => {
  const identity = fileIdentity({ dev: 1, ino: 2, size: 3, mtimeMs: 4 });
  assert.equal(sameFileIdentity({ isFile: () => true, ...identity }, identity), true);
  assert.equal(sameFileIdentity({ isFile: () => true, ...identity, size: 99 }, identity), false);
  assert.equal(sameFileIdentity({ isFile: () => false, ...identity }, identity), false);
});

test('normalizeDescriptorPublication 要求成对描述符、绝对 data.zip 路径和操作 ID', () => {
  const publicationPath = path.resolve('/publication-root', 'data.zip');
  const waitForPublication = async () => {};
  const normalized = normalizeDescriptorPublication({
    readFd: 3,
    writeFd: 4,
    publicationPath,
    publicationFile: 'data.zip',
    operationId: 'a'.repeat(32),
    waitForPublication,
  });
  assert.equal(normalized.publicationPath, publicationPath);
  assert.throws(
    () => normalizeDescriptorPublication({
      readFd: 3,
      writeFd: 3,
      publicationPath,
      publicationFile: 'data.zip',
      operationId: 'a'.repeat(32),
      waitForPublication,
    }),
    expectCode('INVALID_DESCRIPTOR_PUBLICATION'),
  );
  assert.throws(
    () => normalizeDescriptorPublication({
      readFd: 3,
      writeFd: 4,
      publicationPath: path.resolve('/publication-root', 'other.zip'),
      publicationFile: 'data.zip',
      operationId: 'a'.repeat(32),
      waitForPublication,
    }),
    expectCode('INVALID_DESCRIPTOR_PUBLICATION'),
  );
});
