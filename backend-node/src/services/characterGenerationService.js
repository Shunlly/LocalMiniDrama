
const taskService = require('./taskService');
const aiClient = require('./aiClient');
const promptI18n = require('./promptI18n');
const { safeParseAIJSON, extractFirstArray } = require('../utils/safeJson');
const characterLibraryService = require('./characterLibraryService');
const { scheduleLegacyAsync } = require('./legacyAsyncSchedulerService');
const { mergeCfgStyleWithDrama } = require('../utils/dramaStyleMerge');

/**
 * 从角色外貌描述中提炼 6层视觉锚点，写入 characters.identity_anchors
 * 异步后台执行，不阻塞角色生成主流程
 */
async function enrichIdentityAnchors(db, log, characterId, appearance) {
  if (!appearance || !String(appearance).trim()) return;
  try {
    const systemPrompt = promptI18n.getIdentityAnchorsPrompt();
    const userPrompt = `Character appearance description:\n${appearance}`;
    const raw = await aiClient.generateText(db, log, 'text', userPrompt, systemPrompt, {
      scene_key: 'identity_anchors',
      max_tokens: 800,
      temperature: 0.1,
    });
    const anchors = safeParseAIJSON(raw, null, log);
    if (!anchors || typeof anchors !== 'object') return;
    const colorPalette = anchors.color_anchors ? JSON.stringify(Object.values(anchors.color_anchors)) : null;
    db.prepare(
      'UPDATE characters SET identity_anchors = ?, color_palette = ?, updated_at = ? WHERE id = ?'
    ).run(JSON.stringify(anchors), colorPalette, new Date().toISOString(), characterId);
    log.info('[锚点] identity_anchors 提炼完成', { character_id: characterId });
  } catch (err) {
    log.warn('[锚点] identity_anchors 提炼失败', { character_id: characterId, error: err.message });
  }
}

async function processCharacterGeneration(db, cfg, log, taskID, req) {
  const operation = taskService.ensureTaskOperation(taskID);
  const { signal } = operation;
  const ensureTaskActive = () => {
    try {
      taskService.throwIfTaskInactive(db, taskID, signal);
      return true;
    } catch (err) {
      if (err?.code === 'OPERATION_CANCELLED' || signal.aborted) return false;
      throw err;
    }
  };
  if (!ensureTaskActive()) return;
  taskService.updateTaskStatus(db, taskID, 'processing', 0, '正在生成角色...');
  if (!ensureTaskActive()) return;
  let outlineText = req.outline || '';

  // 读取剧的 style 和 metadata.aspect_ratio，覆盖全局 cfg
  let effectiveCfg = cfg;
  const dramaRow = db.prepare('SELECT id, title, description, genre, style, metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(Number(req.drama_id));
  if (!dramaRow) {
    taskService.updateTaskStatus(db, taskID, 'failed', 0, '剧本信息不存在');
    return;
  }
  try {
    let next = { ...cfg, style: { ...(cfg?.style || {}) } };
    if (dramaRow.metadata) {
      const meta = typeof dramaRow.metadata === 'string' ? JSON.parse(dramaRow.metadata) : dramaRow.metadata;
      if (meta && meta.aspect_ratio) {
        next.style.default_image_ratio = meta.aspect_ratio;
      }
    }
    effectiveCfg = mergeCfgStyleWithDrama(next, dramaRow);
  } catch (_) {}

  if (!outlineText) {
    outlineText = promptI18n.formatUserPrompt(
      effectiveCfg,
      'drama_info_template',
      dramaRow.title || '',
      dramaRow.description || '',
      dramaRow.genre || ''
    );
  }
  const userPrompt = promptI18n.formatUserPrompt(effectiveCfg, 'character_request', outlineText);
  const systemPrompt = promptI18n.getCharacterExtractionPrompt(effectiveCfg);
  const temperature = req.temperature != null ? req.temperature : 0.7;

  // 固定 6000 tokens：足够约 10-12 个角色（每角色约 400-500 tokens）
  // repairTruncatedJsonArray 兜底处理极端截断情况
  const maxTokensForChars = 6000;

  let text;
  try {
    text = await aiClient.generateText(db, log, 'text', userPrompt, systemPrompt, {
      scene_key: 'role_extraction',
      model: req.model || undefined,
      temperature,
      max_tokens: maxTokensForChars,
      signal,
    });
  } catch (err) {
    if (err?.code === 'OPERATION_CANCELLED' || signal.aborted) return;
    log.error('Character generation AI failed', { error: err.message, task_id: taskID });
    taskService.updateTaskStatus(db, taskID, 'failed', 0, 'AI生成失败: ' + err.message);
    return;
  }
  if (!ensureTaskActive()) return;

  log.info('[角色生成] AI 返回已接收', { response_length: String(text || '').length });

  let result;
  try {
    const parsed = safeParseAIJSON(text, null, log);
    result = extractFirstArray(parsed) || [];
  } catch (err) {
    if (err?.code === 'OPERATION_CANCELLED' || signal.aborted) return;
    log.error('Character generation parse failed', { error: err.message, task_id: taskID });
    log.error('[角色生成] JSON 解析失败', { response_length: String(text || '').length });
    taskService.updateTaskStatus(db, taskID, 'failed', 0, '解析AI返回结果失败');
    return;
  }

  const dramaId = Number(req.drama_id);
  const now = new Date().toISOString();
  const characters = [];
  const anchorJobs = [];
  try {
    taskService.runTaskMutation(db, taskID, signal, () => {
      // 再次从剧本提取角色时，角色替换、分集关联和任务完成必须原子提交。
      if (req.episode_id) {
        const episodeId = Number(req.episode_id);
        const linkedRows = db.prepare('SELECT character_id FROM episode_characters WHERE episode_id = ?').all(episodeId);
        for (const row of linkedRows) {
          const cid = Number(row.character_id);
          const other = db
            .prepare('SELECT COUNT(*) AS n FROM episode_characters WHERE character_id = ? AND episode_id != ?')
            .get(cid, episodeId);
          if (other && other.n === 0) {
            db.prepare('UPDATE characters SET deleted_at = ? WHERE id = ? AND drama_id = ? AND deleted_at IS NULL')
              .run(now, cid, dramaId);
          }
        }
        db.prepare('DELETE FROM episode_characters WHERE episode_id = ?').run(episodeId);
      }

      for (const char of result) {
        const name = (char.name || '').trim();
        if (!name) continue;
        const existing = db.prepare(
          'SELECT id, name FROM characters WHERE drama_id = ? AND name = ? AND deleted_at IS NULL'
        ).get(dramaId, name);
        if (existing) {
          characters.push({
            id: existing.id, drama_id: dramaId, name: existing.name, role: null, description: null,
            personality: null, appearance: null, voice_style: null,
          });
          continue;
        }
        const info = db.prepare(
          `INSERT INTO characters (drama_id, name, role, description, personality, appearance, voice_style, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
        ).run(
          dramaId, name, char.role ?? null, char.description ?? null, char.personality ?? null,
          char.appearance ?? null, char.voice_style ?? null, now, now
        );
        const newCharId = info.lastInsertRowid;
        characters.push({
          id: newCharId, drama_id: dramaId, name, role: char.role ?? null,
          description: char.description ?? null, personality: char.personality ?? null,
          appearance: char.appearance ?? null, voice_style: char.voice_style ?? null,
        });
        if (char.appearance) anchorJobs.push({ characterId: newCharId, appearance: char.appearance });
      }

      if (req.episode_id && characters.length > 0) {
        const insertLink = db.prepare(
          'INSERT OR IGNORE INTO episode_characters (episode_id, character_id) VALUES (?, ?)'
        );
        for (const character of characters) insertLink.run(Number(req.episode_id), character.id);
      }

      if (!taskService.updateTaskResult(db, taskID, { characters, count: characters.length })) {
        taskService.throwIfTaskInactive(db, taskID, signal);
        throw new Error('角色生成任务无法提交完成状态');
      }
    });
  } catch (err) {
    if (err?.code === 'OPERATION_CANCELLED' || signal.aborted) return;
    throw err;
  }

  // 仅在业务事务提交成功后启动派生任务，避免取消或回滚后产生迟到副作用。
  for (const job of anchorJobs) {
    scheduleLegacyAsync(log, 'character_anchor_prompt_prefill', () => {
      enrichIdentityAnchors(db, log, job.characterId, job.appearance).catch(() => {});
      characterLibraryService.generateCharacterPromptOnly(
        db, log, effectiveCfg, job.characterId, undefined, undefined
      ).catch((err) => {
        log.warn('[提取角色] 预生成polished_prompt失败', { character_id: job.characterId, error: err.message });
      });
    }, { character_id: job.characterId, drama_id: dramaId });
  }
  log.info('Character generation completed', { task_id: taskID, drama_id: req.drama_id, character_count: characters.length });
}

function generateCharacters(db, cfg, log, req) {
  const dramaId = String(req.drama_id || '');
  if (!dramaId) throw new Error('drama_id 必填');
  if (req.episode_id != null && String(req.episode_id).trim() !== '') {
    const episode = db.prepare(
      'SELECT drama_id FROM episodes WHERE id = ? AND deleted_at IS NULL'
    ).get(Number(req.episode_id));
    if (!episode || Number(episode.drama_id) !== Number(req.drama_id)) {
      const error = new Error('episode_id must belong to drama_id');
      error.code = 'BAD_REQUEST';
      throw error;
    }
  }
  const task = taskService.createTask(db, log, 'character_generation', dramaId);
  scheduleLegacyAsync(log, 'character_generation', () => {
    processCharacterGeneration(db, cfg, log, task.id, {
      drama_id: req.drama_id,
      episode_id: req.episode_id,
      outline: req.outline,
      temperature: req.temperature,
      model: req.model,
    }).catch((err) => {
      log.error('processCharacterGeneration fatal', { error: err.message, task_id: task.id });
    });
  }, { task_id: task.id, drama_id: dramaId });
  return task.id;
}

module.exports = {
  generateCharacters,
  enrichIdentityAnchors,
};
