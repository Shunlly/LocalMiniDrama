/**
 * 分集分镜生成处理：模型调用、流式增量解析、截断续写，并在任务事务中保存结果。
 * 任务创建与提示词拼装见 episodeStoryboardProcess.js。
 */

const taskService = require('./taskService');
const aiClient = require('./aiClient');
const { syncStoryboardCharacters } = require('./imageService');
const safeJson = require('../utils/safeJson');
const { safeParseAIJSON, extractFirstArray } = safeJson;
const { toUserFacingProcessError } = require('./providerErrorSanitizer');
const { normalizeStoryboardShotNumber } = require('./episodeStoryboardOrdering');
const {
  isMaxTokensParamError,
  collectIncrementalStoryboards,
  buildContinuationPrompt,
} = require('./episodeStoryboardGeneration');
const { saveStoryboards } = require('./episodeStoryboardSave');

/**
 * 分镜专用 generateText 包装：
 * 1. 默认携带 max_tokens:16384，让模型输出更长，减少截断续写次数。
 * 2. 若 API 立即返回参数错误（HTTP 4xx，且错误体提到 max_tokens/length/token），
 *    自动降级为不传 max_tokens 重试一次。
 * 3. 所有尝试均记录日志。
 */
const DEFAULT_STORYBOARD_MAX_TOKENS = 16384;

async function generateTextForStoryboard(db, log, userPrompt, systemPrompt, options = {}) {
  const { model, streamCallback, temperature = 0.7, signal } = options;

  // 第一次尝试：带 max_tokens:16384
  log.info('Storyboard generateText attempt 1', { model: model || '(default)', max_tokens: DEFAULT_STORYBOARD_MAX_TOKENS });
  try {
    const text = await aiClient.generateText(db, log, 'text', userPrompt, systemPrompt, {
      scene_key: 'storyboard_extraction',
      model: model || undefined,
      temperature,
      max_tokens: DEFAULT_STORYBOARD_MAX_TOKENS,
      streamCallback,
      signal,
    });
    return text;
  } catch (e) {
    if (isMaxTokensParamError(e.message)) {
      log.warn('Storyboard generateText: max_tokens rejected by model, retrying without it', {
        model: model || '(default)',
        error: e.message.slice(0, 200),
      });
      // 第二次尝试：不传 max_tokens，让模型用自己默认值
      log.info('Storyboard generateText attempt 2 (no max_tokens)', { model: model || '(default)' });
      const text = await aiClient.generateText(db, log, 'text', userPrompt, systemPrompt, {
        scene_key: 'storyboard_extraction',
        model: model || undefined,
        temperature,
        streamCallback,
        signal,
      });
      log.info('Storyboard generateText attempt 2 succeeded');
      return text;
    }
    // 其他错误直接抛出
    throw e;
  }
}

const _SB_PROMPT_LOG_CHUNK = 14000;

/**
 * 调试：完整打印分镜 system / user 提示词（可能很长，按块写入日志）。
 * 启动后端前设置环境变量：DEBUG_STORYBOARD_PROMPTS=1
 */
function logDebugStoryboardPrompts(log, tag, userPrompt, systemPrompt) {
  const on = String(process.env.DEBUG_STORYBOARD_PROMPTS || '').trim();
  if (on !== '1' && on.toLowerCase() !== 'true') return;
  const sp = systemPrompt != null ? String(systemPrompt) : '';
  const up = userPrompt != null ? String(userPrompt) : '';
  log.info(`[StoryboardPrompt:${tag}] system_prompt_bytes=${sp.length} user_prompt_bytes=${up.length}`);
  for (let i = 0; i < sp.length; i += _SB_PROMPT_LOG_CHUNK) {
    log.info(`[StoryboardPrompt:${tag}] system_part_${Math.floor(i / _SB_PROMPT_LOG_CHUNK) + 1}\n${sp.slice(i, i + _SB_PROMPT_LOG_CHUNK)}`);
  }
  for (let i = 0; i < up.length; i += _SB_PROMPT_LOG_CHUNK) {
    log.info(`[StoryboardPrompt:${tag}] user_part_${Math.floor(i / _SB_PROMPT_LOG_CHUNK) + 1}\n${up.slice(i, i + _SB_PROMPT_LOG_CHUNK)}`);
  }
}

async function processStoryboardGeneration(db, log, cfg, taskId, episodeId, model, style, userPrompt, systemPrompt, includeNarration, universalOmni, targetClipDurationSec = null) {
  const signal = taskService.ensureTaskOperation(taskId).signal;
  // 流式片段只保存在内存中，最终与任务终态一起原子落库。
  const episodeIdNum = Number(episodeId);
  const streamRecoveredByNumber = new Map();
  const deriveOpts = {
    universalOmni: !!universalOmni,
    targetClipDuration: targetClipDurationSec != null && Number(targetClipDurationSec) > 0 ? Number(targetClipDurationSec) : null,
  };
  let streamThrottle = 0;

  try {
    taskService.updateTaskStatus(db, taskId, 'processing', 10, '开始生成分镜头...');
    log.info('Processing storyboard generation', { task_id: taskId, episode_id: episodeId });
    log.info('Storyboard prompt preview', {
      user_prompt_len: userPrompt ? userPrompt.length : 0,
      system_prompt_len: systemPrompt ? systemPrompt.length : 0,
      user_prompt_head: userPrompt ? userPrompt.slice(0, 200) : '',
    });
    logDebugStoryboardPrompts(log, `task-${taskId}-initial`, userPrompt, systemPrompt);

    // 不使用 json_mode：response_format:json_object 要求返回 JSON 对象而非数组，会导致模型包装成
    // {"storyboards":[...]} 或产生乱码 key，改由 extractFirstArray 统一处理任意包装格式。
    const text = await generateTextForStoryboard(db, log, userPrompt, systemPrompt, {
      model: model || undefined,
      signal,
      // 每积累约 400 字符触发一次增量解析，尝试提前保存已完成的分镜
      streamCallback: (accumulated) => {
        if (accumulated.length - streamThrottle < 400) return;
        streamThrottle = accumulated.length;
        taskService.throwIfTaskInactive(db, taskId, signal);
        const newCount = collectIncrementalStoryboards(accumulated, streamRecoveredByNumber);
        if (newCount > 0) {
          log.info('Storyboard incremental parse', { episode_id: episodeIdNum, new_count: newCount, total_parsed: streamRecoveredByNumber.size });
          taskService.updateTaskStatus(db, taskId, 'processing', 30,
            `已解析 ${streamRecoveredByNumber.size} 个分镜，生成中...`);
        }
      },
    });

    taskService.updateTaskStatus(db, taskId, 'processing', 50, '分镜头生成完成，正在解析结果...');

    log.info('AI raw response received', {
      task_id: taskId,
      text_type: typeof text,
      text_length: text ? String(text).length : 0,
      text_preview: text ? String(text).slice(0, 2000) : '(empty)',
    });

    let storyboards = [];
    const parseMeta = {};
    try {
      const parsed = safeParseAIJSON(text, null, log, parseMeta);
      storyboards = extractFirstArray(parsed) || [];
    } catch (e) {
      log.error('Parse storyboard JSON failed', {
        error: e.message,
        task_id: taskId,
        text_type: typeof text,
        text_length: text ? String(text).length : 0,
        raw_text: text ? String(text).slice(0, 2000) : '(empty)',
      });

      // 解析失败时，若流式增量保存已有部分分镜，视为截断的部分成功
      if (streamRecoveredByNumber.size > 0) {
        const partialBoards = [...streamRecoveredByNumber.values()];
        if (partialBoards.length > 0) {
          const totalDuration = partialBoards.reduce((s, sb) => s + (Number(sb.duration) || 0), 0);
          log.warn('Parse failed but partial storyboards already saved incrementally, treating as truncated success', {
            task_id: taskId, recovered_count: partialBoards.length, parse_error: e.message,
          });
          storyboards = partialBoards;
          parseMeta.truncated = true;
          parseMeta.error_message = `AI 输出含 JSON 格式缺陷，已恢复 ${partialBoards.length} 个分镜`;
        }
      }
      if (storyboards.length === 0) {
        taskService.updateTaskError(db, taskId, toUserFacingProcessError(e, '解析分镜头结果失败'));
        return;
      }
    }

    if (storyboards.length === 0) {
      // 最终解析为空，但流式已保存了内容，同样回退使用增量结果
      if (streamRecoveredByNumber.size > 0) {
        const partialBoards = [...streamRecoveredByNumber.values()];
        if (partialBoards.length > 0) {
          log.warn('Final parse returned 0 items but incremental saves exist, using those', {
            task_id: taskId, recovered_count: partialBoards.length,
          });
          storyboards = partialBoards;
          parseMeta.truncated = true;
        }
      }
      if (storyboards.length === 0) {
        log.error('AI returned 0 storyboards', { task_id: taskId });
        taskService.updateTaskError(db, taskId, 'AI生成分镜失败：返回的分镜数量为0');
        return;
      }
    }

    if (parseMeta.truncated) {
      log.warn('Storyboard JSON was truncated by AI (max_tokens limit), will attempt continuation', {
        task_id: taskId, episode_id: episodeId,
        rescued_count: storyboards.length,
        raw_text_length: text ? String(text).length : 0,
      });
    }
    log.info('Storyboard initial parse', { task_id: taskId, episode_id: episodeId, count: storyboards.length, truncated: parseMeta.truncated || false });

    // ── 自动续写：若 AI 输出被截断，最多续写 3 次直到完整 ──────────────────
    const MAX_CONTINUATION = 3;
    let contAttempt = 0;
    while (parseMeta.truncated && storyboards.length > 0 && contAttempt < MAX_CONTINUATION) {
      contAttempt++;
      const lastShot = Math.max(...storyboards.map(s => Number(s.shot_number ?? s.storyboard_number) || 0));
      log.info('Storyboard continuation start', { task_id: taskId, attempt: contAttempt, last_shot: lastShot, current_count: storyboards.length });
      taskService.updateTaskStatus(db, taskId, 'processing', 50 + contAttempt * 5,
        `已生成 ${storyboards.length} 个分镜，正在续写剩余部分（第${contAttempt}次）...`);

      const contPrompt = buildContinuationPrompt(userPrompt, storyboards, lastShot, contAttempt, !!includeNarration, !!universalOmni);
      logDebugStoryboardPrompts(log, `task-${taskId}-continuation-${contAttempt}`, contPrompt, systemPrompt);
      streamThrottle = 0; // 重置节流，让续写段落也能增量保存

      // 等待 3 秒后再发续写请求：避免流式请求刚结束服务端连接未释放导致 "socket hang up"
      await new Promise(r => setTimeout(r, 3000));
      taskService.throwIfTaskInactive(db, taskId, signal);

      let contText;
      try {
        contText = await generateTextForStoryboard(db, log, contPrompt, systemPrompt, {
          model: model || undefined,
          signal,
          streamCallback: (accumulated) => {
            if (accumulated.length - streamThrottle < 400) return;
            streamThrottle = accumulated.length;
            taskService.throwIfTaskInactive(db, taskId, signal);
            collectIncrementalStoryboards(accumulated, streamRecoveredByNumber);
          },
        });
      } catch (e) {
        log.warn('Continuation request failed', { task_id: taskId, attempt: contAttempt, error: e.message });
        break;
      }

      const contMeta = {};
      let contItems = [];
      try {
        const contParsed = safeParseAIJSON(contText, null, log, contMeta);
        contItems = extractFirstArray(contParsed) || [];
      } catch (e) {
        log.warn('Continuation parse failed', { task_id: taskId, attempt: contAttempt, error: e.message });
        break;
      }

      if (contItems.length === 0) {
        log.warn('Continuation returned 0 items', { task_id: taskId, attempt: contAttempt });
        break;
      }

      // 按 shot_number 去重，防止 AI 重复已生成的分镜
      const existingNums = new Set(storyboards.map((s) => normalizeStoryboardShotNumber(s)));
      const newItems = contItems.filter((s) => !existingNums.has(normalizeStoryboardShotNumber(s)));
      if (newItems.length === 0) {
        log.warn('Continuation returned only duplicate items', { task_id: taskId, attempt: contAttempt });
        break;
      }

      storyboards = [...storyboards, ...newItems];
      parseMeta.truncated = contMeta.truncated || false;
      log.info('Storyboard continuation done', {
        task_id: taskId, attempt: contAttempt,
        new_items: newItems.length, total_count: storyboards.length, still_truncated: parseMeta.truncated,
      });
    }
    // ── 续写结束 ────────────────────────────────────────────────────────────

    const totalDuration = storyboards.reduce((sum, sb) => sum + (Number(sb.duration) || 0), 0);
    if (parseMeta.truncated) {
      log.warn('Storyboard still truncated after max continuations', {
        task_id: taskId, final_count: storyboards.length, continuation_attempts: contAttempt,
      });
    }
    log.info('Storyboard generated', { task_id: taskId, episode_id: episodeId, count: storyboards.length, total_duration_seconds: totalDuration, truncated: parseMeta.truncated || false, continuation_attempts: contAttempt });

    taskService.updateTaskStatus(db, taskId, 'processing', 70, '正在保存分镜头...');

    const durationMinutes = Math.ceil((totalDuration + 59) / 60);
    const { saved, totalCharAdded } = taskService.runTaskMutation(db, taskId, signal, () => {
      const persisted = saveStoryboards(db, log, episodeId, storyboards, cfg, style, null, deriveOpts);
      let addedCount = 0;
      for (const sb of persisted) {
        if (!sb?.id) continue;
        const { added } = syncStoryboardCharacters(db, log, sb.id);
        addedCount += added.length;
      }
      db.prepare('UPDATE episodes SET duration = ?, updated_at = ? WHERE id = ?')
        .run(durationMinutes, new Date().toISOString(), Number(episodeId));
      taskService.updateTaskResult(db, taskId, {
        storyboards: persisted,
        total: persisted.length,
        total_duration: totalDuration,
        duration_minutes: durationMinutes,
        truncated: parseMeta.truncated || false,
        ...(parseMeta.error_message ? { error_message: parseMeta.error_message } : {}),
      });
      return { saved: persisted, totalCharAdded: addedCount };
    });
    if (totalCharAdded > 0) log.info('[分镜] 角色补全完成', { episode_id: episodeId, total_added: totalCharAdded });
    log.info('Episode duration updated', { episode_id: episodeId, duration_seconds: totalDuration, duration_minutes: durationMinutes });
    log.info('Storyboard generation completed', { task_id: taskId, episode_id: episodeId });
  } catch (err) {
    log.error('Storyboard generation failed', { error: err.message, task_id: taskId });
    if (err?.code === 'OPERATION_CANCELLED' || signal.aborted) return;

    // 若连接中断但内存中已有完整分镜，原子保存部分结果。
    if (streamRecoveredByNumber.size > 0) {
      try {
        const partialBoards = [...streamRecoveredByNumber.values()];
        if (partialBoards.length > 0) {
          const totalDuration = partialBoards.reduce((s, sb) => s + (Number(sb.duration) || 0), 0);
          log.warn('Partial storyboards recovered after error, treating as truncated success', {
            task_id: taskId, recovered_count: partialBoards.length, error: err.message,
          });
          taskService.runTaskMutation(db, taskId, signal, () => {
            const saved = saveStoryboards(db, log, episodeId, partialBoards, cfg, style, null, deriveOpts);
            const durationMinutes = Math.ceil((totalDuration + 59) / 60);
            db.prepare('UPDATE episodes SET duration = ?, updated_at = ? WHERE id = ?')
              .run(durationMinutes, new Date().toISOString(), episodeIdNum);
            taskService.updateTaskResult(db, taskId, {
              storyboards: saved,
              total: saved.length,
              total_duration: totalDuration,
              duration_minutes: durationMinutes,
              truncated: true,
              error_message: `连接中断，已恢复 ${saved.length} 个分镜`,
            });
          });
          return;
        }
      } catch (_) {}
    }

    taskService.updateTaskError(db, taskId, toUserFacingProcessError(err, '生成分镜头失败，请稍后重试'));
  }
}

module.exports = {
  generateTextForStoryboard,
  processStoryboardGeneration,
};
