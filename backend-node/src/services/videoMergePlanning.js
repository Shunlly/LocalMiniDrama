'use strict';

/**
 * 视频合成规划与校验：时间线滤镜、分镜覆盖、输出规格等闭合纯函数。
 * 实际 FFmpeg 合成入口仍在 videoMergeService。
 */

const path = require('path');
const { describeInvalidProductionOutput, strictMergeError } = require('./videoMergeErrors');

const STRICT_PRODUCTION_MODE = 'strict_production';
const MAX_STRICT_SCENES = 100;

function pathWithinStorage(storageRoot, relativePath) {
  const root = path.resolve(storageRoot);
  const target = path.resolve(root, String(relativePath || '').replace(/^[/\\]+/, ''));
  if (target === root || !target.startsWith(`${root}${path.sep}`)) return null;
  return target;
}

function exactTrustedOrigin(value, trustedOrigins) {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return false;
    return trustedOrigins.some((origin) => {
      try { return new URL(origin).origin === parsed.origin; } catch (_) { return false; }
    });
  } catch (_) {
    return false;
  }
}

function parseMergeOptions(raw) {
  try {
    const value = JSON.parse(raw || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch (_) {
    return {};
  }
}

function isStrictProductionMode(row, mergeOpts) {
  return mergeOpts.mode === STRICT_PRODUCTION_MODE
    || mergeOpts.merge_mode === STRICT_PRODUCTION_MODE
    || mergeOpts.strict_production === true
    || row.model === STRICT_PRODUCTION_MODE;
}

function buildPersistedMergeOptions(req) {
  const source = req?.merge_options;
  const o = source && typeof source === 'object' && !Array.isArray(source) ? { ...source } : {};
  if (req?.mode === STRICT_PRODUCTION_MODE && o.mode == null) o.mode = STRICT_PRODUCTION_MODE;
  if (req?.strict_production === true && o.strict_production == null) o.strict_production = true;
  return o;
}

function storyboardIdForScene(scene) {
  return Number(scene?.storyboard_id ?? scene?.scene_id);
}

function assertStrictSceneCoverage(scenes, expected) {
  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw strictMergeError('严格生产合成缺少视频片段');
  }
  if (scenes.length > MAX_STRICT_SCENES) {
    throw strictMergeError(`严格生产合成最多支持 ${MAX_STRICT_SCENES} 个分镜`);
  }
  if (!Array.isArray(expected) || expected.length === 0) {
    throw strictMergeError('严格生产合成找不到预期分镜');
  }

  const expectedIds = expected.map((row) => Number(row.id));
  const expectedSet = new Set(expectedIds);
  const counts = new Map();
  const invalidIndexes = [];
  for (let i = 0; i < scenes.length; i++) {
    const id = storyboardIdForScene(scenes[i]);
    if (!Number.isInteger(id) || id <= 0) {
      invalidIndexes.push(i + 1);
      continue;
    }
    counts.set(id, (counts.get(id) || 0) + 1);
  }

  const missing = expectedIds.filter((id) => !counts.has(id));
  const duplicates = Array.from(counts.entries()).filter(([, count]) => count > 1).map(([id]) => id);
  const unexpected = Array.from(counts.keys()).filter((id) => !expectedSet.has(id));
  if (invalidIndexes.length || missing.length || duplicates.length || unexpected.length || scenes.length !== expected.length) {
    const details = [];
    if (missing.length) details.push(`缺少分镜 ${missing.join(', ')}`);
    if (duplicates.length) details.push(`重复分镜 ${duplicates.join(', ')}`);
    if (unexpected.length) details.push(`非本集分镜 ${unexpected.join(', ')}`);
    if (invalidIndexes.length) details.push(`无效片段序号 ${invalidIndexes.join(', ')}`);
    if (scenes.length !== expected.length) details.push(`预期 ${expected.length} 段，收到 ${scenes.length} 段`);
    throw strictMergeError(`严格生产分镜覆盖不完整：${details.join('；')}`);
  }
  return scenes.map((scene) => {
    const storyboardId = storyboardIdForScene(scene);
    return { ...scene, storyboard_id: storyboardId, scene_id: storyboardId };
  });
}

function buildStrictSceneFilterPlan(scenes) {
  if (!Array.isArray(scenes)) return [];
  return scenes.map((scene, order) => {
    const duration = Number(scene?.duration);
    const normalizedDuration = Number.isFinite(duration) && duration > 0
      ? Number(duration.toFixed(6))
      : 0;
    return {
      order,
      timeline_item_id: scene?.timeline_item_id == null ? null : Number(scene.timeline_item_id),
      storyboard_id: storyboardIdForScene(scene),
      start_sec: Number(scene?.start_sec) || 0,
      end_sec: Number(scene?.end_sec) || normalizedDuration,
      duration: normalizedDuration,
      video_filter: `trim=duration=${normalizedDuration.toFixed(6)},setpts=PTS-STARTPTS`,
      audio_filter: `atrim=duration=${normalizedDuration.toFixed(6)},asetpts=PTS-STARTPTS,apad`,
    };
  });
}

function assertFilterPlanMatchesScenes(filterPlan, resolvedFilterPlan) {
  if (Array.isArray(filterPlan) &&
      JSON.stringify(filterPlan) !== JSON.stringify(resolvedFilterPlan)) {
    throw strictMergeError('生产时间线滤镜计划与合成分镜不匹配');
  }
}

function chooseProductionDimensions(probes, mergeOpts) {
  const requestedWidth = Number(mergeOpts.output_width);
  const requestedHeight = Number(mergeOpts.output_height);
  let width;
  let height;
  if (Number.isFinite(requestedWidth) && requestedWidth > 0 && Number.isFinite(requestedHeight) && requestedHeight > 0) {
    width = requestedWidth;
    height = requestedHeight;
  } else {
    const largest = probes.reduce((best, probe) => (
      !best || probe.width * probe.height > best.width * best.height ? probe : best
    ), null);
    width = largest.width;
    height = largest.height;
  }

  const maxDimension = 3840;
  const maxPixels = 3840 * 2160;
  const scale = Math.min(
    1,
    maxDimension / width,
    maxDimension / height,
    Math.sqrt(maxPixels / (width * height))
  );
  width = Math.max(16, Math.floor((width * scale) / 2) * 2);
  height = Math.max(16, Math.floor((height * scale) / 2) * 2);
  return { width, height };
}

function chooseProductionFps(mergeOpts) {
  const requested = Number(mergeOpts.output_fps);
  if (!Number.isFinite(requested) || requested <= 0) return 30;
  return Math.min(60, Math.max(1, Math.round(requested)));
}

function chooseProductionVideoEncoder(encoderNames, width, height, fps) {
  const available = new Set(encoderNames);
  const bitrate = `${Math.round(Math.max(1000, Math.min(12000, width * height * fps * 0.00008)))}k`;
  if (available.has('libx264')) {
    return {
      name: 'libx264',
      outputArgs: ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-profile:v', 'high'],
    };
  }
  if (available.has('libopenh264')) {
    return {
      name: 'libopenh264',
      outputArgs: ['-c:v', 'libopenh264', '-profile:v', 'high', '-b:v', bitrate],
    };
  }
  throw strictMergeError('当前 FFmpeg 缺少可用的软件 H.264 编码器（libx264/libopenh264）');
}

function relativeStoragePath(storageRoot, absolutePath) {
  const relative = path.relative(storageRoot, absolutePath);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw strictMergeError('合成输出不在本地存储目录内');
  }
  return relative.replace(/\\/g, '/');
}

function needsMergedEpisodePostProcess(mergeOpts) {
  return !!mergeOpts.burn_narration_subtitles
    || !!mergeOpts.burn_dialogue_audio
    || !!(mergeOpts.watermark_text && String(mergeOpts.watermark_text).trim());
}

function productionDurationTolerance(expectedOutputDuration) {
  return Math.max(0.25, expectedOutputDuration * 0.05);
}

function assertProductionOutputHasAudio(outputProbe, invalidPrefix, missingAudioMessage) {
  if (!outputProbe.ok || !outputProbe.hasAudio) {
    throw strictMergeError(`${invalidPrefix}：${describeInvalidProductionOutput(outputProbe, missingAudioMessage)}`);
  }
}

function assertProductionDurationComplete(outputProbe, expectedOutputDuration, incompletePrefix) {
  const durationTolerance = productionDurationTolerance(expectedOutputDuration);
  if (outputProbe.duration < expectedOutputDuration - durationTolerance) {
    throw strictMergeError(
      `${incompletePrefix}：预期约 ${expectedOutputDuration.toFixed(2)} 秒，实际 ${outputProbe.duration.toFixed(2)} 秒`
    );
  }
}

module.exports = {
  STRICT_PRODUCTION_MODE,
  MAX_STRICT_SCENES,
  pathWithinStorage,
  exactTrustedOrigin,
  parseMergeOptions,
  isStrictProductionMode,
  buildPersistedMergeOptions,
  storyboardIdForScene,
  assertStrictSceneCoverage,
  buildStrictSceneFilterPlan,
  assertFilterPlanMatchesScenes,
  chooseProductionDimensions,
  chooseProductionFps,
  chooseProductionVideoEncoder,
  relativeStoragePath,
  needsMergedEpisodePostProcess,
  productionDurationTolerance,
  assertProductionOutputHasAudio,
  assertProductionDurationComplete,
};
