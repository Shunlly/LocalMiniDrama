const { test } = require('node:test');
const assert = require('node:assert/strict');

const { FORMAT_VERSION } = require('../src/services/dataBackupFormatContract');
const { DataBackupError } = require('../src/services/dataBackupErrors');
const {
  DEFAULT_LIMITS,
  DATABASE_ENTRY,
  MANIFEST_ENTRY,
  STORAGE_PREFIX,
  STORY_SOURCES_PREFIX,
  validateManifest,
} = require('../src/services/dataBackupValidation');
const {
  assembleBackupManifest,
  assertBackupPayloadLimits,
  assertInstalledStorageMatchesManifest,
  assertInstalledStorySourcesMatchManifest,
  assertManifestMatchesArchive,
  assertStagedStorageMatchesManifest,
  assertStagedStorySourcesMatchManifest,
  assertStorySourceReferenceCount,
  buildBackupArchiveSources,
  digestBackupCollectionSha256,
  serializeBackupManifest,
} = require('../src/services/dataBackupManifest');

function expectCode(code) {
  return (error) => error instanceof DataBackupError && error.code === code;
}

function hex(seed) {
  return String(seed).repeat(64).slice(0, 64);
}

function collection({ files = [], totalBytes = 0, sha256 = hex('s'), referenceCount = 0 } = {}) {
  return { files, totalBytes, sha256, referenceCount };
}

test('assembleBackupManifest 生成可被校验接受的现行清单', () => {
  const storage = collection({
    files: [{ archiveName: 'storage/cover.txt', identity: { size: 4 }, sha256: hex('1') }],
    totalBytes: 4,
    sha256: hex('2'),
  });
  const storySources = collection({
    files: [{ archiveName: 'story_sources/1/a.txt', identity: { size: 6 }, sha256: hex('3') }],
    totalBytes: 6,
    sha256: hex('4'),
    referenceCount: 1,
  });
  const manifest = assembleBackupManifest({
    createdAt: '2026-03-04T05:06:07.008Z',
    databaseSha256: hex('d'),
    databaseBytes: 20,
    storage,
    storySources,
    secretPolicy: 'excluded',
  });
  assert.equal(manifest.formatVersion, FORMAT_VERSION);
  assert.equal(manifest.database.entry, DATABASE_ENTRY);
  assert.equal(manifest.storage.entryPrefix, STORAGE_PREFIX);
  assert.equal(manifest.storySources.entryPrefix, STORY_SOURCES_PREFIX);
  assert.equal(manifest.fileCount, 3);
  assert.equal(manifest.totalBytes, 30);
  assert.deepEqual(validateManifest(manifest), manifest);
});

test('assertBackupPayloadLimits 按数据库大小、文件数和总字节依次拒绝', () => {
  const storage = collection({ files: [{}, {}], totalBytes: 10 });
  const storySources = collection({ files: [{}], totalBytes: 5 });
  assert.throws(
    () => assertBackupPayloadLimits({
      databaseBytes: 9,
      storage,
      storySources,
      limits: { ...DEFAULT_LIMITS, maxFileBytes: 8 },
    }),
    expectCode('FILE_LIMIT_EXCEEDED'),
  );
  assert.throws(
    () => assertBackupPayloadLimits({
      databaseBytes: 8,
      storage,
      storySources,
      limits: { ...DEFAULT_LIMITS, maxFiles: 2 },
    }),
    expectCode('FILE_LIMIT_EXCEEDED'),
  );
  assert.throws(
    () => assertBackupPayloadLimits({
      databaseBytes: 8,
      storage,
      storySources,
      limits: { ...DEFAULT_LIMITS, maxTotalBytes: 12 },
    }),
    expectCode('SIZE_LIMIT_EXCEEDED'),
  );
  const ok = assertBackupPayloadLimits({
    databaseBytes: 8,
    storage,
    storySources,
    limits: DEFAULT_LIMITS,
  });
  assert.equal(ok.directoryFileCount, 3);
  assert.equal(ok.totalBytes, 23);
});

test('serializeBackupManifest 超出清单上限时失败，序列化带结尾换行', () => {
  const manifest = assembleBackupManifest({
    createdAt: '2026-03-04T05:06:07.008Z',
    databaseSha256: hex('d'),
    databaseBytes: 1,
    storage: collection(),
    storySources: collection(),
    secretPolicy: 'excluded',
  });
  const buffer = serializeBackupManifest(manifest, DEFAULT_LIMITS);
  assert.equal(buffer.toString('utf8').endsWith('\n'), true);
  assert.throws(
    () => serializeBackupManifest(manifest, { ...DEFAULT_LIMITS, maxManifestBytes: 8 }),
    expectCode('MANIFEST_LIMIT_EXCEEDED'),
  );
});

test('buildBackupArchiveSources 按清单、数据库、存储、原文顺序装配条目', () => {
  const storage = collection({
    files: [{
      archiveName: 'storage/cover.txt',
      absolute: '/abs/cover.txt',
      identity: { size: 4, mtimeMs: 11 },
      sha256: hex('1'),
    }],
  });
  const storySources = collection({
    files: [{
      archiveName: 'story_sources/1/a.txt',
      absolute: '/abs/a.txt',
      identity: { size: 6, mtimeMs: 12 },
      sha256: hex('3'),
    }],
  });
  const sources = buildBackupArchiveSources({
    manifestBuffer: Buffer.from('{}'),
    snapshotPath: '/abs/database.sqlite',
    databaseStat: { dev: 1, ino: 2, size: 20, mtimeMs: 10 },
    storage,
    storySources,
    now: 99,
  });
  assert.equal(sources[0].name, MANIFEST_ENTRY);
  assert.equal(sources[0].mtimeMs, 99);
  assert.equal(sources[1].name, DATABASE_ENTRY);
  assert.equal(sources[1].filePath, '/abs/database.sqlite');
  assert.equal(sources[2].name, 'storage/cover.txt');
  assert.equal(sources[3].name, 'story_sources/1/a.txt');
});

test('digestBackupCollectionSha256 对文件顺序和大小敏感', () => {
  const first = digestBackupCollectionSha256([
    { archiveName: 'storage/a.bin', identity: { size: 2 }, sha256: hex('1') },
    { archiveName: 'storage/b.bin', identity: { size: 3 }, sha256: hex('2') },
  ]);
  const swapped = digestBackupCollectionSha256([
    { archiveName: 'storage/b.bin', identity: { size: 3 }, sha256: hex('2') },
    { archiveName: 'storage/a.bin', identity: { size: 2 }, sha256: hex('1') },
  ]);
  const resized = digestBackupCollectionSha256([
    { archiveName: 'storage/a.bin', identity: { size: 9 }, sha256: hex('1') },
    { archiveName: 'storage/b.bin', identity: { size: 3 }, sha256: hex('2') },
  ]);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, swapped);
  assert.notEqual(first, resized);
});

test('assertManifestMatchesArchive 要求条目数、前缀和字节与清单一致', () => {
  const manifest = assembleBackupManifest({
    createdAt: '2026-03-04T05:06:07.008Z',
    databaseSha256: hex('d'),
    databaseBytes: 20,
    storage: collection({
      files: [{ archiveName: 'storage/cover.txt' }],
      totalBytes: 4,
    }),
    storySources: collection(),
    secretPolicy: 'excluded',
  });
  const archive = {
    payloadBytes: 24,
    entries: [
      { name: MANIFEST_ENTRY, uncompressedSize: 12 },
      { name: DATABASE_ENTRY, uncompressedSize: 20 },
      { name: 'storage/cover.txt', uncompressedSize: 4 },
    ],
  };
  const matched = assertManifestMatchesArchive(manifest, archive);
  assert.equal(matched.storageEntries.length, 1);
  assert.throws(
    () => assertManifestMatchesArchive(manifest, {
      payloadBytes: 24,
      entries: archive.entries.slice(0, 2),
    }),
    expectCode('INVALID_MANIFEST'),
  );
});

test('暂存与安装后的清单对照使用不同错误码', () => {
  const manifest = assembleBackupManifest({
    createdAt: '2026-03-04T05:06:07.008Z',
    databaseSha256: hex('d'),
    databaseBytes: 20,
    storage: collection({
      files: [{ archiveName: 'storage/cover.txt' }],
      totalBytes: 4,
      sha256: hex('2'),
    }),
    storySources: collection({
      files: [{ archiveName: 'story_sources/1/a.txt' }],
      totalBytes: 6,
      sha256: hex('4'),
      referenceCount: 1,
    }),
    secretPolicy: 'excluded',
  });
  const storageEntries = [{ name: 'storage/cover.txt' }];
  const storySourceEntries = [{ name: 'story_sources/1/a.txt' }];
  const stagedStorage = collection({
    files: [{ archiveName: 'storage/cover.txt' }],
    totalBytes: 4,
    sha256: hex('2'),
  });
  const stagedSources = collection({
    files: [{ archiveName: 'story_sources/1/a.txt' }],
    totalBytes: 6,
    sha256: hex('4'),
    referenceCount: 1,
  });
  assert.doesNotThrow(() => assertStagedStorageMatchesManifest(stagedStorage, manifest, storageEntries));
  assert.doesNotThrow(() => assertStagedStorySourcesMatchManifest(stagedSources, manifest, storySourceEntries));
  assert.doesNotThrow(() => assertStorySourceReferenceCount(1, manifest));
  assert.doesNotThrow(() => assertInstalledStorageMatchesManifest(stagedStorage, manifest));
  assert.doesNotThrow(() => assertInstalledStorySourcesMatchManifest(stagedSources, 1, manifest));

  assert.throws(
    () => assertStagedStorageMatchesManifest(collection({
      files: [{ archiveName: 'storage/other.txt' }],
      totalBytes: 4,
      sha256: hex('2'),
    }), manifest, storageEntries),
    expectCode('INVALID_ARCHIVE'),
  );
  assert.throws(
    () => assertStagedStorageMatchesManifest(collection({
      files: [{ archiveName: 'storage/cover.txt' }],
      totalBytes: 4,
      sha256: hex('x'),
    }), manifest, storageEntries),
    expectCode('STORAGE_HASH_MISMATCH'),
  );
  assert.throws(
    () => assertStagedStorySourcesMatchManifest(collection({
      files: [{ archiveName: 'story_sources/1/a.txt' }],
      totalBytes: 6,
      sha256: hex('z'),
    }), manifest, storySourceEntries),
    expectCode('SOURCE_TEXT_HASH_MISMATCH'),
  );
  assert.throws(
    () => assertStorySourceReferenceCount(0, manifest),
    expectCode('INVALID_MANIFEST'),
  );
  assert.throws(
    () => assertInstalledStorageMatchesManifest(collection({
      files: [{ archiveName: 'storage/cover.txt' }],
      totalBytes: 4,
      sha256: hex('x'),
    }), manifest),
    expectCode('RESTORE_VERIFY_FAILED'),
  );
  assert.throws(
    () => assertInstalledStorySourcesMatchManifest(stagedSources, 0, manifest),
    expectCode('RESTORE_VERIFY_FAILED'),
  );
});
