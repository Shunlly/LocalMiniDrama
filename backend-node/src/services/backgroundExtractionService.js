// 与 Go ImageGenerationService.ExtractBackgroundsForEpisode + processBackgroundExtraction 对齐
const taskService = require('./taskService');
const aiClient = require('./aiClient');
const promptI18n = require('./promptI18n');
const sceneService = require('./sceneService');
const { scheduleLegacyAsync } = require('./legacyAsyncSchedulerService');
const { safeParseAIJSON, extractFirstArray } = require('../utils/safeJson');

function waitForTaskSignal(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) {
    const error = new Error('操作已取消');
    error.name = 'AbortError';
    error.code = 'OPERATION_CANCELLED';
    return Promise.reject(error);
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      const error = new Error('操作已取消');
      error.name = 'AbortError';
      error.code = 'OPERATION_CANCELLED';
      reject(error);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

function normalizeLanguage(language) {
  const lang = (language || '').toString().trim().toLowerCase();
  return lang === 'zh' || lang === 'en' ? lang : '';
}

function hasChinese(text) {
  return /[\u4e00-\u9fff]/.test(text || '');
}

function withLanguage(cfg, language) {
  if (!language) return cfg;
  return {
    ...cfg,
    app: { ...(cfg?.app || {}), language },
  };
}

async function translatePromptToChinese(db, log, model, prompt, signal) {
  const userPrompt =
    '请将以下场景图像提示词翻译为中文，保留风格词或比例（如 realistic、16:9）原样，直接返回翻译后的中文提示词，不要解释：\n' +
    prompt;
  const text = await waitForTaskSignal(
    aiClient.generateText(db, log, 'text', userPrompt, '', {
      scene_key: 'scene_extraction',
      model: model || undefined,
      temperature: 0.2,
      max_tokens: 400,
      signal,
    }),
    signal,
  );
  return (text || '').toString().trim();
}

async function extractBackgroundsFromScript(db, cfg, log, scriptContent, dramaId, model, style, signal) {
  if (!scriptContent || !scriptContent.trim()) return [];
  const systemPrompt = promptI18n.getSceneExtractionPrompt(cfg, style);
  const prompt = (promptI18n.getLanguage(cfg) === 'en' ? '[Script Content]\n' : '【剧本内容】\n') + scriptContent;
  log.info('Background extraction prompt prepared', {
    system_prompt_length: String(systemPrompt || '').length,
    prompt_length: String(prompt || '').length,
  });
  const text = await waitForTaskSignal(
    aiClient.generateText(db, log, 'text', prompt, systemPrompt, {
      scene_key: 'scene_extraction',
      model: model || undefined,
      temperature: 0.7,
      signal,
    }),
    signal,
  );
  let list = [];
  try {
    const parsed = safeParseAIJSON(text, null, log);
    list = extractFirstArray(parsed) || [];
  } catch (_) {
    list = [];
  }
  return list.map((b) => ({
    location: b.location || '',
    time: b.time || '',
    prompt: b.prompt || '',
    atmosphere: b.atmosphere,
  }));
}

async function processBackgroundExtraction(db, cfg, log, taskID, episodeId, model, style, language) {
  const signal = taskService.ensureTaskOperation(taskID).signal;
  taskService.updateTaskStatus(db, taskID, 'processing', 0, '正在提取场景信息...');
  const episode = db.prepare('SELECT id, drama_id, script_content FROM episodes WHERE id = ? AND deleted_at IS NULL').get(Number(episodeId));
  if (!episode) {
    taskService.updateTaskStatus(db, taskID, 'failed', 0, '剧集信息不存在');
    return;
  }
  const scriptContent = episode.script_content;
  if (!scriptContent || !String(scriptContent).trim()) {
    taskService.updateTaskStatus(db, taskID, 'failed', 0, '剧本内容为空');
    return;
  }

  // 合并风格：显式 style 参数优先（一般为前端传来的英文 prompt）；否则用剧集 metadata 中的完整提示词
  let effectiveCfg = cfg;
  try {
    const dramaRow = db.prepare('SELECT style, metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(episode.drama_id);
    const { mergeCfgStyleWithDrama } = require('../utils/dramaStyleMerge');
    const paramStyle = (style && String(style).trim()) || '';
    let next = { ...cfg, style: { ...(cfg?.style || {}) } };
    if (dramaRow?.metadata) {
      const meta = typeof dramaRow.metadata === 'string' ? JSON.parse(dramaRow.metadata) : dramaRow.metadata;
      if (meta?.aspect_ratio) next.style.default_image_ratio = meta.aspect_ratio;
    }
    if (paramStyle) {
      next.style = {
        ...next.style,
        default_style_zh: paramStyle,
        default_style_en: paramStyle,
        default_style: paramStyle,
      };
      effectiveCfg = next;
    } else {
      effectiveCfg = mergeCfgStyleWithDrama(next, dramaRow);
    }
    style = paramStyle || effectiveCfg?.style?.default_style_en || effectiveCfg?.style?.default_style || style;
  } catch (_) {}

  const requestedLanguage = normalizeLanguage(language);
  const configuredLanguage = normalizeLanguage(promptI18n.getLanguage(effectiveCfg));
  let effectiveLanguage = requestedLanguage || configuredLanguage;
  if (!requestedLanguage && effectiveLanguage === 'en' && hasChinese(scriptContent)) {
    effectiveLanguage = 'zh';
  }
  const cfgForPrompt = withLanguage(effectiveCfg, effectiveLanguage);
  let backgroundsInfo;
  try {
    backgroundsInfo = await extractBackgroundsFromScript(
      db,
      cfgForPrompt,  // 已包含 effectiveCfg + language
      log,
      String(scriptContent),
      episode.drama_id,
      model,
      style,  // 作为 prompt 追加（extractBackgroundsFromScript 内部会用到）
      signal
    );
  } catch (err) {
    if (err?.code === 'OPERATION_CANCELLED' || signal.aborted) return;
    log.error('Background extraction AI failed', { error: err.message, task_id: taskID });
    taskService.updateTaskStatus(db, taskID, 'failed', 0, 'AI提取场景失败: ' + err.message);
    return;
  }
  if (effectiveLanguage === 'zh') {
    const translated = await Promise.all(
      (backgroundsInfo || []).map(async (bg) => {
        const original = (bg.prompt || '').toString().trim();
        if (!original || hasChinese(original)) return bg;
        try {
          const translatedPrompt = await translatePromptToChinese(db, log, model, original, signal);
          if (!translatedPrompt) return bg;
          return { ...bg, prompt: translatedPrompt };
        } catch (err) {
          log.warn('Background prompt translate failed', { error: err.message, task_id: taskID });
          return bg;
        }
      })
    );
    backgroundsInfo = translated;
  }
  let scenes;
  try {
    scenes = taskService.runTaskMutation(db, taskID, signal, () => {
      sceneService.deleteScenesByEpisodeId(db, log, episodeId);
      const persisted = [];
      for (const bg of backgroundsInfo) {
        const scene = sceneService.createSceneForEpisode(db, log, episode.drama_id, episodeId, {
          location: bg.location,
          time: bg.time,
          prompt: bg.prompt,
        });
        if (scene) persisted.push(scene);
      }
      taskService.updateTaskResult(db, taskID, {
        scenes: persisted,
        count: persisted.length,
        episode_id: episodeId,
        drama_id: episode.drama_id,
      });
      return persisted;
    });
  } catch (err) {
    if (err?.code === 'OPERATION_CANCELLED' || signal.aborted) return;
    throw err;
  }

  // 仅在主事务提交后安排提示词预生成，避免回滚后仍访问不存在的场景。
  if (effectiveCfg) {
    const capturedStyle = style;
    for (const scene of scenes) {
      scheduleLegacyAsync(log, 'scene_prompt_prefill', () => {
        sceneService.generateScenePromptOnly(db, log, effectiveCfg, scene.id, undefined, capturedStyle).catch((err) => {
          log.warn('[提取场景] 预生成polished_prompt失败', { scene_id: scene.id, error: err.message });
        });
      }, { scene_id: scene.id, episode_id: episodeId });
    }
  }
  log.info('Background extraction completed', { task_id: taskID, episode_id: episodeId, count: scenes.length });
}

function extractBackgroundsForEpisode(db, cfg, log, episodeId, model, style, language) {
  const episode = db.prepare('SELECT id, drama_id, script_content FROM episodes WHERE id = ? AND deleted_at IS NULL').get(Number(episodeId));
  if (!episode) throw new Error('剧集不存在，无法提取场景');
  if (!episode.script_content || !String(episode.script_content).trim()) {
    throw new Error('剧集剧本内容为空，无法提取场景');
  }
  // 读取项目的 aspect_ratio，覆盖全局 cfg 中的 default_image_ratio，使 promptI18n 生成正确比例的提示词
  let runCfg = cfg;
  if (episode.drama_id) {
    try {
      const dramaRow = db.prepare('SELECT metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(episode.drama_id);
      if (dramaRow && dramaRow.metadata) {
        const meta = typeof dramaRow.metadata === 'string' ? JSON.parse(dramaRow.metadata) : dramaRow.metadata;
        if (meta && meta.aspect_ratio) {
          runCfg = { ...cfg, style: { ...(cfg?.style || {}), default_image_ratio: meta.aspect_ratio } };
        }
      }
    } catch (_) {}
  }
  const existing = db.prepare(
    `SELECT id FROM async_tasks
     WHERE resource_id = ? AND type = 'background_extraction'
       AND status IN ('pending', 'processing') AND deleted_at IS NULL
     ORDER BY created_at DESC LIMIT 1`
  ).get(String(episodeId));
  if (existing) {
    log.info('Background extraction already running', { task_id: existing.id, episode_id: episodeId });
    return existing.id;
  }

  const task = taskService.createTask(db, log, 'background_extraction', String(episodeId));
  scheduleLegacyAsync(log, 'background_extraction', () => {
    processBackgroundExtraction(db, runCfg, log, task.id, episodeId, model, style, language).catch((err) => {
      log.error('processBackgroundExtraction fatal', { error: err.message, task_id: task.id });
      taskService.updateTaskError(db, task.id, err.message || '场景提取失败');
    });
  }, { task_id: task.id, episode_id: episodeId });
  return task.id;
}

module.exports = {
  extractBackgroundsForEpisode,
};
