const path = require('path');
const response = require('../response');
const characterLibraryService = require('../services/characterLibraryService');
const storageLayout = require('../services/storageLayout');
const seedance2AssetGuards = require('../utils/seedance2AssetGuards');
const { scheduleLegacyAsync } = require('../services/legacyAsyncSchedulerService');

const VOICE_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.ogg']);

function resolveStorageRoot(cfg) {
  const rawStorage = cfg?.storage?.local_path || './data/storage';
  return path.isAbsolute(rawStorage)
    ? rawStorage
    : path.join(process.cwd(), rawStorage);
}

function configuredDiskReserveBytes(cfg, uploadService) {
  const supplied = cfg?.storage?.upload_disk_reserve_bytes
    ?? process.env.LOCALMINIDRAMA_UPLOAD_DISK_RESERVE_BYTES;
  const value = Number(supplied);
  return Number.isFinite(value) && value >= 0
    ? value
    : uploadService.DEFAULT_UPLOAD_DISK_RESERVE_BYTES;
}

function parseVoiceAsset(value) {
  if (!value) return null;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function isOwnedVoicePath(relativePath, dramaId, characterId) {
  const directory = path.posix.dirname(relativePath);
  const filename = path.posix.basename(relativePath);
  const extension = path.posix.extname(filename).toLowerCase();
  if (!VOICE_EXTENSIONS.has(extension)) return false;

  const legacyDirectory = `drama_${dramaId}/characters/voice`;
  if (directory === legacyDirectory) {
    return new RegExp(`^char_${characterId}_voice_[0-9]{10,17}\\.(?:mp3|wav|m4a|ogg)$`, 'i')
      .test(filename);
  }

  const ownedDirectory = `${legacyDirectory}/char_${characterId}`;
  return directory === ownedDirectory
    && /^[0-9]{8}T[0-9]{6}_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:mp3|wav|m4a|ogg)$/i.test(filename);
}

function removePreviousVoiceFile(uploadService, storageRoot, previousAsset, charRow, replacementPath, log) {
  const reference = previousAsset?.local_path
    || (String(previousAsset?.url || '').startsWith('/static/') ? previousAsset.url : null);
  if (!reference) return false;
  try {
    const relativePath = uploadService.normalizeStorageRelativeReference(reference);
    if (
      relativePath === replacementPath
      || !isOwnedVoicePath(relativePath, charRow.drama_id, charRow.id)
    ) {
      log?.warn?.('Skipped deletion of unowned character voice file', { character_id: charRow.id });
      return false;
    }
    const resolved = uploadService.resolveStorageReference(storageRoot, relativePath, { allowMissing: true });
    if (!resolved) return false;
    uploadService.removeFile(resolved.absolutePath, log);
    return true;
  } catch (error) {
    log?.warn?.('Skipped unsafe character voice cleanup', {
      character_id: charRow.id,
      error_code: error?.code || 'VOICE_CLEANUP_REJECTED',
    });
    return false;
  }
}

function sendVoiceUploadFailure(res, error, uploadService) {
  if (uploadService.isUploadStorageError(error)) {
    response.error(res, 507, 'INSUFFICIENT_STORAGE', '存储空间不足，请清理磁盘后重试');
    return true;
  }
  if (error?.code === 'MEDIA_VALIDATION_UNAVAILABLE') {
    response.error(res, 503, error.code, error.message);
    return true;
  }
  if (uploadService.isUploadValidationError(error)) {
    response.error(res, 400, error.code, error.message);
    return true;
  }
  return false;
}

function routes(db, cfg, log, uploadService) {
  return {
    getOne: (req, res) => {
      try {
        const row = db.prepare(
          'SELECT id, drama_id, name, role, appearance, description, personality, voice_style, image_url, local_path, polished_prompt, four_view_image_url, identity_anchors, seedance2_asset, seedance2_voice_asset, negative_prompt, updated_at FROM characters WHERE id = ? AND deleted_at IS NULL'
        ).get(Number(req.params.id));
        if (!row) return response.notFound(res, '角色不存在');
        if (row.seedance2_asset) {
          try {
            row.seedance2_asset = JSON.parse(row.seedance2_asset);
          } catch (_) {
            row.seedance2_asset = null;
          }
        } else {
          row.seedance2_asset = null;
        }
        if (row.seedance2_voice_asset) {
          try {
            row.seedance2_voice_asset = JSON.parse(row.seedance2_voice_asset);
          } catch (_) {
            row.seedance2_voice_asset = null;
          }
        } else {
          row.seedance2_voice_asset = null;
        }
        response.success(res, { character: row });
      } catch (err) {
        log.error('characters getOne', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    update: (req, res) => {
      try {
        const out = characterLibraryService.updateCharacter(db, log, req.params.id, req.body || {});
        if (!out.ok) {
          if (out.error === 'character not found') return response.notFound(res, '角色不存在');
          return response.badRequest(res, out.error);
        }
        response.success(res, { message: '保存成功' });
      } catch (err) {
        log.error('characters update', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    delete: (req, res) => {
      try {
        const out = characterLibraryService.deleteCharacter(db, log, req.params.id);
        if (!out.ok) {
          if (out.error === 'character not found') return response.notFound(res, '角色不存在');
          return response.badRequest(res, out.error);
        }
        response.success(res, { message: '删除成功' });
      } catch (err) {
        log.error('characters delete', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    batchGenerateImages: (req, res) => {
      try {
        const body = req.body || {};
        const characterIds = body.character_ids;
        log.info('batch-generate-images request', { character_ids: characterIds, model: body.model, style: body.style });
        if (!Array.isArray(characterIds) || characterIds.length === 0) {
          return response.badRequest(res, 'character_ids 不能为空');
        }
        if (characterIds.length > 10) {
          return response.badRequest(res, '单次最多生成10个角色');
        }
        const out = characterLibraryService.batchGenerateCharacterImages(
          db,
          log,
          cfg,
          characterIds,
          body.model,
          body.style
        );
        if (!out.ok) {
          return response.badRequest(res, out.error);
        }
        response.success(res, {
          message: '批量生成任务已提交',
          count: out.count,
        });
      } catch (err) {
        log.error('characters batch-generate-images', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    generateImage: async (req, res) => {
      try {
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
          if (out.error === 'character not found') return response.notFound(res, '角色不存在');
          if (out.error === 'unauthorized') return response.notFound(res, '剧集不存在或无权限');
          return response.badRequest(res, out.error);
        }
        response.success(res, {
          message: '角色四视图生成任务已提交',
          image_generation: out.image_generation,
        });
      } catch (err) {
        log.error('characters generate-image', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    uploadImage: (req, res) => {
      if (!req.file || !req.file.buffer) {
        return response.badRequest(res, '请选择文件');
      }
      try {
        const rawStorage = cfg?.storage?.local_path || './data/storage';
        const storagePath = path.isAbsolute(rawStorage)
          ? rawStorage
          : path.join(process.cwd(), rawStorage);
        const baseUrl = cfg?.storage?.base_url || '';
        const charRow = db
          .prepare('SELECT drama_id FROM characters WHERE id = ? AND deleted_at IS NULL')
          .get(Number(req.params.id));
        const projectSubdir = storageLayout.getProjectStorageSubdir(db, charRow?.drama_id);
        const { url, local_path } = uploadService.uploadFile(
          storagePath,
          baseUrl,
          log,
          req.file.buffer,
          req.file.originalname || 'image.png',
          req.file.mimetype,
          'characters',
          projectSubdir
        );
        const out = characterLibraryService.uploadCharacterImage(db, log, req.params.id, url);
        if (!out.ok) {
          if (out.error === 'character not found') return response.notFound(res, '角色不存在');
          return response.badRequest(res, out.error);
        }
        response.success(res, { message: '上传成功', url, local_path, filename: req.file.originalname, size: req.file.size });
      } catch (err) {
        log.error('characters upload-image', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    putImage: (req, res) => {
      try {
        const body = req.body || {};
        const charIdNum = Number(req.params.id);
        const prevFull = db
          .prepare('SELECT id, local_path, image_url, seedance2_asset FROM characters WHERE id = ? AND deleted_at IS NULL')
          .get(charIdNum);
        if (!prevFull) return response.notFound(res, '角色不存在');
        const nextImg = body.image_url !== undefined ? body.image_url : prevFull.image_url;
        const nextLp = body.local_path !== undefined ? body.local_path : prevFull.local_path;
        seedance2AssetGuards.markStaleOnCharacterMainImageDrift(db, log, prevFull, {
          image_url: nextImg,
          local_path: nextLp,
        });
        // 只有明确传了 image_url 时才更新主图，避免只传 ref_image 时清掉主图
        if (body.image_url !== undefined) {
          const out = characterLibraryService.uploadCharacterImage(db, log, req.params.id, body.image_url, {
            skipStaleMark: true,
          });
          if (!out.ok) {
            if (out.error === 'character not found') return response.notFound(res, '角色不存在');
            return response.badRequest(res, out.error);
          }
        }
        const extraFields = [];
        const extraParams = [];
        if (body.local_path !== undefined) { extraFields.push('local_path = ?'); extraParams.push(body.local_path ?? null); }
        if (body.extra_images !== undefined) { extraFields.push('extra_images = ?'); extraParams.push(body.extra_images ?? null); }
        if (body.ref_image !== undefined) { extraFields.push('ref_image = ?'); extraParams.push(body.ref_image ?? null); }
        if (extraFields.length > 0) {
          db.prepare(`UPDATE characters SET ${extraFields.join(', ')}, updated_at = ? WHERE id = ?`).run(
            ...extraParams, new Date().toISOString(), Number(req.params.id)
          );
        }
        response.success(res, { message: '保存成功' });
      } catch (err) {
        log.error('characters put image', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    imageFromLibrary: (req, res) => {
      try {
        const libraryId = (req.body || {}).library_id;
        if (libraryId == null) return response.badRequest(res, '缺少 library_id');
        const out = characterLibraryService.applyLibraryItemToCharacter(db, log, req.params.id, libraryId);
        if (!out.ok) {
          if (out.error === 'library item not found') return response.notFound(res, '角色库项不存在');
          if (out.error === 'character not found') return response.notFound(res, '角色不存在');
          return response.badRequest(res, out.error);
        }
        response.success(res, { message: '应用成功' });
      } catch (err) {
        log.error('characters image-from-library', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    addToLibrary: (req, res) => {
      try {
        const category = (req.body || {}).category;
        const out = characterLibraryService.addCharacterToLibrary(db, log, req.params.id, category);
        if (!out.ok) {
          if (out.error === 'character not found') return response.notFound(res, '角色不存在');
          return response.badRequest(res, out.error);
        }
        response.success(res, { message: '已加入本剧角色库', item: out.item });
      } catch (err) {
        log.error('characters add-to-library', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    addToMaterialLibrary: (req, res) => {
      try {
        const out = characterLibraryService.addCharacterToMaterialLibrary(db, log, req.params.id);
        if (!out.ok) {
          if (out.error === 'character not found') return response.notFound(res, '角色不存在');
          return response.badRequest(res, out.error);
        }
        response.success(res, { message: '已加入全局素材库', item: out.item });
      } catch (err) {
        log.error('characters add-to-material-library', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    extractAnchors: (req, res) => {
      const charRow = db.prepare(
        'SELECT id, appearance, identity_anchors FROM characters WHERE id = ? AND deleted_at IS NULL'
      ).get(Number(req.params.id));
      if (!charRow) return response.notFound(res, '角色不存在');
      if (!charRow.appearance) return response.badRequest(res, '角色缺少外貌描述，无法提炼锚点');
      const { enrichIdentityAnchors } = require('../services/characterGenerationService');
      scheduleLegacyAsync(log, 'character_anchor_extract_route', () => {
        enrichIdentityAnchors(db, log, charRow.id, charRow.appearance).catch(() => {});
      }, { character_id: charRow.id });
      response.success(res, { message: '锚点提炼已启动，请稍后刷新查看' });
    },
    generateFourViewImage: async (req, res) => {
      try {
        const body = req.body || {};
        const modelName = body.model_name || body.model || undefined;
        const style = body.style || undefined;
        const out = await characterLibraryService.generateCharacterFourViewImage(db, log, cfg, req.params.id, modelName, style);
        if (!out.ok) {
          if (out.error === 'character not found') return response.notFound(res, '角色不存在');
          if (out.error === 'unauthorized') return response.notFound(res, '剧集不存在或无权限');
          return response.badRequest(res, out.error);
        }
        response.success(res, { message: '四视图生成任务已提交', image_generation: out.image_generation });
      } catch (err) {
        log.error('characters generate-four-view-image', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    generatePrompt: async (req, res) => {
      try {
        const body = req.body || {};
        const modelName = body.model_name || body.model || undefined;
        const style = body.style || undefined;
        const out = await characterLibraryService.generateCharacterPromptOnly(db, log, cfg, req.params.id, modelName, style);
        if (!out.ok) {
          if (out.error === 'character not found') return response.notFound(res, '角色不存在');
          return response.badRequest(res, out.error);
        }
        response.success(res, { message: '提示词已生成', polished_prompt: out.polished_prompt });
      } catch (err) {
        log.error('characters generate-prompt', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    extractFromImage: async (req, res) => {
      try {
        const out = await characterLibraryService.extractAppearanceFromImage(db, log, cfg, req.params.id);
        if (!out.ok) {
          if (out.error === 'character not found') return response.notFound(res, '角色不存在');
          return response.badRequest(res, out.error);
        }
        response.success(res, { message: '外貌描述已提取', appearance: out.appearance });
      } catch (err) {
        log.error('characters extract-from-image', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    /** 即梦素材库 asset 注册（Seedance 2.0 等视频引用 asset://） */
    sd2Certify: async (req, res) => {
      try {
        const out = await characterLibraryService.registerCharacterJimengMaterialAsset(db, log, cfg, req.params.id);
        if (!out.ok) {
          if (out.error === 'character not found') return response.notFound(res, '角色不存在');
          return response.badRequest(res, out.error);
        }
        response.success(res, { message: 'SD2 素材认证已更新', seedance2_asset: out.seedance2_asset });
      } catch (err) {
        log.error('characters sd2-certify', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    sd2CertifyRefresh: async (req, res) => {
      try {
        const out = await characterLibraryService.refreshCharacterJimengMaterialAsset(db, log, cfg, req.params.id);
        if (!out.ok) {
          if (out.error === 'character not found') return response.notFound(res, '角色不存在');
          return response.badRequest(res, out.error);
        }
        response.success(res, { message: '认证状态已刷新', seedance2_asset: out.seedance2_asset });
      } catch (err) {
        log.error('characters sd2-certify-refresh', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    /** Seedance 2.0 角色音色参考音频上传 */
    sd2VoiceUpload: async (req, res) => {
      let persisted = null;
      let databaseUpdated = false;
      try {
        const charId = Number(req.params.id);
        const charRow = db
          .prepare('SELECT id, drama_id, seedance2_voice_asset FROM characters WHERE id = ? AND deleted_at IS NULL')
          .get(charId);
        if (!charRow) return response.notFound(res, '角色不存在');

        const source = req.file?.path || req.file?.buffer;
        if (!source) return response.badRequest(res, '请上传音频文件');

        const detected = req.file.detectedType
          || await uploadService.validateAllowedUpload(source, 'audio');
        const storageRoot = resolveStorageRoot(cfg);
        const saveFile = req.file.path
          ? uploadService.uploadFileFromPath
          : uploadService.uploadFile;
        persisted = saveFile(
          storageRoot,
          '',
          log,
          source,
          req.file.originalname || 'voice-reference',
          req.file.mimetype,
          `char_${charId}`,
          `drama_${charRow.drama_id}/characters/voice`,
          'audio',
          detected,
          {
            reserveBytes: configuredDiskReserveBytes(cfg, uploadService),
            getAvailableBytes: uploadService.getAvailableDiskBytes,
          }
        );

        const now = new Date().toISOString();
        const payload = {
          status: 'active',
          url: persisted.url,
          local_path: persisted.local_path,
          certified_at: now,
          duration: persisted.duration,
          format: persisted.extension.replace('.', ''),
        };

        const update = db.prepare(
          'UPDATE characters SET seedance2_voice_asset = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
        ).run(
          JSON.stringify(payload),
          now,
          charId
        );
        if (update.changes !== 1) {
          const error = new Error('角色不存在');
          error.code = 'CHARACTER_NOT_FOUND';
          throw error;
        }
        databaseUpdated = true;

        removePreviousVoiceFile(
          uploadService,
          storageRoot,
          parseVoiceAsset(charRow.seedance2_voice_asset),
          charRow,
          persisted.local_path,
          log
        );

        response.success(res, { message: 'Seedance 2.0 音色参考已保存', seedance2_voice_asset: payload });
      } catch (err) {
        if (persisted && !databaseUpdated) uploadService.removeFile(persisted.absolute_path, log);
        if (err?.code === 'CHARACTER_NOT_FOUND') return response.notFound(res, '角色不存在');
        if (sendVoiceUploadFailure(res, err, uploadService)) return;
        log.error('characters sd2-voice-upload', { error: err.message });
        response.internalError(res, err.message);
      } finally {
        if (req.file?.path) uploadService.removeFile(req.file.path, log);
      }
    },
    sd2VoiceRefresh: async (req, res) => {
      try {
        const charId = Number(req.params.id);
        const row = db
          .prepare('SELECT seedance2_voice_asset FROM characters WHERE id = ? AND deleted_at IS NULL')
          .get(charId);
        if (!row) return response.notFound(res, '角色不存在');
        let asset = null;
        if (row.seedance2_voice_asset) {
          try {
            asset = JSON.parse(row.seedance2_voice_asset);
          } catch (_) {
            asset = null;
          }
        }
        response.success(res, { message: '状态已刷新', seedance2_voice_asset: asset });
      } catch (err) {
        log.error('characters sd2-voice-refresh', { error: err.message });
        response.internalError(res, err.message);
      }
    },
  };
}

module.exports = routes;
