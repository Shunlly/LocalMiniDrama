const test = require('node:test');
const assert = require('node:assert/strict');

const dataBackupService = require('../src/services/dataBackupService');
const prepare = require('../src/services/dataBackupRestorePrepare');

test('恢复预演装载从独立模块提供，restoreDataBackup 仍在服务入口', () => {
  assert.equal(typeof dataBackupService.restoreDataBackup, 'function');
  assert.equal(typeof dataBackupService.createDataBackup, 'function');
  assert.equal(typeof prepare.prepareRestoreStages, 'function');
  assert.equal(typeof prepare.assertDiskAllocations, 'function');
  assert.equal(typeof prepare.removeSqliteSidecars, 'function');
  assert.equal(typeof prepare.readAndValidateManifest, 'function');
});

test('readAndValidateManifest 缺少清单条目时抛出 INVALID_MANIFEST', async () => {
  await assert.rejects(
    () => prepare.readAndValidateManifest({ entries: [] }, { maxManifestBytes: 1024 }),
    (error) => error.code === 'INVALID_MANIFEST',
  );
});
