'use strict';

// 从 imageClient 拆出的通义万象/千问图生请求拼装，保持原语义；不是新增真实接入。

const { summarizeProviderResponse } = require('../providerErrorSanitizer');
const {
  IMAGE_HTTP_TIMEOUT_MS,
  ANTI_SPLIT_NEGATIVE_PROMPT,
  postJSONWithTimeout,
  imageProviderFailure,
  imageProviderException,
} = require('./runtime');
const {
  dashScopeSize,
  isQwenImageProvider,
  qwenImageSize,
} = require('./sizeAdapters');
const { resolveImageRef } = require('./referenceUtils');

// 从 DashScope 返回的 output.choices 中取第一张图 URL（兼容 type 为 "image" 或 仅有 image 字段）
function parseDashScopeImageUrl(data) {
  const choices = data?.output?.choices;
  if (!Array.isArray(choices)) return null;
  for (const c of choices) {
    const content = c?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part) continue;
      if (part.image && (part.type === 'image' || !part.type)) return part.image;
    }
  }
  return null;
}

// 通义万象：支持参考图（角色/场景），content 为 [text, image, image, ...]；本地调试时参考图可转 base64
// 通义千问 qwen-image：仅支持 content 中一个 text，用同步接口，parameters 不含 stream/enable_interleave
async function callDashScopeImageApi(config, log, opts) {
  const { prompt, model, size, image_gen_id, reference_image_urls, files_base_url, storage_local_path, negative_prompt } = opts;
  const base = (config.base_url || '').replace(/\/$/, '');
  const url = base + (config.endpoint || '/api/v1/services/aigc/multimodal-generation/generation');
  if (!url.includes('dashscope')) {
    return { error: '通义万象 base_url 需为 https://dashscope.aliyuncs.com' };
  }
  const isQwenImage = isQwenImageProvider(config, model);

  if (isQwenImage) {
    // 千问文生图：仅支持单条 text，长度不超过 800 字符；同步接口，无 stream/enable_interleave
    const text = (prompt || '').toString().trim().slice(0, 800);
    const body = {
      model: model || 'qwen-image-max',
      input: {
        messages: [{ role: 'user', content: [{ text }] }],
      },
      parameters: {
        prompt_extend: true,
        watermark: false,
        size: qwenImageSize(size),
      },
    };
    if (negative_prompt && String(negative_prompt).trim()) {
      body.parameters.negative_prompt = String(negative_prompt).trim().slice(0, 500);
    }
    log.info('Image API request (Qwen-Image sync)', { url: url.slice(0, 70), model: body.model, image_gen_id });
    const qwenHeaders = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + (config.api_key || ''),
    };
    let raw;
    let httpStatus;
    try {
      const out = await postJSONWithTimeout(url, qwenHeaders, body, IMAGE_HTTP_TIMEOUT_MS);
      httpStatus = out.statusCode;
      raw = out.raw;
    } catch (e) {
      const safeError = imageProviderException(e, 'Qwen-Image', 'image request');
      log.error('Qwen-Image network error', { image_gen_id, error: safeError });
      return { error: safeError.message };
    }
    if (httpStatus < 200 || httpStatus >= 300) {
      log.error('Qwen-Image create failed', {
        status: httpStatus,
        image_gen_id,
        ...summarizeProviderResponse(raw),
      });
      return imageProviderFailure('Qwen-Image', 'image request', httpStatus, raw);
    }
    try {
      const data = JSON.parse(raw);
      if (data.code) {
        log.warn('Qwen-Image response error', { code: data.code, image_gen_id });
        return imageProviderFailure('Qwen-Image', 'image request', httpStatus, data, data.code);
      }
      const imageUrl = parseDashScopeImageUrl(data);
      if (imageUrl) {
        log.info('Qwen-Image image (sync)', { image_gen_id, has_image_url: true });
        return { image_url: imageUrl };
      }
      return { error: '未返回图片地址' };
    } catch (e) {
      log.warn('Qwen-Image parse error', { image_gen_id, ...summarizeProviderResponse(raw) });
      return { error: '通义千问返回格式异常' };
    }
  }

  const refs = Array.isArray(reference_image_urls) ? reference_image_urls.filter(Boolean) : [];
  const content = [{ text: prompt || '' }];
  const resolvedRefs = [];
  for (const ref of refs.slice(0, 10)) {
    const img = resolveImageRef(ref, files_base_url, storage_local_path);
    if (img) {
      content.push({ image: img });
      resolvedRefs.push(img.startsWith('data:') ? '(base64)' : img);
    }
  }
  log.info('reference_image_urls 解析摘要', {
    image_gen_id,
    reference_count: refs.length,
    resolved_count: resolvedRefs.length,
    resolved_types: resolvedRefs.map((value) => value.startsWith('data:') ? 'data' : 'url'),
  });

  const hasRefs = content.length > 1;
  const stream = !hasRefs; // enable_interleave=false 时必须 stream=false
  const body = {
    model: model || 'wan2.6-image',
    input: {
      messages: [{ role: 'user', content }],
    },
    parameters: {
      prompt_extend: true,
      watermark: false,
      n: 1,
      enable_interleave: !hasRefs,
      size: dashScopeSize(size),
      stream,
      // 多张参考图时注入 negative_prompt，防止生成分割/拼贴布局
      ...(hasRefs ? { negative_prompt: negative_prompt || ANTI_SPLIT_NEGATIVE_PROMPT } : (negative_prompt ? { negative_prompt } : {})),
    },
  };
  const contentSummary = content.map((p) => (p.text != null ? 'text' : p.image && p.image.startsWith('data:') ? 'image(base64)' : 'image(url)'));
  log.info('Image API request (DashScope)', {
    url: url.slice(0, 70),
    model: body.model,
    image_gen_id,
    reference_count: refs.length,
    enable_interleave: body.parameters.enable_interleave,
    stream: body.parameters.stream,
    content_parts: contentSummary,
  });
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + (config.api_key || ''),
  };
  if (stream) headers['X-DashScope-Sse'] = 'enable';
  let raw;
  let httpStatus;
  try {
    const out = await postJSONWithTimeout(url, headers, body, IMAGE_HTTP_TIMEOUT_MS);
    httpStatus = out.statusCode;
    raw = out.raw;
  } catch (e) {
    const safeError = imageProviderException(e, 'DashScope', 'image request');
    log.error('DashScope network error', { image_gen_id, error: safeError });
    return { error: safeError.message };
  }
  if (httpStatus < 200 || httpStatus >= 300) {
    log.error('DashScope create failed', {
      status: httpStatus,
      image_gen_id,
      ...summarizeProviderResponse(raw),
    });
    return imageProviderFailure('DashScope', 'image request', httpStatus, raw);
  }

  if (!stream) {
    // 非流式：单次 JSON 响应
    try {
      const data = JSON.parse(raw);
      if (data.code) {
        log.warn('DashScope response error', { code: data.code, image_gen_id });
        return imageProviderFailure('DashScope', 'image request', httpStatus, data, data.code);
      }
      const imageUrl = parseDashScopeImageUrl(data);
      if (imageUrl) {
        log.info('DashScope image (sync)', { image_gen_id, has_image_url: true });
        return { image_url: imageUrl };
      }
      log.warn('DashScope sync no image in response', {
        image_gen_id,
        output_keys: data.output ? Object.keys(data.output) : [],
        ...summarizeProviderResponse(data),
      });
      return { error: '未返回图片地址' };
    } catch (e) {
      log.warn('DashScope sync parse error', { image_gen_id, ...summarizeProviderResponse(raw) });
      return { error: '通义万象返回格式异常' };
    }
  }

  // 流式响应：可能是纯 JSON 行，或 SSE 格式 "data: {...}\n"
  let lastImageUrl = null;
  const lines = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  let firstChunkKeys = null;
  for (const line of lines) {
    let jsonStr = line;
    if (line.startsWith('data:')) {
      jsonStr = line.slice(5).trim();
      if (!jsonStr || jsonStr === '[DONE]') continue;
    }
    try {
      const data = JSON.parse(jsonStr);
      if (data.code) {
        log.warn('DashScope stream chunk error', { code: data.code, image_gen_id });
        return imageProviderFailure('DashScope', 'image stream', httpStatus, data, data.code);
      }
      if (firstChunkKeys == null && data.output) {
        const oc = data.output.choices?.[0];
        firstChunkKeys = {
          output_keys: Object.keys(data.output),
          choice_message_keys: oc?.message ? Object.keys(oc.message) : [],
          content_types: Array.isArray(oc?.message?.content) ? oc.message.content.map((p) => p && p.type) : [],
        };
      }
      const urlFromChunk = parseDashScopeImageUrl(data);
      if (urlFromChunk) lastImageUrl = urlFromChunk;
    } catch (_) {
      // 忽略非 JSON 行
    }
  }
  if (lastImageUrl) {
    log.info('DashScope image (stream)', { image_gen_id, has_image_url: true });
    return { image_url: lastImageUrl };
  }
  if (lines.length > 0) {
    try {
      const firstLine = lines[0].startsWith('data:') ? lines[0].slice(5).trim() : lines[0];
      const first = JSON.parse(firstLine);
      if (first.code) return imageProviderFailure('DashScope', 'image stream', httpStatus, first, first.code);
    } catch (_) {}
  }
  log.warn('DashScope stream no image in response', {
    image_gen_id,
    line_count: lines.length,
    first_chunk: firstChunkKeys,
    ...summarizeProviderResponse(raw),
  });
  return { error: '未返回图片地址' };
}

module.exports = {
  callDashScopeImageApi,
  parseDashScopeImageUrl,
};
