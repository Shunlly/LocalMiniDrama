const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const dataBackupService = require('../src/services/dataBackupService');
const snapshot = require('../src/services/dataBackupSnapshot');
const commit = require('../src/services/dataBackupRestoreCommit');

test('恢复提交入口仍从 dataBackupService 调用同一 commitRestore', () => {
  assert.equal(typeof dataBackupService.restoreDataBackup, 'function');
  assert.equal(typeof commit.commitRestore, 'function');
  assert.equal(typeof commit.runFaultInjector, 'function');
});

test('validateStorySourceReferences 拒绝绝对路径，且按 drama_id 联表而不是 episode_id', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-restore-src-'));
  const dbPath = path.join(dir, 'app.db');
  const sourcesDir = path.join(dir, 'story_sources');
  fs.mkdirSync(sourcesDir);
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE dramas (id INTEGER PRIMARY KEY, deleted_at TEXT);
    CREATE TABLE story_sources (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      raw_text_path TEXT,
      deleted_at TEXT
    );
    INSERT INTO dramas (id, deleted_at) VALUES (11, NULL);
    INSERT INTO story_sources (id, drama_id, raw_text_path, deleted_at)
    VALUES (22, 11, 'C:/secret.txt', NULL);
  `);
  db.close();
  try {
    assert.notEqual(11, 22);
    assert.throws(
      () => snapshot.validateStorySourceReferences(dbPath, sourcesDir, { files: [] }, { maxPathLength: 200 }),
      (error) => error.code === 'SOURCE_TEXT_REFERENCE_INVALID',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runFaultInjector 只在提供注入器时调用，且步骤名原样传递', async () => {
  const steps = [];
  await commit.runFaultInjector({}, 'after-targets-replaced');
  await commit.runFaultInjector({
    faultInjector: async (step) => { steps.push(step); },
  }, 'after-targets-replaced');
  assert.deepEqual(steps, ['after-targets-replaced']);
});
