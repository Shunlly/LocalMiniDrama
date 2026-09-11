const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const dramaImportService = require('../src/services/dramaImportService');
const { resolveTitle } = require('../src/services/dramaImportApply');

const SERVICE_SRC = fs.readFileSync(
  path.join(__dirname, '../src/services/dramaImportService.js'),
  'utf8'
);

test('实体还原编排已从导入服务文件中移出', () => {
  for (const name of [
    'function resolveTitle',
    'function restoreFramePromptsFromImageGens',
    'function applyImportedDrama',
    'function _doImport',
  ]) {
    assert.equal(SERVICE_SRC.includes(name), false, name);
  }
  assert.match(SERVICE_SRC, /require\('\.\/dramaImportApply'\)/);
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

test('resolveTitle 在重名时追加中文导入序号，且不把已删除剧本当成冲突', () => {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const now = new Date().toISOString();
  try {
    assert.equal(resolveTitle(db, '测试剧'), '测试剧');
    db.prepare(
      'INSERT INTO dramas (title, status, created_at, updated_at) VALUES (?, ?, ?, ?)'
    ).run('测试剧', 'draft', now, now);
    assert.equal(resolveTitle(db, '测试剧'), '测试剧 导入1');
    db.prepare(
      'INSERT INTO dramas (title, status, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?)'
    ).run('测试剧 导入1', 'draft', now, now, now);
    assert.equal(resolveTitle(db, '测试剧'), '测试剧 导入1');
  } finally {
    db.close();
  }
});
