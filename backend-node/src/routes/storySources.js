const path = require('node:path');
const response = require('../response');
const sourceIntakeService = require('../services/sourceIntakeService');
const sourceMediaExtractionService = require('../services/sourceMediaExtractionService');
const uploadService = require('../services/uploadService');
const webSourceImportService = require('../services/webSourceImportService');
const dramaWriteGuard = require('../services/dramaWriteGuard');

const MAX_UPLOAD_METADATA_BYTES = 64 * 1024;
const SENSITIVE_UPLOAD_METADATA_KEY = /api[_-]?key|access[_-]?key|secret|password|token|raw[_-]?text|full[_-]?text|extracted[_-]?text|ocr[_-]?text|transcript/i;

function badRequestOrInternal(res, err) {
  if (err && err.code === 'BAD_REQUEST') return response.badRequest(res, err.message);
  if (dramaWriteGuard.isBoundaryError(err)) {
    return response.error(res, err.statusCode || 409, err.code, err.message, err.details);
  }
  if (uploadService.isUploadStorageError(err)) {
    return response.error(
      res,
      507,
      err.code || 'INSUFFICIENT_STORAGE',
      'Insufficient storage capacity for the source original.'
    );
  }
  return response.internalError(res, err.message || 'Story source operation failed');
}

function resolveSourceStoragePath(routeOptions) {
  if (routeOptions.storagePath) return path.resolve(routeOptions.storagePath);
  const testRoot = process.env.NODE_TEST_CONTEXT
    ? String(process.env.LOCALMINIDRAMA_TEST_STORY_SOURCE_ROOT || '').trim()
    : '';
  return testRoot
    ? path.resolve(testRoot)
    : path.join(process.cwd(), 'data', 'storage');
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

function sanitizeMetadataNode(value, depth = 0) {
  if (depth > 6 || value == null) return value == null ? value : null;
  if (typeof value === 'string') return value.slice(0, 2000);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeMetadataNode(item, depth + 1));
  if (typeof value !== 'object') return null;
  const safe = {};
  for (const [key, child] of Object.entries(value).slice(0, 100)) {
    if (SENSITIVE_UPLOAD_METADATA_KEY.test(key)) continue;
    safe[key] = sanitizeMetadataNode(child, depth + 1);
  }
  return safe;
}

function sanitizeUploadMetadata(value) {
  const metadata = sanitizeMetadataNode(parseMetadata(value));
  if (Buffer.byteLength(JSON.stringify(metadata), 'utf8') > MAX_UPLOAD_METADATA_BYTES) {
    const err = new Error('Source upload metadata is limited to 64KB.');
    err.code = 'BAD_REQUEST';
    throw err;
  }
  return metadata;
}

module.exports = function storySourceRoutes(db, log, routeOptions = {}) {
  const storagePath = resolveSourceStoragePath(routeOptions);
  const originalStorage = {
    storagePath,
    quotaBytes: routeOptions.originalQuotaBytes,
    reserveBytes: routeOptions.originalReserveBytes,
    getAvailableBytes: routeOptions.getAvailableBytes,
  };
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

    async uploadForDrama(req, res) {
      try {
        const extracted = await sourceMediaExtractionService.extractUploadedSource(
          db,
          req.file,
          routeOptions.extractionOptions || {}
        );
        const file = extracted.file;
        const body = req.body || {};
        const result = sourceIntakeService.createStorySource(db, log, {
          ...body,
          drama_id: req.params.id,
          text: extracted.text,
          source_type: body.source_type || inferSourceTypeFromFilename(file.filename),
          title: body.title || String(file.filename || '').replace(/\.[^.]+$/, ''),
          metadata: {
            ...sanitizeUploadMetadata(body.metadata),
            uploaded_filename: file.filename,
            uploaded_mimetype: file.declared_mime || file.mime,
            uploaded_size: file.size,
            imported_from: 'source_intake_upload',
            ...extracted.metadata,
          },
          original_file: {
            buffer: req.file.buffer,
            extension: file.extension,
            format: file.format,
            mime: file.mime,
          },
          original_storage: originalStorage,
        });
        response.created(res, result);
      } catch (err) {
        log.error('story sources upload', { error: err.message, drama_id: req.params.id });
        badRequestOrInternal(res, err);
      }
    },

    async importUrlForDrama(req, res) {
      try {
        const body = req.body || {};
        const fetched = await webSourceImportService.fetchWebSource(body.source_url || body.url);
        const metadata = {
          ...parseMetadata(body.metadata),
          imported_from: 'source_intake_url',
          source_url: fetched.url,
          fetched_content_type: fetched.content_type,
          fetched_text_length: fetched.text_length,
          fetched_text_truncated: fetched.truncated,
        };
        const result = sourceIntakeService.createStorySource(db, log, {
          ...body,
          drama_id: req.params.id,
          text: fetched.text,
          title: body.title || fetched.title || fetched.url,
          metadata,
        });
        response.created(res, result);
      } catch (err) {
        log.error('story sources import url', { error: err.message, drama_id: req.params.id });
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

    downloadOriginal(req, res) {
      try {
        const source = sourceIntakeService.getSourceById(db, req.params.source_id);
        if (!source) return response.notFound(res, 'Story source not found');
        const original = uploadService.readStorySourceOriginal(storagePath, source);
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('Content-Disposition', `attachment; filename="${original.serverFilename}"`);
        res.setHeader('Content-Length', String(original.size));
        res.setHeader('Content-Type', original.mime);
        res.setHeader('X-Content-SHA256', original.sha256);
        return res.status(200).send(original.buffer);
      } catch (err) {
        if (err?.code === 'SOURCE_ORIGINAL_NOT_FOUND') {
          return response.notFound(res, err.message);
        }
        log.error('story source original download', { error: err.message, source_id: req.params.source_id });
        return badRequestOrInternal(res, err);
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
