/**
 * 整集合并后的后处理：对白 TTS 轨、解说旁白轨+SRT、右下角文字水印（可组合）。
 */
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const { getFfmpegPath, getFfprobePath } = require('../utils/ffmpegPath');
const uploadService = require('./uploadService');

const MAX_STORED_AUDIO_BYTES = 256 * 1024 * 1024;
const PROCESS_OUTPUT_LIMIT_BYTES = 16 * 1024 * 1024;
const FFMPEG_TIMEOUT_MS = 30 * 60 * 1000;
const FFPROBE_TIMEOUT_MS = 15 * 1000;
const PROCESS_KILL_GRACE_MS = 1000;

function operationCancelledError(reason) {
  if (reason instanceof Error && reason.code === 'OPERATION_CANCELLED') return reason;
  const error = new Error(reason instanceof Error ? reason.message : String(reason || '操作已取消'));
  error.name = 'AbortError';
  error.code = 'OPERATION_CANCELLED';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw operationCancelledError(signal.reason);
}

function normalizePositiveMs(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function runExternalProcess(command, args, options = {}) {
  const signal = options.signal;
  throwIfAborted(signal);
  const timeoutMs = normalizePositiveMs(options.timeoutMs, FFMPEG_TIMEOUT_MS);
  const killGraceMs = normalizePositiveMs(options.killGraceMs, PROCESS_KILL_GRACE_MS);
  const outputLimit = Math.max(1024, Number(options.outputLimitBytes) || PROCESS_OUTPUT_LIMIT_BYTES);

  return new Promise((resolve, reject) => {
    let child;
    let settled = false;
    let stdout = '';
    let stderr = '';
    let timeoutTimer;
    let forceSettleTimer;
    let terminal = null;

    const appendOutput = (current, chunk) => {
      const next = current + String(chunk || '');
      return next.length > outputLimit ? next.slice(-outputLimit) : next;
    };
    const cleanup = () => {
      clearTimeout(timeoutTimer);
      clearTimeout(forceSettleTimer);
      signal?.removeEventListener('abort', onAbort);
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const settleTerminal = () => {
      if (terminal?.type === 'abort') {
        finish(reject, terminal.error);
        return;
      }
      finish(resolve, {
        ok: false,
        error: terminal?.error || `${options.timeoutLabel || command} 执行超时`,
        stdout,
        stderr,
        status: null,
        signal: 'SIGKILL',
      });
    };
    const terminate = (nextTerminal) => {
      if (terminal || settled) return;
      terminal = nextTerminal;
      try {
        if (child && child.exitCode == null && !child.signalCode) child.kill('SIGKILL');
      } catch (_) {}
      if (settled) return;
      forceSettleTimer = setTimeout(settleTerminal, killGraceMs);
    };
    const onAbort = () => terminate({
      type: 'abort',
      error: operationCancelledError(signal?.reason),
    });

    try {
      child = childProcess.spawn(command, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      finish(resolve, { ok: false, error: error.message, stdout, stderr, status: null });
      return;
    }

    child.stdout?.on('data', (chunk) => { stdout = appendOutput(stdout, chunk); });
    child.stderr?.on('data', (chunk) => { stderr = appendOutput(stderr, chunk); });
    child.once('error', (error) => {
      if (terminal) settleTerminal();
      else finish(resolve, { ok: false, error: error.message, stdout, stderr, status: null });
    });
    child.once('close', (code, closeSignal) => {
      if (terminal || signal?.aborted) {
        if (!terminal) onAbort();
        settleTerminal();
        return;
      }
      finish(resolve, {
        ok: code === 0,
        error: code === 0
          ? null
          : String(stderr || stdout || '').trim() || `${command} 退出码为 ${code}`,
        stdout,
        stderr,
        status: code,
        signal: closeSignal,
      });
    });

    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    if (!settled) {
      timeoutTimer = setTimeout(() => terminate({
        type: 'timeout',
        error: `${options.timeoutLabel || command} 执行超时（${timeoutMs}ms）`,
      }), timeoutMs);
    }
  });
}

function publishStagedFiles(files, tempRoot) {
  void tempRoot;
  const publications = [];
  let closed = false;
  const rollback = () => {
    if (closed) return;
    closed = true;
    for (const publication of [...publications].reverse()) publication.rollback();
  };
  try {
    for (const file of files) {
      const { stagedPath, finalPath } = file;
      publications.push(uploadService.publishStagedFile(stagedPath, finalPath));
    }
  } catch (error) {
    rollback();
    throw error;
  }
  return {
    commit() {
      if (closed) return;
      closed = true;
      for (const publication of publications) publication.commit();
    },
    rollback,
  };
}

/*
 * 每个 FFmpeg 输出都先落在 tempRoot，再由 publishStagedFiles 发布；tempRoot 与 storageRoot
 * 必须保持同一文件系统，避免跨盘 rename 把发布退化成复制。
 */
function assertSameStorageDevice(tempRoot, finalPath) {
  const tempDev = fs.statSync(tempRoot).dev;
  const finalDev = fs.statSync(path.dirname(finalPath)).dev;
  if (tempDev !== finalDev) {
    throw new Error('后处理暂存目录与最终目录不在同一文件系统');
  }
}

async function ffprobeDurationSec(filePath, options = {}) {
  const probe = getFfprobePath();
  const r = await runExternalProcess(
    probe,
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
    {
      signal: options.signal,
      timeoutMs: normalizePositiveMs(options.timeoutMs, FFPROBE_TIMEOUT_MS),
      killGraceMs: options.killGraceMs,
      timeoutLabel: 'ffprobe',
      outputLimitBytes: 1024 * 1024,
    }
  );
  if (!r.ok) return null;
  const d = parseFloat(String(r.stdout || '').trim());
  return Number.isFinite(d) && d > 0 ? d : null;
}

function formatSrtTimestamp(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const z = Math.floor(ms % 1000);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${p2(h)}:${p2(m)}:${p2(s)},${String(z).padStart(3, '0')}`;
}

function buildAtempoChain(factor) {
  if (!Number.isFinite(factor) || factor <= 0) return null;
  if (Math.abs(factor - 1) < 0.002) return null;
  const parts = [];
  let f = factor;
  while (f > 2.001) {
    parts.push('atempo=2');
    f /= 2;
  }
  while (f < 0.499) {
    parts.push('atempo=0.5');
    f /= 0.5;
  }
  parts.push(`atempo=${Math.min(2, Math.max(0.5, f))}`);
  return parts.join(',');
}

function escapeFfmpegPath(absPath) {
  let s = path.resolve(absPath).replace(/\\/g, '/');
  if (/^[A-Za-z]:/.test(s)) s = s.replace(/^([A-Za-z]):/, '$1\\:');
  return s.replace(/'/g, "\\'");
}

async function runFfmpeg(args, log, tag, options = {}) {
  const bin = getFfmpegPath();
  const r = await runExternalProcess(bin, args, {
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    killGraceMs: options.killGraceMs,
    timeoutLabel: `ffmpeg ${tag}`,
  });
  if (!r.ok) {
    log.warn('merged post: ffmpeg failed', {
      tag,
      error: r.error,
      stderr: r.stderr?.slice(-1000),
    });
    return false;
  }
  return true;
}

function copyStoredAudioToTemp(storageRoot, storedPath, targetPath) {
  const raw = storedPath && String(storedPath).trim();
  if (!raw) return false;
  let opened;
  try {
    opened = uploadService.openStorageFile(storageRoot, raw);
  } catch (error) {
    if (error?.code === 'UNSAFE_MEDIA_REFERENCE' && error?.reason === 'NOT_FOUND') return false;
    throw error;
  }
  let targetFd;
  let completed = false;
  try {
    if (!opened.stat.isFile() || opened.stat.size <= 0 || opened.stat.size > MAX_STORED_AUDIO_BYTES) {
      throw new Error('本地音频文件为空或超过大小限制，请重新生成配音后再合成');
    }
    targetFd = fs.openSync(targetPath, 'wx');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let bytesRead;
    do {
      bytesRead = fs.readSync(opened.fd, buffer, 0, buffer.length, null);
      let offset = 0;
      while (offset < bytesRead) {
        offset += fs.writeSync(targetFd, buffer, offset, bytesRead - offset);
      }
    } while (bytesRead > 0);
    completed = true;
    return true;
  } finally {
    if (targetFd !== undefined) fs.closeSync(targetFd);
    fs.closeSync(opened.fd);
    if (!completed) {
      try { fs.unlinkSync(targetPath); } catch (_) {}
    }
  }
}

function appendVideoEncoderArgs(args, videoEncoder) {
  if (videoEncoder && Array.isArray(videoEncoder.outputArgs) && videoEncoder.outputArgs.length > 0) {
    args.push(...videoEncoder.outputArgs, '-pix_fmt', 'yuv420p');
    return;
  }
  args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '23');
}

function writeSilenceMp3(slotSec, outPath, log, options) {
  return runFfmpeg(
    ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', String(slotSec), '-c:a', 'libmp3lame', '-q:a', '6', outPath],
    log,
    'silence',
    options
  );
}

async function fitAudioToSlot(inputPath, slotSec, outPath, log, options) {
  const d = await ffprobeDurationSec(inputPath, options);
  if (d == null || d <= 0.01) return false;
  const eps = 0.06;
  if (d > slotSec + eps) {
    const factor = d / slotSec;
    const chain = buildAtempoChain(factor);
    const af = chain || 'anull';
    return runFfmpeg(
      ['-y', '-i', inputPath, '-af', af, '-t', String(slotSec), '-c:a', 'libmp3lame', '-q:a', '4', outPath],
      log,
      'fit_speed',
      options
    );
  }
  if (d < slotSec - eps) {
    const pad = slotSec - d;
    return runFfmpeg(
      ['-y', '-i', inputPath, '-af', `apad=pad_dur=${pad}`, '-t', String(slotSec), '-c:a', 'libmp3lame', '-q:a', '4', outPath],
      log,
      'fit_pad',
      options
    );
  }
  try {
    fs.copyFileSync(inputPath, outPath);
    return true;
  } catch (_) {
    return runFfmpeg(
      ['-y', '-i', inputPath, '-t', String(slotSec), '-c:a', 'libmp3lame', '-q:a', '4', outPath],
      log,
      'fit_copy',
      options
    );
  }
}

async function concatMp3List(segmentPaths, outPath, log, options) {
  const listFile = path.join(path.dirname(outPath), `mix_concat_${Date.now()}.txt`);
  try {
    const lines = segmentPaths.map((p) => {
      const normalized = path.resolve(p).replace(/\\/g, '/');
      return `file '${normalized.replace(/'/g, "'\\''")}'`;
    });
    uploadService.writeFileAtomically(listFile, (stagedPath) => {
      fs.writeFileSync(stagedPath, lines.join('\n'), 'utf8');
    });
    return await runFfmpeg(
      ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c:a', 'libmp3lame', '-q:a', '4', outPath],
      log,
      'concat_mix',
      options
    );
  } finally {
    try {
      if (fs.existsSync(listFile)) fs.unlinkSync(listFile);
    } catch (_) {}
  }
}

async function alignAudioToVideoDuration(inMp3, videoDur, outPath, log, options) {
  const n = await ffprobeDurationSec(inMp3, options);
  if (n == null || !Number.isFinite(videoDur) || videoDur <= 0.1) return false;
  const eps = 0.08;
  if (n > videoDur + eps) {
    const factor = n / videoDur;
    const chain = buildAtempoChain(factor);
    if (!chain) {
      try {
        fs.copyFileSync(inMp3, outPath);
        return true;
      } catch (_) {
        return false;
      }
    }
    return runFfmpeg(
      ['-y', '-i', inMp3, '-af', chain, '-t', String(videoDur), '-c:a', 'libmp3lame', '-q:a', '4', outPath],
      log,
      'align_speed',
      options
    );
  }
  if (n < videoDur - eps) {
    const pad = videoDur - n;
    return runFfmpeg(
      ['-y', '-i', inMp3, '-af', `apad=pad_dur=${pad}`, '-t', String(videoDur), '-c:a', 'libmp3lame', '-q:a', '4', outPath],
      log,
      'align_pad',
      options
    );
  }
  try {
    fs.copyFileSync(inMp3, outPath);
    return true;
  } catch (_) {
    return false;
  }
}

function amixTwoTracks(pathA, pathB, slotSec, outPath, log, options) {
  return runFfmpeg(
    [
      '-y', '-i', pathA, '-i', pathB,
      '-filter_complex', `[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
      '-map', '[aout]',
      '-t', String(slotSec),
      '-c:a', 'libmp3lame', '-q:a', '4',
      outPath,
    ],
    log,
    'amix_seg',
    options
  );
}

function getDrawtextFontOption() {
  const candidates = [];
  if (process.platform === 'win32') {
    const root = process.env.SystemRoot || 'C:\\Windows';
    candidates.push(
      path.join(root, 'Fonts', 'msyh.ttc'),
      path.join(root, 'Fonts', 'msyhbd.ttc'),
      path.join(root, 'Fonts', 'simhei.ttf')
    );
  }
  candidates.push('/System/Library/Fonts/PingFang.ttc', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf');
  for (const p of candidates) {
    if (p && fs.existsSync(p)) {
      return `:fontfile='${escapeFfmpegPath(p)}'`;
    }
  }
  return '';
}

/**
 * @param {object} mergeOpts — burn_dialogue_audio, burn_narration_subtitles, watermark_text
 */
async function runMergedEpisodePostProcess(db, log, opts) {
  const {
    mergedAbsPath,
    storageRoot,
    scenes,
    episodeId,
    mergeOpts = {},
    videoEncoder = null,
    outputPath = null,
    srtOutputPath = null,
    deferPublication = false,
    signal = null,
    processTimeoutMs,
    processKillGraceMs,
  } = opts;
  const processOptions = {
    signal,
    timeoutMs: processTimeoutMs,
    killGraceMs: processKillGraceMs,
  };
  const wantDial = !!mergeOpts.burn_dialogue_audio;
  const wantNarr = !!mergeOpts.burn_narration_subtitles;
  const watermarkText = (mergeOpts.watermark_text && String(mergeOpts.watermark_text).trim())
    ? String(mergeOpts.watermark_text).trim().slice(0, 200)
    : '';

  if (!mergedAbsPath || !fs.existsSync(mergedAbsPath) || !Array.isArray(scenes) || scenes.length === 0) {
    return { ok: false, error: '无效合成参数' };
  }

  const needAudio = wantDial || wantNarr;
  if (!needAudio && !watermarkText) {
    return { ok: false, error: 'NO_POST_OPTS' };
  }

  const storageRootResolved = path.resolve(storageRoot);
  const mergedResolved = path.resolve(mergedAbsPath);
  if (mergedResolved !== storageRootResolved
    && !mergedResolved.startsWith(`${storageRootResolved}${path.sep}`)) {
    return { ok: false, error: '合成视频不在本地存储目录内' };
  }
  // 暂存目录必须和最终目录处于同一文件系统，避免 Docker 挂载盘或 Windows 跨盘符 rename 失败。
  const tempRoot = fs.mkdtempSync(path.join(path.dirname(mergedResolved), `.drama-merged-post-${episodeId || 0}-`));
  const baseName = path.basename(mergedAbsPath, path.extname(mergedAbsPath));
  const outAbs = path.resolve(outputPath || path.join(path.dirname(mergedAbsPath), `${baseName}_post.mp4`));
  const stagedOutAbs = path.join(tempRoot, 'post-output.mp4');
  const finalSrtPath = path.resolve(srtOutputPath || path.join(path.dirname(outAbs), `${path.basename(outAbs, path.extname(outAbs))}_narration.srt`));
  let publication = null;
  try {
    assertSameStorageDevice(tempRoot, outAbs);
    throwIfAborted(signal);
    const videoDur = await ffprobeDurationSec(mergedAbsPath, processOptions);
    if (videoDur == null) {
      return { ok: false, error: '无法读取合成视频时长' };
    }

    let alignedAudioPath = null;
    let srtPath = null;
    let srtLines = [];

    if (needAudio) {
      let tMs = 0;
      let srtIdx = 1;
      const segmentFiles = [];

      for (let i = 0; i < scenes.length; i++) {
        throwIfAborted(signal);
        const sc = scenes[i];
        const sbId = Number(sc.scene_id);
        const slotSec = Math.max(0.2, Number(sc.duration) || 5);
        const row = db.prepare(
          'SELECT dialogue, narration, audio_local_path, narration_audio_local_path FROM storyboards WHERE id = ? AND deleted_at IS NULL'
        ).get(sbId);

        const narrText = (row?.narration && String(row.narration).trim()) ? String(row.narration).trim() : '';
        if (wantNarr && narrText) {
          const durMs = Math.round(slotSec * 1000);
          srtLines.push(String(srtIdx++), `${formatSrtTimestamp(tMs)} --> ${formatSrtTimestamp(tMs + durMs)}`, narrText, '');
        }
        tMs += Math.round(slotSec * 1000);

        const diaFit = path.join(tempRoot, `dia_fit_${i}.mp3`);
        const narrFit = path.join(tempRoot, `narr_fit_${i}.mp3`);
        const segOut = path.join(tempRoot, `seg_mix_${i}.mp3`);

        if (wantDial) {
          const diaRaw = path.join(tempRoot, `dia_raw_${i}.audio`);
          if (copyStoredAudioToTemp(storageRoot, row?.audio_local_path, diaRaw)) {
            if (!await fitAudioToSlot(diaRaw, slotSec, diaFit, log, processOptions)) {
              return { ok: false, error: `对白配音时长对齐失败 #${i}` };
            }
          } else if (!await writeSilenceMp3(slotSec, diaFit, log, processOptions)) {
            return { ok: false, error: `对白静音片段失败 #${i}` };
          }
        }

        if (wantNarr) {
          if (!narrText) {
            if (!await writeSilenceMp3(slotSec, narrFit, log, processOptions)) {
              return { ok: false, error: `旁白静音片段失败 #${i}` };
            }
          } else {
            const segRaw = path.join(tempRoot, `narr_raw_${i}.mp3`);
            const reusedNarration = copyStoredAudioToTemp(
              storageRoot,
              row?.narration_audio_local_path,
              segRaw
            );
            if (reusedNarration) {
              log.info('merged post: reusing storyboard narration audio', { segment: i, storyboard_id: sbId });
            } else {
              let synth;
              try {
                throwIfAborted(signal);
                synth = await require('./ttsService').synthesize(db, log, {
                  text: narrText,
                  storyboard_id: sbId || null,
                  storage_base: storageRoot,
                  signal,
                });
                throwIfAborted(signal);
              } catch (e) {
                if (signal?.aborted || e?.code === 'OPERATION_CANCELLED') throw operationCancelledError(signal?.reason || e);
                log.warn('merged post: narration TTS failed', { segment: i, error: e.message });
                return { ok: false, error: `解说旁白 TTS 失败：${e.message}` };
              }
              if (!copyStoredAudioToTemp(storageRoot, synth?.local_path, segRaw)) {
                return { ok: false, error: '旁白 TTS 文件不存在' };
              }
              if (sbId && synth?.local_path) {
                throwIfAborted(signal);
                db.prepare(
                  'UPDATE storyboards SET narration_audio_local_path = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
                ).run(String(synth.local_path), new Date().toISOString(), sbId);
              }
            }
            if (!await fitAudioToSlot(segRaw, slotSec, narrFit, log, processOptions)) {
              return { ok: false, error: `旁白时长对齐失败 #${i}` };
            }
          }
        }

        if (wantDial && wantNarr) {
          if (!await amixTwoTracks(diaFit, narrFit, slotSec, segOut, log, processOptions)) {
            return { ok: false, error: `对白与旁白混音失败 #${i}` };
          }
        } else if (wantDial) {
          try {
            fs.copyFileSync(diaFit, segOut);
          } catch (_) {
            return { ok: false, error: `对白片段复制失败 #${i}` };
          }
        } else if (wantNarr) {
          try {
            fs.copyFileSync(narrFit, segOut);
          } catch (_) {
            return { ok: false, error: `旁白片段复制失败 #${i}` };
          }
        }

        segmentFiles.push(segOut);
      }

      const concatOut = path.join(tempRoot, 'full_mix.mp3');
      if (!await concatMp3List(segmentFiles, concatOut, log, processOptions)) {
        return { ok: false, error: '音轨拼接失败' };
      }

      alignedAudioPath = path.join(tempRoot, 'aligned_mix.mp3');
      if (!await alignAudioToVideoDuration(concatOut, videoDur, alignedAudioPath, log, processOptions)) {
        return { ok: false, error: '音轨与视频总时长对齐失败' };
      }

      if (wantNarr && srtLines.length > 0) {
        srtPath = path.join(tempRoot, 'narration.srt');
        fs.writeFileSync(srtPath, `\uFEFF${srtLines.join('\n')}\n`, 'utf8');
      }
    }

    const hasSubs = !!(srtPath && fs.existsSync(srtPath));
    const hasWm = !!watermarkText;

    const vfParts = [];
    if (hasSubs) {
      const subEsc = escapeFfmpegPath(srtPath);
      vfParts.push(`subtitles='${subEsc}':charenc=UTF-8`);
    }
    if (hasWm) {
      const wmFile = path.join(tempRoot, 'watermark.txt');
      fs.writeFileSync(wmFile, watermarkText, 'utf8');
      const wmEsc = escapeFfmpegPath(wmFile);
      const fontOpt = getDrawtextFontOption();
      vfParts.push(
        `drawtext=textfile='${wmEsc}':reload=1${fontOpt}:x=w-tw-16:y=h-th-16:fontsize=22:fontcolor=white@0.82:borderw=2:bordercolor=black@0.55`
      );
    }
    let filterComplex = '';
    if (vfParts.length === 1) {
      filterComplex = `[0:v]${vfParts[0]}[vout]`;
    } else if (vfParts.length === 2) {
      filterComplex = `[0:v]${vfParts[0]}[vx];[vx]${vfParts[1]}[vout]`;
    }

    if (needAudio) {
      if (!alignedAudioPath || !fs.existsSync(alignedAudioPath)) {
        return { ok: false, error: '内部错误：缺少对齐音轨' };
      }
      const args = ['-y', '-i', mergedAbsPath, '-i', alignedAudioPath];
      if (filterComplex) {
        args.push('-filter_complex', filterComplex, '-map', '[vout]', '-map', '1:a');
      } else {
        args.push('-map', '0:v', '-map', '1:a');
      }
      appendVideoEncoderArgs(args, videoEncoder);
      args.push('-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', stagedOutAbs);
      if (!await runFfmpeg(args, log, 'mux_av', processOptions)) {
        return { ok: false, error: '烧录字幕/水印或混音失败' };
      }
    } else {
      if (!filterComplex) {
        return { ok: false, error: '内部错误：仅水印但无滤镜链' };
      }
      const args = ['-y', '-i', mergedAbsPath, '-filter_complex', filterComplex, '-map', '[vout]'];
      if (await ffprobeHasAudio(mergedAbsPath, processOptions)) {
        args.push('-map', '0:a', '-c:a', 'copy');
      } else {
        args.push('-an');
      }
      appendVideoEncoderArgs(args, videoEncoder);
      args.push('-movflags', '+faststart', stagedOutAbs);
      if (!await runFfmpeg(args, log, 'watermark_only', processOptions)) {
        return { ok: false, error: '水印烧录失败' };
      }
    }

    throwIfAborted(signal);
    if (!fs.existsSync(stagedOutAbs) || fs.statSync(stagedOutAbs).size <= 0) {
      return { ok: false, error: '输出文件未生成' };
    }
    const stagedFiles = [{ stagedPath: stagedOutAbs, finalPath: outAbs }];
    if (srtPath && fs.existsSync(srtPath)) {
      stagedFiles.push({ stagedPath: srtPath, finalPath: finalSrtPath });
    }
    publication = publishStagedFiles(stagedFiles, tempRoot);
    throwIfAborted(signal);

    const relFromRoot = path.relative(storageRoot, outAbs).replace(/\\/g, '/');
    const srtRelativePath = srtPath && fs.existsSync(finalSrtPath)
      ? path.relative(storageRootResolved, finalSrtPath).replace(/\\/g, '/')
      : null;
    if (deferPublication) {
      const pendingPublication = publication;
      publication = null;
      log.info('merged post: published pending parent transaction', { episode_id: episodeId, video: relFromRoot });
      return {
        ok: true,
        relativePath: relFromRoot,
        srtRelativePath,
        publication: pendingPublication,
        intermediatePath: outAbs !== mergedAbsPath ? mergedAbsPath : null,
      };
    }

    publication.commit();
    publication = null;

    try {
      if (fs.existsSync(mergedAbsPath) && outAbs !== mergedAbsPath) {
        fs.unlinkSync(mergedAbsPath);
      }
    } catch (e) {
      log.warn('merged post: could not remove intermediate', { error: e.message });
    }

    log.info('merged post: done', { episode_id: episodeId, video: relFromRoot });
    return { ok: true, relativePath: relFromRoot, srtRelativePath };
  } catch (e) {
    publication?.rollback();
    log.warn('merged post: exception', { error: e.message });
    return { ok: false, error: e.message || String(e) };
  } finally {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch (_) {}
    try {
      fs.rmdirSync(path.dirname(tempRoot));
    } catch (_) {}
  }
}

async function ffprobeHasAudio(filePath, options = {}) {
  const probe = getFfprobePath();
  const r = await runExternalProcess(
    probe,
    ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', filePath],
    {
      signal: options.signal,
      timeoutMs: normalizePositiveMs(options.timeoutMs, FFPROBE_TIMEOUT_MS),
      killGraceMs: options.killGraceMs,
      timeoutLabel: 'ffprobe',
      outputLimitBytes: 1024 * 1024,
    }
  );
  return r.ok && String(r.stdout || '').trim().length > 0;
}

module.exports = {
  copyStoredAudioToTemp,
  runMergedEpisodePostProcess,
  ffprobeDurationSec,
};
