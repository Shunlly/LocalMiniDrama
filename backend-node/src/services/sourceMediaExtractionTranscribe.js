// 从 sourceMediaExtractionService 拆出的音视频转写：音频提交与视频音轨抽取。

const fsp = require('node:fs/promises');
const path = require('node:path');
const { getFfmpegPath, getFfprobePath } = require('../utils/ffmpegPath');
const { actionableError } = require('./sourceMediaExtractionErrors');
const { sanitizeFilename } = require('./sourceMediaExtractionDetect');
const {
  MAX_PROVIDER_RESPONSE_BYTES,
  MAX_TRANSCODED_AUDIO_BYTES,
  assertAudioWithinTranscriptionLimit,
  authorizationHeaders,
  buildConfiguredUrl,
  clampInteger,
  configuredModel,
  parseProbeOutput,
  transcriptionResponse,
} = require('./sourceMediaExtractionValidation');
const {
  cleanupTempDir,
  createTempDir,
  requestBounded,
  runBoundedProcess,
  selectActiveConfig,
} = require('./sourceMediaExtractionRuntime');

const MAX_MEDIA_DURATION_SECONDS = 30 * 60;

async function transcribeAudio(db, audio, options = {}) {
  const config = selectActiveConfig(db, 'transcription');
  if (!config) {
    throw actionableError('未配置语音转写服务。请在「AI 配置」中添加并启用兼容的「语音转写」服务。');
  }
  assertAudioWithinTranscriptionLimit(audio.buffer);
  const settings = config.settings_object || {};
  const form = new FormData();
  form.append('file', new Blob([audio.buffer], { type: audio.mime }), sanitizeFilename(audio.filename));
  form.append('model', configuredModel(config));
  const language = String(settings.language || '').trim();
  if (language && /^[A-Za-z0-9_-]{1,40}$/.test(language)) form.append('language', language);
  const prompt = String(settings.prompt || '').trim();
  if (prompt) form.append('prompt', prompt.slice(0, 4000));
  const responseFormat = String(settings.response_format || 'json').toLowerCase();
  if (['json', 'text', 'verbose_json'].includes(responseFormat)) form.append('response_format', responseFormat);

  const result = await requestBounded(
    buildConfiguredUrl(config, '/audio/transcriptions'),
    {
      method: 'POST',
      headers: { Accept: 'application/json, text/plain', ...authorizationHeaders(config) },
      body: form,
    },
    {
      timeoutMs: clampInteger(settings.timeout_ms ?? settings.timeout, 120000, 1000, 120000),
      maxResponseBytes: clampInteger(settings.max_response_bytes, MAX_PROVIDER_RESPONSE_BYTES, 1024, MAX_PROVIDER_RESPONSE_BYTES),
      label: '语音转写',
      fetchImpl: options.fetchImpl,
      trustedOrigins: [config.base_url],
      networkLookup: options.networkLookup,
    }
  );
  return {
    text: transcriptionResponse(result.body, result.contentType),
    config_id: Number(config.id),
  };
}

async function extractVideoAndTranscribe(db, descriptor, fileBuffer, options) {
  const temp = await createTempDir(options, 'localminidrama-video-source-');
  try {
    const inputExtension = descriptor.extension || `.${descriptor.format === 'ogg_video' ? 'ogv' : descriptor.format}`;
    const inputPath = path.join(temp.dir, `input${inputExtension}`);
    const outputPath = path.join(temp.dir, 'audio.m4a');
    await fsp.writeFile(inputPath, fileBuffer, { flag: 'wx' });
    const runProcess = options.runProcess || runBoundedProcess;
    const protocolArgs = ['-protocol_whitelist', 'file,crypto,data'];
    const probe = await runProcess(
      options.ffprobePath || getFfprobePath(),
      ['-v', 'error', ...protocolArgs, '-show_entries', 'format=duration:stream=codec_type,duration', '-of', 'json', inputPath],
      { timeoutMs: 15000, maxStdoutBytes: 256 * 1024, maxStderrBytes: 64 * 1024, label: 'FFprobe', cwd: temp.dir }
    );
    const media = parseProbeOutput(probe.stdout);
    const durationLimit = clampInteger(options.maxMediaDurationSeconds, MAX_MEDIA_DURATION_SECONDS, 1, MAX_MEDIA_DURATION_SECONDS);
    if (media.duration > durationLimit) {
      throw actionableError(`上传的视频时长为 ${Math.ceil(media.duration)} 秒，转写上限为 ${durationLimit} 秒。请截短视频后重试。`);
    }
    await runProcess(
      options.ffmpegPath || getFfmpegPath(),
      [
        '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
        ...protocolArgs,
        '-i', inputPath,
        '-map', '0:a:0', '-vn', '-sn', '-dn',
        '-map_metadata', '-1', '-ac', '1', '-ar', '16000',
        '-c:a', 'aac', '-b:a', '64k', '-t', String(durationLimit),
        outputPath,
      ],
      {
        timeoutMs: clampInteger(options.ffmpegTimeoutMs, 120000, 5000, 300000),
        maxStdoutBytes: 64 * 1024,
        maxStderrBytes: 128 * 1024,
        label: 'FFmpeg 音频抽取',
        cwd: temp.dir,
      }
    );
    const stat = await fsp.stat(outputPath).catch(() => null);
    if (!stat?.isFile() || stat.size <= 0) throw actionableError('FFmpeg 未能生成可用音轨。请确认视频包含音频后重试。');
    if (stat.size > MAX_TRANSCODED_AUDIO_BYTES) throw actionableError('抽取的视频音频超过 20MB 转写上限。请截短或压缩视频后重试。');
    const audioBuffer = await fsp.readFile(outputPath);
    const transcription = await transcribeAudio(db, {
      buffer: audioBuffer,
      mime: 'audio/mp4',
      filename: 'audio.m4a',
    }, options);
    return {
      text: transcription.text,
      metadata: {
        extraction_method: 'ffmpeg_openai_compatible_transcription',
        extraction_service_type: 'transcription',
        extraction_config_id: transcription.config_id,
        media_kind: descriptor.kind,
        detected_format: descriptor.format,
        extracted_text_length: transcription.text.length,
        video_duration_seconds: Math.round(media.duration * 1000) / 1000,
        video_audio_extracted: true,
      },
    };
  } finally {
    await cleanupTempDir(temp);
  }
}

module.exports = {
  extractVideoAndTranscribe,
  transcribeAudio,
};
