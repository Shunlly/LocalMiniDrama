const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dramaImportService = require('../src/services/dramaImportService');
const { DEFAULT_IMPORT_LIMITS, DramaImportError } = require('../src/services/dramaImportValidation');
const {
  assertRegularZipEntry,
  assertZipEntryCount,
  indexZipEntries,
  parseImportedProjectJsonData,
  takeProjectJsonEntry,
} = require('../src/services/dramaImportZip');

const SERVICE_SRC = fs.readFileSync(
  path.join(__dirname, '../src/services/dramaImportService.js'),
  'utf8'
);
const PARSE_SRC = fs.readFileSync(
  path.join(__dirname, '../src/services/dramaImportParse.js'),
  'utf8'
);

function makeEntry({
  name,
  isDirectory = false,
  size = 10,
  compressedSize = 10,
  method = 0,
  flags = 0,
  attr = (0o100644 << 16) >>> 0,
} = {}) {
  return {
    entryName: name,
    isDirectory,
    attr,
    header: { size, compressedSize, method, flags },
  };
}

function expectCode(code) {
  return (error) => error instanceof DramaImportError && error.code === code;
}

test('ZIP 条目索引已从导入服务文件中移出', () => {
  for (const name of [
    'function assertRegularZipEntry',
    'function assertZipEntryCount',
    'function indexZipEntries',
    'function takeProjectJsonEntry',
    'function parseImportedProjectJsonData',
    'function zipEntryCollisionKey',
    'function rememberZipEntryName',
    'function assertZipFileEntryLimits',
  ]) {
    assert.equal(SERVICE_SRC.includes(name), false, name);
  }
  assert.match(PARSE_SRC, /require\('\.\/dramaImportZip'\)/);
  assert.match(SERVICE_SRC, /require\('\.\/dramaImportParse'\)/);
  assert.deepEqual(Object.keys(dramaImportService).sort(), [
    'DEFAULT_IMPORT_LIMITS',
    'DramaImportError',
    'createImageValidatorProcessSpec',
    'importDrama',
    'parseZip',
    'resolveSourceOriginalQuotaBytes',
    'validateImportComplexity',
  ]);
});

test('assertRegularZipEntry 拒绝符号链接，允许普通文件和未声明 UNIX 类型', () => {
  assert.doesNotThrow(() => assertRegularZipEntry(makeEntry({ name: 'a.txt', attr: 0 })));
  assert.doesNotThrow(() => assertRegularZipEntry(makeEntry({ name: 'a.txt', attr: (0o100644 << 16) >>> 0 })));
  assert.doesNotThrow(() => assertRegularZipEntry(makeEntry({
    name: 'dir/',
    isDirectory: true,
    attr: (0o120777 << 16) >>> 0,
  })));
  assert.throws(
    () => assertRegularZipEntry(makeEntry({ name: 'link', attr: (0o120777 << 16) >>> 0 })),
    expectCode('UNSAFE_ARCHIVE_ENTRY')
  );
});

test('assertZipEntryCount 在物化条目之前拒绝空包和超量包', () => {
  assert.throws(() => assertZipEntryCount(0, DEFAULT_IMPORT_LIMITS), expectCode('ENTRY_LIMIT_EXCEEDED'));
  assert.throws(() => assertZipEntryCount(5001, DEFAULT_IMPORT_LIMITS), expectCode('ENTRY_LIMIT_EXCEEDED'));
  assert.doesNotThrow(() => assertZipEntryCount(2, DEFAULT_IMPORT_LIMITS));
});

test('indexZipEntries 跳过目录且按 NFC 小写检测重复路径', () => {
  const dir = makeEntry({ name: 'media/', isDirectory: true, size: 0, compressedSize: 0 });
  const file = makeEntry({ name: 'media/a.png', size: 12, compressedSize: 12 });
  const indexed = indexZipEntries([dir, file], DEFAULT_IMPORT_LIMITS);
  assert.equal(indexed.filesByName.has('media'), false);
  assert.equal(indexed.filesByName.get('media/a.png'), file);
  assert.equal(indexed.totalUncompressedBytes, 12);

  assert.throws(
    () => indexZipEntries([
      makeEntry({ name: 'Media/A.png' }),
      makeEntry({ name: 'media/a.png' }),
    ], DEFAULT_IMPORT_LIMITS),
    expectCode('DUPLICATE_ARCHIVE_PATH')
  );
  assert.throws(
    () => indexZipEntries([
      makeEntry({ name: 'cafe\u0301/a.png' }),
      makeEntry({ name: 'caf\u00e9/a.png' }),
    ], DEFAULT_IMPORT_LIMITS),
    expectCode('DUPLICATE_ARCHIVE_PATH')
  );
});

test('indexZipEntries 把目录名和文件名当作同一冲突空间', () => {
  assert.throws(
    () => indexZipEntries([
      makeEntry({ name: 'media/', isDirectory: true, size: 0, compressedSize: 0 }),
      makeEntry({ name: 'media' }),
    ], DEFAULT_IMPORT_LIMITS),
    expectCode('DUPLICATE_ARCHIVE_PATH')
  );
});

test('indexZipEntries 校验压缩算法、单条目大小、压缩率和总量', () => {
  assert.throws(
    () => indexZipEntries([makeEntry({ name: 'a.bin', flags: 0x0001 })], DEFAULT_IMPORT_LIMITS),
    expectCode('UNSUPPORTED_ARCHIVE')
  );
  assert.throws(
    () => indexZipEntries([makeEntry({ name: 'a.bin', method: 12 })], DEFAULT_IMPORT_LIMITS),
    expectCode('UNSUPPORTED_ARCHIVE')
  );
  assert.throws(
    () => indexZipEntries(
      [makeEntry({ name: 'a.bin', size: 65, compressedSize: 65 })],
      { ...DEFAULT_IMPORT_LIMITS, maxEntryBytes: 64 }
    ),
    expectCode('ENTRY_SIZE_LIMIT')
  );
  assert.throws(
    () => indexZipEntries([makeEntry({ name: 'a.bin', size: 20, compressedSize: 0 })], DEFAULT_IMPORT_LIMITS),
    expectCode('INVALID_ARCHIVE')
  );
  assert.throws(
    () => indexZipEntries(
      [makeEntry({ name: 'a.bin', size: 100, compressedSize: 10 })],
      { ...DEFAULT_IMPORT_LIMITS, maxCompressionRatio: 5 }
    ),
    expectCode('COMPRESSION_RATIO_LIMIT')
  );
  assert.throws(
    () => indexZipEntries(
      [
        makeEntry({ name: 'a.bin', size: 80, compressedSize: 80 }),
        makeEntry({ name: 'b.bin', size: 80, compressedSize: 80 }),
      ],
      { ...DEFAULT_IMPORT_LIMITS, maxTotalUncompressedBytes: 100 }
    ),
    expectCode('TOTAL_SIZE_LIMIT')
  );
});

test('takeProjectJsonEntry 要求清单存在且不超过大小上限', () => {
  const projectEntry = makeEntry({ name: 'project.json', size: 32, compressedSize: 32 });
  const filesByName = new Map([['project.json', projectEntry]]);
  assert.equal(takeProjectJsonEntry(filesByName, DEFAULT_IMPORT_LIMITS), projectEntry);
  assert.throws(
    () => takeProjectJsonEntry(new Map(), DEFAULT_IMPORT_LIMITS),
    expectCode('PROJECT_JSON_MISSING')
  );
  assert.throws(
    () => takeProjectJsonEntry(
      filesByName,
      { ...DEFAULT_IMPORT_LIMITS, maxProjectJsonBytes: 8 }
    ),
    expectCode('PROJECT_JSON_TOO_LARGE')
  );
});

test('parseImportedProjectJsonData 区分清单损坏和缺剧名', () => {
  const ok = Buffer.from(JSON.stringify({ drama: { title: '测试剧' } }));
  assert.equal(parseImportedProjectJsonData(ok, ok.length).drama.title, '测试剧');

  const mismatch = Buffer.from('{"drama":{"title":"x"}}');
  assert.throws(
    () => parseImportedProjectJsonData(mismatch, mismatch.length - 1),
    (error) => error instanceof DramaImportError
      && error.code === 'INVALID_PROJECT_JSON'
      && error.message === '项目清单格式错误，无法解析'
  );
  assert.throws(
    () => parseImportedProjectJsonData(Buffer.from('{'), 1),
    expectCode('INVALID_PROJECT_JSON')
  );
  const missingTitle = Buffer.from('{"drama":{}}');
  assert.throws(
    () => parseImportedProjectJsonData(missingTitle, missingTitle.length),
    (error) => error instanceof Error
      && !(error instanceof DramaImportError)
      && error.message === '项目文件格式不正确：缺少剧名'
  );
});
