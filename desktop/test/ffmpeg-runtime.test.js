'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { removeFixtureTree } = require('./fixture-fs');

const desktopRoot = path.join(__dirname, '..');
const packageJson = require('../package.json');
const {
  assertMediaToolPair,
  assertMediaToolVersion,
  parseMediaToolVersion,
  requiredMediaToolVersion,
} = require('../scripts/media-tool-policy');

function loadEnsureFfmpeg(resourcesPath) {
  const source = fs.readFileSync(path.join(desktopRoot, 'main.js'), 'utf8');
  const start = source.indexOf('function ensureFfmpeg(backendCwd) {');
  const end = source.indexOf('\nfunction getWebDistPath()', start);
  assert.notEqual(start, -1, 'ensureFfmpeg must exist in main.js');
  assert.notEqual(end, -1, 'ensureFfmpeg must end before getWebDistPath');

  const logs = [];
  const ensureFfmpeg = vm.runInNewContext(
    `${source.slice(start, end)}\nensureFfmpeg`,
    {
      app: { isPackaged: true },
      console: {
        log: (...args) => logs.push(['log', ...args]),
        warn: (...args) => logs.push(['warn', ...args]),
      },
      fs,
      path,
      process: { platform: process.platform, resourcesPath },
    }
  );
  return { ensureFfmpeg, logs };
}

function createFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-ffmpeg-'));
  t.after(() => removeFixtureTree(root));
  const resourcesPath = path.join(root, 'resources');
  const backendCwd = path.join(root, 'user-data', 'backend');
  const sourceDir = path.join(resourcesPath, 'ffmpeg');
  const destinationDir = path.join(backendCwd, 'tools', 'ffmpeg');
  const ffmpegName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const ffprobeName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, ffmpegName), 'bundled-ffmpeg');
  fs.writeFileSync(path.join(sourceDir, ffprobeName), 'bundled-ffprobe');
  return { resourcesPath, backendCwd, destinationDir, ffmpegName, ffprobeName };
}

test('ensureFfmpeg installs both bundled media tools into fresh userData', (t) => {
  const fixture = createFixture(t);
  const { ensureFfmpeg } = loadEnsureFfmpeg(fixture.resourcesPath);

  ensureFfmpeg(fixture.backendCwd);

  assert.equal(
    fs.readFileSync(path.join(fixture.destinationDir, fixture.ffmpegName), 'utf8'),
    'bundled-ffmpeg'
  );
  assert.equal(
    fs.readFileSync(path.join(fixture.destinationDir, fixture.ffprobeName), 'utf8'),
    'bundled-ffprobe'
  );
});

test('ensureFfmpeg preserves an existing ffmpeg and restores only the missing ffprobe', (t) => {
  const fixture = createFixture(t);
  fs.mkdirSync(fixture.destinationDir, { recursive: true });
  fs.writeFileSync(path.join(fixture.destinationDir, fixture.ffmpegName), 'user-managed-ffmpeg');
  const { ensureFfmpeg } = loadEnsureFfmpeg(fixture.resourcesPath);

  ensureFfmpeg(fixture.backendCwd);

  assert.equal(
    fs.readFileSync(path.join(fixture.destinationDir, fixture.ffmpegName), 'utf8'),
    'user-managed-ffmpeg'
  );
  assert.equal(
    fs.readFileSync(path.join(fixture.destinationDir, fixture.ffprobeName), 'utf8'),
    'bundled-ffprobe'
  );
});

test('ensureFfmpeg preserves an existing ffprobe and restores only the missing ffmpeg', (t) => {
  const fixture = createFixture(t);
  fs.mkdirSync(fixture.destinationDir, { recursive: true });
  fs.writeFileSync(path.join(fixture.destinationDir, fixture.ffprobeName), 'user-managed-ffprobe');
  const { ensureFfmpeg } = loadEnsureFfmpeg(fixture.resourcesPath);

  ensureFfmpeg(fixture.backendCwd);

  assert.equal(
    fs.readFileSync(path.join(fixture.destinationDir, fixture.ffmpegName), 'utf8'),
    'bundled-ffmpeg'
  );
  assert.equal(
    fs.readFileSync(path.join(fixture.destinationDir, fixture.ffprobeName), 'utf8'),
    'user-managed-ffprobe'
  );
});

test('desktop verification and packaging share the staged media tool inputs', () => {
  assert.equal(requiredMediaToolVersion, '8.1.2');
  assert.equal(packageJson.mediaToolsVersion, requiredMediaToolVersion);
  assert.equal(
    packageJson.scripts['stage:media'],
    'node scripts/verify-native-deps.js --stage-media-tools'
  );
  assert.match(packageJson.scripts.verify, /npm run stage:media && npm run verify:native/);
  assert.match(packageJson.scripts.pack, /npm run stage:media && electron-builder --dir/);
  assert.match(packageJson.scripts.dist, /npm run stage:media && electron-builder --win/);

  const mediaResources = packageJson.build.extraResources.find((entry) => entry.to === 'ffmpeg');
  assert.deepEqual(mediaResources, {
    from: 'release/.media-tools',
    to: 'ffmpeg',
    filter: ['**/*'],
  });
});

test('media tool policy accepts matching pinned ffmpeg releases', () => {
  const ffmpeg = assertMediaToolVersion('ffmpeg', 'ffmpeg version n8.1.2-20260626 Copyright');
  const ffprobe = assertMediaToolVersion('ffprobe', 'ffprobe version 8.1.2 Copyright');
  assert.equal(assertMediaToolPair(ffmpeg, ffprobe), '8.1.2');
});

test('media tool policy rejects stale, mismatched and unparseable releases', () => {
  assert.throws(
    () => assertMediaToolVersion('ffmpeg', 'ffmpeg version 8.0.1-essentials_build'),
    /does not match required release version 8\.1\.2/
  );
  assert.throws(
    () => assertMediaToolPair(
      parseMediaToolVersion('ffmpeg', 'ffmpeg version 8.1.2'),
      parseMediaToolVersion('ffprobe', 'ffprobe version 8.1.1')
    ),
    /must use the same release/
  );
  assert.throws(
    () => parseMediaToolVersion('ffprobe', 'ffprobe version unknown'),
    /unparseable version response/
  );
});
