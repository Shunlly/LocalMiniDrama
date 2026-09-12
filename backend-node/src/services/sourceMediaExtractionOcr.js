// 从 sourceMediaExtractionService 拆出的图片 OCR：视觉识别、Tesseract 回退与图片规范化。

const fsp = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const {
  actionableError,
  isExtractionAuthFailure,
  isExtractionCancelled,
  providerCancelledError,
  throwOcrFallbackError,
} = require('./sourceMediaExtractionErrors');
const {
  MAX_EXTRACTED_TEXT_BYTES,
  MAX_PROVIDER_RESPONSE_BYTES,
  authorizationHeaders,
  buildConfiguredUrl,
  clampInteger,
  configuredModel,
  ensureTextResult,
  extractVisionResponse,
  tesseractLanguage,
} = require('./sourceMediaExtractionValidation');
const {
  cleanupTempDir,
  createTempDir,
  requestBounded,
  runBoundedProcess,
  selectActiveConfig,
} = require('./sourceMediaExtractionRuntime');

const MAX_IMAGE_INPUT_PIXELS = 40 * 1024 * 1024;
const MAX_NORMALIZED_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PDF_RENDER_DIMENSION = 2200;

async function callVisionOcr(config, image, options = {}) {
  const settings = config.settings_object || {};
  const timeoutMs = clampInteger(settings.timeout_ms ?? settings.timeout, 60000, 1000, 120000);
  const maxResponseBytes = clampInteger(settings.max_response_bytes, 512 * 1024, 1024, MAX_PROVIDER_RESPONSE_BYTES);
  const prompt = String(settings.ocr_prompt || settings.prompt || [
    'Extract all readable text from this source image.',
    'Preserve reading order, headings, dialogue labels, and line breaks.',
    'Return only the extracted text. Do not summarize or explain.',
  ].join(' ')).slice(0, 4000);
  const payload = {
    model: configuredModel(config),
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.buffer.toString('base64')}`, detail: 'high' } },
      ],
    }],
    temperature: 0,
  };
  const result = await requestBounded(
    buildConfiguredUrl(config, '/chat/completions'),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...authorizationHeaders(config),
      },
      body: JSON.stringify(payload),
    },
    {
      timeoutMs,
      maxResponseBytes,
      label: '图片识别',
      fetchImpl: options.fetchImpl,
      trustedOrigins: [config.base_url],
      networkLookup: options.networkLookup,
      signal: options.signal,
    }
  );
  return extractVisionResponse(result.body);
}

async function tryTesseract(image, options, settings) {
  const temp = await createTempDir(options, 'localminidrama-ocr-');
  try {
    const inputPath = path.join(temp.dir, 'page.png');
    await fsp.writeFile(inputPath, image.buffer, { flag: 'wx' });
    const runProcess = options.runProcess || runBoundedProcess;
    const result = await runProcess(
      options.tesseractPath || process.env.TESSERACT_PATH || 'tesseract',
      [inputPath, 'stdout', '-l', tesseractLanguage(settings)],
      {
        timeoutMs: clampInteger(settings.tesseract_timeout_ms, 60000, 1000, 120000),
        maxStdoutBytes: MAX_EXTRACTED_TEXT_BYTES,
        maxStderrBytes: 128 * 1024,
        label: '本机 Tesseract 识别',
        cwd: temp.dir,
        signal: options.signal,
      }
    );
    return { ok: true, text: ensureTextResult(Buffer.from(result.stdout || '').toString('utf8'), '本机 Tesseract 未返回可读文本。请更换更清晰的图片，或在「AI 配置」中添加图片识别服务。') };
  } catch (err) {
    return { ok: false, unavailable: err?.process_code === 'PROCESS_UNAVAILABLE', error: err };
  } finally {
    await cleanupTempDir(temp);
  }
}

async function ocrImageWithFallback(db, image, options = {}, existingConfig) {
  if (options.signal?.aborted) throw providerCancelledError('图片识别', options.signal.reason);
  const config = existingConfig === undefined ? selectActiveConfig(db, 'ocr') : existingConfig;
  let providerError = null;
  if (config) {
    try {
      return {
        text: await callVisionOcr(config, image, options),
        method: 'openai_compatible_ocr',
        config_id: Number(config.id),
      };
    } catch (err) {
      if (isExtractionCancelled(err) || options.signal?.aborted) {
        throw isExtractionCancelled(err) ? err : providerCancelledError('图片识别', err);
      }
      if (isExtractionAuthFailure(err)) throw err;
      providerError = err;
    }
  }

  if (options.signal?.aborted) throw providerCancelledError('图片识别', options.signal.reason);
  const tesseract = await tryTesseract(image, options, config?.settings_object || {});
  if (tesseract.ok) return { text: tesseract.text, method: 'tesseract_cli' };
  throwOcrFallbackError(config, tesseract, providerError);
}

async function normalizeImage(buffer) {
  let pipeline;
  try {
    pipeline = sharp(buffer, {
      animated: false,
      failOn: 'error',
      limitInputPixels: MAX_IMAGE_INPUT_PIXELS,
    }).rotate().flatten({ background: '#ffffff' }).resize({
      width: MAX_PDF_RENDER_DIMENSION,
      height: MAX_PDF_RENDER_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    });
    const png = await pipeline.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true });
    if (png.data.length <= MAX_NORMALIZED_IMAGE_BYTES) {
      return { buffer: png.data, mime: 'image/png', width: png.info.width, height: png.info.height };
    }
    const jpeg = await sharp(buffer, {
      animated: false,
      failOn: 'error',
      limitInputPixels: MAX_IMAGE_INPUT_PIXELS,
    }).rotate().flatten({ background: '#ffffff' }).resize({
      width: MAX_PDF_RENDER_DIMENSION,
      height: MAX_PDF_RENDER_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    }).jpeg({ quality: 88, chromaSubsampling: '4:4:4' }).toBuffer({ resolveWithObject: true });
    if (jpeg.data.length > MAX_NORMALIZED_IMAGE_BYTES) throw actionableError('规范化后的 OCR 图片超过 10MB 上限。请缩小图片后重试。');
    return { buffer: jpeg.data, mime: 'image/jpeg', width: jpeg.info.width, height: jpeg.info.height };
  } catch (err) {
    if (err?.code === 'BAD_REQUEST') throw err;
    throw actionableError('上传的图片无效，或超过 4000 万像素解码上限。请更换较小的图片后重试。', err);
  }
}

module.exports = {
  MAX_NORMALIZED_IMAGE_BYTES,
  MAX_PDF_RENDER_DIMENSION,
  callVisionOcr,
  normalizeImage,
  ocrImageWithFallback,
  tryTesseract,
};
