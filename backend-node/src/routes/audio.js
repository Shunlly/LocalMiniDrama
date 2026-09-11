const response = require('../response');
const path = require('path');
const { logCaughtRouteError } = require('./serviceFailure');

function routes(db, log, cfg) {
  function getStoragePath() {
    const loadConfig = require('../config').loadConfig;
    const c = (cfg && cfg.storage) ? cfg : loadConfig();
    return path.isAbsolute(c.storage?.local_path)
      ? c.storage.local_path
      : path.join(process.cwd(), c.storage?.local_path || './data/storage');
  }

  return {
    /** 为单条分镜生成 TTS：对白 → audio_local_path；旁白 → narration_audio_local_path（body.tts_kind === 'narration'） */
    extract: async (req, res) => {
      const { storyboard_id, text, tts_kind } = req.body || {};
      if (!text && !storyboard_id) return response.badRequest(res, '请提供分镜编号或配音文本');
      const kind = String(tts_kind || 'dialogue').toLowerCase() === 'narration' ? 'narration' : 'dialogue';
      let ttsText = text;
      if (kind === 'narration') {
        if ((!ttsText || !String(ttsText).trim()) && storyboard_id) {
          const row = db.prepare('SELECT narration FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(Number(storyboard_id));
          ttsText = row?.narration;
        }
        if (!ttsText || !String(ttsText).trim()) {
          return response.badRequest(res, '分镜解说旁白为空，无法合成语音');
        }
      } else {
        if ((!ttsText || !String(ttsText).trim()) && storyboard_id) {
          const row = db.prepare('SELECT dialogue FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(Number(storyboard_id));
          ttsText = row?.dialogue;
        }
        if (!ttsText || !String(ttsText).trim()) {
          return response.badRequest(res, '分镜对白为空，无法合成语音');
        }
      }
      try {
        const ttsService = require('../services/ttsService');
        const result = await ttsService.synthesize(db, log, {
          text: ttsText,
          storyboard_id: storyboard_id || null,
          storage_base: getStoragePath(),
        });
        if (storyboard_id && result.local_path) {
          const now = new Date().toISOString();
          try {
            if (kind === 'narration') {
              db.prepare('UPDATE storyboards SET narration_audio_local_path = ?, updated_at = ? WHERE id = ?').run(
                result.local_path, now, Number(storyboard_id)
              );
            } else {
              db.prepare('UPDATE storyboards SET audio_local_path = ?, updated_at = ? WHERE id = ?').run(
                result.local_path, now, Number(storyboard_id)
              );
            }
          } catch (persistErr) {
            logCaughtRouteError(log, 'audio extract persist', persistErr, {
              storyboard_id: Number(storyboard_id),
              tts_kind: kind,
              fallback: '配音已生成，但分镜记录未能更新，请稍后重试',
            });
            return response.error(res, 500, 'AUDIO_PERSIST_FAILED', '配音已生成，但分镜记录未能更新，请稍后重试');
          }
        }
        response.success(res, { local_path: result.local_path, url: result.local_path ? '/static/' + result.local_path : '', tts_kind: kind });
      } catch (err) {
        const { toUserFacingTtsError } = require('../services/ttsService');
        const mapped = toUserFacingTtsError(err);
        logCaughtRouteError(log, 'audio extract', err, { userError: mapped.message, fallback: mapped.message });
        if (mapped.code === 'BAD_REQUEST' || err.code === 'BAD_REQUEST') {
          return response.badRequest(res, mapped.message);
        }
        const status = Number(mapped.status) === 401 || Number(mapped.status) === 403 ? 401 : 502;
        const code = status === 401 ? 'TTS_AUTH' : 'TTS_FAILED';
        response.error(res, status, code, mapped.message);
      }
    },

    /** 批量为多条分镜生成 TTS */
    extractBatch: async (req, res) => {
      const { storyboard_ids } = req.body || {};
      if (!Array.isArray(storyboard_ids) || storyboard_ids.length === 0) {
        return response.badRequest(res, '请至少选择一个分镜');
      }
      const results = [];
      const storagePath = getStoragePath();
      for (const sbId of storyboard_ids) {
        const row = db.prepare('SELECT id, dialogue FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(Number(sbId));
        if (!row || !row.dialogue?.trim()) {
          results.push({ storyboard_id: sbId, error: '对白为空' });
          continue;
        }
        try {
          const ttsService = require('../services/ttsService');
          const result = await ttsService.synthesize(db, log, {
            text: row.dialogue,
            storyboard_id: row.id,
            storage_base: storagePath,
          });
          if (result.local_path) {
            const now = new Date().toISOString();
            try {
              db.prepare('UPDATE storyboards SET audio_local_path = ?, updated_at = ? WHERE id = ?').run(
                result.local_path, now, row.id
              );
            } catch (persistErr) {
              logCaughtRouteError(log, 'audio extract batch persist', persistErr, {
                storyboard_id: row.id,
                fallback: '配音已生成，但分镜记录未能更新，请稍后重试',
              });
              results.push({ storyboard_id: sbId, error: '配音已生成，但分镜记录未能更新，请稍后重试' });
              continue;
            }
          }
          results.push({ storyboard_id: sbId, local_path: result.local_path });
        } catch (err) {
          const { toUserFacingTtsError } = require('../services/ttsService');
          const mapped = toUserFacingTtsError(err);
          logCaughtRouteError(log, 'audio extract batch item', err, {
            storyboard_id: sbId,
            userError: mapped.message,
            fallback: mapped.message,
          });
          results.push({ storyboard_id: sbId, error: mapped.message });
        }
      }
      response.success(res, results);
    },
  };
}

module.exports = routes;
