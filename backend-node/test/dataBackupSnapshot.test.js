const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const dataBackupService = require('../src/services/dataBackupService');
const snapshot = require('../src/services/dataBackupSnapshot');

test('备份服务入口仍在 dataBackupService，快照辅助从独立模块提供', () => {
  assert.equal(typeof dataBackupService.createDataBackup, 'function');
  assert.equal(typeof dataBackupService.restoreDataBackup, 'function');
  assert.equal(typeof snapshot.excludeSecretsFromSnapshot, 'function');
  assert.equal(typeof snapshot.createOnlineDatabaseSnapshot, 'function');
});

test('quoteSqlIdentifier 转义双引号，不把表名当列名', () => {
  assert.equal(snapshot.quoteSqlIdentifier('ai_service_configs'), '"ai_service_configs"');
  assert.equal(snapshot.quoteSqlIdentifier('weird"name'), '"weird""name"');
});

test('isReadonlySqliteError 认只读码和文案', () => {
  assert.equal(snapshot.isReadonlySqliteError({ code: 'SQLITE_READONLY' }), true);
  assert.equal(snapshot.isReadonlySqliteError({ message: 'attempt to write a readonly database' }), true);
  assert.equal(snapshot.isReadonlySqliteError({ code: 'SQLITE_BUSY' }), false);
});

test('在线快照可恢复，且密钥列会被清空', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-backup-snap-'));
  const dbPath = path.join(dir, 'app.db');
  const snapPath = path.join(dir, 'snap.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE ai_service_configs (
      id INTEGER PRIMARY KEY,
      api_key TEXT,
      settings TEXT
    );
    INSERT INTO ai_service_configs (id, api_key, settings)
    VALUES (11, 'sk-secret', '{"token":"abc"}');
  `);
  db.close();
  try {
    await snapshot.createOnlineDatabaseSnapshot(dbPath, snapPath);
    const result = snapshot.excludeSecretsFromSnapshot(snapPath);
    assert.equal(result.policy, 'excluded');
    const snap = new Database(snapPath, { readonly: true, fileMustExist: true });
    try {
      const row = snap.prepare('SELECT api_key, settings FROM ai_service_configs WHERE id = 11').get();
      assert.equal(row.api_key, '');
      assert.notEqual(row.settings, '{"token":"abc"}');
    } finally {
      snap.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
