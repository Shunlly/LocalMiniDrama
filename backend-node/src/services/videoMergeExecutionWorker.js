'use strict';

/**
 * 视频合成执行 worker：严格生产合成与普通拼接流水线。
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { randomUUID } = require('crypto');
const ffmpegPath = require('../utils/ffmpegPath');
const storageLayout = require('./storageLayout');
const {
  operationCancelledError,
  throwIfAborted,
  describePostProcessFailure,
  isOperationCancelled,
  strictMergeError,
} = require('./videoMergeErrors');
const { toUserFacingProcessError } = require('./providerErrorSanitizer');
const {
  STRICT_PRODUCTION_MODE,
  pathWithinStorage,
  parseMergeOptions,
  isStrictProductionMode,
  buildStrictSceneFilterPlan,
  assertFilterPlanMatchesScenes,
  chooseProductionDimensions,
  chooseProductionFps,
  chooseProductionVideoEncoder,
  relativeStoragePath,
  needsMergedEpisodePostProcess,
  assertProductionOutputHasAudio,
  assertProductionDurationComplete,
} = require('./videoMergePlanning');
const {
  MAX_REMOTE_MERGE_DOWNLOAD_BYTES,
  removeFileIfPresent,
  resolveVideoToLocalPath,
  checkMediaBinary,
  validateFfmpegTools,
  getAvailableFfmpegEncoders,
  ffprobeVideo,
  transcodeProductionClip,
  runFfmpegConcat,
  runFfmpegConcatDetailed,
} = require('./videoMergeProcess');
const {
  configuredProviderOrigins,
  getStorageRoot,
  validateStrictSceneCoverage,
} = require('./videoMergeExecutionNormalize');
const {
  updateCurrentMergeEpisodeOutput,
  commitMergeFailure,
  publishMergeOutput,
  persistMergeOutputAndCommitPublications,
} = require('./videoMergeExecutionLifecycle');

async function processStrictProductionMerge(db, log, row, scenes, mergeOpts, baseUrl, execution) {
  const mergeId = row.id;
  const episodeId = row.episode_id;
  let tempRoot = null;
  let outputPublication = null;
  let postPublication = null;
  const generatedFiles = new Set();
  const { signal } = execution;

  try {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `drama-video-merge-${mergeId}-`));
    execution.trackDirectory(tempRoot);
    throwIfAborted(signal);
    const strictScenes = validateStrictSceneCoverage(db, episodeId, scenes);
    const resolvedFilterPlan = buildStrictSceneFilterPlan(strictScenes);
    assertFilterPlanMatchesScenes(mergeOpts.filter_plan, resolvedFilterPlan);

    const toolCheck = await validateFfmpegTools(signal);
    if (!toolCheck.ok) throw strictMergeError(`严格生产合成工具校验失败：${toolCheck.error}`);
    const encoderCheck = await getAvailableFfmpegEncoders(signal);
    if (!encoderCheck.ok) throw strictMergeError(`无法读取 FFmpeg 编码器能力：${encoderCheck.error}`);
    if (!encoderCheck.encoders.includes('aac')) {
      throw strictMergeError('当前 FFmpeg 缺少 AAC 编码器');
    }
    const storageRoot = getStorageRoot();
    const downloadBudget = { remainingBytes: MAX_REMOTE_MERGE_DOWNLOAD_BYTES };
    const trustedOrigins = configuredProviderOrigins(db);

    const localInputs = [];
    const inputProbes = [];
    for (let i = 0; i < strictScenes.length; i++) {
      const resolvedVideo = await resolveVideoToLocalPath(
        strictScenes[i]?.video_url,
        baseUrl,
        storageRoot,
        tempRoot,
        i,
        log,
        { downloadBudget, trustedOrigins, signal }
      );
      if (!resolvedVideo) {
        throw strictMergeError(`严格生产合成缺少可用本地片段：分镜 ${strictScenes[i].storyboard_id}`);
      }
      const probe = await ffprobeVideo(resolvedVideo.path, { signal });
      if (!probe.ok) {
        throw strictMergeError(`严格生产合成片段无效：分镜 ${strictScenes[i].storyboard_id}（${probe.error}）`);
      }
      localInputs.push(resolvedVideo.path);
      inputProbes.push(probe);
    }

    const dimensions = chooseProductionDimensions(inputProbes, mergeOpts);
    const fps = chooseProductionFps(mergeOpts);
    const videoEncoder = chooseProductionVideoEncoder(encoderCheck.encoders, dimensions.width, dimensions.height, fps);
    log.info('Video merge: strict production profile', {
      merge_id: mergeId,
      scene_count: strictScenes.length,
      width: dimensions.width,
      height: dimensions.height,
      fps,
      video_encoder: videoEncoder.name,
    });

    const normalizedPaths = [];
    let expectedOutputDuration = 0;
    for (let i = 0; i < localInputs.length; i++) {
      const normalizedPath = path.join(tempRoot, `normalized_${String(i).padStart(3, '0')}.mp4`);
      const transcoded = await transcodeProductionClip(
        localInputs[i],
        inputProbes[i],
        normalizedPath,
        dimensions,
        fps,
        videoEncoder,
        log,
        i,
        strictScenes[i].duration,
        { signal }
      );
      if (!transcoded.ok) {
        throw strictMergeError(`严格生产片段转码失败：分镜 ${strictScenes[i].storyboard_id}（${transcoded.error}）`);
      }
      normalizedPaths.push(normalizedPath);
      expectedOutputDuration += transcoded.probe.duration;
    }

    const projectSubdir = storageLayout.getProjectStorageSubdir(db, row.drama_id);
    const sub = projectSubdir && String(projectSubdir).trim();
    const mergedDir = sub
      ? path.join(storageRoot, sub, 'videos', 'merged')
      : path.join(storageRoot, 'videos', 'merged');
    fs.mkdirSync(mergedDir, { recursive: true });
    const outputFileName = `merged_${mergeId}_${Date.now()}_${randomUUID().slice(0, 8)}.mp4`;
    const finalOutputAbsPath = path.join(mergedDir, outputFileName);
    // FFmpeg 依赖末尾扩展名推断容器；暂存名必须继续以 .mp4 结尾。
    const outputStagePath = path.join(
      mergedDir,
      `.${path.basename(outputFileName, '.mp4')}.${randomUUID()}.tmp.mp4`
    );
    let outputAbsPath = outputStagePath;
    let finalSrtPath = null;
    generatedFiles.add(outputStagePath);
    execution.trackFile(outputStagePath);

    const concat = await runFfmpegConcatDetailed(
      normalizedPaths,
      outputAbsPath,
      log,
      'strict_concat',
      true,
      { signal, workDir: tempRoot }
    );
    if (!concat.ok) throw strictMergeError(`严格生产 FFmpeg concat 失败：${concat.error}`);
    let outputProbe = await ffprobeVideo(outputAbsPath, { signal });
    assertProductionOutputHasAudio(outputProbe, '严格生产 concat 输出无效', '最终视频缺少音轨');
    assertProductionDurationComplete(outputProbe, expectedOutputDuration, '严格生产 concat 输出不完整');

    const postNeed = needsMergedEpisodePostProcess(mergeOpts);
    if (postNeed) {
      const anticipatedPostPath = path.join(
        path.dirname(finalOutputAbsPath),
        `${path.basename(finalOutputAbsPath, path.extname(finalOutputAbsPath))}_post.mp4`
      );
      const anticipatedSrtPath = path.join(
        path.dirname(finalOutputAbsPath),
        `${path.basename(finalOutputAbsPath, path.extname(finalOutputAbsPath))}_narration.srt`
      );
      throwIfAborted(signal);
      const post = await require('./mergedEpisodePostProcess').runMergedEpisodePostProcess(db, log, {
        mergedAbsPath: outputAbsPath,
        storageRoot,
        scenes: strictScenes,
        episodeId,
        mergeOpts,
        videoEncoder,
        signal,
        outputPath: anticipatedPostPath,
        srtOutputPath: anticipatedSrtPath,
        deferPublication: true,
      });
      postPublication = post.publication || null;
      execution.trackPublication(postPublication);
      throwIfAborted(signal);
      if (!post.ok || !post.relativePath) {
        throw strictMergeError(`严格生产后处理失败：${describePostProcessFailure(post.error)}`);
      }
      outputAbsPath = path.join(storageRoot, post.relativePath.replace(/\//g, path.sep));
      const returnedSrtPath = pathWithinStorage(storageRoot, post.srtRelativePath);
      finalSrtPath = returnedSrtPath || (fs.existsSync(anticipatedSrtPath) ? anticipatedSrtPath : null);
      if (!postPublication) {
        generatedFiles.add(outputAbsPath);
        execution.trackFile(outputAbsPath);
        if (finalSrtPath) {
          generatedFiles.add(finalSrtPath);
          execution.trackFile(finalSrtPath);
        }
      }
      outputProbe = await ffprobeVideo(outputAbsPath, { signal });
      assertProductionOutputHasAudio(outputProbe, '严格生产后处理输出无效', '后处理视频缺少音轨');
      assertProductionDurationComplete(outputProbe, expectedOutputDuration, '严格生产后处理输出不完整');
    } else {
      outputPublication = publishMergeOutput(outputStagePath, finalOutputAbsPath, signal, execution);
      outputAbsPath = finalOutputAbsPath;
    }

    if (mergeOpts.enforce_qa_gate) try {
      const qaReport = require('./qaService').auditDrama(db, log, {
        drama_id: row.drama_id,
        episode_id: episodeId,
        mode: 'production',
      });
      if (!qaReport.passed) {
        throw strictMergeError(`生产 QA 未通过，得分 ${qaReport.score}`);
      }
    } catch (error) {
      throw error.code === 'STRICT_PRODUCTION_MERGE_FAILED'
        ? error
        : strictMergeError(toUserFacingProcessError(error, '生产 QA 失败，请稍后重试'));
    }

    const mergedRelativePath = relativeStoragePath(storageRoot, outputAbsPath);
    const completedAt = new Date().toISOString();
    const duration = Math.max(1, Math.round(outputProbe.duration));
    const completionStatus = mergeOpts.defer_qa_completion ? 'qa_pending' : 'completed';
    const taskService = require('./taskService');
    persistMergeOutputAndCommitPublications(execution, [outputPublication, postPublication], () => {
      taskService.runTaskMutation(db, row.task_id, signal, () => {
        throwIfAborted(signal);
        db.prepare(
          `UPDATE video_merges
              SET status = ?, merged_url = ?, duration = ?, completed_at = ?, error_msg = NULL
            WHERE id = ?`
        ).run(completionStatus, mergedRelativePath, duration, completionStatus === 'completed' ? completedAt : null, mergeId);
        updateCurrentMergeEpisodeOutput(
          db,
          mergeId,
          episodeId,
          mergedRelativePath,
          completionStatus,
          completedAt
        );
        if (row.task_id) {
          const taskUpdated = taskService.updateTaskResult(db, row.task_id, {
            merge_id: mergeId,
            video_url: mergedRelativePath,
            duration,
            mode: STRICT_PRODUCTION_MODE,
            status: completionStatus,
          });
          if (!taskUpdated) throw strictMergeError('严格合成任务已不再接受完成状态');
        }
        throwIfAborted(signal);
      });
    });
    execution.keepFile(outputAbsPath);
    if (finalSrtPath) execution.keepFile(finalSrtPath);
    log.info('Video merge output persisted (strict production)', {
      merge_id: mergeId,
      episode_id: episodeId,
      output: mergedRelativePath,
      status: completionStatus,
    });
    return { ok: true, merge_id: mergeId, video_url: mergedRelativePath, duration, status: completionStatus };
  } catch (error) {
    execution.rollbackPublication(outputPublication);
    execution.rollbackPublication(postPublication);
    for (const filePath of generatedFiles) {
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch (_) {}
    }
    if (isOperationCancelled(error, signal)) throw operationCancelledError(signal.reason || error);
    const detail = error?.message || String(error);
    const message = commitMergeFailure(db, row, detail, signal);
    const failure = strictMergeError(message);
    failure.cause = error;
    throw failure;
  } finally {
    try {
      if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch (_) {}
  }
}

/** 异步处理视频合成；未生成可验证的合成文件时失败关闭。 */
async function processVideoMergeWorker(db, log, mergeId, baseUrl, execution) {
  const r = db.prepare('SELECT * FROM video_merges WHERE id = ? AND deleted_at IS NULL').get(mergeId);
  if (!r) return;
  const { signal } = execution;
  const taskId = r.task_id;
  const episodeId = r.episode_id;
  let scenes = [];
  try {
    scenes = JSON.parse(r.scenes || '[]');
  } catch (_) {
    log.warn('video merge parse scenes failed', { merge_id: mergeId });
  }
  const mergeOpts = parseMergeOptions(r.merge_options);
  const strictProduction = isStrictProductionMode(r, mergeOpts);
  const now = new Date().toISOString();
  const taskService = require('./taskService');
  taskService.runTaskMutation(db, taskId, signal, () => {
    db.prepare('UPDATE video_merges SET status = ? WHERE id = ?').run('processing', mergeId);
  });
  if (strictProduction) {
    return processStrictProductionMerge(db, log, r, scenes, mergeOpts, baseUrl, execution);
  }
  if (scenes.length === 0) {
    const message = '无有效视频片段';
    commitMergeFailure(db, r, message, signal);
    return { ok: false, merge_id: mergeId, status: 'failed', error: message };
  }
  const totalDuration = scenes.reduce((sum, s) => sum + (Number(s.duration) || 0), 0);
  const storageRoot = getStorageRoot();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `drama-video-merge-${mergeId}-`));
  execution.trackDirectory(tempDir);
  const downloadBudget = { remainingBytes: MAX_REMOTE_MERGE_DOWNLOAD_BYTES };
  const trustedOrigins = configuredProviderOrigins(db);

  const resolvedVideos = [];
  for (let i = 0; i < scenes.length; i++) {
    const resolved = await resolveVideoToLocalPath(
      scenes[i].video_url,
      baseUrl,
      storageRoot,
      tempDir,
      i,
      log,
      { downloadBudget, trustedOrigins, signal }
    );
    if (resolved) resolvedVideos.push(resolved);
  }
  if (resolvedVideos.length !== scenes.length) {
    const message = resolvedVideos.length === 0
      ? '无安全且可用的视频片段'
      : '部分视频片段无法安全解析，已拒绝不完整合成';
    fs.rmSync(tempDir, { recursive: true, force: true });
    commitMergeFailure(db, r, message, signal);
    return { ok: false, merge_id: mergeId, status: 'failed', error: message };
  }
  const localPaths = resolvedVideos.map((item) => item.path);

  const ffmpegCheck = await checkMediaBinary(ffmpegPath.getFfmpegPath(), 'ffmpeg', signal);
  const ffmpegAvailable = ffmpegCheck.ok;
  log.info('Video merge: ffmpeg check', {
    merge_id: mergeId,
    has_ffmpeg: ffmpegAvailable,
    ffmpeg_path: ffmpegPath.getFfmpegPath(),
    local_video_count: localPaths.length,
    cwd: process.cwd(),
  });

  let mergedRelativePath = null;
  let mergedSrtPath = null;
  let outputPublication = null;
  let postPublication = null;
  let publishedBaseOutputPath = null;
  if (localPaths.length > 0 && ffmpegAvailable && localPaths.length <= 100) {
    const projectSubdir = storageLayout.getProjectStorageSubdir(db, r.drama_id);
    const sub = projectSubdir && String(projectSubdir).trim();
    const mergedDir = sub
      ? path.join(storageRoot, sub, 'videos', 'merged')
      : path.join(storageRoot, 'videos', 'merged');
    if (!fs.existsSync(mergedDir)) fs.mkdirSync(mergedDir, { recursive: true });
    const outputFileName = `merged_${Date.now()}_${randomUUID().slice(0, 8)}.mp4`;
    const finalOutputPath = path.join(mergedDir, outputFileName);
    const outputPath = path.join(
      mergedDir,
      `.${path.basename(outputFileName, '.mp4')}.${randomUUID()}.tmp.mp4`
    );
    execution.trackFile(outputPath);
    const ok = await runFfmpegConcat(localPaths, outputPath, log, { signal, workDir: tempDir });
    if (ok && fs.existsSync(outputPath)) {
      const outputProbe = await ffprobeVideo(outputPath, { signal });
      if (outputProbe.ok) {
        outputPublication = publishMergeOutput(outputPath, finalOutputPath, signal, execution);
        publishedBaseOutputPath = finalOutputPath;
        mergedRelativePath = sub
          ? path.join(sub, 'videos', 'merged', outputFileName).replace(/\\/g, '/')
          : path.join('videos', 'merged', outputFileName).replace(/\\/g, '/');
        log.info('Video merge completed (ffmpeg)', { merge_id: mergeId, episode_id: episodeId, output: mergedRelativePath });
      } else {
        log.warn('Video merge: FFmpeg output validation failed', { merge_id: mergeId, error: outputProbe.error });
        fs.rmSync(outputPath, { force: true });
      }
    }
  }

  const postNeed = needsMergedEpisodePostProcess(mergeOpts);
  if (mergedRelativePath && ffmpegAvailable && postNeed) {
    const mergedAbsPath = path.join(storageRoot, mergedRelativePath.replace(/\//g, path.sep));
    if (fs.existsSync(mergedAbsPath)) {
      const mergedPP = require('./mergedEpisodePostProcess');
      throwIfAborted(signal);
      const post = await mergedPP.runMergedEpisodePostProcess(db, log, {
        mergedAbsPath,
        storageRoot,
        scenes,
        episodeId,
        mergeOpts,
        signal,
        deferPublication: true,
      });
      postPublication = post.publication || null;
      execution.trackPublication(postPublication);
      // 后处理即使返回普通错误，也必须先让取消信号赢得竞态，避免继续提交失败/成功状态。
      throwIfAborted(signal);
      if (post.ok && post.relativePath) {
        const postOutputPath = pathWithinStorage(storageRoot, post.relativePath);
        const postSrtPath = pathWithinStorage(storageRoot, post.srtRelativePath);
        if (!postPublication) {
          if (postOutputPath) execution.trackFile(postOutputPath);
          if (postSrtPath) execution.trackFile(postSrtPath);
        }
        if (postSrtPath) mergedSrtPath = postSrtPath;
        throwIfAborted(signal);
        const postProbe = postOutputPath
          ? await ffprobeVideo(postOutputPath, { signal })
          : { ok: false, error: '后处理输出不在存储目录内' };
        if (postProbe.ok) {
          mergedRelativePath = post.relativePath;
          if (outputPublication && path.resolve(postOutputPath) !== path.resolve(publishedBaseOutputPath)) {
            execution.rollbackPublication(outputPublication);
            outputPublication = null;
          }
          log.info('Video merge: merged episode post-process', { merge_id: mergeId, out: mergedRelativePath });
        } else {
          log.warn('Video merge: post-process output validation failed', {
            merge_id: mergeId,
            error: postProbe.error,
          });
          const hadPostPublication = !!postPublication;
          execution.rollbackPublication(postPublication);
          postPublication = null;
          // 有 publication 时 rollback 已删除新文件并恢复旧成品，不能再删目标路径。
          if (!hadPostPublication && postOutputPath) fs.rmSync(postOutputPath, { force: true });
          if (postSrtPath && !hadPostPublication) fs.rmSync(postSrtPath, { force: true });
          mergedRelativePath = null;
        }
      } else if (post.error && post.error !== 'NO_POST_OPTS') {
        log.warn('Video merge: post-process skipped', { merge_id: mergeId, err: post.error });
      }
    }
  }

  if (!mergedRelativePath) {
    const message = ffmpegAvailable
      ? 'FFmpeg 未生成有效的合成视频文件'
      : 'FFmpeg 不可用，无法合成视频';
    fs.rmSync(tempDir, { recursive: true, force: true });
    execution.rollbackPublication(outputPublication);
    execution.rollbackPublication(postPublication);
    commitMergeFailure(db, r, message, signal);
    return { ok: false, merge_id: mergeId, status: 'failed', error: message };
  }

  const finalMergedUrl = mergedRelativePath;
  const finalOutputPath = pathWithinStorage(storageRoot, finalMergedUrl);
  throwIfAborted(signal);
  try {
    const qaService = require('./qaService');
    const qaReport = qaService.auditDrama(db, log, {
      drama_id: r.drama_id,
      episode_id: episodeId,
      mode: 'production',
    });
    if (!qaReport.passed && mergeOpts.enforce_qa_gate) {
      throw new Error(`生产 QA 未通过，得分 ${qaReport.score}`);
    }
  } catch (e) {
    if (mergeOpts.enforce_qa_gate) {
      const message = toUserFacingProcessError(e, '生产 QA 失败，请稍后重试');
      const hadPostPublication = !!postPublication;
      execution.rollbackPublication(outputPublication);
      execution.rollbackPublication(postPublication);
      // 后处理 publication 回滚后，最终路径可能已恢复为既有正确产物。
      if (!hadPostPublication && (!publishedBaseOutputPath || path.resolve(finalOutputPath) !== path.resolve(publishedBaseOutputPath))) {
        removeFileIfPresent(finalOutputPath);
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
      commitMergeFailure(db, r, message, signal);
      return { ok: false, merge_id: mergeId, status: 'failed', error: message };
    }
    log.warn('Video merge: production QA skipped', { merge_id: mergeId, error: e.message });
  }
  const duration = Math.round(totalDuration) || null;
  try {
    persistMergeOutputAndCommitPublications(execution, [outputPublication, postPublication], () => {
      taskService.runTaskMutation(db, taskId, signal, () => {
        throwIfAborted(signal);
        db.prepare(
          'UPDATE video_merges SET status = ?, merged_url = ?, duration = ?, completed_at = ?, error_msg = ? WHERE id = ?'
        ).run('completed', finalMergedUrl, duration, now, null, mergeId);
        updateCurrentMergeEpisodeOutput(db, mergeId, episodeId, finalMergedUrl, 'completed', now);
        if (!taskService.updateTaskResult(db, taskId, { merge_id: mergeId, video_url: finalMergedUrl, duration })) {
          throw new Error('视频合成任务已不再接受完成状态');
        }
        throwIfAborted(signal);
      });
    });
  } catch (error) {
    execution.rollbackPublication(outputPublication);
    execution.rollbackPublication(postPublication);
    throw error;
  }
  execution.keepFile(finalOutputPath);
  if (mergedSrtPath) execution.keepFile(mergedSrtPath);
  return { ok: true, merge_id: mergeId, video_url: finalMergedUrl, duration, status: 'completed' };
}

module.exports = {
  processStrictProductionMerge,
  processVideoMergeWorker,
};
