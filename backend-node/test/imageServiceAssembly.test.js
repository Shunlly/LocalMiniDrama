const assert = require('node:assert/strict');
const test = require('node:test');

const imageService = require('../src/services/imageService');
const assembly = require('../src/services/imageServiceAssembly');
const {
  rowToItem,
  aspectRatioToSize,
  parseTargetPixelsFromSizeString,
  mergePromptWithStyle,
  isUsableProviderReference,
  isLastFrameType,
  resolveUseFirstFrameLayoutLock,
  rowUseFirstFrameLayoutLock,
} = assembly;

test('imageService 公开 API 仍指向装配模块的同一函数', () => {
  assert.equal(imageService.aspectRatioToSize, aspectRatioToSize);
  assert.equal(imageService.isUsableProviderReference, isUsableProviderReference);
});

test('行装配会把空的 scene_id / frame_type 转成 undefined，其余字段原样透出', () => {
  const item = rowToItem({
    id: 77,
    storyboard_id: 4404,
    drama_id: 11,
    scene_id: null,
    character_id: 55,
    provider: 'openai',
    prompt: '夜雨',
    model: 'm1',
    image_url: '/static/a.png',
    local_path: 'projects/a.png',
    status: 'completed',
    task_id: 't1',
    error_msg: null,
    frame_type: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-02',
    completed_at: '2026-01-03',
  });
  assert.equal(item.id, 77);
  assert.equal(item.storyboard_id, 4404);
  assert.equal(item.drama_id, 11);
  assert.equal(item.scene_id, undefined);
  assert.equal(item.character_id, 55);
  assert.equal(item.frame_type, undefined);
  assert.equal(item.local_path, 'projects/a.png');
  assert.equal(item.completed_at, '2026-01-03');
  assert.equal(rowToItem({ id: 1, scene_id: 0, frame_type: 'first' }).scene_id, 0);
  assert.equal(rowToItem({ id: 1, scene_id: 0, frame_type: 'first' }).frame_type, 'first');
});

test('宽高比映射与像素解析覆盖已知比例、x/* 分隔和非法输入', () => {
  assert.equal(aspectRatioToSize('9:16'), '1440x2560');
  assert.equal(aspectRatioToSize('16:9'), '2560x1440');
  assert.equal(aspectRatioToSize('1:1'), '1920x1920');
  assert.equal(aspectRatioToSize('unknown'), null);
  assert.deepEqual(parseTargetPixelsFromSizeString('2560x1440'), { w: 2560, h: 1440 });
  assert.deepEqual(parseTargetPixelsFromSizeString(' 1440*2560 '), { w: 1440, h: 2560 });
  assert.deepEqual(parseTargetPixelsFromSizeString('1920X1920'), { w: 1920, h: 1920 });
  assert.equal(parseTargetPixelsFromSizeString(''), null);
  assert.equal(parseTargetPixelsFromSizeString(2560), null);
  assert.equal(parseTargetPixelsFromSizeString('2560'), null);
  assert.equal(parseTargetPixelsFromSizeString('0x1440'), null);
});

test('风格合并与参考图可用性判断保持原语义', () => {
  assert.equal(mergePromptWithStyle('夜雨', ''), '夜雨');
  assert.equal(mergePromptWithStyle('', 'cinematic'), 'cinematic');
  assert.equal(mergePromptWithStyle('夜雨 cinematic', 'cinematic'), '夜雨 cinematic');
  assert.equal(mergePromptWithStyle('夜雨', 'cinematic'), '夜雨, cinematic');
  assert.equal(isUsableProviderReference('projects/a.png'), true);
  assert.equal(isUsableProviderReference('https://cdn.example/a.png'), true);
  assert.equal(isUsableProviderReference('mock://scene'), false);
  assert.equal(isUsableProviderReference('placeholder://char'), false);
  assert.equal(isUsableProviderReference('  '), false);
  assert.equal(isUsableProviderReference(null), false);
});

test('尾帧判定与首帧站位锁只作用于尾帧类型', () => {
  assert.equal(isLastFrameType('last'), true);
  assert.equal(isLastFrameType('STORYBOARD_LAST'), true);
  assert.equal(isLastFrameType('tail'), true);
  assert.equal(isLastFrameType('last_frame'), true);
  assert.equal(isLastFrameType('first'), false);
  assert.equal(isLastFrameType(''), false);
  assert.equal(isLastFrameType(null), false);
  assert.equal(resolveUseFirstFrameLayoutLock({}, 'first'), null);
  assert.equal(resolveUseFirstFrameLayoutLock({}, 'last'), 1);
  assert.equal(resolveUseFirstFrameLayoutLock({ use_first_frame_layout_lock: 0 }, 'last'), 0);
  assert.equal(resolveUseFirstFrameLayoutLock({ use_first_frame_layout_lock: '0' }, 'storyboard_last'), 0);
  assert.equal(resolveUseFirstFrameLayoutLock({ use_first_frame_layout_lock: true }, 'tail'), 1);
  assert.equal(rowUseFirstFrameLayoutLock({ frame_type: 'first' }), false);
  assert.equal(rowUseFirstFrameLayoutLock({ frame_type: 'last', use_first_frame_layout_lock: 0 }), false);
  assert.equal(rowUseFirstFrameLayoutLock({ frame_type: 'last', use_first_frame_layout_lock: null }), true);
  assert.equal(rowUseFirstFrameLayoutLock({ frame_type: 'last' }), true);
});