'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const packageJson = require('../package.json');
const {
  assertMediaToolPair,
  assertMediaToolVersion,
} = require('./media-tool-policy');

const desktopRoot = path.resolve(__dirname, '..');
const repositoryMediaTools = path.resolve(desktopRoot, '..', 'backend-node', 'tools', 'ffmpeg');
const stagedMediaTools = path.join(desktopRoot, 'release', '.media-tools');

function mediaToolFileName(expectedName) {
  return process.platform === 'win32' ? `${expectedName}.exe` : expectedName;
}

function findMediaToolOnPath(fileName) {
  for (const rawDirectory of String(process.env.PATH || '').split(path.delimiter)) {
    const directory = rawDirectory.trim().replace(/^"|"$/g, '');
    if (!directory) continue;
    const candidate = path.join(directory, fileName);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function resolveMediaTool(expectedName, preferStaged = true) {
  const fileName = mediaToolFileName(expectedName);
  const staged = path.join(stagedMediaTools, fileName);
  if (preferStaged && fs.existsSync(staged)) return staged;

  const environmentName = expectedName === 'ffmpeg' ? 'FFMPEG_PATH' : 'FFPROBE_PATH';
  const configured = process.env[environmentName];
  if (configured && fs.existsSync(configured)) return configured;

  const repositoryTool = path.join(repositoryMediaTools, fileName);
  if (fs.existsSync(repositoryTool)) return repositoryTool;

  const fromPath = findMediaToolOnPath(fileName);
  if (fromPath) return fromPath;
  throw new Error(
    `${expectedName} was not found. Set ${environmentName} or install ${fileName} on PATH before verification/build.`
  );
}

function verifyMediaTool(expectedName, executable = resolveMediaTool(expectedName)) {
  const result = spawnSync(executable, ['-version'], {
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    timeout: 10000,
    windowsHide: true,
  });
  if (result.error) throw new Error(`${expectedName} could not execute from ${executable}: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(
      `${expectedName} exited with status ${result.status}: ${String(result.stderr || result.stdout || '').trim()}`
    );
  }

  const output = String(result.stdout || result.stderr || '').trim();
  return { executable, ...assertMediaToolVersion(expectedName, output) };
}

function stageMediaTools() {
  fs.mkdirSync(stagedMediaTools, { recursive: true });
  const staged = [];
  for (const expectedName of ['ffmpeg', 'ffprobe']) {
    const source = resolveMediaTool(expectedName, false);
    verifyMediaTool(expectedName, source);
    const destination = path.join(stagedMediaTools, mediaToolFileName(expectedName));
    if (path.resolve(source) !== path.resolve(destination)) fs.copyFileSync(source, destination);
    if (process.platform !== 'win32') fs.chmodSync(destination, 0o755);
    staged.push(verifyMediaTool(expectedName, destination));
  }
  assertMediaToolPair(staged[0], staged[1]);
  process.stdout.write(
    `[media-stage] OK ${staged.map((tool) => `${path.basename(tool.executable)}=${tool.line}`).join(' ')}\n`
  );
}

async function verify() {
  assert.equal(process.versions.electron, packageJson.devDependencies.electron);

  const Database = require('better-sqlite3');
  const db = new Database(':memory:');

  try {
    db.exec('CREATE TABLE abi_check (value TEXT NOT NULL)');
    db.prepare('INSERT INTO abi_check (value) VALUES (?)').run('ok');
    const row = db.prepare('SELECT value, sqlite_version() AS sqliteVersion FROM abi_check').get();
    if (row.value !== 'ok') throw new Error('SQLite read/write verification failed');

    const sharp = require('sharp');
    const sharpOutput = await sharp(Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255]), {
      raw: { width: 3, height: 1, channels: 3 },
    }).png().toBuffer({ resolveWithObject: true });
    assert.equal(sharpOutput.info.format, 'png');
    assert.equal(sharpOutput.info.width, 3);

    const canvasModule = require('@napi-rs/canvas');
    const canvas = canvasModule.createCanvas(2, 2);
    const context = canvas.getContext('2d');
    context.fillStyle = '#ff0000';
    context.fillRect(0, 0, 2, 2);
    const canvasOutput = canvas.toBuffer('image/png');
    assert.ok(Buffer.isBuffer(canvasOutput) && canvasOutput.length > 0);

    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    assert.equal(pdfjs.version, packageJson.dependencies['pdfjs-dist']);
    assert.equal(typeof pdfjs.getDocument, 'function');

    const ffmpeg = verifyMediaTool('ffmpeg');
    const ffprobe = verifyMediaTool('ffprobe');
    assertMediaToolPair(ffmpeg, ffprobe);

    process.stdout.write(
      `[native] OK electron=${process.versions.electron} node=${process.versions.node} modules=${process.versions.modules} ` +
      `sqlite=${row.sqliteVersion} sharp=${sharp.versions.sharp} canvas=${canvasModule.version || packageJson.dependencies['@napi-rs/canvas']} ` +
      `pdfjs=${pdfjs.version}\n` +
      `[media] OK ffmpeg=${ffmpeg.line} path=${ffmpeg.executable} ffprobe=${ffprobe.line} path=${ffprobe.executable}\n`
    );
  } finally {
    db.close();
  }
}

if (process.argv.includes('--stage-media-tools')) {
  try {
    stageMediaTools();
  } catch (err) {
    process.stderr.write(`[media-stage] FAILED ${err && err.stack ? err.stack : err}\n`);
    process.exitCode = 1;
  }
} else {
  const { app } = require('electron');
  app.whenReady().then(verify).then(
    () => app.exit(0),
    (err) => {
      process.stderr.write(`[native] FAILED ${err && err.stack ? err.stack : err}\n`);
      app.exit(1);
    }
  );
}
