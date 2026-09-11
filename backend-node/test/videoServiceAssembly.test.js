const assert = require('node:assert/strict');
const test = require('node:test');

const videoService = require('../src/services/videoService');
const assembly = require('../src/services/videoServiceAssembly');
const {
  rowToItem,
  parseReferenceImageUrls,
  targetVideoPixelsForAspect,
} = assembly;

test('videoService 公开 API 仍指向装配模块的同一函数', () => {
  assert.equal(videoService.targetVideoPixelsForAspect, targetVideoPixelsForAspect);
});

test('行装配解析参考图 JSON，并把缺失尾帧字段补成 null', () => {
  const item = rowToItem({
    id: 77,
    storyboard_id: 5505,
    drama_id: 11,
    provider: 'seedance',
    prompt: '夜雨',
    model: 'm1',
    image_gen_id: 9,
    image_url: '/static/a.png',
    first_frame_url: '/static/f.png',
    last_frame_url: undefined,
    reference_image_urls: '["/static/a.png","/static/b.png"]',
    video_url: 'https://cdn.example/v.mp4',
    local_path: 'projects/v.mp4',
    status: 'completed',
    task_id: 't1',
    provider_task_id: 'p1',
    idempotency_key: 'k1',
    error_msg: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-02',
    completed_at: '2026-01-03',
  });
  assert.equal(item.id, 77);
  assert.equal(item.storyboard_id, 5505);
  assert.equal(item.drama_id, 11);
  assert.equal(item.last_frame_url, null);
  assert.deepEqual(item.reference_image_urls, ['/static/a.png', '/static/b.png']);
  assert.equal(item.provider_task_id, 'p1');
  assert.equal(item.completed_at, '2026-01-03');
  assert.deepEqual(rowToItem({ id: 1, reference_image_urls: '{' }).reference_image_urls, []);
  assert.deepEqual(rowToItem({ id: 1, reference_image_urls: '{"a":1}' }).reference_image_urls, []);
  assert.deepEqual(rowToItem({ id: 1 }).reference_image_urls, []);
  assert.deepEqual(parseReferenceImageUrls('["/static/a.png"]'), ['/static/a.png']);
  assert.deepEqual(parseReferenceImageUrls(null), []);
});

test('宽高比映射覆盖已知比例、p 档短边和非法输入', () => {
  assert.deepEqual(targetVideoPixelsForAspect('16:9'), { w: 2560, h: 1440 });
  assert.deepEqual(targetVideoPixelsForAspect('9:16'), { w: 1440, h: 2560 });
  assert.deepEqual(targetVideoPixelsForAspect('1:1'), { w: 1920, h: 1920 });
  assert.deepEqual(targetVideoPixelsForAspect('21:9'), { w: 2560, h: 1080 });
  assert.deepEqual(targetVideoPixelsForAspect('16:9', '720p'), { w: 1280, h: 720 });
  assert.deepEqual(targetVideoPixelsForAspect('9:16', '1080p'), { w: 1080, h: 1920 });
  assert.deepEqual(targetVideoPixelsForAspect('5:4'), { w: 2560, h: 2048 });
  assert.deepEqual(targetVideoPixelsForAspect('unknown'), { w: 1280, h: 720 });
  assert.deepEqual(targetVideoPixelsForAspect(''), { w: 2560, h: 1440 });
});
