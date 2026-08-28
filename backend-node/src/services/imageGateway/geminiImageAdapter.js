'use strict';

// 从 imageClient 拆出的 Gemini 图生请求拼装，保持原语义；不是新增真实接入。

const uploadService = require('../uploadService');
const { uploadToImageProxy } = uploadService;
const { summarizeProviderResponse } = require('../providerErrorSanitizer');
const {
  IMAGE_HTTP_TIMEOUT_MS,
  postJSONWithTimeout,
  imageProviderFailure,
  imageProviderException,
} = require('./runtime');
const { geminiAspectRatio, buildGeminiImageConfig } = require('./sizeAdapters');
const { resolveImageRef, compressImageBuffer } = require('./referenceUtils');
const {
  getProxyCacheValidated,
  setProxyCache,
  buildCacheKey,
} = require('./proxyCache');

/**
 * 调用 Google Gemini 图片生成 API（generateContent 接口，返回 base64 inlineData）
 * 支持模型：gemini-2.5-flash-image / gemini-2.5-flash-image-preview /
 *          gemini-3.1-flash-image-preview / gemini-3-pro-image-preview 等
 * 参考图先查本地缓存表，未命中则上传到中转图床并缓存，再通过 fileData.fileUri 传给 Gemini。
 * 避免 inlineData base64 大 payload 触发 503 memory overload。
 */
async function callGeminiImageApi(db, config, log, opts) {
  const { prompt, model, size, image_gen_id, reference_image_urls, files_base_url, storage_local_path, system_prompt } = opts;
  const apiKey = config.api_key || '';
  const base = (config.base_url || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
  const modelName = model || 'gemini-2.5-flash-image';
  const aspectRatio = geminiAspectRatio(size);
  const geminiImageConfig = buildGeminiImageConfig(aspectRatio, modelName, size);
  const tStart = Date.now();
  const elapsed = () => `${Date.now() - tStart}ms`;

  log.info('[Gemini图生] ▶ 开始', {
    image_gen_id,
    model: modelName,
    imageConfig: geminiImageConfig,
    base_url: base.slice(0, 60),
    prompt_len: (prompt || '').length,
    raw_ref_count: Array.isArray(reference_image_urls) ? reference_image_urls.length : 0,
  });

  // 读取全局配置，判断参考图传输方式
  // image_proxy.use_for_gemini = false（默认）→ 直接 inlineData base64
  // image_proxy.use_for_gemini = true          → 上传图床后用 fileData.fileUri
  const globalCfg = (() => { try { return require('../../config').loadConfig(); } catch (_) { return {}; } })();
  const useImageProxy = !!(globalCfg?.image_proxy?.use_for_gemini);
  log.info('[Gemini图生] 参考图传输方式', { image_gen_id, use_image_proxy: useImageProxy });

  const rawRefs = Array.isArray(reference_image_urls) ? reference_image_urls.filter(Boolean) : [];
  const MAX_GEMINI_REF_IMAGES = 4; // 场景 + 角色/道具等合计最多 4 张（由 imageService 组装顺序决定）

  // 解析 system_prompt 中的每张参考图标签（格式: "Image N: description..."）
  // Gemini 多模态的正确输入结构：[文字说明] → [图片] → [文字说明] → [图片] → [生成指令]
  // 即：每张参考图紧跟其说明文字，最后才是生成任务
  const refLabelMap = {}; // index(0-based) → label text
  if (system_prompt) {
    system_prompt.split('\n').forEach(line => {
      const m = line.match(/^Image\s+(\d+):\s*(.+)/i);
      if (m) refLabelMap[parseInt(m[1], 10) - 1] = m[2].trim(); // 转为 0-based index
    });
  }

  // 读取所有参考图（buffer + mimeType）
  const refImageParts = []; // { label, imagePart }
  const TOTAL_REF_LIMIT_BYTES = 10 * 1024 * 1024; // inlineData 模式总大小上限 10MB
  let totalRefSizeBytes = 0;
  for (let i = 0; i < rawRefs.slice(0, MAX_GEMINI_REF_IMAGES).length; i++) {
    const ref = rawRefs[i];
    log.info('[Gemini图生] 参考图 读取中', { image_gen_id, ref_index: i, ref: String(ref).slice(0, 80), elapsed: elapsed() });
    const tRead = Date.now();

    const resolved = resolveImageRef(ref, files_base_url, storage_local_path);
    if (!resolved) {
      log.warn('[Gemini图生] 参考图 无法解析，跳过', { image_gen_id, ref_index: i, ref: String(ref).slice(0, 80) });
      continue;
    }

    let imageBuffer, mimeType;
    if (resolved.startsWith('data:')) {
      const m = resolved.match(/^data:([\w/]+);base64,(.+)$/);
      if (!m) { log.warn('[Gemini图生] 参考图 data URL 格式异常，跳过', { image_gen_id, ref_index: i }); continue; }
      mimeType = m[1];
      imageBuffer = Buffer.from(m[2], 'base64');
    } else {
      throw new uploadService.UnsafeMediaReferenceError('Gemini reference image was not prevalidated.');
    }

    log.info('[Gemini图生] 参考图 读取完成', {
      image_gen_id, ref_index: i, mime: mimeType,
      size_kb: Math.round(imageBuffer.length / 1024),
      read_ms: Date.now() - tRead, elapsed: elapsed(),
    });

    // 超过 10MB 直接跳过（Gemini 硬限制）
    if (imageBuffer.length > 10 * 1024 * 1024) {
      log.warn('[Gemini图生] 参考图 超过10MB，跳过', { image_gen_id, ref_index: i, size_mb: (imageBuffer.length / 1024 / 1024).toFixed(1) });
      continue;
    }

    // ① 单张超过 2MB 时用 sharp 压缩到 2MB 以内
    if (imageBuffer.length > 2 * 1024 * 1024) {
      const compressed = await compressImageBuffer(imageBuffer, mimeType, 2048, log);
      imageBuffer = compressed.buffer;
      mimeType = compressed.mimeType;
    }

    // ② 总大小预算控制（inlineData 模式）：所有参考图合计不超过 10MB
    if (!useImageProxy) {
      const remaining = TOTAL_REF_LIMIT_BYTES - totalRefSizeBytes;
      if (imageBuffer.length > remaining) {
        const targetKB = Math.max(200, Math.floor(remaining / 1024));
        log.info('[Gemini图生] 参考图 总大小超预算，追加压缩', {
          image_gen_id, ref_index: i,
          current_kb: Math.round(imageBuffer.length / 1024),
          budget_kb: Math.round(remaining / 1024),
          target_kb: targetKB,
        });
        const compressed2 = await compressImageBuffer(imageBuffer, mimeType, targetKB, log);
        imageBuffer = compressed2.buffer;
        mimeType = compressed2.mimeType;
        if (imageBuffer.length > remaining) {
          log.warn('[Gemini图生] 参考图 追加压缩后仍超总预算，跳过', { image_gen_id, ref_index: i });
          continue;
        }
      }
      totalRefSizeBytes += imageBuffer.length;
    }

    let imagePart;
    if (useImageProxy) {
      const cacheKey = buildCacheKey(ref, imageBuffer);
      let fileUri = await getProxyCacheValidated(db, cacheKey, log, `gemini_ig${image_gen_id}_ref${i}`);
      if (fileUri) {
        log.info('[Gemini图生] 参考图 缓存命中（图床）', { image_gen_id, ref_index: i });
      } else {
        log.info('[Gemini图生] 参考图 缓存未命中，上传图床 →', { image_gen_id, ref_index: i, elapsed: elapsed() });
        fileUri = await uploadToImageProxy(imageBuffer, mimeType, log, image_gen_id);
        if (fileUri) {
          setProxyCache(db, cacheKey, fileUri);
        } else {
          log.warn('[Gemini图生] 参考图 上传图床失败，该参考图将跳过', { image_gen_id, ref_index: i, elapsed: elapsed() });
          continue;
        }
      }
      imagePart = { fileData: { fileUri, mimeType } };
    } else {
      imagePart = { inlineData: { mimeType, data: imageBuffer.toString('base64') } };
    }

    refImageParts.push({ label: refLabelMap[i] || null, imagePart });
    log.info('[Gemini图生] 参考图 已处理', { image_gen_id, ref_index: i, has_label: !!refLabelMap[i] });
  }

  // 构建 parts：正确的 Gemini 多模态输入顺序
  // [参考说明] → [参考图1] → [参考图2] → ... → [生成指令+主提示词]
  // 这与 Gemini 的 "文字描述紧接对应内容" 原则一致，避免模型混淆
  const parts = [];
  if (refImageParts.length > 0) {
    parts.push({ text: 'The following are visual reference images. Use them ONLY to maintain character appearance and scene environment consistency. Do NOT reproduce their layout or format.' });
    for (let i = 0; i < refImageParts.length; i++) {
      const { label, imagePart } = refImageParts[i];
      parts.push({ text: label ? `Reference ${i + 1}: ${label}` : `Reference ${i + 1}:` });
      parts.push(imagePart);
    }
    // 生成指令放在所有参考图之后，清晰分隔
    parts.push({ text: `Generate ONE single cinematic storyboard frame (do NOT create a grid or multi-panel layout):\n\n${prompt || ''}` });
  } else {
    // 无参考图：直接用 prompt
    parts.push({ text: prompt || '' });
  }

  log.info('[Gemini图生] 参考图处理完毕，准备请求 Gemini API', {
    image_gen_id, parts_count: parts.length, ref_parts: refImageParts.length, elapsed: elapsed(),
  });

  // 宽高比必须在 imageConfig 内（与 Google 官方 REST 一致）；顶层 aspectRatio 会被忽略。
  // 勿与 Imagen 的 imageGenerationConfig 混淆。
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['IMAGE', 'TEXT'],
      numberOfImages: 1,
      imageConfig: geminiImageConfig,
    },
  };

  const url = `${base}/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  log.info('[Gemini图生] → 发送请求', { image_gen_id, model: modelName, url: url.replace(/key=[^&]+/, 'key=***').slice(0, 120), elapsed: elapsed() });

  const tReq = Date.now();
  let geminiStatus;
  let raw;
  try {
    const out = await postJSONWithTimeout(
      url,
      { 'Content-Type': 'application/json' },
      body,
      IMAGE_HTTP_TIMEOUT_MS,
    );
    geminiStatus = out.statusCode;
    raw = out.raw;
  } catch (e) {
    const safeError = imageProviderException(e, 'Gemini', 'image request');
    log.error('[Gemini图生] ✗ 网络错误', { image_gen_id, error: safeError, total_elapsed: elapsed() });
    return { error: safeError.message };
  }
  log.info('[Gemini图生] ← 收到响应', { image_gen_id, status: geminiStatus, req_ms: Date.now() - tReq, elapsed: elapsed() });

  if (geminiStatus < 200 || geminiStatus >= 300) {
    log.error('[Gemini图生] ✗ API错误', {
      image_gen_id,
      status: geminiStatus,
      total_elapsed: elapsed(),
      ...summarizeProviderResponse(raw),
    });
    return imageProviderFailure('Gemini', 'image request', geminiStatus, raw);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    log.error('[Gemini图生] ✗ 响应 JSON 解析失败', {
      image_gen_id,
      total_elapsed: elapsed(),
      ...summarizeProviderResponse(raw),
    });
    return { error: 'Gemini 图片生成返回格式异常' };
  }

  // 从 candidates → content → parts 中找 inlineData（图片）
  const candidates = data?.candidates || [];
  for (const candidate of candidates) {
    for (const part of candidate?.content?.parts || []) {
      if (part.inlineData?.data) {
        const mimeType = part.inlineData.mimeType || 'image/png';
        const dataUrl = `data:${mimeType};base64,${part.inlineData.data}`;
        log.info('[Gemini图生] ✓ 成功', { image_gen_id, model: modelName, mime: mimeType, total_elapsed: elapsed() });
        return { image_url: dataUrl };
      }
    }
  }

  log.warn('[Gemini图生] ✗ 响应中无图片内容', {
    image_gen_id,
    candidates_count: candidates.length,
    total_elapsed: elapsed(),
    ...summarizeProviderResponse(data),
  });
  return { error: 'Gemini 未返回图片内容，请检查模型名称或 API Key 权限' };
}

module.exports = {
  callGeminiImageApi,
};
