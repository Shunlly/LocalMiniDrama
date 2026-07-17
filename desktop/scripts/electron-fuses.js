'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FUSE_POLICY = Object.freeze({
  RunAsNode: false,
  EnableCookieEncryption: true,
  EnableNodeOptionsEnvironmentVariable: false,
  EnableNodeCliInspectArguments: false,
  EnableEmbeddedAsarIntegrityValidation: true,
  OnlyLoadAppFromAsar: true,
  LoadBrowserProcessSpecificV8Snapshot: false,
  GrantFileProtocolExtraPrivileges: false,
  WasmTrapHandlers: false,
});

function findWindowsExecutable(appOutDir) {
  const candidates = fs.readdirSync(appOutDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.exe'))
    .map((entry) => path.join(appOutDir, entry.name));
  if (candidates.length !== 1) {
    throw new Error(`Expected one packaged application executable in ${appOutDir}, found ${candidates.length}`);
  }
  return candidates[0];
}

async function applyElectronFusePolicy(context) {
  if (context?.electronPlatformName !== 'win32') {
    throw new Error('The verified 1.3.0 desktop release policy currently supports Windows only');
  }
  const {
    flipFuses,
    FuseVersion,
    FuseV1Options,
  } = require('@electron/fuses');
  const executable = findWindowsExecutable(context.appOutDir);
  const config = {
    version: FuseVersion.V1,
    strictlyRequireAllFuses: true,
  };
  for (const [name, enabled] of Object.entries(FUSE_POLICY)) {
    const option = FuseV1Options[name];
    if (!Number.isInteger(option)) throw new Error(`Unsupported Electron fuse policy key: ${name}`);
    config[option] = enabled;
  }
  await flipFuses(executable, config);
}

module.exports = applyElectronFusePolicy;
module.exports.FUSE_POLICY = FUSE_POLICY;
module.exports.findWindowsExecutable = findWindowsExecutable;
