/**
 * 角色路由公开处理器。查询、文案与装配分别在 charactersQuery / charactersMessages / charactersAssembly。
 */
const response = require('../response');
const { sendMappedServiceFailure } = require('./serviceFailure');
const { toUserFacingProcessError } = require('../services/providerErrorSanitizer');
const characterLibraryService = require('../services/characterLibraryService');
const seedance2AssetGuards = require('../utils/seedance2AssetGuards');
const { scheduleLegacyAsync } = require('../services/legacyAsyncSchedulerService');
const {
  assertResourceWritable,
  assertResourcesWritable,
  isBoundaryError,
  runResourceWrite,
} = require('../services/dramaWriteGuard');
const M = require('./charactersMessages');
const query = require('./charactersQuery');
const assembly = require('./charactersAssembly');

function sendCaughtInternalError(res, error, fallback = M.OPERATION_FAILED) {
  response.internalError(res, toUserFacingProcessError(error, fallback));
}

function sendVoiceUploadFailure(res, error, uploadService) {
  if (uploadService.isUploadStorageError(error)) {
    response.error(res, 507, 'INSUFFICIENT_STORAGE', M.INSUFFICIENT_STORAGE);
    return true;
  }
  if (error?.code === 'MEDIA_VALIDATION_UNAVAILABLE') {
    response.error(res, 503, error.code, toUserFacingProcessError(error, M.MEDIA_VALIDATION_UNAVAILABLE));
    return true;
  }
  if (uploadService.isUploadValidationError(error)) {
    response.error(res, 400, error.code, toUserFacingProcessError(error, M.AUDIO_VALIDATION_FAILED));
    return true;
  }
  return false;
}

function sendCharacterServiceFailure(res, out) {
  return sendMappedServiceFailure(res, out);
}

function sendDramaBoundaryFailure(res, error) {
  if (!isBoundaryError(error)) return false;
  if (error.code === 'BAD_REQUEST' || error.code === 'CROSS_PROJECT_REFERENCE') {
    response.badRequest(res, toUserFacingProcessError(error, M.REQUEST_INVALID));
    return true;
  }
  if (error.code === 'DRAMA_RECYCLE_IN_PROGRESS') {
    response.error(res, 409, error.code, toUserFacingProcessError(error, M.DRAMA_RECYCLING));
    return true;
  }
  response.notFound(res, M.CHARACTER_UNAVAILABLE);
  return true;
}

function routes(db, cfg, log, uploadService) {
  return {
    getOne: (req, res) => {
      try {
        assertResourceWritable(db, 'characters', req.params.id);
        const row = query.getCharacterDetail(db, req.params.id);
        if (!row) return response.notFound(res, M.CHARACTER_NOT_FOUND);
        response.success(res, { character: row });
      } catch (err) {
        if (sendDramaBoundaryFailure(res, err)) return;
        log.error('characters getOne', { error: err.message });
        sendCaughtInternalError(res, err);
      }
    },
    update: (req, res) => {
      try {
        const out = runResourceWrite(db, 'characters', req.params.id, () => (
          characterLibraryService.updateCharacter(db, log, req.params.id, req.body || {})
        ));
        if (!out.ok) {
          return sendCharacterServiceFailure(res, out);
        }
        response.success(res, { message: M.SAVED });
      } catch (err) {
        if (sendDramaBoundaryFailure(res, err)) return;
        log.error('characters update', { error: err.message });
        sendCaughtInternalError(res, err);
      }
    },
    delete: (req, res) => {
      try {
        const out = runResourceWrite(db, 'characters', req.params.id, () => (
          characterLibraryService.deleteCharacter(db, log, req.params.id)
        ));
        if (!out.ok) {
          return sendCharacterServiceFailure(res, out);
        }
        response.success(res, { message: M.DELETED });
      } catch (err) {
        if (sendDramaBoundaryFailure(res, err)) return;
        log.error('characters delete', { error: err.message });
        sendCaughtInternalError(res, err);
      }
    },
    batchGenerateImages: (req, res) => {
      try {
        const body = req.body || {};
        const characterIds = body.character_ids;
        log.info('batch-generate-images request', { character_ids: characterIds, model: body.model, style: body.style });
        if (!Array.isArray(characterIds) || characterIds.length === 0) {
          return response.badRequest(res, M.SELECT_AT_LEAST_ONE);
        }
        if (characterIds.length > 10) {
          return response.badRequest(res, M.BATCH_LIMIT);
        }
        assertResourcesWritable(db, 'characters', characterIds);
        const out = characterLibraryService.batchGenerateCharacterImages(
          db,
          log,
          cfg,
          characterIds,
          body.model,
          body.style
        );
        if (!out.ok) {
          return sendCharacterServiceFailure(res, out);
        }
        response.success(res, {
          message: M.BATCH_SUBMITTED,
          count: out.count,
        });
      } catch (err) {
        if (sendDramaBoundaryFailure(res, err)) return;
        log.error('characters batch-generate-images', { error: err.message });
        sendCaughtInternalError(res, err);
      }
    },
    generateImage: async (req, res) => {
      try {
        assertResourceWritable(db, 'characters', req.params.id);
        const body = req.body || {};
        const out = await characterLibraryService.generateCharacterFourViewImage(
          db,
          log,
          cfg,
          req.params.id,
          body.model,
          body.style
        );
        if (!out.ok) {
          return sendCharacterServiceFailure(res, out);
        }
        response.success(res, {
          message: M.FOUR_VIEW_SUBMITTED,
          image_generation: out.image_generation,
        });
      } catch (err) {
        if (sendDramaBoundaryFailure(res, err)) return;
        log.error('characters generate-image', { error: err.message });
        sendCaughtInternalError(res, err);
      }
    },
    uploadImage: (req, res) => {
      if (!req.file || !req.file.buffer) {
        return response.badRequest(res, M.SELECT_FILE);
      }
      let persisted = null;
      let databaseUpdated = false;
      try {
        const charId = Number(req.params.id);
        const character = assertResourceWritable(db, 'characters', charId);
        persisted = assembly.persistCharacterImage(uploadService, cfg, log, db, character.drama_id, req.file);
        const { url, local_path } = persisted;
        const out = runResourceWrite(db, 'characters', charId, () => (
          characterLibraryService.uploadCharacterImage(db, log, charId, url)
        ));
        if (!out.ok) {
          uploadService.removeFile(persisted.absolute_path, log);
          persisted = null;
          return sendCharacterServiceFailure(res, out);
        }
        databaseUpdated = true;
        response.success(res, { message: M.UPLOADED, url, local_path, filename: req.file.originalname, size: req.file.size });
      } catch (err) {
        if (persisted && !databaseUpdated) uploadService.removeFile(persisted.absolute_path, log);
        if (sendDramaBoundaryFailure(res, err)) return;
        log.error('characters upload-image', { error: err.message });
        sendCaughtInternalError(res, err);
      }
    },
    putImage: (req, res) => {
      try {
        const body = req.body || {};
        const charIdNum = Number(req.params.id);
        let imageOut = null;
        runResourceWrite(db, 'characters', charIdNum, () => {
          const prevFull = query.getCharacterImageSnapshot(db, charIdNum);
          if (!prevFull) return null;
          const nextImg = body.image_url !== undefined ? body.image_url : prevFull.image_url;
          const nextLp = body.local_path !== undefined ? body.local_path : prevFull.local_path;
          seedance2AssetGuards.markStaleOnCharacterMainImageDrift(db, log, prevFull, {
            image_url: nextImg,
            local_path: nextLp,
          });
          // 只有明确传了 image_url 时才更新主图，避免只传 ref_image 时清掉主图。
          if (body.image_url !== undefined) {
            imageOut = characterLibraryService.uploadCharacterImage(db, log, req.params.id, body.image_url, {
              skipStaleMark: true,
            });
            if (imageOut && !imageOut.ok) return;
          }
          assembly.applyCharacterImageExtraUpdate(db, charIdNum, body);
        });
        if (imageOut && !imageOut.ok) {
          return sendCharacterServiceFailure(res, imageOut);
        }
        response.success(res, { message: M.SAVED });
      } catch (err) {
        if (sendDramaBoundaryFailure(res, err)) return;
        log.error('characters put image', { error: err.message });
        sendCaughtInternalError(res, err);
      }
    },
    imageFromLibrary: (req, res) => {
      try {
        const libraryId = (req.body || {}).library_id;
        if (libraryId == null) return response.badRequest(res, M.SELECT_LIBRARY_ITEM);
        const out = runResourceWrite(db, 'characters', req.params.id, () => (
          characterLibraryService.applyLibraryItemToCharacter(db, log, req.params.id, libraryId)
        ));
        if (!out.ok) {
          return sendCharacterServiceFailure(res, out);
        }
        response.success(res, { message: M.APPLIED });
      } catch (err) {
        if (sendDramaBoundaryFailure(res, err)) return;
        log.error('characters image-from-library', { error: err.message });
        sendCaughtInternalError(res, err);
      }
    },
    addToLibrary: (req, res) => {
      try {
        const category = (req.body || {}).category;
        const out = runResourceWrite(db, 'characters', req.params.id, () => (
          characterLibraryService.addCharacterToLibrary(db, log, req.params.id, category)
        ));
        if (!out.ok) {
          return sendCharacterServiceFailure(res, out);
        }
        response.success(res, { message: M.ADDED_TO_DRAMA_LIBRARY, item: out.item });
      } catch (err) {
        if (sendDramaBoundaryFailure(res, err)) return;
        log.error('characters add-to-library', { error: err.message });
        sendCaughtInternalError(res, err);
      }
    },
    addToMaterialLibrary: (req, res) => {
      try {
        const out = runResourceWrite(db, 'characters', req.params.id, () => (
          characterLibraryService.addCharacterToMaterialLibrary(db, log, req.params.id)
        ));
        if (!out.ok) {
          return sendCharacterServiceFailure(res, out);
        }
        response.success(res, { message: M.ADDED_TO_MATERIAL_LIBRARY, item: out.item });
      } catch (err) {
        if (sendDramaBoundaryFailure(res, err)) return;
        log.error('characters add-to-material-library', { error: err.message });
        sendCaughtInternalError(res, err);
      }
    },
    extractAnchors: (req, res) => {
      try {
        assertResourceWritable(db, 'characters', req.params.id);
        const charRow = query.getCharacterAnchorRow(db, req.params.id);
        if (!charRow) return response.notFound(res, M.CHARACTER_NOT_FOUND);
        if (!charRow.appearance) return response.badRequest(res, M.MISSING_APPEARANCE);
        const { enrichIdentityAnchors } = require('../services/characterGenerationService');
        scheduleLegacyAsync(log, 'character_anchor_extract_route', () => {
          try {
            assertResourceWritable(db, 'characters', charRow.id);
          } catch (error) {
            log.info('项目状态变化后已跳过角色锚点提取', {
              character_id: charRow.id,
              error_code: error.code,
            });
            return;
          }
          enrichIdentityAnchors(db, log, charRow.id, charRow.appearance).catch(() => {});
        }, { character_id: charRow.id });
        response.success(res, { message: M.ANCHOR_STARTED });
      } catch (err) {
        if (sendDramaBoundaryFailure(res, err)) return;
        log.error('characters extract-anchors', { error: err.message });
        sendCaughtInternalError(res, err);
      }
    },
    generateFourViewImage: async (req, res) => {
      try {
        assertResourceWritable(db, 'characters', req.params.id);
        const body = req.body || {};
        const modelName = body.model_name || body.model || undefined;
        const style = body.style || undefined;
        const out = await characterLibraryService.generateCharacterFourViewImage(db, log, cfg, req.params.id, modelName, style);
        if (!out.ok) {
          return sendCharacterServiceFailure(res, out);
        }
        response.success(res, { message: M.FOUR_VIEW_TASK_SUBMITTED, image_generation: out.image_generation });
      } catch (err) {
        if (sendDramaBoundaryFailure(res, err)) return;
        log.error('characters generate-four-view-image', { error: err.message });
        sendCaughtInternalError(res, err);
      }
    },
    generatePrompt: async (req, res) => {
      try {
        assertResourceWritable(db, 'characters', req.params.id);
        const body = req.body || {};
        const modelName = body.model_name || body.model || undefined;
        const style = body.style || undefined;
        const out = await characterLibraryService.generateCharacterPromptOnly(db, log, cfg, req.params.id, modelName, style);
        if (!out.ok) {
          return sendCharacterServiceFailure(res, out);
        }
        response.success(res, { message: M.PROMPT_GENERATED, polished_prompt: out.polished_prompt });
      } catch (err) {
        if (sendDramaBoundaryFailure(res, err)) return;
        log.error('characters generate-prompt', { error: err.message });
        sendCaughtInternalError(res, err);
      }
    },
    extractFromImage: async (req, res) => {
      try {
        assertResourceWritable(db, 'characters', req.params.id);
        const out = await characterLibraryService.extractAppearanceFromImage(db, log, cfg, req.params.id);
        if (!out.ok) {
          return sendCharacterServiceFailure(res, out);
        }
        response.success(res, { message: M.APPEARANCE_EXTRACTED, appearance: out.appearance });
      } catch (err) {
        if (sendDramaBoundaryFailure(res, err)) return;
        log.error('characters extract-from-image', { error: err.message });
        sendCaughtInternalError(res, err);
      }
    },
    /** 即梦素材库 asset 注册（Seedance 2.0 等视频引用 asset://） */
    sd2Certify: async (req, res) => {
      try {
        assertResourceWritable(db, 'characters', req.params.id);
        const out = await characterLibraryService.registerCharacterJimengMaterialAsset(db, log, cfg, req.params.id);
        if (!out.ok) {
          return sendCharacterServiceFailure(res, out);
        }
        response.success(res, { message: M.SD2_CERTIFIED, seedance2_asset: out.seedance2_asset });
      } catch (err) {
        if (sendDramaBoundaryFailure(res, err)) return;
        log.error('characters sd2-certify', { error: err.message });
        sendCaughtInternalError(res, err);
      }
    },
    sd2CertifyRefresh: async (req, res) => {
      try {
        assertResourceWritable(db, 'characters', req.params.id);
        const out = await characterLibraryService.refreshCharacterJimengMaterialAsset(db, log, cfg, req.params.id);
        if (!out.ok) {
          return sendCharacterServiceFailure(res, out);
        }
        response.success(res, { message: M.CERTIFY_REFRESHED, seedance2_asset: out.seedance2_asset });
      } catch (err) {
        if (sendDramaBoundaryFailure(res, err)) return;
        log.error('characters sd2-certify-refresh', { error: err.message });
        sendCaughtInternalError(res, err);
      }
    },
    /** Seedance 2.0 角色音色参考音频上传 */
    sd2VoiceUpload: async (req, res) => {
      let persisted = null;
      let databaseUpdated = false;
      try {
        const charId = Number(req.params.id);
        const character = assertResourceWritable(db, 'characters', charId);
        const charRow = query.getCharacterVoiceRow(db, charId);
        if (!charRow) return response.notFound(res, M.CHARACTER_NOT_FOUND);

        const source = req.file?.path || req.file?.buffer;
        if (!source) return response.badRequest(res, M.UPLOAD_AUDIO);

        const detected = req.file.detectedType
          || await uploadService.validateAllowedUpload(source, 'audio');
        const saved = assembly.persistCharacterVoiceFile(
          uploadService,
          cfg,
          log,
          req.file,
          charId,
          character.drama_id,
          source,
          detected
        );
        persisted = saved.persisted;

        const now = new Date().toISOString();
        const payload = assembly.assembleVoiceAssetPayload(persisted, now);

        const update = runResourceWrite(db, 'characters', charId, () => (
          assembly.persistCharacterVoiceAsset(db, charId, payload, now)
        ));
        if (update.changes !== 1) {
          const error = new Error(M.CHARACTER_NOT_FOUND);
          error.code = 'CHARACTER_NOT_FOUND';
          throw error;
        }
        databaseUpdated = true;

        assembly.removePreviousVoiceFile(
          uploadService,
          saved.storageRoot,
          query.parseVoiceAsset(charRow.seedance2_voice_asset),
          charRow,
          persisted.local_path,
          log
        );

        response.success(res, { message: M.VOICE_SAVED, seedance2_voice_asset: payload });
      } catch (err) {
        if (persisted && !databaseUpdated) uploadService.removeFile(persisted.absolute_path, log);
        if (sendDramaBoundaryFailure(res, err)) return;
        if (err?.code === 'CHARACTER_NOT_FOUND') return response.notFound(res, M.CHARACTER_NOT_FOUND);
        if (sendVoiceUploadFailure(res, err, uploadService)) return;
        log.error('characters sd2-voice-upload', { error: err.message });
        sendCaughtInternalError(res, err);
      } finally {
        if (req.file?.path) uploadService.removeFile(req.file.path, log);
      }
    },
    sd2VoiceRefresh: async (req, res) => {
      try {
        assertResourceWritable(db, 'characters', req.params.id);
        const row = query.getCharacterVoiceAssetRow(db, req.params.id);
        if (!row) return response.notFound(res, M.CHARACTER_NOT_FOUND);
        response.success(res, { message: M.STATUS_REFRESHED, seedance2_voice_asset: row.asset });
      } catch (err) {
        if (sendDramaBoundaryFailure(res, err)) return;
        log.error('characters sd2-voice-refresh', { error: err.message });
        sendCaughtInternalError(res, err);
      }
    },
  };
}

module.exports = routes;
