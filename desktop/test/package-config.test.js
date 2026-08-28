'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const desktopRoot = path.join(__dirname, '..');
const repoRoot = path.join(desktopRoot, '..');
const backendSource = path.join(repoRoot, 'backend-node');
const backendCopy = path.join(desktopRoot, 'backend-app');
const packageJson = require('../package.json');
const packageLock = require('../package-lock.json');
const backendPackage = require('../../backend-node/package.json');
const {
  DIRECTORY_ALLOWLIST,
  FILE_ALLOWLIST,
  isAllowedBackendFile,
} = require('../scripts/copy-backend');
const releaseWorkflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'release.yml'), 'utf8');
const rebuildNativeSource = fs.readFileSync(path.join(desktopRoot, 'scripts', 'rebuild-native.js'), 'utf8');
const desktopNpmrc = fs.readFileSync(path.join(desktopRoot, '.npmrc'), 'utf8');
const electronRuntimeVerifier = fs.readFileSync(path.join(desktopRoot, 'scripts', 'verify-electron-runtime.js'), 'utf8');

function listFiles(root) {
  const files = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(path.relative(root, absolute));
    }
  };
  visit(root);
  return files.sort();
}

test.before(() => {
  const result = spawnSync(process.execPath, [path.join(desktopRoot, 'scripts', 'copy-backend.js')], {
    cwd: desktopRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('desktop runtime dependencies cover the backend production dependency set', () => {
  for (const dependency of Object.keys(backendPackage.dependencies)) {
    assert.ok(
      Object.hasOwn(packageJson.dependencies, dependency),
      `desktop package is missing backend runtime dependency ${dependency}`
    );
  }

  assert.equal(packageJson.dependencies['@napi-rs/canvas'], '0.1.80');
  assert.equal(packageJson.dependencies['pdfjs-dist'], '4.10.38');
  assert.equal(packageJson.dependencies['better-sqlite3'], '12.11.1');
  assert.equal(packageJson.dependencies.buffer, '6.0.3');
  assert.equal(packageJson.devDependencies.electron, '43.1.1');
  assert.equal(packageJson.devDependencies['electron-builder'], '26.15.3');
  assert.equal(packageJson.devDependencies['node-gyp'], '12.4.0');

  const lockRoot = packageLock.packages[''];
  assert.equal(lockRoot.dependencies['@napi-rs/canvas'], '0.1.80');
  assert.equal(lockRoot.dependencies['pdfjs-dist'], '4.10.38');
  assert.equal(lockRoot.dependencies.buffer, '6.0.3');
  assert.equal(packageLock.packages['node_modules/@napi-rs/canvas'].version, '0.1.80');
  assert.equal(packageLock.packages['node_modules/@napi-rs/canvas-win32-x64-msvc'].version, '0.1.80');
  assert.equal(packageLock.packages['node_modules/pdfjs-dist'].version, '4.10.38');
  assert.equal(packageLock.packages['node_modules/buffer'].version, '6.0.3');
});

test('desktop tooling enforces Electron 43 host and embedded runtime contracts', () => {
  assert.equal(packageJson.engines.node, '>=22.12.0 <23');
  assert.equal(packageJson.devDependencies.electron, '43.1.1');
  assert.equal(packageLock.packages['node_modules/electron'].engines.node, '>= 22.12.0');
  assert.match(desktopNpmrc, /^engine-strict=true$/m);
  assert.equal(packageJson.scripts['verify:electron-runtime'], 'electron scripts/verify-electron-runtime.js');
  assert.match(packageJson.scripts.verify, /npm run verify:electron-runtime/);
  assert.match(electronRuntimeVerifier, /process\.exit\(0\)/);
});

test('native rebuild accepts dependencies that do not export package.json', () => {
  assert.doesNotThrow(() => require.resolve('sharp', { paths: [desktopRoot] }));
  assert.throws(
    () => require.resolve('sharp/package.json', { paths: [desktopRoot] }),
    (error) => error?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED'
  );
  assert.doesNotMatch(rebuildNativeSource, /require\.resolve\(`\$\{name\}\/package\.json`/);
  assert.match(
    rebuildNativeSource,
    /require\.resolve\(name,\s*\{\s*paths:\s*\[desktopRoot\]\s*\}\)/
  );
});

test('sharp WASM leaf remains an exact development-only dependency for npm tree integrity', () => {
  const sharpVersion = packageLock.packages['node_modules/sharp'].version;
  assert.equal(packageJson.devDependencies['@img/sharp-wasm32'], sharpVersion);
  assert.equal(Object.hasOwn(packageJson.dependencies, '@img/sharp-wasm32'), false);
  assert.equal(packageLock.packages[''].devDependencies['@img/sharp-wasm32'], sharpVersion);
  assert.equal(packageLock.packages['node_modules/@img/sharp-wasm32'].version, sharpVersion);
});

test('copied backend contains all and only allowlisted runtime resources', () => {
  for (const rule of DIRECTORY_ALLOWLIST) {
    const sourceRoot = path.join(backendSource, rule.relativePath);
    const copiedRoot = path.join(backendCopy, rule.relativePath);
    assert.ok(fs.statSync(copiedRoot).isDirectory(), `${rule.relativePath} was not copied`);
    for (const relative of listFiles(sourceRoot)) {
      if (!rule.extensions.includes(path.extname(relative).toLowerCase())) continue;
      const source = path.join(sourceRoot, relative);
      const copied = path.join(copiedRoot, relative);
      assert.ok(fs.existsSync(copied), `backend resource is missing: ${rule.relativePath}/${relative}`);
      assert.deepEqual(fs.readFileSync(copied), fs.readFileSync(source));
    }
  }

  for (const relative of FILE_ALLOWLIST) {
    assert.ok(fs.existsSync(path.join(backendCopy, relative)), `${relative} was not generated`);
  }
  const runtimeConfig = require('js-yaml').load(
    fs.readFileSync(path.join(backendCopy, 'configs', 'config.yaml'), 'utf8')
  );
  assert.equal(runtimeConfig.app.version, backendPackage.version);
  assert.equal(runtimeConfig.app.debug, false);
  assert.equal(runtimeConfig.vendor_lock.enabled, false);
  assert.equal(runtimeConfig.image_proxy.upload_url, '');
  assert.equal(JSON.stringify(runtimeConfig).includes('api_key'), false);

  const copiedFiles = listFiles(backendCopy);
  assert.ok(copiedFiles.every(isAllowedBackendFile));
  const skillPrompts = listFiles(path.join(backendCopy, 'prompts', 'skills'));
  assert.ok(skillPrompts.length > 0);
  assert.ok(skillPrompts.every((file) => file.endsWith('.md')));
  assert.ok(fs.existsSync(path.join(backendCopy, 'src', 'app.js')));
  assert.ok(fs.existsSync(path.join(backendCopy, 'configs', 'config.yaml')));
  assert.equal(fs.existsSync(path.join(backendCopy, 'scripts')), false);
  assert.equal(fs.existsSync(path.join(backendCopy, 'data')), false);
});

test('packaging includes runtime code, native binaries, and distinct Windows artifacts', () => {
  const build = packageJson.build;
  const iconPath = path.join(desktopRoot, build.win.icon);
  const iconBytes = fs.readFileSync(iconPath);
  assert.equal(build.npmRebuild, false);
  assert.ok(build.files.includes('scripts/url-security.js'));
  assert.ok(build.files.includes('scripts/single-instance.js'));
  assert.ok(build.files.includes('scripts/shutdown-controller.js'));
  assert.ok(build.files.includes('scripts/user-data-migration.js'));
  assert.deepEqual(
    build.files.filter((entry) => entry.startsWith('backend-app/')).sort(),
    [
      'backend-app/configs/config.yaml',
      'backend-app/migrations/**/*.sql',
      'backend-app/prompts/**/*.md',
      'backend-app/src/**/*.js',
    ]
  );
  assert.ok(!build.files.includes('backend-app/**/*'));
  assert.ok(build.files.includes('node_modules/**/*'));
  assert.ok(build.asarUnpack.includes('node_modules/better-sqlite3/**'));
  assert.ok(build.asarUnpack.includes('node_modules/sharp/**'));
  assert.ok(build.asarUnpack.includes('node_modules/@napi-rs/canvas/**'));
  assert.ok(build.asarUnpack.includes('node_modules/@napi-rs/canvas-*/**'));
  assert.deepEqual(build.win.target, ['nsis', 'portable']);
  assert.equal(build.win.signExecutable, false);
  assert.ok(!Object.hasOwn(build.win, 'signAndEditExecutable'));
  assert.equal(build.win.icon, 'build/icon.png');
  assert.deepEqual(iconBytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(iconBytes.readUInt32BE(16), 1024);
  assert.equal(iconBytes.readUInt32BE(20), 1024);
  assert.notEqual(build.nsis.artifactName, build.portable.artifactName);
  assert.match(build.nsis.artifactName, /Setup/);
  assert.match(build.portable.artifactName, /Portable/);
});

test('release metadata is valid UTF-8 and not inherited from Electron', () => {
  assert.equal(packageJson.description, 'LocalMiniDrama 本地桌面客户端');
  assert.equal(packageJson.build.productName, '本地短剧助手');
  assert.equal(packageJson.author, 'LocalMiniDrama');
});

test('Windows release smoke commands are stable for CI', () => {
  assert.equal(packageJson.scripts['smoke:unpacked'], 'node scripts/smoke-windows.js unpacked');
  assert.equal(packageJson.scripts['smoke:portable'], 'node scripts/smoke-windows.js portable');
  assert.equal(packageJson.scripts['smoke:installer'], 'node scripts/smoke-windows.js installer');
  assert.equal(packageJson.scripts['smoke:windows'], 'node scripts/smoke-windows.js all');
  assert.equal(packageJson.scripts['verify:deps'], 'node scripts/verify-dependency-tree.js');
  assert.match(packageJson.scripts.test, /test\/shutdown-controller\.test\.js/);
  assert.match(packageJson.scripts.test, /test\/main-lifecycle\.test\.js/);
  assert.match(packageJson.scripts.test, /test\/copy-backend\.test\.js/);
  assert.match(packageJson.scripts.test, /test\/user-data-migration\.test\.js/);
  assert.match(packageJson.scripts.test, /test\/smoke-windows\.test\.js/);
  assert.match(packageJson.scripts.verify, /node --check scripts\/shutdown-controller\.js/);
  assert.match(packageJson.scripts.verify, /node --check scripts\/user-data-migration\.js/);
  assert.match(packageJson.scripts.verify, /node --check scripts\/window-shell\.js/);
  assert.ok(packageJson.build.files.includes('scripts/window-shell.js'));
  assert.match(releaseWorkflow, /FFMPEG_PATH=\$ffmpegPath/);
  assert.match(releaseWorkflow, /FFPROBE_PATH=\$ffprobePath/);
  assert.doesNotMatch(releaseWorkflow, /Copy-Item[\s\S]*backend-node[\\/]tools[\\/]ffmpeg/);
});

test('unverifiable alternate packaging entry points stay disabled', () => {
  const distCn = fs.readFileSync(path.join(desktopRoot, 'scripts', 'dist-cn.js'), 'utf8');
  const distMac = fs.readFileSync(path.join(desktopRoot, 'dist-mac.sh'), 'utf8');
  assert.equal(fs.existsSync(path.join(desktopRoot, 'electron-builder-lite.json')), false);
  assert.equal(fs.existsSync(path.join(desktopRoot, 'electron-builder-mac-lite.json')), false);
  assert.equal(fs.existsSync(path.join(desktopRoot, 'electron-builder-mac.json')), false);
  assert.doesNotMatch(distCn, /electron-builder-lite|Lite|纯净版/);
  assert.doesNotMatch(distMac, /electron-builder-mac-lite|Lite|纯净版/);
});

test('production Electron fuses disable runtime injection paths', () => {
  assert.deepEqual(packageJson.build.electronFuses, {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    loadBrowserProcessSpecificV8Snapshot: false,
    grantFileProtocolExtraPrivileges: false,
  });
});

test('packaged desktop starts the embedded backend in production mode', () => {
  const source = fs.readFileSync(path.join(desktopRoot, 'main.js'), 'utf8');
  const startBackendSource = source.slice(source.indexOf('async function startBackend()'));
  const packagedBranch = startBackendSource.slice(
    startBackendSource.indexOf('if (app.isPackaged) {'),
    startBackendSource.indexOf('} else {')
  );
  assert.match(packagedBranch, /process\.env\.NODE_ENV\s*=\s*['"]production['"]/);
  assert.ok(
    startBackendSource.indexOf('process.env.NODE_ENV') < startBackendSource.indexOf("require(path.join(backendModulePath, 'src', 'app.js'))"),
    'NODE_ENV must be set before the embedded Express app is required'
  );
});
