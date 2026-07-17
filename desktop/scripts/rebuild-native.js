'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const desktopRoot = path.join(__dirname, '..');
const electronRoot = path.join(desktopRoot, 'node_modules', 'electron');
const sqliteRoot = path.join(desktopRoot, 'node_modules', 'better-sqlite3');
const verifyScript = path.join(__dirname, 'verify-native-deps.js');
const electronVersion = require(path.join(electronRoot, 'package.json')).version;
const electronAbi = fs.readFileSync(path.join(electronRoot, 'abi_version'), 'utf8').trim();
const sqlitePackage = require(path.join(sqliteRoot, 'package.json'));
const targetPlatform = process.env.npm_config_platform || process.platform;
const targetArch = process.env.npm_config_arch || process.arch;

function assertRuntimePackagesInstalled() {
  const required = [
    'better-sqlite3',
    'sharp',
    '@napi-rs/canvas',
    'pdfjs-dist',
  ];
  for (const name of required) {
    try {
      require.resolve(`${name}/package.json`, { paths: [desktopRoot] });
    } catch (err) {
      throw new Error(`Missing desktop runtime dependency ${name}; run npm install first`, { cause: err });
    }
  }
}

function linuxLibcSuffix() {
  if (targetPlatform !== 'linux') return '';
  const report = process.report && process.report.getReport ? process.report.getReport() : null;
  return report && report.header && report.header.glibcVersionRuntime ? '' : 'musl';
}

function tryOfficialPrebuild() {
  const downloadPrebuild = require('prebuild-install/download');
  const createLogger = require('prebuild-install/log');
  const platform = `${targetPlatform}${linuxLibcSuffix()}`;
  const asset = `better-sqlite3-v${sqlitePackage.version}-electron-v${electronAbi}-${platform}-${targetArch}.tar.gz`;
  const url = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${sqlitePackage.version}/${asset}`;
  const opts = {
    pkg: sqlitePackage,
    path: sqliteRoot,
    target: electronVersion,
    runtime: 'electron',
    abi: electronAbi,
    platform: targetPlatform,
    arch: targetArch,
    libc: linuxLibcSuffix(),
    proxy: process.env.npm_config_proxy || process.env.HTTPS_PROXY || process.env.HTTP_PROXY,
    'https-proxy': process.env.npm_config_https_proxy || process.env.HTTPS_PROXY,
    'local-prebuilds': 'prebuilds',
  };
  opts.log = createLogger(opts, process.env);

  return new Promise((resolve) => {
    downloadPrebuild(url, opts, (err, resolved) => {
      if (err) {
        process.stdout.write(`[native] No official prebuild for Electron ABI ${electronAbi}; compiling from source\n`);
        resolve(false);
        return;
      }
      process.stdout.write(`[native] Installed official prebuild ${resolved}\n`);
      resolve(true);
    });
  });
}

function compileFromSource() {
  const nodeGyp = require.resolve('node-gyp/bin/node-gyp.js');
  const args = [
    nodeGyp,
    'rebuild',
    '--release',
    `--target=${electronVersion}`,
    `--arch=${targetArch}`,
    '--dist-url=https://electronjs.org/headers',
  ];
  const result = spawnSync(process.execPath, args, {
    cwd: sqliteRoot,
    env: process.env,
    stdio: 'inherit',
    shell: false,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

function verifyWithElectron() {
  if (targetPlatform !== process.platform || targetArch !== process.arch) {
    process.stdout.write(
      `[native] Skipping execution check for cross-target ${targetPlatform}-${targetArch} on ${process.platform}-${process.arch}\n`
    );
    return;
  }

  const electronExecutable = require('electron');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(electronExecutable, [verifyScript], {
    cwd: desktopRoot,
    env,
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Electron native dependency verification exited with status ${result.status}`);
  }
}

process.stdout.write(
  `[native] Preparing better-sqlite3 ${sqlitePackage.version} for Electron ${electronVersion} ABI ${electronAbi}\n`
);
assertRuntimePackagesInstalled();
tryOfficialPrebuild().then((installed) => {
  if (!installed) compileFromSource();
  verifyWithElectron();
}).catch((err) => {
  process.stderr.write(`[native] Rebuild failed: ${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});
