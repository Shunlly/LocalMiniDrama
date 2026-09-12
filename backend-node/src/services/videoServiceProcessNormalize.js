/**
 * 视频生成执行：下载与像素归一化。
 * 不改变轮询协议；即梦同步协议的短路仍在 videoClient.pollVideoTask。
 */

const defaultFs = require('fs');
const defaultPath = require('path');
const { spawnSync: defaultSpawnSync } = require('child_process');
const { randomUUID: defaultRandomUUID } = require('crypto');
const defaultUploadService = require('./uploadService');
const {
  getFfmpegPath: defaultGetFfmpegPath,
  hasLocalFfmpeg: defaultHasLocalFfmpeg,
} = require('../utils/ffmpegPath');
const { targetVideoPixelsForAspect: defaultTargetVideoPixelsForAspect } = require('./videoServiceAssembly');

function createVideoServiceProcessNormalize(deps = {}) {
  const fs = deps.fs || defaultFs;
  const path = deps.path || defaultPath;
  const spawnSync = deps.spawnSync || defaultSpawnSync;
  const randomUUID = deps.randomUUID || defaultRandomUUID;
  const uploadService = deps.uploadService || defaultUploadService;
  const getFfmpegPath = deps.getFfmpegPath || defaultGetFfmpegPath;
  const hasLocalFfmpeg = deps.hasLocalFfmpeg || defaultHasLocalFfmpeg;
  const targetVideoPixelsForAspect = deps.targetVideoPixelsForAspect || defaultTargetVideoPixelsForAspect;
  const isTaskCancellation = deps.isTaskCancellation;

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
    let filePath = null;
    try {
      const ext = (videoUrl.split('?')[0].match(/\.(mp4|webm|mov)$/i) || [])[1] || 'mp4';
      const name = `vg_${videoGenId}_${randomUUID().slice(0, 8)}.${ext}`;
      filePath = path.join(dir, name);
      const relativePath = `${relPrefix}/${name}`.replace(/\\/g, '/');
      const result = await uploadService.downloadBufferViaNodeHttp(videoUrl, 120000, 0, {
        maxBytes: 512 * 1024 * 1024,
        accept: 'video/*,application/octet-stream',
        trustedOrigins: networkOptions.trustedOrigins,
        signal: networkOptions.signal,
      });
      if (networkOptions.signal?.aborted) throw networkOptions.signal.reason;
      uploadService.assertUploadDiskCapacity(storagePath, result.buffer.length);
      uploadService.writeStorageBuffer(storagePath, relativePath, result.buffer);
      log.info('Video saved to local', { videoGenId, local_path: relativePath, projectSubdir: projectSubdir || '(root)' });
      return relativePath;
    } catch (e) {
      if (filePath) {
        try {
          fs.unlinkSync(filePath);
        } catch (cleanupError) {
          if (cleanupError.code !== 'ENOENT') {
            log.warn('Cleanup incomplete video failed', { videoGenId, path: filePath, error: cleanupError.message });
          }
        }
      }
      log.warn('Download video error', { videoGenId, error: e.message });
      throw e;
    }
  }

  function removeUncommittedVideo(storagePath, localPath, videoGenId, log) {
    if (!localPath) return;
    const absolutePath = path.resolve(storagePath, localPath);
    const storageRoot = path.resolve(storagePath);
    if (absolutePath !== storageRoot && !absolutePath.startsWith(storageRoot + path.sep)) return;
    try {
      fs.unlinkSync(absolutePath);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        log.warn('Cleanup uncommitted video failed', { videoGenId, local_path: localPath, error: error.message });
      }
    }
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
    if (r.status === 0 && (!fs.existsSync(tmpOut) || fs.statSync(tmpOut).size <= 0)) {
      log.warn('[视频] 画幅归一化输出为空（保留原文件）', { videoGenId });
      try { fs.unlinkSync(tmpOut); } catch (_) {}
      return false;
    }
    try {
      const publication = uploadService.publishStagedFile(tmpOut, absPath);
      publication.commit();
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

  return {
    resolveVideosDir,
    downloadVideoToLocal,
    removeUncommittedVideo,
    normalizeVideoFileToTargetPixels,
    maybeNormalizeVideoAfterDownload,
  };
}

module.exports = {
  createVideoServiceProcessNormalize,
};
