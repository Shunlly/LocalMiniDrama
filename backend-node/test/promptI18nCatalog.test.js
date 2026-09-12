const test = require('node:test');
const assert = require('node:assert/strict');

const catalog = require('../src/services/promptI18nCatalog');
const promptI18n = require('../src/services/promptI18n');

const {
  buildUserPromptTemplates,
  STORY_STYLE_LABELS,
  STORY_TYPE_LABELS,
  getDefaultPromptBody,
  getLockedSuffix,
} = catalog;

const OVERRIDE_BODY_KEYS = [
  'story_expansion_system',
  'storyboard_system',
  'character_extraction',
  'scene_extraction',
  'prop_extraction',
  'storyboard_user_suffix',
  'first_frame_prompt',
  'key_frame_prompt',
  'last_frame_prompt',
];

test('用户模板按语言分目录，且 character_request 与 character_extraction 不可互换', () => {
  const templates = buildUserPromptTemplates('水墨', '9:16');
  assert.ok(templates.zh.character_request.includes('%s'));
  assert.equal(templates.zh.character_extraction, undefined);
  assert.equal(templates.en.character_extraction, undefined);
  assert.notEqual(templates.zh.character_request, templates.en.character_request);
  assert.ok(templates.zh.drama_info_template.includes('水墨'));
  assert.ok(templates.zh.drama_info_template.includes('9:16'));
  assert.ok(templates.en.drama_info_template.includes('Style: 水墨'));
  assert.equal(templates.zh.script_content_label, '【剧本内容】');
  assert.equal(templates.en.script_content_label, '【Script Content】');
});

test('画风和比例只写入 drama_info_template，不会串进无占位模板', () => {
  const templates = buildUserPromptTemplates('UNIQUE_STYLE_TOKEN', '21:9');
  assert.equal(templates.zh.task_label.includes('UNIQUE_STYLE_TOKEN'), false);
  assert.equal(templates.en.frame_info.includes('21:9'), false);
  assert.match(templates.zh.drama_info_template, /风格: UNIQUE_STYLE_TOKEN/);
  assert.match(templates.en.drama_info_template, /Image ratio: 21:9/);
});

test('故事风格标签与剧本类型标签不得按同名 key 互换', () => {
  assert.equal(STORY_STYLE_LABELS.zh.modern, '现代');
  assert.equal(STORY_STYLE_LABELS.en.ancient, 'Period/Ancient');
  assert.equal(STORY_TYPE_LABELS.zh.drama, '剧情');
  assert.equal(STORY_TYPE_LABELS.en.comedy, 'Comedy');
  assert.equal(STORY_STYLE_LABELS.zh.drama, undefined);
  assert.equal(STORY_STYLE_LABELS.en.comedy, undefined);
  assert.equal(STORY_TYPE_LABELS.zh.modern, undefined);
  assert.equal(STORY_TYPE_LABELS.en.ancient, undefined);
  assert.notEqual(STORY_STYLE_LABELS.zh.modern, STORY_TYPE_LABELS.zh.drama);
});

test('可覆盖默认正文按提示词 key 取值，未知 key 为空字符串', () => {
  for (const key of OVERRIDE_BODY_KEYS) {
    const body = getDefaultPromptBody(key);
    assert.equal(typeof body, 'string');
    assert.ok(body.length > 0, key);
  }
  assert.equal(getDefaultPromptBody('character_request'), '');
  assert.equal(getDefaultPromptBody('unknown'), '');
  assert.equal(getDefaultPromptBody(''), '');
  assert.equal(getDefaultPromptBody('toString'), '');
  assert.notEqual(getDefaultPromptBody('storyboard_system'), getDefaultPromptBody('storyboard_user_suffix'));
  assert.notEqual(getDefaultPromptBody('first_frame_prompt'), getDefaultPromptBody('last_frame_prompt'));
  assert.notEqual(getDefaultPromptBody('character_extraction'), getDefaultPromptBody('scene_extraction'));
});

test('锁定后缀按提示词 key 取值；已知无后缀与未知 key 都是 null，但正文可区分', () => {
  assert.equal(getLockedSuffix('story_expansion_system'), null);
  assert.equal(getLockedSuffix('unknown'), null);
  assert.notEqual(getDefaultPromptBody('story_expansion_system'), '');
  assert.equal(getDefaultPromptBody('unknown'), '');
  assert.equal(getLockedSuffix('first_frame_prompt'), getLockedSuffix('key_frame_prompt'));
  assert.equal(getLockedSuffix('key_frame_prompt'), getLockedSuffix('last_frame_prompt'));
  assert.notEqual(getLockedSuffix('storyboard_system'), getLockedSuffix('storyboard_user_suffix'));
  assert.notEqual(getLockedSuffix('character_extraction'), getLockedSuffix('scene_extraction'));
  assert.equal(getLockedSuffix('character_request'), null);
  assert.ok(getLockedSuffix('prop_extraction').includes('[当前道具风格]'));
});

test('promptI18n 原样再导出目录取值函数', () => {
  assert.equal(promptI18n.getDefaultPromptBody, getDefaultPromptBody);
  assert.equal(promptI18n.getLockedSuffix, getLockedSuffix);
  assert.equal(promptI18n.getDefaultPromptBody('prop_extraction'), getDefaultPromptBody('prop_extraction'));
});
