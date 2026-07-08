const response = require('../response');
const sourceIntakeService = require('../services/sourceIntakeService');
const path = require('path');

const MAX_SOURCE_UPLOAD_BYTES = 20 * 1024 * 1024;
const TEXT_FILE_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.tsv', '.srt', '.vtt', '.ass', '.json']);
const DEFERRED_MULTIMEDIA_EXTENSIONS = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.mp3',
  '.wav',
  '.m4a',
  '.aac',
  '.mp4',
  '.mov',
  '.mkv',
  '.avi',
]);

function badRequestOrInternal(res, err) {
  if (err && err.code === 'BAD_REQUEST') return response.badRequest(res, err.message);
  return response.internalError(res, err.message || 'Story source operation failed');
}

function inferSourceTypeFromFilename(filename) {
  const name = String(filename || '').toLowerCase();
  if (/\.(srt|vtt|ass)$/.test(name) || /transcript|caption|subtitle/.test(name)) return 'transcript';
  if (/storyboard|shot/.test(name)) return 'storyboard';
  if (/script|screenplay/.test(name)) return 'script';
  if (/comic|panel/.test(name)) return 'comic';
  if (/outline|synopsis/.test(name)) return 'outline';
  if (/\.(csv|tsv)$/.test(name)) return 'storyboard';
  if (/\.(txt|md)$/.test(name) || /novel|chapter/.test(name)) return 'novel';
  return '';
}

function parseMetadata(value) {
  return sourceIntakeService.normalizeMetadata(value);
}

function isDeferredMultimedia(file, ext) {
  const mimetype = String(file?.mimetype || '').toLowerCase();
  return DEFERRED_MULTIMEDIA_EXTENSIONS.has(ext) ||
    mimetype.startsWith('image/') ||
    mimetype.startsWith('audio/') ||
    mimetype.startsWith('video/') ||
    mimetype === 'application/pdf';
}

function decodeUploadedText(file) {
  if (!file || !file.buffer) {
    const err = new Error('source file is required');
    err.code = 'BAD_REQUEST';
    throw err;
  }
  const originalName = file.originalname || '';
  const ext = path.extname(originalName).toLowerCase();
  if (Number(file.size || file.buffer.length || 0) > MAX_SOURCE_UPLOAD_BYTES) {
    const err = new Error('Source Intake text uploads are limited to 20MB. Split the source or use the deferred multimedia/OCR pipeline later.');
    err.code = 'BAD_REQUEST';
    throw err;
  }
  if (ext && !TEXT_FILE_EXTENSIONS.has(ext)) {
    const err = new Error('only text-like source files are supported for Source Intake upload');
    if (isDeferredMultimedia(file, ext)) {
      err.message = 'Real PDF, image, audio, and video OCR/transcription intake is deferred. Upload a text, markdown, subtitle, CSV/TSV, or JSON source for now.';
    }
    err.code = 'BAD_REQUEST';
    throw err;
  }
  if (!ext && isDeferredMultimedia(file, ext)) {
    const err = new Error('Real multimedia OCR/transcription intake is deferred. Upload a text-like source file for now.');
    err.code = 'BAD_REQUEST';
    throw err;
  }
  return file.buffer.toString('utf8').replace(/^\uFEFF/, '');
}

module.exports = function storySourceRoutes(db, log) {
  return {
    listForDrama(req, res) {
      try {
        const sources = sourceIntakeService.listSourcesByDrama(db, req.params.id);
        response.success(res, sources);
      } catch (err) {
        log.error('story sources list', { error: err.message, drama_id: req.params.id });
        badRequestOrInternal(res, err);
      }
    },

    createForDrama(req, res) {
      try {
        const result = sourceIntakeService.createStorySource(db, log, {
          ...(req.body || {}),
          drama_id: req.params.id,
        });
        response.created(res, result);
      } catch (err) {
        log.error('story sources create', { error: err.message, drama_id: req.params.id });
        badRequestOrInternal(res, err);
      }
    },

    uploadForDrama(req, res) {
      try {
        const text = decodeUploadedText(req.file);
        const file = req.file;
        const body = req.body || {};
        const result = sourceIntakeService.createStorySource(db, log, {
          ...body,
          drama_id: req.params.id,
          text,
          source_type: body.source_type || inferSourceTypeFromFilename(file.originalname),
          title: body.title || String(file.originalname || '').replace(/\.[^.]+$/, ''),
          metadata: {
            ...parseMetadata(body.metadata),
            uploaded_filename: file.originalname || '',
            uploaded_mimetype: file.mimetype || '',
            uploaded_size: file.size || 0,
            imported_from: 'source_intake_upload',
          },
        });
        response.created(res, result);
      } catch (err) {
        log.error('story sources upload', { error: err.message, drama_id: req.params.id });
        badRequestOrInternal(res, err);
      }
    },

    get(req, res) {
      try {
        const detail = sourceIntakeService.getSourceDetail(db, req.params.source_id);
        if (!detail) return response.notFound(res, 'Story source not found');
        response.success(res, detail);
      } catch (err) {
        log.error('story sources get', { error: err.message, source_id: req.params.source_id });
        badRequestOrInternal(res, err);
      }
    },

    createPlan(req, res) {
      try {
        const plan = sourceIntakeService.createAdaptationPlan(db, log, req.params.source_id, req.body || {});
        if (!plan) return response.notFound(res, 'Story source not found');
        response.created(res, plan);
      } catch (err) {
        log.error('story sources create plan', { error: err.message, source_id: req.params.source_id });
        badRequestOrInternal(res, err);
      }
    },

    applyPlan(req, res) {
      try {
        const result = sourceIntakeService.applyAdaptationPlanToEpisodes(db, log, req.params.plan_id, req.body || {});
        if (!result) return response.notFound(res, 'Adaptation plan not found');
        response.success(res, result);
      } catch (err) {
        log.error('adaptation plan apply', { error: err.message, plan_id: req.params.plan_id });
        badRequestOrInternal(res, err);
      }
    },
  };
};
