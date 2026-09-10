"use strict";

const crypto = require('crypto');
const uploadService = require('../uploadService');
const {
  operationCancelledError,
  throwIfAborted,
  isOperationCancelled,
  abortableDelay,
} = require('./runtime');

async function downloadImageToLocalAbortable(
  storagePath, imageUrl, category, log, prefix = '', projectSubdir = null, signal
) {
  if (!imageUrl || typeof imageUrl !== 'string') return null;
  let localPath = null;
  try {
    throwIfAborted(signal);
    let buffer;
    if (imageUrl.startsWith('data:')) {
      const match = imageUrl.match(/^data:image\/([a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i);
      if (!match) throw new uploadService.UnsafeMediaReferenceError('图片 data URL 无效');
      buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
      if (buffer.length === 0 || buffer.length > uploadService.DEFAULT_REMOTE_MEDIA_MAX_BYTES) {
        throw new uploadService.UnsafeMediaReferenceError('图片数据超过大小限制');
      }
    } else {
      let lastError;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const result = await uploadService.downloadBufferViaNodeHttp(imageUrl, 30000, 0, {
            maxBytes: uploadService.DEFAULT_REMOTE_MEDIA_MAX_BYTES,
            accept: 'image/*',
            signal,
          });
          buffer = result.buffer;
          break;
        } catch (error) {
          if (isOperationCancelled(error, signal)) throw operationCancelledError(signal?.reason || error);
          lastError = error;
          log.warn('downloadImageToLocal: 下载失败，准备重试', {
            category, attempt, error: error.message, url: imageUrl.slice(0, 100),
          });
          if (attempt < 3) await abortableDelay(1500 * attempt, signal);
        }
      }
      if (!buffer) throw lastError || new Error('图片下载失败');
    }

    throwIfAborted(signal);
    const detected = await uploadService.validateAllowedUpload(buffer, 'image');
    throwIfAborted(signal);
    uploadService.assertUploadDiskCapacity(storagePath, buffer.length);
    const extension = detected.extension.replace(/^\./, '');
    const filename = `${prefix}${prefix ? '_' : ''}${crypto.randomUUID().slice(0, 8)}.${extension}`;
    const relativeParts = [projectSubdir, category, filename]
      .filter((part) => part != null && String(part).trim() !== '')
      .map((part) => String(part).replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''));
    localPath = relativeParts.join('/');
    uploadService.writeStorageBuffer(storagePath, localPath, buffer);
    throwIfAborted(signal);
    log.info('图片已保存到本地', { category, local_path: localPath, projectSubdir: projectSubdir || '(root)' });
    return localPath;
  } catch (error) {
    removeDownloadedImage(storagePath, localPath, log);
    if (isOperationCancelled(error, signal)) throw operationCancelledError(signal?.reason || error);
    log.warn('下载图片到本地失败', { category, error: error.message });
    return null;
  }
}

function removeDownloadedImage(storagePath, localPath, log) {
  if (!localPath) return;
  try {
    const resolved = uploadService.resolveStorageReference(storagePath, localPath, { allowMissing: true });
    if (resolved?.absolutePath) uploadService.removeFile(resolved.absolutePath, log);
  } catch (error) {
    log?.warn?.('取消图片生成时清理临时文件失败', { local_path: localPath, error: error.message });
  }
}

module.exports = {
  downloadImageToLocalAbortable,
  removeDownloadedImage,
};
