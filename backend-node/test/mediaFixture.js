const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const VALID_PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

const cachedEncoders = new Map();

function selectFixtureVideoEncoder(ffmpegPath) {
  const key = String(ffmpegPath || 'ffmpeg');
  if (cachedEncoders.has(key)) return cachedEncoders.get(key);

  const result = spawnSync(key, ['-hide_banner', '-encoders'], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    timeout: 10000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || '').trim() || 'unable to inspect FFmpeg encoders');
  }

  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const candidates = ['libx264', 'libopenh264', 'mpeg4', 'libx265'];
  const encoder = candidates.find((name) => new RegExp(`\\b${name}\\b`).test(output));
  if (!encoder) {
    throw new Error(`FFmpeg fixture generation requires one of: ${candidates.join(', ')}`);
  }
  cachedEncoders.set(key, encoder);
  return encoder;
}

function writeFixtureVideoFile(ffmpegPath, outputPath) {
  const executable = String(ffmpegPath || 'ffmpeg');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const result = spawnSync(executable, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=blue:s=64x48:r=10:d=0.2',
    '-t', '0.2', '-c:v', selectFixtureVideoEncoder(executable), '-pix_fmt', 'yuv420p',
    '-an', '-y', outputPath,
  ], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    timeout: 15000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || '').trim() || 'unable to generate video fixture');
  }
  return fs.readFileSync(outputPath);
}

module.exports = { VALID_PNG_BYTES, selectFixtureVideoEncoder, writeFixtureVideoFile };
