const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const childProcess = require('node:child_process');

const postProcess = require('../src/services/mergedEpisodePostProcess');
const ttsService = require('../src/services/ttsService');

const originalSpawn = childProcess.spawn;
const originalSynthesize = ttsService.synthesize;
const log = { info() {}, warn() {}, error() {} };

afterEach(() => {
  childProcess.spawn = originalSpawn;
  ttsService.synthesize = originalSynthesize;
});

function createChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  return child;
}

function createFixture(t, episodeId) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-post-cancel-'));
  const videoDir = path.join(root, 'videos');
  fs.mkdirSync(videoDir, { recursive: true });
  const mergedAbsPath = path.join(videoDir, 'episode.mp4');
  fs.writeFileSync(mergedAbsPath, 'source-video');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return {
    root,
    videoDir,
    mergedAbsPath,
    finalOutput: path.join(videoDir, 'episode_post.mp4'),
  };
}

function listPostProcessTempDirectories(fixture, episodeId) {
  const prefix = `.drama-merged-post-${episodeId}-`;
  return fs.readdirSync(fixture.videoDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => entry.name);
}

function installWatermarkProcessStub({ onFfmpeg, closeAfterKill = false }) {
  const calls = [];
  childProcess.spawn = (_command, args) => {
    const child = createChild();
    calls.push({ args, child });
    child.kill = (signal) => {
      child.killedWith = signal;
      if (closeAfterKill) queueMicrotask(() => child.emit('close', null, signal));
      return true;
    };

    if (args.includes('format=duration')) {
      queueMicrotask(() => {
        child.stdout.emit('data', '2.5\n');
        child.exitCode = 0;
        child.emit('close', 0, null);
      });
    } else if (args.includes('-select_streams')) {
      queueMicrotask(() => {
        child.exitCode = 0;
        child.emit('close', 0, null);
      });
    } else {
      const outputPath = args[args.length - 1];
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, 'partial-post-output');
      queueMicrotask(() => onFfmpeg?.({ child, outputPath }));
    }
    return child;
  };
  return calls;
}

function runWatermark(fixture, episodeId, options = {}) {
  return postProcess.runMergedEpisodePostProcess({}, log, {
    mergedAbsPath: fixture.mergedAbsPath,
    storageRoot: fixture.root,
    scenes: [{ scene_id: 1, duration: 2.5 }],
    episodeId,
    mergeOpts: { watermark_text: '测试水印' },
    ...options,
  });
}

describe('整集合并后处理取消与超时', () => {
  it('在最终目录所在文件系统暂存，并通过 rename 原子发布成品', async (t) => {
    const episodeId = 91000;
    const fixture = createFixture(t, episodeId);
    const originalRenameSync = fs.renameSync;
    const publishCalls = [];
    fs.renameSync = (sourcePath, destinationPath) => {
      if (path.resolve(destinationPath) === path.resolve(fixture.finalOutput)) {
        publishCalls.push({
          sourcePath,
          destinationPath,
          sourceDevice: fs.statSync(path.dirname(sourcePath)).dev,
          destinationDevice: fs.statSync(path.dirname(destinationPath)).dev,
        });
      }
      return originalRenameSync(sourcePath, destinationPath);
    };
    t.after(() => { fs.renameSync = originalRenameSync; });
    let stagedOutput;
    installWatermarkProcessStub({
      onFfmpeg({ child, outputPath }) {
        stagedOutput = outputPath;
        child.exitCode = 0;
        child.emit('close', 0, null);
      },
    });

    const result = await runWatermark(fixture, episodeId);

    assert.equal(result.ok, true);
    assert.equal(publishCalls.length, 1);
    assert.equal(path.resolve(publishCalls[0].sourcePath), path.resolve(stagedOutput));
    assert.equal(path.resolve(path.dirname(path.dirname(stagedOutput))), path.resolve(fixture.videoDir));
    assert.equal(publishCalls[0].sourceDevice, publishCalls[0].destinationDevice);
    assert.equal(fs.readFileSync(fixture.finalOutput, 'utf8'), 'partial-post-output');
    assert.equal(fs.existsSync(stagedOutput), false);
    assert.deepEqual(listPostProcessTempDirectories(fixture, episodeId), []);
  });

  it('原子发布完成瞬间取消时恢复旧成品', async (t) => {
    const episodeId = 91004;
    const fixture = createFixture(t, episodeId);
    fs.writeFileSync(fixture.finalOutput, 'previous-completed-output');
    const controller = new AbortController();
    const originalRenameSync = fs.renameSync;
    fs.renameSync = (sourcePath, destinationPath) => {
      const result = originalRenameSync(sourcePath, destinationPath);
      if (path.resolve(destinationPath) === path.resolve(fixture.finalOutput)
          && path.basename(sourcePath) === 'post-output.mp4') {
        controller.abort(new Error('发布后取消'));
      }
      return result;
    };
    t.after(() => { fs.renameSync = originalRenameSync; });
    installWatermarkProcessStub({
      onFfmpeg({ child }) {
        child.exitCode = 0;
        child.emit('close', 0, null);
      },
    });

    const result = await runWatermark(fixture, episodeId, { signal: controller.signal });

    assert.equal(result.ok, false);
    assert.match(result.error, /发布后取消/);
    assert.equal(fs.readFileSync(fixture.finalOutput, 'utf8'), 'previous-completed-output');
    assert.deepEqual(listPostProcessTempDirectories(fixture, episodeId), []);
  });

  it('取消长运行 FFmpeg 时发送 SIGKILL，无 close 也会有界收敛并保留旧成品', async (t) => {
    const episodeId = 91001;
    const fixture = createFixture(t, episodeId);
    fs.writeFileSync(fixture.finalOutput, 'previous-completed-output');
    const controller = new AbortController();
    let partialPath;
    let ffmpegChild;
    installWatermarkProcessStub({
      onFfmpeg({ child, outputPath }) {
        ffmpegChild = child;
        partialPath = outputPath;
        controller.abort(new Error('用户取消后处理'));
      },
    });

    const startedAt = Date.now();
    const result = await runWatermark(fixture, episodeId, {
      signal: controller.signal,
      processKillGraceMs: 25,
      processTimeoutMs: 2_000,
    });

    assert.equal(result.ok, false);
    assert.match(result.error, /用户取消后处理/);
    assert.equal(ffmpegChild.killedWith, 'SIGKILL');
    assert.ok(Date.now() - startedAt < 500, '取消应在强制收敛截止时间内完成');
    assert.equal(fs.readFileSync(fixture.finalOutput, 'utf8'), 'previous-completed-output');
    assert.equal(fs.existsSync(partialPath), false);
    assert.deepEqual(listPostProcessTempDirectories(fixture, episodeId), []);
  });

  it('FFmpeg 超时且 kill 后无 close 时返回失败并清理半成品', async (t) => {
    const episodeId = 91002;
    const fixture = createFixture(t, episodeId);
    let partialPath;
    let ffmpegChild;
    installWatermarkProcessStub({
      onFfmpeg({ child, outputPath }) {
        ffmpegChild = child;
        partialPath = outputPath;
      },
    });

    const startedAt = Date.now();
    const result = await runWatermark(fixture, episodeId, {
      processTimeoutMs: 30,
      processKillGraceMs: 25,
    });

    assert.equal(result.ok, false);
    assert.match(result.error, /烧录|超时/);
    assert.equal(ffmpegChild.killedWith, 'SIGKILL');
    assert.ok(Date.now() - startedAt < 500, '超时应在强制收敛截止时间内完成');
    assert.equal(fs.existsSync(fixture.finalOutput), false);
    assert.equal(fs.existsSync(partialPath), false);
    assert.deepEqual(listPostProcessTempDirectories(fixture, episodeId), []);
  });

  it('TTS 等待期间取消后不更新分镜，也不启动后续 FFmpeg', async (t) => {
    const episodeId = 91003;
    const fixture = createFixture(t, episodeId);
    const controller = new AbortController();
    const ttsRelativePath = 'audio/cancelled-narration.mp3';
    const ttsAbsolutePath = path.join(fixture.root, ttsRelativePath);
    fs.mkdirSync(path.dirname(ttsAbsolutePath), { recursive: true });
    fs.writeFileSync(ttsAbsolutePath, 'tts-audio');

    let spawnCalls = 0;
    childProcess.spawn = (_command, args) => {
      spawnCalls += 1;
      const child = createChild();
      child.kill = () => true;
      assert.ok(args.includes('format=duration'), '取消后不应进入音频处理 FFmpeg');
      queueMicrotask(() => {
        child.stdout.emit('data', '2.5\n');
        child.exitCode = 0;
        child.emit('close', 0, null);
      });
      return child;
    };

    let releaseTts;
    let ttsStarted;
    const ttsStartedPromise = new Promise((resolve) => { ttsStarted = resolve; });
    ttsService.synthesize = async () => {
      ttsStarted();
      return new Promise((resolve) => { releaseTts = () => resolve({ local_path: ttsRelativePath }); });
    };
    let updateCalls = 0;
    const db = {
      prepare(sql) {
        if (sql.startsWith('SELECT')) {
          return {
            get() {
              return {
                narration: '等待中的旁白',
                dialogue: '',
                audio_local_path: null,
                narration_audio_local_path: null,
              };
            },
          };
        }
        return { run() { updateCalls += 1; } };
      },
    };

    const pending = postProcess.runMergedEpisodePostProcess(db, log, {
      mergedAbsPath: fixture.mergedAbsPath,
      storageRoot: fixture.root,
      scenes: [{ scene_id: 7, duration: 2.5 }],
      episodeId,
      mergeOpts: { burn_narration_subtitles: true },
      signal: controller.signal,
      processKillGraceMs: 25,
    });
    await ttsStartedPromise;
    controller.abort(new Error('TTS 等待期间取消'));
    releaseTts();
    const result = await pending;

    assert.equal(result.ok, false);
    assert.match(result.error, /TTS 等待期间取消/);
    assert.equal(updateCalls, 0);
    assert.equal(spawnCalls, 1);
    assert.equal(fs.existsSync(fixture.finalOutput), false);
    assert.deepEqual(listPostProcessTempDirectories(fixture, episodeId), []);
  });
});
