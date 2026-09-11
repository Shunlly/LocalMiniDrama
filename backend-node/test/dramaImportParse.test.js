const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dramaImportService = require('../src/services/dramaImportService');
const { DramaImportError } = require('../src/services/dramaImportValidation');
const { parseZip } = require('../src/services/dramaImportParse');

const SERVICE_SRC = fs.readFileSync(
  path.join(__dirname, '../src/services/dramaImportService.js'),
  'utf8'
);

test('ZIP 解析编排已从导入服务文件中移出', () => {
  for (const name of [
    'function readArchiveBuffer',
    'class LazyZipFiles',
    'function parseZip',
  ]) {
    assert.equal(SERVICE_SRC.includes(name), false, name);
  }
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
  assert.equal(dramaImportService.parseZip, parseZip);
});

test('parseZip 缺少归档数据时返回中文错误', () => {
  assert.throws(
    () => parseZip(''),
    (error) => error instanceof DramaImportError
      && error.code === 'INVALID_ARCHIVE'
      && error.message === '压缩包不正确：缺少归档数据'
  );
});
