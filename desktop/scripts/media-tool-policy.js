'use strict';

const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const packageJson = require('../package.json');

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const requiredMediaToolVersion = String(packageJson.mediaToolsVersion || '').trim();

if (!/^\d+\.\d+\.\d+$/.test(requiredMediaToolVersion)) {
  throw new Error('desktop/package.json must define mediaToolsVersion as an exact semantic version');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

// This reviewed manifest is the trust root. Never populate it from a downloaded file at runtime.
const trustedMediaToolReleases = deepFreeze({
  'win32-x64': {
    schema: 'localminidrama.media-tools-trust.v1',
    platform: 'win32',
    arch: 'x64',
    releaseVersion: '8.1.2',
    package: {
      url: 'https://packages.chocolatey.org/ffmpeg.8.1.2.nupkg',
      sha256: '6c5746c8f0da8334d367131012ec1280bdd490651e108c35e19933587b06aed8',
    },
    payload: {
      path: 'tools/ffmpeg-release-essentials.7z',
      sha256: 'e25b682664025d49034c981afb4bae36238a40f29a3cc1c713ad9a8b5b3528f6',
    },
    binaryDirectory: 'ffmpeg-8.1.2-essentials_build/bin',
    tools: {
      ffmpeg: {
        fileName: 'ffmpeg.exe',
        sha256: '1326dde4c84ff1f96fe6b8916c5bed29e163e9b5dccf995f6f3db069d143ec5e',
      },
      ffprobe: {
        fileName: 'ffprobe.exe',
        sha256: 'b49ccc7c6547b141ad5a2f6ec69cc04323d7133d7704d70b331b904c63eecb07',
      },
    },
  },
});

for (const release of Object.values(trustedMediaToolReleases)) {
  if (release.releaseVersion !== requiredMediaToolVersion) {
    throw new Error(
      `Trusted media tool release ${release.releaseVersion} does not match desktop mediaToolsVersion ${requiredMediaToolVersion}`
    );
  }
}

function trustedReleaseKey(platform, arch) {
  return `${String(platform || '').trim()}-${String(arch || '').trim()}`;
}

function getTrustedMediaToolRelease(platform = process.platform, arch = process.arch) {
  const key = trustedReleaseKey(platform, arch);
  const release = trustedMediaToolReleases[key];
  if (!release) {
    throw new Error(`No trusted media tool SHA-256 manifest exists for ${key || 'unknown platform'}`);
  }
  return release;
}

function sha256File(filePath) {
  const descriptor = fs.openSync(filePath, 'r');
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

function assertTrustedSha256(filePath, expectedSha256, label = path.basename(filePath)) {
  if (!SHA256_PATTERN.test(String(expectedSha256 || ''))) {
    throw new Error(`Trusted SHA-256 for ${label} is invalid`);
  }
  const stat = fs.statSync(filePath, { throwIfNoEntry: false });
  if (!stat?.isFile()) throw new Error(`${label} is missing or is not a file: ${filePath}`);
  const actualSha256 = sha256File(filePath);
  if (actualSha256 !== expectedSha256) {
    throw new Error(`${label} SHA-256 ${actualSha256} does not match trusted SHA-256 ${expectedSha256}`);
  }
  return actualSha256;
}

function parseMediaToolVersion(expectedName, output) {
  if (!['ffmpeg', 'ffprobe'].includes(expectedName)) {
    throw new Error(`Unsupported media tool: ${expectedName}`);
  }

  const line = String(output || '').trim().split(/\r?\n/, 1)[0];
  const match = line.match(new RegExp(`^${expectedName} version (?:n)?(\\d+\\.\\d+\\.\\d+)(?:[-\\s]|$)`, 'i'));
  if (!match) {
    throw new Error(`${expectedName} returned an unparseable version response: ${line.slice(0, 500)}`);
  }
  return { name: expectedName, line, releaseVersion: match[1] };
}

function assertMediaToolVersion(expectedName, output) {
  const tool = parseMediaToolVersion(expectedName, output);
  if (tool.releaseVersion !== requiredMediaToolVersion) {
    throw new Error(
      `${expectedName} ${tool.releaseVersion} does not match required release version ${requiredMediaToolVersion}`
    );
  }
  return tool;
}

function assertMediaToolPair(ffmpeg, ffprobe) {
  if (ffmpeg.name !== 'ffmpeg' || ffprobe.name !== 'ffprobe') {
    throw new Error('Media tool pair must contain ffmpeg and ffprobe in that order');
  }
  if (ffmpeg.releaseVersion !== ffprobe.releaseVersion) {
    throw new Error(
      `ffmpeg ${ffmpeg.releaseVersion} and ffprobe ${ffprobe.releaseVersion} must use the same release`
    );
  }
  return ffmpeg.releaseVersion;
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

function resolveTrustedMediaTool(expectedName, platform = process.platform, arch = process.arch) {
  const release = getTrustedMediaToolRelease(platform, arch);
  const fileName = release.tools[expectedName]?.fileName;
  if (!fileName) throw new Error(`Unsupported media tool: ${expectedName}`);

  const environmentName = expectedName === 'ffmpeg' ? 'FFMPEG_PATH' : 'FFPROBE_PATH';
  const configured = String(process.env[environmentName] || '').trim();
  if (configured && fs.existsSync(configured)) return configured;

  const repositoryTool = path.resolve(__dirname, '..', '..', 'backend-node', 'tools', 'ffmpeg', fileName);
  if (fs.existsSync(repositoryTool)) return repositoryTool;

  const fromPath = findMediaToolOnPath(fileName);
  if (fromPath) return fromPath;
  throw new Error(`${expectedName} was not found in ${environmentName}, the repository tools directory, or PATH`);
}

function readMediaToolVersion(expectedName, executable) {
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
  return assertMediaToolVersion(expectedName, String(result.stdout || result.stderr || ''));
}

function assertTrustedMediaToolFile(expectedName, filePath, platform = process.platform, arch = process.arch) {
  const release = getTrustedMediaToolRelease(platform, arch);
  const trustedTool = release.tools[expectedName];
  if (!trustedTool) throw new Error(`Unsupported media tool: ${expectedName}`);
  return assertTrustedSha256(filePath, trustedTool.sha256, `${expectedName} for ${platform}-${arch}`);
}

function publicSourceDescriptor(release) {
  return {
    schema: release.schema,
    platform: release.platform,
    arch: release.arch,
    releaseVersion: release.releaseVersion,
    package: { ...release.package },
    payload: { ...release.payload },
    binaryDirectory: release.binaryDirectory,
    tools: {
      ffmpeg: { ...release.tools.ffmpeg },
      ffprobe: { ...release.tools.ffprobe },
    },
  };
}

function verifyTrustedMediaTools(
  ffmpegPath,
  ffprobePath,
  platform = process.platform,
  arch = process.arch
) {
  const release = getTrustedMediaToolRelease(platform, arch);
  const paths = {
    ffmpeg: ffmpegPath || resolveTrustedMediaTool('ffmpeg', platform, arch),
    ffprobe: ffprobePath || resolveTrustedMediaTool('ffprobe', platform, arch),
  };
  const parsed = [];
  const tools = [];

  for (const expectedName of ['ffmpeg', 'ffprobe']) {
    const executable = paths[expectedName];
    const sha256 = assertTrustedMediaToolFile(expectedName, executable, platform, arch);
    const version = readMediaToolVersion(expectedName, executable);
    parsed.push(version);
    tools.push({
      name: release.tools[expectedName].fileName,
      version: version.line,
      sha256,
    });
  }
  assertMediaToolPair(parsed[0], parsed[1]);

  return {
    schema: 'localminidrama.media-tools.v1',
    platform,
    arch,
    releaseVersion: release.releaseVersion,
    source: {
      packageUrl: release.package.url,
      packageSha256: release.package.sha256,
      payloadPath: release.payload.path,
      payloadSha256: release.payload.sha256,
    },
    tools,
  };
}

function validateMediaToolMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('Media tool metadata must be an object');
  }
  if (metadata.schema !== 'localminidrama.media-tools.v1') {
    throw new Error(`Unsupported media tool metadata schema: ${metadata.schema}`);
  }
  const release = getTrustedMediaToolRelease(metadata.platform, metadata.arch);
  if (metadata.releaseVersion !== release.releaseVersion) {
    throw new Error(`Media tool metadata release ${metadata.releaseVersion} is not trusted`);
  }

  const expectedSource = {
    packageUrl: release.package.url,
    packageSha256: release.package.sha256,
    payloadPath: release.payload.path,
    payloadSha256: release.payload.sha256,
  };
  for (const [name, expected] of Object.entries(expectedSource)) {
    if (metadata.source?.[name] !== expected) {
      throw new Error(`Media tool metadata source ${name} does not match the trusted manifest`);
    }
  }

  if (!Array.isArray(metadata.tools) || metadata.tools.length !== 2) {
    throw new Error('Media tool metadata must contain exactly ffmpeg and ffprobe');
  }
  for (const [index, expectedName] of ['ffmpeg', 'ffprobe'].entries()) {
    const actual = metadata.tools[index];
    const trusted = release.tools[expectedName];
    if (actual?.name !== trusted.fileName) {
      throw new Error(`Media tool metadata entry ${index} must be ${trusted.fileName}`);
    }
    if (actual.sha256 !== trusted.sha256) {
      throw new Error(`${actual.name} metadata SHA-256 does not match the trusted manifest`);
    }
    assertMediaToolVersion(expectedName, actual.version);
  }
  return release;
}

function writeMediaToolMetadata(mediaDirectory, outputPath, platform = process.platform, arch = process.arch) {
  const release = getTrustedMediaToolRelease(platform, arch);
  const metadata = verifyTrustedMediaTools(
    path.join(mediaDirectory, release.tools.ffmpeg.fileName),
    path.join(mediaDirectory, release.tools.ffprobe.fileName),
    platform,
    arch
  );
  validateMediaToolMetadata(metadata);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  return metadata;
}

function beforePack(context) {
  const platform = context?.electronPlatformName || process.platform;
  const builderArchNames = ['ia32', 'x64', 'armv7l', 'arm64', 'universal'];
  const arch = Number.isInteger(context?.arch) ? builderArchNames[context.arch] : (context?.arch || process.arch);
  const projectDirectory = context?.packager?.projectDir || path.resolve(__dirname, '..');
  const release = getTrustedMediaToolRelease(platform, arch);
  const mediaDirectory = path.join(projectDirectory, 'release', '.media-tools');
  const metadata = verifyTrustedMediaTools(
    path.join(mediaDirectory, release.tools.ffmpeg.fileName),
    path.join(mediaDirectory, release.tools.ffprobe.fileName),
    platform,
    arch
  );
  process.stdout.write(`[media-policy] beforePack verified ${metadata.releaseVersion} for ${platform}-${arch}\n`);
}

function runCli(args = process.argv.slice(2)) {
  const [command, ...values] = args;
  if (command === 'source') {
    const release = getTrustedMediaToolRelease(values[0], values[1]);
    process.stdout.write(`${JSON.stringify(publicSourceDescriptor(release))}\n`);
    return;
  }
  if (command === 'verify-package' || command === 'verify-payload') {
    const [filePath, platform, arch] = values;
    if (!filePath) throw new Error(`${command} requires a file path`);
    const release = getTrustedMediaToolRelease(platform, arch);
    const expected = command === 'verify-package' ? release.package.sha256 : release.payload.sha256;
    const digest = assertTrustedSha256(filePath, expected, command.replace('verify-', 'media '));
    process.stdout.write(`${JSON.stringify({ command, sha256: digest, verified: true })}\n`);
    return;
  }
  if (command === 'verify-tools') {
    const [ffmpegPath, ffprobePath, platform, arch] = values;
    const metadata = verifyTrustedMediaTools(ffmpegPath, ffprobePath, platform, arch);
    validateMediaToolMetadata(metadata);
    process.stdout.write(`${JSON.stringify(metadata)}\n`);
    return;
  }
  if (command === 'write-metadata') {
    const [mediaDirectory, outputPath, platform, arch] = values;
    if (!mediaDirectory || !outputPath) {
      throw new Error('write-metadata requires a media directory and output path');
    }
    const metadata = writeMediaToolMetadata(mediaDirectory, outputPath, platform, arch);
    process.stdout.write(`${JSON.stringify({ output: path.resolve(outputPath), tools: metadata.tools.length, verified: true })}\n`);
    return;
  }
  if (command === 'validate-metadata') {
    const [metadataPath] = values;
    if (!metadataPath) throw new Error('validate-metadata requires a JSON file path');
    validateMediaToolMetadata(JSON.parse(fs.readFileSync(metadataPath, 'utf8')));
    process.stdout.write(`${JSON.stringify({ metadata: path.resolve(metadataPath), verified: true })}\n`);
    return;
  }
  throw new Error(`Unknown media tool policy command: ${command || '(missing)'}`);
}

module.exports = {
  assertMediaToolPair,
  assertMediaToolVersion,
  assertTrustedMediaToolFile,
  assertTrustedSha256,
  beforePack,
  getTrustedMediaToolRelease,
  parseMediaToolVersion,
  publicSourceDescriptor,
  requiredMediaToolVersion,
  resolveTrustedMediaTool,
  runCli,
  sha256File,
  trustedMediaToolReleases,
  validateMediaToolMetadata,
  verifyTrustedMediaTools,
  writeMediaToolMetadata,
};

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`[media-policy] FAILED ${error && error.message ? error.message : error}\n`);
    process.exitCode = 1;
  }
}
