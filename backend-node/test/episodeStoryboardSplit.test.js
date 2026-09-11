const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const {
  charSpeechWeight,
  parseDialogueToEntries,
  inferPrimaryOnScreenCharacter,
  durationForSplitSegment,
  buildSplitPlansFromStoryboard,
  splitStoryboardByAudio,
} = require('../src/services/episodeStoryboardSplit');
const episodeStoryboardService = require('../src/services/episodeStoryboardService');

const DRAMA_ID = 11;
const EPISODE_ID = 101;
const SCENE_ID = 501;
const STORYBOARD_ID = 1001;

test('对白按说话人冒号切开，无前缀时整段算一条', () => {
  assert.deepEqual(parseDialogueToEntries('林晚：开门。\n记者：请问发生了什么？'), [
    { speaker: '林晚', text: '开门。' },
    { speaker: '记者', text: '请问发生了什么？' },
  ]);
  assert.deepEqual(parseDialogueToEntries('没有说话人前缀的整段'), [
    { speaker: '', text: '没有说话人前缀的整段' },
  ]);
  assert.deepEqual(parseDialogueToEntries(''), []);
  assert.deepEqual(parseDialogueToEntries(null), []);
});

test('拆镜时长按字数估算并夹在上下限内', () => {
  assert.equal(charSpeechWeight('一二三四'), 1);
  assert.equal(durationForSplitSegment('dialogue', ''), 5);
  assert.equal(durationForSplitSegment('dialogue', '字'.repeat(80)), 10);
  assert.equal(durationForSplitSegment('narration', ''), 6);
  assert.equal(durationForSplitSegment('narration', '字'.repeat(80)), 12);
});

test('画面主角色按对白出现顺序在动作标题里查找，不因数字 ID 误伤', () => {
  assert.equal(
    inferPrimaryOnScreenCharacter(
      { action: '林晚站在门口', result: '记者记录', title: '对峙', dialogue: '林晚：站住' },
      ['林晚', '记者']
    ),
    '林晚'
  );
  assert.equal(
    inferPrimaryOnScreenCharacter({ action: '无人名', title: String(EPISODE_ID) }, ['林晚', '记者']),
    null
  );
});

test('两句对白拆成两条计划，记者走采访镜，且不把 drama_id / episode_id / storyboard_id 写进计划', () => {
  assert.notEqual(DRAMA_ID, EPISODE_ID);
  assert.notEqual(EPISODE_ID, SCENE_ID);
  assert.notEqual(EPISODE_ID, STORYBOARD_ID);

  const plans = buildSplitPlansFromStoryboard({
    id: STORYBOARD_ID,
    drama_id: DRAMA_ID,
    episode_id: EPISODE_ID,
    scene_id: SCENE_ID,
    title: '码头对峙',
    dialogue: '林晚：你越界了。\n记者：请正面回应。',
    narration: null,
    action: '林晚盯着镜头',
    result: '记者举起话筒',
    shot_type: '全景',
    movement: '缓摇',
  });
  assert.equal(plans.length, 2);
  assert.equal(plans[0].speaker, '林晚');
  assert.equal(plans[0].shot_type, '近景');
  assert.equal(plans[0].movement, '推镜');
  assert.equal(plans[1].speaker, '记者');
  assert.match(plans[1].action, /采访场景/);
  assert.equal(plans[1].shot_type, '全景');
  assert.equal(plans[1].movement, '缓摇');
  assert.equal(plans.some((p) => p.episode_id === EPISODE_ID), false);
  assert.equal(plans.some((p) => p.drama_id === DRAMA_ID), false);
  assert.equal(plans.some((p) => p.storyboard_id === STORYBOARD_ID), false);
  assert.equal(plans.some((p) => p.id === STORYBOARD_ID), false);
});

test('对白加旁白会多出画外旁白条，仅一段则拒绝拆镜', () => {
  const plans = buildSplitPlansFromStoryboard({
    title: '开场',
    dialogue: '小雅：发生了什么？',
    narration: '镜头缓缓推近。',
    action: '小雅握着话筒',
    movement: '固定',
  });
  assert.equal(plans.length, 2);
  assert.equal(plans[0].speaker, '小雅');
  assert.match(plans[0].action, /采访场景/);
  assert.equal(plans[1].type, 'narration');
  assert.equal(plans[1].dialogue, null);
  assert.match(plans[1].action, /小雅在画面中保持静止/);

  assert.throws(
    () => buildSplitPlansFromStoryboard({ dialogue: '林晚：只有一句。', narration: '' }),
    /当前分镜仅有一段对白或旁白，无需拆镜/
  );
  assert.throws(
    () => buildSplitPlansFromStoryboard({ dialogue: '', narration: '只有旁白。' }),
    /当前分镜仅有一段对白或旁白，无需拆镜/
  );
});

test('公开 API 的 splitStoryboardByAudio 与拆镜模块是同一函数', () => {
  assert.equal(episodeStoryboardService.splitStoryboardByAudio, splitStoryboardByAudio);
});

test('按对白拆镜用 storyboard_id 读源行、用 episode_id 挪后续镜号，不改其他集', () => {
  const OTHER_EPISODE_ID = 202;
  const OTHER_STORYBOARD_ID = 2002;
  assert.notEqual(DRAMA_ID, EPISODE_ID);
  assert.notEqual(EPISODE_ID, OTHER_EPISODE_ID);
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
        storyboard_number INTEGER, title TEXT, description TEXT, layout_description TEXT,
        location TEXT, time TEXT, duration TEXT, dialogue TEXT, narration TEXT,
        action TEXT, result TEXT, atmosphere TEXT, image_prompt TEXT, video_prompt TEXT, video_url TEXT, video_local_path TEXT, audio_local_path TEXT, narration_audio_local_path TEXT,
        characters TEXT, shot_type TEXT, angle TEXT, angle_h TEXT, angle_v TEXT, angle_s TEXT,
        movement TEXT, lighting_style TEXT, depth_of_field TEXT, segment_index INTEGER,
        segment_title TEXT, creation_mode TEXT, universal_segment_text TEXT, status TEXT,
        created_at TEXT, updated_at TEXT, deleted_at TEXT
      );
      CREATE TABLE storyboard_characters (storyboard_id INTEGER, character_id INTEGER, created_at TEXT);
      CREATE TABLE storyboard_props (storyboard_id INTEGER, prop_id INTEGER);
      INSERT INTO dramas VALUES (${DRAMA_ID}, '可读项目', 'draft', NULL, NULL, '2026-01-01', NULL, NULL, NULL);
      INSERT INTO episodes VALUES (${EPISODE_ID}, ${DRAMA_ID}, NULL);
      INSERT INTO episodes VALUES (${OTHER_EPISODE_ID}, ${DRAMA_ID}, NULL);
      INSERT INTO storyboards (
        id, episode_id, scene_id, storyboard_number, title, dialogue, narration, action, result,
        shot_type, movement, duration, status, created_at, updated_at
      ) VALUES
        (${STORYBOARD_ID}, ${EPISODE_ID}, ${SCENE_ID}, 1, '码头对峙', '林晚：你越界了。\n记者：请正面回应。', NULL, '林晚盯着镜头', '记者举起话筒', '全景', '缓摇', 8, 'pending', '2026-01-01', '2026-01-01'),
        (1002, ${EPISODE_ID}, ${SCENE_ID}, 2, '后续镜', '林晚：下一镜。', NULL, '走开', '离开', '中景', '固定', 5, 'pending', '2026-01-01', '2026-01-01'),
        (${OTHER_STORYBOARD_ID}, ${OTHER_EPISODE_ID}, ${SCENE_ID}, 2, '其他集', '甲：你好。\n乙：嗯。', NULL, '对坐', '点头', '近景', '固定', 6, 'pending', '2026-01-01', '2026-01-01');
    `);
    const log = { info() {}, warn() {}, error() {} };
    const result = episodeStoryboardService.splitStoryboardByAudio(db, log, STORYBOARD_ID);
    assert.equal(result.source_id, STORYBOARD_ID);
    assert.equal(result.created_count, 1);
    assert.equal(result.storyboard_ids[0], STORYBOARD_ID);
    const sameEpisode = db.prepare(
      'SELECT id, storyboard_number FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL ORDER BY storyboard_number, id'
    ).all(EPISODE_ID);
    assert.equal(sameEpisode.length, 3);
    assert.equal(sameEpisode[0].id, STORYBOARD_ID);
    assert.equal(sameEpisode[0].storyboard_number, 1);
    assert.equal(sameEpisode[1].storyboard_number, 2);
    assert.equal(sameEpisode[2].id, 1002);
    assert.equal(sameEpisode[2].storyboard_number, 3);
    const other = db.prepare('SELECT storyboard_number FROM storyboards WHERE id = ?').get(OTHER_STORYBOARD_ID);
    assert.equal(other.storyboard_number, 2);
    const first = db.prepare('SELECT dialogue, video_prompt FROM storyboards WHERE id = ?').get(STORYBOARD_ID);
    assert.match(first.dialogue, /林晚：/);
    assert.equal(first.video_prompt == null, false);
  } finally {
    db.close();
  }
});
