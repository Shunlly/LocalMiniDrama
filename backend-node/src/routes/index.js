const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const response = require('../response');
const dramaRoutes = require('./drama');
const taskRoutes = require('./task');
const settingsRoutes = require('./settings');
const aiConfigRoutes = require('./aiConfig');
const propRoutes = require('./prop');
const stubRoutes = require('./stub');
const characterLibraryRoutes = require('./characterLibrary');
const sceneLibraryRoutes = require('./sceneLibrary');
const propLibraryRoutes = require('./propLibrary');
const characterRoutes = require('./characters');
const uploadModule = require('./upload');
const sceneRoutes = require('./scenes');
const storyboardRoutes = require('./storyboards');
const tailFrameLinkRoutes = require('./storyboards_tail_link');
const imageRoutes = require('./images');
const videoRoutes = require('./videos');
const videoMergeRoutes = require('./videoMerges');
const assetRoutes = require('./assets');
const audioRoutes = require('./audio');
const promptOverridesRoutes = require('./promptOverrides');
const sceneModelMapRoutes = require('./sceneModelMap');
const workflowRoutes = require('./workflows');
const storySourceRoutes = require('./storySources');
const qaReportRoutes = require('./qaReports');
const timelineRoutes = require('./timelines');
const aiConfigService = require('../services/aiConfigService');
const { validateHttpRequestTarget } = require('../services/secureHttpFetch');

function createProviderNetworkBoundary(db, options = {}) {
  return async (req, res, next) => {
    const body = req.body || {};
    const rawId = body.id ?? body.config_id;
    let saved = null;
    if (rawId != null && /^\d+$/.test(String(rawId))) {
      saved = db.prepare(
        `SELECT base_url, is_active, provider, service_type, settings
         FROM ai_service_configs WHERE id = ? AND deleted_at IS NULL`
      ).get(Number(rawId));
    }
    const requestedBaseUrl = String(body.base_url || saved?.base_url || '').trim();
    if (!requestedBaseUrl) return next();

    let exactEnabledOrigin = false;
    if (saved?.is_active && saved.base_url) {
      try {
        exactEnabledOrigin = new URL(requestedBaseUrl).origin === new URL(saved.base_url).origin;
      } catch (_) {}
    }
    if (!exactEnabledOrigin) {
      return response.error(
        res,
        400,
        'UNSAVED_PROVIDER_URL',
        'Save and enable the provider configuration before making provider network requests.'
      );
    }

    try {
      const providerNetworkPolicy = aiConfigService.getProviderNetworkOptions(saved, {
        lookup: options.lookup,
      });
      await validateHttpRequestTarget(requestedBaseUrl, providerNetworkPolicy);
      req.providerNetworkPolicy = providerNetworkPolicy;
      req.providerNetworkTrustedOrigins = providerNetworkPolicy.trustedOrigins;
      return next();
    } catch (error) {
      return response.error(
        res,
        400,
        error?.code || 'UNSAFE_PROVIDER_URL',
        'Provider URL must match an enabled saved provider configuration.'
      );
    }
  };
}

function setupRouter(cfg, db, log) {
  const r = express.Router();
  const uploadService = require('../services/uploadService');
  const sourceOriginalQuotaBytes = cfg?.storage?.story_source_original_quota_bytes
    ?? process.env.LOCALMINIDRAMA_SOURCE_ORIGINAL_QUOTA_BYTES
    ?? uploadService.DEFAULT_STORY_SOURCE_ORIGINAL_QUOTA_BYTES;
  const drama = dramaRoutes(db, cfg, log, { sourceOriginalQuotaBytes });
  const task = taskRoutes(db, log);
  const settings = settingsRoutes(db, cfg, log);
  const aiConfig = aiConfigRoutes(db, log, cfg);
  const prop = propRoutes(db, log, cfg);
  const stub = stubRoutes(db, cfg, log);
  const sceneModelMap = sceneModelMapRoutes(db, log);
  const providerNetworkBoundary = createProviderNetworkBoundary(db);
  
  const charLibrary = characterLibraryRoutes(db, cfg, log);
  const sceneLibrary = sceneLibraryRoutes(db, cfg, log);
  const propLibrary = propLibraryRoutes(db, cfg, log);
  const characters = characterRoutes(db, cfg, log, uploadService);
  const uploadHandlers = uploadModule.routes(cfg, log, db);
  const scenes = sceneRoutes(db, log, cfg);
  const storyboards = storyboardRoutes(db, log);
  const tailFrameLink = tailFrameLinkRoutes(db, cfg, log);
  const images = imageRoutes(db, cfg, log);
  const videos = videoRoutes(db, log);
  const videoMerges = videoMergeRoutes(db, log);
  const assets = assetRoutes(db, log);
  const audio = audioRoutes(db, log, cfg);
  const promptOverrides = promptOverridesRoutes.routes(db, log);
  const workflows = workflowRoutes(db, log);
  const rawStorySourceStoragePath = cfg?.storage?.local_path || './data/storage';
  const storySourceStoragePath = path.isAbsolute(rawStorySourceStoragePath)
    ? rawStorySourceStoragePath
    : path.join(process.cwd(), rawStorySourceStoragePath);
  const storySources = storySourceRoutes(db, log, {
    storagePath: storySourceStoragePath,
    originalQuotaBytes: sourceOriginalQuotaBytes,
    originalReserveBytes: cfg?.storage?.upload_disk_reserve_bytes
      ?? process.env.LOCALMINIDRAMA_UPLOAD_DISK_RESERVE_BYTES,
  });
  const qaReports = qaReportRoutes(db, log);
  const timelines = timelineRoutes(db, log);

  // ---------- dramas ----------
  r.get('/dramas', drama.listDramas);
  r.post('/dramas', drama.createDrama);
  r.get('/dramas/stats', drama.getDramaStats);
  r.get('/dramas/trash', drama.listTrashedDramas);
  // 导出/导入（放在 :id 路由前，避免被 :id 捕获）
  r.get('/dramas/:id/export', drama.exportDrama);
  const multer = require('multer');
  const { DEFAULT_IMPORT_LIMITS } = require('../services/dramaImportService');
  const importTempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-import-upload-'));
  const importUpload = multer({
    storage: multer.diskStorage({
      destination(_req, _file, callback) { callback(null, importTempRoot); },
      filename(_req, _file, callback) { callback(null, `${randomUUID()}.zip`); },
    }),
    limits: { fileSize: DEFAULT_IMPORT_LIMITS.maxArchiveBytes, files: 1, fields: 20 },
  });
  const novelUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1 } });
  const sourceUploadMaxBytes = 20 * 1024 * 1024;
  const sourceUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: sourceUploadMaxBytes,
      fieldSize: 64 * 1024,
      fields: 20,
      files: 1,
      parts: 24,
    },
  });
  const importUploadSingle = (req, res, next) => {
    const contentLength = Number(req.headers?.['content-length']);
    const maxRequestBytes = DEFAULT_IMPORT_LIMITS.maxArchiveBytes + (2 * 1024 * 1024);
    if (Number.isFinite(contentLength) && contentLength > maxRequestBytes) {
      return response.error(res, 413, 'IMPORT_ARCHIVE_TOO_LARGE', 'ZIP upload exceeds 256MB');
    }
    try {
      uploadService.assertUploadDiskCapacity(
        importTempRoot,
        Number.isFinite(contentLength) && contentLength > 0 ? contentLength : maxRequestBytes
      );
    } catch (error) {
      if (uploadService.isUploadStorageError(error)) {
        return response.error(
          res,
          507,
          'INSUFFICIENT_STORAGE',
          'Insufficient temporary disk space for ZIP upload'
        );
      }
      return next(error);
    }
    importUpload.single('file')(req, res, (err) => {
      if (err) {
        if (req.file?.path) fs.rmSync(req.file.path, { force: true });
        if (err.code === 'LIMIT_FILE_SIZE') {
          return response.error(res, 413, 'IMPORT_ARCHIVE_TOO_LARGE', 'ZIP upload exceeds 256MB');
        }
        return response.badRequest(res, err.message || 'ZIP upload failed');
      }
      if (req.file?.path) {
        const uploadedPath = req.file.path;
        req.file.buffer = uploadedPath;
        let cleaned = false;
        const cleanup = () => {
          if (cleaned) return;
          cleaned = true;
          fs.rmSync(uploadedPath, { force: true });
        };
        res.once('finish', cleanup);
        res.once('close', cleanup);
      }
      return next();
    });
  };
  const sourceUploadSingle = (req, res, next) => {
    const contentLength = Number(req.headers?.['content-length']);
    const maxRequestBytes = sourceUploadMaxBytes + (2 * 1024 * 1024);
    if (Number.isFinite(contentLength) && contentLength > maxRequestBytes) {
      return response.error(
        res,
        413,
        'SOURCE_UPLOAD_TOO_LARGE',
        'Source Intake uploads are limited to 20MB.'
      );
    }
    try {
      uploadService.assertUploadDiskCapacity(
        storySourceStoragePath,
        Number.isFinite(contentLength) && contentLength > 0 ? contentLength : sourceUploadMaxBytes,
        cfg?.storage?.upload_disk_reserve_bytes
          ?? process.env.LOCALMINIDRAMA_UPLOAD_DISK_RESERVE_BYTES
          ?? uploadService.DEFAULT_UPLOAD_DISK_RESERVE_BYTES
      );
    } catch (error) {
      if (uploadService.isUploadStorageError(error)) {
        return response.error(
          res,
          507,
          'INSUFFICIENT_STORAGE',
          'Insufficient storage capacity for the source original.'
        );
      }
      return next(error);
    }
    sourceUpload.single('file')(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') {
        return response.error(
          res,
          413,
          'SOURCE_UPLOAD_TOO_LARGE',
          'Source Intake uploads are limited to 20MB.'
        );
      }
      return response.badRequest(res, err.message || 'Source Intake upload failed');
    });
  };
  r.post('/dramas/import', importUploadSingle, drama.importDrama);
  r.post('/dramas/import-novel', novelUpload.single('file'), async (req, res) => {
    try {
      const novelImportService = require('../services/novelImportService');
      let text = '';
      if (req.file && req.file.buffer) {
        text = req.file.buffer.toString('utf8');
      } else if (req.body && req.body.text) {
        text = req.body.text;
      }
      if (!text.trim()) return response.badRequest(res, '请上传小说文本文件或提供 text 参数');
      const title = req.body?.title || '';
      const maxChapters = Number(req.body?.max_chapters) || 20;
      const aiSummarize = req.body?.ai_summarize === 'true' || req.body?.ai_summarize === true;
      const result = await novelImportService.importNovel(db, log, { text, title, maxChapters, aiSummarize });
      const dramaId = Number(req.body?.drama_id || req.body?.dramaId || req.query?.drama_id || 0);
      if (dramaId > 0) {
        const sourceIntakeService = require('../services/sourceIntakeService');
        const workflowService = require('../services/workflowService');
        const startWorkflow = req.body?.start_workflow !== 'false' && req.body?.start_workflow !== false;
        const targetEpisodeCount = Number(req.body?.target_episode_count || req.body?.episode_count || result.chapters?.length || 1);
        const sourceResult = sourceIntakeService.createStorySource(db, log, {
          drama_id: dramaId,
          source_type: 'novel',
          title,
          text,
          target_episode_count: targetEpisodeCount,
          metadata: {
            imported_from: 'legacy_import_novel',
            legacy_chapter_count: result.total,
            ai_summarize: aiSummarize,
          },
        });
        result.story_source = sourceResult.source;
        result.adaptation_plan = sourceResult.adaptation_plan;
        if (startWorkflow) {
          result.workflow_run = workflowService.startNovel2AnimeWorkflow(db, log, {
            drama_id: dramaId,
            source_id: sourceResult.source.id,
            title,
            source_type: 'novel',
            target_episode_count: targetEpisodeCount,
            style: req.body?.style || '',
          });
        }
      }
      response.success(res, result);
    } catch (err) {
      log.error('dramas import-novel', { error: err.message });
      if (err.code === 'BAD_REQUEST') return response.badRequest(res, err.message);
      response.internalError(res, err.message);
    }
  });
  r.get('/dramas/examples', drama.listExamples);
  r.post('/dramas/import-example', drama.importExample);
  r.get('/dramas/:id/story-sources', storySources.listForDrama);
  r.post('/dramas/:id/story-sources', storySources.createForDrama);
  r.post('/dramas/:id/story-sources/upload', sourceUploadSingle, storySources.uploadForDrama);
  r.post('/dramas/:id/story-sources/import-url', storySources.importUrlForDrama);
  r.get('/dramas/:id/timeline', timelines.getDramaTimeline);
  r.get('/dramas/:id/timeline/manifest', timelines.exportDramaManifest);
  r.put('/dramas/:id/outline', drama.saveOutline);
  r.get('/dramas/:id/characters', drama.getCharacters);
  r.put('/dramas/:id/characters', drama.saveCharacters);
  r.get('/dramas/:id/scenes', scenes.list);
  r.put('/dramas/:id/episodes', drama.saveEpisodes);
  r.put('/dramas/:id/progress', drama.saveProgress);
  r.put('/dramas/:id/canvas-layout', drama.saveCanvasLayout);
  r.get('/dramas/:id/props', drama.listProps);
  r.get('/dramas/:id', drama.getDrama);
  r.put('/dramas/:id', drama.updateDrama);
  r.post('/dramas/:id/restore', drama.restoreDrama);
  r.delete('/dramas/:id', drama.moveDramaToTrash);

  // ---------- source intake / workflows / qa ----------
  r.get('/story-sources/:source_id', storySources.get);
  r.get('/story-sources/:source_id/original', storySources.downloadOriginal);
  r.post('/story-sources/:source_id/adaptation-plans', storySources.createPlan);
  r.post('/adaptation-plans/:plan_id/apply', storySources.applyPlan);
  r.get('/workflows', workflows.list);
  r.post('/workflows/novel2anime/readiness', workflows.novel2AnimeReadiness);
  r.post('/workflows/novel2anime', workflows.startNovel2Anime);
  r.get('/workflows/:run_id', workflows.get);
  r.post('/workflows/:run_id/retry', workflows.retry);
  r.post('/workflows/:run_id/cancel', workflows.cancel);
  r.post('/workflows/:run_id/pause', workflows.pause);
  r.post('/workflows/:run_id/resume', workflows.resume);
  r.get('/qa/reports', qaReports.list);
  r.post('/qa/audit', qaReports.audit);
  r.get('/qa/reports/:report_id', qaReports.get);
  r.post('/qa/reports/:report_id/remediate', qaReports.remediate);

  // ---------- ai-configs ----------
  r.get('/ai-configs', aiConfig.list);
  r.post('/ai-configs', aiConfig.create);
  r.post('/ai-configs/test', providerNetworkBoundary, aiConfig.testConnection);
  r.post('/ai-configs/jimeng2-list-assets', providerNetworkBoundary, aiConfig.listJimeng2MaterialAssets);
  r.post('/ai-configs/model-ark-asset', providerNetworkBoundary, aiConfig.modelArkAsset);
  r.get('/ai-configs/vendor-lock', aiConfig.vendorLock);  // 必须在 /:id 之前
  r.put('/ai-configs/bulk-update-key', aiConfig.bulkUpdateKey);  // 必须在 /:id 之前
  r.get('/ai-configs/:id', aiConfig.get);
  r.put('/ai-configs/:id', aiConfig.update);
  r.delete('/ai-configs/:id', aiConfig.delete);

  // ---------- generation (角色生成：AI + 入库 + 任务结果) ----------
  r.post('/generation/characters', (req, res) => {
    const characterGenerationService = require('../services/characterGenerationService');
    try {
      const body = req.body || {};
      if (!body.drama_id) {
        return response.badRequest(res, 'drama_id 必填');
      }
      const taskId = characterGenerationService.generateCharacters(db, cfg, log, body);
      response.success(res, { task_id: taskId, status: 'pending' });
    } catch (err) {
      log.error('generation/characters', { error: err.message });
      if (err.code === 'BAD_REQUEST') return response.badRequest(res, err.message);
      response.internalError(res, err.message || '创建任务失败');
    }
  });

  // 故事生成：带 drama_id 时异步生成并入库；否则同步返回 episodes（兼容旧调用）
  r.post('/generation/story', async (req, res) => {
    const storyGenerationService = require('../services/storyGenerationService');
    try {
      const body = req.body || {};
      if (body.drama_id) {
        const taskId = storyGenerationService.startStoryGeneration(db, log, body);
        return response.success(res, { task_id: taskId, status: 'pending' });
      }
      const result = await storyGenerationService.generateStory(db, log, body);
      response.success(res, result);
    } catch (err) {
      log.error('generation/story', { error: err.message });
      if (err.message && (err.message.includes('未配置') || err.message.includes('必填') || err.message.includes('不存在'))) {
        return response.badRequest(res, err.message);
      }
      response.internalError(res, err.message || '故事生成失败');
    }
  });

  // ---------- character-library ----------
  r.get('/character-library', charLibrary.list);
  r.post('/character-library', charLibrary.create);
  r.get('/character-library/:id', charLibrary.get);
  r.put('/character-library/:id', charLibrary.update);
  r.delete('/character-library/:id', charLibrary.delete);

  // ---------- scene-library ----------
  r.get('/scene-library', sceneLibrary.list);
  r.post('/scene-library', sceneLibrary.create);
  r.get('/scene-library/:id', sceneLibrary.get);
  r.put('/scene-library/:id', sceneLibrary.update);
  r.delete('/scene-library/:id', sceneLibrary.delete);

  // ---------- prop-library ----------
  r.get('/prop-library', propLibrary.list);
  r.post('/prop-library', propLibrary.create);
  r.get('/prop-library/:id', propLibrary.get);
  r.put('/prop-library/:id', propLibrary.update);
  r.delete('/prop-library/:id', propLibrary.delete);

  // ---------- characters ----------
  r.get('/characters/:id', characters.getOne);
  r.put('/characters/:id', characters.update);
  r.delete('/characters/:id', characters.delete);
  r.post('/characters/batch-generate-images', characters.batchGenerateImages);
  r.post('/characters/:id/generate-image', characters.generateImage);
  r.post('/characters/:id/generate-four-view-image', characters.generateFourViewImage);
  r.post('/characters/:id/generate-prompt', characters.generatePrompt);
  r.post('/characters/:id/upload-image', uploadModule.multerSingle, characters.uploadImage);
  r.put('/characters/:id/image', characters.putImage);
  r.put('/characters/:id/image-from-library', characters.imageFromLibrary);
  r.post('/characters/:id/add-to-library', characters.addToLibrary);
  r.post('/characters/:id/add-to-material-library', characters.addToMaterialLibrary);
  r.post('/characters/:id/sd2-certify', characters.sd2Certify);
  r.post('/characters/:id/sd2-certify/refresh', characters.sd2CertifyRefresh);
  r.post('/characters/:id/sd2-voice-upload', uploadModule.multerAudioSingle, characters.sd2VoiceUpload);
  r.post('/characters/:id/sd2-voice-refresh', characters.sd2VoiceRefresh);
  r.post('/characters/:id/extract-from-image', characters.extractFromImage);
  r.post('/characters/:id/extract-anchors', characters.extractAnchors);

  // ---------- props ----------
  r.get('/props/:id', prop.getPropById);
  r.post('/props', prop.createProp);
  r.put('/props/:id', prop.updateProp);
  r.delete('/props/:id', prop.deleteProp);
  r.post('/props/:id/generate', prop.generateImage);
  r.post('/props/:id/generate-prompt', prop.generatePropPrompt);
  r.post('/props/:id/add-to-library', prop.addToLibrary);
  r.post('/props/:id/add-to-material-library', prop.addToMaterialLibrary);
  r.post('/props/:id/extract-from-image', prop.extractPropFromImage);

  // ---------- vision: 从图片提取描述（不依赖已有实体 ID）----------
  r.post('/extract-description-from-image', async (req, res) => {
    const { image_url, entity_type, entity_name } = req.body || {};
    if (!image_url) return response.badRequest(res, '缺少 image_url');
    if (!['character', 'scene', 'prop'].includes(entity_type)) return response.badRequest(res, 'entity_type 需为 character/scene/prop');
    try {
      const { extractDescriptionFromImage } = require('../services/aiClient');
      const out = await extractDescriptionFromImage(db, log, entity_type, image_url, entity_name);
      if (!out.ok) return response.badRequest(res, out.error);
      response.success(res, { description: out.description });
    } catch (err) {
      log.error('extract-description-from-image', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // ---------- upload ----------
  r.post('/upload/image', uploadModule.multerSingle, uploadHandlers.uploadImage);

  // ---------- episodes ----------
  // 注意：drama.generateStoryboard 已处理所有逻辑（包括参数解析），这里统一使用 drama 模块的实现
  // 之前可能有部分路由指向了 storyboards.episodeStoryboardsGenerate，这可能导致参数解析不一致
  r.post('/episodes/:episode_id/storyboards', drama.generateStoryboard);
  r.post('/episodes/:episode_id/props/extract', prop.extractProps);
  r.post('/episodes/:episode_id/characters/extract', stub.episodeCharactersExtract);
  r.get('/episodes/:episode_id/storyboards', storyboards.episodeStoryboardsGet);
  r.post('/episodes/:episode_id/finalize', drama.finalizeEpisode);
  r.get('/episodes/:episode_id/download', drama.downloadEpisodeVideo);

  // ---------- tasks ----------
  r.get('/tasks/:task_id', task.getTaskStatus);
  r.post('/tasks/:task_id/cancel', task.cancelTaskStatus);
  r.get('/tasks', task.getResourceTasks);

  // ---------- scenes ----------
  r.get('/scenes/:scene_id', scenes.getOne);
  r.post('/scenes/:scene_id/generate-prompt', scenes.generatePrompt);
  r.put('/scenes/:scene_id', scenes.update);
  r.put('/scenes/:scene_id/prompt', scenes.updatePrompt);
  r.delete('/scenes/:scene_id', scenes.delete);
  r.post('/scenes/generate-image', scenes.generateImage);
  r.post('/scenes', scenes.create);
  r.post('/scenes/:scene_id/generate-four-view-image', scenes.generateFourViewImage);
  r.post('/scenes/:scene_id/generate-panorama', scenes.generatePanorama);
  r.post('/scenes/:scene_id/add-to-library', scenes.addToLibrary);
  r.post('/scenes/:scene_id/add-to-material-library', scenes.addToMaterialLibrary);
  r.post('/scenes/:scene_id/extract-from-image', scenes.extractFromImage);

  // ---------- images ----------
  r.get('/images', images.list);
  r.post('/images', images.create);
  r.get('/images/episode/:episode_id/backgrounds', images.episodeBackgrounds);
  r.post('/images/episode/:episode_id/backgrounds/extract', images.episodeBackgroundsExtract);
  r.post('/images/episode/:episode_id/batch', images.episodeBatch);
  r.post('/images/scene/:scene_id', images.scene);
  r.post('/images/upload', images.upload);
  r.get('/images/:id', images.get);
  r.delete('/images/:id', images.delete);

  // ---------- videos ----------
  r.get('/videos', videos.list);
  r.post('/videos', videos.create);
  r.post('/videos/image/:image_gen_id', videos.fromImage);
  r.post('/videos/episode/:episode_id/batch', videos.episodeBatch);
  r.get('/videos/:id', videos.get);
  r.delete('/videos/:id', videos.delete);

  // ---------- video-merges ----------
  r.get('/video-merges', videoMerges.list);
  r.post('/video-merges', videoMerges.create);
  r.get('/video-merges/:merge_id', videoMerges.get);
  r.delete('/video-merges/:merge_id', videoMerges.delete);

  // ---------- assets ----------
  r.get('/assets', assets.list);
  r.post('/assets/upload', uploadModule.multerMediaSingle, uploadHandlers.uploadAsset);
  r.post('/assets', assets.create);
  r.post('/assets/import/image/:image_gen_id', assets.importImage);
  r.post('/assets/import/video/:video_gen_id', assets.importVideo);
  r.get('/assets/:id', assets.get);
  r.put('/assets/:id', assets.update);
  r.delete('/assets/:id', assets.delete);

  // ---------- storyboards ----------
  r.post('/storyboards/episode/:episode_id/generate', storyboards.episodeStoryboardsGenerate);
  r.post('/storyboards', storyboards.create);
  r.post('/storyboards/:id/insert-before', storyboards.insertBefore);
  r.get('/storyboards/:id', storyboards.getOne);
  r.put('/storyboards/:id', storyboards.update);
  r.delete('/storyboards/:id', storyboards.delete);
  r.post('/storyboards/:id/props', prop.associateProps);
  r.post('/storyboards/:id/frame-prompt', storyboards.framePrompt);
  r.get('/storyboards/:id/frame-prompts', storyboards.framePromptsGet);
  r.put('/storyboards/:id/frame-prompts/:frame_type', storyboards.framePromptSave);
  r.post('/storyboards/:id/link-tail-frame', tailFrameLink.linkTailFrame);
  r.post('/storyboards/:id/polish-prompt', storyboards.polishPrompt);
  r.post('/storyboards/:id/universal-segment-polish-stream', storyboards.polishUniversalSegmentStream);
  r.post('/storyboards/:id/classic-video-prompt-polish-stream', storyboards.polishClassicVideoPromptStream);
  r.post('/storyboards/:id/universal-segment-prompt-stream', storyboards.generateUniversalSegmentStream);
  r.post('/storyboards/:id/universal-segment-prompt', storyboards.generateUniversalSegmentPrompt);
  r.post('/storyboards/batch-infer-params', storyboards.batchInferParams);
  r.post('/storyboards/:id/upscale', storyboards.upscale);
  r.post('/storyboards/:id/regenerate-layout-description', storyboards.regenerateLayoutDescription);
  r.post('/storyboards/:id/rebuild-video-prompt', storyboards.rebuildVideoPrompt);
  r.post('/storyboards/:id/split-by-audio', storyboards.splitByAudio);

  // ---------- audio ----------
  r.post('/audio/extract', audio.extract);
  r.post('/audio/extract/batch', audio.extractBatch);

  // ---------- timelines ----------
  r.get('/episodes/:episode_id/timeline', timelines.getEpisodeTimeline);
  r.get('/episodes/:episode_id/timeline/srt', timelines.exportEpisodeSrt);

  // ---------- settings ----------
  r.get('/settings/language', settings.getLanguage);
  r.put('/settings/language', settings.updateLanguage);
  r.get('/settings/generation', settings.getGenerationSettings);
  r.put('/settings/generation', settings.updateGenerationSettings);

  // ---------- prompt overrides ----------
  r.get('/settings/prompts', promptOverrides.list);
  r.put('/settings/prompts/:key', promptOverrides.update);
  r.delete('/settings/prompts/:key', promptOverrides.reset);

  // ---------- scene model map ----------
  r.get('/scene-model-map', sceneModelMap.list);
  r.post('/scene-model-map', sceneModelMap.create);
  r.get('/scene-model-map/:key', sceneModelMap.get);
  r.put('/scene-model-map/:key', sceneModelMap.update);
  r.delete('/scene-model-map/:key', sceneModelMap.delete);

  // 启动时将已有的覆盖加载到 promptI18n 内存缓存
  try {
    const promptI18n = require('../services/promptI18n');
    const promptOverridesService = require('../services/promptOverridesService');
    const saved = promptOverridesService.listOverrides(db);
    promptI18n.loadOverridesIntoCache(saved);
  } catch (e) {
    console.warn('Failed to load prompt overrides:', e.message);
  }

  return r;
}

module.exports = { createProviderNetworkBoundary, setupRouter };
