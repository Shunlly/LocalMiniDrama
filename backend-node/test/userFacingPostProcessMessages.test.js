const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const childProcess = require('node:child_process');

const mergedPostProcess = require('../src/services/mergedEpisodePostProcess');
const narrationPostProcess = require('../src/services/narrationVideoPostProcess');
const ttsService = require('../src/services/ttsService');

const originalSpawn = childProcess.spawn;
const originalSpawnSync = childProcess.spawnSync;
const originalSynthesize = ttsService.synthesize;
const log = { info() {}, warn() {}, error() {} };

afterEach(() => {
  childProcess.spawn = originalSpawn;
  childProcess.spawnSync = originalSpawnSync;
  ttsService.synthesize = originalSynthesize;
});

function hasCjk(text) {
  return /[\u4e00-\u9fff]/.test(String(text || ''));
}

function assertSafeUserError(error) {
  assert.equal(typeof error, 'string');
  assert.equal(hasCjk(error), true);
  assert.doesNotMatch(error, /ENOENT/i);
  assert.doesNotMatch(error, /spawn /i);
  assert.doesNotMatch(error, /ECONNREFUSED/i);
  assert.doesNotMatch(error, /\bat\s+\S+/);
  assert.doesNotMatch(error, /This operation was aborted/i);
  assert.doesNotMatch(error, /sk-[A-Za-z0-9]/i);
}

function createChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = () => true;
  return child;
}

function createStorageFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-post-user-facing-'));
  const videoDir = path.join(root, 'videos');
  fs.mkdirSync(videoDir, { recursive: true });
  const mergedAbsPath = path.join(videoDir, 'episode.mp4');
  fs.writeFileSync(mergedAbsPath, 'source-video');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, mergedAbsPath };
}

function emitSpawnError(child, message) {
  const error = new Error(message);
  error.code = 'ENOENT';
  queueMicrotask(() => child.emit('error', error));
}

describe('成片后处理用户可见错误', () => {
  it('FFmpeg 缺失时返回中文，不泄露 spawn ENOENT', async (t) => {
    const fixture = createStorageFixture(t);
    childProcess.spawn = () => {
      const child = createChild();
      emitSpawnError(child, 'spawn ffmpeg ENOENT');
      return child;
    };

    const result = await mergedPostProcess.runMergedEpisodePostProcess({}, log, {
      mergedAbsPath: fixture.mergedAbsPath,
      storageRoot: fixture.root,
      scenes: [{ scene_id: 1, duration: 2.5 }],
      episodeId: 92001,
      mergeOpts: { watermark_text: '测试水印' },
    });

    assert.equal(result.ok, false);
    assertSafeUserError(result.error);
    assert.match(result.error, /ffmpeg/i);
    assert.match(result.error, /未找到|安装/);
  });

  it('探测成功但烧录 spawn ENOENT 时仍返回中文，不回传 stderr', async (t) => {
    const fixture = createStorageFixture(t);
    childProcess.spawn = (_command, args) => {
      const child = createChild();
      if (args.includes('format=duration') || args.includes('-select_streams')) {
        queueMicrotask(() => {
          if (args.includes('format=duration')) child.stdout.emit('data', '2.5\n');
          child.exitCode = 0;
          child.emit('close', 0, null);
        });
        return child;
      }
      emitSpawnError(child, 'spawn ffmpeg ENOENT');
      return child;
    };

    const result = await mergedPostProcess.runMergedEpisodePostProcess({}, log, {
      mergedAbsPath: fixture.mergedAbsPath,
      storageRoot: fixture.root,
      scenes: [{ scene_id: 1, duration: 2.5 }],
      episodeId: 92004,
      mergeOpts: { watermark_text: '测试水印' },
    });

    assert.equal(result.ok, false);
    assertSafeUserError(result.error);
    assert.match(result.error, /未找到|安装/);
    assert.doesNotMatch(result.error, /libx264|filter_complex|stderr/i);
  });

  it('英文取消原因映射为操作已取消，不回传 Abort 英文', async (t) => {
    const fixture = createStorageFixture(t);
    const controller = new AbortController();
    controller.abort(new Error('This operation was aborted'));

    const result = await mergedPostProcess.runMergedEpisodePostProcess({}, log, {
      mergedAbsPath: fixture.mergedAbsPath,
      storageRoot: fixture.root,
      scenes: [{ scene_id: 1, duration: 2.5 }],
      episodeId: 92002,
      mergeOpts: { watermark_text: '测试水印' },
      signal: controller.signal,
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, '操作已取消');
    assertSafeUserError(result.error);
  });

  it('解说旁白 TTS 英文堆栈不会回给用户', async (t) => {
    const fixture = createStorageFixture(t);
    childProcess.spawn = (_command, args) => {
      const child = createChild();
      if (args.includes('format=duration')) {
        queueMicrotask(() => {
          child.stdout.emit('data', '2.5\n');
          child.exitCode = 0;
          child.emit('close', 0, null);
        });
        return child;
      }
      emitSpawnError(child, 'spawn ffmpeg ENOENT');
      return child;
    };
    ttsService.synthesize = async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:443\n    at ClientRequest.request (node:http:1:1)');
    };
    const db = {
      prepare() {
        return {
          get() {
            return {
              narration: '需要生成的旁白',
              dialogue: '',
              audio_local_path: null,
              narration_audio_local_path: null,
            };
          },
          run() {},
        };
      },
    };

    const result = await mergedPostProcess.runMergedEpisodePostProcess(db, log, {
      mergedAbsPath: fixture.mergedAbsPath,
      storageRoot: fixture.root,
      scenes: [{ scene_id: 7, duration: 2.5 }],
      episodeId: 92003,
      mergeOpts: { burn_narration_subtitles: true },
    });

    assert.equal(result.ok, false);
    assertSafeUserError(result.error);
    assert.match(result.error, /旁白 TTS 失败|解说旁白 TTS 失败/);
  });
});

describe('旁白后处理用户可见错误', () => {
  it('ffprobe/ffmpeg 缺失时返回中文，不泄露 ENOENT', async (t) => {
    const fixture = createStorageFixture(t);
    childProcess.spawnSync = () => ({
      error: Object.assign(new Error('spawn ffprobe ENOENT'), { code: 'ENOENT' }),
      status: null,
      stdout: '',
      stderr: '',
    });

    const result = await narrationPostProcess.runNarrationSubtitlePostProcess({}, log, {
      mergedAbsPath: fixture.mergedAbsPath,
      storageRoot: fixture.root,
      scenes: [{ scene_id: 1, duration: 2 }],
      episodeId: 93001,
    });

    assert.equal(result.ok, false);
    assertSafeUserError(result.error);
    assert.match(result.error, /ffmpeg/i);
    assert.match(result.error, /未找到|安装/);
  });

  it('旁白 TTS 英文堆栈不会回给用户', async (t) => {
    const fixture = createStorageFixture(t);
    childProcess.spawnSync = (_command, args = []) => {
      if (Array.isArray(args) && args.includes('format=duration')) {
        return { error: null, status: 0, stdout: '5.0\n', stderr: '' };
      }
      return {
        error: Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' }),
        status: null,
        stdout: '',
        stderr: '',
      };
    };
    ttsService.synthesize = async () => {
      throw new Error('Invalid API key sk-secret-value\n    at synthesize (tts.js:1:1)');
    };
    const db = {
      prepare() {
        return { get() { return { narration: '需要生成的旁白' }; } };
      },
    };

    const result = await narrationPostProcess.runNarrationSubtitlePostProcess(db, log, {
      mergedAbsPath: fixture.mergedAbsPath,
      storageRoot: fixture.root,
      scenes: [{ scene_id: 3, duration: 2 }],
      episodeId: 93002,
    });

    assert.equal(result.ok, false);
    assertSafeUserError(result.error);
    assert.match(result.error, /旁白 TTS 失败/);
    assert.doesNotMatch(result.error, /Invalid API key/i);
  });
});

describe('后处理源码不再拼接英文堆栈给用户', () => {
  it('成片与旁白后处理去掉 e.message 插值', () => {
    const files = [
      'mergedEpisodePostProcess.js',
      'narrationVideoPostProcess.js',
    ];
    const forbidden = [
      '解说旁白 TTS 失败：${e.message}',
      '旁白 TTS 失败：${e.message}',
      'TTS 文件不存在：${synth.local_path}',
      'error: error.message, stdout, stderr, status: null',
      '${command} 退出码为',
      '${options.timeoutLabel || command}',
    ];
    for (const name of files) {
      const source = fs.readFileSync(path.join(__dirname, '../src/services', name), 'utf8');
      for (const phrase of forbidden) {
        assert.equal(source.includes(phrase), false, `${name} 仍包含：${phrase}`);
      }
      assert.match(source, /userFacingPostProcessError/);
      assert.match(source, /未找到 ffmpeg，请确认已安装 ffmpeg 后重试/);
    }
  });
});
