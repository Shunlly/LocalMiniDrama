const test = require('node:test');
const assert = require('node:assert/strict');

const scene = require('../src/services/promptI18nScene');
const promptI18n = require('../src/services/promptI18n');

const {
  getScenePolishPrompt,
  getScenePolishPromptSingle,
  getSceneGenerateImagePrompt,
  getSceneGenerateSingleImagePrompt,
} = scene;

test('promptI18n 原样再导出场景润色与生图函数', () => {
  assert.equal(promptI18n.getScenePolishPrompt, getScenePolishPrompt);
  assert.equal(promptI18n.getScenePolishPromptSingle, getScenePolishPromptSingle);
  assert.equal(promptI18n.getSceneGenerateImagePrompt, getSceneGenerateImagePrompt);
  assert.equal(promptI18n.getSceneGenerateSingleImagePrompt, getSceneGenerateSingleImagePrompt);
});

test('单图润色与四视图润色不得互换，英文配置仍只注入中文画风字段', () => {
  const cfg = {
    app: { language: 'en' },
    style: {
      default_style_zh: '水墨工笔',
      default_style_en: 'ink wash painting',
      default_style: 'fallback-style',
    },
  };
  const four = getScenePolishPrompt(cfg);
  const single = getScenePolishPromptSingle(cfg);
  assert.match(four, /^# 场景四视图参考图生成器/);
  assert.match(single, /^# 场景单图参考图生成器/);
  assert.equal(four.includes('四格固定顺序'), true);
  assert.equal(single.includes('非四宫格'), true);
  assert.equal(four.includes('非四宫格'), false);
  assert.equal(four.includes('水墨工笔'), true);
  assert.equal(single.includes('水墨工笔'), true);
  assert.equal(four.includes('ink wash painting'), false);
  assert.equal(single.includes('ink wash painting'), false);
  assert.equal(four.includes('fallback-style'), false);
  assert.notEqual(four, single);
});

test('缺中文画风时不回退到英文画风，空画风不加画风行', () => {
  const enOnly = {
    app: { language: 'en' },
    style: { default_style_en: 'cinematic photo' },
  };
  const four = getScenePolishPrompt(enOnly);
  assert.equal(four.includes('cinematic photo'), false);
  assert.equal(four.includes('画风风格'), false);

  const fallback = {
    app: { language: 'zh' },
    style: { default_style: 'fallback-style' },
  };
  assert.equal(getScenePolishPrompt(fallback).includes('fallback-style'), true);
  assert.equal(getScenePolishPrompt({}).includes('场景四视图参考图生成器'), true);
  assert.equal(getScenePolishPrompt({}).includes('画风风格'), false);
});

test('生图系统提示与润色模板分离：四宫格生图不含润色标题，单图生图不含网格', () => {
  const fourGen = getSceneGenerateImagePrompt();
  const singleGen = getSceneGenerateSingleImagePrompt();
  const fourPolish = getScenePolishPrompt({});
  assert.equal(fourGen.includes('2\u00d72 grid'), true);
  assert.equal(singleGen.includes('2\u00d72'), false);
  assert.equal(singleGen.includes('no grid'), true);
  assert.equal(fourGen.includes('场景四视图参考图生成器'), false);
  assert.equal(singleGen.includes('场景单图参考图生成器'), false);
  assert.equal(fourPolish.includes('2\u00d72 grid'), false);
  assert.notEqual(fourGen, singleGen);
});

test('场景提取覆盖缓存不得污染场景润色或生图', () => {
  const cfg = { app: { language: 'zh' }, style: { default_style_zh: '水墨' } };
  promptI18n.setOverrideInMemory('scene_extraction', '覆盖场景提取正文');
  try {
    assert.equal(getScenePolishPrompt(cfg).includes('覆盖场景提取正文'), false);
    assert.equal(getScenePolishPromptSingle(cfg).includes('覆盖场景提取正文'), false);
    assert.equal(getSceneGenerateImagePrompt().includes('覆盖场景提取正文'), false);
    assert.equal(getSceneGenerateSingleImagePrompt().includes('覆盖场景提取正文'), false);
    assert.match(promptI18n.getSceneExtractionPrompt(cfg), /^覆盖场景提取正文/);
  } finally {
    promptI18n.clearOverrideInMemory('scene_extraction');
  }
});
