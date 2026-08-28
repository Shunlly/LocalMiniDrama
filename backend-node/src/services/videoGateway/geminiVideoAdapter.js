'use strict';

const {
  clampToGeminiImageAspectRatio,
  isGeminiOfficialHost,
} = require('../mediaAspectRatioSpec');
const { summarizeProviderResponse } = require('../providerErrorSanitizer');
const {
  fetchVideoWithTimeout,
  videoProviderFailure,
} = require('./helpers');
const { loadReferenceImageBuffer } = require('./mediaRefs');

/**
 * ?? Google Gemini Veo ???? API?predictLongRunning ??????
 * ?????veo-3.1-generate-preview / veo-3.0-generate-preview / veo-3.0-fast-generate-preview
 * ?? t2v?????? i2v???????
 */
async function callGeminiVideoApi(config, log, opts) {
  const { prompt, duration, aspect_ratio, image_url, video_gen_id, files_base_url, storage_local_path, model } = opts;
  const apiKey = config.api_key || '';
  const base = (config.base_url || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
  const modelName = model || 'veo-3.0-generate-preview';

  // durationSeconds ??? 5-8 ?
  const durationSec = Math.min(8, Math.max(5, Math.round(Number(duration) || 8)));
  const ratio = clampToGeminiImageAspectRatio(aspect_ratio || '16:9');

  const instance = { prompt: prompt || '' };

  // Gemini accepts inline image bytes; resolve local and remote references through the shared boundary.
  if (image_url && image_url.trim()) {
    try {
      const image = await loadReferenceImageBuffer(image_url, storage_local_path);
      if (image) {
        instance.image = {
          bytesBase64Encoded: image.buffer.toString('base64'),
          mimeType: image.mimeType,
        };
      }
    } catch (error) {
      log.warn('Gemini reference image rejected', { error: error.message, video_gen_id });
    }
  }

  const parameters = {
    aspectRatio: ratio,
    durationSeconds: durationSec,
    sampleCount: 1,
  };
  if (!isGeminiOfficialHost(base)) {
    parameters.aspect_ratio = ratio;
  }
  const body = {
    instances: [instance],
    parameters,
  };

  const url = `${base}/v1beta/models/${encodeURIComponent(modelName)}:predictLongRunning`;
  log.info('Gemini Video API request', {
    model: modelName,
    ratio,
    official_field: 'parameters.aspectRatio',
    durationSec,
    video_gen_id,
    has_image: !!instance.image,
  });

  const res = await fetchVideoWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) {
    log.error('Gemini Video API failed', {
      status: res.status,
      video_gen_id,
      ...summarizeProviderResponse(raw),
    });
    return videoProviderFailure('Gemini', 'video request', res.status, raw);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return { error: 'Gemini ??????????' };
  }

  // ?? operation name ?? task_id???? pollVideoTask ??
  const operationName = data.name;
  if (operationName) {
    log.info('Gemini Video task created', { operation: operationName, video_gen_id });
    return { task_id: operationName, status: 'processing' };
  }
  return { error: 'Gemini ??? operation name???? API Key ?????' };
}

module.exports = {
  callGeminiVideoApi,
};
