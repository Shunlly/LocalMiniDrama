// 项目导入媒体校验：暂存图片、音视频容器与时长
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { getFfprobePath } = require('../utils/ffmpegPath');
const { IMPORT_IMAGE_VALIDATOR_FLAG } = require('./importImageValidator');
const { importError, structuredImportError } = require('./dramaImportValidation');

const FREE_CANVAS_MEDIA_FORMATS = Object.freeze({
  images: new Set(['jpeg', 'png', 'webp', 'gif']),
  videos: new Set(['mp4', 'mov', 'webm', 'mkv', 'avi']),
});

const IMPORT_MEDIA_EXTENSIONS = Object.freeze({
  characters: new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']),
  scenes: new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']),
  props: new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']),
  images: new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']),
  references: new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']),
  videos: new Set(['.mp4', '.mov', '.webm', '.mkv', '.avi']),
  audio: new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac']),
});

const IMPORT_IMAGE_CATEGORIES = Object.freeze(['characters', 'scenes', 'props', 'images', 'references']);
const IMPORT_AV_CATEGORIES = Object.freeze(['videos', 'audio']);
const IMAGE_VALIDATION_TIMEOUT_MS = 2 * 60 * 1000;
const FFPROBE_VALIDATION_TIMEOUT_MS = 30 * 1000;
const IMPORT_MEDIA_VALIDATION_TIMEOUT_MS = 2 * 60 * 1000;
const IMPORT_MEDIA_CONTAINERS = Object.freeze({
  '.mp4': new Set(['mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2']),
  '.mov': new Set(['mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2']),
  '.webm': new Set(['matroska', 'webm']),
  '.mkv': new Set(['matroska', 'webm']),
  '.avi': new Set(['avi']),
  '.mp3': new Set(['mp3']),
  '.wav': new Set(['wav']),
  '.m4a': new Set(['mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2']),
  '.aac': new Set(['aac']),
  '.ogg': new Set(['ogg']),
  '.flac': new Set(['flac']),
});
const IMPORT_MEDIA_MIME_TYPES = Object.freeze({
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
});

function invalidImportMedia(code, mediaPath, reason, details = null) {
  const limitExceeded = code === 'IMPORT_IMAGE_LIMIT_EXCEEDED';
  return structuredImportError(
    code,
    limitExceeded ? '压缩包不安全：图片解码资源超过限制' : '压缩包不安全：媒体内容无效',
    {
      archive_path: mediaPath || null,
      reason: String(reason || '媒体校验失败').slice(0, 300),
      ...(details && typeof details === 'object' ? details : {}),
    },
    limitExceeded ? 413 : 400
  );
}

function createImageValidatorProcessSpec({
  execPath = process.execPath,
  electronVersion = process.versions.electron,
  defaultApp = process.defaultApp === true,
  appEntry = process.argv[1],
  environment = process.env,
  projectPath,
  maxImagePixels,
  maxImageFrames,
}) {
  const childEnvironment = { ...environment };
  delete childEnvironment.ELECTRON_RUN_AS_NODE;
  const normalizedAppEntry = String(appEntry || '').trim();
  if (electronVersion && defaultApp && !normalizedAppEntry) {
    const error = new Error('Electron 图片校验缺少应用入口');
    error.code = 'MEDIA_VALIDATION_UNAVAILABLE';
    throw error;
  }
  const validatorArguments = [
    projectPath,
    String(maxImagePixels),
    String(maxImageFrames),
  ];
  return {
    executable: execPath,
    args: electronVersion
      ? [
          ...(defaultApp
            ? [normalizedAppEntry]
            : []),
          IMPORT_IMAGE_VALIDATOR_FLAG,
          ...validatorArguments,
        ]
      : [require.resolve('./importImageValidator'), ...validatorArguments],
    environment: childEnvironment,
  };
}

function validateStagedImages(projectPath, limits) {
  const hasImages = IMPORT_IMAGE_CATEGORIES.some((category) => {
    try {
      return fs.readdirSync(path.join(projectPath, category)).length > 0;
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  });
  if (!hasImages) return [];

  try {
    require.resolve('sharp');
  } catch (error) {
    throw invalidImportMedia('MEDIA_VALIDATION_UNAVAILABLE', null, 'Sharp 不可用，无法校验图片');
  }

  let processSpec;
  try {
    processSpec = createImageValidatorProcessSpec({
      projectPath,
      maxImagePixels: limits.maxImagePixels,
      maxImageFrames: limits.maxImageFrames,
    });
  } catch (error) {
    if (error?.code === 'MEDIA_VALIDATION_UNAVAILABLE') {
      throw invalidImportMedia(error.code, null, error.message);
    }
    throw error;
  }
  const result = spawnSync(processSpec.executable, processSpec.args, {
    encoding: 'utf8',
    env: processSpec.environment,
    maxBuffer: 2 * 1024 * 1024,
    timeout: IMAGE_VALIDATION_TIMEOUT_MS,
    windowsHide: true,
  });

  let payload = null;
  try {
    payload = JSON.parse(String(result.stdout || ''));
  } catch (_) {}

  if (result.error) {
    const timedOut = result.error.code === 'ETIMEDOUT';
    throw invalidImportMedia(
      timedOut ? 'MEDIA_VALIDATION_TIMEOUT' : 'MEDIA_VALIDATION_UNAVAILABLE',
      payload?.mediaPath,
      timedOut ? 'Sharp 图片校验超时' : 'Sharp 图片校验无法启动'
    );
  }
  if (result.status !== 0 || !payload?.ok) {
    const code = ['INVALID_MEDIA_CONTENT', 'IMPORT_IMAGE_LIMIT_EXCEEDED'].includes(payload?.code)
      ? payload.code
      : 'MEDIA_VALIDATION_UNAVAILABLE';
    throw invalidImportMedia(code, payload?.mediaPath, payload?.reason, payload?.details);
  }
  if (!Array.isArray(payload.media)) {
    throw invalidImportMedia('MEDIA_VALIDATION_UNAVAILABLE', null, 'Sharp 图片校验未返回元数据');
  }
  return payload.media;
}

function probeDurationSeconds(probe) {
  const candidates = [
    probe?.format?.duration,
    ...(Array.isArray(probe?.streams) ? probe.streams.map((stream) => stream.duration) : []),
  ]
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
  return candidates.length ? Math.max(...candidates) : NaN;
}

function validateContainerBrand(extension, probe, mediaPath) {
  const brand = String(probe?.format?.tags?.major_brand || '').trim().toLowerCase();
  if (extension === '.mov' && brand && brand !== 'qt') {
    throw invalidImportMedia('INVALID_MEDIA_CONTENT', mediaPath, 'QuickTime 容器品牌与 .mov 不符');
  }
  if (extension === '.mp4' && ['qt', 'm4a', 'm4b', 'm4p'].includes(brand)) {
    throw invalidImportMedia('INVALID_MEDIA_CONTENT', mediaPath, 'ISO 媒体容器品牌与 .mp4 不符');
  }
  if (extension === '.m4a' && brand === 'qt') {
    throw invalidImportMedia('INVALID_MEDIA_CONTENT', mediaPath, 'QuickTime 容器品牌与 .m4a 不符');
  }
}

function validateStagedAvFile(absolutePath, mediaPath, category, extension, limits, timeoutMs) {
  const result = spawnSync(
    getFfprobePath(),
    [
      '-v', 'error',
      '-count_packets',
      '-show_entries',
      'format=format_name,duration:format_tags=major_brand:stream=index,codec_type,codec_name,width,height,duration,channels,sample_rate,nb_read_packets:stream_disposition=attached_pic',
      '-of', 'json',
      absolutePath,
    ],
    {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      timeout: Math.max(1, Math.min(FFPROBE_VALIDATION_TIMEOUT_MS, timeoutMs)),
      windowsHide: true,
    }
  );

  if (result.error) {
    const timedOut = result.error.code === 'ETIMEDOUT';
    const unavailable = result.error.code === 'ENOENT';
    throw invalidImportMedia(
      unavailable ? 'MEDIA_VALIDATION_UNAVAILABLE' : timedOut ? 'MEDIA_VALIDATION_TIMEOUT' : 'INVALID_MEDIA_CONTENT',
      mediaPath,
      unavailable ? 'ffprobe 不可用，无法校验音视频' : timedOut ? 'ffprobe 校验超时' : 'ffprobe 无法检查媒体文件'
    );
  }
  if (result.status !== 0 || String(result.stderr || '').trim()) {
    throw invalidImportMedia('INVALID_MEDIA_CONTENT', mediaPath, 'ffprobe 拒绝了损坏的媒体文件');
  }

  let probe;
  try {
    probe = JSON.parse(result.stdout || '{}');
  } catch (_) {
    throw invalidImportMedia('INVALID_MEDIA_CONTENT', mediaPath, 'ffprobe 返回的元数据无效');
  }

  const formatNames = String(probe?.format?.format_name || '')
    .toLowerCase()
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const allowedContainers = IMPORT_MEDIA_CONTAINERS[extension];
  if (!allowedContainers || !formatNames.some((name) => allowedContainers.has(name))) {
    throw invalidImportMedia('INVALID_MEDIA_CONTENT', mediaPath, '容器格式与文件扩展名不符');
  }
  validateContainerBrand(extension, probe, mediaPath);

  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  if (streams.length < 1 || streams.length > limits.maxMediaStreams) {
    throw invalidImportMedia('INVALID_MEDIA_CONTENT', mediaPath, '媒体流数量超出允许范围', {
      actual: streams.length,
      limit: limits.maxMediaStreams,
      kind: 'streams',
    });
  }
  if (streams.some((stream) => !['video', 'audio'].includes(stream.codec_type))) {
    throw invalidImportMedia('INVALID_MEDIA_CONTENT', mediaPath, '媒体包含不允许的流类型');
  }
  if (streams.some((stream) => {
    const packetCount = Number(stream.nb_read_packets);
    return !String(stream.codec_name || '').trim() || !Number.isSafeInteger(packetCount) || packetCount < 1;
  })) {
    throw invalidImportMedia('INVALID_MEDIA_CONTENT', mediaPath, '媒体流没有可解码的数据包');
  }

  const videoStreams = streams.filter((stream) => stream.codec_type === 'video');
  const audioStreams = streams.filter((stream) => stream.codec_type === 'audio');
  if (category === 'videos') {
    if (
      videoStreams.length !== 1 ||
      Number(videoStreams[0]?.disposition?.attached_pic || 0) !== 0 ||
      !Number.isSafeInteger(Number(videoStreams[0]?.width)) || Number(videoStreams[0]?.width) < 1 ||
      !Number.isSafeInteger(Number(videoStreams[0]?.height)) || Number(videoStreams[0]?.height) < 1
    ) {
      throw invalidImportMedia('INVALID_MEDIA_CONTENT', mediaPath, '视频必须恰好包含一条画面流');
    }
  } else if (videoStreams.length !== 0 || audioStreams.length !== 1 || streams.length !== 1) {
    throw invalidImportMedia('INVALID_MEDIA_CONTENT', mediaPath, '音频必须恰好包含一条音频流');
  }

  if (audioStreams.some((stream) => {
    const channels = Number(stream.channels);
    const sampleRate = Number(stream.sample_rate);
    return (
      !Number.isSafeInteger(channels) || channels < 1 ||
      !Number.isSafeInteger(sampleRate) || sampleRate < 1
    );
  })) {
    throw invalidImportMedia('INVALID_MEDIA_CONTENT', mediaPath, '音频流元数据无效');
  }
  if (extension === '.webm') {
    const webmVideoCodecs = new Set(['vp8', 'vp9', 'av1']);
    const webmAudioCodecs = new Set(['vorbis', 'opus']);
    if (
      videoStreams.some((stream) => !webmVideoCodecs.has(stream.codec_name)) ||
      audioStreams.some((stream) => !webmAudioCodecs.has(stream.codec_name))
    ) {
      throw invalidImportMedia('INVALID_MEDIA_CONTENT', mediaPath, 'WebM 包含不在 WebM 规范内的编码');
    }
  }

  const duration = probeDurationSeconds(probe);
  if (!Number.isFinite(duration) || duration <= 0 || duration > limits.maxMediaDurationSeconds) {
    throw invalidImportMedia('INVALID_MEDIA_CONTENT', mediaPath, '媒体时长超出允许范围', {
      actual: Number.isFinite(duration) ? duration : null,
      limit: limits.maxMediaDurationSeconds,
      kind: 'duration_seconds',
    });
  }
  return {
    format: extension === '.jpg' || extension === '.jpeg' ? 'jpeg' : extension.slice(1),
    mimeType: IMPORT_MEDIA_MIME_TYPES[extension] || null,
    width: category === 'videos' ? Number(videoStreams[0].width) : null,
    height: category === 'videos' ? Number(videoStreams[0].height) : null,
    duration,
  };
}

function validateStagedImportMedia(stagingRoot, projectDir, limits) {
  const deadline = Date.now() + IMPORT_MEDIA_VALIDATION_TIMEOUT_MS;
  const resolvedStagingRoot = path.resolve(stagingRoot);
  const projectPath = path.resolve(stagingRoot, ...String(projectDir || '').split('/'));
  const relation = path.relative(resolvedStagingRoot, projectPath);
  if (!relation || relation === '..' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    throw importError('UNSAFE_IMPORT_TARGET', '压缩包不安全：媒体校验目录会逃出临时导入目录');
  }

  const trustedMetadata = new Map();
  for (const image of validateStagedImages(projectPath, limits)) {
    if (
      !image || typeof image !== 'object' || typeof image.mediaPath !== 'string'
      || !FREE_CANVAS_MEDIA_FORMATS.images.has(image.format)
      || !Number.isSafeInteger(image.width) || image.width <= 0
      || !Number.isSafeInteger(image.height) || image.height <= 0
      || typeof image.mimeType !== 'string'
    ) {
      throw invalidImportMedia('MEDIA_VALIDATION_UNAVAILABLE', image?.mediaPath, 'Sharp 返回的图片元数据无效');
    }
    const imageAbsolutePath = path.resolve(projectPath, ...image.mediaPath.split('/'));
    const imageRelation = path.relative(projectPath, imageAbsolutePath);
    if (!imageRelation || imageRelation.startsWith(`..${path.sep}`) || path.isAbsolute(imageRelation)) {
      throw invalidImportMedia('MEDIA_VALIDATION_UNAVAILABLE', image.mediaPath, 'Sharp 返回了不安全的图片路径');
    }
    trustedMetadata.set(
      `${String(projectDir).replace(/\\/g, '/')}/${image.mediaPath}`,
      {
        format: image.format,
        mimeType: image.mimeType,
        fileSize: fs.statSync(imageAbsolutePath).size,
        width: image.width,
        height: image.height,
        duration: null,
      }
    );
  }
  for (const category of IMPORT_AV_CATEGORIES) {
    const directory = path.join(projectPath, category);
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    for (const entry of entries) {
      const mediaPath = `${category}/${entry.name}`;
      if (!entry.isFile()) {
        throw invalidImportMedia('INVALID_MEDIA_CONTENT', mediaPath, '媒体暂存条目不是普通文件');
      }
      const extension = path.extname(entry.name).toLowerCase();
      if (!IMPORT_MEDIA_EXTENSIONS[category]?.has(extension)) {
        throw invalidImportMedia('INVALID_MEDIA_CONTENT', mediaPath, '媒体扩展名不受支持');
      }
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw invalidImportMedia('MEDIA_VALIDATION_TIMEOUT', mediaPath, '导入媒体校验超时');
      }
      const metadata = validateStagedAvFile(
        path.join(directory, entry.name),
        mediaPath,
        category,
        extension,
        limits,
        remainingMs
      );
      trustedMetadata.set(
        `${String(projectDir).replace(/\\/g, '/')}/${mediaPath}`,
        { ...metadata, fileSize: fs.statSync(path.join(directory, entry.name)).size }
      );
    }
  }
  return trustedMetadata;
}

module.exports = {
  FREE_CANVAS_MEDIA_FORMATS,
  IMPORT_MEDIA_EXTENSIONS,
  IMPORT_IMAGE_CATEGORIES,
  IMPORT_AV_CATEGORIES,
  IMAGE_VALIDATION_TIMEOUT_MS,
  FFPROBE_VALIDATION_TIMEOUT_MS,
  IMPORT_MEDIA_VALIDATION_TIMEOUT_MS,
  IMPORT_MEDIA_CONTAINERS,
  IMPORT_MEDIA_MIME_TYPES,
  invalidImportMedia,
  createImageValidatorProcessSpec,
  validateStagedImages,
  probeDurationSeconds,
  validateContainerBrand,
  validateStagedAvFile,
  validateStagedImportMedia,
};
