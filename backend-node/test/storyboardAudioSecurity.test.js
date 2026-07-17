const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const configModule = require('../src/config');
const storyboardService = require('../src/services/storyboardService');
const { copyStoredAudioToTemp } = require('../src/services/mergedEpisodePostProcess');

const log = { info() {}, warn() {}, error() {} };

test('storyboard audio references stay inside storage and reject links', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-storyboard-audio-'));
  const storage = path.join(root, 'storage');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(path.join(storage, 'audio'), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(storage, 'audio', 'valid.mp3'), Buffer.from('valid-audio'));
  fs.writeFileSync(path.join(outside, 'secret.mp3'), Buffer.from('outside-audio'));

  const originalLoadConfig = configModule.loadConfig;
  configModule.loadConfig = () => ({ storage: { local_path: storage } });
  t.after(() => {
    configModule.loadConfig = originalLoadConfig;
    fs.rmSync(root, { recursive: true, force: true });
  });

  assert.equal(
    storyboardService.normalizeStoryboardAudioReference('/static/audio/valid.mp3'),
    'audio/valid.mp3'
  );
  assert.throws(
    () => storyboardService.normalizeStoryboardAudioReference('../outside/secret.mp3'),
    (error) => error?.code === 'BAD_REQUEST'
  );
  assert.throws(
    () => storyboardService.normalizeStoryboardAudioReference(path.join(outside, 'secret.mp3')),
    (error) => error?.code === 'BAD_REQUEST'
  );

  const db = new Database(':memory:');
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY,
      audio_local_path TEXT,
      narration_audio_local_path TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    INSERT INTO storyboards (id, updated_at) VALUES (1, 'before');
  `);
  const updated = storyboardService.updateStoryboard(db, log, 1, {
    audio_local_path: '/static/audio/valid.mp3',
  });
  assert.equal(updated.audio_local_path, 'audio/valid.mp3');
  assert.throws(
    () => storyboardService.updateStoryboard(db, log, 1, {
      narration_audio_local_path: '../outside/secret.mp3',
    }),
    (error) => error?.code === 'BAD_REQUEST'
  );

  const copied = path.join(root, 'copied.mp3');
  assert.equal(copyStoredAudioToTemp(storage, 'audio/valid.mp3', copied), true);
  assert.equal(fs.readFileSync(copied, 'utf8'), 'valid-audio');
  assert.equal(copyStoredAudioToTemp(storage, 'audio/missing.mp3', path.join(root, 'missing.mp3')), false);
  assert.throws(
    () => copyStoredAudioToTemp(storage, '../outside/secret.mp3', path.join(root, 'escape.mp3')),
    (error) => error?.code === 'UNSAFE_MEDIA_REFERENCE'
  );

  const linkedDirectory = path.join(storage, 'linked');
  try {
    fs.symlinkSync(outside, linkedDirectory, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(
      () => storyboardService.normalizeStoryboardAudioReference('linked/secret.mp3'),
      (error) => error?.code === 'BAD_REQUEST'
    );
    assert.throws(
      () => copyStoredAudioToTemp(storage, 'linked/secret.mp3', path.join(root, 'linked-copy.mp3')),
      (error) => error?.code === 'UNSAFE_MEDIA_REFERENCE' && error?.reason === 'SYMLINK'
    );
  } catch (error) {
    if (error?.code !== 'EPERM' && error?.code !== 'EACCES') throw error;
    t.diagnostic(`symlink assertion unavailable on this host: ${error.code}`);
  }
});
