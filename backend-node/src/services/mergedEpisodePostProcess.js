/**
 * 整集合并后的后处理：对白 TTS 轨、解说旁白轨+SRT、右下角文字水印（可组合）。
 */
const fs = require('fs');
const path = require('path');
const {
  POST_PROCESS_FALLBACK,
  throwIfAborted,
  userFacingPostProcessError,
  ffprobeDurationSec,
  copyStoredAudioToTemp,
  fitAudioToSlot,
  writeSilenceMp3,
  concatMp3List,
  alignAudioToVideoDuration,
  amixTwoTracks,
  escapeFfmpegPath,
  getDrawtextFontOption,
  appendVideoEncoderArgs,
  runFfmpeg,
  publishStagedFiles,
  ffprobeHasAudio,
  assertSameStorageDevice,
  operationCancelledError,
  formatSrtTimestamp,
} = require('./mergedEpisodePostProcessFfmpeg');

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
                return { ok: false, error: userFacingPostProcessError(e, '解说旁白 TTS 失败') };
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
    return { ok: false, error: userFacingPostProcessError(e, POST_PROCESS_FALLBACK) };
  } finally {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch (_) {}
    try {
      fs.rmdirSync(path.dirname(tempRoot));
    } catch (_) {}
  }
}


module.exports = {
  copyStoredAudioToTemp,
  runMergedEpisodePostProcess,
  ffprobeDurationSec,
};
