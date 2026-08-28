const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const exportSrc = fs.readFileSync(path.join(__dirname, '../src/services/dramaExportService.js'), 'utf8');
const importSrc = fs.readFileSync(path.join(__dirname, '../src/services/dramaImportService.js'), 'utf8');

const leftover = [
  'Project export encountered an invalid file size.',
  'Project export could not materialize a file.',
  'Project export source changed while being read.',
  'Project export rejected unsafe source metadata.',
  'Project export rejected an unsafe source original.',
  'A project export file exceeds the configured size limit.',
  'unsafe source',
  'mismatched title',
  'unsafe URL',
  'size mismatch',
];

test('project import/export keep leftover English errors out of user-facing messages', () => {
  for (const phrase of leftover) {
    assert.equal(exportSrc.includes(phrase), false, phrase);
    assert.equal(importSrc.includes(`'${phrase}'`), false, phrase);
  }
  assert.match(exportSrc, /项目导出拒绝了不安全的素材元数据/);
  assert.match(exportSrc, /项目导出读取时源文件发生变化，请重试/);
  assert.match(importSrc, /项目包大小与清单不一致/);
  assert.match(importSrc, /素材 URL 不安全/);
});
