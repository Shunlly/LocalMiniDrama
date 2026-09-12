/**
 * 分镜图提示词二次优化与连戏快照暂存。
 * 路由仍通过 imageService 调用，本模块不改变公开 API。
 * 优化结果只暂存，成功提交前不写库。
 */

const aiClient = require('./aiClient');
const promptI18n = require('./promptI18n');
const { imageTaskCancelled } = require('./imageServicePipeline');

/**
 * 单帧分镜 prompt 文本优化。失败时回退原始 prompt。
 */
async function polishStoryboardImagePrompt(db, log, {
  row,
  imageGenId,
  cfg,
  signal,
  elapsed,
  reference_context_note,
}) {
  let stagedPolishedPrompt = null;
  let stagedContinuitySnapshot = null;
// ── Step 3.5: 分镜 prompt 文本AI二次优化（单帧分镜；优先用 image_polish 模型，无则 fallback 默认文本模型）──
let finalPrompt = row.prompt;
const isSingleStoryboard = row.storyboard_id && row.frame_type !== 'quad_grid' && row.frame_type !== 'nine_grid';
if (isSingleStoryboard && row.prompt) {
  try {
    // 若分镜已有 polished_prompt（手动编辑或上次优化结果），直接使用，不再重复调 AI
    // 但**首帧/尾帧/关键帧专用提示词优先**：这些是用户通过“生成首/尾帧提示词”+“生成图片”流程明确批准的干净 prompt，
    // 不能被通用的 storyboards.polished_prompt（可能来自旧的整体润色，含错误服装描述）覆盖。
    let alreadyPolished = false;
    const isFrameSpecial = row.frame_type && ['first', 'last', 'key', 'storyboard_first', 'storyboard_last'].includes(String(row.frame_type));
    if (row.storyboard_id && !isFrameSpecial) {
      const sbPolished = db.prepare(
        'SELECT polished_prompt FROM storyboards WHERE id = ? AND deleted_at IS NULL'
      ).get(Number(row.storyboard_id));
      if (sbPolished?.polished_prompt?.trim().length > 10) {
        finalPrompt = sbPolished.polished_prompt.trim();
        alreadyPolished = true;
        log.info('[图生] Step3.5 已有 polished_prompt，跳过重复优化', { id: imageGenId, len: finalPrompt.length, elapsed: elapsed() });
      }
    } else if (isFrameSpecial) {
      log.info('[图生] Step3.5 首/尾/关键帧专用提示词优先，忽略 storyboards.polished_prompt', { id: imageGenId, frame_type: row.frame_type, elapsed: elapsed() });
    }
    const skipAIPolishForFrame = isFrameSpecial;

    // 只要系统中有任意可用的文本模型配置，均执行优化（image_polish 专用映射为可选增强）
    const anyTextConfig = !alreadyPolished && !skipAIPolishForFrame && db.prepare(
      "SELECT id FROM ai_service_configs WHERE service_type = 'text' AND deleted_at IS NULL LIMIT 1"
    ).get();
    if (anyTextConfig) {
      log.info('[图生] Step3.5 文本AI优化 prompt 开始', { id: imageGenId, elapsed: elapsed() });
      const rawSt = (cfg?.style?.default_style_en || cfg?.style?.default_style || '').toString().trim();
      const styleZh = (cfg?.style?.default_style_zh || '').toString().trim();
      const style = rawSt || styleZh || 'cinematic movie still, anamorphic lens, film grain, dramatic lighting, shallow depth of field, professional cinematography';
      const styleBlockLines = [];
      if (styleZh) styleBlockLines.push(`【画风·最高优先级】${styleZh}`);
      if (rawSt && rawSt !== styleZh) styleBlockLines.push(`MANDATORY ART STYLE: ${rawSt}.`);
      else if (rawSt && !styleZh) styleBlockLines.push(`MANDATORY ART STYLE: ${rawSt}.`);
      else if (!styleZh && !rawSt) styleBlockLines.push(`MANDATORY ART STYLE: ${style}.`);
      const assetNames = (reference_context_note || '').split('\n')
        .map((l) => l.replace(/^Image \d+: [^"]*"([^"]+)".*/, '$1'))
        .filter(Boolean).join(', ');

      // 获取分镜详细字段（action / dialogue / result / atmosphere / shot_type）
      let sbDetail = null;
      try {
        sbDetail = db.prepare(
          'SELECT action, dialogue, result, atmosphere, shot_type, episode_id, storyboard_number FROM storyboards WHERE id = ? AND deleted_at IS NULL'
        ).get(Number(row.storyboard_id));
      } catch (_) {}

      // 查询前后镜头，用于连续性控制
      let prevDesc = '(first shot)';
      let nextDesc = '(last shot)';
      let prevContinuityState = null; // 上一镜头的连戏状态快照
      if (sbDetail?.episode_id != null && sbDetail?.storyboard_number != null) {
        try {
          const prevShot = db.prepare(
            'SELECT action, location, time, continuity_snapshot FROM storyboards WHERE episode_id = ? AND storyboard_number < ? AND deleted_at IS NULL ORDER BY storyboard_number DESC LIMIT 1'
          ).get(sbDetail.episode_id, sbDetail.storyboard_number);
          const nextShot = db.prepare(
            'SELECT action, location, time FROM storyboards WHERE episode_id = ? AND storyboard_number > ? AND deleted_at IS NULL ORDER BY storyboard_number ASC LIMIT 1'
          ).get(sbDetail.episode_id, sbDetail.storyboard_number);
          if (prevShot) {
            prevDesc = (prevShot.action || [prevShot.location, prevShot.time].filter(Boolean).join(' ')).slice(0, 120).trim() || '(first shot)';
            if (prevShot.continuity_snapshot) {
              try { prevContinuityState = JSON.parse(prevShot.continuity_snapshot); } catch (_) {}
            }
          }
          if (nextShot) {
            nextDesc = (nextShot.action || [nextShot.location, nextShot.time].filter(Boolean).join(' ')).slice(0, 120).trim() || '(last shot)';
          }
        } catch (_) {}
      }

      const userPromptLines = [
        ...styleBlockLines,
        `PROMPT: ${row.prompt}`,
        sbDetail?.action     ? `ACTION: ${sbDetail.action}`        : null,
        sbDetail?.dialogue   ? `DIALOGUE: ${sbDetail.dialogue}`    : null,
        sbDetail?.result     ? `RESULT: ${sbDetail.result}`        : null,
        sbDetail?.atmosphere ? `ATMOSPHERE: ${sbDetail.atmosphere}`: null,
        sbDetail?.shot_type  ? `SHOT_TYPE: ${sbDetail.shot_type}`  : null,
        `STYLE_TOKENS (repeat in output): ${style}`,
        `ASSETS: ${assetNames || 'none'}`,
        prevContinuityState  ? `PREV_CONTINUITY_STATE: ${JSON.stringify(prevContinuityState)}` : null,
        `CONTEXT_PREV: ${prevDesc}`,
        `CONTEXT_NEXT: ${nextDesc}`,
        `REMINDER: Output a STATIC SINGLE-FRAME image prompt only. No camera motion, no transitions, no split panels.`,
      ].filter(Boolean);
      const userPrompt = userPromptLines.join('\n');
      const systemPrompt = promptI18n.getImagePolishPrompt(cfg);
      const polishedPrompt = await aiClient.generateText(db, log, 'text', userPrompt, systemPrompt, {
        scene_key: 'image_polish',
        max_tokens: 300,
        temperature: 0.3,
        signal,
      });
      if (polishedPrompt && polishedPrompt.trim().length > 10) {
        finalPrompt = polishedPrompt.trim();
        stagedPolishedPrompt = finalPrompt;
        log.info('[图生] Step3.5 prompt 优化完成', {
          id: imageGenId,
          original_len: row.prompt.length,
          polished_len: finalPrompt.length,
          has_prev_continuity: !!prevContinuityState,
          prev_ctx: prevDesc.slice(0, 60),
          next_ctx: nextDesc.slice(0, 60),
          preview: finalPrompt.slice(0, 100),
          elapsed: elapsed(),
        });

        // 连戏快照先暂存，和最终图片绑定在同一事务中提交，避免取消留下半成品。
        if (row.storyboard_id) {
          const snapshotPrompt = promptI18n.getContinuitySnapshotPrompt();
          const snapshotUserPrompt = [`PROMPT: ${finalPrompt}`, `ASSETS: ${assetNames || 'none'}`].join('\n');
          try {
            const snapshotJson = await aiClient.generateText(db, log, 'text', snapshotUserPrompt, snapshotPrompt, {
              scene_key: 'image_polish',
              max_tokens: 200,
              temperature: 0.1,
              signal,
            });
            if (snapshotJson?.trim()) {
              const cleaned = snapshotJson.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
              try {
                JSON.parse(cleaned);
                stagedContinuitySnapshot = cleaned;
                log.info('[图生] Step3.5 连戏快照已暂存', { id: imageGenId, storyboard_id: row.storyboard_id });
              } catch (_) {
                log.warn('[图生] Step3.5 连戏快照 JSON 解析失败，跳过', { id: imageGenId, preview: cleaned.slice(0, 100) });
              }
            }
          } catch (snapshotError) {
            if (imageTaskCancelled(snapshotError, signal)) throw snapshotError;
            log.warn('[图生] Step3.5 连戏快照生成失败，跳过', { id: imageGenId, error: snapshotError.message });
          }
        }
      }
    }
  } catch (polishErr) {
    if (imageTaskCancelled(polishErr, signal)) throw polishErr;
    log.warn('[图生] Step3.5 prompt 优化失败，使用原始 prompt', { id: imageGenId, error: polishErr.message });
  }
}
  return {
    finalPrompt,
    isSingleStoryboard,
    stagedPolishedPrompt,
    stagedContinuitySnapshot,
  };
}

module.exports = {
  polishStoryboardImagePrompt,
};
