const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');

const assets = require('../src/services/promptI18nAssets');
const characters = require('../src/services/promptI18nAssetCharacters');
const scenes = require('../src/services/promptI18nAssetScenes');
const props = require('../src/services/promptI18nAssetProps');
const omni = require('../src/services/promptI18nAssetOmni');
const promptI18n = require('../src/services/promptI18n');
const { DEFAULT_LINE3 } = require('../src/services/universalOmniMultiBeatFormat');

const {
  getCharacterExtractionPrompt,
  getPropExtractionPrompt,
  getSceneExtractionPrompt,
  getStoryExpansionSystemPrompt,
  getRolePolishPrompt,
  getRoleGenerateImagePrompt,
  getImagePolishPrompt,
  getUniversalOmniSegmentPrompt,
  getUniversalOmniPolishPrompt,
  getContinuitySnapshotPrompt,
  getRegenerateLayoutDescriptionPrompt,
  getIdentityAnchorsPrompt,
  getPropPolishPrompt,
} = assets;

const STYLE_CFG = {
  default_style_zh: '水墨工笔',
  default_style_en: 'ink wash painting',
  default_style: 'fallback-style',
  default_image_ratio: '9:16',
};

function cfgOf(lang, style) {
  return { app: { language: lang }, style: { ...style } };
}

test('promptI18nAssets 原样再导出拆分模块函数，门面不含提示词正文', () => {
  assert.equal(assets.getCharacterExtractionPrompt, characters.getCharacterExtractionPrompt);
  assert.equal(assets.getRolePolishPrompt, characters.getRolePolishPrompt);
  assert.equal(assets.getRoleGenerateImagePrompt, characters.getRoleGenerateImagePrompt);
  assert.equal(assets.getContinuitySnapshotPrompt, characters.getContinuitySnapshotPrompt);
  assert.equal(assets.getIdentityAnchorsPrompt, characters.getIdentityAnchorsPrompt);
  assert.equal(assets.getSceneExtractionPrompt, scenes.getSceneExtractionPrompt);
  assert.equal(assets.getImagePolishPrompt, scenes.getImagePolishPrompt);
  assert.equal(assets.getRegenerateLayoutDescriptionPrompt, scenes.getRegenerateLayoutDescriptionPrompt);
  assert.equal(assets.getPropExtractionPrompt, props.getPropExtractionPrompt);
  assert.equal(assets.getPropPolishPrompt, props.getPropPolishPrompt);
  assert.equal(assets.getStoryExpansionSystemPrompt, omni.getStoryExpansionSystemPrompt);
  assert.equal(assets.getUniversalOmniSegmentPrompt, omni.getUniversalOmniSegmentPrompt);
  assert.equal(assets.getUniversalOmniPolishPrompt, omni.getUniversalOmniPolishPrompt);
  assert.deepEqual(Object.keys(assets), [
    'setOverrideCacheRef',
    'getCharacterExtractionPrompt',
    'getPropExtractionPrompt',
    'getSceneExtractionPrompt',
    'getStoryExpansionSystemPrompt',
    'getRolePolishPrompt',
    'getRoleGenerateImagePrompt',
    'getImagePolishPrompt',
    'getUniversalOmniSegmentPrompt',
    'getUniversalOmniPolishPrompt',
    'getContinuitySnapshotPrompt',
    'getRegenerateLayoutDescriptionPrompt',
    'getIdentityAnchorsPrompt',
    'getPropPolishPrompt',
  ]);

  const facade = fs.readFileSync(path.join(__dirname, '../src/services/promptI18nAssets.js'), 'utf8');
  const characterSrc = fs.readFileSync(path.join(__dirname, '../src/services/promptI18nAssetCharacters.js'), 'utf8');
  const sceneSrc = fs.readFileSync(path.join(__dirname, '../src/services/promptI18nAssetScenes.js'), 'utf8');
  const propSrc = fs.readFileSync(path.join(__dirname, '../src/services/promptI18nAssetProps.js'), 'utf8');
  const omniSrc = fs.readFileSync(path.join(__dirname, '../src/services/promptI18nAssetOmni.js'), 'utf8');
  assert.equal(facade.includes('你是一个专业的角色分析师'), false);
  assert.equal(facade.includes('剧本道具分析师'), false);
  assert.equal(facade.includes('提取所有唯一的场景背景'), false);
  assert.equal(facade.includes('MULTI_BEAT_OUTPUT'), false);
  assert.equal(characterSrc.includes('你是一个专业的角色分析师'), true);
  assert.equal(sceneSrc.includes('提取所有唯一的场景背景'), true);
  assert.equal(propSrc.includes('剧本道具分析师'), true);
  assert.equal(omniSrc.includes('MULTI_BEAT_OUTPUT'), true);
});

test('promptI18n 原样再导出角色/道具/提取/全能/身份锚点函数', () => {
  assert.equal(promptI18n.getCharacterExtractionPrompt, getCharacterExtractionPrompt);
  assert.equal(promptI18n.getPropExtractionPrompt, getPropExtractionPrompt);
  assert.equal(promptI18n.getSceneExtractionPrompt, getSceneExtractionPrompt);
  assert.equal(promptI18n.getStoryExpansionSystemPrompt, getStoryExpansionSystemPrompt);
  assert.equal(promptI18n.getRolePolishPrompt, getRolePolishPrompt);
  assert.equal(promptI18n.getRoleGenerateImagePrompt, getRoleGenerateImagePrompt);
  assert.equal(promptI18n.getImagePolishPrompt, getImagePolishPrompt);
  assert.equal(promptI18n.getUniversalOmniSegmentPrompt, getUniversalOmniSegmentPrompt);
  assert.equal(promptI18n.getUniversalOmniPolishPrompt, getUniversalOmniPolishPrompt);
  assert.equal(promptI18n.getContinuitySnapshotPrompt, getContinuitySnapshotPrompt);
  assert.equal(promptI18n.getRegenerateLayoutDescriptionPrompt, getRegenerateLayoutDescriptionPrompt);
  assert.equal(promptI18n.getIdentityAnchorsPrompt, getIdentityAnchorsPrompt);
  assert.equal(promptI18n.getPropPolishPrompt, getPropPolishPrompt);
});

test('default_style_zh / default_style_en / default_style 不得互相顶替', () => {
  const zh = cfgOf('zh', STYLE_CFG);
  const en = cfgOf('en', STYLE_CFG);

  for (const fn of [getCharacterExtractionPrompt, getPropExtractionPrompt, getSceneExtractionPrompt]) {
    const zhText = fn(zh);
    const enText = fn(en);
    assert.equal(zhText.includes('水墨工笔'), true);
    assert.equal(zhText.includes('ink wash painting'), false);
    assert.equal(zhText.includes('fallback-style'), false);
    assert.equal(enText.includes('ink wash painting'), true);
    assert.equal(enText.includes('水墨工笔'), false);
    assert.equal(enText.includes('fallback-style'), false);
    assert.notEqual(zhText, enText);
  }

  const zhFallback = getCharacterExtractionPrompt(cfgOf('zh', { default_style: 'fallback-style' }));
  assert.equal(zhFallback.includes('fallback-style'), true);
  const zhEnOnly = getCharacterExtractionPrompt(cfgOf('zh', { default_style_en: 'ink wash painting' }));
  assert.equal(zhEnOnly.includes('ink wash painting'), false);
  const enZhOnly = getCharacterExtractionPrompt(cfgOf('en', { default_style_zh: '水墨工笔' }));
  assert.equal(enZhOnly.includes('水墨工笔'), false);

  const explicitScene = getSceneExtractionPrompt(zh, 'explicit-style-token');
  assert.equal(explicitScene.includes('explicit-style-token'), true);
  assert.equal(explicitScene.includes('水墨工笔'), false);
  assert.equal(explicitScene.includes('ink wash painting'), false);
  assert.equal(explicitScene.includes('fallback-style'), false);

  const roleZh = getRolePolishPrompt(zh);
  const roleEnCfg = getRolePolishPrompt(en);
  assert.equal(roleZh.includes('水墨工笔'), true);
  assert.equal(roleZh.includes('ink wash painting'), false);
  assert.equal(roleZh.includes('fallback-style'), false);
  assert.equal(roleEnCfg.includes('水墨工笔'), true);
  assert.equal(roleEnCfg.includes('ink wash painting'), false);
  assert.equal(getRolePolishPrompt(cfgOf('zh', { default_style_en: 'ink wash painting' })).includes('ink wash painting'), false);
  assert.equal(getRolePolishPrompt(cfgOf('zh', { default_style: 'fallback-style' })).includes('fallback-style'), true);

  const propZh = getPropPolishPrompt(zh);
  const propEn = getPropPolishPrompt(en);
  assert.equal(propZh.includes('水墨工笔'), true);
  assert.equal(propZh.includes('ink wash painting'), false);
  assert.equal(propZh.includes('fallback-style'), false);
  assert.equal(propEn.includes('ink wash painting'), true);
  assert.equal(propEn.includes('fallback-style'), false);
  assert.equal(getPropPolishPrompt(cfgOf('zh', { default_style_en: 'ink wash painting' })).includes('ink wash painting'), false);
  assert.equal(getPropPolishPrompt(cfgOf('en', { default_style_zh: '水墨工笔' })).includes('fallback-style'), false);
  assert.equal(getPropPolishPrompt(cfgOf('en', { default_style: 'fallback-style' })).includes('fallback-style'), true);

  const imgZh = getImagePolishPrompt(zh);
  assert.equal(imgZh.includes('水墨工笔'), false);
  assert.equal(imgZh.includes('ink wash painting'), false);
  assert.equal(imgZh.includes('fallback-style'), false);
  assert.equal(getStoryExpansionSystemPrompt(zh, 2).includes('水墨工笔'), false);
  assert.equal(getIdentityAnchorsPrompt().includes('fallback-style'), false);
});

test('提取/扩展/润色/全能模板按职责互不混用', () => {
  const zh = cfgOf('zh', STYLE_CFG);
  const en = cfgOf('en', STYLE_CFG);

  assert.match(getCharacterExtractionPrompt(zh), /^你是一个专业的角色分析师/);
  assert.match(getCharacterExtractionPrompt(en), /^You are a professional character analyst/);
  assert.equal(getCharacterExtractionPrompt(en).includes('角色分析师'), false);
  assert.equal(getCharacterExtractionPrompt(zh).includes('professional character analyst'), false);

  assert.equal(getPropExtractionPrompt(zh).includes('剧本道具分析师'), true);
  assert.equal(getPropExtractionPrompt(en).includes('script prop analyst'), true);
  assert.equal(getPropExtractionPrompt(en).includes('剧本道具分析师'), false);

  assert.equal(getSceneExtractionPrompt(zh).includes('提取所有唯一的场景背景'), true);
  assert.equal(getSceneExtractionPrompt(en).includes('Extract all unique scene backgrounds'), true);
  assert.equal(getSceneExtractionPrompt(en).includes('提取所有唯一的场景背景'), false);

  assert.equal(getStoryExpansionSystemPrompt(zh, 3).includes('创作 3 集完整的短片剧本'), true);
  assert.equal(getStoryExpansionSystemPrompt(en, 3).includes("expand the user's story premise into 3 episode(s)"), true);
  assert.equal(getStoryExpansionSystemPrompt(en, 3).includes('短片剧本'), false);

  assert.match(getRolePolishPrompt(zh), /^# 工业角色参考表标准提示词生成器/);
  assert.match(getRoleGenerateImagePrompt(), /^Industrial character reference sheet/);
  assert.notEqual(getRolePolishPrompt(zh), getRoleGenerateImagePrompt());

  assert.equal(getImagePolishPrompt(zh).includes('静态单帧'), true);
  assert.equal(getImagePolishPrompt(en).includes('STATIC SINGLE FRAME'), true);
  assert.equal(getImagePolishPrompt(en).includes('静态单帧'), false);

  const omni = getUniversalOmniSegmentPrompt();
  const polish = getUniversalOmniPolishPrompt();
  assert.equal(omni.includes('MULTI_BEAT_OUTPUT'), true);
  assert.equal(omni.includes(DEFAULT_LINE3), true);
  assert.equal(polish.includes(omni), true);
  assert.equal(polish.includes('ADDITIONAL_POLISH_MODE'), true);
  assert.equal(omni.includes('ADDITIONAL_POLISH_MODE'), false);

  assert.equal(getIdentityAnchorsPrompt().includes('face_shape'), true);
  assert.equal(getContinuitySnapshotPrompt().includes('screen_position'), true);
  assert.equal(getRegenerateLayoutDescriptionPrompt(zh).includes('layout_description'), true);
  assert.equal(getRegenerateLayoutDescriptionPrompt(en).includes('You are a professional film continuity supervisor'), true);
  assert.notEqual(getRegenerateLayoutDescriptionPrompt(zh), getRegenerateLayoutDescriptionPrompt(en));

  assert.equal(getPropPolishPrompt(zh).includes('道具图片提示词生成器（中文版）'), true);
  assert.equal(getPropPolishPrompt(en).includes('英文生图提示词'), true);
  assert.equal(getPropPolishPrompt(en).includes('道具图片提示词生成器（中文版）'), false);
});

test('覆盖缓存与 promptI18n 是同一对象，且 character_extraction 不得污染其他 key', () => {
  const zh = cfgOf('zh', STYLE_CFG);
  const en = cfgOf('en', STYLE_CFG);
  promptI18n.setOverrideInMemory('character_extraction', '覆盖角色提取正文');
  promptI18n.setOverrideInMemory('prop_extraction', '覆盖道具提取正文');
  promptI18n.setOverrideInMemory('scene_extraction', '覆盖场景提取正文');
  promptI18n.setOverrideInMemory('story_expansion_system', '覆盖故事扩展正文');
  promptI18n.setOverrideInMemory('storyboard_system', '覆盖分镜系统正文');
  try {
    const character = getCharacterExtractionPrompt(zh);
    assert.equal(character, promptI18n.getCharacterExtractionPrompt(zh));
    assert.match(character, /^覆盖角色提取正文/);
    assert.equal(character.includes('水墨工笔'), true);
    assert.equal(character.includes('覆盖道具提取正文'), false);
    assert.equal(character.includes('覆盖场景提取正文'), false);
    assert.equal(character.includes('覆盖故事扩展正文'), false);
    assert.equal(character.includes('覆盖分镜系统正文'), false);

    const prop = getPropExtractionPrompt(zh);
    assert.match(prop, /^覆盖道具提取正文/);
    assert.equal(prop.includes('覆盖角色提取正文'), false);

    const scene = getSceneExtractionPrompt(zh);
    assert.match(scene, /^覆盖场景提取正文/);
    assert.equal(scene.includes('覆盖角色提取正文'), false);

    const story = getStoryExpansionSystemPrompt(zh, 2);
    assert.match(story, /^覆盖故事扩展正文/);
    assert.equal(story.includes('覆盖角色提取正文'), false);

    assert.equal(getRolePolishPrompt(zh).includes('覆盖角色提取正文'), false);
    assert.equal(getRoleGenerateImagePrompt().includes('覆盖角色提取正文'), false);
    assert.equal(getImagePolishPrompt(zh).includes('覆盖角色提取正文'), false);
    assert.equal(getPropPolishPrompt(zh).includes('覆盖角色提取正文'), false);
    assert.equal(getIdentityAnchorsPrompt().includes('覆盖角色提取正文'), false);
    assert.equal(getUniversalOmniSegmentPrompt().includes('覆盖角色提取正文'), false);
    assert.equal(getUniversalOmniPolishPrompt().includes('覆盖角色提取正文'), false);
    assert.equal(getContinuitySnapshotPrompt().includes('覆盖角色提取正文'), false);
    assert.equal(getRegenerateLayoutDescriptionPrompt(zh).includes('覆盖角色提取正文'), false);
    assert.equal(promptI18n.getStoryboardSystemPrompt(zh).includes('覆盖角色提取正文'), false);

    assert.equal(getCharacterExtractionPrompt(en).includes('覆盖角色提取正文'), false);
    assert.equal(getPropExtractionPrompt(en).includes('覆盖道具提取正文'), false);
    assert.equal(getSceneExtractionPrompt(en).includes('覆盖场景提取正文'), false);
    assert.equal(getStoryExpansionSystemPrompt(en, 2).includes('覆盖故事扩展正文'), false);
  } finally {
    promptI18n.clearOverrideInMemory('character_extraction');
    promptI18n.clearOverrideInMemory('prop_extraction');
    promptI18n.clearOverrideInMemory('scene_extraction');
    promptI18n.clearOverrideInMemory('story_expansion_system');
    promptI18n.clearOverrideInMemory('storyboard_system');
  }
  assert.equal(getCharacterExtractionPrompt(zh).startsWith('覆盖角色提取正文'), false);
  assert.equal(getPropExtractionPrompt(zh).startsWith('覆盖道具提取正文'), false);
});
