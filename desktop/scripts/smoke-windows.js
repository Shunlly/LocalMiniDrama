'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {
  assertMediaToolPair,
  assertMediaToolVersion,
} = require('./media-tool-policy');

const desktopRoot = path.join(__dirname, '..');
const packageJson = require(path.join(desktopRoot, 'package.json'));
const releaseRoot = path.join(desktopRoot, 'release');
const smokeRoot = path.join(releaseRoot, '.smoke');
const mode = process.argv[2] || 'all';
const timeoutMs = Number(process.env.LOCALMINIDRAMA_SMOKE_TIMEOUT_MS) || 120000;
const mediaToolNames = {
  ffmpeg: 'ffmpeg.exe',
  ffprobe: 'ffprobe.exe',
};
const legacyFixture = {
  title: 'Desktop legacy migration smoke fixture',
  assetRelativePath: 'legacy-smoke/visible.txt',
  assetContents: 'legacy media fixture is visible',
};

function log(message) {
  process.stdout.write(`[smoke] ${message}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sameOriginWriteHeaders(port) {
  const normalizedPort = Number(port);
  if (!Number.isSafeInteger(normalizedPort) || normalizedPort <= 0 || normalizedPort > 65535) {
    throw new Error('Desktop smoke requires a valid loopback port');
  }
  return {
    Origin: `http://127.0.0.1:${normalizedPort}`,
    'Sec-Fetch-Site': 'same-origin',
  };
}

async function removeTreeWithRetry(target, waitMs = 30000) {
  const deadline = Date.now() + waitMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
      if (!fs.existsSync(target)) return;
    } catch (err) {
      lastError = err;
    }
    await sleep(500);
  }
  throw lastError || new Error(`Timed out removing ${target}`);
}

function expectedArtifactName(kind) {
  if (!['Setup', 'Portable'].includes(kind)) throw new Error(`Unknown release artifact kind ${kind}`);
  return `LocalMiniDrama-${kind}-${packageJson.version}-x64.exe`;
}

function exactArtifact(kind) {
  const expected = expectedArtifactName(kind);
  const family = new RegExp(`^LocalMiniDrama-${kind}-.*-x64\\.exe$`, 'i');
  const matches = fs.readdirSync(releaseRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && family.test(entry.name))
    .map((entry) => entry.name);
  if (matches.length !== 1 || matches[0] !== expected) {
    throw new Error(`Expected only ${expected}, found ${matches.join(', ') || 'none'}`);
  }
  return path.join(releaseRoot, expected);
}

function findApplicationExe(root) {
  const candidates = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.exe') && !/^unins/i.test(entry.name))
    .map((entry) => path.join(root, entry.name));
  if (candidates.length !== 1) {
    throw new Error(`Expected one application executable in ${root}, found ${candidates.length}`);
  }
  return candidates[0];
}

function verifyMediaTool(label, executable, expectedName) {
  if (!fs.existsSync(executable)) {
    throw new Error(`${label} is missing: ${executable}`);
  }

  const result = spawnSync(executable, ['-version'], {
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    timeout: 10000,
    windowsHide: true,
  });
  if (result.error) throw new Error(`${label} could not execute: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(
      `${label} exited with status ${result.status}: ${String(result.stderr || result.stdout || '').trim()}`
    );
  }

  const output = String(result.stdout || result.stderr || '').trim();
  return assertMediaToolVersion(expectedName, output);
}

function verifyMediaToolDirectory(label, directory) {
  const ffmpeg = path.join(directory, mediaToolNames.ffmpeg);
  const ffprobe = path.join(directory, mediaToolNames.ffprobe);
  const ffmpegVersion = verifyMediaTool(`${label} ffmpeg`, ffmpeg, 'ffmpeg');
  const ffprobeVersion = verifyMediaTool(`${label} ffprobe`, ffprobe, 'ffprobe');
  assertMediaToolPair(ffmpegVersion, ffprobeVersion);
  log(`${label}: media tools OK (${ffmpegVersion.line}; ${ffprobeVersion.line})`);
  return {
    ffmpeg,
    ffprobe,
    ffmpegVersion: ffmpegVersion.line,
    ffprobeVersion: ffprobeVersion.line,
  };
}

function verifyBundledMediaTools(label, executable) {
  return verifyMediaToolDirectory(
    `${label} bundled resources`,
    path.join(path.dirname(executable), 'resources', 'ffmpeg')
  );
}

function requestHttp(port, endpoint, options = {}) {
  return new Promise((resolve, reject) => {
    const payload = options.body === undefined
      ? null
      : Buffer.from(JSON.stringify(options.body), 'utf8');
    const headers = { ...(options.headers || {}) };
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = payload.length;
    }
    const request = http.request({
      hostname: '127.0.0.1',
      port,
      path: endpoint,
      method: options.method || 'GET',
      headers,
      timeout: 2000,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks),
        });
      });
    });
    request.on('timeout', () => request.destroy(new Error(`${endpoint} timed out`)));
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

async function requestJson(port, endpoint, options) {
  const response = await requestHttp(port, endpoint, options);
  try {
    return { ...response, body: JSON.parse(response.body.toString('utf8')) };
  } catch (error) {
    throw new Error(`${endpoint} did not return JSON: ${response.body.toString('utf8').slice(0, 500)}`, {
      cause: error,
    });
  }
}

async function requestText(port, endpoint, options) {
  const response = await requestHttp(port, endpoint, options);
  return { ...response, body: response.body.toString('utf8') };
}

function stopProcessTree(pid) {
  if (!pid) return;
  spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
    stdio: 'ignore',
    windowsHide: true,
    timeout: 30000,
  });
}

function countOccurrences(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

function assertRendererLog(label, startupLog, options = {}) {
  const failure = startupLog.match(/(?:^|\s)(did-fail-load\b[^\r\n]*|renderer error\b[^\r\n]*)/m);
  if (failure) throw new Error(`${label} reported a renderer failure: ${failure[1]}`);
  if (options.requireReady !== false && !/(?:^|\s)window-renderer ready(?:\s|$)/m.test(startupLog)) {
    throw new Error(`${label} did not report renderer readiness`);
  }
}

function assertSuccessfulSpawnResult(label, result) {
  if (result.error) throw new Error(`${label} could not run: ${result.error.message}`, { cause: result.error });
  if (result.status !== 0) {
    const output = String(result.stderr || result.stdout || '').trim();
    const signal = result.signal ? ` signal=${result.signal}` : '';
    throw new Error(`${label} exited with status ${result.status}${signal}${output ? `: ${output}` : ''}`);
  }
  return result.status;
}

async function verifySingleInstance(label, executable, env, startupLog, port) {
  const before = fs.readFileSync(startupLog, 'utf8');
  const backendStarts = countOccurrences(before, /startBackend ok port=\d+/g);
  const receivedEvents = countOccurrences(before, /second-instance received$/gm);
  const focusedEvents = countOccurrences(before, /second-instance focused main window$/gm);
  const deniedLocks = countOccurrences(before, /single-instance lock denied; exiting$/gm);
  if (backendStarts !== 1) {
    throw new Error(`${label} expected exactly one backend before second-instance check, found ${backendStarts}`);
  }

  const second = spawn(executable, [], {
    cwd: path.dirname(executable),
    env,
    detached: false,
    shell: false,
    stdio: 'ignore',
    windowsHide: true,
  });
  const deadline = Date.now() + Math.min(timeoutMs, 30000);

  try {
    while (Date.now() < deadline) {
      const startup = fs.readFileSync(startupLog, 'utf8');
      const currentBackendStarts = countOccurrences(startup, /startBackend ok port=\d+/g);
      if (currentBackendStarts !== backendStarts) {
        throw new Error(`${label} secondary instance started another backend`);
      }

      const received = countOccurrences(startup, /second-instance received$/gm) > receivedEvents;
      const focused = countOccurrences(startup, /second-instance focused main window$/gm) > focusedEvents;
      const denied = countOccurrences(startup, /single-instance lock denied; exiting$/gm) > deniedLocks;
      if (received && focused && denied) {
        const exitDeadline = Date.now() + 10000;
        while (second.exitCode === null && Date.now() < exitDeadline) await sleep(100);
        if (second.exitCode === null) throw new Error(`${label} secondary instance did not exit`);
        if (second.exitCode !== 0) {
          throw new Error(`${label} secondary instance exited with status ${second.exitCode}`);
        }

        const health = await requestJson(port, '/health');
        const ready = await requestJson(port, '/ready');
        assertHealthyResponse(label, health, ready);
        log(
          `${label}: single-instance OK secondaryPid=${second.pid} backendStarts=${currentBackendStarts} focused=true`
        );
        return;
      }
      await sleep(250);
    }

    const startup = fs.readFileSync(startupLog, 'utf8');
    throw new Error(`${label} single-instance verification timed out:\n${startup.slice(-4000)}`);
  } finally {
    stopProcessTree(second.pid);
  }
}

async function launchAndProbe(label, executable, workRoot, options = {}) {
  const appData = path.join(workRoot, 'appdata');
  const localAppData = path.join(workRoot, 'localappdata');
  const temp = path.join(workRoot, 'temp');
  for (const directory of [appData, localAppData, temp]) fs.mkdirSync(directory, { recursive: true });

  const userData = path.join(appData, 'localminidrama-desktop');
  const legacyUserData = path.join(appData, 'LocalMiniDrama');
  const userMediaTools = path.join(userData, 'backend', 'tools', 'ffmpeg');
  if (options.seedLegacyDataFrom) {
    if (fs.existsSync(userData)) {
      throw new Error(`${label} migration fixture target already exists: ${userData}`);
    }
    const legacyData = path.join(legacyUserData, 'backend', 'data');
    fs.mkdirSync(path.dirname(legacyData), { recursive: true });
    fs.cpSync(options.seedLegacyDataFrom, legacyData, {
      recursive: true,
      errorOnExist: true,
      filter: (source) => !/\.maintenance(?:\.recovery)?\.lock$/i.test(source),
    });
    log(`${label}: prepared legacy userData database and media`);
  }

  let seededFfmpegMtimeMs = null;
  if (options.seedFfmpegFrom) {
    verifyMediaTool(`${label} seed ffmpeg`, options.seedFfmpegFrom, 'ffmpeg');
    fs.mkdirSync(userMediaTools, { recursive: true });
    const destination = path.join(userMediaTools, mediaToolNames.ffmpeg);
    fs.copyFileSync(options.seedFfmpegFrom, destination);
    const markerTime = new Date('2001-02-03T04:05:06.000Z');
    fs.utimesSync(destination, markerTime, markerTime);
    seededFfmpegMtimeMs = fs.statSync(destination).mtimeMs;
    const ffprobeDestination = path.join(userMediaTools, mediaToolNames.ffprobe);
    if (fs.existsSync(ffprobeDestination)) {
      throw new Error(`${label} partial userData unexpectedly contains ffprobe before launch`);
    }
    log(`${label}: prepared partial userData with ffmpeg only`);
  }

  const outputPath = path.join(workRoot, 'process.log');
  const output = fs.openSync(outputPath, 'a');
  const env = {
    ...process.env,
    APPDATA: appData,
    LOCALAPPDATA: localAppData,
    LOCALMINIDRAMA_LEGACY_USER_DATA_DIR: legacyUserData,
    LOCALMINIDRAMA_USER_DATA_DIR: userData,
    TEMP: temp,
    TMP: temp,
    ELECTRON_ENABLE_LOGGING: '1',
  };
  delete env.ELECTRON_RUN_AS_NODE;

  log(`${label}: launching ${executable}`);
  const child = spawn(executable, [], {
    cwd: path.dirname(executable),
    env,
    detached: false,
    shell: false,
    stdio: ['ignore', output, output],
    windowsHide: true,
  });
  fs.closeSync(output);

  const startupLog = path.join(appData, 'localminidrama-desktop', 'main-startup.log');
  const deadline = Date.now() + timeoutMs;
  let applicationPid = null;
  let lastProbeError = null;
  try {
    while (Date.now() < deadline) {
      let startup = '';
      if (fs.existsSync(startupLog)) startup = fs.readFileSync(startupLog, 'utf8');
      assertRendererLog(label, startup, { requireReady: false });
      const pids = [...startup.matchAll(/main\.js loaded pid=(\d+)/g)];
      if (pids.length) applicationPid = Number(pids.at(-1)[1]);
      if (/Failed to start backend/.test(startup)) {
        throw new Error(`${label} backend startup failed:\n${startup.slice(-4000)}`);
      }

      const ports = [...startup.matchAll(/startBackend ok port=(\d+)/g)];
      if (ports.length) {
        const port = Number(ports.at(-1)[1]);
        let health;
        let ready;
        let healthy = false;
        try {
          health = await requestJson(port, '/health');
          ready = await requestJson(port, '/ready');
          assertHealthyResponse(label, health, ready);
          healthy = true;
        } catch (err) {
          lastProbeError = err;
          // The listen callback can be logged just before the first request is accepted.
        }
        if (healthy) {
          if (!/(?:^|\s)window-renderer ready(?:\s|$)/m.test(startup)) {
            await sleep(250);
            continue;
          }
          if (options.expectLegacyMigration) {
            if (!/migrated legacy userData directory/.test(startup)) {
              throw new Error(
                `${label} did not report legacy userData migration:\n${startup.slice(-4000)}`
              );
            }
            if (fs.existsSync(legacyUserData)) {
              throw new Error(`${label} left the legacy userData directory in place`);
            }
          }
          verifyMediaToolDirectory(`${label} userData`, userMediaTools);
          if (seededFfmpegMtimeMs !== null) {
            const destination = path.join(userMediaTools, mediaToolNames.ffmpeg);
            const currentMtimeMs = fs.statSync(destination).mtimeMs;
            if (Math.abs(currentMtimeMs - seededFfmpegMtimeMs) > 1) {
              throw new Error(`${label} replaced the pre-existing ffmpeg binary`);
            }
            log(`${label}: existing ffmpeg preserved while missing ffprobe was restored`);
          }
          if (options.onReady) await options.onReady({ label, port, userData });
          await verifySingleInstance(label, executable, env, startupLog, port);
          const finalStartup = fs.readFileSync(startupLog, 'utf8');
          assertRendererLog(label, finalStartup);
          log(`${label}: OK pid=${child.pid} port=${port} health=${health.body.status} ready=${ready.body.status}`);
          return { port, health: health.body, ready: ready.body, userData, startupLog };
        }
      }

      if (child.exitCode !== null && child.exitCode !== 0 && !applicationPid) {
        const processOutput = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
        throw new Error(`${label} exited before becoming healthy (code ${child.exitCode}):\n${processOutput.slice(-4000)}`);
      }
      await sleep(500);
    }

    const startup = fs.existsSync(startupLog) ? fs.readFileSync(startupLog, 'utf8') : '(startup log not created)';
    const processOutput = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
    const probe = lastProbeError ? `\nLast probe error: ${lastProbeError.message}` : '';
    throw new Error(`${label} health check timed out:${probe}\n${startup.slice(-3000)}\n${processOutput.slice(-3000)}`);
  } finally {
    stopProcessTree(applicationPid);
    stopProcessTree(child.pid);
    log(`${label}: process cleanup complete`);
  }
}

function assertHealthyResponse(label, health, ready) {
  if (health.statusCode !== 200 || health.body.status !== 'ok') {
    throw new Error(`${label} /health returned ${health.statusCode}: ${JSON.stringify(health.body)}`);
  }
  if (health.body.version !== packageJson.version) {
    throw new Error(
      `${label} /health version ${JSON.stringify(health.body.version)} does not match package ${packageJson.version}`
    );
  }
  if (ready.statusCode !== 200 || ready.body.status !== 'ready') {
    throw new Error(`${label} /ready returned ${ready.statusCode}: ${JSON.stringify(ready.body)}`);
  }
}

async function seedLegacyMigrationFixture({ label, port, userData }) {
  const created = await requestJson(port, '/api/v1/dramas', {
    method: 'POST',
    headers: sameOriginWriteHeaders(port),
    body: { title: legacyFixture.title },
  });
  if (created.statusCode !== 201 || created.body.success !== true) {
    throw new Error(`${label} could not seed legacy database: ${JSON.stringify(created.body)}`);
  }

  const asset = path.join(
    userData,
    'backend',
    'data',
    'storage',
    ...legacyFixture.assetRelativePath.split('/')
  );
  fs.mkdirSync(path.dirname(asset), { recursive: true });
  fs.writeFileSync(asset, legacyFixture.assetContents);
  const served = await requestText(port, `/static/${legacyFixture.assetRelativePath}`);
  if (served.statusCode !== 200 || served.body !== legacyFixture.assetContents) {
    throw new Error(`${label} could not serve the legacy media fixture before migration`);
  }
  log(`${label}: seeded database row and static media for migration`);
}

async function verifyLegacyMigrationFixture({ label, port, userData }) {
  const dramas = await requestJson(
    port,
    `/api/v1/dramas?keyword=${encodeURIComponent(legacyFixture.title)}&page_size=100`
  );
  const items = dramas.body && dramas.body.data && dramas.body.data.items;
  if (
    dramas.statusCode !== 200 ||
    dramas.body.success !== true ||
    !Array.isArray(items) ||
    !items.some((item) => item.title === legacyFixture.title)
  ) {
    throw new Error(`${label} could not see the migrated database row: ${JSON.stringify(dramas.body)}`);
  }

  const served = await requestText(port, `/static/${legacyFixture.assetRelativePath}`);
  if (served.statusCode !== 200 || served.body !== legacyFixture.assetContents) {
    throw new Error(`${label} could not serve migrated media: status=${served.statusCode}`);
  }

  const database = path.join(userData, 'backend', 'data', 'drama_generator.db');
  const asset = path.join(
    userData,
    'backend',
    'data',
    'storage',
    ...legacyFixture.assetRelativePath.split('/')
  );
  if (!fs.existsSync(database) || !fs.existsSync(asset)) {
    throw new Error(`${label} migrated database or media is missing from the new userData path`);
  }
  log(`${label}: migrated database row and static media are visible`);
}

async function smokeUnpacked() {
  const executable = findApplicationExe(path.join(releaseRoot, 'win-unpacked'));
  const bundledTools = verifyBundledMediaTools('unpacked', executable);
  const fresh = await launchAndProbe(
    'unpacked-fresh',
    executable,
    path.join(smokeRoot, 'unpacked-fresh'),
    { onReady: seedLegacyMigrationFixture }
  );
  await launchAndProbe(
    'unpacked-legacy-user-data',
    executable,
    path.join(smokeRoot, 'unpacked-legacy-user-data'),
    {
      seedLegacyDataFrom: path.join(fresh.userData, 'backend', 'data'),
      expectLegacyMigration: true,
      onReady: verifyLegacyMigrationFixture,
    }
  );
  await launchAndProbe(
    'unpacked-ffmpeg-only',
    executable,
    path.join(smokeRoot, 'unpacked-ffmpeg-only'),
    { seedFfmpegFrom: bundledTools.ffmpeg }
  );
}

async function smokePortable() {
  const executable = exactArtifact('Portable');
  await launchAndProbe('portable-fresh', executable, path.join(smokeRoot, 'portable-fresh'));
}

async function smokeInstaller() {
  const installer = exactArtifact('Setup');
  const workRoot = path.join(smokeRoot, 'installer');
  const installRoot = path.join(workRoot, 'installed');
  fs.mkdirSync(workRoot, { recursive: true });

  log(`installer: silent install ${installer}`);
  const install = spawnSync(installer, ['/S', `/D=${installRoot}`], {
    cwd: releaseRoot,
    encoding: 'utf8',
    windowsHide: true,
    timeout: timeoutMs,
  });
  assertSuccessfulSpawnResult('Installer', install);

  try {
    const executable = findApplicationExe(installRoot);
    verifyBundledMediaTools('installer', executable);
    await launchAndProbe('installer-fresh', executable, path.join(workRoot, 'runtime'));
  } finally {
    const uninstaller = fs.existsSync(installRoot)
      ? fs.readdirSync(installRoot)
        .find((entry) => /^unins.*\.exe$/i.test(entry))
      : null;
    if (!uninstaller) throw new Error(`Installer did not create an uninstaller in ${installRoot}`);

    log('installer: silent uninstall');
    try {
      const uninstall = spawnSync(path.join(installRoot, uninstaller), ['/S'], {
        cwd: releaseRoot,
        encoding: 'utf8',
        windowsHide: true,
        timeout: timeoutMs,
      });
      const exitCode = assertSuccessfulSpawnResult('Uninstaller', uninstall);
      log(`installer: uninstaller exit status ${exitCode}`);
    } finally {
      await removeTreeWithRetry(installRoot);
    }
  }
}

async function main() {
  if (process.platform !== 'win32') throw new Error('Windows artifact smoke tests require Windows');
  if (!['unpacked', 'portable', 'installer', 'all'].includes(mode)) {
    throw new Error(`Unknown smoke mode ${mode}`);
  }

  await removeTreeWithRetry(smokeRoot);
  fs.mkdirSync(smokeRoot, { recursive: true });
  try {
    if (mode === 'unpacked' || mode === 'all') await smokeUnpacked();
    if (mode === 'portable' || mode === 'all') await smokePortable();
    if (mode === 'installer' || mode === 'all') await smokeInstaller();
  } finally {
    await removeTreeWithRetry(smokeRoot);
  }
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[smoke] FAILED ${err && err.stack ? err.stack : err}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  assertRendererLog,
  assertSuccessfulSpawnResult,
  expectedArtifactName,
  sameOriginWriteHeaders,
};
