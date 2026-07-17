const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const {
  getFfmpegPath,
  getFfprobePath,
  hasLocalFfmpeg,
  validateFfmpegTools,
  getAvailableFfmpegEncoders,
} = require('../utils/ffmpegPath');
const storageLayout = require('./storageLayout');
const uploadService = require('./uploadService');

const STRICT_PRODUCTION_MODE = 'strict_production';
const MAX_STRICT_SCENES = 100;
const MAX_REMOTE_VIDEO_BYTES = 256 * 1024 * 1024;
const MAX_REMOTE_MERGE_DOWNLOAD_BYTES = 1024 * 1024 * 1024;
const MAX_REMOTE_VIDEO_REDIRECTS = 3;
const REMOTE_VIDEO_TIMEOUT_MS = 60000;
const FFMPEG_TIMEOUT_MS = 15 * 60 * 1000;

function pathWithinStorage(storageRoot, relativePath) {
  const root = path.resolve(storageRoot);
  const target = path.resolve(root, String(relativePath || '').replace(/^[/\\]+/, ''));
  if (target === root || !target.startsWith(`${root}${path.sep}`)) return null;
  return target;
}

function list(db, query) {
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
  const rows = db.prepare('SELECT * ' + sql + ' ORDER BY created_at DESC').all(...params);
  return rows.map(rowToItem);
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
  if (!local) throw new uploadService.UnsafeMediaReferenceError('Video reference must be inside storage.');
  return local.relativePath;
}

function normalizeMergeScenes(reqScenes, db) {
  if (reqScenes == null) return [];
  if (!Array.isArray(reqScenes) || reqScenes.length > MAX_STRICT_SCENES) {
    throw new uploadService.UnsafeMediaReferenceError('Video merge scene list is invalid or too large.');
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
  const task = taskService.createTask(db, log, 'video_merge', String(req.episode_id || ''));
  const mergeOptionsJson = (() => {
    const source = req.merge_options;
    const o = source && typeof source === 'object' && !Array.isArray(source) ? { ...source } : {};
    if (req.mode === STRICT_PRODUCTION_MODE && o.mode == null) o.mode = STRICT_PRODUCTION_MODE;
    if (req.strict_production === true && o.strict_production == null) o.strict_production = true;
    return JSON.stringify(o);
  })();
  const info = db.prepare(
    `INSERT INTO video_merges (episode_id, drama_id, title, provider, model, status, scenes, merge_options, task_id, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
  ).run(
    Number(req.episode_id) || 0,
    Number(req.drama_id) || 0,
    req.title ?? null,
    req.provider || 'ffmpeg',
    req.model ?? null,
    JSON.stringify(scenes),
    mergeOptionsJson,
    task.id,
    now
  );
  return { merge_id: info.lastInsertRowid, task_id: task.id, ...getById(db, info.lastInsertRowid) };
}

function deleteById(db, log, id) {
  const now = new Date().toISOString();
  const result = db.prepare('UPDATE video_merges SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(now, Number(id));
  return result.changes > 0;
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
    if (maxBytes <= 0) throw new Error('remote video merge download budget exhausted');
    uploadService.assertUploadDiskCapacity(tempDir, maxBytes);
    const downloaded = await uploadService.downloadBufferViaNodeHttp(u, REMOTE_VIDEO_TIMEOUT_MS, 0, {
      maxBytes,
      maxRedirects: MAX_REMOTE_VIDEO_REDIRECTS,
      accept: 'video/*,application/octet-stream',
      trustedOrigins: options.trustedOrigins,
      lookup: options.lookup,
    });
    if (!downloaded.buffer.length) throw new Error('empty response body');
    uploadService.assertUploadDiskCapacity(tempDir, downloaded.buffer.length);
    fs.writeFileSync(destPath, downloaded.buffer, { flag: 'wx' });
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

function ffprobeVideo(filePath) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (error) {
    return { ok: false, error: error.message };
  }
  if (!stat.isFile() || stat.size <= 0) return { ok: false, error: 'not a non-empty file' };

  const result = spawnSync(
    getFfprobePath(),
    [
      '-v', 'error',
      '-show_entries', 'stream=codec_type,width,height,duration:format=duration',
      '-of', 'json',
      filePath,
    ],
    { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 30000, windowsHide: true }
  );
  if (result.error) return { ok: false, error: result.error.message };
  if (result.status !== 0) {
    return { ok: false, error: String(result.stderr || '').trim().slice(-800) || `ffprobe exited with status ${result.status}` };
  }

  let data;
  try {
    data = JSON.parse(result.stdout || '{}');
  } catch (error) {
    return { ok: false, error: `invalid ffprobe output: ${error.message}` };
  }
  const streams = Array.isArray(data.streams) ? data.streams : [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  const duration = Number(data.format?.duration) || Number(video?.duration);
  const width = Number(video?.width);
  const height = Number(video?.height);
  if (!video || !Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    return { ok: false, error: 'no usable video stream' };
  }
  if (!Number.isFinite(duration) || duration <= 0.01) {
    return { ok: false, error: 'video duration is unavailable or empty' };
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

function runFfmpeg(args, log, tag) {
  const result = spawnSync(getFfmpegPath(), args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: FFMPEG_TIMEOUT_MS,
    windowsHide: true,
  });
  if (result.error) {
    log.warn('Video merge: ffmpeg spawn error', { tag, error: result.error.message });
    return { ok: false, error: result.error.message };
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim().slice(-1200);
    log.warn('Video merge: ffmpeg failed', { tag, stderr: detail });
    return { ok: false, error: detail || `ffmpeg exited with status ${result.status}` };
  }
  return { ok: true, error: null };
}

function transcodeProductionClip(inputPath, probe, outputPath, dimensions, fps, videoEncoder, log, index, requestedDuration) {
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

  const result = runFfmpeg(args, log, `strict_transcode_${index}`);
  if (!result.ok) return result;
  const outputProbe = ffprobeVideo(outputPath);
  if (!outputProbe.ok) return { ok: false, error: `normalized clip is invalid: ${outputProbe.error}` };
  if (!outputProbe.hasAudio) return { ok: false, error: 'normalized clip has no audio stream' };
  if (outputProbe.width !== dimensions.width || outputProbe.height !== dimensions.height) {
    return { ok: false, error: `normalized clip has unexpected size ${outputProbe.width}x${outputProbe.height}` };
  }
  return { ok: true, probe: outputProbe };
}

/** 使用 ffmpeg concat 合并多个视频文件 */
function runFfmpegConcatDetailed(localPaths, outputPath, log, tag = 'concat', strictProduction = false) {
  const listFile = path.join(path.dirname(outputPath), `concat_list_${Date.now()}.txt`);
  try {
    const lines = localPaths.map((p) => {
      const normalized = p.replace(/\\/g, '/');
      return `file '${normalized.replace(/'/g, "'\\''")}'`;
    });
    fs.writeFileSync(listFile, lines.join('\n'), 'utf8');
    const args = strictProduction
      ? [
          '-hide_banner', '-loglevel', 'error', '-y',
          '-f', 'concat', '-safe', '0', '-i', listFile,
          '-c', 'copy', '-avoid_negative_ts', 'make_zero', '-movflags', '+faststart',
          outputPath,
        ]
      : ['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-y', outputPath];
    return runFfmpeg(args, log, tag);
  } finally {
    try { if (fs.existsSync(listFile)) fs.unlinkSync(listFile); } catch (_) {}
  }
}

function runFfmpegConcat(localPaths, outputPath, log) {
  return runFfmpegConcatDetailed(localPaths, outputPath, log).ok;
}

function markStrictMergeFailed(db, log, row, message) {
  const now = new Date().toISOString();
  const errorMessage = String(message || '严格生产合成失败').slice(0, 4000);
  try {
    const updateFailure = db.transaction(() => {
      db.prepare(
        `UPDATE video_merges
            SET status = 'failed', merged_url = NULL, duration = NULL, completed_at = ?, error_msg = ?
          WHERE id = ?`
      ).run(now, errorMessage, row.id);
      db.prepare('UPDATE episodes SET status = ?, updated_at = ? WHERE id = ?').run('failed', now, row.episode_id);
    });
    updateFailure();
  } catch (error) {
    log.error('Video merge: could not persist strict failure', {
      merge_id: row.id,
      error: error.message,
    });
  }

  if (row.task_id) {
    try {
      require('./taskService').updateTaskError(db, row.task_id, errorMessage);
    } catch (error) {
      log.error('Video merge: could not fail strict task', {
        merge_id: row.id,
        task_id: row.task_id,
        error: error.message,
      });
    }
  }
  return errorMessage;
}

function relativeStoragePath(storageRoot, absolutePath) {
  const relative = path.relative(storageRoot, absolutePath);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw strictMergeError('合成输出不在本地存储目录内');
  }
  return relative.replace(/\\/g, '/');
}

async function processStrictProductionMerge(db, log, row, scenes, mergeOpts, baseUrl) {
  const mergeId = row.id;
  const episodeId = row.episode_id;
  let tempRoot = null;
  const generatedFiles = new Set();

  try {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `drama-video-merge-${mergeId}-`));
    const strictScenes = validateStrictSceneCoverage(db, episodeId, scenes);
    const resolvedFilterPlan = buildStrictSceneFilterPlan(strictScenes);
    if (Array.isArray(mergeOpts.filter_plan) &&
        JSON.stringify(mergeOpts.filter_plan) !== JSON.stringify(resolvedFilterPlan)) {
      throw strictMergeError('Production timeline filter plan does not match merge scenes');
    }

    const toolCheck = validateFfmpegTools();
    if (!toolCheck.ok) throw strictMergeError(`严格生产合成工具校验失败：${toolCheck.error}`);
    const encoderCheck = getAvailableFfmpegEncoders();
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
        { downloadBudget, trustedOrigins }
      );
      if (!resolvedVideo) {
        throw strictMergeError(`严格生产合成缺少可用本地片段：分镜 ${strictScenes[i].storyboard_id}`);
      }
      const probe = ffprobeVideo(resolvedVideo.path);
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
      const transcoded = transcodeProductionClip(
        localInputs[i],
        inputProbes[i],
        normalizedPath,
        dimensions,
        fps,
        videoEncoder,
        log,
        i,
        strictScenes[i].duration
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
    const outputFileName = `merged_${mergeId}_${Date.now()}.mp4`;
    let outputAbsPath = path.join(mergedDir, outputFileName);
    generatedFiles.add(outputAbsPath);

    const concat = runFfmpegConcatDetailed(normalizedPaths, outputAbsPath, log, 'strict_concat', true);
    if (!concat.ok) throw strictMergeError(`严格生产 FFmpeg concat 失败：${concat.error}`);
    let outputProbe = ffprobeVideo(outputAbsPath);
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
        path.dirname(outputAbsPath),
        `${path.basename(outputAbsPath, path.extname(outputAbsPath))}_post.mp4`
      );
      generatedFiles.add(anticipatedPostPath);
      generatedFiles.add(path.join(
        path.dirname(outputAbsPath),
        `${path.basename(outputAbsPath, path.extname(outputAbsPath))}_narration.srt`
      ));
      const post = await require('./mergedEpisodePostProcess').runMergedEpisodePostProcess(db, log, {
        mergedAbsPath: outputAbsPath,
        storageRoot,
        scenes: strictScenes,
        episodeId,
        mergeOpts,
        videoEncoder,
      });
      if (!post.ok || !post.relativePath) {
        throw strictMergeError(`严格生产后处理失败：${post.error || '未生成输出文件'}`);
      }
      outputAbsPath = path.join(storageRoot, post.relativePath.replace(/\//g, path.sep));
      generatedFiles.add(outputAbsPath);
      outputProbe = ffprobeVideo(outputAbsPath);
      if (!outputProbe.ok || !outputProbe.hasAudio) {
        const reason = outputProbe.ok ? '后处理视频缺少音轨' : outputProbe.error;
        throw strictMergeError(`严格生产后处理输出无效：${reason}`);
      }
      if (outputProbe.duration < expectedOutputDuration - durationTolerance) {
        throw strictMergeError(
          `严格生产后处理输出不完整：预期约 ${expectedOutputDuration.toFixed(2)} 秒，实际 ${outputProbe.duration.toFixed(2)} 秒`
        );
      }
    }

    if (mergeOpts.enforce_qa_gate) try {
      const qaReport = require('./qaService').auditDrama(db, log, {
        drama_id: row.drama_id,
        episode_id: episodeId,
        mode: 'production',
      });
      if (!qaReport.passed) {
        throw strictMergeError(`Production QA failed with score ${qaReport.score}`);
      }
    } catch (error) {
      throw error.code === 'STRICT_PRODUCTION_MERGE_FAILED'
        ? error
        : strictMergeError(`Production QA failed: ${error.message}`);
    }

    const mergedRelativePath = relativeStoragePath(storageRoot, outputAbsPath);
    const completedAt = new Date().toISOString();
    const duration = Math.max(1, Math.round(outputProbe.duration));
    const completionStatus = mergeOpts.defer_qa_completion ? 'qa_pending' : 'completed';
    const completeMerge = db.transaction(() => {
      db.prepare(
        `UPDATE video_merges
            SET status = ?, merged_url = ?, duration = ?, completed_at = ?, error_msg = NULL
          WHERE id = ?`
      ).run(completionStatus, mergedRelativePath, duration, completionStatus === 'completed' ? completedAt : null, mergeId);
      db.prepare('UPDATE episodes SET video_url = ?, status = ?, updated_at = ? WHERE id = ?')
        .run(mergedRelativePath, completionStatus, completedAt, episodeId);
    });
    completeMerge();
    if (row.task_id && completionStatus === 'completed') {
      require('./taskService').updateTaskResult(db, row.task_id, {
        merge_id: mergeId,
        video_url: mergedRelativePath,
        duration,
        mode: STRICT_PRODUCTION_MODE,
      });
    }
    log.info('Video merge output persisted (strict production)', {
      merge_id: mergeId,
      episode_id: episodeId,
      output: mergedRelativePath,
      status: completionStatus,
    });
    return { ok: true, merge_id: mergeId, video_url: mergedRelativePath, duration, status: completionStatus };
  } catch (error) {
    for (const filePath of generatedFiles) {
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch (_) {}
    }
    const detail = error?.message || String(error);
    const message = markStrictMergeFailed(db, log, row, detail);
    const failure = strictMergeError(message);
    failure.cause = error;
    throw failure;
  } finally {
    try {
      if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch (_) {}
  }
}

/**
 * 异步处理视频合成：优先使用 ffmpeg 真正合并多段视频；失败或无 ffmpeg 时用首段作为 merged_url。
 */
async function processVideoMerge(db, log, mergeId, baseUrl) {
  const r = db.prepare('SELECT * FROM video_merges WHERE id = ? AND deleted_at IS NULL').get(mergeId);
  if (!r) return;
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
  db.prepare('UPDATE video_merges SET status = ? WHERE id = ?').run('processing', mergeId);
  if (strictProduction) {
    return processStrictProductionMerge(db, log, r, scenes, mergeOpts, baseUrl);
  }
  const taskService = require('./taskService');
  if (scenes.length === 0) {
    db.prepare('UPDATE video_merges SET status = ?, error_msg = ? WHERE id = ?').run('failed', '无有效视频片段', mergeId);
    if (taskId) taskService.updateTaskError(db, taskId, '无有效视频片段');
    return;
  }
  const totalDuration = scenes.reduce((sum, s) => sum + (Number(s.duration) || 0), 0);
  const storageRoot = getStorageRoot();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `drama-video-merge-${mergeId}-`));
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
      { downloadBudget, trustedOrigins }
    );
    if (resolved) resolvedVideos.push(resolved);
  }
  if (resolvedVideos.length === 0) {
    const message = '无安全且可用的视频片段';
    fs.rmSync(tempDir, { recursive: true, force: true });
    db.prepare('UPDATE video_merges SET status = ?, error_msg = ? WHERE id = ?').run('failed', message, mergeId);
    db.prepare('UPDATE episodes SET status = ?, updated_at = ? WHERE id = ?').run('failed', now, episodeId);
    if (taskId) taskService.updateTaskError(db, taskId, message);
    return;
  }
  const localPaths = resolvedVideos.map((item) => item.path);

  const ffmpegAvailable = hasLocalFfmpeg();
  log.info('Video merge: ffmpeg check', {
    merge_id: mergeId,
    has_ffmpeg: ffmpegAvailable,
    ffmpeg_path: getFfmpegPath(),
    local_video_count: localPaths.length,
    cwd: process.cwd(),
  });

  let mergedRelativePath = null;
  if (localPaths.length > 0 && ffmpegAvailable && localPaths.length <= 100) {
    const projectSubdir = storageLayout.getProjectStorageSubdir(db, r.drama_id);
    const sub = projectSubdir && String(projectSubdir).trim();
    const mergedDir = sub
      ? path.join(storageRoot, sub, 'videos', 'merged')
      : path.join(storageRoot, 'videos', 'merged');
    if (!fs.existsSync(mergedDir)) fs.mkdirSync(mergedDir, { recursive: true });
    const outputFileName = `merged_${Date.now()}.mp4`;
    const outputPath = path.join(mergedDir, outputFileName);
    const ok = runFfmpegConcat(localPaths, outputPath, log);
    if (ok && fs.existsSync(outputPath)) {
      mergedRelativePath = sub
        ? path.join(sub, 'videos', 'merged', outputFileName).replace(/\\/g, '/')
        : path.join('videos', 'merged', outputFileName).replace(/\\/g, '/');
      log.info('Video merge completed (ffmpeg)', { merge_id: mergeId, episode_id: episodeId, output: mergedRelativePath });
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
      const post = await mergedPP.runMergedEpisodePostProcess(db, log, {
        mergedAbsPath,
        storageRoot,
        scenes,
        episodeId,
        mergeOpts,
      });
      if (post.ok && post.relativePath) {
        mergedRelativePath = post.relativePath;
        log.info('Video merge: merged episode post-process', { merge_id: mergeId, out: mergedRelativePath });
      } else if (post.error && post.error !== 'NO_POST_OPTS') {
        log.warn('Video merge: post-process skipped', { merge_id: mergeId, err: post.error });
      }
    }
  }

  const finalMergedUrl = mergedRelativePath || resolvedVideos[0].canonical;
  fs.rmSync(tempDir, { recursive: true, force: true });
  db.prepare(
    'UPDATE video_merges SET status = ?, merged_url = ?, duration = ?, completed_at = ?, error_msg = ? WHERE id = ?'
  ).run('completed', finalMergedUrl, Math.round(totalDuration) || null, now, null, mergeId);
  db.prepare('UPDATE episodes SET video_url = ?, status = ?, updated_at = ? WHERE id = ?').run(finalMergedUrl, 'completed', now, episodeId);
  try {
    const qaService = require('./qaService');
    const qaReport = qaService.auditDrama(db, log, {
      drama_id: r.drama_id,
      episode_id: episodeId,
      mode: 'production',
    });
    if (!qaReport.passed && mergeOpts.enforce_qa_gate) {
      const msg = `Production QA failed with score ${qaReport.score}`;
      db.prepare('UPDATE video_merges SET status = ?, error_msg = ? WHERE id = ?').run('failed', msg, mergeId);
      db.prepare('UPDATE episodes SET status = ?, updated_at = ? WHERE id = ?').run('draft', now, episodeId);
      if (taskId) taskService.updateTaskError(db, taskId, msg);
      return;
    }
  } catch (e) {
    log.warn('Video merge: production QA skipped', { merge_id: mergeId, error: e.message });
  }
  if (taskId) {
    taskService.updateTaskResult(db, taskId, { merge_id: mergeId, video_url: finalMergedUrl, duration: Math.round(totalDuration) });
  }
  if (!mergedRelativePath) {
    log.info('Video merge completed (first-clip fallback)', { merge_id: mergeId, episode_id: episodeId });
  }
}

module.exports = {
  list,
  getById,
  create,
  deleteById,
  processVideoMerge,
  buildStrictSceneFilterPlan,
};
