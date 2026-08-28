const path = require('path');
const fs = require('fs');
const os = require('os');
const childProcess = require('child_process');
const { randomUUID } = require('crypto');
const {
  getFfmpegPath,
  getFfprobePath,
} = require('../utils/ffmpegPath');
const storageLayout = require('./storageLayout');
const uploadService = require('./uploadService');
const { finishOperation } = require('./operationRegistry');
const dramaWriteGuard = require('./dramaWriteGuard');

const STRICT_PRODUCTION_MODE = 'strict_production';
const MAX_STRICT_SCENES = 100;
const MAX_REMOTE_VIDEO_BYTES = 256 * 1024 * 1024;
const MAX_REMOTE_MERGE_DOWNLOAD_BYTES = 1024 * 1024 * 1024;
const MAX_REMOTE_VIDEO_REDIRECTS = 3;
const REMOTE_VIDEO_TIMEOUT_MS = 60000;
const FFMPEG_TIMEOUT_MS = 15 * 60 * 1000;
const MEDIA_TOOL_CHECK_TIMEOUT_MS = 10000;
const FFPROBE_TIMEOUT_MS = 30000;
const FFMPEG_OUTPUT_LIMIT_BYTES = 16 * 1024 * 1024;

function operationCancelledError(reason) {
  const error = reason instanceof Error ? reason : new Error(String(reason || '视频合成已取消'));
  error.name = 'AbortError';
  error.code = 'OPERATION_CANCELLED';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw operationCancelledError(signal.reason);
}

function isOperationCancelled(error, signal) {
  return signal?.aborted || error?.code === 'OPERATION_CANCELLED' || error?.name === 'AbortError';
}

function removeFileIfPresent(filePath) {
  if (!filePath) return;
  try {
    fs.rmSync(filePath, { force: true });
  } catch (_) {}
}

function pathWithinStorage(storageRoot, relativePath) {
  const root = path.resolve(storageRoot);
  const target = path.resolve(root, String(relativePath || '').replace(/^[/\\]+/, ''));
  if (target === root || !target.startsWith(`${root}${path.sep}`)) return null;
  return target;
}

function list(db, query) {
  if (query.drama_id && !require('./dramaWriteGuard').canReadDrama(db, Number(query.drama_id))) return [];
  let sql = 'FROM video_merges WHERE deleted_at IS NULL';
  const params = [];
  if (query.episode_id) {
    sql += ' AND episode_id = ?';
    params.push(query.episode_id);
  }
  if (query.drama_id) {
    sql += ' AND drama_id = ?';
    params.push(query.drama_id);
  }
  const rows = db.prepare('SELECT * ' + sql + ' ORDER BY created_at DESC, id DESC').all(...params);
  return rows.filter((row) => require('./dramaWriteGuard').canReadResource(db, 'video_merges', row.id)).map(rowToItem);
}

function rowToItem(r) {
  return {
    id: r.id,
    episode_id: r.episode_id,
    drama_id: r.drama_id,
    title: r.title,
    provider: r.provider,
    status: r.status,
    merged_url: r.merged_url,
    duration: r.duration ?? undefined,
    task_id: r.task_id,
    error_msg: r.error_msg ?? undefined,
    created_at: r.created_at,
    completed_at: r.completed_at,
  };
}

function getById(db, id) {
  if (!require('./dramaWriteGuard').canReadResource(db, 'video_merges', id)) return null;
  const r = db.prepare('SELECT * FROM video_merges WHERE id = ? AND deleted_at IS NULL').get(Number(id));
  return r ? rowToItem(r) : null;
}

function configuredProviderOrigins(db) {
  try {
    return db.prepare(
      'SELECT base_url FROM ai_service_configs WHERE deleted_at IS NULL AND is_active = 1 AND base_url IS NOT NULL'
    ).all().map((row) => String(row.base_url || '').trim()).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function exactTrustedOrigin(value, trustedOrigins) {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return false;
    return trustedOrigins.some((origin) => {
      try { return new URL(origin).origin === parsed.origin; } catch (_) { return false; }
    });
  } catch (_) {
    return false;
  }
}

function normalizeMergeVideoReference(value, storageRoot, trustedOrigins = []) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) {
    try {
      const local = uploadService.resolveStorageReference(storageRoot, text);
      if (local) return local.relativePath;
    } catch (error) {
      if (text.startsWith('/static/')) throw error;
    }
    if (exactTrustedOrigin(text, trustedOrigins)) return new URL(text).toString();
    return uploadService.assertPublicHttpUrlSyntax(text).toString();
  }
  const local = uploadService.resolveStorageReference(storageRoot, text);
  if (!local) throw new uploadService.UnsafeMediaReferenceError('视频引用必须位于 storage 目录内');
  return local.relativePath;
}

function normalizeMergeScenes(reqScenes, db) {
  if (reqScenes == null) return [];
  if (!Array.isArray(reqScenes) || reqScenes.length > MAX_STRICT_SCENES) {
    throw new uploadService.UnsafeMediaReferenceError('合成分镜列表无效或数量过多');
  }
  const storageRoot = getStorageRoot();
  const trustedOrigins = configuredProviderOrigins(db);
  return reqScenes.map((scene) => ({
    ...(scene && typeof scene === 'object' && !Array.isArray(scene) ? scene : {}),
    video_url: normalizeMergeVideoReference(scene?.video_url, storageRoot, trustedOrigins),
  }));
}

function create(db, log, req) {
  const now = new Date().toISOString();
  const scenes = normalizeMergeScenes(req.scenes, db);
  const taskService = require('./taskService');
  const mergeOptionsJson = (() => {
    const source = req.merge_options;
    const o = source && typeof source === 'object' && !Array.isArray(source) ? { ...source } : {};
    if (req.mode === STRICT_PRODUCTION_MODE && o.mode == null) o.mode = STRICT_PRODUCTION_MODE;
    if (req.strict_production === true && o.strict_production == null) o.strict_production = true;
    return JSON.stringify(o);
  })();
  const persist = db.transaction(() => {
    const episode = dramaWriteGuard.assertEpisodeWritable(db, req.episode_id, req.drama_id);
    const episodeId = Number(episode.id);
    const dramaId = Number(episode.drama_id);
    const task = taskService.createTask(db, log, 'video_merge', String(episodeId));
    const info = db.prepare(
      `INSERT INTO video_merges (episode_id, drama_id, title, provider, model, status, scenes, merge_options, task_id, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
    ).run(
      episodeId,
      dramaId,
      req.title ?? null,
      req.provider || 'ffmpeg',
      req.model ?? null,
      JSON.stringify(scenes),
      mergeOptionsJson,
      task.id,
      now
    );
    return { mergeId: Number(info.lastInsertRowid), taskId: task.id };
  });
  const created = typeof persist.immediate === 'function' ? persist.immediate() : persist();
  taskService.ensureTaskOperation(created.taskId);
  return { merge_id: created.mergeId, task_id: created.taskId, ...getById(db, created.mergeId) };
}

function deleteById(db, log, id) {
  const now = new Date().toISOString();
  return dramaWriteGuard.runResourceWrite(db, 'video_merges', id, (row) => {
    const result = db.prepare(
      'UPDATE video_merges SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL'
    ).run(now, Number(row.id));
    return result.changes > 0;
  });
}

/** 获取 storage 根目录（绝对路径） */
function getStorageRoot() {
  const loadConfig = require('../config').loadConfig;
  const cfg = loadConfig();
  const p = cfg.storage?.local_path || './data/storage';
  return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
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

function parseMergeOptions(raw) {
  try {
    const value = JSON.parse(raw || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch (_) {
    return {};
  }
}

function isStrictProductionMode(row, mergeOpts) {
  return mergeOpts.mode === STRICT_PRODUCTION_MODE
    || mergeOpts.merge_mode === STRICT_PRODUCTION_MODE
    || mergeOpts.strict_production === true
    || row.model === STRICT_PRODUCTION_MODE;
}

function strictMergeError(message) {
  const error = new Error(message);
  error.code = 'STRICT_PRODUCTION_MERGE_FAILED';
  return error;
}

function storyboardIdForScene(scene) {
  return Number(scene?.storyboard_id ?? scene?.scene_id);
}

function validateStrictSceneCoverage(db, episodeId, scenes) {
  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw strictMergeError('严格生产合成缺少视频片段');
  }
  if (scenes.length > MAX_STRICT_SCENES) {
    throw strictMergeError(`严格生产合成最多支持 ${MAX_STRICT_SCENES} 个分镜`);
  }

  const expected = db.prepare(
    `SELECT id, storyboard_number
       FROM storyboards
      WHERE episode_id = ? AND deleted_at IS NULL
      ORDER BY storyboard_number ASC, id ASC`
  ).all(Number(episodeId));
  if (expected.length === 0) {
    throw strictMergeError('严格生产合成找不到预期分镜');
  }

  const expectedIds = expected.map((row) => Number(row.id));
  const expectedSet = new Set(expectedIds);
  const counts = new Map();
  const invalidIndexes = [];
  for (let i = 0; i < scenes.length; i++) {
    const id = storyboardIdForScene(scenes[i]);
    if (!Number.isInteger(id) || id <= 0) {
      invalidIndexes.push(i + 1);
      continue;
    }
    counts.set(id, (counts.get(id) || 0) + 1);
  }

  const missing = expectedIds.filter((id) => !counts.has(id));
  const duplicates = Array.from(counts.entries()).filter(([, count]) => count > 1).map(([id]) => id);
  const unexpected = Array.from(counts.keys()).filter((id) => !expectedSet.has(id));
  if (invalidIndexes.length || missing.length || duplicates.length || unexpected.length || scenes.length !== expected.length) {
    const details = [];
    if (missing.length) details.push(`缺少分镜 ${missing.join(', ')}`);
    if (duplicates.length) details.push(`重复分镜 ${duplicates.join(', ')}`);
    if (unexpected.length) details.push(`非本集分镜 ${unexpected.join(', ')}`);
    if (invalidIndexes.length) details.push(`无效片段序号 ${invalidIndexes.join(', ')}`);
    if (scenes.length !== expected.length) details.push(`预期 ${expected.length} 段，收到 ${scenes.length} 段`);
    throw strictMergeError(`严格生产分镜覆盖不完整：${details.join('；')}`);
  }
  return scenes.map((scene) => {
    const storyboardId = storyboardIdForScene(scene);
    return { ...scene, storyboard_id: storyboardId, scene_id: storyboardId };
  });
}

function buildStrictSceneFilterPlan(scenes) {
  if (!Array.isArray(scenes)) return [];
  return scenes.map((scene, order) => {
    const duration = Number(scene?.duration);
    const normalizedDuration = Number.isFinite(duration) && duration > 0
      ? Number(duration.toFixed(6))
      : 0;
    return {
      order,
      timeline_item_id: scene?.timeline_item_id == null ? null : Number(scene.timeline_item_id),
      storyboard_id: storyboardIdForScene(scene),
      start_sec: Number(scene?.start_sec) || 0,
      end_sec: Number(scene?.end_sec) || normalizedDuration,
      duration: normalizedDuration,
      video_filter: `trim=duration=${normalizedDuration.toFixed(6)},setpts=PTS-STARTPTS`,
      audio_filter: `atrim=duration=${normalizedDuration.toFixed(6)},asetpts=PTS-STARTPTS,apad`,
    };
  });
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
  const ffmpeg = await checkMediaBinary(getFfmpegPath(), 'ffmpeg', signal);
  const ffprobe = await checkMediaBinary(getFfprobePath(), 'ffprobe', signal);
  const errors = [];
  if (!ffmpeg.ok) errors.push(`ffmpeg 不可用：${ffmpeg.error}`);
  if (!ffprobe.ok) errors.push(`ffprobe 不可用：${ffprobe.error}`);
  return { ok: ffmpeg.ok && ffprobe.ok, ffmpeg, ffprobe, error: errors.length ? errors.join('; ') : null };
}

async function getAvailableFfmpegEncoders(signal) {
  const result = await runExternalProcess(getFfmpegPath(), ['-hide_banner', '-encoders'], {
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
    getFfprobePath(),
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
    return { ok: false, error: `ffprobe 输出无效：${error.message}` };
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

function chooseProductionDimensions(probes, mergeOpts) {
  const requestedWidth = Number(mergeOpts.output_width);
  const requestedHeight = Number(mergeOpts.output_height);
  let width;
  let height;
  if (Number.isFinite(requestedWidth) && requestedWidth > 0 && Number.isFinite(requestedHeight) && requestedHeight > 0) {
    width = requestedWidth;
    height = requestedHeight;
  } else {
    const largest = probes.reduce((best, probe) => (
      !best || probe.width * probe.height > best.width * best.height ? probe : best
    ), null);
    width = largest.width;
    height = largest.height;
  }

  const maxDimension = 3840;
  const maxPixels = 3840 * 2160;
  const scale = Math.min(
    1,
    maxDimension / width,
    maxDimension / height,
    Math.sqrt(maxPixels / (width * height))
  );
  width = Math.max(16, Math.floor((width * scale) / 2) * 2);
  height = Math.max(16, Math.floor((height * scale) / 2) * 2);
  return { width, height };
}

function chooseProductionFps(mergeOpts) {
  const requested = Number(mergeOpts.output_fps);
  if (!Number.isFinite(requested) || requested <= 0) return 30;
  return Math.min(60, Math.max(1, Math.round(requested)));
}

function chooseProductionVideoEncoder(encoderNames, width, height, fps) {
  const available = new Set(encoderNames);
  const bitrate = `${Math.round(Math.max(1000, Math.min(12000, width * height * fps * 0.00008)))}k`;
  if (available.has('libx264')) {
    return {
      name: 'libx264',
      outputArgs: ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-profile:v', 'high'],
    };
  }
  if (available.has('libopenh264')) {
    return {
      name: 'libopenh264',
      outputArgs: ['-c:v', 'libopenh264', '-profile:v', 'high', '-b:v', bitrate],
    };
  }
  throw strictMergeError('当前 FFmpeg 缺少可用的软件 H.264 编码器（libx264/libopenh264）');
}

async function runFfmpeg(args, log, tag, options = {}) {
  const result = await runExternalProcess(getFfmpegPath(), args, {
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

function updateCurrentMergeEpisodeStatus(db, mergeId, episodeId, status, now) {
  return db.prepare(
    `UPDATE episodes
        SET status = ?, updated_at = ?
      WHERE id = ?
        AND ? = (
          SELECT id
            FROM video_merges
           WHERE episode_id = ?
           ORDER BY id DESC
           LIMIT 1
        )`
  ).run(status, now, episodeId, mergeId, episodeId);
}

function updateCurrentMergeEpisodeOutput(db, mergeId, episodeId, videoUrl, status, now) {
  return db.prepare(
    `UPDATE episodes
        SET video_url = ?, status = ?, updated_at = ?
      WHERE id = ?
        AND ? = (
          SELECT id
            FROM video_merges
           WHERE episode_id = ?
           ORDER BY id DESC
           LIMIT 1
        )`
  ).run(videoUrl, status, now, episodeId, mergeId, episodeId);
}

function createMergeExecution(log, row, externalSignal) {
  const taskService = require('./taskService');
  const controller = new AbortController();
  const generatedFiles = new Set();
  const temporaryDirectories = new Set();
  const pendingPublications = new Set();
  let stoppedResolve;
  let stopped = false;
  let cancellationPromise = null;
  const stoppedPromise = new Promise((resolve) => { stoppedResolve = resolve; });
  const forwardAbort = () => {
    if (!controller.signal.aborted) controller.abort(operationCancelledError(externalSignal?.reason));
  };
  if (externalSignal?.aborted) forwardAbort();
  else externalSignal?.addEventListener('abort', forwardAbort, { once: true });

  const cleanup = () => {
    for (const publication of pendingPublications) publication.rollback();
    pendingPublications.clear();
    for (const filePath of generatedFiles) removeFileIfPresent(filePath);
    for (const directory of temporaryDirectories) {
      try { fs.rmSync(directory, { recursive: true, force: true }); } catch (_) {}
    }
  };
  const finish = () => {
    if (stopped) return;
    stopped = true;
    externalSignal?.removeEventListener('abort', forwardAbort);
    cleanup();
    finishOperation('task', row.task_id);
    stoppedResolve();
  };
  const cancel = () => {
    if (cancellationPromise) return cancellationPromise;
    cancellationPromise = (async () => {
      if (!controller.signal.aborted) controller.abort(operationCancelledError());
      await stoppedPromise;
      cleanup();
      log.info('Video merge worker stopped for cancellation', { merge_id: row.id, task_id: row.task_id });
      return { outcome: 'confirmed', confirmed: true };
    })();
    return cancellationPromise;
  };

  taskService.ensureTaskOperation(row.task_id);
  taskService.registerRemoteCancel(row.task_id, cancel);
  return {
    signal: controller.signal,
    cancel,
    finish,
    trackPublication(publication) { if (publication) pendingPublications.add(publication); },
    commitPublication(publication) {
      if (!publication) return;
      publication.commit();
      pendingPublications.delete(publication);
    },
    rollbackPublication(publication) {
      if (!publication) return;
      publication.rollback();
      pendingPublications.delete(publication);
    },
    keepFile(filePath) { generatedFiles.delete(path.resolve(filePath)); },
    trackFile(filePath) { if (filePath) generatedFiles.add(path.resolve(filePath)); },
    trackDirectory(directory) { if (directory) temporaryDirectories.add(path.resolve(directory)); },
  };
}

function settleCancelledMergeBeforeWorker(db, log, row) {
  const taskService = require('./taskService');
  const task = taskService.getTask(db, row.task_id);
  if (task?.status !== 'cancelled') return false;

  const cancelledAt = task.completed_at || new Date().toISOString();
  const settled = db.transaction(() => {
    const mergeUpdate = db.prepare(
      `UPDATE video_merges
          SET status = 'cancelled', merged_url = NULL, duration = NULL, completed_at = ?, error_msg = ?
        WHERE id = ? AND status IN ('pending', 'processing')`
    ).run(cancelledAt, task.error || '用户已取消', row.id);
    const currentMerge = db.prepare('SELECT status FROM video_merges WHERE id = ?').get(row.id);
    if (mergeUpdate.changes === 1) {
      updateCurrentMergeEpisodeStatus(db, row.id, row.episode_id, 'draft', cancelledAt);
      return true;
    }
    if (currentMerge?.status === 'cancelled') {
      updateCurrentMergeEpisodeStatus(db, row.id, row.episode_id, 'draft', cancelledAt);
      return true;
    }
    return false;
  })();
  if (settled) {
    log.info('Video merge cancelled before worker registration', { merge_id: row.id, task_id: row.task_id });
  }
  return settled;
}

async function settleCancelledMergeAfterWorker(db, log, row, execution) {
  const taskService = require('./taskService');
  await execution.cancel();
  const pendingTask = taskService.getTask(db, row.task_id);
  const cancellation = await taskService.cancelTask(
    db,
    log,
    row.task_id,
    pendingTask?.error || '用户已取消'
  );
  const task = taskService.getTask(db, row.task_id);
  if (!cancellation.ok && task?.status !== 'cancelled') {
    throw new Error(cancellation.error || '视频合成取消终态提交失败');
  }
  if (task?.status !== 'cancelled') {
    throw new Error('视频合成任务未进入取消终态');
  }

  const cancelledAt = task.completed_at || new Date().toISOString();
  db.transaction(() => {
    const mergeUpdate = db.prepare(
      `UPDATE video_merges
          SET status = 'cancelled', merged_url = NULL, duration = NULL, completed_at = ?, error_msg = ?
        WHERE id = ? AND task_id = ? AND status = 'cancelled'`
    ).run(cancelledAt, task.error || '用户已取消', row.id, row.task_id);
    if (mergeUpdate.changes !== 1) {
      throw new Error('视频合成业务记录未与取消任务终态保持一致');
    }
    updateCurrentMergeEpisodeStatus(db, row.id, row.episode_id, 'draft', cancelledAt);
  })();
  return cancellation;
}

function commitMergeFailure(db, row, message, signal) {
  const now = new Date().toISOString();
  const errorMessage = String(message || '视频合成失败').slice(0, 4000);
  const taskService = require('./taskService');
  db.transaction(() => {
    throwIfAborted(signal);
    const task = taskService.getTask(db, row.task_id);
    if (!task || ['cancelling', 'cancelled', 'completed'].includes(task.status)) {
      throw operationCancelledError(task?.error || '合成任务不再接受失败终态');
    }
    const mergeUpdate = db.prepare(
      `UPDATE video_merges
          SET status = 'failed', merged_url = NULL, duration = NULL, completed_at = ?, error_msg = ?
        WHERE id = ? AND status IN ('pending', 'processing')`
    ).run(now, errorMessage, row.id);
    if (mergeUpdate.changes !== 1) throw operationCancelledError('视频合成业务记录不再处于活动状态');
    updateCurrentMergeEpisodeStatus(db, row.id, row.episode_id, 'failed', now);
    if (task.status !== 'failed' && !taskService.updateTaskError(db, row.task_id, errorMessage)) {
      throw operationCancelledError('视频合成任务不再接受失败终态');
    }
  })();
  return errorMessage;
}

function relativeStoragePath(storageRoot, absolutePath) {
  const relative = path.relative(storageRoot, absolutePath);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw strictMergeError('合成输出不在本地存储目录内');
  }
  return relative.replace(/\\/g, '/');
}

function publishMergeOutput(stagedPath, finalPath, signal, execution) {
  throwIfAborted(signal);
  let publication = null;
  try {
    publication = uploadService.publishStagedFile(stagedPath, finalPath);
    execution.trackPublication(publication);
    // rename 前后的取消都必须回滚，不能把尚未入库的文件留在可服务路径。
    throwIfAborted(signal);
    return publication;
  } catch (error) {
    execution.rollbackPublication(publication);
    throw error;
  }
}

function persistMergeOutputAndCommitPublications(execution, publications, persist) {
  persist();
  for (const publication of publications) {
    if (!publication) continue;
    try {
      execution.commitPublication(publication);
    } catch (_) {
      // 数据库已提交且最终文件已就位。丢掉备份失败不能再 rollback。
    }
  }
}

async function processStrictProductionMerge(db, log, row, scenes, mergeOpts, baseUrl, execution) {
  const mergeId = row.id;
  const episodeId = row.episode_id;
  let tempRoot = null;
  let outputPublication = null;
  let postPublication = null;
  const generatedFiles = new Set();
  const { signal } = execution;

  try {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `drama-video-merge-${mergeId}-`));
    execution.trackDirectory(tempRoot);
    throwIfAborted(signal);
    const strictScenes = validateStrictSceneCoverage(db, episodeId, scenes);
    const resolvedFilterPlan = buildStrictSceneFilterPlan(strictScenes);
    if (Array.isArray(mergeOpts.filter_plan) &&
        JSON.stringify(mergeOpts.filter_plan) !== JSON.stringify(resolvedFilterPlan)) {
      throw strictMergeError('生产时间线滤镜计划与合成分镜不匹配');
    }

    const toolCheck = await validateFfmpegTools(signal);
    if (!toolCheck.ok) throw strictMergeError(`严格生产合成工具校验失败：${toolCheck.error}`);
    const encoderCheck = await getAvailableFfmpegEncoders(signal);
    if (!encoderCheck.ok) throw strictMergeError(`无法读取 FFmpeg 编码器能力：${encoderCheck.error}`);
    if (!encoderCheck.encoders.includes('aac')) {
      throw strictMergeError('当前 FFmpeg 缺少 AAC 编码器');
    }
    const storageRoot = getStorageRoot();
    const downloadBudget = { remainingBytes: MAX_REMOTE_MERGE_DOWNLOAD_BYTES };
    const trustedOrigins = configuredProviderOrigins(db);

    const localInputs = [];
    const inputProbes = [];
    for (let i = 0; i < strictScenes.length; i++) {
      const resolvedVideo = await resolveVideoToLocalPath(
        strictScenes[i]?.video_url,
        baseUrl,
        storageRoot,
        tempRoot,
        i,
        log,
        { downloadBudget, trustedOrigins, signal }
      );
      if (!resolvedVideo) {
        throw strictMergeError(`严格生产合成缺少可用本地片段：分镜 ${strictScenes[i].storyboard_id}`);
      }
      const probe = await ffprobeVideo(resolvedVideo.path, { signal });
      if (!probe.ok) {
        throw strictMergeError(`严格生产合成片段无效：分镜 ${strictScenes[i].storyboard_id}（${probe.error}）`);
      }
      localInputs.push(resolvedVideo.path);
      inputProbes.push(probe);
    }

    const dimensions = chooseProductionDimensions(inputProbes, mergeOpts);
    const fps = chooseProductionFps(mergeOpts);
    const videoEncoder = chooseProductionVideoEncoder(encoderCheck.encoders, dimensions.width, dimensions.height, fps);
    log.info('Video merge: strict production profile', {
      merge_id: mergeId,
      scene_count: strictScenes.length,
      width: dimensions.width,
      height: dimensions.height,
      fps,
      video_encoder: videoEncoder.name,
    });

    const normalizedPaths = [];
    let expectedOutputDuration = 0;
    for (let i = 0; i < localInputs.length; i++) {
      const normalizedPath = path.join(tempRoot, `normalized_${String(i).padStart(3, '0')}.mp4`);
      const transcoded = await transcodeProductionClip(
        localInputs[i],
        inputProbes[i],
        normalizedPath,
        dimensions,
        fps,
        videoEncoder,
        log,
        i,
        strictScenes[i].duration,
        { signal }
      );
      if (!transcoded.ok) {
        throw strictMergeError(`严格生产片段转码失败：分镜 ${strictScenes[i].storyboard_id}（${transcoded.error}）`);
      }
      normalizedPaths.push(normalizedPath);
      expectedOutputDuration += transcoded.probe.duration;
    }

    const projectSubdir = storageLayout.getProjectStorageSubdir(db, row.drama_id);
    const sub = projectSubdir && String(projectSubdir).trim();
    const mergedDir = sub
      ? path.join(storageRoot, sub, 'videos', 'merged')
      : path.join(storageRoot, 'videos', 'merged');
    fs.mkdirSync(mergedDir, { recursive: true });
    const outputFileName = `merged_${mergeId}_${Date.now()}_${randomUUID().slice(0, 8)}.mp4`;
    const finalOutputAbsPath = path.join(mergedDir, outputFileName);
    // FFmpeg 依赖末尾扩展名推断容器；暂存名必须继续以 .mp4 结尾。
    const outputStagePath = path.join(
      mergedDir,
      `.${path.basename(outputFileName, '.mp4')}.${randomUUID()}.tmp.mp4`
    );
    let outputAbsPath = outputStagePath;
    let finalSrtPath = null;
    generatedFiles.add(outputStagePath);
    execution.trackFile(outputStagePath);

    const concat = await runFfmpegConcatDetailed(
      normalizedPaths,
      outputAbsPath,
      log,
      'strict_concat',
      true,
      { signal, workDir: tempRoot }
    );
    if (!concat.ok) throw strictMergeError(`严格生产 FFmpeg concat 失败：${concat.error}`);
    let outputProbe = await ffprobeVideo(outputAbsPath, { signal });
    if (!outputProbe.ok || !outputProbe.hasAudio) {
      const reason = outputProbe.ok ? '最终视频缺少音轨' : outputProbe.error;
      throw strictMergeError(`严格生产 concat 输出无效：${reason}`);
    }
    const durationTolerance = Math.max(0.25, expectedOutputDuration * 0.05);
    if (outputProbe.duration < expectedOutputDuration - durationTolerance) {
      throw strictMergeError(
        `严格生产 concat 输出不完整：预期约 ${expectedOutputDuration.toFixed(2)} 秒，实际 ${outputProbe.duration.toFixed(2)} 秒`
      );
    }

    const postNeed = !!mergeOpts.burn_narration_subtitles
      || !!mergeOpts.burn_dialogue_audio
      || !!(mergeOpts.watermark_text && String(mergeOpts.watermark_text).trim());
    if (postNeed) {
      const anticipatedPostPath = path.join(
        path.dirname(finalOutputAbsPath),
        `${path.basename(finalOutputAbsPath, path.extname(finalOutputAbsPath))}_post.mp4`
      );
      const anticipatedSrtPath = path.join(
        path.dirname(finalOutputAbsPath),
        `${path.basename(finalOutputAbsPath, path.extname(finalOutputAbsPath))}_narration.srt`
      );
      throwIfAborted(signal);
      const post = await require('./mergedEpisodePostProcess').runMergedEpisodePostProcess(db, log, {
        mergedAbsPath: outputAbsPath,
        storageRoot,
        scenes: strictScenes,
        episodeId,
        mergeOpts,
        videoEncoder,
        signal,
        outputPath: anticipatedPostPath,
        srtOutputPath: anticipatedSrtPath,
        deferPublication: true,
      });
      postPublication = post.publication || null;
      execution.trackPublication(postPublication);
      throwIfAborted(signal);
      if (!post.ok || !post.relativePath) {
        throw strictMergeError(`严格生产后处理失败：${post.error || '未生成输出文件'}`);
      }
      outputAbsPath = path.join(storageRoot, post.relativePath.replace(/\//g, path.sep));
      const returnedSrtPath = pathWithinStorage(storageRoot, post.srtRelativePath);
      finalSrtPath = returnedSrtPath || (fs.existsSync(anticipatedSrtPath) ? anticipatedSrtPath : null);
      if (!postPublication) {
        generatedFiles.add(outputAbsPath);
        execution.trackFile(outputAbsPath);
        if (finalSrtPath) {
          generatedFiles.add(finalSrtPath);
          execution.trackFile(finalSrtPath);
        }
      }
      outputProbe = await ffprobeVideo(outputAbsPath, { signal });
      if (!outputProbe.ok || !outputProbe.hasAudio) {
        const reason = outputProbe.ok ? '后处理视频缺少音轨' : outputProbe.error;
        throw strictMergeError(`严格生产后处理输出无效：${reason}`);
      }
      if (outputProbe.duration < expectedOutputDuration - durationTolerance) {
        throw strictMergeError(
          `严格生产后处理输出不完整：预期约 ${expectedOutputDuration.toFixed(2)} 秒，实际 ${outputProbe.duration.toFixed(2)} 秒`
        );
      }
    } else {
      outputPublication = publishMergeOutput(outputStagePath, finalOutputAbsPath, signal, execution);
      outputAbsPath = finalOutputAbsPath;
    }

    if (mergeOpts.enforce_qa_gate) try {
      const qaReport = require('./qaService').auditDrama(db, log, {
        drama_id: row.drama_id,
        episode_id: episodeId,
        mode: 'production',
      });
      if (!qaReport.passed) {
        throw strictMergeError(`生产 QA 未通过，得分 ${qaReport.score}`);
      }
    } catch (error) {
      throw error.code === 'STRICT_PRODUCTION_MERGE_FAILED'
        ? error
        : strictMergeError(`生产 QA 失败：${error.message}`);
    }

    const mergedRelativePath = relativeStoragePath(storageRoot, outputAbsPath);
    const completedAt = new Date().toISOString();
    const duration = Math.max(1, Math.round(outputProbe.duration));
    const completionStatus = mergeOpts.defer_qa_completion ? 'qa_pending' : 'completed';
    const taskService = require('./taskService');
    persistMergeOutputAndCommitPublications(execution, [outputPublication, postPublication], () => {
      taskService.runTaskMutation(db, row.task_id, signal, () => {
        throwIfAborted(signal);
        db.prepare(
          `UPDATE video_merges
              SET status = ?, merged_url = ?, duration = ?, completed_at = ?, error_msg = NULL
            WHERE id = ?`
        ).run(completionStatus, mergedRelativePath, duration, completionStatus === 'completed' ? completedAt : null, mergeId);
        updateCurrentMergeEpisodeOutput(
          db,
          mergeId,
          episodeId,
          mergedRelativePath,
          completionStatus,
          completedAt
        );
        if (row.task_id) {
          const taskUpdated = taskService.updateTaskResult(db, row.task_id, {
            merge_id: mergeId,
            video_url: mergedRelativePath,
            duration,
            mode: STRICT_PRODUCTION_MODE,
            status: completionStatus,
          });
          if (!taskUpdated) throw strictMergeError('严格合成任务已不再接受完成状态');
        }
        throwIfAborted(signal);
      });
    });
    execution.keepFile(outputAbsPath);
    if (finalSrtPath) execution.keepFile(finalSrtPath);
    log.info('Video merge output persisted (strict production)', {
      merge_id: mergeId,
      episode_id: episodeId,
      output: mergedRelativePath,
      status: completionStatus,
    });
    return { ok: true, merge_id: mergeId, video_url: mergedRelativePath, duration, status: completionStatus };
  } catch (error) {
    execution.rollbackPublication(outputPublication);
    execution.rollbackPublication(postPublication);
    for (const filePath of generatedFiles) {
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch (_) {}
    }
    if (isOperationCancelled(error, signal)) throw operationCancelledError(signal.reason || error);
    const detail = error?.message || String(error);
    const message = commitMergeFailure(db, row, detail, signal);
    const failure = strictMergeError(message);
    failure.cause = error;
    throw failure;
  } finally {
    try {
      if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch (_) {}
  }
}

/** 异步处理视频合成；未生成可验证的合成文件时失败关闭。 */
async function processVideoMergeWorker(db, log, mergeId, baseUrl, execution) {
  const r = db.prepare('SELECT * FROM video_merges WHERE id = ? AND deleted_at IS NULL').get(mergeId);
  if (!r) return;
  const { signal } = execution;
  const taskId = r.task_id;
  const episodeId = r.episode_id;
  let scenes = [];
  try {
    scenes = JSON.parse(r.scenes || '[]');
  } catch (_) {
    log.warn('video merge parse scenes failed', { merge_id: mergeId });
  }
  const mergeOpts = parseMergeOptions(r.merge_options);
  const strictProduction = isStrictProductionMode(r, mergeOpts);
  const now = new Date().toISOString();
  const taskService = require('./taskService');
  taskService.runTaskMutation(db, taskId, signal, () => {
    db.prepare('UPDATE video_merges SET status = ? WHERE id = ?').run('processing', mergeId);
  });
  if (strictProduction) {
    return processStrictProductionMerge(db, log, r, scenes, mergeOpts, baseUrl, execution);
  }
  if (scenes.length === 0) {
    const message = '无有效视频片段';
    commitMergeFailure(db, r, message, signal);
    return { ok: false, merge_id: mergeId, status: 'failed', error: message };
  }
  const totalDuration = scenes.reduce((sum, s) => sum + (Number(s.duration) || 0), 0);
  const storageRoot = getStorageRoot();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `drama-video-merge-${mergeId}-`));
  execution.trackDirectory(tempDir);
  const downloadBudget = { remainingBytes: MAX_REMOTE_MERGE_DOWNLOAD_BYTES };
  const trustedOrigins = configuredProviderOrigins(db);

  const resolvedVideos = [];
  for (let i = 0; i < scenes.length; i++) {
    const resolved = await resolveVideoToLocalPath(
      scenes[i].video_url,
      baseUrl,
      storageRoot,
      tempDir,
      i,
      log,
      { downloadBudget, trustedOrigins, signal }
    );
    if (resolved) resolvedVideos.push(resolved);
  }
  if (resolvedVideos.length !== scenes.length) {
    const message = resolvedVideos.length === 0
      ? '无安全且可用的视频片段'
      : '部分视频片段无法安全解析，已拒绝不完整合成';
    fs.rmSync(tempDir, { recursive: true, force: true });
    commitMergeFailure(db, r, message, signal);
    return { ok: false, merge_id: mergeId, status: 'failed', error: message };
  }
  const localPaths = resolvedVideos.map((item) => item.path);

  const ffmpegCheck = await checkMediaBinary(getFfmpegPath(), 'ffmpeg', signal);
  const ffmpegAvailable = ffmpegCheck.ok;
  log.info('Video merge: ffmpeg check', {
    merge_id: mergeId,
    has_ffmpeg: ffmpegAvailable,
    ffmpeg_path: getFfmpegPath(),
    local_video_count: localPaths.length,
    cwd: process.cwd(),
  });

  let mergedRelativePath = null;
  let mergedSrtPath = null;
  let outputPublication = null;
  let postPublication = null;
  let publishedBaseOutputPath = null;
  if (localPaths.length > 0 && ffmpegAvailable && localPaths.length <= 100) {
    const projectSubdir = storageLayout.getProjectStorageSubdir(db, r.drama_id);
    const sub = projectSubdir && String(projectSubdir).trim();
    const mergedDir = sub
      ? path.join(storageRoot, sub, 'videos', 'merged')
      : path.join(storageRoot, 'videos', 'merged');
    if (!fs.existsSync(mergedDir)) fs.mkdirSync(mergedDir, { recursive: true });
    const outputFileName = `merged_${Date.now()}_${randomUUID().slice(0, 8)}.mp4`;
    const finalOutputPath = path.join(mergedDir, outputFileName);
    const outputPath = path.join(
      mergedDir,
      `.${path.basename(outputFileName, '.mp4')}.${randomUUID()}.tmp.mp4`
    );
    execution.trackFile(outputPath);
    const ok = await runFfmpegConcat(localPaths, outputPath, log, { signal, workDir: tempDir });
    if (ok && fs.existsSync(outputPath)) {
      const outputProbe = await ffprobeVideo(outputPath, { signal });
      if (outputProbe.ok) {
        outputPublication = publishMergeOutput(outputPath, finalOutputPath, signal, execution);
        publishedBaseOutputPath = finalOutputPath;
        mergedRelativePath = sub
          ? path.join(sub, 'videos', 'merged', outputFileName).replace(/\\/g, '/')
          : path.join('videos', 'merged', outputFileName).replace(/\\/g, '/');
        log.info('Video merge completed (ffmpeg)', { merge_id: mergeId, episode_id: episodeId, output: mergedRelativePath });
      } else {
        log.warn('Video merge: FFmpeg output validation failed', { merge_id: mergeId, error: outputProbe.error });
        fs.rmSync(outputPath, { force: true });
      }
    }
  }

  const postNeed =
    !!mergeOpts.burn_narration_subtitles
    || !!mergeOpts.burn_dialogue_audio
    || !!(mergeOpts.watermark_text && String(mergeOpts.watermark_text).trim());
  if (mergedRelativePath && ffmpegAvailable && postNeed) {
    const mergedAbsPath = path.join(storageRoot, mergedRelativePath.replace(/\//g, path.sep));
    if (fs.existsSync(mergedAbsPath)) {
      const mergedPP = require('./mergedEpisodePostProcess');
      throwIfAborted(signal);
      const post = await mergedPP.runMergedEpisodePostProcess(db, log, {
        mergedAbsPath,
        storageRoot,
        scenes,
        episodeId,
        mergeOpts,
        signal,
        deferPublication: true,
      });
      postPublication = post.publication || null;
      execution.trackPublication(postPublication);
      // 后处理即使返回普通错误，也必须先让取消信号赢得竞态，避免继续提交失败/成功状态。
      throwIfAborted(signal);
      if (post.ok && post.relativePath) {
        const postOutputPath = pathWithinStorage(storageRoot, post.relativePath);
        const postSrtPath = pathWithinStorage(storageRoot, post.srtRelativePath);
        if (!postPublication) {
          if (postOutputPath) execution.trackFile(postOutputPath);
          if (postSrtPath) execution.trackFile(postSrtPath);
        }
        if (postSrtPath) mergedSrtPath = postSrtPath;
        throwIfAborted(signal);
        const postProbe = postOutputPath
          ? await ffprobeVideo(postOutputPath, { signal })
          : { ok: false, error: '后处理输出不在存储目录内' };
        if (postProbe.ok) {
          mergedRelativePath = post.relativePath;
          if (outputPublication && path.resolve(postOutputPath) !== path.resolve(publishedBaseOutputPath)) {
            execution.rollbackPublication(outputPublication);
            outputPublication = null;
          }
          log.info('Video merge: merged episode post-process', { merge_id: mergeId, out: mergedRelativePath });
        } else {
          log.warn('Video merge: post-process output validation failed', {
            merge_id: mergeId,
            error: postProbe.error,
          });
          const hadPostPublication = !!postPublication;
          execution.rollbackPublication(postPublication);
          postPublication = null;
          // 有 publication 时 rollback 已删除新文件并恢复旧成品，不能再删目标路径。
          if (!hadPostPublication && postOutputPath) fs.rmSync(postOutputPath, { force: true });
          if (postSrtPath && !hadPostPublication) fs.rmSync(postSrtPath, { force: true });
          mergedRelativePath = null;
        }
      } else if (post.error && post.error !== 'NO_POST_OPTS') {
        log.warn('Video merge: post-process skipped', { merge_id: mergeId, err: post.error });
      }
    }
  }

  if (!mergedRelativePath) {
    const message = ffmpegAvailable
      ? 'FFmpeg 未生成有效的合成视频文件'
      : 'FFmpeg 不可用，无法合成视频';
    fs.rmSync(tempDir, { recursive: true, force: true });
    execution.rollbackPublication(outputPublication);
    execution.rollbackPublication(postPublication);
    commitMergeFailure(db, r, message, signal);
    return { ok: false, merge_id: mergeId, status: 'failed', error: message };
  }

  const finalMergedUrl = mergedRelativePath;
  const finalOutputPath = pathWithinStorage(storageRoot, finalMergedUrl);
  throwIfAborted(signal);
  try {
    const qaService = require('./qaService');
    const qaReport = qaService.auditDrama(db, log, {
      drama_id: r.drama_id,
      episode_id: episodeId,
      mode: 'production',
    });
    if (!qaReport.passed && mergeOpts.enforce_qa_gate) {
      throw new Error(`生产 QA 未通过，得分 ${qaReport.score}`);
    }
  } catch (e) {
    if (mergeOpts.enforce_qa_gate) {
      const message = `生产 QA 失败：${e.message}`;
      const hadPostPublication = !!postPublication;
      execution.rollbackPublication(outputPublication);
      execution.rollbackPublication(postPublication);
      // 后处理 publication 回滚后，最终路径可能已恢复为既有正确产物。
      if (!hadPostPublication && (!publishedBaseOutputPath || path.resolve(finalOutputPath) !== path.resolve(publishedBaseOutputPath))) {
        removeFileIfPresent(finalOutputPath);
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
      commitMergeFailure(db, r, message, signal);
      return { ok: false, merge_id: mergeId, status: 'failed', error: message };
    }
    log.warn('Video merge: production QA skipped', { merge_id: mergeId, error: e.message });
  }
  const duration = Math.round(totalDuration) || null;
  try {
    persistMergeOutputAndCommitPublications(execution, [outputPublication, postPublication], () => {
      taskService.runTaskMutation(db, taskId, signal, () => {
        throwIfAborted(signal);
        db.prepare(
          'UPDATE video_merges SET status = ?, merged_url = ?, duration = ?, completed_at = ?, error_msg = ? WHERE id = ?'
        ).run('completed', finalMergedUrl, duration, now, null, mergeId);
        updateCurrentMergeEpisodeOutput(db, mergeId, episodeId, finalMergedUrl, 'completed', now);
        if (!taskService.updateTaskResult(db, taskId, { merge_id: mergeId, video_url: finalMergedUrl, duration })) {
          throw new Error('视频合成任务已不再接受完成状态');
        }
        throwIfAborted(signal);
      });
    });
  } catch (error) {
    execution.rollbackPublication(outputPublication);
    execution.rollbackPublication(postPublication);
    throw error;
  }
  execution.keepFile(finalOutputPath);
  if (mergedSrtPath) execution.keepFile(mergedSrtPath);
  return { ok: true, merge_id: mergeId, video_url: finalMergedUrl, duration, status: 'completed' };
}

async function processVideoMerge(db, log, mergeId, baseUrl, options = {}) {
  const row = db.prepare('SELECT * FROM video_merges WHERE id = ? AND deleted_at IS NULL').get(Number(mergeId));
  if (!row) return;
  if (settleCancelledMergeBeforeWorker(db, log, row)) {
    return { ok: false, merge_id: Number(mergeId), status: 'cancelled', cancelled: true };
  }
  const execution = createMergeExecution(log, row, options.signal);
  let cancelled = false;
  try {
    return await processVideoMergeWorker(db, log, mergeId, baseUrl, execution);
  } catch (error) {
    if (execution.signal.aborted) {
      cancelled = true;
    } else if (error?.code === 'OPERATION_CANCELLED') {
      const task = require('./taskService').getTask(db, row.task_id);
      if (task?.status === 'cancelling' || task?.status === 'cancelled') {
        cancelled = true;
      } else if (task?.status === 'failed') {
        commitMergeFailure(db, row, task.error || error.message, execution.signal);
        throw strictMergeError(task.error || error.message || '合成任务已失败');
      } else {
        throw strictMergeError(error.message || '合成任务不再处于活动状态');
      }
    } else {
      throw error;
    }
  } finally {
    execution.finish();
  }
  if (cancelled) {
    await settleCancelledMergeAfterWorker(db, log, row, execution);
    return { ok: false, merge_id: Number(mergeId), status: 'cancelled', cancelled: true };
  }
}

function completeQaPendingMerge(db, mergeId, completedAt = new Date().toISOString()) {
  const row = db.prepare(
    `SELECT id, episode_id, task_id, merged_url, duration
       FROM video_merges
      WHERE id = ? AND status = 'qa_pending'`
  ).get(Number(mergeId));
  if (!row) return false;
  const complete = db.transaction(() => {
    const result = db.prepare(
      `UPDATE video_merges
          SET status = 'completed', completed_at = ?, error_msg = NULL
        WHERE id = ? AND status = 'qa_pending'`
    ).run(completedAt, row.id);
    if (result.changes === 0) return false;
    updateCurrentMergeEpisodeOutput(
      db,
      row.id,
      row.episode_id,
      row.merged_url,
      'completed',
      completedAt
    );
    if (row.task_id) {
      const taskService = require('./taskService');
      const task = taskService.getTask(db, row.task_id);
      if (task && task.status !== 'completed') {
        throw new Error('视频合成：QA 完成任务尚未完成');
      }
      if (task && !taskService.refreshCompletedTaskResult(db, row.task_id, {
        merge_id: row.id,
        video_url: row.merged_url,
        duration: row.duration,
        mode: STRICT_PRODUCTION_MODE,
        status: 'completed',
      })) {
        throw new Error('视频合成：QA 完成任务结果未能刷新');
      }
    }
    return true;
  });
  return complete();
}

module.exports = {
  list,
  getById,
  create,
  deleteById,
  completeQaPendingMerge,
  processVideoMerge,
  buildStrictSceneFilterPlan,
  updateCurrentMergeEpisodeOutput,
  __test: { runExternalProcess },
};
