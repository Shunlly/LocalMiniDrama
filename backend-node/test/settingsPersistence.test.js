const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const yaml = require('js-yaml');

const settingsService = require('../src/services/settingsService');
const settingsRoutes = require('../src/routes/settings');

const inheritedRuntimeConfigPath = process.env.LOCALMINIDRAMA_CONFIG_PATH;
delete process.env.LOCALMINIDRAMA_CONFIG_PATH;
test.after(() => {
  if (inheritedRuntimeConfigPath === undefined) delete process.env.LOCALMINIDRAMA_CONFIG_PATH;
  else process.env.LOCALMINIDRAMA_CONFIG_PATH = inheritedRuntimeConfigPath;
});

function withFsOverrides(overrides, action) {
  const originals = {};
  for (const [name, implementation] of Object.entries(overrides)) {
    originals[name] = fs[name];
    fs[name] = implementation;
  }
  try {
    return action();
  } finally {
    for (const [name, implementation] of Object.entries(originals)) {
      fs[name] = implementation;
    }
  }
}

function createLoggerStub() {
  return {
    warnings: [],
    updates: [],
    warnw(message, fields) { this.warnings.push({ message, fields }); },
    infow(message, fields) { this.updates.push({ message, fields }); },
  };
}

function createResponseRecorder() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function createSettingsDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE global_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT ''
  )`);
  return db;
}

test('language persistence honors the explicit runtime config path', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'localminidrama-settings-config-'));
  const runtimeConfig = path.join(tempRoot, 'config.yaml');
  fs.writeFileSync(runtimeConfig, 'app:\n  language: zh\n', 'utf8');
  const previousPath = process.env.LOCALMINIDRAMA_CONFIG_PATH;
  process.env.LOCALMINIDRAMA_CONFIG_PATH = runtimeConfig;
  t.after(() => {
    if (previousPath === undefined) delete process.env.LOCALMINIDRAMA_CONFIG_PATH;
    else process.env.LOCALMINIDRAMA_CONFIG_PATH = previousPath;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const cfg = { app: { language: 'zh' } };
  assert.deepEqual(settingsService.updateLanguage(cfg, createLoggerStub(), 'en'), { ok: true, language: 'en' });
  assert.equal(yaml.load(fs.readFileSync(runtimeConfig, 'utf8')).app.language, 'en');
});

test('updates in-memory language only after the YAML file is persisted', () => {
  const cfg = { app: { language: 'zh' } };
  const log = createLoggerStub();
  const events = [];
  let temporaryPath;
  let renamedPath;
  let writtenYaml;

  const result = withFsOverrides({
    existsSync: () => true,
    readFileSync: () => 'app:\n  language: zh\n',
    statSync: () => ({ mode: 0o100640 }),
    openSync(filePath, flags, mode) {
      events.push(`open:${flags}`);
      if (flags === 'wx') {
        temporaryPath = filePath;
        assert.equal(mode, 0o640);
        return 41;
      }
      assert.equal(flags, 'r');
      return 42;
    },
    writeFileSync(fd, contents) {
      events.push(`write:${fd}`);
      assert.equal(fd, 41);
      writtenYaml = contents;
    },
    fsyncSync(fd) { events.push(`fsync:${fd}`); },
    closeSync(fd) { events.push(`close:${fd}`); },
    renameSync(from, to) {
      events.push('rename');
      assert.equal(from, temporaryPath);
      renamedPath = to;
    },
  }, () => settingsService.updateLanguage(cfg, log, 'en'));

  assert.deepEqual(result, { ok: true, language: 'en' });
  assert.equal(path.dirname(temporaryPath), path.dirname(renamedPath));
  assert.notEqual(temporaryPath, renamedPath);
  assert.match(temporaryPath, /[\\/]\.config\.yaml\..+\.tmp$/);
  assert.match(renamedPath, /configs[\\/]config\.yaml$/);
  assert.equal(yaml.load(writtenYaml).app.language, 'en');
  assert.deepEqual(events, [
    'open:wx',
    'write:41',
    'fsync:41',
    'close:41',
    'rename',
    'open:r',
    'fsync:42',
    'close:42',
  ]);
  assert.equal(cfg.app.language, 'en');
  assert.equal(log.warnings.length, 0);
  assert.equal(log.updates.length, 1);
});

test('propagates YAML write failures and leaves the in-memory language unchanged', () => {
  const cfg = { app: { language: 'zh' } };
  const log = createLoggerStub();
  const writeError = Object.assign(new Error('read-only bind mount'), { code: 'EACCES' });
  let temporaryPath;
  let closed = false;
  let removedPath;

  withFsOverrides({
    existsSync: () => true,
    readFileSync: () => 'app:\n  language: zh\n',
    statSync: () => ({ mode: 0o100600 }),
    openSync(filePath, flags) {
      assert.equal(flags, 'wx');
      temporaryPath = filePath;
      return 51;
    },
    writeFileSync() { throw writeError; },
    closeSync(fd) {
      assert.equal(fd, 51);
      closed = true;
    },
    unlinkSync(filePath) { removedPath = filePath; },
  }, () => {
    assert.throws(
      () => settingsService.updateLanguage(cfg, log, 'en'),
      (error) => error === writeError
    );
  });

  assert.equal(closed, true);
  assert.equal(removedPath, temporaryPath);
  assert.equal(cfg.app.language, 'zh');
  assert.equal(log.warnings.length, 1);
  assert.match(log.warnings[0].fields.error, /read-only bind mount/);
  assert.equal(log.updates.length, 0);
});

test('propagates atomic rename failures, removes the temporary file, and keeps memory unchanged', () => {
  const cfg = { app: { language: 'zh' } };
  const log = createLoggerStub();
  const renameError = Object.assign(new Error('replace denied'), { code: 'EPERM' });
  let temporaryPath;
  let removedPath;

  withFsOverrides({
    existsSync: () => true,
    readFileSync: () => 'app:\n  language: zh\n',
    statSync: () => ({ mode: 0o100600 }),
    openSync(filePath, flags) {
      assert.equal(flags, 'wx');
      temporaryPath = filePath;
      return 61;
    },
    writeFileSync() {},
    fsyncSync() {},
    closeSync() {},
    renameSync() { throw renameError; },
    unlinkSync(filePath) { removedPath = filePath; },
  }, () => {
    assert.throws(
      () => settingsService.updateLanguage(cfg, log, 'en'),
      (error) => error === renameError
    );
  });

  assert.equal(removedPath, temporaryPath);
  assert.equal(cfg.app.language, 'zh');
  assert.equal(log.warnings.length, 1);
  assert.equal(log.updates.length, 0);
});

test('directory sync is attempted on a best-effort basis after atomic replacement', () => {
  const cfg = { app: { language: 'zh' } };
  const log = createLoggerStub();
  let directorySyncAttempted = false;

  const result = withFsOverrides({
    existsSync: () => true,
    readFileSync: () => 'app:\n  language: zh\n',
    statSync: () => ({ mode: 0o100600 }),
    openSync(filePath, flags) {
      if (flags === 'wx') return 71;
      directorySyncAttempted = true;
      throw Object.assign(new Error('directory handles unsupported'), { code: 'EPERM' });
    },
    writeFileSync() {},
    fsyncSync() {},
    closeSync() {},
    renameSync() {},
  }, () => settingsService.updateLanguage(cfg, log, 'en'));

  assert.deepEqual(result, { ok: true, language: 'en' });
  assert.equal(directorySyncAttempted, true);
  assert.equal(cfg.app.language, 'en');
});

test('treats a missing config file as a persistence failure', () => {
  const cfg = { app: { language: 'zh' } };
  const log = createLoggerStub();

  withFsOverrides({ existsSync: () => false }, () => {
    assert.throws(
      () => settingsService.updateLanguage(cfg, log, 'en'),
      (error) => error.code === 'CONFIG_FILE_NOT_FOUND'
    );
  });

  assert.equal(cfg.app.language, 'zh');
  assert.equal(log.warnings.length, 1);
  assert.equal(log.updates.length, 0);
});

test('validates a combined generation settings request before writing either value', () => {
  const db = createSettingsDb();
  try {
    settingsService.setGlobalSetting(db, 'pipeline_concurrency', 3);
    settingsService.setGlobalSetting(db, 'pipeline_video_concurrency', 4);
    const routes = settingsRoutes(db, {}, createLoggerStub());
    const res = createResponseRecorder();

    routes.updateGenerationSettings({
      body: { concurrency: 8, video_concurrency: 21 },
    }, res);

    assert.equal(res.statusCode, 400);
    assert.equal(settingsService.getGlobalSetting(db, 'pipeline_concurrency'), 3);
    assert.equal(settingsService.getGlobalSetting(db, 'pipeline_video_concurrency'), 4);
  } finally {
    db.close();
  }
});

test('rolls back all generation settings when a later upsert fails', () => {
  const db = createSettingsDb();
  try {
    settingsService.setGlobalSetting(db, 'pipeline_concurrency', 3);
    settingsService.setGlobalSetting(db, 'pipeline_video_concurrency', 4);
    db.exec(`CREATE TRIGGER fail_video_concurrency_update
      BEFORE UPDATE OF value ON global_settings
      WHEN NEW.key = 'pipeline_video_concurrency'
      BEGIN
        SELECT RAISE(ABORT, 'synthetic persistence failure');
      END`);
    const routes = settingsRoutes(db, {}, createLoggerStub());
    const res = createResponseRecorder();

    assert.throws(
      () => routes.updateGenerationSettings({
        body: { concurrency: 8, video_concurrency: 9 },
      }, res),
      /synthetic persistence failure/
    );

    assert.equal(res.statusCode, null);
    assert.equal(settingsService.getGlobalSetting(db, 'pipeline_concurrency'), 3);
    assert.equal(settingsService.getGlobalSetting(db, 'pipeline_video_concurrency'), 4);
  } finally {
    db.close();
  }
});
