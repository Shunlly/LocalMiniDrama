// 场景生成与全景：提示词拼装、四视图/单图生成、全景图与从图提取描述。
// CRUD 与风格覆盖见 sceneService.js；本模块能力仍由 sceneService 再导出。
const imageClient = require('./imageClient');
const imageService = require('./imageService');
const aiClient = require('./aiClient');
const promptI18n = require('./promptI18n');
const uploadService = require('./uploadService');
const { mergeCfgStyleWithDrama } = require('../utils/dramaStyleMerge');
const { toUserFacingProcessError, toVisionExtractUserError } = require('./providerErrorSanitizer');
const {
  canReadResource,
  runResourceWrite,
} = require('./dramaWriteGuard');

// 不导出：若随本模块 assign 回 sceneService，会覆盖原实现并递归。
function applySceneStyleOverride(cfg, styleOverride) {
  return require('./sceneService').applySceneStyleOverride(cfg, styleOverride);
}

/**
 * 将文字AI的四视图描述 + 布局指令 + 风格 合并为完整的图片AI提示词
 * 与角色的 buildFourViewImagePrompt 对应（画风置顶 + 尾部重申）
 */
function buildSceneFourViewImagePrompt(fourViewDescription, styleEn, styleZh) {
  const imageLayoutInstruction = promptI18n.getSceneGenerateImagePrompt();
  const zh = (styleZh || '').trim();
  const en = (styleEn || '').trim();

  const styleLines = [];
  if (zh) styleLines.push(`【画风·最高优先级】四格统一：${zh}`);
  if (en && en !== zh) styleLines.push(`MANDATORY ART STYLE (all 4 panels): ${en}.`);
  else if (en && !zh) styleLines.push(`MANDATORY ART STYLE (all 4 panels): ${en}.`);
  const styleHeader = styleLines.length ? `${styleLines.join('\n')}\n\n` : '';

  const tailParts = [];
  if (zh || en) tailParts.push(`Reiterate: same art style as above (${en || zh}). No people, no text.`);
  const tail = tailParts.length ? `\n\n---\n\n${tailParts.join(' ')}` : '';

  return `${styleHeader}${imageLayoutInstruction}\n\n---\n\n${fourViewDescription}${tail}`;
}

/**
 * 将文字AI的单图场景描述 + 布局指令 + 风格 合并为完整的图片AI提示词
 */
function buildSceneSingleImagePrompt(description, styleEn, styleZh) {
  const imageLayoutInstruction = promptI18n.getSceneGenerateSingleImagePrompt();
  const zh = (styleZh || '').trim();
  const en = (styleEn || '').trim();

  const styleLines = [];
  if (zh) styleLines.push(`【画风·最高优先级】${zh}`);
  if (en && en !== zh) styleLines.push(`MANDATORY ART STYLE: ${en}.`);
  else if (en && !zh) styleLines.push(`MANDATORY ART STYLE: ${en}.`);
  const styleHeader = styleLines.length ? `${styleLines.join('\n')}\n\n` : '';

  const tailParts = [];
  if (zh || en) tailParts.push(`Reiterate: same art style as above (${en || zh}). No people, no text.`);
  const tail = tailParts.length ? `\n\n---\n\n${tailParts.join(' ')}` : '';

  return `${styleHeader}${imageLayoutInstruction}\n\n---\n\n${description}${tail}`;
}

/**
 * 仅生成（并保存）场景四视图完整图片提示词到 scenes.polished_prompt，不触发图片生成。
 * 与角色的 generateCharacterPromptOnly 对应：
 *   Step 1: 文字AI将 location/time/prompt(原始描述) → fourViewDescription
 *   Step 2: 拼接布局指令 + fourViewDescription + 硬性要求 → polished_prompt（完整英文图片提示词）
 * 供「提取场景后异步预生成」和「重新生成提示词」按钮调用。
 */
async function generateScenePromptOnly(db, log, cfg, sceneId, modelName, style) {
  const sceneRow = db.prepare(
    'SELECT id, drama_id, location, time, prompt FROM scenes WHERE id = ? AND deleted_at IS NULL'
  ).get(Number(sceneId));
  if (!sceneRow || !canReadResource(db, 'scenes', sceneId)) return { ok: false, error: '场景不存在' };

  const dramaFull = db.prepare('SELECT id, style, metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(sceneRow.drama_id);
  let mergedCfg = mergeCfgStyleWithDrama(cfg, dramaFull || {});
  mergedCfg = applySceneStyleOverride(mergedCfg, style);

  const location = (sceneRow.location || '').trim();
  const time = (sceneRow.time || '').trim();
  const rawPrompt = (sceneRow.prompt || '').trim();
  const fourViewCfg = mergedCfg;

  // 构建文字AI输入（location + time + 原始描述）
  const sceneDesc = [
    location ? `场景地点：${location}` : '',
    time ? `时间/时段：${time}` : '',
    rawPrompt ? `场景描述：${rawPrompt}` : '',
  ].filter(Boolean).join('\n') || location || '未知场景';

  const systemPrompt = promptI18n.getScenePolishPrompt(fourViewCfg);
  const userPrompt = `请根据以下场景信息，生成四格场景参考图的提示词：\n\n${sceneDesc}`;

  log.info('[场景提示词] Step1 开始生成四视图描述', { scene_id: sceneId, location, time });

  let fourViewDescription;
  try {
    fourViewDescription = await aiClient.generateText(db, log, 'text', userPrompt, systemPrompt, {
      model: modelName || undefined,
      max_tokens: 4000,
    });
  } catch (err) {
    log.error('[场景提示词] 文字AI失败', { error: err.message });
    return { ok: false, error: toUserFacingProcessError(err, '生成场景提示词失败，请稍后重试') };
  }

  if (!fourViewDescription || !fourViewDescription.trim()) {
    return { ok: false, error: 'AI返回内容为空' };
  }

  const styleEn = (mergedCfg.style.default_style_en || mergedCfg.style.default_style || '').trim();
  const styleZh = (mergedCfg.style.default_style_zh || '').trim();
  const polishedPrompt = buildSceneFourViewImagePrompt(fourViewDescription.trim(), styleEn, styleZh);

  runResourceWrite(db, 'scenes', sceneId, () => db.prepare(
    'UPDATE scenes SET polished_prompt = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
  ).run(polishedPrompt, new Date().toISOString(), Number(sceneId)));
  log.info('[场景提示词] 生成并保存完成', { scene_id: sceneId, length: polishedPrompt.length });
  return { ok: true, polished_prompt: polishedPrompt };
}

/**
 * 仅生成（并保存）场景单图完整图片提示词到 scenes.polished_prompt_single，不触发图片生成。
 * 与 generateScenePromptOnly 对应（四视图版本）。
 */
async function generateSceneSinglePromptOnly(db, log, cfg, sceneId, modelName, style) {
  const sceneRow = db.prepare(
    'SELECT id, drama_id, location, time, prompt FROM scenes WHERE id = ? AND deleted_at IS NULL'
  ).get(Number(sceneId));
  if (!sceneRow || !canReadResource(db, 'scenes', sceneId)) return { ok: false, error: '场景不存在' };

  const dramaFull = db.prepare('SELECT id, style, metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(sceneRow.drama_id);
  let mergedCfg = mergeCfgStyleWithDrama(cfg, dramaFull || {});
  mergedCfg = applySceneStyleOverride(mergedCfg, style);

  const location = (sceneRow.location || '').trim();
  const time = (sceneRow.time || '').trim();
  const rawPrompt = (sceneRow.prompt || '').trim();

  const sceneDesc = [
    location ? `场景地点：${location}` : '',
    time ? `时间/时段：${time}` : '',
    rawPrompt ? `场景描述：${rawPrompt}` : '',
  ].filter(Boolean).join('\n') || location || '未知场景';

  const systemPrompt = promptI18n.getScenePolishPromptSingle(mergedCfg);
  const userPrompt = `请根据以下场景信息，生成单图场景参考图的提示词：\n\n${sceneDesc}`;

  log.info('[场景单图提示词] Step1 开始生成单图描述', { scene_id: sceneId, location, time });

  let singleViewDescription;
  try {
    singleViewDescription = await aiClient.generateText(db, log, 'text', userPrompt, systemPrompt, {
      model: modelName || undefined,
      max_tokens: 4000,
    });
  } catch (err) {
    log.error('[场景单图提示词] 文字AI失败', { error: err.message });
    return { ok: false, error: toUserFacingProcessError(err, '生成场景提示词失败，请稍后重试') };
  }

  if (!singleViewDescription || !singleViewDescription.trim()) {
    return { ok: false, error: 'AI返回内容为空' };
  }

  const styleEn = (mergedCfg.style.default_style_en || mergedCfg.style.default_style || '').trim();
  const styleZh = (mergedCfg.style.default_style_zh || '').trim();
  const polishedPrompt = buildSceneSingleImagePrompt(singleViewDescription.trim(), styleEn, styleZh);

  runResourceWrite(db, 'scenes', sceneId, () => db.prepare(
    'UPDATE scenes SET polished_prompt_single = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
  ).run(polishedPrompt, new Date().toISOString(), Number(sceneId)));
  log.info('[场景单图提示词] 生成并保存完成', { scene_id: sceneId, length: polishedPrompt.length });
  return { ok: true, polished_prompt_single: polishedPrompt };
}

/**
 * 场景四视图生成：两步流程
 * Step 1: 文本AI将 location/time/prompt 转换为四格场景参考图描述
 * Step 2: 图片AI根据描述生成 16:9 四格场景参考图
 * 如果已有 polished_prompt（预生成的完整提示词），直接使用，跳过 Step 1
 */
async function generateSceneFourViewImage(db, log, cfg, sceneId, modelName, style) {
  const sceneRow = db.prepare(
    'SELECT id, drama_id, location, time, prompt, polished_prompt FROM scenes WHERE id = ? AND deleted_at IS NULL'
  ).get(Number(sceneId));
  if (!sceneRow || !canReadResource(db, 'scenes', sceneId)) return { ok: false, error: '场景不存在' };
  const dramaFull = db.prepare('SELECT id, style, metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(sceneRow.drama_id);
  if (!dramaFull) return { ok: false, error: '无权限' };

  let mergedCfg = mergeCfgStyleWithDrama(cfg, dramaFull);
  mergedCfg = applySceneStyleOverride(mergedCfg, style);
  let imagePrompt;

  if (sceneRow.polished_prompt && String(sceneRow.polished_prompt).trim()) {
    imagePrompt = String(sceneRow.polished_prompt).trim();
    log.info('[场景四视图] 使用已保存的 polished_prompt，跳过文字AI', { scene_id: sceneId });
  } else {
    const location = (sceneRow.location || '').toString().trim();
    const time = (sceneRow.time || '').toString().trim();
    const rawPrompt = (sceneRow.prompt || '').toString().trim();
    const sceneDesc = [
      location ? `场景地点：${location}` : '',
      time ? `时间/时段：${time}` : '',
      rawPrompt ? `场景描述：${rawPrompt}` : '',
    ].filter(Boolean).join('\n');
    const inputText = sceneDesc || (location || '未知场景');

    const systemPrompt = promptI18n.getScenePolishPrompt(mergedCfg);
    const userMsg = `请根据以下场景信息，生成四格场景参考图的提示词：\n\n${inputText}`;

    log.info('[场景四视图] Step1 开始生成提示词', { scene_id: sceneId, location, time });

    let fourViewDescription;
    try {
      fourViewDescription = await aiClient.generateText(db, log, 'text', userMsg, systemPrompt, {
        model: modelName || undefined,
        max_tokens: 4000,
      });
    } catch (err) {
      log.error('[场景四视图] Step1 文本AI失败，降级为直接使用场景描述', { error: err.message });
      fourViewDescription = inputText;
    }

    const styleEn = (mergedCfg.style.default_style_en || mergedCfg.style.default_style || '').trim();
    const styleZh = (mergedCfg.style.default_style_zh || '').trim();
    imagePrompt = buildSceneFourViewImagePrompt(fourViewDescription, styleEn, styleZh);

    // 顺带保存，供下次复用
    runResourceWrite(db, 'scenes', sceneId, () => db.prepare(
      'UPDATE scenes SET polished_prompt = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
    ).run(imagePrompt, new Date().toISOString(), Number(sceneId)));

    log.info('[场景四视图] Step1 完成，开始Step2生图', { scene_id: sceneId });
  }

  const imageGen = runResourceWrite(db, 'scenes', sceneId, () => imageClient.createAndGenerateImage(db, log, {
    drama_id: sceneRow.drama_id,
    scene_id: sceneId,
    prompt: imagePrompt,
    model: modelName || undefined,
    size: '1792x1024',
    quality: 'standard',
    provider: 'openai',
  }));

  log.info('[场景四视图] Step2 图片生成任务已提交', { scene_id: sceneId, image_gen_id: imageGen?.id });

  return { ok: true, image_generation: imageGen };
}

/**
 * 场景单图生成：两步流程
 * Step 1: 文本AI将 location/time/prompt 转换为单图场景描述
 * Step 2: 图片AI根据描述生成单张场景参考图
 */
async function generateSceneSingleImage(db, log, cfg, sceneId, modelName, style) {
  const sceneRow = db.prepare(
    'SELECT id, drama_id, location, time, prompt, polished_prompt, polished_prompt_single FROM scenes WHERE id = ? AND deleted_at IS NULL'
  ).get(Number(sceneId));
  if (!sceneRow || !canReadResource(db, 'scenes', sceneId)) return { ok: false, error: '场景不存在' };
  const dramaFull = db.prepare('SELECT id, style, metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(sceneRow.drama_id);
  if (!dramaFull) return { ok: false, error: '无权限' };

  let mergedCfg = mergeCfgStyleWithDrama(cfg, dramaFull);
  mergedCfg = applySceneStyleOverride(mergedCfg, style);
  let imagePrompt;

  // 注意：单图模式只检查 polished_prompt_single，即使 polished_prompt（四宫格）有值也不复用
  // 这样可以兼容老数据（老数据 polished_prompt 是四宫格内容，不能用于单图）
  if (sceneRow.polished_prompt_single && String(sceneRow.polished_prompt_single).trim()) {
    imagePrompt = String(sceneRow.polished_prompt_single).trim();
    log.info('[场景单图] 使用已保存的 polished_prompt_single，跳过文字AI', { scene_id: sceneId });
  } else {
    const location = (sceneRow.location || '').toString().trim();
    const time = (sceneRow.time || '').toString().trim();
    const rawPrompt = (sceneRow.prompt || '').toString().trim();
    const sceneDesc = [
      location ? `场景地点：${location}` : '',
      time ? `时间/时段：${time}` : '',
      rawPrompt ? `场景描述：${rawPrompt}` : '',
    ].filter(Boolean).join('\n');
    const inputText = sceneDesc || (location || '未知场景');

    const systemPrompt = promptI18n.getScenePolishPromptSingle(mergedCfg);
    const userMsg = `请根据以下场景信息，生成单图场景参考图的提示词：\n\n${inputText}`;

    log.info('[场景单图] Step1 开始生成提示词', { scene_id: sceneId, location, time });

    let singleViewDescription;
    try {
      singleViewDescription = await aiClient.generateText(db, log, 'text', userMsg, systemPrompt, {
        model: modelName || undefined,
        max_tokens: 4000,
      });
    } catch (err) {
      log.error('[场景单图] Step1 文本AI失败，降级为直接使用场景描述', { error: err.message });
      singleViewDescription = inputText;
    }

    const styleEn = (mergedCfg.style.default_style_en || mergedCfg.style.default_style || '').trim();
    const styleZh = (mergedCfg.style.default_style_zh || '').trim();
    imagePrompt = buildSceneSingleImagePrompt(singleViewDescription, styleEn, styleZh);

    runResourceWrite(db, 'scenes', sceneId, () => db.prepare(
      'UPDATE scenes SET polished_prompt_single = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
    ).run(imagePrompt, new Date().toISOString(), Number(sceneId)));

    log.info('[场景单图] Step1 完成，开始Step2生图', { scene_id: sceneId });
  }

  const imageGen = runResourceWrite(db, 'scenes', sceneId, () => imageClient.createAndGenerateImage(db, log, {
    drama_id: sceneRow.drama_id,
    scene_id: sceneId,
    prompt: imagePrompt,
    model: modelName || undefined,
    size: '1792x1024',
    quality: 'standard',
    provider: 'openai',
  }));

  log.info('[场景单图] Step2 图片生成任务已提交', { scene_id: sceneId, image_gen_id: imageGen?.id });

  return { ok: true, image_generation: imageGen };
}

function resolveScenePanoramaSource(scene, cfg = null) {
  if (!scene) return null;
  const loadedCfg = cfg || require('../config').loadConfig();
  const rawStoragePath = loadedCfg?.storage?.local_path || './data/storage';
  const storagePath = require('path').isAbsolute(rawStoragePath)
    ? rawStoragePath
    : require('path').join(process.cwd(), rawStoragePath);
  for (const candidate of [scene.local_path, scene.image_url]) {
    const value = String(candidate || '').trim();
    if (!value || !imageService.isUsableProviderReference(value)) continue;
    if (/^https?:\/\//i.test(value)) {
      return uploadService.assertPublicHttpUrlSyntax(value).toString();
    }
    const resolved = uploadService.resolveStorageReference(storagePath, value, { mustExist: false });
    if (resolved) return resolved.relativePath;
  }
  return null;
}

function buildScenePanoramaPrompt(scene) {
  const context = [
    scene?.location ? `Scene location: ${String(scene.location).trim()}` : '',
    scene?.time ? `Time of day: ${String(scene.time).trim()}` : '',
  ].filter(Boolean).join('\n');
  return [
    'Use the provided scene main image as the sole visual reference.',
    'Expand the depicted environment into one complete equirectangular 360-degree panorama with an exact 2:1 aspect ratio, covering 360 degrees horizontally and 180 degrees vertically.',
    'Preserve the source scene identity, architecture, materials, lighting, color palette, and spatial logic while reconstructing the environment outside the original camera view.',
    'Keep the horizon level and centered. Produce a single continuous environment image, not a collage, split view, cubemap, fisheye view, tiny planet, frame, or image with text.',
    context,
  ].filter(Boolean).join('\n');
}

function generateScenePanoramaImage(db, log, sceneId, modelName, style) {
  const sceneRow = db.prepare(
    `SELECT id, drama_id, location, time, image_url, local_path
       FROM scenes WHERE id = ? AND deleted_at IS NULL`
  ).get(Number(sceneId));
  if (!sceneRow || !canReadResource(db, 'scenes', sceneId)) return { ok: false, error: '场景不存在' };

  const drama = db.prepare('SELECT id FROM dramas WHERE id = ? AND deleted_at IS NULL').get(sceneRow.drama_id);
  if (!drama) return { ok: false, error: '无权限' };

  let sourceImage;
  try {
    sourceImage = resolveScenePanoramaSource(sceneRow);
  } catch (_) {
    return { ok: false, error: '场景主图不安全，请更换后重试' };
  }
  if (!sourceImage) return { ok: false, error: '请先为场景准备可用的主图，再生成全景图' };

  const imageGeneration = runResourceWrite(db, 'scenes', sceneId, () => imageService.create(db, log, {
    drama_id: sceneRow.drama_id,
    scene_id: sceneRow.id,
    frame_type: 'scene_panorama',
    reference_images: [sourceImage],
    prompt: buildScenePanoramaPrompt(sceneRow),
    style: style || undefined,
    model: modelName || undefined,
    size: '2048x1024',
    quality: 'standard',
    provider: 'openai',
  }));

  log.info('[场景全景图] 图片生成任务已提交', {
    scene_id: sceneRow.id,
    image_gen_id: imageGeneration?.id,
  });
  return { ok: true, image_generation: imageGeneration };
}

/**
 * 从场景现有图片中反向提取场景描述，更新 prompt 字段。
 */
async function extractSceneFromImage(db, log, cfg, sceneId) {
  const { generateTextWithVision, resolveEntityImageSource, EXTRACT_PROMPTS } = require('./aiClient');

  const sceneRow = db.prepare(
    'SELECT id, drama_id, location, time, image_url, local_path, extra_images, ref_image FROM scenes WHERE id = ? AND deleted_at IS NULL'
  ).get(Number(sceneId));
  if (!sceneRow || !canReadResource(db, 'scenes', sceneId)) return { ok: false, error: '场景不存在' };

  const imgSrc = resolveEntityImageSource(sceneRow, cfg);
  if (!imgSrc) return { ok: false, error: '该场景暂无参考图片，请先上传图片' };

  const locationLabel = [sceneRow.location, sceneRow.time].filter(Boolean).join(' · ') || '场景';
  const { system: systemPrompt, user: userFn } = EXTRACT_PROMPTS.scene;
  const userPrompt = userFn(locationLabel);

  let prompt;
  try {
    prompt = await generateTextWithVision(db, log, 'text', userPrompt, systemPrompt, imgSrc, { max_tokens: 2000 });
  } catch (err) {
    log.error('[extractSceneFromImage] AI 调用失败', { sceneId, error: err.message });
    return { ok: false, error: toVisionExtractUserError(err) };
  }

  runResourceWrite(db, 'scenes', sceneId, () => db.prepare(
    'UPDATE scenes SET prompt = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
  ).run(prompt, new Date().toISOString(), Number(sceneId)));

  log.info('[extractSceneFromImage] 场景描述提取成功', { sceneId, prompt_len: prompt.length });
  return { ok: true, prompt };
}

module.exports = {
  generateSceneFourViewImage,
  generateSceneSingleImage,
  generateScenePanoramaImage,
  generateScenePromptOnly,
  generateSceneSinglePromptOnly,
  extractSceneFromImage,
  buildScenePanoramaPrompt,
  resolveScenePanoramaSource,
};
