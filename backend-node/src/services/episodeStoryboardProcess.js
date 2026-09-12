/**
 * 分集分镜生成编排：创建任务、拼装提示词，并调度后台处理。
 * 模型调用、解析/续写与落库见 episodeStoryboardProcessGenerate.js。
 */

const taskService = require('./taskService');
const promptI18n = require('./promptI18n');
const loadConfig = require('../config').loadConfig;
const dramaWriteGuard = require('./dramaWriteGuard');
const { scheduleLegacyAsync } = require('./legacyAsyncSchedulerService');
const {
  resolveStoryboardShotDurationPlan,
} = require('./episodeStoryboardGeneration');
const {
  generateTextForStoryboard,
  processStoryboardGeneration,
} = require('./episodeStoryboardProcessGenerate');

function generateStoryboard(db, log, episodeId, model, style, storyboardCount, videoDuration, aspectRatio, includeNarration, universalOmni) {
  const cfg = loadConfig();
  dramaWriteGuard.assertEpisodeWritable(db, episodeId);
  const episode = db.prepare(
    'SELECT id, script_content, description, drama_id FROM episodes WHERE id = ? AND deleted_at IS NULL'
  ).get(Number(episodeId));
  if (!episode) {
    throw new Error('剧集不存在或无权限访问');
  }

  // 获取剧集风格和比例（如果未指定，则从 drama metadata / style 中获取完整提示词）
  const drama = db.prepare('SELECT style, metadata FROM dramas WHERE id = ?').get(episode.drama_id);
  const { resolvedStreamStyleFromDrama } = require('../utils/dramaStyleMerge');
  const finalStyle = resolvedStreamStyleFromDrama(style, drama);

  // 图片比例 + 每镜时长：优先用传入值，再从 drama.metadata 读，最后兜底全局配置
  let dramaAspectRatio = null;
  let videoClipDuration = null;
  try {
    if (drama && drama.metadata) {
      const meta = typeof drama.metadata === 'string' ? JSON.parse(drama.metadata) : drama.metadata;
      if (meta && meta.aspect_ratio) dramaAspectRatio = meta.aspect_ratio;
      if (meta && meta.video_clip_duration) videoClipDuration = Number(meta.video_clip_duration) || null;
    }
  } catch (_) {}
  const imageRatio = aspectRatio || dramaAspectRatio || cfg?.style?.default_video_ratio || '16:9';

  const { impliedFromTotal, effectiveShotDuration } = resolveStoryboardShotDurationPlan(
    videoClipDuration,
    videoDuration,
    storyboardCount
  );

  let scriptContent = (episode.script_content && String(episode.script_content).trim())
    ? String(episode.script_content)
    : (episode.description && String(episode.description).trim())
      ? String(episode.description)
      : '';
  if (!scriptContent) {
    throw new Error('当前集还没有剧本，请先编写或导入剧本');
  }

  const characters = db.prepare(
    'SELECT id, name FROM characters WHERE drama_id = ? AND deleted_at IS NULL ORDER BY name ASC'
  ).all(episode.drama_id);
  let characterList = '无角色';
  if (characters.length > 0) {
    characterList = '[' + characters.map((c) => `{"id": ${c.id}, "name": "${(c.name || '').replace(/"/g, '\\"')}"}`).join(', ') + ']';
  }

  const scenes = db.prepare(
    'SELECT id, location, time FROM scenes WHERE drama_id = ? AND deleted_at IS NULL ORDER BY location ASC, time ASC'
  ).all(episode.drama_id);
  let sceneList = '无场景';
  if (scenes.length > 0) {
    sceneList = '[' + scenes.map((s) => `{"id": ${s.id}, "location": "${(s.location || '').replace(/"/g, '\\"')}", "time": "${(s.time || '').replace(/"/g, '\\"')}"}`).join(', ') + ']';
  }

  const props = db.prepare(
    'SELECT id, name, type FROM props WHERE drama_id = ? AND deleted_at IS NULL ORDER BY id ASC'
  ).all(episode.drama_id);
  let propList = '无道具';
  if (props.length > 0) {
    propList = '[' + props.map((p) => `{"id": ${p.id}, "name": "${(p.name || '').replace(/"/g, '\\"')}"${p.type ? `, "type": "${p.type.replace(/"/g, '\\"')}"` : ''}}`).join(', ') + ']';
  }

  const scriptLabel = promptI18n.formatUserPrompt(cfg, 'script_content_label');
  const taskLabel = promptI18n.formatUserPrompt(cfg, 'task_label');
  const taskInstruction = promptI18n.formatUserPrompt(cfg, 'task_instruction');
  
  // 处理分镜数量和时长约束
  let extraConstraint = '';
  // 宽松判断：只要有值（包括字符串形式的数字），就尝试转换并添加约束
  if (storyboardCount) {
    const countVal = Number(storyboardCount);
    if (Number.isFinite(countVal) && countVal > 0) {
      const countLabel = promptI18n.formatUserPrompt(cfg, 'storyboard_count_constraint', countVal);
      if (countLabel) extraConstraint += `\n${countLabel}`;
    }
  }
  if (videoDuration) {
    const durationVal = Number(videoDuration);
    if (Number.isFinite(durationVal) && durationVal > 0) {
      const durationLabel = promptI18n.formatUserPrompt(cfg, 'video_duration_constraint', durationVal);
      if (durationLabel) extraConstraint += `\n${durationLabel}`;
    }
  }
  // 当同时指定总时长和数量时，补充单镜 duration 说明（与项目「每段秒数」一致时勿用总÷镜压短）
  if (storyboardCount && videoDuration && effectiveShotDuration) {
    const isEn = promptI18n.isEnglish(cfg);
    const clipFromProject = videoClipDuration && Number(videoClipDuration) > 0;
    const implied =
      impliedFromTotal && impliedFromTotal > 0 ? impliedFromTotal : Math.round(Number(videoDuration) / Number(storyboardCount));
    if (clipFromProject) {
      const clip = Number(videoClipDuration);
      if (isEn) {
        extraConstraint += `\nEach shot "duration" field: prioritize **~${clip}s per shot** (project clip-length setting); ±1s OK. Total ~${Number(videoDuration)}s and ~${Number(storyboardCount)} shots are overall planning hints—do NOT force every shot to ~${implied}s (total÷count) when it conflicts with the project clip length.`;
      } else {
        extraConstraint += `\n每个镜头的 **duration** 请优先按项目「每段约 **${clip} 秒**」填写（可 ±1 秒微调）。全片总时长约 ${Number(videoDuration)} 秒、镜头数约 ${Number(storyboardCount)} 为整体规划参考，**禁止**为机械凑「总时长÷镜数」（约 ${implied}s）而把每镜普遍写成过短镜头；除非该镜对白与动作为实需的极短镜头。`;
      }
    } else if (isEn) {
      extraConstraint += `\nEach shot target duration: approximately ${effectiveShotDuration}s (= total ${Number(videoDuration)}s ÷ ${Number(storyboardCount)} shots). Set each shot's duration field to this value, adjusting ±1s for dialogue/action length.`;
    } else {
      extraConstraint += `\n每镜头目标时长：约 ${effectiveShotDuration} 秒（= 总时长 ${Number(videoDuration)}s ÷ ${Number(storyboardCount)} 个镜头）。每个镜头的 duration 字段请设为此值，可根据对话/动作长短适当调整 ±1 秒。`;
    }
  }

  log.info('Storyboard generation params', {
    storyboard_count: storyboardCount,
    video_duration: videoDuration,
    video_clip_duration: videoClipDuration,
    effective_shot_duration: effectiveShotDuration,
  });

  const charListLabel = promptI18n.formatUserPrompt(cfg, 'character_list_label');
  const charConstraint = promptI18n.formatUserPrompt(cfg, 'character_constraint');
  const sceneListLabel = promptI18n.formatUserPrompt(cfg, 'scene_list_label');
  const sceneConstraint = promptI18n.formatUserPrompt(cfg, 'scene_constraint');
  const propListLabel = promptI18n.formatUserPrompt(cfg, 'prop_list_label');
  const propConstraint = promptI18n.formatUserPrompt(cfg, 'prop_constraint');
  const suffix = promptI18n.getStoryboardUserPromptSuffix(cfg, effectiveShotDuration);

  let userPrompt =
    `${scriptLabel}\n${scriptContent}\n\n${taskLabel}\n${taskInstruction}${extraConstraint}\n\n${charListLabel}\n${characterList}\n\n${charConstraint}\n\n${sceneListLabel}\n${sceneList}\n\n${sceneConstraint}\n\n${propListLabel}\n${propList}\n\n${propConstraint}\n\n${suffix}`;

  const wantNarration = includeNarration === true || includeNarration === 1 || String(includeNarration).toLowerCase() === 'true';
  if (wantNarration) {
    userPrompt += promptI18n.getStoryboardNarrationExtraInstructions(cfg);
  }

  let systemPrompt = promptI18n.getStoryboardSystemPrompt(cfg);

  // 当用户指定了分镜数量时，在系统提示词后追加最高优先级覆盖指令，
  // 使"目标数量"优先于默认的"一动作一镜头、禁止合并"原则
  if (storyboardCount && Number(storyboardCount) > 0) {
    const targetCount = Number(storyboardCount);
    const isEn = systemPrompt.includes('[Role]');
    if (isEn) {
      systemPrompt += `\n\n[HIGHEST PRIORITY — USER SPECIFIED COUNT]
The user requires exactly ${targetCount} shots (±10% tolerance is acceptable).
This requirement OVERRIDES the "one action = one shot, no merging" rule above.
You MUST merge related consecutive actions into fewer shots OR split key moments into more shots to reach this target.
Do NOT produce a shot count far from ${targetCount} under any circumstance.`;
    } else {
      systemPrompt += `\n\n【最高优先级——用户指定分镜数量】
用户要求生成恰好 ${targetCount} 个分镜（允许 ±10% 的偏差，即 ${Math.floor(targetCount * 0.9)}~${Math.ceil(targetCount * 1.1)} 个均可接受）。
此要求优先级高于上述所有原则，包括"一动作一镜头、禁止合并"的规则。
- 若动作较多、自然拆分超过目标数量，请将相关联的连续小动作合并为一个镜头
- 若动作较少、自然拆分不足目标数量，请将重要场景或情绪转折拆分为多个镜头
- 严禁生成数量与 ${targetCount} 相差悬殊的分镜方案`;
    }
  }

  if (wantNarration) {
    const isEn = systemPrompt.includes('[Role]');
    if (isEn) {
      systemPrompt += `\n\n[HIGHEST PRIORITY — NARRATION / VO MODE]
The user enabled narrator voice-over for the whole episode. Every shot object MUST include non-empty "narration" (≥1 sentence). Shot 1 MUST have an opening VO hook (time/place/mood). Shots 1 and 2 MUST NOT both have empty narration. Empty "narration" is NOT allowed in this mode.`;
    } else {
      systemPrompt += `\n\n【最高优先级——解说旁白已开启】
用户已开启全片解说：每个分镜的 narration 必须为非空字符串（至少一句）。第 1 镜必须有开场解说。第 1、2 镜禁止同时留空 narration。本模式下不允许 narration 为空。`;
    }
  }

  const wantUniversalOmni =
    universalOmni === true ||
    universalOmni === 1 ||
    String(universalOmni || '').toLowerCase() === 'true';
  if (wantUniversalOmni) {
    systemPrompt += promptI18n.getStoryboardUniversalOmniModeSuffix(cfg);
  }

  const task = taskService.createTask(db, log, 'storyboard_generation', String(episodeId));
  log.info('Generating storyboard asynchronously', {
    task_id: task.id,
    episode_id: episodeId,
    drama_id: episode.drama_id,
    script_length: scriptContent.length,
    character_count: characters.length,
    scene_count: scenes.length,
    storyboard_count: storyboardCount,
    video_duration: videoDuration,
    universal_omni_storyboard: wantUniversalOmni,
  });

  scheduleLegacyAsync(log, 'storyboard_generation', () => {
    // 传入 imageRatio 同时覆盖 default_video_ratio 和 default_image_ratio，
    // 确保分镜图/视频提示词、场景提取提示词都使用项目设定的比例
    const runCfg = { ...cfg, style: { ...(cfg?.style || {}), default_video_ratio: imageRatio, default_image_ratio: imageRatio } };
    // 如果 model 为 null，则传 undefined，让 generateText 内部去兜底找默认配置
    const clipSec =
      videoClipDuration && Number(videoClipDuration) > 0 ? Number(videoClipDuration) : null;
    processStoryboardGeneration(
      db,
      log,
      runCfg,
      task.id,
      String(episodeId),
      model || undefined,
      finalStyle,
      userPrompt,
      systemPrompt,
      wantNarration,
      wantUniversalOmni,
      clipSec
    );
  }, { task_id: task.id, episode_id: episodeId });

  return { task_id: task.id, status: 'pending', message: '分镜生成任务已创建，正在后台处理...' };
}

module.exports = {
  generateTextForStoryboard,
  processStoryboardGeneration,
  generateStoryboard,
};
