const test = require('node:test');
const assert = require('node:assert/strict');

const resolve = require('../src/services/promptI18nResolve');
const catalog = require('../src/services/promptI18nCatalog');
const promptI18n = require('../src/services/promptI18n');

const {
  getLanguage,
  isEnglish,
  styleTextForCfgLang,
  styleTextZhForPolish,
  styleTextEnForImage,
  applyPrintfTemplate,
  formatUserPrompt,
  buildStoryExpansionUserPrompt,
  getRealisticPhysicalScaleContract,
  resolveStoryboardDurationHint,
  buildStoryboardDurationInstruction,
} = resolve;

test('语言解析只认 app.language，en 大小写可过，zh-CN 不是英文', () => {
  assert.equal(getLanguage(), 'zh');
  assert.equal(getLanguage({}), 'zh');
  assert.equal(getLanguage({ app: { language: '' } }), 'zh');
  assert.equal(getLanguage({ app: { language: 'EN' } }), 'en');
  assert.equal(getLanguage({ app: { language: 'zh-CN' } }), 'zh-cn');
  assert.equal(isEnglish({ app: { language: 'en' } }), true);
  assert.equal(isEnglish({ app: { language: 'EN' } }), true);
  assert.equal(isEnglish({ app: { language: 'zh' } }), false);
  assert.equal(isEnglish({ app: { language: 'zh-CN' } }), false);
  assert.equal(isEnglish({ language: 'en' }), false);
});

test('中英文画风字段不得互相回退，缺省才用 default_style', () => {
  const cfg = {
    app: { language: 'zh' },
    style: {
      default_style_zh: '  水墨  ',
      default_style_en: 'ink wash',
      default_style: 'fallback',
    },
  };
  assert.equal(styleTextForCfgLang(cfg), '水墨');
  assert.equal(styleTextForCfgLang({ ...cfg, app: { language: 'en' } }), 'ink wash');
  assert.equal(styleTextZhForPolish(cfg), '水墨');
  assert.equal(styleTextEnForImage(cfg), 'ink wash');

  const zhMissing = { app: { language: 'zh' }, style: { default_style_en: 'ink wash', default_style: 'fallback' } };
  const enMissing = { app: { language: 'en' }, style: { default_style_zh: '水墨', default_style: 'fallback' } };
  assert.equal(styleTextForCfgLang(zhMissing), 'fallback');
  assert.equal(styleTextForCfgLang(enMissing), 'fallback');
  assert.equal(styleTextZhForPolish(zhMissing), 'fallback');
  assert.equal(styleTextEnForImage(enMissing), 'fallback');
  assert.equal(styleTextZhForPolish(enMissing), '水墨');
  assert.equal(styleTextEnForImage(zhMissing), 'ink wash');
});

test('printf 只替换 %s/%d，0 会写入，null 与缺失槽位变成空串', () => {
  assert.equal(applyPrintfTemplate('%s-%d-%s', ['a', 2, 'b']), 'a-2-b');
  assert.equal(applyPrintfTemplate('%s-%s', [0, null]), '0-');
  assert.equal(applyPrintfTemplate('%s-%s', ['only']), 'only-');
  assert.equal(applyPrintfTemplate('%s', ['a', 'extra']), 'a');
  assert.equal(applyPrintfTemplate('无占位', ['x']), '无占位');
  assert.equal(applyPrintfTemplate('%f %s', ['keep']), '%f keep');
});

test('用户提示装配按语言选模板，缺失 key 才回退到第一个参数', () => {
  const cfgZh = { app: { language: 'zh' }, style: { default_style_zh: '水墨', default_image_ratio: '9:16' } };
  const cfgEn = { app: { language: 'en' }, style: { default_style_en: 'ink', default_image_ratio: '9:16' } };
  assert.equal(formatUserPrompt(cfgZh, 'character_request', '剧本A'), '剧本内容：\n剧本A\n\n请提取剧本中所有有名字角色的设定。');
  assert.match(formatUserPrompt(cfgEn, 'character_request', 'ScriptA'), /Script content:/);
  assert.equal(formatUserPrompt(cfgZh, 'drama_info_template', 'T', 'S', 'G'), '剧名：T\n简介：S\n类型：G\n风格: 水墨\n图片比例: 9:16');
  assert.equal(formatUserPrompt(cfgEn, 'drama_info_template', 'T', 'S', 'G'), 'Title: T\nSummary: S\nGenre: G\nStyle: ink\nImage ratio: 9:16');
  assert.equal(formatUserPrompt(cfgZh, 'character_extraction', 'FALLBACK'), 'FALLBACK');
  assert.equal(formatUserPrompt(cfgZh, 'missing', 'X'), 'X');
  assert.equal(formatUserPrompt(cfgZh, 'missing'), '');
  assert.equal(formatUserPrompt({ app: { language: 'zh' } }, 'drama_info_template', 'T', 'S', 'G').includes('16:9'), true);
  assert.equal(formatUserPrompt(cfgZh, 'scene_label', '码头', '黄昏'), '场景: 码头, 黄昏');
});

test('故事扩展用户提示把风格 key 与类型 key 分开消费，集数 1 不加集数行', () => {
  const zh = { app: { language: 'zh' } };
  const en = { app: { language: 'en' } };
  assert.equal(
    buildStoryExpansionUserPrompt(zh, '梗概', 'modern', 'drama', 1),
    '请根据以下故事梗概，创作 1 集短片剧本：\n\n梗概\n\n故事风格：现代\n剧本类型：剧情'
  );
  assert.equal(
    buildStoryExpansionUserPrompt(en, 'premise', 'ancient', 'comedy', 2),
    'Please create 2 episode(s) of a short-film script based on the following story premise:\n\npremise\n\nStyle: Period/Ancient\nGenre: Comedy\nEpisodes: 2'
  );
  assert.equal(buildStoryExpansionUserPrompt(zh, '梗概', 'drama', 'modern', 0), '请根据以下故事梗概，创作 1 集短片剧本：\n\n梗概');
  assert.match(buildStoryExpansionUserPrompt(zh, '梗概', 'unknown', 'unknown', '3'), /生成集数：3 集/);
  assert.equal(buildStoryExpansionUserPrompt(zh, '梗概', 0, null, 1).includes('故事风格'), false);
});

test('单镜时长提示：无效值走估算文案，中英文互不混用', () => {
  assert.equal(resolveStoryboardDurationHint(5), 5);
  assert.equal(resolveStoryboardDurationHint('8'), 8);
  assert.equal(resolveStoryboardDurationHint(0), null);
  assert.equal(resolveStoryboardDurationHint(-1), null);
  assert.equal(resolveStoryboardDurationHint('5s'), null);
  assert.equal(resolveStoryboardDurationHint(null), null);
  assert.match(buildStoryboardDurationInstruction('zh', 5), /每镜头约5秒/);
  assert.match(buildStoryboardDurationInstruction('en', 5), /approximately 5s per shot/);
  assert.equal(buildStoryboardDurationInstruction('zh', 0), '综合对话、动作、情绪估算每镜时长（秒）');
  assert.equal(buildStoryboardDurationInstruction('en', 0), 'estimate per shot from dialogue length, action complexity, and emotion');
  assert.equal(buildStoryboardDurationInstruction('EN', 5).includes('approximately'), false);
});

test('尺度铁律按真值选英文，假值选中文', () => {
  const en = getRealisticPhysicalScaleContract(true);
  const zh = getRealisticPhysicalScaleContract(false);
  assert.ok(en.includes('REALISTIC PHYSICAL SCALE'));
  assert.ok(zh.includes('真实物理尺度'));
  assert.equal(getRealisticPhysicalScaleContract('en'), en);
  assert.equal(getRealisticPhysicalScaleContract(0), zh);
  assert.notEqual(en, zh);
});

test('promptI18n 再导出解析函数，且覆盖缓存仍只作用对应 key', () => {
  assert.equal(promptI18n.getLanguage, getLanguage);
  assert.equal(promptI18n.isEnglish, isEnglish);
  assert.equal(promptI18n.formatUserPrompt, formatUserPrompt);
  assert.equal(promptI18n.buildStoryExpansionUserPrompt, buildStoryExpansionUserPrompt);
  assert.equal(promptI18n.getRealisticPhysicalScaleContract, getRealisticPhysicalScaleContract);
  assert.equal(promptI18n.getDefaultPromptBody, catalog.getDefaultPromptBody);

  const cfg = { app: { language: 'zh' }, style: { default_style_zh: '水墨', default_image_ratio: '16:9' } };
  promptI18n.setOverrideInMemory('character_extraction', '覆盖角色提取');
  promptI18n.setOverrideInMemory('scene_extraction', '覆盖场景提取');
  try {
    const characterPrompt = promptI18n.getCharacterExtractionPrompt(cfg);
    const scenePrompt = promptI18n.getSceneExtractionPrompt(cfg);
    assert.match(characterPrompt, /^覆盖角色提取/);
    assert.equal(characterPrompt.includes('覆盖场景提取'), false);
    assert.match(scenePrompt, /^覆盖场景提取/);
    assert.equal(scenePrompt.includes('覆盖角色提取'), false);
  } finally {
    promptI18n.clearOverrideInMemory('character_extraction');
    promptI18n.clearOverrideInMemory('scene_extraction');
  }
  assert.equal(promptI18n.getCharacterExtractionPrompt(cfg).startsWith('覆盖角色提取'), false);
});

test('分镜后缀装配接入时长解析，英文分支不含中文时长句', () => {
  const zh = promptI18n.getStoryboardUserPromptSuffix({ app: { language: 'zh' } }, 7);
  const en = promptI18n.getStoryboardUserPromptSuffix({ app: { language: 'en' } }, 7);
  assert.match(zh, /每镜头约7秒/);
  assert.match(en, /approximately 7s per shot/);
  assert.equal(en.includes('每镜头约'), false);
  assert.equal(promptI18n.getStoryboardUserPromptSuffix({ app: { language: 'zh' } }, 0).includes('每镜头约'), false);
});
