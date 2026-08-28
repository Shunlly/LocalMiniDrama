const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const backgroundExtractionService = require('../src/services/backgroundExtractionService');
const propExtractionService = require('../src/services/propExtractionService');
const { copyStoredAudioToTemp } = require('../src/services/mergedEpisodePostProcess');
const providerSdkService = require('../src/services/providerSdkService');
const timelineService = require('../src/services/timelineService');

const silentLog = { info() {}, warn() {}, error() {} };

function mockDb(row) {
  return {
    prepare() {
      return {
        get() { return row; },
        all() { return []; },
        run() { return { changes: 0, lastInsertRowid: 0 }; },
      };
    },
  };
}

function track(id, type, items, extra = {}) {
  return {
    id,
    type,
    name: type,
    sort_order: id,
    status: extra.status || 'pending',
    metadata: extra.metadata || {},
    items,
  };
}

function item(id, storyboardId, startSec, endSec, sourcePath) {
  return {
    id,
    storyboard_id: storyboardId,
    start_sec: startSec,
    end_sec: endSec,
    source_path: sourcePath,
    storyboard: storyboardId ? { id: storyboardId } : null,
    metadata: {},
  };
}

function validTimeline() {
  return {
    tracks: [
      track(1, 'video', [item(11, 101, 0, 5, 'videos/a.mp4')]),
      track(2, 'subtitle', [item(12, 101, 0, 5, '旁白字幕')]),
      track(3, 'voice', [item(13, 101, 0, 5, 'audio/a.mp3')]),
      track(4, 'dialogue', []),
      track(5, 'effect', [], { status: 'unused', metadata: { optional: true, usage: 'unused' } }),
      track(6, 'bgm', [], { status: 'unused', metadata: { optional: true, usage: 'unused' } }),
      track(7, 'transition', [], { status: 'unused', metadata: { optional: true, usage: 'unused' } }),
    ],
  };
}

test('userFacingGeneration messages 抽取/生成/合成错误为可操作简体中文', async (t) => {
  assert.throws(
    () => backgroundExtractionService.extractBackgroundsForEpisode(mockDb(undefined), {}, silentLog, 1),
    (error) => error.message === '剧集不存在，无法提取场景'
  );
  assert.throws(
    () => backgroundExtractionService.extractBackgroundsForEpisode(
      mockDb({ id: 1, drama_id: 1, script_content: '   ' }),
      {},
      silentLog,
      1
    ),
    (error) => error.message === '剧集剧本内容为空，无法提取场景'
  );

  assert.throws(
    () => propExtractionService.extractPropsForEpisode(mockDb(undefined), silentLog, 1, {}),
    (error) => error.message === '剧集不存在，无法提取道具'
  );

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-user-facing-audio-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const storage = path.join(root, 'storage');
  fs.mkdirSync(path.join(storage, 'audio'), { recursive: true });
  fs.writeFileSync(path.join(storage, 'audio', 'empty.mp3'), Buffer.alloc(0));
  assert.throws(
    () => copyStoredAudioToTemp(storage, 'audio/empty.mp3', path.join(root, 'copied.mp3')),
    (error) => error.message === '本地音频文件为空或超过大小限制，请重新生成配音后再合成'
  );

  await assert.rejects(
    () => providerSdkService.generateAssetBibleImagesProduction(mockDb(undefined), silentLog, { drama_id: 1 }),
    (error) => error.message === '素材图 Provider 不可用，请在「AI 配置」中启用图片模型'
  );

  assert.throws(
    () => providerSdkService.assertProductionReadiness(mockDb(undefined), { drama_id: 1 }),
    (error) => /生产工作流尚未就绪，缺少：/.test(error.message) && /分镜/.test(error.message) && /素材图 Provider/.test(error.message)
  );

  const originalGetEpisodeTimeline = timelineService.getEpisodeTimeline;
  t.after(() => {
    timelineService.getEpisodeTimeline = originalGetEpisodeTimeline;
  });

  timelineService.getEpisodeTimeline = () => null;
  assert.throws(
    () => providerSdkService.buildProductionTimelineCompositePlan(mockDb(undefined), 9),
    (error) => error.code === 'PRODUCTION_TIMELINE_INVALID' && error.message === '第 9 集还没有时间线，请先生成时间线后再合成'
  );

  const noSubtitle = validTimeline();
  noSubtitle.tracks.find((entry) => entry.type === 'subtitle').items = [];
  timelineService.getEpisodeTimeline = () => noSubtitle;
  assert.throws(
    () => providerSdkService.buildProductionTimelineCompositePlan(mockDb(undefined), 9),
    (error) => error.code === 'PRODUCTION_TIMELINE_INVALID' && /字幕时间线不完整/.test(error.message)
  );

  const noVoice = validTimeline();
  noVoice.tracks.find((entry) => entry.type === 'voice').items = [];
  timelineService.getEpisodeTimeline = () => noVoice;
  assert.throws(
    () => providerSdkService.buildProductionTimelineCompositePlan(mockDb(undefined), 9),
    (error) => error.code === 'PRODUCTION_TIMELINE_INVALID' && /需要旁白或对白/.test(error.message)
  );
});

test('userFacingGeneration source 不再包含已列出的英文用户错误', () => {
  const files = [
    'backgroundExtractionService.js',
    'propExtractionService.js',
    'mergedEpisodePostProcess.js',
    'providerSdkService.js',
  ];
  const forbidden = [
    'episode not found',
    'episode has no script content',
    'Stored audio file is empty or exceeds the size limit.',
    'Production asset image provider is unavailable',
    'No durable storyboard image is available',
    'TTS output was not persisted locally',
    'Episode is missing one or more durable video clips',
    'Compositor task result was not persisted',
    'Production workflow is not ready',
    'Production asset image generation failed',
    'Production image generation failed',
    'Production video generation failed',
    'Production TTS generation failed',
    'Production episode composite failed for episode',
    'Strict video merge did not complete',
    'timeline was not found',
    'subtitle timeline is incomplete',
    'requires voice or dialogue',
    'Compositor merge did not acquire',
    'Compositor merge no longer owns',
  ];
  for (const name of files) {
    const source = fs.readFileSync(path.join(__dirname, '../src/services', name), 'utf8');
    for (const phrase of forbidden) {
      assert.equal(source.includes(phrase), false, `${name} 仍包含：${phrase}`);
    }
  }
});
