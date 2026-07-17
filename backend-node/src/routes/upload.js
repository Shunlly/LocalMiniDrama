const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const multer = require('multer');
const response = require('../response');
const assetService = require('../services/assetService');
const uploadService = require('../services/uploadService');
const storageLayout = require('../services/storageLayout');

const maxSize = 16 * 1024 * 1024; // 16MB，单张图片上限
const MAX_SIZE_MB = 16;
const mediaMaxSize = 100 * 1024 * 1024;
const MEDIA_MAX_SIZE_MB = 100;
const TEMP_UPLOAD_DIR = path.join(os.tmpdir(), 'localminidrama-media-uploads');
const DEFAULT_MAX_CONCURRENT_IMAGE_UPLOADS = 4;
const DEFAULT_MAX_CONCURRENT_MEDIA_UPLOADS = 2;

const memoryStorage = multer.memoryStorage();
const upload = multer({
  storage: memoryStorage,
  limits: { fileSize: maxSize },
});

function createMediaDiskStorage(tempDir = TEMP_UPLOAD_DIR) {
  return multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdir(tempDir, { recursive: true }, (err) => cb(err, tempDir));
    },
    filename: (req, file, cb) => {
      cb(null, `${Date.now()}_${randomUUID()}.upload`);
    },
  });
}

const audioMaxSize = 10 * 1024 * 1024; // 10MB
const AUDIO_MAX_SIZE_MB = 10;

function cleanupTemporaryUpload(file, log = null) {
  if (file?.path) uploadService.removeFile(file.path, log);
}

function registerTemporaryCleanup(req, res, log = null) {
  if (!req.file?.path || typeof res?.once !== 'function') return;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    cleanupTemporaryUpload(req.file, log);
  };
  res.once('finish', cleanup);
  res.once('close', cleanup);
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function configuredDiskReserveBytes(cfg = null) {
  return nonNegativeNumber(
    cfg?.storage?.upload_disk_reserve_bytes ?? process.env.LOCALMINIDRAMA_UPLOAD_DISK_RESERVE_BYTES,
    uploadService.DEFAULT_UPLOAD_DISK_RESERVE_BYTES
  );
}

function createUploadAdmissionGate(options = {}) {
  const maxConcurrent = positiveInteger(options.maxConcurrent, DEFAULT_MAX_CONCURRENT_MEDIA_UPLOADS);
  const diskReserveBytes = nonNegativeNumber(
    options.diskReserveBytes,
    uploadService.DEFAULT_UPLOAD_DISK_RESERVE_BYTES
  );
  const getAvailableBytes = options.getAvailableBytes || uploadService.getAvailableDiskBytes;
  const tempDir = options.tempDir || TEMP_UPLOAD_DIR;
  let active = 0;
  let reservedBytes = 0;

  return {
    acquire(requiredBytes) {
      if (active >= maxConcurrent) {
        const err = new Error('上传任务繁忙，请稍后重试');
        err.code = 'UPLOAD_BUSY';
        throw err;
      }
      const reservation = Math.max(0, Number(requiredBytes) || 0);
      fs.mkdirSync(tempDir, { recursive: true });
      uploadService.assertUploadDiskCapacity(
        tempDir,
        reservedBytes + reservation,
        diskReserveBytes,
        getAvailableBytes
      );
      active += 1;
      reservedBytes += reservation;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active = Math.max(0, active - 1);
        reservedBytes = Math.max(0, reservedBytes - reservation);
      };
    },
  };
}

function requestReservationBytes(req, maxBytes) {
  const contentLength = Number(req?.headers?.['content-length']);
  if (!Number.isFinite(contentLength) || contentLength <= 0) return maxBytes;
  return Math.min(maxBytes, contentLength);
}

function sendUploadFailure(res, err, expectedMediaType = null, maxSizeMb = null) {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    const target = expectedMediaType === 'image' ? '图片' : '文件';
    response.error(res, 413, 'FILE_TOO_LARGE', `${target}大小不能超过 ${maxSizeMb}MB，请压缩后重试`);
    return true;
  }
  if (err?.code === 'UPLOAD_BUSY') {
    response.error(res, 429, err.code, err.message);
    return true;
  }
  if (uploadService.isUploadStorageError(err)) {
    response.error(res, 507, 'INSUFFICIENT_STORAGE', '存储空间不足，请清理磁盘后重试');
    return true;
  }
  if (err?.code === 'MEDIA_VALIDATION_UNAVAILABLE') {
    response.error(res, 503, err.code, err.message);
    return true;
  }
  if (uploadService.isUploadValidationError(err)) {
    response.error(res, 400, err.code, err.message);
    return true;
  }
  return false;
}

function validatedUploadMiddleware(parser, expectedMediaType, maxSizeMb, maxBytes, gate) {
  return (req, res, next) => {
    let release;
    try {
      release = gate.acquire(requestReservationBytes(req, maxBytes));
    } catch (admissionError) {
      if (typeof req.resume === 'function') req.resume();
      const sent = sendUploadFailure(res, admissionError, expectedMediaType, maxSizeMb);
      return sent || next(admissionError);
    }

    if (typeof res?.once === 'function') {
      res.once('finish', release);
      res.once('close', release);
    }
    parser(req, res, async (err) => {
      if (err) {
        release();
        cleanupTemporaryUpload(req.file);
        const sent = sendUploadFailure(res, err, expectedMediaType, maxSizeMb);
        return sent || next(err);
      }
      if (!req.file) {
        release();
        return next();
      }

      try {
        const source = req.file.path || req.file.buffer;
        const detected = await uploadService.validateAllowedUpload(source, expectedMediaType);
        req.file.mimetype = detected.mimeType;
        req.file.detectedType = detected;
        registerTemporaryCleanup(req, res);
        return next();
      } catch (validationError) {
        release();
        cleanupTemporaryUpload(req.file);
        const sent = sendUploadFailure(res, validationError, expectedMediaType, maxSizeMb);
        return sent || next(validationError);
      }
    });
  };
}

const imageUploadGate = createUploadAdmissionGate({
  maxConcurrent: DEFAULT_MAX_CONCURRENT_IMAGE_UPLOADS,
});
const multerSingle = validatedUploadMiddleware(
  upload.single('file'),
  'image',
  MAX_SIZE_MB,
  maxSize,
  imageUploadGate
);

function createMediaUploadMiddleware(options = {}) {
  const maxBytes = options.maxBytes ?? mediaMaxSize;
  const maxSizeMb = options.maxSizeMb ?? MEDIA_MAX_SIZE_MB;
  const tempDir = options.tempDir || TEMP_UPLOAD_DIR;
  const gate = createUploadAdmissionGate({
    maxConcurrent: options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT_MEDIA_UPLOADS,
    diskReserveBytes: options.diskReserveBytes,
    getAvailableBytes: options.getAvailableBytes,
    tempDir,
  });
  const parser = multer({
    storage: createMediaDiskStorage(tempDir),
    limits: { fileSize: maxBytes },
  }).single('file');
  return validatedUploadMiddleware(parser, null, maxSizeMb, maxBytes, gate);
}

const multerMediaSingle = createMediaUploadMiddleware();

function createAudioUploadMiddleware(options = {}) {
  const maxBytes = options.maxBytes ?? audioMaxSize;
  const maxSizeMb = options.maxSizeMb ?? AUDIO_MAX_SIZE_MB;
  const tempDir = options.tempDir || TEMP_UPLOAD_DIR;
  const gate = createUploadAdmissionGate({
    maxConcurrent: options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT_MEDIA_UPLOADS,
    diskReserveBytes: options.diskReserveBytes,
    getAvailableBytes: options.getAvailableBytes,
    tempDir,
  });
  const parser = multer({
    storage: createMediaDiskStorage(tempDir),
    limits: { fileSize: maxBytes, files: 1 },
  }).single('file');
  return validatedUploadMiddleware(parser, 'audio', maxSizeMb, maxBytes, gate);
}

const multerAudioSingle = createAudioUploadMiddleware();

function mediaTypeFromMime(mimeType) {
  return String(mimeType || '').toLowerCase().startsWith('video/') ? 'video' : 'image';
}

async function saveRequestFile(req, cfg, log, db, fallbackName, expectedMediaType = null) {
  const rawStorage = cfg?.storage?.local_path || './data/storage';
  const storagePath = path.isAbsolute(rawStorage)
    ? rawStorage
    : path.join(process.cwd(), rawStorage);
  const baseUrl = cfg?.storage?.base_url || '';
  let projectSubdir = null;
  if (db) {
    const raw = req.body?.drama_id;
    const did = raw !== undefined && raw !== null && String(raw).trim() !== ''
      ? Number(raw)
      : NaN;
    if (Number.isFinite(did) && did > 0) {
      projectSubdir = storageLayout.getProjectStorageSubdir(db, did);
    }
  }
  const saveFile = req.file.path
    ? uploadService.uploadFileFromPath
    : uploadService.uploadFile;
  const source = req.file.path || req.file.buffer;
  const detected = req.file.detectedType
    || await uploadService.validateAllowedUpload(source, expectedMediaType);
  return saveFile(
    storagePath,
    baseUrl,
    log,
    source,
    req.file.originalname || fallbackName,
    req.file.mimetype,
    'uploads',
    projectSubdir,
    expectedMediaType,
    detected,
    { reserveBytes: configuredDiskReserveBytes(cfg) }
  );
}

function routes(cfg, log, db) {
  return {
    multerSingle,
    uploadImage: async (req, res) => {
      if (!req.file || (!req.file.buffer && !req.file.path)) {
        return response.badRequest(res, '请选择文件');
      }
      try {
        const result = await saveRequestFile(req, cfg, log, db, 'image.png', 'image');
        response.success(res, {
          url: result.url,
          path: result.local_path,
          local_path: result.local_path,
          filename: req.file.originalname,
          size: req.file.size,
        });
      } catch (err) {
        const sent = sendUploadFailure(res, err, 'image', MAX_SIZE_MB);
        if (sent) return sent;
        log.error('upload image', { error: err.message });
        response.internalError(res, err.message || '上传失败');
      }
    },
    uploadAsset: async (req, res) => {
      let result = null;
      let assetCreated = false;
      try {
        if (!req.file || (!req.file.buffer && !req.file.path)) {
          return response.badRequest(res, '请选择文件');
        }
        if (!db) {
          return response.internalError(res, '素材库数据库未初始化');
        }
        result = await saveRequestFile(req, cfg, log, db, 'asset.bin');
        const item = assetService.create(db, log, {
          drama_id: req.body?.drama_id || null,
          name: req.file.originalname || '未命名素材',
          type: result.media_type,
          url: result.url,
          local_path: result.local_path,
          file_size: req.file.size,
          mime_type: result.mime_type,
        });
        assetCreated = true;
        response.created(res, item);
      } catch (err) {
        const sent = sendUploadFailure(res, err, null, MEDIA_MAX_SIZE_MB);
        if (sent) return sent;
        log.error('upload asset', { error: err.message });
        response.internalError(res, err.message || '素材上传失败');
      } finally {
        cleanupTemporaryUpload(req.file, log);
        if (result && !assetCreated) uploadService.removeFile(result.absolute_path, log);
      }
    },
  };
}

module.exports = {
  routes,
  upload,
  createAudioUploadMiddleware,
  createMediaUploadMiddleware,
  multerSingle,
  multerMediaSingle,
  multerAudioSingle,
  MAX_IMAGE_SIZE_MB: MAX_SIZE_MB,
  AUDIO_MAX_SIZE_MB,
  MEDIA_MAX_SIZE_MB,
  DEFAULT_MAX_CONCURRENT_MEDIA_UPLOADS,
  TEMP_UPLOAD_DIR,
  mediaTypeFromMime,
};
