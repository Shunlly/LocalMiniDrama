const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dramaImportService = require('../src/services/dramaImportService');
const { DramaImportError } = require('../src/services/dramaImportValidation');
const {
  ensureSafeDirectoryInside,
  getStoragePath,
} = require('../src/services/dramaImportMedia');

const SERVICE_SRC = fs.readFileSync(
  path.join(__dirname, '../src/services/dramaImportService.js'),
  'utf8'
);

test('导入媒体落盘已从导入服务文件中移出', () => {
  for (const name of [
    'function getStoragePath',
    'function ensureDir',
    'function ensureSafeDirectoryInside',
    'function removeEmptyParentsInside',
    'function restoreSourceIntakeOriginals',
    'function applyTrustedImportedAssetMetadata',
    'function saveMediaFile',
    'function saveExtraImages',
    'function restoreStoryboardReferenceImages',
  ]) {
    assert.equal(SERVICE_SRC.includes(name), false, name);
  }
  assert.match(SERVICE_SRC, /require\('\.\/dramaImportMedia'\)/);
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

test('getStoragePath 把相对路径接到当前工作目录，绝对路径保持不变', () => {
  const absolute = path.resolve('/tmp/lmd-storage');
  assert.equal(getStoragePath({ storage: { local_path: absolute } }), absolute);
  assert.equal(
    getStoragePath({ storage: { local_path: './data/storage' } }),
    path.join(process.cwd(), './data/storage')
  );
});

test('ensureSafeDirectoryInside 拒绝逃出存储根目录', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-import-media-'));
  try {
    assert.throws(
      () => ensureSafeDirectoryInside(root, path.join(root, '..', 'outside')),
      (error) => error instanceof DramaImportError
        && error.code === 'UNSAFE_IMPORT_TARGET'
        && error.message === '压缩包不安全：媒体目录会逃出存储目录'
    );
    const inside = path.join(root, 'a', 'b');
    ensureSafeDirectoryInside(root, inside);
    assert.equal(fs.lstatSync(inside).isDirectory(), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
