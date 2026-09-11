const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const {
  isMaxTokensParamError,
  lightingStyleHintZh,
  buildCameraMotionChain,
  extractInitialPose,
  generateImagePrompt,
  generateVideoPrompt,
  deriveStoryboardFieldsFromAi,
  collectIncrementalStoryboards,
  buildContinuationPrompt,
  resolveStoryboardShotDurationPlan,
} = require('../src/services/episodeStoryboardGeneration');
const { rebuildVideoPromptForStoryboard } = require('../src/services/episodeStoryboardSave');
const episodeStoryboardService = require('../src/services/episodeStoryboardService');

const DRAMA_ID = 11;
const EPISODE_ID = 101;
const SCENE_ID = 501;
const STORYBOARD_ID = 1001;

test('max_tokens 参数错误只认明确的 token/length 信号', () => {
  assert.equal(isMaxTokensParamError('max_tokens is too large'), true);
  assert.equal(isMaxTokensParamError('HTTP 400 invalid parameter: length'), true);
  assert.equal(isMaxTokensParamError('HTTP 500 server error'), false);
  assert.equal(isMaxTokensParamError(''), false);
});

test('起始姿势截到过程词之前，非法动作返回空串', () => {
  assert.equal(extractInitialPose('站在门口，然后坐下'), '站在门口');
  assert.equal(extractInitialPose('推门。接着走进去'), '推门');
  assert.equal(extractInitialPose(null), '');
  assert.equal(extractInitialPose(12), '');
});

test('布光提示与运镜链按枚举和时长分支', () => {
  assert.equal(lightingStyleHintZh('neon'), '霓虹混合色温');
  assert.equal(lightingStyleHintZh('unknown'), '主光方向明确侧光或窗光');
  assert.match(buildCameraMotionChain('跟拍', '近景', 12), /侧后方跟拍/);
  assert.match(buildCameraMotionChain('固定', '中景', 8), /缓推轨由远及近/);
  assert.match(buildCameraMotionChain('固定', '全景', 3), /缓推轨向事件中心/);
});

test('图片提示词用结构化视角，动作只取起始姿势', () => {
  const prompt = generateImagePrompt({
    location: '码头',
    time: '黄昏',
    action: '推门然后坐下',
    emotion: '冷静',
    angle_h: 'front',
    angle_v: 'eye_level',
    angle_s: 'medium',
  }, 'cinematic');
  assert.match(prompt, /码头，黄昏/);
  assert.match(prompt, /中景·平视·正面/);
  assert.match(prompt, /推门/);
  assert.equal(prompt.includes('然后坐下'), false);
  assert.match(prompt, /首帧静止画面$/);
});

test('视频提示词拼装时长并保持 composeStoryboardVideoPrompt 同一实现', () => {
  const prompt = generateVideoPrompt({
    location: '码头',
    time: '黄昏',
    title: '进门',
    action: '推门',
    dialogue: '林晚：开门',
    duration: '5s',
  }, 'cinematic', '16:9');
  assert.match(prompt, /场景：码头，黄昏/);
  assert.match(prompt, /镜头标题：进门/);
  assert.match(prompt, /时长：5秒/);
  assert.match(prompt, /=VideoRatio: 16:9/);
  assert.equal(generateVideoPrompt({}, '', ''), '时长：5秒');
  assert.equal(episodeStoryboardService.composeStoryboardVideoPrompt, generateVideoPrompt);
});

test('AI 字段推导按 shot_number / scene_id，不去把 drama_id / episode_id / storyboard_id 当查询键', () => {
  assert.notEqual(DRAMA_ID, EPISODE_ID);
  assert.notEqual(EPISODE_ID, SCENE_ID);
  assert.notEqual(EPISODE_ID, STORYBOARD_ID);

  const sb = {
    id: STORYBOARD_ID,
    drama_id: DRAMA_ID,
    episode_id: EPISODE_ID,
    storyboard_id: STORYBOARD_ID,
    scene_id: SCENE_ID,
    shot_number: '2',
    duration: '5s',
    title: '进门',
    action: '推门然后坐下',
    location: '码头',
    time: '黄昏',
  };
  const derived = deriveStoryboardFieldsFromAi(sb, 'cinematic', '16:9');
  assert.equal(derived.shotNumber, 2);
  assert.equal(derived.sceneId, SCENE_ID);
  assert.equal(derived.creationMode, 'classic');
  assert.equal(derived.universalSegmentText, null);
  assert.equal(sb.duration, 5);
  assert.notEqual(derived.sceneId, EPISODE_ID);
  assert.notEqual(derived.sceneId, DRAMA_ID);
  assert.notEqual(derived.sceneId, STORYBOARD_ID);
  assert.notEqual(derived.shotNumber, EPISODE_ID);

  const noScene = deriveStoryboardFieldsFromAi({
    episode_id: EPISODE_ID,
    drama_id: DRAMA_ID,
    shot_number: 1,
  }, '', '16:9');
  assert.equal(noScene.sceneId, null);
  assert.equal(noScene.shotNumber, 1);

  const fromSceneDesc = { scene_description: '仓库，深夜', shot_number: 3 };
  const splitScene = deriveStoryboardFieldsFromAi(fromSceneDesc, '', '9:16', { targetClipDuration: 15 });
  assert.equal(fromSceneDesc.location, '仓库');
  assert.equal(fromSceneDesc.time, '深夜');
  assert.equal(fromSceneDesc.duration, 15);

  const universal = deriveStoryboardFieldsFromAi({
    shot_number: 1,
    action: '抬手',
    location: '码头',
  }, '电影感', '16:9', { universalOmni: true });
  assert.equal(universal.creationMode, 'universal');
  assert.match(universal.universalSegmentText, /叙事动态/);
});

test('流式增量按镜号去重，包装数组也能收集，且不把 episode_id 当镜号', () => {
  const recovered = new Map();
  const raw = '```json\n[{"shot_number":1,"title":"一","episode_id":101},{"shot_number":2,"title":"二"}]\n```';
  assert.equal(collectIncrementalStoryboards(raw, recovered), 2);
  assert.equal(recovered.get(1).title, '一');
  assert.equal(recovered.get(2).title, '二');
  assert.equal(recovered.has(EPISODE_ID), false);
  assert.equal(collectIncrementalStoryboards(raw, recovered), 0);

  const wrapped = new Map();
  assert.equal(
    collectIncrementalStoryboards('{"storyboards":[{"storyboard_number":"3","title":"三"}]}', wrapped),
    1
  );
  assert.equal(wrapped.get(3).title, '三');
  assert.equal(collectIncrementalStoryboards('not json', new Map()), undefined);
});

test('续写提示列出已有镜号并从下一镜继续', () => {
  const prompt = buildContinuationPrompt(
    '原始剧本',
    [{ shot_number: 1, segment_title: '开场', title: '进门', location: '码头', action: '推门' }],
    1,
    2,
    true,
    true
  );
  assert.match(prompt, /第2次续写/);
  assert.match(prompt, /shot_number 2 继续/);
  assert.match(prompt, /1\. \[开场\] 进门/);
  assert.match(prompt, /非空字符串 narration/);
  assert.match(prompt, /creation_mode:"universal"/);
  assert.match(prompt, /原始剧本/);
});

test('单镜时长优先用项目每段秒数，而不是总时长除以镜数', () => {
  assert.deepEqual(resolveStoryboardShotDurationPlan(15, 60, 12), {
    impliedFromTotal: 5,
    effectiveShotDuration: 15,
  });
  assert.deepEqual(resolveStoryboardShotDurationPlan(null, 60, 12), {
    impliedFromTotal: 5,
    effectiveShotDuration: 5,
  });
  assert.deepEqual(resolveStoryboardShotDurationPlan(0, null, 8), {
    impliedFromTotal: null,
    effectiveShotDuration: null,
  });
});

test('重建视频提示词按 storyboard_id 读写，不去把 drama_id / episode_id 当分镜键', () => {
  assert.notEqual(DRAMA_ID, EPISODE_ID);
  assert.notEqual(EPISODE_ID, STORYBOARD_ID);
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE dramas (
        id INTEGER PRIMARY KEY, title TEXT, status TEXT, style TEXT, metadata TEXT,
        created_at TEXT, deleted_at TEXT, trash_state TEXT, recycle_phase TEXT
      );
      CREATE TABLE episodes (
        id INTEGER PRIMARY KEY, drama_id INTEGER, deleted_at TEXT
      );
      CREATE TABLE storyboards (
        id INTEGER PRIMARY KEY, episode_id INTEGER, scene_id INTEGER,
        storyboard_number INTEGER, title TEXT, location TEXT, time TEXT, duration TEXT,
        dialogue TEXT, action TEXT, video_prompt TEXT, characters TEXT,
        created_at TEXT, updated_at TEXT, deleted_at TEXT
      );
      INSERT INTO dramas VALUES (${DRAMA_ID}, '可读项目', 'draft', NULL, '{"aspect_ratio":"9:16"}', '2026-01-01', NULL, NULL, NULL);
      INSERT INTO episodes VALUES (${EPISODE_ID}, ${DRAMA_ID}, NULL);
      INSERT INTO storyboards VALUES (${STORYBOARD_ID}, ${EPISODE_ID}, ${SCENE_ID}, 1, '进门', '码头', '黄昏', '5s', '林晚：开门', '推门', '旧提示', '[]', '2026-01-01', '2026-01-01', NULL);
    `);
    const log = { info() {}, warn() {}, error() {} };
    assert.equal(episodeStoryboardService.rebuildVideoPromptForStoryboard, rebuildVideoPromptForStoryboard);
    const rebuilt = episodeStoryboardService.rebuildVideoPromptForStoryboard(db, log, STORYBOARD_ID);
    assert.equal(rebuilt.id, STORYBOARD_ID);
    assert.equal(rebuilt.episode_id, EPISODE_ID);
    assert.match(rebuilt.video_prompt, /场景：码头，黄昏/);
    assert.match(rebuilt.video_prompt, /=VideoRatio: 9:16/);
    assert.equal(episodeStoryboardService.rebuildVideoPromptForStoryboard(db, log, DRAMA_ID), null);
    assert.equal(episodeStoryboardService.rebuildVideoPromptForStoryboard(db, log, EPISODE_ID), null);
    assert.equal(episodeStoryboardService.rebuildVideoPromptForStoryboard(db, log, SCENE_ID), null);
  } finally {
    db.close();
  }
});
