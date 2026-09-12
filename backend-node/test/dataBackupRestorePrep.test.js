const test = require('node:test');
const assert = require('node:assert/strict');

const dataBackupService = require('../src/services/dataBackupService');
const restorePrep = require('../src/services/dataBackupRestorePrep');

test('dataBackupService 再导出 assertServiceStopped 与预备模块是同一函数', () => {
  assert.equal(dataBackupService.assertServiceStopped, restorePrep.assertServiceStopped);
});

test('探测主机把通配地址收成回环，其它主机原样保留', () => {
  assert.equal(restorePrep.normalizedProbeHost(''), '127.0.0.1');
  assert.equal(restorePrep.normalizedProbeHost('0.0.0.0'), '127.0.0.1');
  assert.equal(restorePrep.normalizedProbeHost('::'), '127.0.0.1');
  assert.equal(restorePrep.normalizedProbeHost('[::]'), '127.0.0.1');
  assert.equal(restorePrep.normalizedProbeHost('192.168.1.8'), '192.168.1.8');
});

test('isSqliteBusy 只认 SQLITE_BUSY / SQLITE_LOCKED', () => {
  assert.equal(restorePrep.isSqliteBusy({ code: 'SQLITE_BUSY' }), true);
  assert.equal(restorePrep.isSqliteBusy({ code: 'SQLITE_LOCKED' }), true);
  assert.equal(restorePrep.isSqliteBusy({ code: 'SQLITE_ERROR' }), false);
  assert.equal(restorePrep.isSqliteBusy(null), false);
});

test('assertServiceStopped 在 skipServiceCheck 时直接通过', async () => {
  await restorePrep.assertServiceStopped({ skipServiceCheck: true, servicePort: 0 });
});

test('assertServiceStopped 拒绝非法端口', async () => {
  await assert.rejects(
    () => restorePrep.assertServiceStopped({ servicePort: 70000, serviceHost: '127.0.0.1' }),
    (error) => error.code === 'SERVICE_CHECK_FAILED' || error.publicMessage,
  );
});
