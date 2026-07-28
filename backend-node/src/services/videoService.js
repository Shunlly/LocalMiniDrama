/** 轮询/同步返回的 video_url 须为 http(s)，避免中转 FAILURE 时 result_url 为错误文案 */
function resolveRemoteVideoUrl(videoUrl, fallbackError) {
  if (videoUrl && videoClient.isPlausibleHttpVideoUrl(videoUrl)) {
    return { ok: true, video_url: String(videoUrl).trim() };
  }
  if (videoUrl) {
    return { ok: false, error: (fallbackError || String(videoUrl)).slice(0, 500) };
  }
  return { ok: false, error: (fallbackError || '超时或失败').slice(0, 500) };
}

/** 将 video_generations 标为失败；若无 error_msg 列则只更新 status/updated_at */
function setVideoGenFailed(db, videoGenId, errorMsg, now) {
  try {
    db.prepare('UPDATE video_generations SET status = ?, error_msg = ?, updated_at = ? WHERE id = ?').run(
      'failed', (errorMsg || '').slice(0, 500), now, videoGenId
    );
  } catch (e) {
    if ((e.message || '').includes('error_msg')) {
      db.prepare('UPDATE video_generations SET status = ?, updated_at = ? WHERE id = ?').run('failed', now, videoGenId);
    } else throw e;
  }
}

function list(db, query) {
  let sql = 'FROM video_generations WHERE deleted_at IS NULL';
  const params = [];
  if (query.drama_id) {
    sql += ' AND drama_id = ?';
    params.push(query.drama_id);
  }
  if (query.storyboard_id) {
    sql += ' AND storyboard_id = ?';
    params.push(query.storyboard_id);
  }
  // 与 Go 前端行为对齐：请求 status=processing 时，同时包含“刚结束”的记录（5 分钟内变为 completed/failed），
  // 这样轮询刷新后任务不会从列表消失，无需改 Vue
  if (query.status === 'processing') {
    sql += " AND (status = 'processing' OR (status IN ('completed','failed') AND updated_at >= datetime('now', '-5 minutes')))";
  } else if (query.status) {
    sql += ' AND status = ?';
    params.push(query.status);
  }
  const countRow = db.prepare('SELECT COUNT(*) as total ' + sql).get(...params);
  const total = countRow.total || 0;
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.page_size, 10) || 20));
  const offset = (page - 1) * pageSize;
  const rows = db.prepare('SELECT * ' + sql + ' ORDER BY created_at DESC LIMIT ? OFFSET ?').all(...params, pageSize, offset);
  return { items: rows.map(rowToItem), total, page, pageSize };
}

function rowToItem(r) {
  let referenceImageUrls = [];
  try {
    const parsed = JSON.parse(r.reference_image_urls || '[]');
    if (Array.isArray(parsed)) referenceImageUrls = parsed;
  } catch (_) {}
  return {
    id: r.id,
    storyboard_id: r.storyboard_id,
    drama_id: r.drama_id,
    provider: r.provider,
    prompt: r.prompt,
    model: r.model,
    image_gen_id: r.image_gen_id,
    image_url: r.image_url,
    first_frame_url: r.first_frame_url ?? null,
    last_frame_url: r.last_frame_url ?? null,
    reference_image_urls: referenceImageUrls,
    video_url: r.video_url,
    local_path: r.local_path,
    status: r.status,
    task_id: r.task_id,
    provider_task_id: r.provider_task_id,
    idempotency_key: r.idempotency_key,
    error_msg: r.error_msg,
    created_at: r.created_at,
    updated_at: r.updated_at,
    completed_at: r.completed_at,
  };
}

function getById(db, id) {
  const r = db.prepare('SELECT * FROM video_generations WHERE id = ? AND deleted_at IS NULL').get(Number(id));
  return r ? rowToItem(r) : null;
}

function badRequest(message) {
  const error = new Error(message);
  error.code = 'BAD_REQUEST';
  return error;
}

function parseConfigSettings(config) {
  const value = config?.settings;
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function configuredVideoModel(config, preferredModel) {
  return aiConfigService.resolveConfiguredModel(config, preferredModel, '');
}

function videoConfigSupportsGridReference(config, preferredModel) {
  if (!config) return false;
  const settings = parseConfigSettings(config);
  if (settings.supports_grid_reference === true) return true;
  if (settings.supports_grid_reference === false) return false;

  const model = configuredVideoModel(config, preferredModel).toLowerCase();
  const protocol = videoClient.resolveVideoProtocol(config, model);
  if (protocol === 'kling_omni' || protocol === 'agnes') return true;
  if (protocol === 'volcengine_omni') {
    return model.includes('seedance') && (/2[-_]0/.test(model) || /seedance[-_]?2|seedance2/.test(model));
  }
  return String(config.provider || '').trim().toLowerCase() === 'agnes' || /agnes-video/.test(model);
}

function normalizedLocalReferencePath(value) {
  const text = String(value || '').trim().replace(/\\/g, '/');
  if (!text) return '';
  let pathname = text;
  try {
    const parsed = new URL(text, 'http://localminidrama.invalid');
    pathname = decodeURIComponent(parsed.pathname || '');
  } catch (_) {}
  pathname = pathname.replace(/\\/g, '/').replace(/^\/+/, '');
  if (pathname.toLowerCase().startsWith('static/')) pathname = pathname.slice('static/'.length);
  if (!pathname || pathname.split('/').some((part) => part === '..' || part === '.')) return '';
  return pathname;
}

function referenceIdentity(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const localPath = normalizedLocalReferencePath(text);
  const looksLocal = !/^[a-z][a-z0-9+.-]*:/i.test(text) || /\/static\//i.test(text);
  if (looksLocal && localPath) return `local:${localPath}`;
  try {
    const parsed = new URL(text);
    if (!['http:', 'https:'].includes(parsed.protocol)) return `raw:${text}`;
    parsed.hash = '';
    return `url:${parsed.toString()}`;
  } catch (_) {
    return `raw:${text}`;
  }
}

function normalizeSubmittedMediaReference(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (text.startsWith('/static/')) {
    return `/static/${uploadService.normalizeStorageRelativeReference(text.slice('/static/'.length))}`;
  }
  if (/^https?:\/\//i.test(text)) {
    let parsed;
    try { parsed = new URL(text); } catch (_) { throw badRequest('参考媒体 URL 无效'); }
    const host = String(parsed.hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
    if ((host === 'localhost' || host === '127.0.0.1' || host === '::1') && parsed.pathname.startsWith('/static/')) {
      return `/static/${uploadService.normalizeStorageRelativeReference(parsed.pathname.slice('/static/'.length))}`;
    }
    try { return uploadService.assertPublicHttpUrlSyntax(text).toString(); }
    catch (_) { throw badRequest('参考媒体 URL 必须是无凭据的公网 HTTP(S) 地址'); }
  }
  try { return `/static/${uploadService.normalizeStorageRelativeReference(text)}`; }
  catch (_) { throw badRequest('参考媒体本地路径必须位于 storage 内'); }
}

function loadVideoReferenceImage(db, storyboardId, dramaId, value) {
  if (value == null || value === '') return null;
  const imageId = Number(value);
  if (!Number.isInteger(imageId) || imageId <= 0) throw badRequest('宫格视频参考图 ID 无效');
  if (!Number.isInteger(storyboardId) || storyboardId <= 0) {
    throw badRequest('选择宫格视频参考图时必须提供有效的 storyboard_id');
  }
  const row = db.prepare(
    `SELECT ig.id, ig.storyboard_id, ig.image_url, ig.local_path, e.drama_id
       FROM image_generations ig
       JOIN storyboards s ON s.id = ig.storyboard_id AND s.deleted_at IS NULL
       JOIN episodes e ON e.id = s.episode_id AND e.deleted_at IS NULL
      WHERE ig.id = ? AND ig.storyboard_id = ? AND ig.status = 'completed'
        AND ig.deleted_at IS NULL AND ig.frame_type IN ('quad_grid', 'nine_grid')`
  ).get(imageId, storyboardId);
  if (!row || (dramaId > 0 && Number(row.drama_id) !== dramaId)) {
    throw badRequest('宫格视频参考图不存在或不属于当前分镜');
  }
  const canonical = row.local_path
    ? `/static/${String(row.local_path).replace(/^\/+/, '').replace(/\\/g, '/')}`
    : String(row.image_url || '').trim();
  if (!canonical) throw badRequest('宫格视频参考图缺少可用地址');
  return { ...row, canonical, identity: referenceIdentity(canonical) };
}

function normalizeReferenceUrls(value) {
  if (value == null || value === '') return [];
  if (!Array.isArray(value)) throw badRequest('reference_image_urls 必须是数组');
  const urls = [];
  const seen = new Set();
  for (const item of value) {
    const url = normalizeSubmittedMediaReference(item);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
    if (urls.length >= 10) break;
  }
  return urls;
}

function createVideoGeneration(db, log, body, options = {}) {
  const now = new Date().toISOString();
  let dramaId = Number(body.drama_id) || 0;
  const storyboardId = body.storyboard_id != null ? Number(body.storyboard_id) : null;
  if (storyboardId != null) {
    if (!Number.isInteger(storyboardId) || storyboardId <= 0) throw badRequest('storyboard_id 无效');
    const scope = db.prepare(
      `SELECT e.drama_id
         FROM storyboards s
         JOIN episodes e ON e.id = s.episode_id AND e.deleted_at IS NULL
        WHERE s.id = ? AND s.deleted_at IS NULL`
    ).get(storyboardId);
    if (!scope || (dramaId > 0 && Number(scope.drama_id) !== dramaId)) {
      throw badRequest('分镜不存在或不属于当前剧集');
    }
    dramaId = Number(scope.drama_id);
  }
  const provider = String(body.provider || '').trim() || null;
  let prompt = body.prompt || '';
  const style = String(body.style || '').trim();
  if (style && !String(prompt).toLowerCase().includes(style.toLowerCase())) {
    prompt = prompt ? `${prompt}. Style: ${style}` : `Style: ${style}`;
  }
  let aspectRatio = null;
  if (body.aspect_ratio != null && String(body.aspect_ratio).trim() !== '') {
    aspectRatio = videoClient.normalizeAspectRatioForApi(body.aspect_ratio);
  }
  if (!aspectRatio && dramaId) {
    try {
      const dramaRow = db.prepare('SELECT metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(dramaId);
      const metadata = dramaRow?.metadata
        ? (typeof dramaRow.metadata === 'string' ? JSON.parse(dramaRow.metadata) : dramaRow.metadata)
        : null;
      if (metadata?.aspect_ratio) aspectRatio = videoClient.normalizeAspectRatioForApi(metadata.aspect_ratio);
    } catch (_) {}
  }
  let imageUrl = normalizeSubmittedMediaReference(body.image_url);
  let firstFrameUrl = normalizeSubmittedMediaReference(body.first_frame_url ?? body.first_frame_local_path);
  const lastFrameUrl = normalizeSubmittedMediaReference(body.last_frame_url ?? body.last_frame_local_path);
  let referenceUrls = normalizeReferenceUrls(body.reference_image_urls);
  const gridReference = loadVideoReferenceImage(
    db,
    storyboardId,
    dramaId,
    body.video_reference_image_id
  );
  if (gridReference) {
    const selectedConfig = videoClient.getDefaultVideoConfig(db, body.model, provider);
    if (!selectedConfig) throw badRequest('未配置可用于宫格参考的视频模型');
    if (!videoConfigSupportsGridReference(selectedConfig, body.model)) {
      throw badRequest('当前视频模型未声明支持宫格整图参考');
    }

    const suppliedPrimary = [body.image_url, body.first_frame_url, body.first_frame_local_path]
      .map((item) => String(item || '').trim())
      .filter(Boolean);
    if (suppliedPrimary.some((item) => referenceIdentity(item) !== gridReference.identity)) {
      throw badRequest('宫格视频参考图 ID 与提交的主图地址不一致');
    }
    const hasCanonicalReference = referenceUrls.some(
      (item) => referenceIdentity(item) === gridReference.identity
    );
    if (referenceUrls.length > 0 && suppliedPrimary.length === 0 && !hasCanonicalReference) {
      throw badRequest('宫格视频参考图 ID 与提交的参考图地址不一致');
    }

    imageUrl = gridReference.canonical;
    firstFrameUrl = gridReference.canonical;
    referenceUrls = [
      gridReference.canonical,
      ...referenceUrls.filter((item) => referenceIdentity(item) !== gridReference.identity),
    ].slice(0, 10);
  }
  const refImagesJson = referenceUrls.length ? JSON.stringify(referenceUrls) : null;
  const idempotencyKey = String(body.idempotency_key || '').trim() || null;
  if (idempotencyKey) {
    const existing = db.prepare(
      `SELECT id FROM video_generations
        WHERE idempotency_key = ? AND drama_id = ? AND deleted_at IS NULL`
    ).get(idempotencyKey, dramaId);
    if (existing) return { ...getById(db, existing.id), idempotent_reuse: true };
  }
  const providerConfig = videoClient.getDefaultVideoConfig(db, body.model, provider);
  if (!providerConfig) throw badRequest('缺少已启用的视频生成配置');
  if (!configuredVideoModel(providerConfig, body.model)) {
    throw badRequest('视频生成配置尚未选择可用模型');
  }
  const task = taskService.createTask(db, log, 'video_generation', String(body.drama_id || ''));
  const info = db.prepare(
    `INSERT INTO video_generations
     (drama_id, storyboard_id, provider, prompt, model, duration, aspect_ratio, resolution, seed,
      camera_fixed, watermark, image_url, first_frame_url, last_frame_url, reference_image_urls,
       status, task_id, idempotency_key, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?, ?, ?)`
  ).run(
    dramaId,
    storyboardId,
    provider,
    prompt,
    body.model ?? null,
    body.duration ?? null,
    aspectRatio,
    body.resolution ?? null,
    body.seed != null ? Number(body.seed) : null,
    body.camera_fixed != null ? (body.camera_fixed ? 1 : 0) : null,
    body.watermark != null ? (body.watermark ? 1 : 0) : 0,
    imageUrl,
    firstFrameUrl,
    lastFrameUrl,
    refImagesJson,
    task.id,
    idempotencyKey,
    now,
    now
  );
  const videoGenId = Number(info.lastInsertRowid);
  if (options.defer_processing !== true) {
    scheduleLegacyAsync(log, 'video_generation_route', () => {
      processVideoGeneration(db, log, videoGenId);
    }, { video_generation_id: videoGenId, task_id: task.id, drama_id: dramaId });
  }
  return getById(db, videoGenId) || { id: videoGenId, task_id: task.id, status: 'processing' };
}

async function createAndProcessVideo(db, log, body) {
  const created = createVideoGeneration(db, log, body, { defer_processing: true });
  if (created.status === 'completed') return created;
  if (created.idempotent_reuse && created.status === 'failed') {
    db.prepare("UPDATE video_generations SET status = 'processing', error_msg = NULL, updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), created.id);
  }
  await processVideoGeneration(db, log, created.id);
  const completed = getById(db, created.id);
  if (!completed || completed.status !== 'completed') {
    throw new Error(completed?.error_msg || 'Video generation did not complete');
  }
  if (body.require_local !== false && !String(completed.local_path || '').trim()) {
    const message = 'Video generation completed without a durable local file';
    const now = new Date().toISOString();
    setVideoGenFailed(db, created.id, message, now);
    if (created.task_id) taskService.updateTaskError(db, created.task_id, message);
    throw new Error(message);
  }
  return completed;
}

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { randomUUID } = require('crypto');
const videoClient = require('./videoClient');
const aiConfigService = require('./aiConfigService');
const taskService = require('./taskService');
const storageLayout = require('./storageLayout');
const uploadService = require('./uploadService');
const { scheduleLegacyAsync } = require('./legacyAsyncSchedulerService');
const { getFfmpegPath, hasLocalFfmpeg } = require('../utils/ffmpegPath');

/** @returns {{ dir: string, relPrefix: string }} 与图片 uploads 一致的工程子目录规则 */
function resolveVideosDir(storagePath, projectSubdir) {
  const sub = projectSubdir && String(projectSubdir).trim();
  if (sub) {
    const relPrefix = `${sub.replace(/\\/g, '/')}/videos`;
    return { dir: path.join(storagePath, sub, 'videos'), relPrefix };
  }
  return { dir: path.join(storagePath, 'videos'), relPrefix: 'videos' };
}

/**
 * 将远程 video_url 下载到本地
 * @returns {string|null} 相对 storage 根的路径，如 projects/.../videos/vg_1_xxx.mp4；无工程时为 videos/...
 */
async function downloadVideoToLocal(storagePath, videoUrl, videoGenId, log, projectSubdir = null, networkOptions = {}) {
  if (!videoUrl || typeof videoUrl !== 'string') return null;
  const { dir, relPrefix } = resolveVideosDir(storagePath, projectSubdir);
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const ext = (videoUrl.split('?')[0].match(/\.(mp4|webm|mov)$/i) || [])[1] || 'mp4';
    const name = `vg_${videoGenId}_${randomUUID().slice(0, 8)}.${ext}`;
    const filePath = path.join(dir, name);
    const result = await uploadService.downloadBufferViaNodeHttp(videoUrl, 120000, 0, {
      maxBytes: 512 * 1024 * 1024,
      accept: 'video/*,application/octet-stream',
      trustedOrigins: networkOptions.trustedOrigins,
    });
    uploadService.assertUploadDiskCapacity(storagePath, result.buffer.length);
    fs.writeFileSync(filePath, result.buffer, { flag: 'wx' });
    const relativePath = `${relPrefix}/${name}`.replace(/\\/g, '/');
    log.info('Video saved to local', { videoGenId, local_path: relativePath, projectSubdir: projectSubdir || '(root)' });
    return relativePath;
  } catch (e) {
    log.warn('Download video error', { videoGenId, error: e.message });
    return null;
  }
}

/** 与图生 aspectRatioToSize 对齐的归一化分辨率（偶数像素，便于 H.264） */
function targetVideoPixelsForAspect(aspectRatio, resolution) {
  const r = String(aspectRatio || '16:9').trim();
  const resolutionMatch = String(resolution || '').trim().match(/^(\d{3,4})p$/i);
  if (resolutionMatch) {
    const shortEdge = Math.min(2160, Math.max(144, Number(resolutionMatch[1])));
    const ratioMatch = r.match(/^(\d+)\s*:\s*(\d+)$/);
    const widthRatio = ratioMatch ? Number(ratioMatch[1]) : 16;
    const heightRatio = ratioMatch ? Number(ratioMatch[2]) : 9;
    if (widthRatio > 0 && heightRatio > 0) {
      if (widthRatio >= heightRatio) {
        return {
          w: Math.max(2, Math.round((shortEdge * widthRatio) / heightRatio / 2) * 2),
          h: Math.max(2, Math.round(shortEdge / 2) * 2),
        };
      }
      return {
        w: Math.max(2, Math.round(shortEdge / 2) * 2),
        h: Math.max(2, Math.round((shortEdge * heightRatio) / widthRatio / 2) * 2),
      };
    }
  }
  const map = {
    '16:9': { w: 2560, h: 1440 },
    '9:16': { w: 1440, h: 2560 },
    '1:1': { w: 1920, h: 1920 },
    '4:3': { w: 1920, h: 1440 },
    '3:4': { w: 1440, h: 1920 },
    '3:2': { w: 2560, h: 1708 },
    '2:3': { w: 1708, h: 2560 },
    '21:9': { w: 2560, h: 1080 },
  };
  if (map[r]) return map[r];
  const m = r.match(/^(\d+)\s*:\s*(\d+)$/);
  if (m) {
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    if (a > 0 && b > 0 && a !== b) {
      if (a > b) {
        const w = 2560;
        const h = Math.max(2, Math.round((w * b) / a / 2) * 2);
        return { w, h };
      }
      const h = 2560;
      const w = Math.max(2, Math.round((h * a) / b / 2) * 2);
      return { w, h };
    }
  }
  return { w: 1280, h: 720 };
}

/**
 * 用 ffmpeg 将视频缩放并加黑边到固定分辨率，避免 Grok 等返回实际像素不一致导致连播时画面跳动。
 */
function normalizeVideoFileToTargetPixels(absPath, tw, th, log, videoGenId) {
  if (!absPath || !tw || !th || !fs.existsSync(absPath)) return false;
  if (!hasLocalFfmpeg()) {
    log.info('[视频] 未找到 ffmpeg，跳过画幅归一化', { videoGenId });
    return false;
  }
  const ffmpeg = getFfmpegPath();
  const vf = `scale=${tw}:${th}:force_original_aspect_ratio=decrease,pad=${tw}:${th}:(ow-iw)/2:(oh-ih)/2:black`;
  const tmpOut = absPath + '.norm-' + randomUUID().slice(0, 8) + (path.extname(absPath) || '.mp4');
  const baseArgs = ['-y', '-i', absPath, '-vf', vf, '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
  let r = spawnSync(ffmpeg, [...baseArgs, '-c:a', 'copy', tmpOut], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) {
    r = spawnSync(ffmpeg, [...baseArgs, '-an', tmpOut], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  }
  if (r.status !== 0) {
    log.warn('[视频] 画幅归一化失败（保留原文件）', {
      videoGenId,
      stderr: (r.stderr || '').slice(-500),
    });
    try {
      fs.unlinkSync(tmpOut);
    } catch (_) {}
    return false;
  }
  try {
    fs.unlinkSync(absPath);
    fs.renameSync(tmpOut, absPath);
    log.info('[视频] 已统一画幅尺寸', { videoGenId, w: tw, h: th });
    return true;
  } catch (e) {
    log.warn('[视频] 替换归一化文件失败', { videoGenId, error: e.message });
    try {
      fs.unlinkSync(tmpOut);
    } catch (_) {}
    return false;
  }
}

function maybeNormalizeVideoAfterDownload(storagePath, localPath, row, videoGenId, log) {
  if (!localPath) return;
  const abs = path.join(storagePath, localPath);
  const dim = targetVideoPixelsForAspect(row.aspect_ratio, row.resolution);
  normalizeVideoFileToTargetPixels(abs, dim.w, dim.h, log, videoGenId);
}

/** 防止同一 videoGenId 重复发起 poll（含重启恢复） */
const activeVideoPolls = new Set();

function resolveStoragePath(cfg) {
  return path.isAbsolute(cfg.storage?.local_path)
    ? cfg.storage.local_path
    : path.join(process.cwd(), cfg.storage?.local_path || './data/storage');
}

function persistCompletedVideo(db, videoGenId, row, videoUrl, localPath, now) {
  const persist = db.transaction(() => {
    try {
      db.prepare(
        'UPDATE video_generations SET status = ?, video_url = ?, local_path = ?, completed_at = ?, updated_at = ? WHERE id = ?'
      ).run('completed', videoUrl, localPath, now, now, videoGenId);
    } catch (e) {
      if ((e.message || '').includes('completed_at')) {
        db.prepare(
          'UPDATE video_generations SET status = ?, video_url = ?, local_path = ?, updated_at = ? WHERE id = ?'
        ).run('completed', videoUrl, localPath, now, videoGenId);
      } else throw e;
    }
    if (row.storyboard_id) {
      db.prepare(
        'UPDATE storyboards SET video_url = ?, video_local_path = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
      ).run(videoUrl, localPath, now, row.storyboard_id);
    }
  });
  persist();
}

async function finalizeSuccessfulVideo(db, log, videoGenId, row, rowForAspect, videoUrl, logLabel, providerConfig) {
  const now = new Date().toISOString();
  const providerEnabled = providerConfig?.is_active === true
    || providerConfig?.is_active === 1
    || providerConfig?.is_active === '1';
  const trustedOrigins = providerEnabled ? [providerConfig?.base_url].filter(Boolean) : [];
  const validatedVideo = await uploadService.validatePublicHttpUrl(videoUrl, { trustedOrigins });
  videoUrl = validatedVideo.url;
  let localPath = null;
  try {
    const cfg = require('../config').loadConfig();
    const storagePath = resolveStoragePath(cfg);
    const projectSubdir = storageLayout.getProjectStorageSubdir(db, row.drama_id);
    localPath = await downloadVideoToLocal(storagePath, videoUrl, videoGenId, log, projectSubdir, { trustedOrigins });
    maybeNormalizeVideoAfterDownload(storagePath, localPath, rowForAspect, videoGenId, log);
  } catch (_) {}
  persistCompletedVideo(db, videoGenId, row, videoUrl, localPath, now);
  if (row.storyboard_id) {
    log.info('Updated storyboard video' + (logLabel ? ` (${logLabel})` : ''), {
      storyboard_id: row.storyboard_id,
      video_url: videoUrl,
      video_local_path: localPath,
    });
  }
  if (row.task_id) {
    taskService.updateTaskResult(db, row.task_id, {
      video_generation_id: videoGenId,
      video_url: videoUrl,
      status: 'completed',
    });
  }
  log.info('Video generation completed' + (logLabel ? ` (${logLabel})` : ''), {
    id: videoGenId,
    video_url: videoUrl,
    local_path: localPath,
  });
}

async function pollProviderTaskAndFinalize(db, log, videoGenId, row, rowForAspect, providerTaskId, config) {
  const cfg = require('../config').loadConfig();
  const POLL_INTERVAL_MS = 10000;
  const { resolveVideoGenerationTimeoutMinutes } = require('../config/videoGeneration');
  const generationTimeoutMinutes = resolveVideoGenerationTimeoutMinutes(cfg);
  const pollMaxAttempts = Math.max(
    1,
    Math.ceil((generationTimeoutMinutes * 60 * 1000) / POLL_INTERVAL_MS)
  );
  const pollResult = await videoClient.pollVideoTask(
    db,
    log,
    videoGenId,
    providerTaskId,
    config,
    pollMaxAttempts,
    POLL_INTERVAL_MS
  );
  const now = new Date().toISOString();
  const polledVideo = resolveRemoteVideoUrl(pollResult.video_url, pollResult.error);
  if (polledVideo.ok) {
    await finalizeSuccessfulVideo(db, log, videoGenId, row, rowForAspect, polledVideo.video_url, 'after poll', config);
  } else {
    setVideoGenFailed(db, videoGenId, polledVideo.error, now);
    if (row.task_id) taskService.updateTaskError(db, row.task_id, polledVideo.error);
    log.error('Video generation failed (after poll)', { id: videoGenId, error: polledVideo.error });
  }
}

/**
 * 服务重启后恢复对厂商异步任务的轮询（需已持久化 provider_task_id）
 */
async function resumePollForVideoGeneration(db, log, videoGenId) {
  if (activeVideoPolls.has(videoGenId)) {
    log.info('Video poll already active, skip resume', { videoGenId });
    return;
  }
  const row = db.prepare('SELECT * FROM video_generations WHERE id = ? AND deleted_at IS NULL').get(Number(videoGenId));
  if (!row || row.status !== 'processing') return;
  const providerTaskId = row.provider_task_id && String(row.provider_task_id).trim();
  if (!providerTaskId) return;

  const config = videoClient.getDefaultVideoConfig(db, row.model, row.provider);
  if (!config) {
    const now = new Date().toISOString();
    setVideoGenFailed(db, videoGenId, '未配置视频模型', now);
    if (row.task_id) taskService.updateTaskError(db, row.task_id, '未配置视频模型');
    return;
  }

  activeVideoPolls.add(videoGenId);
  log.info('Resuming video generation poll after restart', {
    videoGenId,
    provider_task_id: providerTaskId,
  });
  try {
    let aspectForVideo = row.aspect_ratio;
    if (aspectForVideo) {
      const n = videoClient.normalizeAspectRatioForApi(aspectForVideo);
      if (n) aspectForVideo = n;
    }
    const rowForAspect = { ...row, aspect_ratio: aspectForVideo || row.aspect_ratio };
    await pollProviderTaskAndFinalize(db, log, videoGenId, row, rowForAspect, providerTaskId, config);
  } catch (err) {
    const now = new Date().toISOString();
    setVideoGenFailed(db, videoGenId, err.message, now);
    if (row.task_id) taskService.updateTaskError(db, row.task_id, err.message);
    log.error('Video generation resume poll error', { id: videoGenId, error: err.message });
  } finally {
    activeVideoPolls.delete(videoGenId);
  }
}

/** 启动时恢复 processing 视频任务；无 provider_task_id 的视为中断 */
function resumeProcessingVideoGenerations(db, log) {
  const stuck = db
    .prepare(
      `SELECT id, task_id FROM video_generations
       WHERE status = 'processing' AND deleted_at IS NULL
         AND (provider_task_id IS NULL OR TRIM(provider_task_id) = '')`
    )
    .all();
  const stuckMsg = '服务重启后无法恢复轮询（缺少厂商任务 ID），请重新生成';
  for (const s of stuck) {
    const now = new Date().toISOString();
    setVideoGenFailed(db, s.id, stuckMsg, now);
    if (s.task_id) taskService.updateTaskError(db, s.task_id, stuckMsg);
    log.warn('Marked interrupted video generation as failed', { videoGenId: s.id });
  }

  const resumable = db
    .prepare(
      `SELECT id FROM video_generations
       WHERE status = 'processing' AND deleted_at IS NULL
         AND provider_task_id IS NOT NULL AND TRIM(provider_task_id) != ''`
    )
    .all();
  if (resumable.length) {
    log.info('Resuming video generation polls', { count: resumable.length });
  }
  for (const r of resumable) {
    scheduleLegacyAsync(log, 'video_generation_poll_resume', () => {
      resumePollForVideoGeneration(db, log, r.id).catch((e) => {
        log.error('resumePollForVideoGeneration unhandled', { videoGenId: r.id, error: e.message });
      });
    }, { video_generation_id: r.id });
  }
}

async function processVideoGeneration(db, log, videoGenId) {
  if (activeVideoPolls.has(videoGenId)) {
    log.info('Video generation already in progress, skip duplicate', { videoGenId });
    return;
  }
  activeVideoPolls.add(videoGenId);
  log.info('processVideoGeneration started', { videoGenId });
  const row = db.prepare('SELECT * FROM video_generations WHERE id = ? AND deleted_at IS NULL').get(Number(videoGenId));
  if (!row) {
    activeVideoPolls.delete(videoGenId);
    log.error('Video generation not found', { id: videoGenId });
    return;
  }
  const now = new Date().toISOString();
  try {
    db.prepare('UPDATE video_generations SET status = ?, updated_at = ? WHERE id = ?').run('processing', now, videoGenId);
    const loadConfig = require('../config').loadConfig;
    const cfg = loadConfig();
    const filesBaseUrl = (cfg.storage && cfg.storage.base_url) ? String(cfg.storage.base_url).replace(/\/$/, '') : '';
    const storageLocalPath = path.isAbsolute(cfg.storage?.local_path)
      ? cfg.storage.local_path
      : path.join(process.cwd(), cfg.storage?.local_path || './data/storage');
    const config = videoClient.getDefaultVideoConfig(db, row.model, row.provider);
    if (!config) {
      setVideoGenFailed(db, videoGenId, '未配置视频模型', now);
      if (row.task_id) taskService.updateTaskError(db, row.task_id, '未配置视频模型');
      return;
    }
    let reference_urls = null;
    if (row.reference_image_urls) {
      try {
        reference_urls = JSON.parse(row.reference_image_urls);
        if (!Array.isArray(reference_urls)) reference_urls = null;
      } catch (_) {}
    }
    // 优先使用分镜自身的镜头时长（storyboard.duration），其次用 video_generations.duration
    let effectiveDuration = row.duration || null;
    if (row.storyboard_id) {
      const sb = db.prepare('SELECT duration FROM storyboards WHERE id = ?').get(row.storyboard_id);
      if (sb && sb.duration > 0) {
        effectiveDuration = sb.duration;
        log.info('使用分镜镜头时长', { storyboard_id: row.storyboard_id, duration: effectiveDuration, video_gen_id: videoGenId });
      }
    }
    let aspectForVideo = row.aspect_ratio;
    if (aspectForVideo) {
      const n = videoClient.normalizeAspectRatioForApi(aspectForVideo);
      if (n) aspectForVideo = n;
    }
    if (!aspectForVideo && row.drama_id) {
      try {
        const dramaRow = db.prepare('SELECT metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(row.drama_id);
        if (dramaRow && dramaRow.metadata) {
          const meta =
            typeof dramaRow.metadata === 'string' ? JSON.parse(dramaRow.metadata) : dramaRow.metadata;
          if (meta && meta.aspect_ratio) {
            aspectForVideo = videoClient.normalizeAspectRatioForApi(meta.aspect_ratio);
          }
        }
      } catch (_) {}
    }
    const rowForAspect = { ...row, aspect_ratio: aspectForVideo || row.aspect_ratio };
    const hasOmniRefs = !!(reference_urls && reference_urls.length > 0);
    if (row.task_id && hasOmniRefs) {
      taskService.updateTaskStatus(
        db,
        row.task_id,
        'processing',
        5,
        `正在上传 ${reference_urls.length} 张参考图到图床…`
      );
    }
    const result = await videoClient.callVideoApi(db, log, {
      prompt: row.prompt,
      model: row.model,
      duration: effectiveDuration,
      aspect_ratio: rowForAspect.aspect_ratio,
      resolution: row.resolution,
      seed: row.seed,
      camera_fixed: row.camera_fixed,
      watermark: row.watermark,
      provider: row.provider,
      drama_id: row.drama_id,
      storyboard_id: row.storyboard_id || undefined,
      image_url: row.image_url,
      first_frame_url: row.first_frame_url,
      last_frame_url: row.last_frame_url,
      reference_urls,
      files_base_url: filesBaseUrl,
      storage_local_path: storageLocalPath,
      video_gen_id: videoGenId,
      idempotency_key: row.idempotency_key || undefined,
    });
    const now2 = new Date().toISOString();
    if (result.error) {
      setVideoGenFailed(db, videoGenId, result.error, now2);
      if (row.task_id) taskService.updateTaskError(db, row.task_id, result.error);
      log.error('Video generation failed', { id: videoGenId, error: result.error });
      return;
    }
    const directVideo = resolveRemoteVideoUrl(result.video_url, result.error);
    if (directVideo.ok) {
      await finalizeSuccessfulVideo(db, log, videoGenId, row, rowForAspect, directVideo.video_url, '', config);
      return;
    }
    if (result.video_url) {
      setVideoGenFailed(db, videoGenId, directVideo.error, now2);
      if (row.task_id) taskService.updateTaskError(db, row.task_id, directVideo.error);
      log.error('Video generation failed', { id: videoGenId, error: directVideo.error });
      return;
    }
    if (result.task_id) {
      db.prepare(
        'UPDATE video_generations SET status = ?, provider_task_id = ?, updated_at = ? WHERE id = ?'
      ).run('processing', result.task_id, now2, videoGenId);
      await pollProviderTaskAndFinalize(db, log, videoGenId, row, rowForAspect, result.task_id, config);
      return;
    }
    setVideoGenFailed(db, videoGenId, '未返回 task_id 或 video_url', now2);
    if (row.task_id) taskService.updateTaskError(db, row.task_id, '未返回 task_id 或 video_url');
  } catch (err) {
    const now2 = new Date().toISOString();
    setVideoGenFailed(db, videoGenId, err.message, now2);
    if (row && row.task_id) taskService.updateTaskError(db, row.task_id, err.message);
    log.error('Video generation error', { id: videoGenId, error: err.message });
  } finally {
    activeVideoPolls.delete(videoGenId);
  }
}

function deleteById(db, log, id) {
  const now = new Date().toISOString();
  const result = db.prepare('UPDATE video_generations SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(now, Number(id));
  return result.changes > 0;
}

module.exports = {
  list,
  getById,
  createVideoGeneration,
  createAndProcessVideo,
  persistCompletedVideo,
  targetVideoPixelsForAspect,
  videoConfigSupportsGridReference,
  deleteById,
  processVideoGeneration,
  resumeProcessingVideoGenerations,
};
