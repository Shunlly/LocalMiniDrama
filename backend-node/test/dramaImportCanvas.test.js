const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dramaImportService = require('../src/services/dramaImportService');
const { restoreImportedFreeCanvas } = require('../src/services/dramaImportCanvas');

const SERVICE_SRC = fs.readFileSync(
  path.join(__dirname, '../src/services/dramaImportService.js'),
  'utf8'
);
const APPLY_SRC = fs.readFileSync(
  path.join(__dirname, '../src/services/dramaImportApply.js'),
  'utf8'
);

test('自由画布导入编排已从导入服务文件中移出', () => {
  for (const name of [
    'function restoreImportedFreeCanvas',
    'function verifyFreeCanvasArchiveMedia',
    'function buildPortableImportedFreeCanvasMaps',
  ]) {
    assert.equal(SERVICE_SRC.includes(name), false, name);
  }
  assert.match(APPLY_SRC, /require\('\.\/dramaImportCanvas'\)/);
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

test('restoreImportedFreeCanvas 在没有画布字段时原样返回 metadata', () => {
  const metadata = { title: '无画布' };
  assert.equal(restoreImportedFreeCanvas(null, 11, metadata, {}, 'now'), metadata);
  assert.deepEqual(metadata, { title: '无画布' });
});
