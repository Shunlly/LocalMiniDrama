'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

const videoMergeService = require('../src/services/videoMergeService');
const {
  STRICT_PRODUCTION_MODE,
  MAX_STRICT_SCENES,
  pathWithinStorage,
  exactTrustedOrigin,
  parseMergeOptions,
  isStrictProductionMode,
  buildPersistedMergeOptions,
  storyboardIdForScene,
  assertStrictSceneCoverage,
  buildStrictSceneFilterPlan,
  assertFilterPlanMatchesScenes,
  chooseProductionDimensions,
  chooseProductionFps,
  chooseProductionVideoEncoder,
  relativeStoragePath,
  needsMergedEpisodePostProcess,
  productionDurationTolerance,
  assertProductionOutputHasAudio,
  assertProductionDurationComplete,
} = require('../src/services/videoMergePlanning');

test('videoMergeService 公开 API 保持不变', () => {
  assert.deepEqual(Object.keys(videoMergeService).sort(), [
    '__test',
    'buildStrictSceneFilterPlan',
    'completeQaPendingMerge',
    'create',
    'deleteById',
    'getById',
    'list',
    'processVideoMerge',
    'updateCurrentMergeEpisodeOutput',
  ].sort());
  assert.equal(videoMergeService.buildStrictSceneFilterPlan, buildStrictSceneFilterPlan);
});

test('合成选项解析兼容对象、数组和损坏 JSON', () => {
  assert.deepEqual(parseMergeOptions(null), {});
  assert.deepEqual(parseMergeOptions('{"mode":"strict_production"}'), { mode: 'strict_production' });
  assert.deepEqual(parseMergeOptions('[1,2]'), {});
  assert.deepEqual(parseMergeOptions('{not-json'), {});
});

test('严格生产模式由 mode / merge_mode / strict_production / model 任一触发', () => {
  assert.equal(isStrictProductionMode({}, { mode: STRICT_PRODUCTION_MODE }), true);
  assert.equal(isStrictProductionMode({}, { merge_mode: STRICT_PRODUCTION_MODE }), true);
  assert.equal(isStrictProductionMode({}, { strict_production: true }), true);
  assert.equal(isStrictProductionMode({ model: STRICT_PRODUCTION_MODE }, {}), true);
  assert.equal(isStrictProductionMode({}, { mode: 'draft' }), false);
});

test('持久化合成选项只在缺失时回填请求级严格生产标记', () => {
  assert.deepEqual(
    buildPersistedMergeOptions({ mode: STRICT_PRODUCTION_MODE, strict_production: true }),
    { mode: STRICT_PRODUCTION_MODE, strict_production: true }
  );
  assert.deepEqual(
    buildPersistedMergeOptions({
      mode: STRICT_PRODUCTION_MODE,
      merge_options: { mode: 'draft', watermark_text: '水印' },
    }),
    { mode: 'draft', watermark_text: '水印' }
  );
  assert.deepEqual(buildPersistedMergeOptions({ merge_options: [1] }), {});
});

test('分镜 ID 同时接受 storyboard_id 与旧字段 scene_id', () => {
  assert.equal(storyboardIdForScene({ storyboard_id: 12, scene_id: 9 }), 12);
  assert.equal(storyboardIdForScene({ scene_id: '8' }), 8);
  assert.equal(Number.isNaN(storyboardIdForScene({})), true);
});

test('严格生产分镜覆盖校验拒绝缺失、重复、越权、无效和数量不匹配', () => {
  const expected = [{ id: 101 }, { id: 102 }];
  const normalized = assertStrictSceneCoverage(
    [
      { scene_id: 101, duration: 1 },
      { storyboard_id: 102, duration: 2 },
    ],
    expected
  );
  assert.deepEqual(normalized.map((scene) => scene.storyboard_id), [101, 102]);
  assert.deepEqual(normalized.map((scene) => scene.scene_id), [101, 102]);

  assert.throws(() => assertStrictSceneCoverage([], expected), /缺少视频片段/);
  assert.throws(
    () => assertStrictSceneCoverage(Array.from({ length: MAX_STRICT_SCENES + 1 }, () => ({ storyboard_id: 101 })), expected),
    /最多支持 100 个分镜/
  );
  assert.throws(() => assertStrictSceneCoverage([{ storyboard_id: 101 }], []), /找不到预期分镜/);
  assert.throws(
    () => assertStrictSceneCoverage([{ storyboard_id: 101, duration: 1 }], expected),
    /缺少分镜 102/
  );
  assert.throws(
    () => assertStrictSceneCoverage(
      [{ storyboard_id: 101 }, { storyboard_id: 101 }],
      [{ id: 101 }]
    ),
    /重复分镜 101/
  );
  assert.throws(
    () => assertStrictSceneCoverage(
      [{ storyboard_id: 101 }, { storyboard_id: 999 }],
      expected
    ),
    /非本集分镜 999/
  );
  assert.throws(
    () => assertStrictSceneCoverage(
      [{ storyboard_id: 101 }, { duration: 1 }],
      expected
    ),
    /无效片段序号 2/
  );
});

test('滤镜计划按分镜时长生成 trim/atrim，且不匹配时失败关闭', () => {
  const plan = buildStrictSceneFilterPlan([
    { storyboard_id: 3, timeline_item_id: '9', duration: 1.23456789, start_sec: 0.5, end_sec: 2 },
    { scene_id: 4 },
  ]);
  assert.equal(plan.length, 2);
  assert.equal(plan[0].order, 0);
  assert.equal(plan[0].timeline_item_id, 9);
  assert.equal(plan[0].storyboard_id, 3);
  assert.equal(plan[0].duration, 1.234568);
  assert.equal(plan[0].video_filter, 'trim=duration=1.234568,setpts=PTS-STARTPTS');
  assert.equal(plan[0].audio_filter, 'atrim=duration=1.234568,asetpts=PTS-STARTPTS,apad');
  assert.equal(plan[1].duration, 0);
  assert.equal(plan[1].end_sec, 0);
  assert.deepEqual(buildStrictSceneFilterPlan(null), []);
  assertFilterPlanMatchesScenes(undefined, plan);
  assertFilterPlanMatchesScenes(plan, plan);
  assert.throws(() => assertFilterPlanMatchesScenes([{ order: 1 }], plan), /滤镜计划与合成分镜不匹配/);
});

test('生产输出规格选取最大片段并限制到 4K，帧率夹在 1 到 60', () => {
  assert.deepEqual(
    chooseProductionDimensions(
      [{ width: 160, height: 120 }, { width: 320, height: 180 }],
      {}
    ),
    { width: 320, height: 180 }
  );
  assert.deepEqual(
    chooseProductionDimensions([{ width: 160, height: 120 }], { output_width: 641, output_height: 361 }),
    { width: 640, height: 360 }
  );
  const scaled = chooseProductionDimensions([{ width: 8000, height: 4000 }], {});
  assert.ok(scaled.width <= 3840);
  assert.ok(scaled.height <= 2160);
  assert.equal(scaled.width % 2, 0);
  assert.equal(scaled.height % 2, 0);
  assert.equal(chooseProductionFps({}), 30);
  assert.equal(chooseProductionFps({ output_fps: 0 }), 30);
  assert.equal(chooseProductionFps({ output_fps: 24.4 }), 24);
  assert.equal(chooseProductionFps({ output_fps: 120 }), 60);
});

test('软件 H.264 编码器优先 libx264，否则 libopenh264，都没有则失败', () => {
  assert.deepEqual(
    chooseProductionVideoEncoder(['libopenh264', 'libx264'], 1920, 1080, 30).name,
    'libx264'
  );
  const openh264 = chooseProductionVideoEncoder(['libopenh264'], 1920, 1080, 30);
  assert.equal(openh264.name, 'libopenh264');
  const bitrate = '4977k';
  assert.deepEqual(openh264.outputArgs, ['-c:v', 'libopenh264', '-profile:v', 'high', '-b:v', bitrate]);
  assert.throws(
    () => chooseProductionVideoEncoder(['h264_nvenc'], 1920, 1080, 30),
    /缺少可用的软件 H\.264 编码器/
  );
});

test('存储路径校验拒绝逃逸，可信来源必须同源且不含用户信息', () => {
  const root = path.join(os.tmpdir(), 'video-merge-planning-root');
  const inside = path.join(root, 'videos', 'merged', 'a.mp4');
  assert.equal(pathWithinStorage(root, 'videos/merged/a.mp4'), path.resolve(inside));
  assert.equal(pathWithinStorage(root, '../outside.mp4'), null);
  assert.equal(pathWithinStorage(root, ''), null);
  assert.equal(relativeStoragePath(root, inside), 'videos/merged/a.mp4');
  assert.throws(() => relativeStoragePath(root, path.join(root, '..', 'outside.mp4')), /不在本地存储目录内/);
  assert.equal(exactTrustedOrigin('https://cdn.example.com/v.mp4', ['https://cdn.example.com']), true);
  assert.equal(exactTrustedOrigin('https://evil.example.com/v.mp4', ['https://cdn.example.com']), false);
  assert.equal(exactTrustedOrigin('https://user:pass@cdn.example.com/v.mp4', ['https://cdn.example.com']), false);
});

test('后处理开关与时长完整性校验保持原语义', () => {
  assert.equal(needsMergedEpisodePostProcess({}), false);
  assert.equal(needsMergedEpisodePostProcess({ watermark_text: '  ' }), false);
  assert.equal(needsMergedEpisodePostProcess({ burn_narration_subtitles: true }), true);
  assert.equal(needsMergedEpisodePostProcess({ burn_dialogue_audio: 1 }), true);
  assert.equal(needsMergedEpisodePostProcess({ watermark_text: '水印' }), true);
  assert.equal(productionDurationTolerance(2), 0.25);
  assert.equal(productionDurationTolerance(10), 0.5);
  assertProductionOutputHasAudio({ ok: true, hasAudio: true }, '严格生产 concat 输出无效', '最终视频缺少音轨');
  assert.throws(
    () => assertProductionOutputHasAudio({ ok: true, hasAudio: false }, '严格生产 concat 输出无效', '最终视频缺少音轨'),
    /严格生产 concat 输出无效：最终视频缺少音轨/
  );
  assert.throws(
    () => assertProductionOutputHasAudio({ ok: false, error: '没有可用的视频流' }, '严格生产 concat 输出无效', '最终视频缺少音轨'),
    /严格生产 concat 输出无效：没有可用的视频流/
  );
  assertProductionDurationComplete({ duration: 10 }, 10, '严格生产 concat 输出不完整');
  assert.throws(
    () => assertProductionDurationComplete({ duration: 8 }, 10, '严格生产 concat 输出不完整'),
    /严格生产 concat 输出不完整：预期约 10.00 秒，实际 8.00 秒/
  );
});