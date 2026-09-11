'use strict';

// 与 Go application/services/frame_prompt_service.go 对齐：生成首帧/关键帧/尾帧/分镜板/动作序列提示词
const loadConfig = require('../config').loadConfig;
const promptI18n = require('./promptI18n');
const aiClient = require('./aiClient');
const taskService = require('./taskService');
const { scheduleLegacyAsync } = require('./legacyAsyncSchedulerService');
const { safeParseAIJSON } = require('../utils/safeJson');
const storyboardService = require('./storyboardService');
const {
  parseNamesFromAnchorLines,
  sanitizeFramePrompt,
} = require('../utils/framePromptSanitize');
const { toUserFacingProcessError } = require('./providerErrorSanitizer');
const { FRAME_PROMPT_MESSAGES, frameKindDescription } = require('./framePromptErrors');
const {
  assertSupportedFrameType,
  assertStoryboardExists,
  loadLayoutNeighborStoryboards,
} = require('./framePromptScope');
const {
  expandAngleDescription,
  loadStoryboard,
  buildCharacterAnchorText,
  loadStoryboardCharacterNames,
  loadDramaCharacterNamesForStoryboard,
  loadScene,
  buildStoryboardContext,
  buildFallbackPrompt,
  applyDramaStyleToConfig,
  buildLayoutRegenerationUserPrompt,
  normalizeGeneratedLayoutDescription,
} = require('./framePromptAssembly');

function waitForTaskWork(work, signal) {
  if (!signal) return Promise.resolve(work);
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback) => (value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      callback(value);
    };
    const onAbort = finish(reject);
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(work).then(finish(resolve), finish(reject));
  });
}

function taskWasCancelled(signal, error) {
  return signal?.aborted || error?.code === 'OPERATION_CANCELLED' || error?.name === 'AbortError';
}

function parseFramePromptJSON(log, aiResponse) {
  try {
    const data = safeParseAIJSON(aiResponse, {}, log);
    if (data && typeof data.prompt === 'string') {
      return { prompt: data.prompt, description: data.description || '' };
    }
  } catch (e) {
    log.warn('Frame prompt JSON parse failed', {
      error: e.message,
      response_chars: String(aiResponse || '').length,
    });
  }
  return null;
}

function saveFramePrompt(db, log, storyboardId, frameType, prompt, description, layout) {
  const now = new Date().toISOString();
  db.prepare('DELETE FROM frame_prompts WHERE storyboard_id = ? AND frame_type = ?').run(Number(storyboardId), frameType);
  db.prepare(
    `INSERT INTO frame_prompts (storyboard_id, frame_type, prompt, description, layout, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(Number(storyboardId), frameType, prompt, description ?? null, layout ?? null, now, now);
  log.info('Frame prompt saved', { storyboard_id: storyboardId, frame_type: frameType });
}

async function generateSingleFrame(db, log, cfg, sb, scene, characterNames, model, frameKind, sanitizeOpts = {}) {
  const context = buildStoryboardContext(cfg, sb, scene, characterNames);
  const allowedCharNames = parseNamesFromAnchorLines(characterNames);
  const allDramaNames = sanitizeOpts.allDramaNames || allowedCharNames;
  const systemKey = frameKind === 'first' ? 'getFirstFramePrompt' : frameKind === 'key' ? 'getKeyFramePrompt' : 'getLastFramePrompt';
  const userKey = frameKind === 'first' ? 'frame_info' : frameKind === 'key' ? 'key_frame_info' : 'last_frame_info';
  const systemPrompt = promptI18n[systemKey](cfg);
  const userPrompt = promptI18n.formatUserPrompt(cfg, userKey, context);

  // ── 调试日志：打印完整提示词，方便确认角度/视角是否正确注入 ──
  log.info('[帧提示词] ===== generateSingleFrame DEBUG =====', {
    frame_kind: frameKind,
    storyboard_id: sb?.id,
    angle: sb?.angle,
    shot_type: sb?.shot_type,
    movement: sb?.movement,
  });
  log.info('[帧提示词] CONTEXT (角色/场景/角度上下文):\n' + context);
  log.info('[帧提示词] SYSTEM PROMPT:\n' + systemPrompt);
  log.info('[帧提示词] USER PROMPT:\n' + userPrompt);
  log.info('[帧提示词] ==========================================');

  let aiResponse;
  try {
    aiResponse = await waitForTaskWork(aiClient.generateText(db, log, 'text', userPrompt, systemPrompt, {
      model: model || undefined,
      max_tokens: 2400,
      signal: sanitizeOpts.signal,
    }), sanitizeOpts.signal);
  } catch (err) {
    if (taskWasCancelled(sanitizeOpts.signal, err)) throw err;
    log.warn('Frame prompt AI failed, using fallback', { error: err.message });
    return {
      prompt: buildFallbackPrompt(cfg, scene, frameKind),
      description: frameKindDescription(frameKind),
    };
  }
  log.info('[帧提示词] AI RAW RESPONSE:\n' + (aiResponse || '(empty)'));
  const parsed = parseFramePromptJSON(log, aiResponse);
  if (parsed) {
    const cleanedPrompt = sanitizeFramePrompt(parsed.prompt, allowedCharNames, allDramaNames, {
      log,
      source: 'frame_prompt_generation',
      storyboard_id: sb?.id,
      frame_kind: frameKind,
    });
    log.info('[帧提示词] PARSED RESULT prompt:\n' + cleanedPrompt);
    return { ...parsed, prompt: cleanedPrompt };
  }
  const fallback = buildFallbackPrompt(cfg, scene, frameKind);
  log.warn('[帧提示词] JSON 解析失败，使用 FALLBACK prompt:\n' + fallback);
  return {
    prompt: fallback,
    description: frameKindDescription(frameKind),
  };
}

async function generatePanelPrompts(db, log, cfg, sb, scene, characterNames, model, panelCount, sanitizeOpts) {
  const count = panelCount || 3;
  const layout = `horizontal_${count}`;
  const prompts = [];
  if (count === 3) {
    const first = await generateSingleFrame(db, log, cfg, sb, scene, characterNames, model, 'first', sanitizeOpts);
    const key = await generateSingleFrame(db, log, cfg, sb, scene, characterNames, model, 'key', sanitizeOpts);
    const last = await generateSingleFrame(db, log, cfg, sb, scene, characterNames, model, 'last', sanitizeOpts);
    prompts.push(first.prompt, key.prompt, last.prompt);
  } else if (count === 4) {
    const first = await generateSingleFrame(db, log, cfg, sb, scene, characterNames, model, 'first', sanitizeOpts);
    const key1 = await generateSingleFrame(db, log, cfg, sb, scene, characterNames, model, 'key', sanitizeOpts);
    const key2 = await generateSingleFrame(db, log, cfg, sb, scene, characterNames, model, 'key', sanitizeOpts);
    const last = await generateSingleFrame(db, log, cfg, sb, scene, characterNames, model, 'last', sanitizeOpts);
    prompts.push(first.prompt, key1.prompt, key2.prompt, last.prompt);
  } else {
    prompts.push((await generateSingleFrame(db, log, cfg, sb, scene, characterNames, model, 'first', sanitizeOpts)).prompt);
    for (let i = 0; i < count - 2; i++) {
      prompts.push((await generateSingleFrame(db, log, cfg, sb, scene, characterNames, model, 'key', sanitizeOpts)).prompt);
    }
    prompts.push((await generateSingleFrame(db, log, cfg, sb, scene, characterNames, model, 'last', sanitizeOpts)).prompt);
  }
  return {
    combinedPrompt: prompts.join('\n---\n'),
    description: FRAME_PROMPT_MESSAGES.PANEL_DESC,
    layout,
  };
}

async function generateActionPrompts(db, log, cfg, sb, scene, characterNames, model, sanitizeOpts) {
  const first = await generateSingleFrame(db, log, cfg, sb, scene, characterNames, model, 'first', sanitizeOpts);
  const key1 = await generateSingleFrame(db, log, cfg, sb, scene, characterNames, model, 'key', sanitizeOpts);
  const key2 = await generateSingleFrame(db, log, cfg, sb, scene, characterNames, model, 'key', sanitizeOpts);
  const key3 = await generateSingleFrame(db, log, cfg, sb, scene, characterNames, model, 'key', sanitizeOpts);
  const last = await generateSingleFrame(db, log, cfg, sb, scene, characterNames, model, 'last', sanitizeOpts);
  return {
    combinedPrompt: [first.prompt, key1.prompt, key2.prompt, key3.prompt, last.prompt].join('\n---\n'),
    description: FRAME_PROMPT_MESSAGES.ACTION_DESC,
    layout: 'horizontal_5',
  };
}

async function processFramePromptGeneration(db, log, taskId, storyboardId, frameType, panelCount, model) {
  const signal = taskService.ensureTaskOperation(taskId).signal;
  taskService.throwIfTaskInactive(db, taskId, signal);
  let cfg = loadConfig();
  taskService.updateTaskStatus(db, taskId, 'processing', 0, FRAME_PROMPT_MESSAGES.GENERATING);

  const sb = loadStoryboard(db, storyboardId);
  if (!sb) {
    taskService.updateTaskError(db, taskId, FRAME_PROMPT_MESSAGES.STORYBOARD_INFO_NOT_FOUND);
    log.error('Frame prompt: storyboard not found', { storyboard_id: storyboardId });
    return;
  }

  // 通过 storyboard → episode → drama 链路读取项目 style 和 aspect_ratio
  try {
    cfg = applyDramaStyleToConfig(db, cfg, storyboardId);
  } catch (_) {}

  const scene = loadScene(db, sb.scene_id);
  const characterNames = loadStoryboardCharacterNames(db, storyboardId);
  const allDramaNames = loadDramaCharacterNamesForStoryboard(db, storyboardId);
  const sanitizeOpts = { allDramaNames, signal };

  // 强调试日志：确认角色视觉锚点是否成功加载（用于排查“黑发扎马尾”等脑补问题）
  log.info('[帧提示词] 角色视觉锚点加载结果', {
    storyboard_id: storyboardId,
    character_count: characterNames.length,
    characters_preview: characterNames.length ? characterNames.map((c) => c.substring(0, 120) + (c.length > 120 ? '...' : '')).join(' | ') : '(无关联角色或加载失败)',
  });

  const storyboardIdStr = String(storyboardId);
  let combinedPrompt = '';
  let description = '';
  let layout = '';

  try {
    if (frameType === 'first' || frameType === 'key' || frameType === 'last') {
      const single = await generateSingleFrame(db, log, cfg, sb, scene, characterNames, model, frameType, sanitizeOpts);
      combinedPrompt = single.prompt;
      description = single.description;
    } else if (frameType === 'panel') {
      const panel = await generatePanelPrompts(db, log, cfg, sb, scene, characterNames, model, panelCount, sanitizeOpts);
      combinedPrompt = panel.combinedPrompt;
      description = panel.description;
      layout = panel.layout;
    } else if (frameType === 'action') {
      const action = await generateActionPrompts(db, log, cfg, sb, scene, characterNames, model, sanitizeOpts);
      combinedPrompt = action.combinedPrompt;
      description = action.description;
      layout = action.layout;
    } else {
      taskService.updateTaskError(db, taskId, FRAME_PROMPT_MESSAGES.UNSUPPORTED_FRAME_TYPE_SHORT);
      log.error('Frame prompt: unsupported frame_type', { frame_type: frameType });
      return;
    }

    taskService.runTaskMutation(db, taskId, signal, () => {
      saveFramePrompt(db, log, storyboardId, frameType, combinedPrompt, description, layout);
      taskService.updateTaskResult(db, taskId, {
        storyboard_id: storyboardIdStr,
        frame_type: frameType,
        response: { frame_type: frameType, single_frame: combinedPrompt ? { prompt: combinedPrompt, description } : undefined, layout: layout || undefined },
      });
    });
    log.info('Frame prompt generation completed', { task_id: taskId, storyboard_id: storyboardId, frame_type: frameType });
  } catch (err) {
    if (taskWasCancelled(signal, err)) {
      log.info('Frame prompt generation cancelled; skipping late writes', { task_id: taskId, storyboard_id: storyboardId });
      return;
    }
    log.error('Frame prompt generation error', { task_id: taskId, error: err.message });
    taskService.updateTaskError(db, taskId, toUserFacingProcessError(err, FRAME_PROMPT_MESSAGES.GENERATE_FAILED));
  }
}

function generateFramePrompt(db, log, storyboardId, frameType, panelCount, model) {
  assertStoryboardExists(db, storyboardId);
  assertSupportedFrameType(frameType);
  const task = taskService.createTask(db, log, 'frame_prompt_generation', String(storyboardId));
  scheduleLegacyAsync(log, 'frame_prompt_generation', () => {
    processFramePromptGeneration(db, log, task.id, storyboardId, frameType, panelCount || 0, model);
  }, { task_id: task.id, storyboard_id: storyboardId, frame_type: frameType });
  log.info('Frame prompt task created', { task_id: task.id, storyboard_id: storyboardId, frame_type: frameType });
  return task.id;
}

/**
 * 一键重新生成/优化单个分镜的 layout_description（空间布局合同）
 * 自动参考上下分镜，保证前后连贯性
 * @returns {string} 新的 layout_description 文本
 */
async function regenerateLayoutDescription(db, log, storyboardId) {
  const sid = Number(storyboardId);
  const sb = db.prepare('SELECT * FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(sid);
  if (!sb) throw new Error(FRAME_PROMPT_MESSAGES.STORYBOARD_NOT_FOUND);

  // 取前后分镜（用于连贯性）：必须按 episode_id 取同一集，不能把 storyboard_id 当成剧集键
  const { prev: prevSb, next: nextSb } = loadLayoutNeighborStoryboards(db, sb.episode_id, sb.storyboard_number);

  // 角色信息（用于站位描述）
  const characterNames = loadStoryboardCharacterNames(db, sid);

  const cfg = require('../config').loadConfig();
  const systemPrompt = promptI18n.getRegenerateLayoutDescriptionPrompt(cfg);
  const userPrompt = buildLayoutRegenerationUserPrompt(sb, characterNames, prevSb, nextSb);

  log.info('[布局重生成] 开始', { storyboard_id: sid, has_prev: !!prevSb, has_next: !!nextSb });

  const raw = await aiClient.generateText(db, log, 'text', userPrompt, systemPrompt, {
    max_tokens: 300,
    temperature: 0.35,
  });

  const newLayout = normalizeGeneratedLayoutDescription(raw);
  if (!newLayout || newLayout.length < 8) {
    throw new Error(FRAME_PROMPT_MESSAGES.LAYOUT_TOO_SHORT);
  }

  const now = new Date().toISOString();
  db.prepare('UPDATE storyboards SET layout_description = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
    .run(newLayout, now, sid);

  log.info('[布局重生成] 完成', { storyboard_id: sid, new_layout_preview: newLayout.slice(0, 80) });

  return newLayout;
}

module.exports = {
  generateFramePrompt,
  processFramePromptGeneration,
  saveFramePrompt,
  loadStoryboard,
  loadStoryboardCharacterNames,
  loadDramaCharacterNamesForStoryboard,
  loadScene,
  buildCharacterAnchorText,
  getFramePrompts: (db, storyboardId) => storyboardService.getFramePrompts(db, storyboardId),
  generateSingleFrameExported: generateSingleFrame,
  expandAngleDescription,
  regenerateLayoutDescription,
};