const fs = require('fs');
const path = require('path');
const response = require('../response');
const { sendCaughtRouteError, publicErrorMessage } = require('./serviceFailure');
const storyboardService = require('../services/storyboardService');
const episodeStoryboardService = require('../services/episodeStoryboardService');
const framePromptService = require('../services/framePromptService');
const aiClient = require('../services/aiClient');
const uploadService = require('../services/uploadService');
const promptI18n = require('../services/promptI18n');
const { buildUniversalSegmentUserPromptBundle } = require('../services/universalSegmentPromptBundle');
const { normalizeUniversalSegmentShotDurations } = require('../services/universalSegmentDurationNormalize');
const M = require('./storyboardsMessages');
const {
  parseStoryboardId,
  parseEpisodeId,
  parseFrameType,
  parseFramePromptBody,
  validatePolishableContent,
  parseUniversalDraft,
  parseClassicCreationMode,
  parseClassicVideoAnchor,
  assertStoryboardWritableFailClosed,
  assertEpisodeWritableFailClosed,
  sendStoryboardBoundaryFailure,
  sendPromptBundleFailure,
} = require('./storyboardsValidation');
const assembly = require('./storyboardsAssembly');
const query = require('./storyboardsQuery');
const mutations = require('./storyboardsMutations');

function sendRouteFailure(res, err, fallback) {
  if (sendStoryboardBoundaryFailure(res, err)) return;
  sendCaughtRouteError(res, err, fallback);
}

function routes(db, log) {
  return {
    create: (req, res) => {
      try {
        const parsed = parseEpisodeId(req.body?.episode_id, { missingMessage: M.SELECT_EPISODE });
        if (!parsed.ok) return response.badRequest(res, parsed.message);
        assertEpisodeWritableFailClosed(db, parsed.id);
        const sb = storyboardService.createStoryboard(db, log, req.body || {});
        response.created(res, sb);
      } catch (err) {
        log.error('storyboards create', { error: err.message });
        sendRouteFailure(res, err, M.OPERATION_FAILED);
      }
    },
    insertBefore: (req, res) => {
      try {
        const parsed = parseStoryboardId(req.params.id);
        if (!parsed.ok) return response.badRequest(res, parsed.message);
        assertStoryboardWritableFailClosed(db, parsed.id);
        const sb = storyboardService.insertBeforeStoryboard(db, log, parsed.id);
        if (!sb) return response.notFound(res, M.TARGET_STORYBOARD_NOT_FOUND);
        response.created(res, sb);
      } catch (err) {
        log.error('storyboards insertBefore', { error: err.message });
        sendRouteFailure(res, err, M.OPERATION_FAILED);
      }
    },
    getOne: (req, res) => {
      try {
        const parsed = parseStoryboardId(req.params.id);
        if (!parsed.ok) return response.badRequest(res, parsed.message);
        assertStoryboardWritableFailClosed(db, parsed.id);
        const sb = storyboardService.getStoryboardById(db, parsed.id);
        if (!sb) return response.notFound(res, M.STORYBOARD_NOT_FOUND);
        response.success(res, sb);
      } catch (err) {
        log.error('storyboards getOne', { error: err.message });
        sendRouteFailure(res, err, M.OPERATION_FAILED);
      }
    },
    update: (req, res) => {
      try {
        const parsed = parseStoryboardId(req.params.id);
        if (!parsed.ok) return response.badRequest(res, parsed.message);
        assertStoryboardWritableFailClosed(db, parsed.id);
        const sb = storyboardService.updateStoryboard(db, log, parsed.id, req.body || {});
        if (!sb) return response.notFound(res, M.STORYBOARD_NOT_FOUND);
        response.success(res, sb);
      } catch (err) {
        log.error('storyboards update', { error: err.message });
        sendRouteFailure(res, err, M.OPERATION_FAILED);
      }
    },
    delete: (req, res) => {
      try {
        const parsed = parseStoryboardId(req.params.id);
        if (!parsed.ok) return response.badRequest(res, parsed.message);
        assertStoryboardWritableFailClosed(db, parsed.id);
        const ok = storyboardService.deleteStoryboard(db, log, parsed.id);
        if (!ok) return response.notFound(res, M.STORYBOARD_NOT_FOUND);
        response.success(res, { message: M.DELETE_SUCCESS });
      } catch (err) {
        log.error('storyboards delete', { error: err.message });
        sendRouteFailure(res, err, M.OPERATION_FAILED);
      }
    },
    framePrompt: (req, res) => {
      try {
        const parsed = parseStoryboardId(req.params.id);
        if (!parsed.ok) return response.badRequest(res, parsed.message);
        assertStoryboardWritableFailClosed(db, parsed.id);
        const body = req.body || {};
        const frameType = body.frame_type || 'first';
        const panelCount = body.panel_count || 3;
        const model = body.model || '';
        const taskId = framePromptService.generateFramePrompt(db, log, parsed.id, frameType, panelCount, model);
        response.success(res, {
          task_id: taskId,
          status: 'pending',
          message: M.FRAME_PROMPT_CREATED,
        });
      } catch (err) {
        log.error('storyboards frame-prompt', { error: err.message });
        sendRouteFailure(res, err, M.OPERATION_FAILED);
      }
    },
    framePromptsGet: (req, res) => {
      try {
        const parsed = parseStoryboardId(req.params.id);
        if (!parsed.ok) return response.badRequest(res, parsed.message);
        assertStoryboardWritableFailClosed(db, parsed.id);
        const list = framePromptService.getFramePrompts(db, parsed.id);
        response.success(res, { frame_prompts: list });
      } catch (err) {
        log.error('storyboards frame-prompts', { error: err.message });
        sendRouteFailure(res, err, M.OPERATION_FAILED);
      }
    },
    framePromptSave: (req, res) => {
      try {
        const frame = parseFrameType(req.params.frame_type);
        if (!frame.ok) return response.badRequest(res, frame.message);
        const body = parseFramePromptBody(req.body || {});
        if (!body.ok) return response.badRequest(res, body.message);
        const parsed = parseStoryboardId(req.params.id);
        if (!parsed.ok) return response.badRequest(res, parsed.message);
        assertStoryboardWritableFailClosed(db, parsed.id);
        framePromptService.saveFramePrompt(
          db,
          log,
          parsed.id,
          frame.frameType,
          body.prompt,
          body.description,
          body.layout
        );
        response.success(res, { message: M.SAVE_SUCCESS, frame_type: frame.frameType });
      } catch (err) {
        log.error('storyboards frame-prompt-save', { error: err.message });
        sendRouteFailure(res, err, M.OPERATION_FAILED);
      }
    },
    regenerateLayoutDescription: async (req, res) => {
      try {
        const parsed = parseStoryboardId(req.params.id);
        if (!parsed.ok) return response.badRequest(res, parsed.message);
        assertStoryboardWritableFailClosed(db, parsed.id);
        const newLayout = await framePromptService.regenerateLayoutDescription(db, log, parsed.id);
        response.success(res, {
          layout_description: newLayout,
          message: M.LAYOUT_REGENERATED,
        });
      } catch (err) {
        log.error('storyboards regenerateLayoutDescription', { error: err.message, id: req.params.id });
        sendRouteFailure(res, err, M.REGENERATE_LAYOUT_FAILED);
      }
    },
    rebuildVideoPrompt: (req, res) => {
      try {
        const parsed = parseStoryboardId(req.params.id);
        if (!parsed.ok) return response.badRequest(res, parsed.message);
        assertStoryboardWritableFailClosed(db, parsed.id);
        const sb = episodeStoryboardService.rebuildVideoPromptForStoryboard(db, log, parsed.id);
        if (!sb) return response.notFound(res, M.STORYBOARD_NOT_FOUND);
        response.success(res, {
          ...sb,
          message: M.VIDEO_PROMPT_REBUILT,
        });
      } catch (err) {
        log.error('storyboards rebuildVideoPrompt', { error: err.message, id: req.params.id });
        sendRouteFailure(res, err, M.REBUILD_VIDEO_PROMPT_FAILED);
      }
    },
    splitByAudio: (req, res) => {
      try {
        const parsed = parseStoryboardId(req.params.id);
        if (!parsed.ok) return response.badRequest(res, parsed.message);
        assertStoryboardWritableFailClosed(db, parsed.id);
        const result = episodeStoryboardService.splitStoryboardByAudio(db, log, parsed.id);
        response.success(res, {
          ...result,
          message: M.splitSuccess(result),
        });
      } catch (err) {
        log.error('storyboards splitByAudio', { error: err.message, id: req.params.id });
        if (sendStoryboardBoundaryFailure(res, err)) return;
        response.badRequest(res, publicErrorMessage(err, M.SPLIT_FAILED));
      }
    },
    episodeStoryboardsGenerate: (req, res) => {
      try {
        const parsed = parseEpisodeId(req.params.episode_id);
        if (!parsed.ok) return response.badRequest(res, parsed.message);
        assertEpisodeWritableFailClosed(db, parsed.id);
        const body = req.body || {};
        const taskId = episodeStoryboardService.generateStoryboard(
          db,
          log,
          parsed.id,
          body.model,
          body.style
        );
        response.success(res, { task_id: taskId, status: 'pending', message: M.EPISODE_GENERATE_CREATED });
      } catch (err) {
        log.error('episode storyboards generate', { error: err.message });
        sendRouteFailure(res, err, M.OPERATION_FAILED);
      }
    },
    episodeStoryboardsGet: (req, res) => {
      try {
        const list = episodeStoryboardService.getStoryboardsForEpisode(db, req.params.episode_id);
        response.success(res, { storyboards: list, total: list.length });
      } catch (err) {
        log.error('episode storyboards get', { error: err.message });
        sendRouteFailure(res, err, M.OPERATION_FAILED);
      }
    },

    polishPrompt: async (req, res) => {
      try {
        const parsed = parseStoryboardId(req.params.id);
        if (!parsed.ok) return response.badRequest(res, parsed.message);
        const sbId = parsed.id;
        const sb = query.loadImagePolishStoryboard(db, sbId);
        if (!sb) return response.notFound(res, M.STORYBOARD_NOT_FOUND);
        const polishable = validatePolishableContent(sb);
        if (!polishable.ok) return response.badRequest(res, polishable.message);
        assertStoryboardWritableFailClosed(db, sbId);

        const { userPrompt, neighbor, assetNames } = assembly.assembleImagePolishContext(db, sb, sbId);

        const polishedPrompt = await aiClient.generateText(
          db, log, 'text', userPrompt, promptI18n.getImagePolishPrompt(),
          { scene_key: 'image_polish', max_tokens: 300, temperature: 0.3 }
        );

        if (!polishedPrompt || polishedPrompt.trim().length < 10) {
          return response.badRequest(res, M.AI_OUTPUT_TOO_SHORT);
        }

        const polished = polishedPrompt.trim();
        mutations.persistPolishedPrompt(db, sbId, polished);
        log.info('[分镜] polishPrompt 完成', { id: sbId, len: polished.length, has_prev_continuity: !!neighbor.prevContinuityState });

        const snapshotPrompt = promptI18n.getContinuitySnapshotPrompt();
        const snapshotUserPrompt = [`PROMPT: ${polished}`, `ASSETS: ${assetNames || 'none'}`].join('\n');
        aiClient.generateText(db, log, 'text', snapshotUserPrompt, snapshotPrompt, {
          scene_key: 'image_polish', max_tokens: 200, temperature: 0.1,
        }).then((snapshotJson) => {
          if (!snapshotJson?.trim()) return;
          const cleaned = snapshotJson.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
          try {
            JSON.parse(cleaned);
            mutations.persistContinuitySnapshot(db, sbId, cleaned);
            log.info('[分镜] polishPrompt 连戏快照已保存', { id: sbId });
          } catch (_) {}
        }).catch(() => {});

        response.success(res, { polished_prompt: polished });
      } catch (err) {
        log.error('storyboards polishPrompt', { error: err.message });
        sendRouteFailure(res, err, M.OPERATION_FAILED);
      }
    },

    generateUniversalSegmentPrompt: async (req, res) => {
      try {
        const parsed = parseStoryboardId(req.params.id);
        if (!parsed.ok) return response.badRequest(res, parsed.message);
        assertStoryboardWritableFailClosed(db, parsed.id);
        const built = buildUniversalSegmentUserPromptBundle(db, parsed.id, req.body || {}, {});
        if (sendPromptBundleFailure(res, built)) return;
        const { userPrompt, durationLabel, durationSec } = built;
        const out = await aiClient.generateText(
          db,
          log,
          'text',
          userPrompt,
          promptI18n.getUniversalOmniSegmentPrompt(),
          { scene_key: 'image_polish', max_tokens: 2400, temperature: 0.28 }
        );
        if (!out || String(out).trim().length < 20) {
          return response.badRequest(res, M.AI_OUTPUT_TOO_SHORT);
        }
        let text = String(out).trim();
        text = normalizeUniversalSegmentShotDurations(text, durationLabel, durationSec);
        text = assembly.normalizeUniversalSegmentAtImageSpacing(text);
        mutations.persistUniversalSegmentText(db, parsed.id, text);
        log.info('[分镜] generateUniversalSegmentPrompt 完成', { id: parsed.id, len: text.length, duration_sec: durationSec });
        response.success(res, { universal_segment_text: text });
      } catch (err) {
        log.error('storyboards generateUniversalSegmentPrompt', { error: err.message });
        sendRouteFailure(res, err, M.OPERATION_FAILED);
      }
    },

    generateUniversalSegmentStream: async (req, res) => {
      const parsed = parseStoryboardId(req.params.id);
      if (!parsed.ok) return response.badRequest(res, parsed.message);
      try {
        assertStoryboardWritableFailClosed(db, parsed.id);
      } catch (err) {
        if (sendStoryboardBoundaryFailure(res, err)) return;
        log.error('storyboards generateUniversalSegmentStream', { error: err.message, id: parsed.id });
        return sendCaughtRouteError(res, err, M.OPERATION_FAILED);
      }
      const built = buildUniversalSegmentUserPromptBundle(db, parsed.id, req.body || {}, {});
      if (sendPromptBundleFailure(res, built)) return;
      const { userPrompt, durationLabel, durationSec } = built;

      const writeNd = assembly.beginNdjsonStream(res);
      let finalRaw = '';
      try {
        finalRaw = await aiClient.streamGenerateText(
          db,
          log,
          'text',
          userPrompt,
          promptI18n.getUniversalOmniSegmentPrompt(),
          {
            scene_key: 'image_polish',
            max_tokens: 2400,
            temperature: 0.28,
            silence_timeout_ms: 180000,
          },
          (delta) => writeNd({ type: 'delta', text: delta })
        );
      } catch (err) {
        log.error('storyboards generateUniversalSegmentStream', { error: err.message, id: parsed.id });
        writeNd({ type: 'error', message: publicErrorMessage(err, M.STREAM_FAILED) });
        return res.end();
      }

      if (!finalRaw || String(finalRaw).trim().length < 20) {
        writeNd({ type: 'error', message: M.AI_OUTPUT_TOO_SHORT });
        return res.end();
      }
      let text = String(finalRaw).trim();
      text = normalizeUniversalSegmentShotDurations(text, durationLabel, durationSec);
      text = assembly.normalizeUniversalSegmentAtImageSpacing(text);
      mutations.persistUniversalSegmentText(db, parsed.id, text);
      log.info('[分镜] generateUniversalSegmentStream 完成', { id: parsed.id, len: text.length, duration_sec: durationSec });
      writeNd({ type: 'done', universal_segment_text: text });
      res.end();
    },

    polishUniversalSegmentStream: async (req, res) => {
      const parsed = parseStoryboardId(req.params.id);
      if (!parsed.ok) return response.badRequest(res, parsed.message);
      const draftParsed = parseUniversalDraft(req.body || {});
      if (!draftParsed.ok) return response.badRequest(res, draftParsed.message);
      try {
        assertStoryboardWritableFailClosed(db, parsed.id);
      } catch (err) {
        if (sendStoryboardBoundaryFailure(res, err)) return;
        log.error('storyboards polishUniversalSegmentStream', { error: err.message, id: parsed.id });
        return sendCaughtRouteError(res, err, M.OPERATION_FAILED);
      }
      const built = buildUniversalSegmentUserPromptBundle(db, parsed.id, req.body || {}, {
        universalSegmentOverride: draftParsed.draftRaw,
      });
      if (sendPromptBundleFailure(res, built)) return;
      const { userPrompt: baseUser, durationLabel, durationSec, episodeId, storyboardNumber } = built;

      const polishUserPrompt = assembly.assembleUniversalSegmentPolishContext(db, {
        draft: draftParsed.draft,
        baseUser,
        episodeId,
        storyboardNumber,
      });

      const writeNd = assembly.beginNdjsonStream(res);
      let finalRaw = '';
      try {
        finalRaw = await aiClient.streamGenerateText(
          db,
          log,
          'text',
          polishUserPrompt,
          promptI18n.getUniversalOmniPolishPrompt(),
          {
            scene_key: 'image_polish',
            max_tokens: 4096,
            temperature: 0.52,
            silence_timeout_ms: 180000,
          },
          (delta) => writeNd({ type: 'delta', text: delta })
        );
      } catch (err) {
        log.error('storyboards polishUniversalSegmentStream', { error: err.message, id: parsed.id });
        writeNd({ type: 'error', message: publicErrorMessage(err, M.STREAM_FAILED) });
        return res.end();
      }

      if (!finalRaw || String(finalRaw).trim().length < 20) {
        writeNd({ type: 'error', message: M.AI_OUTPUT_TOO_SHORT });
        return res.end();
      }
      let text = String(finalRaw).trim();
      text = normalizeUniversalSegmentShotDurations(text, durationLabel, durationSec);
      text = assembly.normalizeUniversalSegmentAtImageSpacing(text);
      mutations.persistUniversalSegmentText(db, parsed.id, text);
      log.info('[分镜] polishUniversalSegmentStream 完成', { id: parsed.id, len: text.length, duration_sec: durationSec });
      writeNd({ type: 'done', universal_segment_text: text });
      res.end();
    },

    polishClassicVideoPromptStream: async (req, res) => {
      const parsed = parseStoryboardId(req.params.id);
      if (!parsed.ok) return response.badRequest(res, parsed.message);
      let sbRow;
      try {
        sbRow = assertStoryboardWritableFailClosed(db, parsed.id);
      } catch (err) {
        if (sendStoryboardBoundaryFailure(res, err)) return;
        log.error('storyboards polishClassicVideoPromptStream', { error: err.message, id: parsed.id });
        return sendCaughtRouteError(res, err, M.OPERATION_FAILED);
      }
      const mode = parseClassicCreationMode(sbRow);
      if (!mode.ok) return response.badRequest(res, mode.message);

      const style = query.loadMergedDramaStyle(db, sbRow.episode_id);
      const autoComposed = episodeStoryboardService.composeStoryboardVideoPrompt(
        sbRow,
        style.styleEn || style.styleZh,
        style.videoRatio
      );
      const draftRaw = req.body && req.body.draft_video_prompt != null ? String(req.body.draft_video_prompt) : '';
      const anchor = parseClassicVideoAnchor(draftRaw, sbRow.video_prompt, autoComposed);
      if (!anchor.ok) return response.badRequest(res, anchor.message);

      const polishUserPrompt = assembly.assembleClassicVideoPolishContext(db, {
        sbRow,
        style,
        autoComposed,
        currentDraft: anchor.currentDraft,
      });

      const writeNd = assembly.beginNdjsonStream(res);
      let finalRaw = '';
      try {
        finalRaw = await aiClient.streamGenerateText(
          db,
          log,
          'text',
          polishUserPrompt,
          promptI18n.getClassicVideoPromptPolishPrompt(),
          {
            scene_key: 'image_polish',
            max_tokens: 3600,
            temperature: 0.28,
            silence_timeout_ms: 180000,
          },
          (delta) => writeNd({ type: 'delta', text: delta })
        );
      } catch (err) {
        log.error('storyboards polishClassicVideoPromptStream', { error: err.message, id: parsed.id });
        writeNd({ type: 'error', message: publicErrorMessage(err, M.STREAM_FAILED) });
        return res.end();
      }

      if (!finalRaw || String(finalRaw).trim().length < 12) {
        writeNd({ type: 'error', message: M.AI_OUTPUT_TOO_SHORT });
        return res.end();
      }
      const text = String(finalRaw).trim();
      mutations.persistVideoPrompt(db, parsed.id, text);
      log.info('[分镜] polishClassicVideoPromptStream 完成', { id: parsed.id, len: text.length });
      writeNd({ type: 'done', video_prompt: text });
      res.end();
    },

    upscale: async (req, res) => {
      const parsed = parseStoryboardId(req.params.id);
      if (!parsed.ok) return response.badRequest(res, parsed.message);
      const id = parsed.id;
      let row;
      try {
        row = assertStoryboardWritableFailClosed(db, id);
      } catch (err) {
        if (sendStoryboardBoundaryFailure(res, err)) return;
        log.error('storyboards upscale', { error: err.message });
        return sendCaughtRouteError(res, err, M.UPSCALE_FAILED);
      }
      try {
        const loadConfig = require('../config').loadConfig;
        const cfg = loadConfig();
        const storageBase = path.isAbsolute(cfg.storage?.local_path)
          ? cfg.storage.local_path
          : path.join(process.cwd(), cfg.storage?.local_path || './data/storage');
        const localImage = query.resolveStoryboardImageLocalPath(db, storageBase, id, row);
        if (!localImage) return response.badRequest(res, M.NO_LOCAL_IMAGE);
        let sharp; try { sharp = require('sharp'); } catch (_) { sharp = null; }
        if (!sharp) return response.badRequest(res, M.SHARP_UNAVAILABLE);
        const opened = uploadService.openStorageFile(storageBase, localImage.relativePath);
        let sourceBuffer;
        try {
          sourceBuffer = fs.readFileSync(opened.fd);
        } finally {
          fs.closeSync(opened.fd);
        }
        const image = sharp(sourceBuffer);
        const info = await image.metadata();
        const scale = 2;
        const newW = (info.width || 512) * scale;
        const newH = (info.height || 512) * scale;
        const newRelPath = assembly.resolveUpscaleOutputRelativePath(localImage.relativePath);
        const outputBuffer = await image.resize(newW, newH, { kernel: 'lanczos3' }).toBuffer();
        uploadService.writeStorageBuffer(storageBase, newRelPath, outputBuffer);
        mutations.persistStoryboardLocalPath(db, id, newRelPath);
        log.info('storyboard upscale done', { id, newRelPath, newW, newH });
        response.success(res, { local_path: newRelPath, width: newW, height: newH });
      } catch (err) {
        log.error('storyboards upscale', { error: err.message });
        if (err?.code === 'UNSAFE_MEDIA_REFERENCE') {
          return response.badRequest(res, M.UNSAFE_LOCAL_IMAGE);
        }
        sendRouteFailure(res, err, M.UPSCALE_FAILED);
      }
    },

    batchInferParams: (req, res) => {
      try {
        const parsed = parseEpisodeId(req.body?.episode_id, { missingMessage: M.SELECT_EPISODE });
        if (!parsed.ok) return response.badRequest(res, parsed.message);
        assertEpisodeWritableFailClosed(db, parsed.id);
        const overwrite = !!req.body?.overwrite;
        const rows = query.loadPhotographyParamRows(db, parsed.id);
        const { updated } = mutations.applyPhotographyParamPatches(db, rows, overwrite);

        log.info('[分镜] batchInferParams 完成', { episode_id: parsed.id, total: rows.length, updated, overwrite });
        response.success(res, { total: rows.length, updated });
      } catch (err) {
        log.error('storyboards batchInferParams', { error: err.message });
        sendRouteFailure(res, err, M.OPERATION_FAILED);
      }
    },
  };
}

module.exports = routes;
