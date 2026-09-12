'use strict';

/**
 * 视频合成执行层：外部进程、FFmpeg 调用、本地/远程视频路径解析。
 * 业务编排（list/create/delete、任务终态）仍在 videoMergeService。
 */

const path = require('path');
const fs = require('fs');
const childProcess = require('child_process');
const { randomUUID } = require('crypto');
const ffmpegPath = require('../utils/ffmpegPath');
const uploadService = require('./uploadService');
const {
  operationCancelledError,
  throwIfAborted,
  isOperationCancelled,
} = require('./videoMergeErrors');

const MAX_REMOTE_VIDEO_BYTES = 256 * 1024 * 1024;
const MAX_REMOTE_MERGE_DOWNLOAD_BYTES = 1024 * 1024 * 1024;
const MAX_REMOTE_VIDEO_REDIRECTS = 3;
const REMOTE_VIDEO_TIMEOUT_MS = 60000;
const FFMPEG_TIMEOUT_MS = 15 * 60 * 1000;
const MEDIA_TOOL_CHECK_TIMEOUT_MS = 10000;
const FFPROBE_TIMEOUT_MS = 30000;
const FFMPEG_OUTPUT_LIMIT_BYTES = 16 * 1024 * 1024;

function removeFileIfPresent(filePath) {
  if (!filePath) return;
  try {
    fs.rmSync(filePath, { force: true });
  } catch (_) {}
}

/** 将 video_url 解析为受控 storage 文件，或安全下载到 temp。 */
async function resolveVideoToLocalPath(videoUrl, baseUrl, storageRoot, tempDir, index, log, options = {}) {
  throwIfAborted(options.signal);
  void baseUrl;
  if (!videoUrl || typeof videoUrl !== 'string') return null;
  const u = videoUrl.trim();
  if (!u) return null;
  try {
    const local = uploadService.resolveStorageReference(storageRoot, u);
    if (local) {
      const opened = uploadService.openStorageFile(storageRoot, local.relativePath);
      fs.closeSync(opened.fd);
      log.info('Video merge: using storage file', { index, path: local.relativePath });
      return { path: local.absolutePath, canonical: local.relativePath, temporary: false, bytes: opened.stat.size };
    }
  } catch (error) {
    if (!/^https?:\/\//i.test(u) || u.startsWith('/static/')) {
      log.warn('Video merge: unsafe local reference rejected', { index, error: error.message });
      return null;
    }
  }
  if (!/^https?:\/\//i.test(u)) return null;

  let ext = '.mp4';
  try {
    const pathname = new URL(u).pathname.toLowerCase();
    if (pathname.endsWith('.webm')) ext = '.webm';
    else if (pathname.endsWith('.mov')) ext = '.mov';
    else if (pathname.endsWith('.mkv')) ext = '.mkv';
  } catch (_) {}
  const destPath = path.join(tempDir, `dl_${Date.now()}_${index}${ext}`);
  try {
    const budget = options.downloadBudget || { remainingBytes: MAX_REMOTE_MERGE_DOWNLOAD_BYTES };
    const maxBytes = Math.min(MAX_REMOTE_VIDEO_BYTES, Math.max(0, Number(budget.remainingBytes) || 0));
    if (maxBytes <= 0) throw new Error('远程视频下载配额已用完');
    uploadService.assertUploadDiskCapacity(tempDir, maxBytes);
    const downloaded = await uploadService.downloadBufferViaNodeHttp(u, REMOTE_VIDEO_TIMEOUT_MS, 0, {
      maxBytes,
      maxRedirects: MAX_REMOTE_VIDEO_REDIRECTS,
      accept: 'video/*,application/octet-stream',
      trustedOrigins: options.trustedOrigins,
      lookup: options.lookup,
      signal: options.signal,
    });
    throwIfAborted(options.signal);
    if (!downloaded.buffer.length) throw new Error('远程视频为空，无法合成');
    uploadService.assertUploadDiskCapacity(tempDir, downloaded.buffer.length);
    uploadService.writeFileAtomically(destPath, (stagedPath) => {
      fs.writeFileSync(stagedPath, downloaded.buffer, { flag: 'wx' });
    });
    throwIfAborted(options.signal);
    budget.remainingBytes -= downloaded.buffer.length;
    log.info('Video merge: downloaded to temp', { index, bytes: downloaded.buffer.length });
    return {
      path: destPath,
      canonical: downloaded.finalUrl,
      temporary: true,
      bytes: downloaded.buffer.length,
    };
  } catch (e) {
    try {
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
    } catch (_) {}
    if (isOperationCancelled(e, options.signal)) throw operationCancelledError(options.signal?.reason || e);
    let source = u;
    try {
      const parsed = new URL(u);
      source = `${parsed.origin}${parsed.pathname}`;
    } catch (_) {}
    log.warn('Video merge: download failed', { index, source, error: e.message });
    return null;
  }
}

async function runExternalProcess(command, args, options = {}) {
  const signal = options.signal;
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    let child;
    let settled = false;
    let stdout = '';
    let stderr = '';
    let timer;
    let terminationTimer;
    let abortError = null;
    let timeoutError = null;
    const outputLimit = Math.max(1024, Number(options.outputLimitBytes) || FFMPEG_OUTPUT_LIMIT_BYTES);
    const appendOutput = (current, chunk) => {
      const next = current + String(chunk || '');
      return next.length > outputLimit ? next.slice(-outputLimit) : next;
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(terminationTimer);
      signal?.removeEventListener('abort', onAbort);
      callback(value);
    };
    const killChild = () => {
      if (!child || child.exitCode != null || child.signalCode) return;
      try { child.kill('SIGKILL'); } catch (_) {}
    };
    const settleAfterTerminationGrace = (kind) => {
      if (settled || terminationTimer) return;
      const graceMs = Math.max(1, Number(options.terminationGraceMs) || 1000);
      terminationTimer = setTimeout(() => {
        if (kind === 'abort') {
          finish(reject, abortError || operationCancelledError(signal?.reason));
          return;
        }
        finish(resolve, {
          ok: false,
          error: timeoutError,
          stdout,
          stderr,
          status: child?.exitCode ?? null,
          signal: child?.signalCode ?? null,
        });
      }, graceMs);
    };
    const onAbort = () => {
      abortError = operationCancelledError(signal?.reason);
      killChild();
      settleAfterTerminationGrace('abort');
    };

    try {
      child = childProcess.spawn(command, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      finish(resolve, { ok: false, error: error.message, stdout, stderr, status: null });
      return;
    }
    child.stdout?.on('data', (chunk) => { stdout = appendOutput(stdout, chunk); });
    child.stderr?.on('data', (chunk) => { stderr = appendOutput(stderr, chunk); });
    child.once('error', (error) => {
      if (abortError) finish(reject, abortError);
      else finish(resolve, { ok: false, error: error.message, stdout, stderr, status: null });
    });
    child.once('close', (code, closeSignal) => {
      if (abortError || signal?.aborted) {
        finish(reject, abortError || operationCancelledError(signal.reason));
        return;
      }
      if (timeoutError) {
        finish(resolve, { ok: false, error: timeoutError, stdout, stderr, status: code, signal: closeSignal });
        return;
      }
      finish(resolve, {
        ok: code === 0,
        error: code === 0 ? null : String(stderr || stdout || '').trim() || `${command} 退出码 ${code}`,
        stdout,
        stderr,
        status: code,
        signal: closeSignal,
      });
    });
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    timer = setTimeout(() => {
      timeoutError = `${options.timeoutLabel || command} 执行超时（${options.timeoutMs}ms）`;
      killChild();
      settleAfterTerminationGrace('timeout');
    }, Math.max(1, Number(options.timeoutMs) || FFMPEG_TIMEOUT_MS));
  });
}

async function checkMediaBinary(command, expectedName, signal) {
  const result = await runExternalProcess(command, ['-version'], {
    signal,
    timeoutMs: MEDIA_TOOL_CHECK_TIMEOUT_MS,
    timeoutLabel: expectedName,
    outputLimitBytes: 1024 * 1024,
  });
  if (!result.ok) return { ok: false, path: command, error: result.error };
  const output = String(result.stdout || result.stderr || '').trim();
  if (!new RegExp(`^${expectedName} version\\b`, 'i').test(output)) {
    return { ok: false, path: command, error: `${command} 不是有效的 ${expectedName} 可执行文件` };
  }
  return { ok: true, path: command, version: output.split(/\r?\n/, 1)[0] };
}

async function validateFfmpegTools(signal) {
  const ffmpeg = await checkMediaBinary(ffmpegPath.getFfmpegPath(), 'ffmpeg', signal);
  const ffprobe = await checkMediaBinary(ffmpegPath.getFfprobePath(), 'ffprobe', signal);
  const errors = [];
  if (!ffmpeg.ok) errors.push(`ffmpeg 不可用：${ffmpeg.error}`);
  if (!ffprobe.ok) errors.push(`ffprobe 不可用：${ffprobe.error}`);
  return { ok: ffmpeg.ok && ffprobe.ok, ffmpeg, ffprobe, error: errors.length ? errors.join('; ') : null };
}

async function getAvailableFfmpegEncoders(signal) {
  const result = await runExternalProcess(ffmpegPath.getFfmpegPath(), ['-hide_banner', '-encoders'], {
    signal,
    timeoutMs: MEDIA_TOOL_CHECK_TIMEOUT_MS,
    timeoutLabel: 'FFmpeg 编码器探测',
    outputLimitBytes: 8 * 1024 * 1024,
  });
  if (!result.ok) return { ok: false, encoders: [], error: result.error };
  const encoders = [];
  const output = String(result.stdout || result.stderr || '');
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*[VAS][A-Z.]{5}\s+(\S+)/);
    if (match) encoders.push(match[1]);
  }
  return { ok: true, encoders, error: null };
}

async function ffprobeVideo(filePath, options = {}) {
  throwIfAborted(options.signal);
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (error) {
    return { ok: false, error: error.message };
  }
  if (!stat.isFile() || stat.size <= 0) return { ok: false, error: '文件为空或不是普通文件' };

  const result = await runExternalProcess(
    ffmpegPath.getFfprobePath(),
    [
      '-v', 'error',
      '-show_entries', 'stream=codec_type,width,height,duration:format=duration',
      '-of', 'json',
      filePath,
    ],
    {
      signal: options.signal,
      timeoutMs: FFPROBE_TIMEOUT_MS,
      timeoutLabel: 'FFprobe',
      outputLimitBytes: 4 * 1024 * 1024,
    }
  );
  if (!result.ok) {
    return {
      ok: false,
      error: String(result.stderr || result.error || '').trim().slice(-800) || `ffprobe 退出码 ${result.status}`,
    };
  }

  let data;
  try {
    data = JSON.parse(result.stdout || '{}');
  } catch (error) {
    return { ok: false, error: '无法解析视频探测结果' };
  }
  const streams = Array.isArray(data.streams) ? data.streams : [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  const duration = Number(data.format?.duration) || Number(video?.duration);
  const width = Number(video?.width);
  const height = Number(video?.height);
  if (!video || !Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    return { ok: false, error: '没有可用的视频流' };
  }
  if (!Number.isFinite(duration) || duration <= 0.01) {
    return { ok: false, error: '视频时长无效或为空' };
  }
  return {
    ok: true,
    width,
    height,
    duration,
    hasAudio: streams.some((stream) => stream.codec_type === 'audio'),
  };
}

async function runFfmpeg(args, log, tag, options = {}) {
  const result = await runExternalProcess(ffmpegPath.getFfmpegPath(), args, {
    signal: options.signal,
    timeoutMs: FFMPEG_TIMEOUT_MS,
    timeoutLabel: 'FFmpeg',
  });
  if (!result.ok) {
    const detail = String(result.stderr || result.stdout || result.error || '').trim().slice(-1200);
    log.warn('Video merge: ffmpeg failed', { tag, stderr: detail, signal: result.signal || null });
    return { ok: false, error: detail || result.error };
  }
  return { ok: true, error: null };
}

async function transcodeProductionClip(inputPath, probe, outputPath, dimensions, fps, videoEncoder, log, index, requestedDuration, options = {}) {
  const requested = Number(requestedDuration);
  const duration = Number.isFinite(requested) && requested > 0
    ? Math.max(0.02, requested)
    : Math.max(0.02, probe.duration);
  const padDuration = Math.max(0, duration - probe.duration);
  const videoFilters = [
    `scale=${dimensions.width}:${dimensions.height}:force_original_aspect_ratio=decrease:flags=lanczos`,
    `pad=${dimensions.width}:${dimensions.height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    'setsar=1',
    `fps=${fps}`,
    'format=yuv420p',
  ];
  if (padDuration > 0.001) {
    videoFilters.push(`tpad=stop_mode=clone:stop_duration=${padDuration.toFixed(6)}`);
  }
  videoFilters.push(`trim=duration=${duration.toFixed(6)}`, 'setpts=PTS-STARTPTS');
  const filter = videoFilters.join(',');
  const args = ['-hide_banner', '-loglevel', 'error', '-xerror', '-err_detect', 'explode', '-y', '-i', inputPath];
  if (!probe.hasAudio) {
    args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
  }
  args.push('-map', '0:v:0', '-map', probe.hasAudio ? '0:a:0' : '1:a:0');
  args.push('-sn', '-dn', '-vf', filter);
  if (probe.hasAudio) {
    args.push('-af', `aresample=48000:async=1:first_pts=0,apad,atrim=duration=${duration.toFixed(6)},asetpts=PTS-STARTPTS`);
  }
  args.push(
    ...videoEncoder.outputArgs,
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '192k',
    '-t', duration.toFixed(6),
    '-video_track_timescale', '90000',
    '-avoid_negative_ts', 'make_zero',
    '-movflags', '+faststart',
    outputPath
  );

  const result = await runFfmpeg(args, log, `strict_transcode_${index}`, options);
  if (!result.ok) return result;
  const outputProbe = await ffprobeVideo(outputPath, options);
  if (!outputProbe.ok) return { ok: false, error: `标准化片段无效：${outputProbe.error}` };
  if (!outputProbe.hasAudio) return { ok: false, error: '标准化片段没有音频流' };
  if (outputProbe.width !== dimensions.width || outputProbe.height !== dimensions.height) {
    return { ok: false, error: `标准化片段尺寸异常 ${outputProbe.width}x${outputProbe.height}` };
  }
  return { ok: true, probe: outputProbe };
}

/** 使用 ffmpeg concat 合并多个视频文件 */
async function runFfmpegConcatDetailed(localPaths, outputPath, log, tag = 'concat', strictProduction = false, options = {}) {
  const listFile = path.join(options.workDir || path.dirname(outputPath), `.concat_list_${Date.now()}_${randomUUID()}.txt`);
  try {
    const lines = localPaths.map((p) => {
      const normalized = p.replace(/\\/g, '/');
      return `file '${normalized.replace(/'/g, "'\\''")}'`;
    });
    uploadService.writeFileAtomically(listFile, (stagedPath) => {
      fs.writeFileSync(stagedPath, lines.join('\n'), 'utf8');
    });
    const args = strictProduction
      ? [
          '-hide_banner', '-loglevel', 'error', '-y',
          '-f', 'concat', '-safe', '0', '-i', listFile,
          '-c', 'copy', '-avoid_negative_ts', 'make_zero', '-movflags', '+faststart',
          outputPath,
        ]
      : ['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-y', outputPath];
    return await runFfmpeg(args, log, tag, options);
  } finally {
    try { if (fs.existsSync(listFile)) fs.unlinkSync(listFile); } catch (_) {}
  }
}

async function runFfmpegConcat(localPaths, outputPath, log, options = {}) {
  return (await runFfmpegConcatDetailed(localPaths, outputPath, log, 'concat', false, options)).ok;
}

module.exports = {
  MAX_REMOTE_MERGE_DOWNLOAD_BYTES,
  removeFileIfPresent,
  runExternalProcess,
  resolveVideoToLocalPath,
  checkMediaBinary,
  validateFfmpegTools,
  getAvailableFfmpegEncoders,
  ffprobeVideo,
  transcodeProductionClip,
  runFfmpegConcat,
  runFfmpegConcatDetailed,
};
