const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const {
  normalizeDuration,
  parseEpisodeStoryboardCharacters,
  parseEpisodeStoryboardReferenceImages,
  rowToEpisodeScene,
  assembleEpisodeStoryboard,
  getStoryboardsForEpisode,
} = require('../src/services/episodeStoryboardAssembly');
const episodeStoryboardService = require('../src/services/episodeStoryboardService');

const DRAMA_ID = 11;
const OTHER_DRAMA_ID = 22;
const DELETED_DRAMA_ID = 33;
const EPISODE_ID = 101;
const OTHER_EPISODE_ID = 202;
const DELETED_EPISODE_ID = 303;
const SCENE_ID = 501;
const SAME_NUMBER_SCENE_ID = 101;
const DELETED_SCENE_ID = 777;
const STORYBOARD_ID = 1001;
const OTHER_STORYBOARD_ID = 2002;

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY, title TEXT, status TEXT, metadata TEXT,
      created_at TEXT, deleted_at TEXT, trash_state TEXT, recycle_phase TEXT
    );
    CREATE TABLE episodes (
      id INTEGER PRIMARY KEY, drama_id INTEGER, deleted_at TEXT
    );
    CREATE TABLE scenes (
      id INTEGER PRIMARY KEY, drama_id INTEGER, location TEXT, time TEXT,
      prompt TEXT, storyboard_count INTEGER, image_url TEXT, local_path TEXT,
      status TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT
    );
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY, episode_id INTEGER, scene_id INTEGER,
      storyboard_number INTEGER, title TEXT, description TEXT, location TEXT,
      time TEXT, duration TEXT, dialogue TEXT, narration TEXT, action TEXT,
      result TEXT, atmosphere TEXT, image_prompt TEXT, video_prompt TEXT,
      shot_type TEXT, angle TEXT, angle_h TEXT, angle_v TEXT, angle_s TEXT,
      movement TEXT, segment_index INTEGER, segment_title TEXT,
      creation_mode TEXT, universal_segment_text TEXT, characters TEXT,
      composed_image TEXT, image_url TEXT, local_path TEXT, video_url TEXT,
      video_local_path TEXT, reference_images TEXT, video_reference_image_id INTEGER,
      audio_local_path TEXT, narration_audio_local_path TEXT, status TEXT,
      created_at TEXT, updated_at TEXT, deleted_at TEXT
    );
    INSERT INTO dramas VALUES
      (${DRAMA_ID}, '可读项目', 'draft', NULL, '2026-01-01', NULL, NULL, NULL),
      (${OTHER_DRAMA_ID}, '回收项目', 'draft', NULL, '2026-01-01', NULL, 'recycling', 'claimed'),
      (${DELETED_DRAMA_ID}, '已删除项目', 'trash', NULL, '2026-01-01', '2026-01-02', NULL, 'completed');
    INSERT INTO episodes VALUES
      (${EPISODE_ID}, ${DRAMA_ID}, NULL),
      (${OTHER_EPISODE_ID}, ${OTHER_DRAMA_ID}, NULL),
      (${DELETED_EPISODE_ID}, ${DELETED_DRAMA_ID}, NULL);
    INSERT INTO scenes VALUES
      (${SCENE_ID}, ${DRAMA_ID}, '码头', '黄昏', '海风', 1, 'data:image/png;base64,xx', 'projects/scene.webp', 'ready', '2026-01-01', '2026-01-01', NULL),
      (${SAME_NUMBER_SCENE_ID}, ${DRAMA_ID}, '不应误绑', '清晨', '室内', 1, '/static/wrong.png', 'projects/wrong.webp', 'ready', '2026-01-01', '2026-01-01', NULL),
      (${DELETED_SCENE_ID}, ${DRAMA_ID}, '已删场景', '夜晚', '废', 1, '/static/deleted.png', 'projects/deleted.webp', 'ready', '2026-01-01', '2026-01-01', '2026-01-03');
  `);
  return db;
}

function insertStoryboard(db, overrides = {}) {
  const row = {
    id: STORYBOARD_ID,
    episode_id: EPISODE_ID,
    scene_id: SCENE_ID,
    storyboard_number: 2,
    title: '主镜',
    description: 'desc',
    location: '码头',
    time: '黄昏',
    duration: '5s',
    dialogue: '你好',
    narration: null,
    action: '走来',
    result: '停下',
    atmosphere: '冷',
    image_prompt: 'img',
    video_prompt: 'vid',
    shot_type: '中景',
    angle: '平视',
    angle_h: 'front',
    angle_v: 'eye',
    angle_s: 'level',
    movement: '缓推',
    segment_index: 0,
    segment_title: null,
    creation_mode: 'universal',
    universal_segment_text: '全能行',
    characters: '[1, {"id":2}]',
    composed_image: 'projects/composed.webp',
    image_url: '/static/projects/still.png',
    local_path: 'projects/still.png',
    video_url: null,
    video_local_path: 'projects/clip.mp4',
    reference_images: '[{"id":9}]',
    video_reference_image_id: 88,
    audio_local_path: 'projects/line.wav',
    narration_audio_local_path: null,
    status: 'ready',
    created_at: '2026-01-01',
    updated_at: '2026-01-02',
    deleted_at: null,
    ...overrides,
  };
  db.prepare(`
    INSERT INTO storyboards (
      id, episode_id, scene_id, storyboard_number, title, description, location, time,
      duration, dialogue, narration, action, result, atmosphere, image_prompt, video_prompt,
      shot_type, angle, angle_h, angle_v, angle_s, movement, segment_index, segment_title,
      creation_mode, universal_segment_text, characters, composed_image, image_url, local_path,
      video_url, video_local_path, reference_images, video_reference_image_id, audio_local_path,
      narration_audio_local_path, status, created_at, updated_at, deleted_at
    ) VALUES (
      @id, @episode_id, @scene_id, @storyboard_number, @title, @description, @location, @time,
      @duration, @dialogue, @narration, @action, @result, @atmosphere, @image_prompt, @video_prompt,
      @shot_type, @angle, @angle_h, @angle_v, @angle_s, @movement, @segment_index, @segment_title,
      @creation_mode, @universal_segment_text, @characters, @composed_image, @image_url, @local_path,
      @video_url, @video_local_path, @reference_images, @video_reference_image_id, @audio_local_path,
      @narration_audio_local_path, @status, @created_at, @updated_at, @deleted_at
    )
  `).run(row);
  return row;
}

test('时长规范化去掉秒后缀并四舍五入，非法值返回 0', () => {
  assert.equal(normalizeDuration(null), 0);
  assert.equal(normalizeDuration(''), 0);
  assert.equal(normalizeDuration(5.4), 5);
  assert.equal(normalizeDuration(5.6), 6);
  assert.equal(normalizeDuration('5s'), 5);
  assert.equal(normalizeDuration(' 7S '), 7);
  assert.equal(normalizeDuration('abc'), 0);
  assert.equal(normalizeDuration(-3), -3);
  assert.equal(normalizeDuration('-3'), 0);
});

test('角色字段保留数组原值，参考图字符串才能 JSON.parse', () => {
  assert.deepEqual(parseEpisodeStoryboardCharacters(null), []);
  assert.deepEqual(parseEpisodeStoryboardCharacters([1, { id: 2 }]), [1, { id: 2 }]);
  assert.deepEqual(parseEpisodeStoryboardCharacters('[1, {"id":2}]'), [1, { id: 2 }]);
  assert.deepEqual(parseEpisodeStoryboardCharacters('{bad'), []);
  assert.deepEqual(parseEpisodeStoryboardCharacters({ id: 1 }), []);
  assert.deepEqual(parseEpisodeStoryboardReferenceImages('[{"id":9}]'), [{ id: 9 }]);
  assert.deepEqual(parseEpisodeStoryboardReferenceImages(null), []);
  assert.deepEqual(parseEpisodeStoryboardReferenceImages([{ id: 9 }]), []);
  assert.deepEqual(parseEpisodeStoryboardReferenceImages('{bad'), []);
});

test('场景装配保留 data URL，不会误用剧本装配的清洗逻辑', () => {
  const scene = rowToEpisodeScene({
    id: SCENE_ID,
    drama_id: DRAMA_ID,
    image_url: 'data:image/png;base64,xx',
    local_path: 'projects/scene.webp',
  });
  assert.equal(scene.image_url, 'data:image/png;base64,xx');
  assert.equal(rowToEpisodeScene(null), null);
});

test('分镜装配带出视频音频本地路径，不把静帧 local_path 当成视频', () => {
  const dto = assembleEpisodeStoryboard({
    id: STORYBOARD_ID,
    episode_id: EPISODE_ID,
    scene_id: SCENE_ID,
    storyboard_number: 1,
    duration: '5s',
    creation_mode: 'other',
    characters: '[3]',
    composed_image: 'projects/composed.webp',
    image_url: '/static/projects/still.png',
    local_path: 'projects/still.png',
    video_url: null,
    video_local_path: 'projects/clip.mp4',
    reference_images: '[{"id":9}]',
    audio_local_path: 'projects/line.wav',
  });
  assert.equal(dto.duration, 5);
  assert.equal(dto.creation_mode, 'classic');
  assert.equal(dto.video_local_path, 'projects/clip.mp4');
  assert.equal(dto.video_url, null);
  assert.equal(dto.composed_image, 'projects/composed.webp');
  assert.equal(dto.audio_local_path, 'projects/line.wav');
  assert.equal(dto.local_path, undefined);
  assert.equal(dto.image_url, undefined);
  assert.deepEqual(dto.characters, [3]);
  assert.deepEqual(dto.reference_images, [{ id: 9 }]);
});

test('列表入口按 episode_id 装配媒体，不去把 drama_id / scene_id / storyboard_id 当成剧集键', () => {
  assert.notEqual(DRAMA_ID, EPISODE_ID);
  assert.notEqual(EPISODE_ID, SCENE_ID);
  assert.notEqual(EPISODE_ID, STORYBOARD_ID);
  assert.notEqual(EPISODE_ID, OTHER_EPISODE_ID);

  const db = createDb();
  try {
    insertStoryboard(db);
    insertStoryboard(db, {
      id: 900,
      storyboard_number: 2,
      scene_id: SAME_NUMBER_SCENE_ID,
      duration: 8,
      video_local_path: 'projects/old.mp4',
    });
    insertStoryboard(db, {
      id: 1003,
      storyboard_number: 1,
      scene_id: DELETED_SCENE_ID,
      duration: 3,
      creation_mode: 'classic',
      video_local_path: 'projects/first.mp4',
    });
    insertStoryboard(db, {
      id: 1004,
      storyboard_number: 3,
      deleted_at: '2026-01-03',
      video_local_path: 'projects/deleted.mp4',
    });
    insertStoryboard(db, {
      id: OTHER_STORYBOARD_ID,
      episode_id: OTHER_EPISODE_ID,
      storyboard_number: 1,
      scene_id: SCENE_ID,
      duration: 9,
      video_local_path: 'projects/other.mp4',
    });

    const list = getStoryboardsForEpisode(db, EPISODE_ID);
    assert.deepEqual(list.map((item) => item.id), [1003, 1001]);
    assert.equal(list[0].scene_id, DELETED_SCENE_ID);
    assert.equal(list[0].background, null);
    assert.equal(list[1].background.id, SCENE_ID);
    assert.equal(list[1].background.image_url, 'data:image/png;base64,xx');
    assert.equal(list[1].duration, 5);
    assert.equal(list[1].video_local_path, 'projects/clip.mp4');
    assert.equal(list[1].local_path, undefined);
    assert.equal(list.some((item) => item.id === 900), false);
    assert.equal(list.some((item) => item.id === 1004), false);
    assert.equal(list.some((item) => item.episode_id === OTHER_EPISODE_ID), false);

    assert.deepEqual(getStoryboardsForEpisode(db, DRAMA_ID), []);
    assert.deepEqual(getStoryboardsForEpisode(db, STORYBOARD_ID), []);
    assert.deepEqual(getStoryboardsForEpisode(db, SCENE_ID), []);
    assert.deepEqual(getStoryboardsForEpisode(db, OTHER_EPISODE_ID), []);
    assert.deepEqual(getStoryboardsForEpisode(db, DELETED_EPISODE_ID), []);
    assert.equal(episodeStoryboardService.getStoryboardsForEpisode, getStoryboardsForEpisode);
    assert.deepEqual(episodeStoryboardService.getStoryboardsForEpisode(db, EPISODE_ID).map((item) => item.id), [1003, 1001]);
  } finally {
    db.close();
  }
});

test('scene_id 与 episode_id 数值相同也不改绑到错误场景', () => {
  const db = createDb();
  try {
    insertStoryboard(db, {
      id: STORYBOARD_ID,
      scene_id: SAME_NUMBER_SCENE_ID,
      storyboard_number: 1,
    });
    const list = getStoryboardsForEpisode(db, EPISODE_ID);
    assert.equal(list.length, 1);
    assert.equal(list[0].scene_id, SAME_NUMBER_SCENE_ID);
    assert.equal(list[0].episode_id, EPISODE_ID);
    assert.equal(list[0].background.id, SAME_NUMBER_SCENE_ID);
    assert.equal(list[0].background.location, '不应误绑');
    assert.notEqual(list[0].background.id, SCENE_ID);
  } finally {
    db.close();
  }
});
