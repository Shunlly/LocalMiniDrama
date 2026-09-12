/**
 * 整集后处理用到的 FFmpeg/探测/音频轨工具。
 */
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const { getFfmpegPath, getFfprobePath } = require('../utils/ffmpegPath');
const uploadService = require('./uploadService');
const { toUserFacingProcessError } = require('./providerErrorSanitizer');

const MAX_STORED_AUDIO_BYTES = 256 * 1024 * 1024;
const PROCESS_OUTPUT_LIMIT_BYTES = 16 * 1024 * 1024;
const FFMPEG_TIMEOUT_MS = 30 * 60 * 1000;
const FFPROBE_TIMEOUT_MS = 15 * 1000;
const PROCESS_KILL_GRACE_MS = 1000;
const POST_PROCESS_FFMPEG_MISSING = '未找到 ffmpeg，请确认已安装 ffmpeg 后重试';
const POST_PROCESS_FALLBACK = '视频后处理失败，请确认已安装 ffmpeg 后重试';

function isSpawnMissingBinary(error) {
  if (!error) return false;
  if (error.code === 'ENOENT' || error.code === 'FFMPEG_MISSING') return true;
  const text = typeof error === 'string' ? error : String(error.message || '');
  return /\bENOENT\b/.test(text);
}

function missingFfmpegError() {
  const error = new Error(POST_PROCESS_FFMPEG_MISSING);
  error.code = 'FFMPEG_MISSING';
  return error;
}

function userFacingPostProcessError(error, fallback = POST_PROCESS_FALLBACK) {
  if (isSpawnMissingBinary(error)) return POST_PROCESS_FFMPEG_MISSING;
  return toUserFacingProcessError(error, fallback);
}

function assertMediaBinaryResult(result) {
  if (!result) return result;
  if (result.code === 'ENOENT' || result.error === POST_PROCESS_FFMPEG_MISSING || isSpawnMissingBinary(result.error)) {
    throw missingFfmpegError();
  }
  return result;
}

function failedProcessResult(error, stdout, stderr) {
  return {
    ok: false,
    error: userFacingPostProcessError(error, POST_PROCESS_FALLBACK),
    stdout,
    stderr,
    status: null,
    code: error?.code || null,
  };
}

function operationCancelledError(reason) {
  if (reason instanceof Error && reason.code === 'OPERATION_CANCELLED') return reason;
  const error = new Error(reason instanceof Error ? reason.message : String(reason || '操作已取消'));
  error.name = 'AbortError';
  error.code = 'OPERATION_CANCELLED';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw operationCancelledError(signal.reason);
}

function normalizePositiveMs(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function runExternalProcess(command, args, options = {}) {
  const signal = options.signal;
  throwIfAborted(signal);
  const timeoutMs = normalizePositiveMs(options.timeoutMs, FFMPEG_TIMEOUT_MS);
  const killGraceMs = normalizePositiveMs(options.killGraceMs, PROCESS_KILL_GRACE_MS);
  const outputLimit = Math.max(1024, Number(options.outputLimitBytes) || PROCESS_OUTPUT_LIMIT_BYTES);

  return new Promise((resolve, reject) => {
    let child;
    let settled = false;
    let stdout = '';
    let stderr = '';
    let timeoutTimer;
    let forceSettleTimer;
    let terminal = null;

    const appendOutput = (current, chunk) => {
      const next = current + String(chunk || '');
      return next.length > outputLimit ? next.slice(-outputLimit) : next;
    };
    const cleanup = () => {
      clearTimeout(timeoutTimer);
      clearTimeout(forceSettleTimer);
      signal?.removeEventListener('abort', onAbort);
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const settleTerminal = () => {
      if (terminal?.type === 'abort') {
        finish(reject, terminal.error);
        return;
      }
      finish(resolve, {
        ok: false,
        error: typeof terminal?.error === 'string'
          ? terminal.error
          : `${options.timeoutLabel || '后处理进程'} 执行超时`,
        stdout,
        stderr,
        status: null,
        signal: 'SIGKILL',
        code: null,
      });
    };
    const terminate = (nextTerminal) => {
      if (terminal || settled) return;
      terminal = nextTerminal;
      try {
        if (child && child.exitCode == null && !child.signalCode) child.kill('SIGKILL');
      } catch (_) {}
      if (settled) return;
      forceSettleTimer = setTimeout(settleTerminal, killGraceMs);
    };
    const onAbort = () => terminate({
      type: 'abort',
      error: operationCancelledError(signal?.reason),
    });

    try {
      child = childProcess.spawn(command, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      finish(resolve, failedProcessResult(error, stdout, stderr));
      return;
    }

    child.stdout?.on('data', (chunk) => { stdout = appendOutput(stdout, chunk); });
    child.stderr?.on('data', (chunk) => { stderr = appendOutput(stderr, chunk); });
    child.once('error', (error) => {
      if (terminal) settleTerminal();
      else finish(resolve, failedProcessResult(error, stdout, stderr));
    });
    child.once('close', (code, closeSignal) => {
      if (terminal || signal?.aborted) {
        if (!terminal) onAbort();
        settleTerminal();
        return;
      }
      finish(resolve, {
        ok: code === 0,
        error: code === 0 ? null : 'FFmpeg 执行失败',
        stdout,
        stderr,
        status: code,
        signal: closeSignal,
        code: null,
      });
    });

    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    if (!settled) {
      timeoutTimer = setTimeout(() => terminate({
        type: 'timeout',
        error: `${options.timeoutLabel || '后处理进程'} 执行超时`,
      }), timeoutMs);
    }
  });
}

function publishStagedFiles(files, tempRoot) {
  void tempRoot;
  const publications = [];
  let closed = false;
  const rollback = () => {
    if (closed) return;
    closed = true;
    for (const publication of [...publications].reverse()) publication.rollback();
  };
  try {
    for (const file of files) {
      const { stagedPath, finalPath } = file;
      publications.push(uploadService.publishStagedFile(stagedPath, finalPath));
    }
  } catch (error) {
    rollback();
    throw error;
  }
  return {
    commit() {
      if (closed) return;
      closed = true;
      for (const publication of publications) publication.commit();
    },
    rollback,
  };
}

/*
 * 每个 FFmpeg 输出都先落在 tempRoot，再由 publishStagedFiles 发布；tempRoot 与 storageRoot
 * 必须保持同一文件系统，避免跨盘 rename 把发布退化成复制。
 */
function assertSameStorageDevice(tempRoot, finalPath) {
  const tempDev = fs.statSync(tempRoot).dev;
  const finalDev = fs.statSync(path.dirname(finalPath)).dev;
  if (tempDev !== finalDev) {
    throw new Error('后处理暂存目录与最终目录不在同一文件系统');
  }
}

async function ffprobeDurationSec(filePath, options = {}) {
  const probe = getFfprobePath();
  const r = await runExternalProcess(
    probe,
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
    {
      signal: options.signal,
      timeoutMs: normalizePositiveMs(options.timeoutMs, FFPROBE_TIMEOUT_MS),
      killGraceMs: options.killGraceMs,
      timeoutLabel: '媒体探测',
      outputLimitBytes: 1024 * 1024,
    }
  );
  if (!r.ok) {
    assertMediaBinaryResult(r);
    return null;
  }
  const d = parseFloat(String(r.stdout || '').trim());
  return Number.isFinite(d) && d > 0 ? d : null;
}

function formatSrtTimestamp(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const z = Math.floor(ms % 1000);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${p2(h)}:${p2(m)}:${p2(s)},${String(z).padStart(3, '0')}`;
}

function buildAtempoChain(factor) {
  if (!Number.isFinite(factor) || factor <= 0) return null;
  if (Math.abs(factor - 1) < 0.002) return null;
  const parts = [];
  let f = factor;
  while (f > 2.001) {
    parts.push('atempo=2');
    f /= 2;
  }
  while (f < 0.499) {
    parts.push('atempo=0.5');
    f /= 0.5;
  }
  parts.push(`atempo=${Math.min(2, Math.max(0.5, f))}`);
  return parts.join(',');
}

function escapeFfmpegPath(absPath) {
  let s = path.resolve(absPath).replace(/\\/g, '/');
  if (/^[A-Za-z]:/.test(s)) s = s.replace(/^([A-Za-z]):/, '$1\\:');
  return s.replace(/'/g, "\\'");
}

async function runFfmpeg(args, log, tag, options = {}) {
  const bin = getFfmpegPath();
  const r = await runExternalProcess(bin, args, {
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    killGraceMs: options.killGraceMs,
    timeoutLabel: 'FFmpeg',
  });
  if (!r.ok) {
    log.warn('merged post: ffmpeg failed', {
      tag,
      error: r.error,
      code: r.code,
      stderr: r.stderr?.slice(-1000),
    });
    assertMediaBinaryResult(r);
    return false;
  }
  return true;
}

function copyStoredAudioToTemp(storageRoot, storedPath, targetPath) {
  const raw = storedPath && String(storedPath).trim();
  if (!raw) return false;
  let opened;
  try {
    opened = uploadService.openStorageFile(storageRoot, raw);
  } catch (error) {
    if (error?.code === 'UNSAFE_MEDIA_REFERENCE' && error?.reason === 'NOT_FOUND') return false;
    throw error;
  }
  let targetFd;
  let completed = false;
  try {
    if (!opened.stat.isFile() || opened.stat.size <= 0 || opened.stat.size > MAX_STORED_AUDIO_BYTES) {
      throw new Error('本地音频文件为空或超过大小限制，请重新生成配音后再合成');
    }
    targetFd = fs.openSync(targetPath, 'wx');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let bytesRead;
    do {
      bytesRead = fs.readSync(opened.fd, buffer, 0, buffer.length, null);
      let offset = 0;
      while (offset < bytesRead) {
        offset += fs.writeSync(targetFd, buffer, offset, bytesRead - offset);
      }
    } while (bytesRead > 0);
    completed = true;
    return true;
  } finally {
    if (targetFd !== undefined) fs.closeSync(targetFd);
    fs.closeSync(opened.fd);
    if (!completed) {
      try { fs.unlinkSync(targetPath); } catch (_) {}
    }
  }
}

function appendVideoEncoderArgs(args, videoEncoder) {
  if (videoEncoder && Array.isArray(videoEncoder.outputArgs) && videoEncoder.outputArgs.length > 0) {
    args.push(...videoEncoder.outputArgs, '-pix_fmt', 'yuv420p');
    return;
  }
  args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '23');
}

function writeSilenceMp3(slotSec, outPath, log, options) {
  return runFfmpeg(
    ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', String(slotSec), '-c:a', 'libmp3lame', '-q:a', '6', outPath],
    log,
    'silence',
    options
  );
}

async function fitAudioToSlot(inputPath, slotSec, outPath, log, options) {
  const d = await ffprobeDurationSec(inputPath, options);
  if (d == null || d <= 0.01) return false;
  const eps = 0.06;
  if (d > slotSec + eps) {
    const factor = d / slotSec;
    const chain = buildAtempoChain(factor);
    const af = chain || 'anull';
    return runFfmpeg(
      ['-y', '-i', inputPath, '-af', af, '-t', String(slotSec), '-c:a', 'libmp3lame', '-q:a', '4', outPath],
      log,
      'fit_speed',
      options
    );
  }
  if (d < slotSec - eps) {
    const pad = slotSec - d;
    return runFfmpeg(
      ['-y', '-i', inputPath, '-af', `apad=pad_dur=${pad}`, '-t', String(slotSec), '-c:a', 'libmp3lame', '-q:a', '4', outPath],
      log,
      'fit_pad',
      options
    );
  }
  try {
    fs.copyFileSync(inputPath, outPath);
    return true;
  } catch (_) {
    return runFfmpeg(
      ['-y', '-i', inputPath, '-t', String(slotSec), '-c:a', 'libmp3lame', '-q:a', '4', outPath],
      log,
      'fit_copy',
      options
    );
  }
}

async function concatMp3List(segmentPaths, outPath, log, options) {
  const listFile = path.join(path.dirname(outPath), `mix_concat_${Date.now()}.txt`);
  try {
    const lines = segmentPaths.map((p) => {
      const normalized = path.resolve(p).replace(/\\/g, '/');
      return `file '${normalized.replace(/'/g, "'\\''")}'`;
    });
    uploadService.writeFileAtomically(listFile, (stagedPath) => {
      fs.writeFileSync(stagedPath, lines.join('\n'), 'utf8');
    });
    return await runFfmpeg(
      ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c:a', 'libmp3lame', '-q:a', '4', outPath],
      log,
      'concat_mix',
      options
    );
  } finally {
    try {
      if (fs.existsSync(listFile)) fs.unlinkSync(listFile);
    } catch (_) {}
  }
}

async function alignAudioToVideoDuration(inMp3, videoDur, outPath, log, options) {
  const n = await ffprobeDurationSec(inMp3, options);
  if (n == null || !Number.isFinite(videoDur) || videoDur <= 0.1) return false;
  const eps = 0.08;
  if (n > videoDur + eps) {
    const factor = n / videoDur;
    const chain = buildAtempoChain(factor);
    if (!chain) {
      try {
        fs.copyFileSync(inMp3, outPath);
        return true;
      } catch (_) {
        return false;
      }
    }
    return runFfmpeg(
      ['-y', '-i', inMp3, '-af', chain, '-t', String(videoDur), '-c:a', 'libmp3lame', '-q:a', '4', outPath],
      log,
      'align_speed',
      options
    );
  }
  if (n < videoDur - eps) {
    const pad = videoDur - n;
    return runFfmpeg(
      ['-y', '-i', inMp3, '-af', `apad=pad_dur=${pad}`, '-t', String(videoDur), '-c:a', 'libmp3lame', '-q:a', '4', outPath],
      log,
      'align_pad',
      options
    );
  }
  try {
    fs.copyFileSync(inMp3, outPath);
    return true;
  } catch (_) {
    return false;
  }
}

function amixTwoTracks(pathA, pathB, slotSec, outPath, log, options) {
  return runFfmpeg(
    [
      '-y', '-i', pathA, '-i', pathB,
      '-filter_complex', `[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
      '-map', '[aout]',
      '-t', String(slotSec),
      '-c:a', 'libmp3lame', '-q:a', '4',
      outPath,
    ],
    log,
    'amix_seg',
    options
  );
}

function getDrawtextFontOption() {
  const candidates = [];
  if (process.platform === 'win32') {
    const root = process.env.SystemRoot || 'C:\\Windows';
    candidates.push(
      path.join(root, 'Fonts', 'msyh.ttc'),
      path.join(root, 'Fonts', 'msyhbd.ttc'),
      path.join(root, 'Fonts', 'simhei.ttf')
    );
  }
  candidates.push('/System/Library/Fonts/PingFang.ttc', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf');
  for (const p of candidates) {
    if (p && fs.existsSync(p)) {
      return `:fontfile='${escapeFfmpegPath(p)}'`;
    }
  }
  return '';
}

async function ffprobeHasAudio(filePath, options = {}) {
  const probe = getFfprobePath();
  const r = await runExternalProcess(
    probe,
    ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', filePath],
    {
      signal: options.signal,
      timeoutMs: normalizePositiveMs(options.timeoutMs, FFPROBE_TIMEOUT_MS),
      killGraceMs: options.killGraceMs,
      timeoutLabel: '媒体探测',
      outputLimitBytes: 1024 * 1024,
    }
  );
  if (!r.ok) {
    assertMediaBinaryResult(r);
    return false;
  }
  return String(r.stdout || '').trim().length > 0;
}

module.exports = {
  POST_PROCESS_FFMPEG_MISSING,
  POST_PROCESS_FALLBACK,
  throwIfAborted,
  userFacingPostProcessError,
  ffprobeDurationSec,
  copyStoredAudioToTemp,
  fitAudioToSlot,
  writeSilenceMp3,
  concatMp3List,
  alignAudioToVideoDuration,
  amixTwoTracks,
  escapeFfmpegPath,
  getDrawtextFontOption,
  appendVideoEncoderArgs,
  runFfmpeg,
  publishStagedFiles,
  ffprobeHasAudio,
  assertSameStorageDevice,
  operationCancelledError,
  formatSrtTimestamp,
};
