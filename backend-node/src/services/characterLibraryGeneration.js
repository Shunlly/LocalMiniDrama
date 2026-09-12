/**
 * 角色库生成与提示词：单张生图、批量四视图、提示词润色、外貌反提。
 * 路由仍通过 characterLibraryService 调用，本模块不改变公开 API。
 * character_id / drama_id 语义不同，不得互换。
 */

const imageClient = require('./imageClient');
const { aspectRatioToSize } = require('./imageService');
const aiClient = require('./aiClient');
const promptI18n = require('./promptI18n');
const { mergeCfgStyleWithDrama } = require('../utils/dramaStyleMerge');
const { scheduleLegacyAsync } = require('./legacyAsyncSchedulerService');
const { toVisionExtractUserError } = require('./providerErrorSanitizer');

function applyStyleOverrideToCfg(cfg, styleOverride) {
  const o = (styleOverride || '').toString().trim();
  if (!o) return cfg;
  return {
    ...cfg,
    style: {
      ...(cfg?.style || {}),
      default_style_zh: o,
      default_style_en: o,
      default_style: o,
    },
  };
}

function appendPrompt(base, extra) {
  const add = (extra || '').toString().trim();
  if (!add) return base;
  const current = (base || '').toString().trim();
  if (!current) return add;
  const lowerCurrent = current.toLowerCase();
  const lowerAdd = add.toLowerCase();
  if (lowerCurrent.includes(lowerAdd)) return current;
  return current + ', ' + add;
}

function generateCharacterImage(db, log, cfg, characterId, modelName, style) {
  const charRow = db.prepare(
    'SELECT id, drama_id, name, appearance, description, negative_prompt FROM characters WHERE id = ? AND deleted_at IS NULL'
  ).get(Number(characterId));
  if (!charRow) return { ok: false, error: '角色不存在' };
  const drama = db.prepare('SELECT id, style, metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(charRow.drama_id);
  if (!drama) return { ok: false, error: '无权限' };

  let effectiveCfg = { ...cfg, style: { ...(cfg?.style || {}) } };
  try {
    const meta = drama.metadata ? (typeof drama.metadata === 'string' ? JSON.parse(drama.metadata) : drama.metadata) : null;
    if (meta && meta.aspect_ratio) {
      effectiveCfg.style.default_image_ratio = meta.aspect_ratio;
    }
  } catch (_) {}
  effectiveCfg = mergeCfgStyleWithDrama(effectiveCfg, drama);
  effectiveCfg = applyStyleOverrideToCfg(effectiveCfg, style);

  let prompt = '';
  if (charRow.appearance && String(charRow.appearance).trim()) {
    prompt = String(charRow.appearance);
  } else if (charRow.description && String(charRow.description).trim()) {
    prompt = String(charRow.description);
  } else {
    prompt = charRow.name || '';
  }
  const styleForImage = (effectiveCfg?.style?.default_style_en || effectiveCfg?.style?.default_style || '').trim();
  prompt = appendPrompt(prompt, styleForImage);
  if (!(style && String(style).trim())) {
    prompt = appendPrompt(prompt, effectiveCfg?.style?.default_role_style || '');
  }
  const ratioText = effectiveCfg?.style?.default_role_ratio
    ? String(effectiveCfg.style.default_role_ratio)
    : (effectiveCfg?.style?.default_image_ratio ? 'image ratio: ' + effectiveCfg.style.default_image_ratio : '');
  prompt = appendPrompt(prompt, ratioText);
  // 根据项目 aspect_ratio 动态计算图片尺寸，兜底 1920x1920
  let imageSize = null;
  try {
    const meta = drama.metadata ? (typeof drama.metadata === 'string' ? JSON.parse(drama.metadata) : drama.metadata) : null;
    if (meta && meta.aspect_ratio) imageSize = aspectRatioToSize(meta.aspect_ratio);
  } catch (_) {}
  imageSize = imageSize || '1920x1920';
  const userNeg = imageClient.resolveAssetUserNegativeForApi(modelName, charRow.negative_prompt);
  const imageGen = imageClient.createAndGenerateImage(db, log, {
    drama_id: charRow.drama_id,
    character_id: charRow.id,
    prompt,
    model: modelName || undefined,
    size: imageSize,
    quality: 'standard',
    provider: 'openai',
    user_negative_prompt: userNeg || undefined,
  });
  return { ok: true, image_generation: imageGen };
}

/**
 * 批量生成角色图片（与 Go BatchGenerateCharacterImages 对齐：为每个角色单独起一个异步任务并发生成）
 */
function batchGenerateCharacterImages(db, log, cfg, characterIds, modelName, style) {
  const ids = Array.isArray(characterIds) ? characterIds.map((id) => String(id)) : [];
  if (ids.length === 0) return { ok: false, error: '角色 ID 列表不能为空' };
  if (ids.length > 10) return { ok: false, error: '单次最多生成10个角色' };
  log.info('Starting batch character four-view generation', { count: ids.length, model: modelName, character_ids: ids });
  // 每个角色单独起一个异步任务，不阻塞响应
  for (const characterId of ids) {
    const charId = characterId;
    scheduleLegacyAsync(log, 'character_four_view_batch_item', async () => {
      try {
        const out = await generateCharacterFourViewImage(db, log, cfg, charId, modelName, style);
        if (!out.ok) {
          log.warn('Batch character four-view skip', { character_id: charId, error: out.error });
          return;
        }
        log.info('Batch character four-view submitted', { character_id: charId, image_gen_id: out.image_generation ? out.image_generation.id : null });
      } catch (err) {
        log.error('Batch character four-view failed', { character_id: charId, error: err.message });
      }
    }, { character_id: charId });
  }
  log.info('Batch character four-view tasks queued', { total: ids.length });
  return { ok: true, count: ids.length };
}

/**
 * 角色四视图生成：两步流程
 * Step 1: 文本AI将 appearance 转换为标准四视图绘图描述
 * Step 2: 图片AI根据描述生成 16:9 四格角色参考图
 */
/**
 * 组装最终图片生成 prompt（布局指令 + 角色描述 + 风格 + 硬性要求）
 * 这是实际发给图片AI的完整 prompt，与 polished_prompt 字段内容一致。
 */
/**
 * 从描述文本中识别性别，用于在英文约束里强调，防止图片 AI 生成错误性别。
 * @returns {'MALE'|'FEMALE'|null}
 */
function detectGenderFromDescription(text) {
  if (!text) return null;
  const t = text;

  // ── 第1层：最明确的性别词 ───────────────────────────────────────────
  if (/男性|男生|男孩|男人|帅哥|先生/.test(t)) return 'MALE';
  if (/女性|女生|女孩|女人|美女|小姐|女士/.test(t)) return 'FEMALE';

  // ── 第2层：亲属/称谓（复合词，误判率极低）────────────────────────
  // 男：哥哥 大哥 二哥 老哥 / 兄长 兄弟 / 弟弟 老弟 小弟 /
  //     爸爸 父亲 老爸 / 爷爷 老爷 大爷 / 叔叔 伯伯 舅舅
  if (/哥哥|大哥|二哥|老哥|小哥|兄长|兄弟|弟弟|老弟|小弟|爸爸|父亲|老爸|爷爷|老爷|叔叔|伯伯|舅舅/.test(t)) return 'MALE';
  // 女：姐姐 大姐 二姐 / 妹妹 小妹 / 妈妈 母亲 老妈 /
  //     奶奶 姑姑 婶婶 阿姨
  if (/姐姐|大姐|二姐|老姐|小姐姐|妹妹|小妹|大妹|妈妈|母亲|老妈|奶奶|姑姑|婶婶|阿姨/.test(t)) return 'FEMALE';

  // ── 第3层：角色定位词 ──────────────────────────────────────────────
  if (/男主|男二|男三|男配|男反|男一号/.test(t)) return 'MALE';
  if (/女主|女二|女三|女配|女反|女一号/.test(t)) return 'FEMALE';

  // ── 第4层：常见中文名字模式 ───────────────────────────────────────
  // 「小/大/老/阿 + 典型男性用字」
  // 典型男性字：明刚强磊军勇鹏龙伟超豪杰浩宇轩博远志峰涛
  if (/小明|小刚|小强|小磊|小军|小勇|小鹏|小龙|小伟|小超|小豪|小杰|小浩|小宇|小轩|小博|小远|小志|小峰|小涛|大壮|阿强|阿勇|阿明|阿刚|阿豪|老刚|老强/.test(t)) return 'MALE';
  // 「小/大/老/阿 + 典型女性用字」
  // 典型女性字：美红花丽燕芳英敏静娟慧梅香秀玲萍云雪莹晴
  if (/小美|小红|小花|小丽|小燕|小芳|小英|小敏|小静|小娟|小慧|小梅|小香|小秀|小玲|小萍|小云|小雪|小莹|小晴|阿美|阿花|阿丽|阿燕|阿芳|阿英|阿梅/.test(t)) return 'FEMALE';

  // ── 第5层：单字称谓（放最后，避免误判）───────────────────────────
  // 只匹配单独作称谓出现的情况（前后有汉字边界或标点）
  if (/[（(【「\s：:]哥[）)】」\s,，。！!]|^哥[,，。]|[他]哥\b/.test(t)) return 'MALE';

  // ── 第6层：英文兜底 ────────────────────────────────────────────────
  if (/\b(male|man|boy|gentleman|he|his)\b/i.test(t)) return 'MALE';
  if (/\b(female|woman|girl|lady|she|her)\b/i.test(t)) return 'FEMALE';

  return null;
}

/**
 * @param {string} fourViewDescription 文本AI润色后的角色四格描述
 * @param {string} [styleEn] default_style_en 或 fallback default_style
 * @param {string} [styleZh] default_style_zh（可与 en 相同；相同时不重复输出英文行）
 */
function buildFourViewImagePrompt(fourViewDescription, styleEn, styleZh) {
  const imageLayoutInstruction = promptI18n.getRoleGenerateImagePrompt();
  const zh = (styleZh || '').trim();
  const en = (styleEn || '').trim();

  const styleLines = [];
  if (zh) styleLines.push(`【画风·最高优先级】四格统一：${zh}`);
  if (en && en !== zh) styleLines.push(`MANDATORY ART STYLE (all 4 panels): ${en}.`);
  else if (en && !zh) styleLines.push(`MANDATORY ART STYLE (all 4 panels): ${en}.`);
  const styleHeader = styleLines.length ? `${styleLines.join('\n')}\n\n` : '';

  const gender = detectGenderFromDescription(fourViewDescription);
  const genderEnforcement = gender === 'MALE'
    ? 'GENDER: male only — masculine build and facial features; do not feminize.'
    : gender === 'FEMALE'
      ? 'GENDER: female only — feminine build and facial features; do not masculinize.'
      : '';

  const tailParts = [];
  if (genderEnforcement) tailParts.push(genderEnforcement);
  if (zh || en) tailParts.push(`Reiterate: same art style as above (${en || zh}).`);
  const tail = tailParts.length ? `\n\n---\n\n${tailParts.join(' ')}` : '';

  return `${styleHeader}${imageLayoutInstruction}\n\n---\n\n${fourViewDescription}${tail}`;
}

/**
 * 仅生成（并保存）角色四视图提示词，不触发图片生成。
 * 供前端「生成提示词」按钮调用，或提取角色后后台异步调用。
 * @returns {{ ok: boolean, polished_prompt?: string, error?: string }}
 */
async function generateCharacterPromptOnly(db, log, cfg, characterId, modelName, style) {
  const charRow = db.prepare(
    'SELECT id, drama_id, name, appearance, description FROM characters WHERE id = ? AND deleted_at IS NULL'
  ).get(Number(characterId));
  if (!charRow) return { ok: false, error: '角色不存在' };

  const dramaFull = db.prepare('SELECT id, style, metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(charRow.drama_id);
  let mergedCfg = mergeCfgStyleWithDrama(cfg, dramaFull || {});
  mergedCfg = applyStyleOverrideToCfg(mergedCfg, style);

  let appearanceText = '';
  if (charRow.appearance && String(charRow.appearance).trim()) {
    appearanceText = String(charRow.appearance).trim();
  } else if (charRow.description && String(charRow.description).trim()) {
    appearanceText = String(charRow.description).trim();
  } else {
    appearanceText = charRow.name || '';
  }

  const systemPrompt = promptI18n.getRolePolishPrompt(mergedCfg);
  const userPrompt = `角色名称：${charRow.name}\n\n角色描述：\n${appearanceText}`;

  log.info('[四视图提示词] 开始生成', { character_id: characterId, name: charRow.name });

  let fourViewDescription;
  try {
    fourViewDescription = await aiClient.generateText(db, log, 'text', userPrompt, systemPrompt, {
      scene_key: 'role_image_polish',
      model: modelName || undefined,
      max_tokens: 4000,
    });
  } catch (err) {
    log.error('[四视图提示词] 文本AI失败，降级为外貌描述', { error: err.message });
    fourViewDescription = appearanceText;
  }

  const styleEn = (mergedCfg.style.default_style_en || mergedCfg.style.default_style || '').trim();
  const styleZh = (mergedCfg.style.default_style_zh || '').trim();
  const polishedPrompt = buildFourViewImagePrompt(fourViewDescription, styleEn, styleZh);

  // 保存到 characters.polished_prompt
  db.prepare('UPDATE characters SET polished_prompt = ?, updated_at = ? WHERE id = ?').run(
    polishedPrompt, new Date().toISOString(), Number(characterId)
  );

  log.info('[四视图提示词] 生成并保存完成', { character_id: characterId, length: polishedPrompt.length });
  return { ok: true, polished_prompt: polishedPrompt };
}

async function generateCharacterFourViewImage(db, log, cfg, characterId, modelName, style) {
  const charRow = db.prepare(
    'SELECT id, drama_id, name, appearance, description, polished_prompt, negative_prompt FROM characters WHERE id = ? AND deleted_at IS NULL'
  ).get(Number(characterId));
  if (!charRow) return { ok: false, error: '角色不存在' };
  const dramaFull = db.prepare('SELECT id, style, metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(charRow.drama_id);
  if (!dramaFull) return { ok: false, error: '无权限' };

  let mergedCfg = mergeCfgStyleWithDrama(cfg, dramaFull);
  mergedCfg = applyStyleOverrideToCfg(mergedCfg, style);
  let imagePrompt;

  if (charRow.polished_prompt && String(charRow.polished_prompt).trim()) {
    // 直接使用已保存的提示词（用户可能已编辑过）
    imagePrompt = String(charRow.polished_prompt).trim();
    log.info('[四视图] 使用已保存的 polished_prompt，跳过文字AI', { character_id: characterId });
  } else {
    // 没有预生成提示词，临时生成（与 generateCharacterPromptOnly 同逻辑）
    let appearanceText = '';
    if (charRow.appearance && String(charRow.appearance).trim()) {
      appearanceText = String(charRow.appearance).trim();
    } else if (charRow.description && String(charRow.description).trim()) {
      appearanceText = String(charRow.description).trim();
    } else {
      appearanceText = charRow.name || '';
    }

    const systemPrompt = promptI18n.getRolePolishPrompt(mergedCfg);
    const userPrompt = `角色名称：${charRow.name}\n\n角色描述：\n${appearanceText}`;

    log.info('[四视图] Step1 开始生成四视图提示词', { character_id: characterId, name: charRow.name });

    let fourViewDescription;
    try {
      fourViewDescription = await aiClient.generateText(db, log, 'text', userPrompt, systemPrompt, {
        scene_key: 'role_image_polish',
        model: modelName || undefined,
        max_tokens: 4000,
      });
    } catch (err) {
      log.error('[四视图] Step1 文本AI失败，降级为直接使用外貌描述', { error: err.message });
      fourViewDescription = appearanceText;
    }

    const styleEn = (mergedCfg.style.default_style_en || mergedCfg.style.default_style || '').trim();
    const styleZh = (mergedCfg.style.default_style_zh || '').trim();
    imagePrompt = buildFourViewImagePrompt(fourViewDescription, styleEn, styleZh);

    // 顺带保存，供下次复用
    try {
      db.prepare('UPDATE characters SET polished_prompt = ?, updated_at = ? WHERE id = ?').run(
        imagePrompt, new Date().toISOString(), Number(characterId)
      );
    } catch (_) {}

    log.info('[四视图] Step1 完成，开始Step2生图', { character_id: characterId });
  }

  const userNeg = imageClient.resolveAssetUserNegativeForApi(modelName, charRow.negative_prompt);
  const imageGen = imageClient.createAndGenerateImage(db, log, {
    drama_id: charRow.drama_id,
    character_id: charRow.id,
    prompt: imagePrompt,
    model: modelName || undefined,
    size: '1792x1024',
    quality: 'standard',
    provider: 'openai',
    user_negative_prompt: userNeg || undefined,
  });

  log.info('[四视图] Step2 图片生成任务已提交', { character_id: characterId, image_gen_id: imageGen?.id });

  return { ok: true, image_generation: imageGen };
}

/**
 * 从角色现有图片中反向提取外貌描述，更新 appearance 字段。
 */
async function extractAppearanceFromImage(db, log, cfg, characterId) {
  const { generateTextWithVision, resolveEntityImageSource, EXTRACT_PROMPTS } = require('./aiClient');

  const charRow = db.prepare(
    'SELECT id, name, image_url, local_path, extra_images, ref_image FROM characters WHERE id = ? AND deleted_at IS NULL'
  ).get(Number(characterId));
  if (!charRow) return { ok: false, error: '角色不存在' };

  const imgSrc = resolveEntityImageSource(charRow, cfg);
  if (!imgSrc) return { ok: false, error: '该角色暂无参考图片，请先上传图片' };

  const { system: systemPrompt, user: userFn } = EXTRACT_PROMPTS.character;
  const userPrompt = userFn(charRow.name);

  const { isRefusalResponse } = require('./aiClient');
  let appearance;
  try {
    appearance = await generateTextWithVision(db, log, 'text', userPrompt, systemPrompt, imgSrc, { max_tokens: 2000 });
  } catch (err) {
    log.error('[extractAppearanceFromImage] AI 调用失败', { characterId, error: err.message });
    return { ok: false, error: toVisionExtractUserError(err) };
  }

  if (isRefusalResponse(appearance)) {
    log.warn('[extractAppearanceFromImage] 模型拒绝描述真人', { characterId, result: appearance });
    return { ok: false, error: '模型因安全策略拒绝描述图中人物面部特征。建议：①使用 Gemini 模型（限制较少）；②手动填写外貌描述；③上传卡通/插画风格的参考图。' };
  }

  db.prepare('UPDATE characters SET appearance = ?, updated_at = ? WHERE id = ?')
    .run(appearance, new Date().toISOString(), Number(characterId));

  log.info('[extractAppearanceFromImage] 外貌提取成功', { characterId, appearance_len: appearance.length });
  return { ok: true, appearance };
}

module.exports = {
  generateCharacterImage,
  batchGenerateCharacterImages,
  generateCharacterFourViewImage,
  generateCharacterPromptOnly,
  extractAppearanceFromImage,
  detectGenderFromDescription,
  buildFourViewImagePrompt,
};
