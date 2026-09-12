'use strict';

const fs = require('fs');
const AdmZip = require('adm-zip');
const uploadService = require('./uploadService');
const { exportError } = require('./dramaExportErrors');

const ZIP_ENTRY_MEMORY_OVERHEAD = 1024;

function zipBufferUpperBound(totalBytes, fileCount) {
  const deflateOverhead = Math.ceil(totalBytes / 16383) * 5 + 6;
  return totalBytes + deflateOverhead + (fileCount * ZIP_ENTRY_MEMORY_OVERHEAD);
}

class ExportArchiveBuilder {
  constructor(limits) {
    this.limits = limits;
    this.zip = new AdmZip();
    this.fileCount = 0;
    this.totalUncompressedBytes = 0;
    this.archivePaths = new Set();
  }

  assertCanAdd(archivePath, size) {
    if (!Number.isSafeInteger(size) || size < 0) {
      throw exportError('EXPORT_FILE_SIZE_LIMIT', '项目导出遇到无效的文件大小，请检查素材后重试。');
    }
    if (this.archivePaths.has(archivePath)) {
      throw exportError(
        'EXPORT_DUPLICATE_PATH',
        '项目导出生成了重复的压缩包路径，请重试。',
        { archive_path: archivePath },
        500
      );
    }
    const nextFileCount = this.fileCount + 1;
    if (nextFileCount > this.limits.maxFiles) {
      throw exportError(
        'EXPORT_FILE_COUNT_LIMIT',
        '项目导出文件过多，请精简素材后重试。',
        { limit: this.limits.maxFiles, actual: nextFileCount }
      );
    }
    if (size > this.limits.maxFileBytes) {
      throw exportError(
        'EXPORT_FILE_SIZE_LIMIT',
        '某个导出文件超过大小上限，请精简素材后重试。',
        { limit_bytes: this.limits.maxFileBytes, actual_bytes: size, archive_path: archivePath }
      );
    }
    const nextTotal = this.totalUncompressedBytes + size;
    if (!Number.isSafeInteger(nextTotal) || nextTotal > this.limits.maxTotalUncompressedBytes) {
      throw exportError(
        'EXPORT_TOTAL_SIZE_LIMIT',
        '项目导出超过未压缩大小上限，请精简素材后重试。',
        { limit_bytes: this.limits.maxTotalUncompressedBytes, actual_bytes: nextTotal }
      );
    }
    const estimatedMemory = nextTotal + zipBufferUpperBound(nextTotal, nextFileCount);
    if (!Number.isSafeInteger(estimatedMemory) || estimatedMemory > this.limits.maxMemoryBytes) {
      throw exportError(
        'EXPORT_MEMORY_LIMIT',
        '项目导出超过内存预算，请精简素材后重试。',
        { limit_bytes: this.limits.maxMemoryBytes, estimated_bytes: estimatedMemory }
      );
    }
  }

  addBuffer(archivePath, buffer) {
    if (!Buffer.isBuffer(buffer)) {
      throw exportError('EXPORT_FILE_READ_FAILED', '项目导出无法读取文件，请检查素材后重试。', null, 500);
    }
    this.assertCanAdd(archivePath, buffer.length);
    this.zip.addFile(archivePath, buffer);
    this.archivePaths.add(archivePath);
    this.fileCount += 1;
    this.totalUncompressedBytes += buffer.length;
  }

  readStorageFile(storagePath, localPath, archivePath) {
    if (!localPath) return false;
    const reference = String(localPath).trim();
    if (/^(?:mock|placeholder):\/\//i.test(reference)) return false;
    let opened;
    try {
      const resolved = uploadService.resolveStorageReference(storagePath, reference, { allowMissing: true });
      if (!resolved) return false;
      opened = uploadService.openStorageFile(storagePath, resolved.relativePath);
    } catch (error) {
      if (error?.code === 'UNSAFE_MEDIA_REFERENCE' && error?.reason === 'NOT_FOUND') return false;
      const reason = /^[A-Z_]{2,64}$/.test(String(error?.reason || ''))
        ? String(error.reason)
        : 'INVALID_REFERENCE';
      throw exportError(
        'UNSAFE_EXPORT_STORAGE',
        '项目导出拒绝了不安全的存储路径。',
        { archive_path: archivePath, reason },
        400,
        error
      );
    }

    try {
      this.assertCanAdd(archivePath, opened.stat.size);
      const buffer = Buffer.allocUnsafe(opened.stat.size);
      let offset = 0;
      while (offset < buffer.length) {
        const bytes = fs.readSync(opened.fd, buffer, offset, buffer.length - offset, offset);
        if (bytes <= 0) {
          throw exportError('EXPORT_FILE_CHANGED', '项目导出读取时源文件发生变化，请重试。', null, 409);
        }
        offset += bytes;
      }
      const after = fs.fstatSync(opened.fd);
      if (after.size !== opened.stat.size || after.mtimeMs !== opened.stat.mtimeMs) {
        throw exportError('EXPORT_FILE_CHANGED', '项目导出读取时源文件发生变化，请重试。', null, 409);
      }
      return buffer;
    } finally {
      fs.closeSync(opened.fd);
    }
  }

  addStorageFile(storagePath, localPath, archivePath) {
    const buffer = this.readStorageFile(storagePath, localPath, archivePath);
    if (!buffer) return false;
    this.addBuffer(archivePath, buffer);
    return true;
  }

  toBuffer() {
    const buffer = this.zip.toBuffer();
    const actualPeakBytes = this.totalUncompressedBytes + buffer.length;
    if (actualPeakBytes > this.limits.maxMemoryBytes) {
      throw exportError(
        'EXPORT_MEMORY_LIMIT',
        '项目导出超过内存预算，请精简素材后重试。',
        { limit_bytes: this.limits.maxMemoryBytes, actual_bytes: actualPeakBytes }
      );
    }
    return buffer;
  }
}

module.exports = {
  ExportArchiveBuilder,
  zipBufferUpperBound,
};
