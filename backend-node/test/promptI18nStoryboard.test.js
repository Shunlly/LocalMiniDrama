const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const storyboard = require('../src/services/promptI18nStoryboard');
const storyboardPrompts = require('../src/services/promptI18nStoryboardPrompts');
const promptI18n = require('../src/services/promptI18n');
const { DEFAULT_LINE3 } = require('../src/services/universalOmniMultiBeatFormat');

const {
  getStoryboardSystemPrompt,
  getUniversalOmniMultiBeatFormatSpec,
  getStoryboardUniversalOmniModeSuffix,
  getStoryboardNarrationExtraInstructions,
  getStoryboardUserPromptSuffix,
  getFirstFramePrompt,
  getKeyFramePrompt,
  getLastFramePrompt,
} = storyboard;

const STYLE_CFG = {
  default_style_zh: '水墨工笔',
  default_style_en: 'ink wash painting',
  default_style: 'fallback-style',
  default_image_ratio: '9:16',
};

function cfgOf(lang, style) {
  return { app: { language: lang }, style: { ...style } };
}

test('promptI18n 原样再导出分镜与首/关键/尾帧函数', () => {
  assert.equal(promptI18n.getStoryboardSystemPrompt, getStoryboardSystemPrompt);
  assert.equal(promptI18n.getUniversalOmniMultiBeatFormatSpec, getUniversalOmniMultiBeatFormatSpec);
  assert.equal(promptI18n.getStoryboardUniversalOmniModeSuffix, getStoryboardUniversalOmniModeSuffix);
  assert.equal(promptI18n.getStoryboardNarrationExtraInstructions, getStoryboardNarrationExtraInstructions);
  assert.equal(promptI18n.getStoryboardUserPromptSuffix, getStoryboardUserPromptSuffix);
  assert.equal(promptI18n.getFirstFramePrompt, getFirstFramePrompt);
  assert.equal(promptI18n.getKeyFramePrompt, getKeyFramePrompt);
  assert.equal(promptI18n.getLastFramePrompt, getLastFramePrompt);
});

test('default_style_zh / default_style_en / default_style 不得互相顶替', () => {
  const zh = cfgOf('zh', STYLE_CFG);
  const en = cfgOf('en', STYLE_CFG);
  for (const fn of [getFirstFramePrompt, getKeyFramePrompt, getLastFramePrompt]) {
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

  const zhFallback = getFirstFramePrompt(cfgOf('zh', { default_style: 'fallback-style' }));
  assert.equal(zhFallback.includes('fallback-style'), true);
  const zhEnOnly = getFirstFramePrompt(cfgOf('zh', { default_style_en: 'ink wash painting' }));
  assert.equal(zhEnOnly.includes('ink wash painting'), false);
  const enZhOnly = getFirstFramePrompt(cfgOf('en', { default_style_zh: '水墨工笔' }));
  assert.equal(enZhOnly.includes('水墨工笔'), false);

  const systemZh = getStoryboardSystemPrompt(zh);
  assert.equal(systemZh.includes('水墨工笔'), false);
  assert.equal(systemZh.includes('ink wash painting'), false);
  assert.equal(systemZh.includes('fallback-style'), false);
});

test('首帧/关键帧/尾帧模板互不混用', () => {
  const zh = cfgOf('zh', STYLE_CFG);
  const first = getFirstFramePrompt(zh);
  const key = getKeyFramePrompt(zh);
  const last = getLastFramePrompt(zh);
  assert.equal(first.includes('这是镜头的首帧'), true);
  assert.equal(key.includes('这是镜头的关键帧'), true);
  assert.equal(last.includes('这是镜头的尾帧'), true);
  assert.equal(first.includes('这是镜头的关键帧'), false);
  assert.equal(first.includes('这是镜头的尾帧'), false);
  assert.equal(key.includes('这是镜头的首帧'), false);
  assert.equal(last.includes('这是镜头的首帧'), false);
  assert.notEqual(first, key);
  assert.notEqual(key, last);
  assert.notEqual(first, last);

  const firstEn = getFirstFramePrompt(cfgOf('en', STYLE_CFG));
  const keyEn = getKeyFramePrompt(cfgOf('en', STYLE_CFG));
  const lastEn = getLastFramePrompt(cfgOf('en', STYLE_CFG));
  assert.equal(firstEn.includes('FIRST FRAME'), true);
  assert.equal(keyEn.includes('KEY FRAME'), true);
  assert.equal(lastEn.includes('LAST FRAME'), true);
  assert.equal(firstEn.includes('KEY FRAME'), false);
  assert.equal(firstEn.includes('LAST FRAME'), false);
});

test('分镜系统提示、用户后缀、旁白与全能格式按语言分支，互不混用', () => {
  const zh = cfgOf('zh', STYLE_CFG);
  const en = cfgOf('en', STYLE_CFG);
  const sysZh = getStoryboardSystemPrompt(zh);
  const sysEn = getStoryboardSystemPrompt(en);
  assert.match(sysZh, /^【角色】你是一位资深影视分镜师/);
  assert.match(sysEn, /^\[Role\] You are a senior film storyboard artist/);
  assert.equal(sysEn.includes('资深影视分镜师'), false);
  assert.equal(sysZh.includes('senior film storyboard artist'), false);

  const suffixZh = getStoryboardUserPromptSuffix(zh, 7);
  const suffixEn = getStoryboardUserPromptSuffix(en, 7);
  assert.match(suffixZh, /每镜头约7秒/);
  assert.match(suffixEn, /approximately 7s per shot/);
  assert.equal(suffixEn.includes('每镜头约'), false);
  assert.equal(suffixZh.includes('approximately'), false);

  const narZh = getStoryboardNarrationExtraInstructions(zh);
  const narEn = getStoryboardNarrationExtraInstructions(en);
  assert.equal(narZh.includes('解说旁白模式'), true);
  assert.equal(narEn.includes('VO / Narration mode'), true);
  assert.equal(narEn.includes('解说旁白模式'), false);
  assert.equal(narZh.includes('VO / Narration mode'), false);

  const specZh = getUniversalOmniMultiBeatFormatSpec(zh);
  const specEn = getUniversalOmniMultiBeatFormatSpec(en);
  assert.equal(specZh.includes('多子分镜段落格式'), true);
  assert.equal(specEn.includes('MULTI-BEAT BLOCK FORMAT ONLY'), true);
  assert.equal(specZh.includes(DEFAULT_LINE3), true);
  assert.equal(specEn.includes(DEFAULT_LINE3), true);
  assert.equal(specEn.includes('多子分镜段落格式'), false);
  assert.equal(getStoryboardUniversalOmniModeSuffix(zh).includes(specZh), true);
  assert.equal(getStoryboardUniversalOmniModeSuffix(en).includes(specEn), true);
  assert.equal(promptI18n.getUniversalOmniSegmentPrompt().includes(specZh), true);
});

test('覆盖缓存与 promptI18n 是同一对象，且 storyboard_system 不得污染其他 key', () => {
  const zh = cfgOf('zh', STYLE_CFG);
  const en = cfgOf('en', STYLE_CFG);
  promptI18n.setOverrideInMemory('storyboard_system', '覆盖分镜系统正文');
  promptI18n.setOverrideInMemory('storyboard_user_suffix', '覆盖分镜用户后缀');
  promptI18n.setOverrideInMemory('first_frame_prompt', '覆盖首帧正文');
  promptI18n.setOverrideInMemory('key_frame_prompt', '覆盖关键帧正文');
  promptI18n.setOverrideInMemory('last_frame_prompt', '覆盖尾帧正文');
  promptI18n.setOverrideInMemory('scene_extraction', '覆盖场景提取正文');
  try {
    const sys = getStoryboardSystemPrompt(zh);
    const suffix = getStoryboardUserPromptSuffix(zh, 5);
    const first = getFirstFramePrompt(zh);
    const key = getKeyFramePrompt(zh);
    const last = getLastFramePrompt(zh);
    assert.equal(sys, promptI18n.getStoryboardSystemPrompt(zh));
    assert.match(sys, /^覆盖分镜系统正文/);
    assert.equal(sys.includes('覆盖首帧正文'), false);
    assert.equal(sys.includes('覆盖场景提取正文'), false);
    assert.equal(suffix.includes('覆盖分镜用户后缀'), true);
    assert.equal(suffix.includes('覆盖分镜系统正文'), false);
    assert.match(first, /^覆盖首帧正文/);
    assert.equal(first.includes('水墨工笔'), true);
    assert.equal(first.includes('覆盖关键帧正文'), false);
    assert.equal(first.includes('覆盖尾帧正文'), false);
    assert.equal(first.includes('覆盖分镜系统正文'), false);
    assert.match(key, /^覆盖关键帧正文/);
    assert.equal(key.includes('覆盖首帧正文'), false);
    assert.match(last, /^覆盖尾帧正文/);
    assert.equal(last.includes('覆盖首帧正文'), false);
    assert.equal(getFirstFramePrompt(en).includes('覆盖首帧正文'), false);
    assert.equal(getStoryboardSystemPrompt(en).includes('覆盖分镜系统正文'), false);
    assert.match(promptI18n.getSceneExtractionPrompt(zh), /^覆盖场景提取正文/);
    assert.equal(promptI18n.getSceneExtractionPrompt(zh).includes('覆盖分镜系统正文'), false);
  } finally {
    promptI18n.clearOverrideInMemory('storyboard_system');
    promptI18n.clearOverrideInMemory('storyboard_user_suffix');
    promptI18n.clearOverrideInMemory('first_frame_prompt');
    promptI18n.clearOverrideInMemory('key_frame_prompt');
    promptI18n.clearOverrideInMemory('last_frame_prompt');
    promptI18n.clearOverrideInMemory('scene_extraction');
  }
  assert.equal(getStoryboardSystemPrompt(zh).startsWith('覆盖分镜系统正文'), false);
  assert.equal(getFirstFramePrompt(zh).startsWith('覆盖首帧正文'), false);
});

test('promptI18nStoryboard 公开导出不变，分镜提示词函数由拆分模块原样再导出', () => {
  assert.deepEqual(Object.keys(storyboard), [
    'setOverrideCacheRef',
    'getStoryboardSystemPrompt',
    'getUniversalOmniMultiBeatFormatSpec',
    'getStoryboardUniversalOmniModeSuffix',
    'getStoryboardNarrationExtraInstructions',
    'getStoryboardUserPromptSuffix',
    'getFirstFramePrompt',
    'getKeyFramePrompt',
    'getLastFramePrompt',
  ]);
  assert.equal(storyboard.getStoryboardSystemPrompt, storyboardPrompts.getStoryboardSystemPrompt);
  assert.equal(storyboard.getUniversalOmniMultiBeatFormatSpec, storyboardPrompts.getUniversalOmniMultiBeatFormatSpec);
  assert.equal(storyboard.getStoryboardUniversalOmniModeSuffix, storyboardPrompts.getStoryboardUniversalOmniModeSuffix);
  assert.equal(storyboard.getStoryboardNarrationExtraInstructions, storyboardPrompts.getStoryboardNarrationExtraInstructions);
  assert.equal(storyboard.getStoryboardUserPromptSuffix, storyboardPrompts.getStoryboardUserPromptSuffix);
  assert.notEqual(storyboard.setOverrideCacheRef, storyboardPrompts.setOverrideCacheRef);
  assert.equal(storyboard.getFirstFramePrompt, getFirstFramePrompt);
});

test('分镜系统提示词函数已抽到 promptI18nStoryboardPrompts.js', () => {
  const original = fs.readFileSync(path.join(__dirname, '../src/services/promptI18nStoryboard.js'), 'utf8');
  const extracted = [
    fs.readFileSync(path.join(__dirname, '../src/services/promptI18nStoryboardPrompts.js'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '../src/services/promptI18nStoryboardSystem.js'), 'utf8'),
  ].join('\n');
  for (const name of [
    'getStoryboardSystemPrompt',
    'getUniversalOmniMultiBeatFormatSpec',
    'getStoryboardUniversalOmniModeSuffix',
    'getStoryboardNarrationExtraInstructions',
    'getStoryboardUserPromptSuffix',
  ]) {
    assert.equal(original.includes('function ' + name + '('), false, name + ' still defined in facade');
    assert.equal(extracted.includes('function ' + name + '('), true, name + ' missing from split file');
  }
  assert.equal(original.includes('function getFirstFramePrompt('), true);
  assert.equal(original.includes('function getKeyFramePrompt('), true);
  assert.equal(original.includes('function getLastFramePrompt('), true);
  assert.equal(extracted.includes('function getFirstFramePrompt('), false);
  assert.equal(extracted.includes('function getKeyFramePrompt('), false);
  assert.equal(extracted.includes('function getLastFramePrompt('), false);
});
