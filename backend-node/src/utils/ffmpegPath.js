/**
 * 解析 ffmpeg / ffprobe 可执行路径。查找优先级：
 * 1. 环境变量 FFMPEG_PATH / FFPROBE_PATH
 * 2. process.cwd()/tools/ffmpeg/  ← 打包后 cwd = userData/backend，用户可在此放置 ffmpeg
 * 3. exe 同级目录/tools/ffmpeg/   ← 用户把 ffmpeg 放在 exe 旁边的 tools/ffmpeg 目录
 * 4. exe 同级目录（直接放在 exe 旁边）
 * 5. 源码目录 backend-node/tools/ffmpeg/（开发时）
 * 6. 系统 PATH 中的 ffmpeg（兜底）
 */
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const isWin = process.platform === 'win32';
const ffmpegName = isWin ? 'ffmpeg.exe' : 'ffmpeg';
const ffprobeName = isWin ? 'ffprobe.exe' : 'ffprobe';

/** backend-node 根目录（源码开发时有效；打包后指向 asar 内部，仅作兜底） */
const backendRoot = path.resolve(__dirname, '..', '..');
const toolsFfmpegDir = path.join(backendRoot, 'tools', 'ffmpeg');

/**
 * 返回所有候选查找路径（按优先级排列，不含环境变量）。
 * 打包后 process.cwd() = userData/backend；process.execPath = 实际 exe 路径。
 */
function getCandidatePaths(name) {
  const candidates = [];
  // cwd/tools/ffmpeg — 打包后为 userData/backend/tools/ffmpeg，用户可在此放置 ffmpeg
  candidates.push(path.join(process.cwd(), 'tools', 'ffmpeg', name));
  // exe 同级/tools/ffmpeg — 用户把 ffmpeg 放在 exe 旁边的 tools/ffmpeg 目录
  try {
    const exeDir = path.dirname(process.execPath);
    candidates.push(path.join(exeDir, 'tools', 'ffmpeg', name));
    // exe 同级直接放
    candidates.push(path.join(exeDir, name));
  } catch (_) {}
  // 源码目录（开发时）
  candidates.push(path.join(toolsFfmpegDir, name));
  return candidates;
}

function resolveFfmpegBin(name) {
  const fromEnv = process.env[name === ffmpegName ? 'FFMPEG_PATH' : 'FFPROBE_PATH'];
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  for (const p of getCandidatePaths(name)) {
    if (fs.existsSync(p)) return p;
  }
  return name; // 兜底：依赖系统 PATH
}

/**
 * 返回 ffmpeg 可执行路径（用于 spawn/exec）。
 */
function getFfmpegPath() {
  return resolveFfmpegBin(ffmpegName);
}

/**
 * 返回 ffprobe 可执行路径。
 */
function getFfprobePath() {
  return resolveFfmpegBin(ffprobeName);
}

function checkMediaBinary(bin, expectedName) {
  const result = spawnSync(bin, ['-version'], {
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    timeout: 5000,
    windowsHide: true,
  });
  if (result.error) {
    return { ok: false, path: bin, error: result.error.message };
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim().slice(-500);
    return { ok: false, path: bin, error: detail || `${expectedName} 退出码 ${result.status}` };
  }
  const output = String(result.stdout || result.stderr || '').trim();
  if (!new RegExp(`^${expectedName} version\\b`, 'i').test(output)) {
    return { ok: false, path: bin, error: `${bin} 不是有效的 ${expectedName} 可执行文件` };
  }
  return { ok: true, path: bin, version: output.split(/\r?\n/, 1)[0] };
}

/** 实际执行 ffmpeg 与 ffprobe，避免仅凭路径存在误判可用性。 */
function validateFfmpegTools() {
  const ffmpeg = checkMediaBinary(getFfmpegPath(), 'ffmpeg');
  const ffprobe = checkMediaBinary(getFfprobePath(), 'ffprobe');
  const errors = [];
  if (!ffmpeg.ok) errors.push(`ffmpeg unavailable: ${ffmpeg.error}`);
  if (!ffprobe.ok) errors.push(`ffprobe unavailable: ${ffprobe.error}`);
  return {
    ok: ffmpeg.ok && ffprobe.ok,
    ffmpeg,
    ffprobe,
    error: errors.length ? errors.join('; ') : null,
  };
}

/** 返回当前 ffmpeg 构建中可用的编码器名称。 */
function getAvailableFfmpegEncoders() {
  const bin = getFfmpegPath();
  const check = checkMediaBinary(bin, 'ffmpeg');
  if (!check.ok) return { ok: false, encoders: [], error: check.error };

  const result = spawnSync(bin, ['-hide_banner', '-encoders'], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    timeout: 10000,
    windowsHide: true,
  });
  if (result.error) return { ok: false, encoders: [], error: result.error.message };
  if (result.status !== 0) {
    return {
      ok: false,
      encoders: [],
      error: String(result.stderr || result.stdout || '').trim().slice(-500) || `ffmpeg 退出码 ${result.status}`,
    };
  }

  const encoders = [];
  const output = String(result.stdout || result.stderr || '');
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*[VAS][A-Z.]{5}\s+(\S+)/);
    if (match) encoders.push(match[1]);
  }
  return { ok: true, encoders, error: null };
}

/**
 * 是否能找到本地 ffmpeg（找到任意候选路径、环境变量或系统 PATH 中存在即为 true）。
 */
function hasLocalFfmpeg() {
  return checkMediaBinary(getFfmpegPath(), 'ffmpeg').ok;
}

function hasLocalFfprobe() {
  return checkMediaBinary(getFfprobePath(), 'ffprobe').ok;
}

module.exports = {
  getFfmpegPath,
  getFfprobePath,
  hasLocalFfmpeg,
  hasLocalFfprobe,
  validateFfmpegTools,
  getAvailableFfmpegEncoders,
  toolsFfmpegDir,
};
