const { after, before, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');

const configModule = require('../src/config');
const ffmpegPath = require('../src/utils/ffmpegPath');

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-video-merge-'));
const storageRoot = path.join(testRoot, 'storage');
const inputRoot = path.join(storageRoot, 'inputs');
fs.mkdirSync(storageRoot, { recursive: true });
fs.mkdirSync(inputRoot, { recursive: true });

const originalLoadConfig = configModule.loadConfig;
configModule.loadConfig = () => ({
  app: { name: 'video-merge-test' },
  storage: { local_path: storageRoot, base_url: 'http://localhost:5679/static' },
});

const videoMergeService = require('../src/services/videoMergeService');

const log = {
  info() {},
  warn() {},
  error() {},
};

let mediaSupport = { ok: false, reason: 'not checked' };
let clipWithoutAudio;
let clipWithAudio;
let corruptClip;
let narrationAudio;

after(() => {
  configModule.loadConfig = originalLoadConfig;
  fs.rmSync(testRoot, { recursive: true, force: true });
});

function runFfmpeg(args) {
  const result = spawnSync(
    ffmpegPath.getFfmpegPath(),
    ['-hide_banner', '-loglevel', 'error', '-y', ...args],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || `ffmpeg exited with ${result.status}`).trim());
  }
}

function readFilters() {
  const result = spawnSync(
    ffmpegPath.getFfmpegPath(),
    ['-hide_banner', '-filters'],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true }
  );
  return result.status === 0 ? String(result.stdout || result.stderr || '') : '';
}

function corruptMp4Payload(sourcePath, outputPath) {
  const bytes = Buffer.from(fs.readFileSync(sourcePath));
  const mdatMarker = bytes.indexOf(Buffer.from('mdat'));
  assert.notEqual(mdatMarker, -1, 'test source must contain an mdat atom');
  const payloadStart = Math.min(bytes.length, mdatMarker + 36);
  bytes.fill(0, payloadStart);
  fs.writeFileSync(outputPath, bytes);
}

function probeMedia(filePath) {
  const result = spawnSync(
    ffmpegPath.getFfprobePath(),
    [
      '-v', 'error',
      '-show_entries', 'stream=codec_name,codec_type,width,height:format=duration',
      '-of', 'json',
      filePath,
    ],
    { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, windowsHide: true }
  );
  assert.equal(result.status, 0, String(result.stderr || 'ffprobe failed'));
  return JSON.parse(result.stdout || '{}');
}

before(() => {
  const tools = ffmpegPath.validateFfmpegTools();
  if (!tools.ok) {
    mediaSupport = { ok: false, reason: tools.error };
    return;
  }
  const capability = ffmpegPath.getAvailableFfmpegEncoders();
  const encoders = new Set(capability.encoders);
  const h264Encoder = encoders.has('libx264') ? 'libx264' : encoders.has('libopenh264') ? 'libopenh264' : null;
  const required = ['mpeg4', 'aac', 'libmp3lame'];
  const missing = required.filter((name) => !encoders.has(name));
  if (!capability.ok || !h264Encoder || missing.length > 0) {
    mediaSupport = {
      ok: false,
      reason: capability.error || `missing encoders: ${[...missing, !h264Encoder ? 'software H.264' : null].filter(Boolean).join(', ')}`,
    };
    return;
  }

  clipWithoutAudio = path.join(inputRoot, 'clip-no-audio.mp4');
  clipWithAudio = path.join(inputRoot, 'clip-with-audio.mp4');
  corruptClip = path.join(inputRoot, 'clip-corrupt.mp4');
  narrationAudio = path.join(storageRoot, 'audio', 'existing-narration.mp3');
  fs.mkdirSync(path.dirname(narrationAudio), { recursive: true });

  runFfmpeg([
    '-f', 'lavfi', '-i', 'color=c=red:s=160x120:r=15:d=0.65',
    '-an', '-c:v', 'mpeg4', '-q:v', '5', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    clipWithoutAudio,
  ]);

  const h264Args = h264Encoder === 'libx264'
    ? ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28']
    : ['-c:v', 'libopenh264', '-b:v', '400k'];
  runFfmpeg([
    '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=24:d=0.85',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=0.85',
    ...h264Args,
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-shortest',
    '-movflags', '+faststart',
    clipWithAudio,
  ]);

  runFfmpeg([
    '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=44100:duration=0.55',
    '-c:a', 'libmp3lame', '-q:a', '6',
    narrationAudio,
  ]);
  corruptMp4Payload(clipWithAudio, corruptClip);
  mediaSupport = {
    ok: true,
    hasSubtitlesFilter: /\bsubtitles\b/.test(readFilters()),
  };
});

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY,
      title TEXT,
      metadata TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE episodes (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      status TEXT,
      video_url TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY,
      episode_id INTEGER,
      storyboard_number INTEGER,
      duration REAL,
      dialogue TEXT,
      narration TEXT,
      audio_local_path TEXT,
      narration_audio_local_path TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE video_merges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      episode_id INTEGER,
      drama_id INTEGER,
      title TEXT,
      provider TEXT,
      model TEXT,
      status TEXT,
      scenes TEXT,
      merge_options TEXT,
      task_id TEXT,
      merged_url TEXT,
      duration INTEGER,
      completed_at TEXT,
      error_msg TEXT,
      created_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE async_tasks (
      id TEXT PRIMARY KEY,
      type TEXT,
      status TEXT,
      progress INTEGER DEFAULT 0,
      message TEXT,
      error TEXT,
      result TEXT,
      resource_id TEXT,
      created_at TEXT,
      updated_at TEXT,
      completed_at TEXT,
      deleted_at TEXT
    );
  `);
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO dramas (id, title, created_at, updated_at) VALUES (1, ?, ?, ?)'
  ).run('Production Test', now, now);
  db.prepare(
    'INSERT INTO episodes (id, drama_id, status, updated_at) VALUES (1, 1, ?, ?)'
  ).run('processing', now);
  return db;
}

function createMergeFixture({ scenes, strict = true, mergeOptions = {}, narrationPath = null }) {
  const db = createDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO storyboards
       (id, episode_id, storyboard_number, duration, dialogue, narration, narration_audio_local_path, updated_at)
     VALUES (?, 1, ?, ?, '', ?, ?, ?)`
  ).run(101, 1, 0.65, 'First narration', narrationPath, now);
  db.prepare(
    `INSERT INTO storyboards
       (id, episode_id, storyboard_number, duration, dialogue, narration, narration_audio_local_path, updated_at)
     VALUES (?, 1, ?, ?, '', ?, ?, ?)`
  ).run(102, 2, 0.85, 'Second narration', narrationPath, now);

  const safeScenes = scenes.map((scene) => ({
    ...scene,
    video_url: path.isAbsolute(scene.video_url)
      ? path.relative(storageRoot, scene.video_url).replace(/\\/g, '/')
      : scene.video_url,
  }));
  let created;
  try {
    created = videoMergeService.create(db, log, {
      episode_id: 1,
      drama_id: 1,
      title: 'Strict production test',
      scenes: safeScenes,
      mode: strict ? 'strict_production' : undefined,
      merge_options: mergeOptions,
    });
  } catch (error) {
    db.close();
    throw error;
  }
  return { db, mergeId: created.merge_id, taskId: created.task_id };
}

function assertStrictFailureState(db, mergeId, taskId) {
  const merge = db.prepare('SELECT * FROM video_merges WHERE id = ?').get(mergeId);
  const task = db.prepare('SELECT * FROM async_tasks WHERE id = ?').get(taskId);
  const episode = db.prepare('SELECT * FROM episodes WHERE id = 1').get();
  assert.equal(merge.status, 'failed');
  assert.equal(merge.merged_url, null);
  assert.equal(task.status, 'failed');
  assert.equal(episode.status, 'failed');
  assert.ok(merge.error_msg);
}

describe('videoMergeService strict production mode', { concurrency: false }, () => {
  it('accepts storyboard_id and legacy scene_id while normalizing heterogeneous local clips', async (t) => {
    if (!mediaSupport.ok) return t.skip(mediaSupport.reason);
    const fixture = createMergeFixture({
      scenes: [
        { storyboard_id: 101, video_url: clipWithoutAudio, duration: 0.65, order: 0 },
        { scene_id: 102, video_url: clipWithAudio, duration: 0.85, order: 1 },
      ],
    });
    t.after(() => fixture.db.close());

    const result = await videoMergeService.processVideoMerge(fixture.db, log, fixture.mergeId, '');
    assert.equal(result.ok, true);

    const merge = fixture.db.prepare('SELECT * FROM video_merges WHERE id = ?').get(fixture.mergeId);
    const task = fixture.db.prepare('SELECT * FROM async_tasks WHERE id = ?').get(fixture.taskId);
    const episode = fixture.db.prepare('SELECT * FROM episodes WHERE id = 1').get();
    assert.equal(merge.status, 'completed');
    assert.equal(task.status, 'completed');
    assert.equal(episode.status, 'completed');
    assert.notEqual(merge.merged_url, clipWithoutAudio);

    const outputPath = path.join(storageRoot, merge.merged_url.replace(/\//g, path.sep));
    assert.equal(fs.existsSync(outputPath), true);
    const media = probeMedia(outputPath);
    const video = media.streams.find((stream) => stream.codec_type === 'video');
    assert.equal(video.codec_name, 'h264');
    assert.equal(video.width, 320);
    assert.equal(video.height, 180);
    assert.equal(media.streams.some((stream) => stream.codec_type === 'audio'), true);
    assert.ok(Number(media.format.duration) >= 1.3);
  });

  it('fails when any expected storyboard is missing from the scene list', async (t) => {
    const fixture = createMergeFixture({
      scenes: [{ scene_id: 101, video_url: clipWithoutAudio || 'unused.mp4', duration: 0.65, order: 0 }],
    });
    t.after(() => fixture.db.close());

    await assert.rejects(
      videoMergeService.processVideoMerge(fixture.db, log, fixture.mergeId, ''),
      /分镜覆盖不完整|缺少分镜/
    );
    assertStrictFailureState(fixture.db, fixture.mergeId, fixture.taskId);
  });

  it('fails instead of falling back when a probed clip cannot be transcoded', async (t) => {
    if (!mediaSupport.ok) return t.skip(mediaSupport.reason);
    const corruptProbe = probeMedia(corruptClip);
    assert.equal(corruptProbe.streams.some((stream) => stream.codec_type === 'video'), true);
    const fixture = createMergeFixture({
      scenes: [
        { scene_id: 101, video_url: clipWithoutAudio, duration: 0.65, order: 0 },
        { scene_id: 102, video_url: corruptClip, duration: 0.85, order: 1 },
      ],
    });
    t.after(() => fixture.db.close());

    await assert.rejects(
      videoMergeService.processVideoMerge(fixture.db, log, fixture.mergeId, ''),
      /片段转码失败/
    );
    assertStrictFailureState(fixture.db, fixture.mergeId, fixture.taskId);
    const merge = fixture.db.prepare('SELECT error_msg FROM video_merges WHERE id = ?').get(fixture.mergeId);
    assert.match(merge.error_msg, /片段转码失败/);
  });

  it('rejects missing local clips instead of persisting an unverified first-clip fallback', () => {
    assert.throws(
      () => createMergeFixture({
        strict: false,
        scenes: [
          { scene_id: 101, video_url: 'missing-first.mp4', duration: 1, order: 0 },
          { scene_id: 102, video_url: 'missing-second.mp4', duration: 1, order: 1 },
        ],
      }),
      /does not exist/
    );
  });

  it('rejects arbitrary absolute input paths at merge creation', () => {
    const outside = path.join(testRoot, 'outside.mp4');
    fs.writeFileSync(outside, Buffer.from('not-a-video'));
    const db = createDb();
    try {
      assert.throws(
        () => videoMergeService.create(db, log, {
          episode_id: 1,
          drama_id: 1,
          scenes: [{ scene_id: 101, video_url: outside, duration: 1, order: 0 }],
        }),
        /Absolute local media paths are not allowed/
      );
    } finally {
      db.close();
      fs.unlinkSync(outside);
    }
  });

  it('persists and throws a strict failure when post-processing fails', async (t) => {
    if (!mediaSupport.ok) return t.skip(mediaSupport.reason);
    const fixture = createMergeFixture({
      scenes: [
        { storyboard_id: 101, video_url: clipWithoutAudio, duration: 0.65, order: 0 },
        { storyboard_id: 102, video_url: clipWithAudio, duration: 0.85, order: 1 },
      ],
      mergeOptions: { watermark_text: 'post failure test' },
    });
    t.after(() => fixture.db.close());

    const postProcess = require('../src/services/mergedEpisodePostProcess');
    const originalPostProcess = postProcess.runMergedEpisodePostProcess;
    postProcess.runMergedEpisodePostProcess = async () => ({ ok: false, error: 'forced post-process failure' });
    t.after(() => {
      postProcess.runMergedEpisodePostProcess = originalPostProcess;
    });

    await assert.rejects(
      videoMergeService.processVideoMerge(fixture.db, log, fixture.mergeId, ''),
      /后处理失败/
    );
    assertStrictFailureState(fixture.db, fixture.mergeId, fixture.taskId);
  });

  it('reuses narration_audio_local_path without invoking TTS', async (t) => {
    if (!mediaSupport.ok) return t.skip(mediaSupport.reason);
    if (!mediaSupport.hasSubtitlesFilter) return t.skip('ffmpeg subtitles filter is unavailable');
    const relativeNarrationPath = path.relative(storageRoot, narrationAudio).replace(/\\/g, '/');
    const fixture = createMergeFixture({
      scenes: [
        { storyboard_id: 101, video_url: clipWithoutAudio, duration: 0.65, order: 0 },
        { storyboard_id: 102, video_url: clipWithAudio, duration: 0.85, order: 1 },
      ],
      mergeOptions: { burn_narration_subtitles: true },
      narrationPath: relativeNarrationPath,
    });
    t.after(() => fixture.db.close());

    const ttsService = require('../src/services/ttsService');
    const originalSynthesize = ttsService.synthesize;
    let synthesizeCalls = 0;
    ttsService.synthesize = async () => {
      synthesizeCalls += 1;
      throw new Error('TTS must not be called when narration audio already exists');
    };
    t.after(() => {
      ttsService.synthesize = originalSynthesize;
    });

    const result = await videoMergeService.processVideoMerge(fixture.db, log, fixture.mergeId, '');
    assert.equal(result.ok, true);
    assert.equal(synthesizeCalls, 0);
    const merge = fixture.db.prepare('SELECT * FROM video_merges WHERE id = ?').get(fixture.mergeId);
    assert.equal(merge.status, 'completed');
    assert.match(merge.merged_url, /_post\.mp4$/);
  });
});
