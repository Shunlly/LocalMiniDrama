const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { TextDecoder } = require('node:util');
const { createCanvas } = require('@napi-rs/canvas');
const sharp = require('sharp');
const aiConfigService = require('./aiConfigService');
const { secureHttpFetch } = require('./secureHttpFetch');
const { getFfmpegPath, getFfprobePath } = require('../utils/ffmpegPath');

const MAX_SOURCE_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_EXTRACTED_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_PROVIDER_RESPONSE_BYTES = 1024 * 1024;
const MAX_IMAGE_INPUT_PIXELS = 40 * 1024 * 1024;
const MAX_NORMALIZED_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PDF_PAGES = 100;
const MAX_PDF_OCR_PAGES = 30;
const MAX_PDF_RENDER_PIXELS = 8 * 1024 * 1024;
const MAX_PDF_RENDER_DIMENSION = 2200;
const MAX_MEDIA_DURATION_SECONDS = 30 * 60;
const MAX_TRANSCODED_AUDIO_BYTES = 20 * 1024 * 1024;

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.tsv', '.srt', '.vtt', '.ass', '.json']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.oga']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.avi', '.webm', '.ogv']);

const MIME_TYPES = {
  pdf: new Set(['application/pdf']),
  png: new Set(['image/png']),
  jpeg: new Set(['image/jpeg', 'image/jpg', 'image/pjpeg']),
  webp: new Set(['image/webp']),
  gif: new Set(['image/gif']),
  mp3: new Set(['audio/mpeg', 'audio/mp3']),
  wav: new Set(['audio/wav', 'audio/wave', 'audio/x-wav']),
  m4a: new Set(['audio/mp4', 'audio/m4a', 'audio/x-m4a']),
  aac: new Set(['audio/aac', 'audio/x-aac']),
  flac: new Set(['audio/flac', 'audio/x-flac']),
  ogg_audio: new Set(['audio/ogg']),
  mp4: new Set(['video/mp4']),
  mov: new Set(['video/quicktime']),
  mkv: new Set(['video/x-matroska', 'video/matroska']),
  avi: new Set(['video/x-msvideo', 'video/avi']),
  webm: new Set(['video/webm']),
  ogg_video: new Set(['video/ogg']),
};

let pdfJsPromise;

function actionableError(message, cause) {
  const err = new Error(message, cause ? { cause } : undefined);
  err.code = 'BAD_REQUEST';
  return err;
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function parseSettings(value) {
  if (!value) return {};
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function sanitizeFilename(value) {
  const leaf = String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .replace(/[\x00-\x1f\x7f]/g, '_')
    .trim();
  return (leaf || 'source').slice(0, 255);
}

function normalizeMime(value) {
  return String(value || '').split(';', 1)[0].trim().toLowerCase();
}

function startsWithBytes(buffer, bytes) {
  if (buffer.length < bytes.length) return false;
  return bytes.every((value, index) => buffer[index] === value);
}

function asciiAt(buffer, start, length) {
  if (buffer.length < start + length) return '';
  return buffer.subarray(start, start + length).toString('ascii');
}

function detectMagic(buffer) {
  if (asciiAt(buffer, 0, 5) === '%PDF-') return 'pdf';
  if (startsWithBytes(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWithBytes(buffer, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (asciiAt(buffer, 0, 4) === 'RIFF' && asciiAt(buffer, 8, 4) === 'WEBP') return 'webp';
  if (asciiAt(buffer, 0, 6) === 'GIF87a' || asciiAt(buffer, 0, 6) === 'GIF89a') return 'gif';
  if (asciiAt(buffer, 0, 4) === 'RIFF' && asciiAt(buffer, 8, 4) === 'WAVE') return 'wav';
  if (asciiAt(buffer, 0, 4) === 'RIFF' && asciiAt(buffer, 8, 4) === 'AVI ') return 'avi';
  if (asciiAt(buffer, 0, 4) === 'fLaC') return 'flac';
  if (asciiAt(buffer, 0, 4) === 'OggS') return 'ogg';
  if (startsWithBytes(buffer, [0x1a, 0x45, 0xdf, 0xa3])) return 'ebml';
  if (asciiAt(buffer, 4, 4) === 'ftyp') return 'iso_bmff';
  if (asciiAt(buffer, 0, 3) === 'ID3') return 'mp3';
  if (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return 'mpeg_audio';
  return '';
}

function descriptorForContainer(magic, ext, mime) {
  if (magic === 'iso_bmff') {
    if (ext === '.m4a' || mime.startsWith('audio/')) return { kind: 'audio', format: 'm4a', mime: 'audio/mp4' };
    return { kind: 'video', format: ext === '.mov' || mime === 'video/quicktime' ? 'mov' : 'mp4', mime: ext === '.mov' ? 'video/quicktime' : 'video/mp4' };
  }
  if (magic === 'ebml') {
    if (mime.startsWith('audio/')) return { kind: 'audio', format: 'webm', mime: 'audio/webm' };
    return { kind: 'video', format: ext === '.webm' || mime === 'video/webm' ? 'webm' : 'mkv', mime: ext === '.webm' ? 'video/webm' : 'video/x-matroska' };
  }
  if (magic === 'ogg') {
    if (ext === '.ogv' || mime.startsWith('video/')) return { kind: 'video', format: 'ogg_video', mime: 'video/ogg' };
    return { kind: 'audio', format: 'ogg_audio', mime: 'audio/ogg' };
  }
  if (magic === 'mpeg_audio') {
    if (ext === '.aac' || /aac/.test(mime)) return { kind: 'audio', format: 'aac', mime: 'audio/aac' };
    return { kind: 'audio', format: 'mp3', mime: 'audio/mpeg' };
  }
  return null;
}

function descriptorForMagic(magic, ext, mime) {
  const container = descriptorForContainer(magic, ext, mime);
  if (container) return container;
  const descriptors = {
    pdf: { kind: 'pdf', format: 'pdf', mime: 'application/pdf' },
    png: { kind: 'image', format: 'png', mime: 'image/png' },
    jpeg: { kind: 'image', format: 'jpeg', mime: 'image/jpeg' },
    webp: { kind: 'image', format: 'webp', mime: 'image/webp' },
    gif: { kind: 'image', format: 'gif', mime: 'image/gif' },
    mp3: { kind: 'audio', format: 'mp3', mime: 'audio/mpeg' },
    wav: { kind: 'audio', format: 'wav', mime: 'audio/wav' },
    flac: { kind: 'audio', format: 'flac', mime: 'audio/flac' },
    avi: { kind: 'video', format: 'avi', mime: 'video/x-msvideo' },
  };
  return descriptors[magic] || null;
}

function extensionMatches(descriptor, ext) {
  if (!ext) return true;
  if (descriptor.kind === 'pdf') return ext === '.pdf';
  if (descriptor.kind === 'image') return IMAGE_EXTENSIONS.has(ext) && !(descriptor.format === 'jpeg' && !['.jpg', '.jpeg'].includes(ext)) && (descriptor.format === 'jpeg' || ext === `.${descriptor.format}`);
  if (descriptor.kind === 'audio') {
    if (descriptor.format === 'ogg_audio') return ['.ogg', '.oga'].includes(ext);
    if (descriptor.format === 'webm') return ext === '.webm';
    return AUDIO_EXTENSIONS.has(ext) && ext === `.${descriptor.format}`;
  }
  if (descriptor.kind === 'video') {
    if (descriptor.format === 'ogg_video') return ext === '.ogv';
    return VIDEO_EXTENSIONS.has(ext) && ext === `.${descriptor.format}`;
  }
  return false;
}

function mimeMatches(descriptor, declaredMime) {
  if (!declaredMime || declaredMime === 'application/octet-stream') return true;
  if (descriptor.format === 'webm' && descriptor.kind === 'audio') return declaredMime === 'audio/webm';
  const allowed = MIME_TYPES[descriptor.format];
  return Boolean(allowed && allowed.has(declaredMime));
}

function isTextMime(mime) {
  return !mime || mime === 'application/octet-stream' || mime.startsWith('text/') || [
    'application/json',
    'application/x-subrip',
    'application/vnd.ms-excel',
  ].includes(mime);
}

function inspectUploadedFile(file) {
  if (!file || !Buffer.isBuffer(file.buffer)) throw actionableError('A source file is required.');
  const actualSize = file.buffer.length;
  const reportedSize = Number(file.size || 0);
  if (!actualSize) throw actionableError('The uploaded source file is empty.');
  if (actualSize > MAX_SOURCE_UPLOAD_BYTES || reportedSize > MAX_SOURCE_UPLOAD_BYTES) {
    throw actionableError('Source Intake uploads are limited to 20MB. Split or compress the source and try again.');
  }

  const filename = sanitizeFilename(file.originalname);
  const ext = path.extname(filename).toLowerCase();
  const declaredMime = normalizeMime(file.mimetype);
  const magic = detectMagic(file.buffer);
  const descriptor = descriptorForMagic(magic, ext, declaredMime);

  if (descriptor) {
    if (!extensionMatches(descriptor, ext)) {
      throw actionableError('The source filename extension does not match the file signature.');
    }
    if (!mimeMatches(descriptor, declaredMime)) {
      throw actionableError('The source MIME type does not match the file signature.');
    }
    return { ...descriptor, filename, extension: ext, size: actualSize, declared_mime: declaredMime };
  }

  if ((TEXT_EXTENSIONS.has(ext) || (!ext && isTextMime(declaredMime))) && isTextMime(declaredMime)) {
    return { kind: 'text', format: ext ? ext.slice(1) : 'txt', mime: declaredMime || 'text/plain', filename, extension: ext, size: actualSize, declared_mime: declaredMime };
  }

  throw actionableError('Unsupported or invalid source file. Use text, PDF, PNG/JPEG/WebP/GIF, or a supported audio/video container.');
}

function decodeUtf8Text(buffer) {
  if (buffer.includes(0)) throw actionableError('The uploaded text file contains binary data.');
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch (err) {
    throw actionableError('The uploaded text file must be valid UTF-8.', err);
  }
  return ensureTextResult(text.replace(/^\uFEFF/, ''), 'The uploaded text file is empty.');
}

function ensureTextResult(value, emptyMessage = 'No readable text was extracted from the source.') {
  const text = String(value || '').replace(/\r\n/g, '\n').trim();
  if (!text) throw actionableError(emptyMessage);
  if (Buffer.byteLength(text, 'utf8') > MAX_EXTRACTED_TEXT_BYTES) {
    throw actionableError('Extracted source text exceeds the 2MB limit. Split the source and try again.');
  }
  return text;
}

function selectActiveConfig(db, serviceType) {
  const row = db.prepare(
    `SELECT * FROM ai_service_configs
     WHERE deleted_at IS NULL
       AND service_type = ?
       AND COALESCE(is_active, 1) = 1
     ORDER BY is_default DESC, priority DESC, created_at DESC, id ASC
     LIMIT 1`
  ).get(serviceType);
  if (!row) return null;
  return { ...row, settings_object: parseSettings(row.settings) };
}

function configuredModel(config) {
  let models = config?.model;
  if (typeof models === 'string') {
    try {
      models = JSON.parse(models);
    } catch (_) {
      models = [models];
    }
  }
  const model = aiConfigService.resolveConfiguredModel({ ...config, model: models });
  if (!model) throw actionableError(`The active service_type=${config?.service_type || 'unknown'} configuration has no model.`);
  if (/\r|\n|\0/.test(model)) throw actionableError('The configured model name is invalid.');
  return model.slice(0, 300);
}

function validateEndpointPath(endpoint) {
  const value = String(endpoint || '').trim();
  if (!value || value.length > 1000 || /[\\\0\r\n]/.test(value) || value.includes('?') || value.includes('#')) {
    throw actionableError('The configured service endpoint path is invalid.');
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('//')) {
    throw actionableError('Service endpoints must be relative to the configured base URL.');
  }
  const normalized = value.startsWith('/') ? value : `/${value}`;
  let decoded;
  try {
    decoded = decodeURIComponent(normalized);
  } catch (err) {
    throw actionableError('The configured service endpoint path is invalid.', err);
  }
  if (decoded.split('/').some((segment) => segment === '..' || segment === '.')) {
    throw actionableError('The configured service endpoint path cannot traverse directories.');
  }
  return normalized;
}

function buildConfiguredUrl(config, defaultEndpoint) {
  const rawBase = String(config?.base_url || '').trim();
  if (!rawBase || rawBase.length > 2048) {
    throw actionableError(`The active service_type=${config?.service_type || 'unknown'} configuration has no valid base_url.`);
  }
  let url;
  try {
    url = new URL(rawBase);
  } catch (err) {
    throw actionableError('The configured service base URL is invalid.', err);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw actionableError('The configured service base URL must be an HTTP(S) URL without credentials, query, or fragment.');
  }

  const endpoint = validateEndpointPath(config.endpoint || defaultEndpoint);
  const basePath = url.pathname.replace(/\/+$/, '');
  if (!basePath.endsWith(endpoint)) {
    url.pathname = endpoint.startsWith(`${basePath}/`) ? endpoint : `${basePath}${endpoint}`;
  }
  if (url.origin !== new URL(rawBase).origin) {
    throw actionableError('The configured service endpoint must remain on the configured origin.');
  }
  return url.toString();
}

function authorizationHeaders(config) {
  const key = String(config?.api_key || '');
  if (/\r|\n|\0/.test(key)) throw actionableError('The configured API key is invalid.');
  return key ? { Authorization: `Bearer ${key}` } : {};
}

async function readBoundedResponse(response, maxBytes) {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > maxBytes) throw actionableError('The extraction service response is too large.');
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw actionableError('The extraction service response is too large.');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

async function requestBounded(url, init, options) {
  const timeoutMs = clampInteger(options.timeoutMs, 60000, 1000, 120000);
  const maxResponseBytes = clampInteger(options.maxResponseBytes, MAX_PROVIDER_RESPONSE_BYTES, 1024, MAX_PROVIDER_RESPONSE_BYTES);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    let response;
    try {
      if (typeof options.fetchImpl === 'function') {
        response = await options.fetchImpl(url, {
          ...init,
          redirect: 'error',
          signal: controller.signal,
        });
      } else {
        response = await secureHttpFetch(url, {
          ...init,
          redirect: 'error',
          signal: controller.signal,
        }, {
          trustedOrigins: options.trustedOrigins,
          allowPrivateOrigins: options.allowPrivateOrigins,
          lookup: options.networkLookup,
          timeoutMs,
          maxBytes: maxResponseBytes,
          maxRedirects: 0,
        });
      }
    } catch (err) {
      if (controller.signal.aborted || err?.name === 'AbortError' || err?.name === 'TimeoutError') {
        throw actionableError(`${options.label} timed out after ${timeoutMs}ms.`, err);
      }
      throw actionableError(`${options.label} could not be reached. Check the active AI configuration.`, err);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw actionableError(`${options.label} returned HTTP ${response.status}. Check the active AI configuration.`);
    }
    return {
      body: await readBoundedResponse(response, maxResponseBytes),
      contentType: normalizeMime(response.headers.get('content-type')),
    };
  } finally {
    clearTimeout(timer);
  }
}

function contentText(value) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map((part) => {
    if (typeof part === 'string') return part;
    return String(part?.text || part?.output_text || part?.content || '');
  }).filter(Boolean).join('\n');
}

function extractVisionResponse(body) {
  let parsed;
  try {
    parsed = JSON.parse(body.toString('utf8'));
  } catch (err) {
    throw actionableError('The OCR service returned invalid JSON.', err);
  }
  const text = contentText(parsed?.choices?.[0]?.message?.content) ||
    contentText(parsed?.output_text) ||
    contentText(parsed?.output?.[0]?.content);
  return ensureTextResult(text, 'The OCR service returned no readable text.');
}

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
      label: 'OCR service',
      fetchImpl: options.fetchImpl,
      trustedOrigins: [config.base_url],
      networkLookup: options.networkLookup,
    }
  );
  return extractVisionResponse(result.body);
}

function isPathInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function createTempDir(options, prefix) {
  const root = path.resolve(options.tempRoot || os.tmpdir());
  await fsp.mkdir(root, { recursive: true });
  const dir = await fsp.mkdtemp(path.join(root, prefix));
  if (!isPathInside(dir, root)) {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    throw actionableError('Could not create a safe temporary extraction directory.');
  }
  return { dir, root };
}

async function cleanupTempDir(temp) {
  if (!temp?.dir || !isPathInside(temp.dir, temp.root)) {
    throw actionableError('Temporary extraction path validation failed.');
  }
  try {
    await fsp.rm(temp.dir, { recursive: true, force: true });
  } catch (err) {
    throw actionableError('Temporary extraction files could not be removed.', err);
  }
}

function runBoundedProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const timeoutMs = clampInteger(options.timeoutMs, 30000, 1000, 300000);
    const maxStdoutBytes = clampInteger(options.maxStdoutBytes, 1024 * 1024, 1024, 4 * 1024 * 1024);
    const maxStderrBytes = clampInteger(options.maxStderrBytes, 64 * 1024, 1024, 256 * 1024);
    const label = options.label || 'Media helper';
    let child;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      const wrapped = actionableError(`${label} is unavailable.`, err);
      wrapped.process_code = 'PROCESS_UNAVAILABLE';
      reject(wrapped);
      return;
    }

    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let overflow = false;

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(actionableError(`${label} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    timer.unref?.();

    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxStdoutBytes) {
        overflow = true;
        child.kill('SIGKILL');
        finish(actionableError(`${label} produced too much output.`));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > maxStderrBytes) {
        overflow = true;
        child.kill('SIGKILL');
        finish(actionableError(`${label} produced too much diagnostic output.`));
        return;
      }
      stderr.push(chunk);
    });
    child.on('error', (err) => {
      const wrapped = actionableError(`${label} is unavailable.`, err);
      wrapped.process_code = err?.code === 'ENOENT' ? 'PROCESS_UNAVAILABLE' : 'PROCESS_FAILED';
      finish(wrapped);
    });
    child.on('close', (code) => {
      if (overflow || settled) return;
      if (code !== 0) {
        const wrapped = actionableError(`${label} failed with exit code ${code}.`);
        wrapped.process_code = 'PROCESS_FAILED';
        finish(wrapped);
        return;
      }
      finish(null, {
        stdout: Buffer.concat(stdout, stdoutBytes),
        stderr: Buffer.concat(stderr, stderrBytes),
      });
    });
  });
}

function tesseractLanguage(settings) {
  const value = String(settings.tesseract_lang || process.env.SOURCE_OCR_TESSERACT_LANG || 'eng').trim();
  return /^[A-Za-z0-9_+-]{1,80}$/.test(value) ? value : 'eng';
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
        label: 'Tesseract OCR',
        cwd: temp.dir,
      }
    );
    return { ok: true, text: ensureTextResult(Buffer.from(result.stdout || '').toString('utf8'), 'Tesseract OCR returned no readable text.') };
  } catch (err) {
    return { ok: false, unavailable: err?.process_code === 'PROCESS_UNAVAILABLE', error: err };
  } finally {
    await cleanupTempDir(temp);
  }
}

async function ocrImageWithFallback(db, image, options = {}, existingConfig) {
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
      providerError = err;
    }
  }

  const tesseract = await tryTesseract(image, options, config?.settings_object || {});
  if (tesseract.ok) return { text: tesseract.text, method: 'tesseract_cli' };
  if (!config && tesseract.unavailable) {
    throw actionableError('No OCR service is configured and Tesseract is unavailable. Add an active service_type=ocr AI configuration or install Tesseract CLI.');
  }
  if (providerError) throw providerError;
  throw actionableError('OCR failed. Check service_type=ocr or the local Tesseract installation.', tesseract.error);
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
    if (jpeg.data.length > MAX_NORMALIZED_IMAGE_BYTES) throw actionableError('The normalized OCR image exceeds the 10MB limit.');
    return { buffer: jpeg.data, mime: 'image/jpeg', width: jpeg.info.width, height: jpeg.info.height };
  } catch (err) {
    if (err?.code === 'BAD_REQUEST') throw err;
    throw actionableError('The uploaded image is invalid or exceeds the 40-megapixel decode limit.', err);
  }
}

function loadPdfJs() {
  if (!pdfJsPromise) pdfJsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfJsPromise;
}

function pageTextFromItems(items) {
  const lines = [];
  let current = '';
  let previousY = null;
  for (const item of items || []) {
    const value = String(item?.str || '');
    const y = Number(item?.transform?.[5]);
    if (current && Number.isFinite(y) && Number.isFinite(previousY) && Math.abs(y - previousY) > 2) {
      lines.push(current.trimEnd());
      current = '';
    }
    if (value) {
      if (current && !/\s$/.test(current) && !/^\s|^[,.;:!?，。；：！？、）\]]/.test(value)) current += ' ';
      current += value;
    }
    if (item?.hasEOL) {
      lines.push(current.trimEnd());
      current = '';
    }
    if (Number.isFinite(y)) previousY = y;
  }
  if (current.trim()) lines.push(current.trimEnd());
  return lines.join('\n').replace(/[ \t]+\n/g, '\n').trim();
}

async function pageContainsRasterImage(page, pdfjs) {
  const operatorList = await page.getOperatorList();
  const imageOperators = new Set([
    pdfjs.OPS.paintImageXObject,
    pdfjs.OPS.paintJpegXObject,
    pdfjs.OPS.paintInlineImageXObject,
    pdfjs.OPS.paintImageMaskXObject,
    pdfjs.OPS.paintSolidColorImageMask,
  ].filter(Number.isFinite));
  return operatorList.fnArray.some((operation) => imageOperators.has(operation));
}

async function renderPdfPage(page) {
  const base = page.getViewport({ scale: 1 });
  if (![base.width, base.height].every((value) => Number.isFinite(value) && value > 0)) {
    throw actionableError('The PDF contains an invalid page size.');
  }
  const scale = Math.min(
    2,
    MAX_PDF_RENDER_DIMENSION / Math.max(base.width, base.height),
    Math.sqrt(MAX_PDF_RENDER_PIXELS / (base.width * base.height))
  );
  if (!Number.isFinite(scale) || scale <= 0) throw actionableError('The PDF page cannot be rendered safely.');
  const viewport = page.getViewport({ scale });
  const width = Math.max(1, Math.ceil(viewport.width));
  const height = Math.max(1, Math.ceil(viewport.height));
  if (width * height > MAX_PDF_RENDER_PIXELS) throw actionableError('The PDF page exceeds the OCR render pixel limit.');
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  await page.render({ canvasContext: context, viewport, background: '#ffffff' }).promise;
  const buffer = canvas.toBuffer('image/png');
  if (buffer.length > MAX_NORMALIZED_IMAGE_BYTES) {
    return normalizeImage(buffer);
  }
  return { buffer, mime: 'image/png', width, height };
}

async function extractPdf(db, descriptor, fileBuffer, options) {
  const pdfjs = await loadPdfJs();
  let loadingTask;
  let document;
  try {
    loadingTask = pdfjs.getDocument({
      data: new Uint8Array(fileBuffer),
      disableWorker: true,
      disableAutoFetch: true,
      disableStream: true,
      isEvalSupported: false,
      useSystemFonts: true,
      verbosity: pdfjs.VerbosityLevel.ERRORS,
    });
    document = await loadingTask.promise;
  } catch (err) {
    await loadingTask?.destroy?.().catch(() => {});
    throw actionableError('The PDF is invalid, truncated, encrypted, or unsupported.', err);
  }

  const pageCount = document.numPages;
  const ocrConfig = selectActiveConfig(db, 'ocr');
  const pdfSettings = ocrConfig?.settings_object || {};
  const pageLimit = clampInteger(pdfSettings.max_pdf_pages, MAX_PDF_PAGES, 1, MAX_PDF_PAGES);
  const ocrPageLimit = clampInteger(pdfSettings.max_pdf_ocr_pages, MAX_PDF_OCR_PAGES, 1, MAX_PDF_OCR_PAGES);
  if (pageCount > pageLimit) {
    await document.destroy();
    throw actionableError(`The PDF has ${pageCount} pages; the configured limit is ${pageLimit}. Split the PDF and try again.`);
  }

  const pageResults = [];
  const methods = new Set();
  let ocrPageCount = 0;
  let ocrConfigId = null;
  try {
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      try {
        const content = await page.getTextContent({ disableNormalization: false });
        let text = pageTextFromItems(content.items);
        if (text.replace(/\s/g, '').length >= 4) {
          methods.add('pdf_text');
        } else if (await pageContainsRasterImage(page, pdfjs)) {
          ocrPageCount += 1;
          if (ocrPageCount > ocrPageLimit) {
            throw actionableError(`The PDF needs OCR on more than ${ocrPageLimit} pages. Split the PDF and try again.`);
          }
          const image = await renderPdfPage(page);
          const ocr = await ocrImageWithFallback(db, image, options, ocrConfig);
          text = ocr.text;
          methods.add(ocr.method);
          if (ocr.config_id) ocrConfigId = ocr.config_id;
        }
        if (text.trim()) pageResults.push(`--- Page ${pageNumber} ---\n${text.trim()}`);
        const currentBytes = Buffer.byteLength(pageResults.join('\n\n'), 'utf8');
        if (currentBytes > MAX_EXTRACTED_TEXT_BYTES) {
          throw actionableError('Extracted PDF text exceeds the 2MB limit. Split the PDF and try again.');
        }
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await document.destroy();
  }

  const text = ensureTextResult(pageResults.join('\n\n'), 'The PDF contains no extractable text or OCR-readable pages.');
  return {
    text,
    metadata: {
      extraction_method: Array.from(methods).join('+') || 'pdf_text',
      media_kind: descriptor.kind,
      detected_format: descriptor.format,
      extracted_text_length: text.length,
      page_count: pageCount,
      ocr_page_count: ocrPageCount,
      ...(ocrConfigId ? { extraction_service_type: 'ocr', extraction_config_id: ocrConfigId } : {}),
    },
  };
}

function transcriptionResponse(body, contentType) {
  if (contentType.startsWith('text/')) return ensureTextResult(body.toString('utf8'), 'The transcription service returned no text.');
  let parsed;
  try {
    parsed = JSON.parse(body.toString('utf8'));
  } catch (err) {
    throw actionableError('The transcription service returned invalid JSON.', err);
  }
  const text = parsed?.text || parsed?.transcript || parsed?.data?.text || '';
  return ensureTextResult(text, 'The transcription service returned no text.');
}

async function transcribeAudio(db, audio, options = {}) {
  const config = selectActiveConfig(db, 'transcription');
  if (!config) {
    throw actionableError('No transcription service is configured. Add an active service_type=transcription OpenAI-compatible AI configuration.');
  }
  if (audio.buffer.length > MAX_TRANSCODED_AUDIO_BYTES) {
    throw actionableError('Audio sent for transcription exceeds the 20MB limit. Shorten or compress the source.');
  }
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
      label: 'Transcription service',
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

function parseProbeOutput(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(stdout || '').toString('utf8'));
  } catch (err) {
    throw actionableError('FFprobe returned invalid media metadata.', err);
  }
  const audioStreams = Array.isArray(parsed.streams) ? parsed.streams.filter((stream) => stream.codec_type === 'audio') : [];
  if (!audioStreams.length) throw actionableError('The uploaded video has no audio track to transcribe.');
  const durations = [parsed?.format?.duration, ...audioStreams.map((stream) => stream.duration)]
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!durations.length) throw actionableError('The uploaded video duration could not be determined safely.');
  return { duration: Math.max(...durations) };
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
      throw actionableError(`The uploaded video is ${Math.ceil(media.duration)} seconds; the transcription limit is ${durationLimit} seconds.`);
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
        label: 'FFmpeg audio extraction',
        cwd: temp.dir,
      }
    );
    const stat = await fsp.stat(outputPath).catch(() => null);
    if (!stat?.isFile() || stat.size <= 0) throw actionableError('FFmpeg did not produce a usable audio track.');
    if (stat.size > MAX_TRANSCODED_AUDIO_BYTES) throw actionableError('The extracted video audio exceeds the 20MB transcription limit.');
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

async function extractUploadedSource(db, file, options = {}) {
  const descriptor = inspectUploadedFile(file);
  if (descriptor.kind === 'text') {
    const text = decodeUtf8Text(file.buffer);
    return {
      text,
      file: descriptor,
      metadata: {
        extraction_method: 'utf8_text',
        media_kind: descriptor.kind,
        detected_format: descriptor.format,
        extracted_text_length: text.length,
      },
    };
  }
  if (descriptor.kind === 'pdf') {
    return { ...await extractPdf(db, descriptor, file.buffer, options), file: descriptor };
  }
  if (descriptor.kind === 'image') {
    const image = await normalizeImage(file.buffer);
    const ocr = await ocrImageWithFallback(db, image, options);
    return {
      text: ocr.text,
      file: descriptor,
      metadata: {
        extraction_method: ocr.method,
        extraction_service_type: 'ocr',
        ...(ocr.config_id ? { extraction_config_id: ocr.config_id } : {}),
        media_kind: descriptor.kind,
        detected_format: descriptor.format,
        extracted_text_length: ocr.text.length,
        image_width: image.width,
        image_height: image.height,
      },
    };
  }
  if (descriptor.kind === 'audio') {
    const transcription = await transcribeAudio(db, {
      buffer: file.buffer,
      mime: descriptor.mime,
      filename: descriptor.filename,
    }, options);
    return {
      text: transcription.text,
      file: descriptor,
      metadata: {
        extraction_method: 'openai_compatible_transcription',
        extraction_service_type: 'transcription',
        extraction_config_id: transcription.config_id,
        media_kind: descriptor.kind,
        detected_format: descriptor.format,
        extracted_text_length: transcription.text.length,
      },
    };
  }
  if (descriptor.kind === 'video') {
    return { ...await extractVideoAndTranscribe(db, descriptor, file.buffer, options), file: descriptor };
  }
  throw actionableError('Unsupported Source Intake file type.');
}

module.exports = {
  MAX_SOURCE_UPLOAD_BYTES,
  extractUploadedSource,
  inspectUploadedFile,
  requestBounded,
  runBoundedProcess,
};
