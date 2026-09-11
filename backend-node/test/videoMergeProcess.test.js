'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const { EventEmitter } = require('node:events');

const videoMergeService = require('../src/services/videoMergeService');
const videoMergeProcess = require('../src/services/videoMergeProcess');
const uploadService = require('../src/services/uploadService');
const ffmpegPath = require('../src/utils/ffmpegPath');
const { describePostProcessFailure } = require('../src/services/videoMergeErrors');

const silentLog = {
  info() {},
  warn() {},
  error() {},
};

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function fakeChild(handler, options = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = (signal) => {
    child.signalCode = signal;
    if (typeof options.onKill === 'function') options.onKill(signal);
    return false;
  };
  queueMicrotask(() => handler(child));
  return child;
}

test('videoMergeService 通过 __test 暴露同一 runExternalProcess', () => {
  assert.equal(videoMergeService.__test.runExternalProcess, videoMergeProcess.runExternalProcess);
});

test('后处理 NO_NARRATION 仍是简体中文，执行层不得改写该文案', () => {
  const processSource = fs.readFileSync(path.join(__dirname, '../src/services/videoMergeProcess.js'), 'utf8');
  assert.equal(describePostProcessFailure('NO_NARRATION'), '当前没有可烧录的旁白');
  assert.match(processSource, /require\('\.\/videoMergeErrors'\)/);
  assert.equal(processSource.includes('function describePostProcessFailure'), false);
  assert.equal(processSource.includes('function strictMergeError'), false);
  assert.equal(processSource.includes('当前没有可烧录的旁白'), false);
  assert.equal(processSource.includes('No narration'), false);
  assert.match(processSource, /远程视频下载配额已用完/);
  assert.match(processSource, /远程视频为空，无法合成/);
  assert.equal(processSource.includes('remote video merge download budget exhausted'), false);
  assert.equal(processSource.includes('empty response body'), false);
});

test('removeFileIfPresent 删除已有文件，缺失路径保持静默', () => {
  const dir = makeTempDir('video-merge-process-rm-');
  const filePath = path.join(dir, 'clip.mp4');
  fs.writeFileSync(filePath, 'x');
  videoMergeProcess.removeFileIfPresent(filePath);
  assert.equal(fs.existsSync(filePath), false);
  videoMergeProcess.removeFileIfPresent(filePath);
  videoMergeProcess.removeFileIfPresent('');
  videoMergeProcess.removeFileIfPresent(null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('runExternalProcess 成功收集 stdout，非零退出码返回中文错误', async () => {
  const ok = await videoMergeProcess.runExternalProcess(process.execPath, ['-e', 'process.stdout.write("ok")'], {
    timeoutMs: 5000,
    outputLimitBytes: 1024,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.stdout, 'ok');
  assert.equal(ok.status, 0);

  const failed = await videoMergeProcess.runExternalProcess(process.execPath, ['-e', 'process.stderr.write("boom"); process.exit(7)'], {
    timeoutMs: 5000,
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.status, 7);
  assert.match(failed.error, /boom|退出码 7/);
});

test('runExternalProcess 在 SIGKILL 无 close 时仍能完成取消和超时', async (t) => {
  const originalSpawn = childProcess.spawn;
  let killSignal = null;
  childProcess.spawn = () => fakeChild(() => {}, {
    onKill(signal) { killSignal = signal; },
  });
  t.after(() => { childProcess.spawn = originalSpawn; });

  const controller = new AbortController();
  const running = videoMergeProcess.runExternalProcess('never-closes', [], {
    signal: controller.signal,
    timeoutMs: 5000,
    terminationGraceMs: 20,
  });
  controller.abort(new Error('测试取消'));
  await assert.rejects(running, (error) => error.code === 'OPERATION_CANCELLED');
  assert.equal(killSignal, 'SIGKILL');

  killSignal = null;
  const timedOut = await videoMergeProcess.runExternalProcess('never-closes', [], {
    timeoutMs: 10,
    timeoutLabel: '测试进程',
    terminationGraceMs: 20,
  });
  assert.equal(timedOut.ok, false);
  assert.match(timedOut.error, /测试进程 执行超时/);
  assert.equal(killSignal, 'SIGKILL');
});

test('runExternalProcess 已取消信号立即失败，输出超限时截断', async (t) => {
  const controller = new AbortController();
  controller.abort(new Error('预先取消'));
  await assert.rejects(
    videoMergeProcess.runExternalProcess(process.execPath, ['-e', '0'], { signal: controller.signal, timeoutMs: 1000 }),
    (error) => error.code === 'OPERATION_CANCELLED'
  );

  const originalSpawn = childProcess.spawn;
  childProcess.spawn = () => fakeChild((child) => {
    child.stdout.emit('data', 'a'.repeat(1500));
    child.exitCode = 0;
    child.emit('close', 0, null);
  });
  t.after(() => { childProcess.spawn = originalSpawn; });
  const truncated = await videoMergeProcess.runExternalProcess('fake', [], {
    timeoutMs: 1000,
    outputLimitBytes: 1024,
  });
  assert.equal(truncated.ok, true);
  assert.equal(truncated.stdout, 'a'.repeat(1024));
});

test('resolveVideoToLocalPath 使用存储内文件，拒绝逃逸路径', async () => {
  const storageRoot = makeTempDir('video-merge-process-storage-');
  const tempDir = makeTempDir('video-merge-process-temp-');
  const relativePath = 'videos/clip.mp4';
  const absolutePath = path.join(storageRoot, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, 'video-bytes');

  const resolved = await videoMergeProcess.resolveVideoToLocalPath(
    relativePath,
    '',
    storageRoot,
    tempDir,
    0,
    silentLog
  );
  assert.equal(resolved.temporary, false);
  assert.equal(resolved.canonical, relativePath);
  assert.equal(resolved.path, fs.realpathSync(absolutePath));
  assert.equal(resolved.bytes, 'video-bytes'.length);

  const warnings = [];
  const log = { info() {}, warn(_msg, extra) { warnings.push(extra); } };
  const rejected = await videoMergeProcess.resolveVideoToLocalPath(
    '../secret.mp4',
    '',
    storageRoot,
    tempDir,
    1,
    log
  );
  assert.equal(rejected, null);
  assert.equal(await videoMergeProcess.resolveVideoToLocalPath('', '', storageRoot, tempDir, 2, silentLog), null);
  assert.equal(await videoMergeProcess.resolveVideoToLocalPath(null, '', storageRoot, tempDir, 3, silentLog), null);
  assert.ok(warnings.some((item) => String(item?.error || '').includes('本地媒体')));

  fs.rmSync(storageRoot, { recursive: true, force: true });
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('resolveVideoToLocalPath 远程下载失败保持中文，成功则写入临时文件', async (t) => {
  const storageRoot = makeTempDir('video-merge-process-remote-storage-');
  const tempDir = makeTempDir('video-merge-process-remote-temp-');
  t.after(() => {
    fs.rmSync(storageRoot, { recursive: true, force: true });
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
  const originalDownload = uploadService.downloadBufferViaNodeHttp;
  t.after(() => { uploadService.downloadBufferViaNodeHttp = originalDownload; });

  const warnings = [];
  const log = { info() {}, warn(_msg, extra) { warnings.push(extra); } };
  const exhausted = await videoMergeProcess.resolveVideoToLocalPath(
    'https://cdn.example.com/a.mp4',
    '',
    storageRoot,
    tempDir,
    0,
    log,
    { downloadBudget: { remainingBytes: 0 }, trustedOrigins: ['https://cdn.example.com'] }
  );
  assert.equal(exhausted, null);
  assert.ok(warnings.some((item) => item.error === '远程视频下载配额已用完'));

  uploadService.downloadBufferViaNodeHttp = async () => ({ buffer: Buffer.alloc(0), finalUrl: 'https://cdn.example.com/a.mp4' });
  const empty = await videoMergeProcess.resolveVideoToLocalPath(
    'https://cdn.example.com/a.mp4',
    '',
    storageRoot,
    tempDir,
    1,
    log,
    { downloadBudget: { remainingBytes: 1024 }, trustedOrigins: ['https://cdn.example.com'] }
  );
  assert.equal(empty, null);
  assert.ok(warnings.some((item) => item.error === '远程视频为空，无法合成'));

  uploadService.downloadBufferViaNodeHttp = async () => {
    const error = new Error('下载中取消');
    error.name = 'AbortError';
    error.code = 'OPERATION_CANCELLED';
    throw error;
  };
  await assert.rejects(
    videoMergeProcess.resolveVideoToLocalPath(
      'https://cdn.example.com/a.webm',
      '',
      storageRoot,
      tempDir,
      2,
      silentLog,
      { downloadBudget: { remainingBytes: 1024 }, trustedOrigins: ['https://cdn.example.com'] }
    ),
    (error) => error.code === 'OPERATION_CANCELLED'
  );

  const payload = Buffer.from('remote-video');
  uploadService.downloadBufferViaNodeHttp = async (url) => ({ buffer: payload, finalUrl: `${url}?ok=1` });
  const downloaded = await videoMergeProcess.resolveVideoToLocalPath(
    'https://cdn.example.com/movie.mov',
    '',
    storageRoot,
    tempDir,
    3,
    silentLog,
    { downloadBudget: { remainingBytes: 1024 }, trustedOrigins: ['https://cdn.example.com'] }
  );
  assert.equal(downloaded.temporary, true);
  assert.equal(downloaded.bytes, payload.length);
  assert.equal(downloaded.canonical, 'https://cdn.example.com/movie.mov?ok=1');
  assert.equal(path.extname(downloaded.path), '.mov');
  assert.equal(fs.readFileSync(downloaded.path).equals(payload), true);
});

test('checkMediaBinary 与 ffprobeVideo 解析 FFmpeg 输出', async (t) => {
  const originalSpawn = childProcess.spawn;
  t.after(() => { childProcess.spawn = originalSpawn; });

  childProcess.spawn = (command) => fakeChild((child) => {
    if (String(command).includes('bad')) {
      child.stdout.emit('data', 'not-a-binary\n');
      child.exitCode = 0;
      child.emit('close', 0, null);
      return;
    }
    child.stdout.emit('data', 'ffmpeg version n6.1\nconfig: --enable-libx264\n');
    child.exitCode = 0;
    child.emit('close', 0, null);
  });
  const valid = await videoMergeProcess.checkMediaBinary('ffmpeg', 'ffmpeg');
  assert.equal(valid.ok, true);
  assert.match(valid.version, /ffmpeg version n6\.1/);
  const invalid = await videoMergeProcess.checkMediaBinary('bad-ffmpeg', 'ffmpeg');
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /不是有效的 ffmpeg 可执行文件/);

  const missing = await videoMergeProcess.ffprobeVideo(path.join(os.tmpdir(), 'missing-ffprobe-input.mp4'));
  assert.equal(missing.ok, false);

  const emptyFile = path.join(makeTempDir('video-merge-process-empty-'), 'empty.mp4');
  fs.writeFileSync(emptyFile, '');
  t.after(() => fs.rmSync(path.dirname(emptyFile), { recursive: true, force: true }));
  const empty = await videoMergeProcess.ffprobeVideo(emptyFile);
  assert.equal(empty.ok, false);
  assert.equal(empty.error, '文件为空或不是普通文件');

  const mediaFile = path.join(path.dirname(emptyFile), 'clip.mp4');
  fs.writeFileSync(mediaFile, 'video');
  childProcess.spawn = () => fakeChild((child) => {
    child.stdout.emit('data', JSON.stringify({
      streams: [
        { codec_type: 'video', width: 320, height: 180, duration: '1.5' },
        { codec_type: 'audio' },
      ],
      format: { duration: '1.5' },
    }));
    child.exitCode = 0;
    child.emit('close', 0, null);
  });
  const probed = await videoMergeProcess.ffprobeVideo(mediaFile);
  assert.deepEqual(probed, { ok: true, width: 320, height: 180, duration: 1.5, hasAudio: true });
});

test('加载后替换 ffmpegPath 仍会被执行层读取', async (t) => {
  const originalGetFfmpegPath = ffmpegPath.getFfmpegPath;
  const originalGetFfprobePath = ffmpegPath.getFfprobePath;
  const originalSpawn = childProcess.spawn;
  const seen = [];
  ffmpegPath.getFfmpegPath = () => 'patched-ffmpeg';
  ffmpegPath.getFfprobePath = () => 'patched-ffprobe';
  childProcess.spawn = (command) => {
    seen.push(command);
    return fakeChild((child) => {
      const name = String(command).includes('ffprobe') ? 'ffprobe' : 'ffmpeg';
      child.stdout.emit('data', name + ' version test\n');
      child.exitCode = 0;
      child.emit('close', 0, null);
    });
  };
  t.after(() => {
    ffmpegPath.getFfmpegPath = originalGetFfmpegPath;
    ffmpegPath.getFfprobePath = originalGetFfprobePath;
    childProcess.spawn = originalSpawn;
  });

  const tools = await videoMergeProcess.validateFfmpegTools();
  assert.equal(tools.ok, true);
  assert.deepEqual(seen, ['patched-ffmpeg', 'patched-ffprobe']);
});

test('runFfmpegConcatDetailed 写入 concat 列表并在结束后删除', async (t) => {
  const originalSpawn = childProcess.spawn;
  const workDir = makeTempDir('video-merge-process-concat-');
  const outputPath = path.join(workDir, 'out.mp4');
  let listContent = null;
  let listPath = null;
  childProcess.spawn = (_command, args) => {
    listPath = args[args.indexOf('-i') + 1];
    listContent = fs.readFileSync(listPath, 'utf8');
    return fakeChild((child) => {
      fs.writeFileSync(outputPath, 'merged');
      child.exitCode = 0;
      child.emit('close', 0, null);
    });
  };
  t.after(() => {
    childProcess.spawn = originalSpawn;
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  const ok = await videoMergeProcess.runFfmpegConcat(
    [path.join(workDir, "clip's.mp4"), path.join(workDir, 'b.mp4')],
    outputPath,
    silentLog,
    { workDir }
  );
  assert.equal(ok, true);
  assert.match(listContent, /file '.*clip'\\''s\.mp4'/);
  assert.equal(listPath && fs.existsSync(listPath), false);
});
