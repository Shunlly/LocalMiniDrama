'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const releaseDir = path.join(__dirname, '..', 'release');

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

function stopWindowsAppProcesses() {
  if (process.platform !== 'win32') return;
  const ps = [
    "$root = [IO.Path]::GetFullPath($env:LOCALMINIDRAMA_RELEASE_DIR).TrimEnd('\\') + '\\'",
    'Get-CimInstance Win32_Process |',
    'Where-Object {',
    '  $_.ExecutablePath -and',
    '  [IO.Path]::GetFullPath($_.ExecutablePath).StartsWith($root, [StringComparison]::OrdinalIgnoreCase)',
    '} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }',
  ].join(' ');
  spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    stdio: 'ignore',
    timeout: 15000,
    windowsHide: true,
    env: { ...process.env, LOCALMINIDRAMA_RELEASE_DIR: releaseDir },
  });
}

function removeDir(dir) {
  if (!fs.existsSync(dir)) {
    log('[clean] release directory not found, skip');
    return true;
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
    log('[clean] release directory removed');
    return true;
  } catch (err) {
    const stale = `${dir}.stale-${Date.now()}`;
    try {
      fs.renameSync(dir, stale);
      log(`[clean] could not delete release directory, renamed to ${path.basename(stale)}`);
      return true;
    } catch (renameErr) {
      log(`[clean] FAILED: ${err.message}`);
      log('[clean] Close running LocalMiniDrama exe and Explorer windows under desktop/release, then retry.');
      log('[clean] Or reboot if antivirus is scanning app.asar.');
      return false;
    }
  }
}

stopWindowsAppProcesses();
if (!removeDir(releaseDir)) process.exit(1);
log('[clean] ready for electron-builder');
