'use strict';

let sharp; try { sharp = require('sharp'); } catch (_) { sharp = null; }
const uploadService = require('../uploadService');
const { uploadLocalImageToProxy } = uploadService;
const {
  clampToViduAspectRatio,
  pickViduResolutionParam,
} = require('../mediaAspectRatioSpec');
const { summarizeProviderResponse } = require('../providerErrorSanitizer');
const {
  fetchVideoWithTimeout,
  videoProviderFailure,
  logVideoPostRequest,
} = require('./helpers');
const {
  loadStorageImage,
  loadReferenceImageBuffer,
  publicUrlFromLocalRef,
} = require('./mediaRefs');

/** 解析 "16:9"、"21:9" 等为 宽/高 数值比 */
function parseViduAspectRatio(aspectStr) {
  const t = String(aspectStr || '').trim();
  const m = t.match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
  if (!m || Number(m[2]) === 0) return null;
  return Number(m[1]) / Number(m[2]);
}

/** 参考图宽高比(宽/高) 与目标比例差异超过容差则视为不一致 */
function viduImageAspectMismatchesTarget(imgW, imgH, targetAspectStr, relTol = 0.06) {
  const tgt = parseViduAspectRatio(targetAspectStr);
  if (tgt == null || !imgW || !imgH || imgH <= 0) return false;
  const imgR = imgW / imgH;
  const diff = Math.abs(imgR - tgt) / Math.max(imgR, tgt, 0.01);
  return diff > relTol;
}

/** Vidu 常见比例 → 画布像素（宽×高），与 720p 量级一致，便于 img2video 画幅与目标一致 */
function viduLetterboxCanvasPixels(aspectStr) {
  const m = {
    '16:9': [1280, 720],
    '9:16': [720, 1280],
    '1:1': [720, 720],
    '4:3': [960, 720],
    '3:4': [720, 960],
    '21:9': [1680, 720],
  };
  return m[String(aspectStr || '').trim()] || null;
}

/**
 * 加载参考图为 Buffer（与 probe 同源）。不修改磁盘上的原文件。
 */
async function loadViduReferenceImageBuffer(rawImgUrl, publicImgUrl, storage_local_path, log, video_gen_id) {
  try {
    const raw = (rawImgUrl || '').trim();
    const local = raw ? await loadReferenceImageBuffer(raw, storage_local_path) : null;
    if (local) return local.buffer;
    const publicValue = String(publicImgUrl || '').trim();
    if (!publicValue || publicValue === raw) return null;
    const downloaded = await loadReferenceImageBuffer(publicValue, storage_local_path);
    return downloaded?.buffer || null;
  } catch (e) {
    log.warn('[Vidu] load reference image buffer failed', { error: e.message, video_gen_id });
    return null;
  }
}

/** 将图 contain 到目标比例画布（黑边），使像素比例与 Vidu aspect_ratio 一致，供 img2video 跟随画幅 */
async function letterboxBufferToViduAspect(imageBuffer, aspectStr, log, video_gen_id) {
  if (!sharp || !imageBuffer) return null;
  const box = viduLetterboxCanvasPixels(aspectStr);
  if (!box) return null;
  const [cw, ch] = box;
  try {
    const out = await sharp(imageBuffer, { failOn: 'none' })
      .rotate()
      .resize(cw, ch, {
        fit: 'contain',
        position: 'centre',
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();
    log.info('[Vidu] letterbox OK', { video_gen_id, target_aspect: aspectStr, canvas: `${cw}x${ch}`, out_kb: Math.round(out.length / 1024) });
    return out;
  } catch (e) {
    log.warn('[Vidu] letterbox failed', { video_gen_id, error: e.message });
    return null;
  }
}

/**
 * 读取参考图像素尺寸（用于与目标画幅对比）。不修改图片。
 * 优先读本地 static 文件；否则拉取 public URL。
 */
async function probeViduReferenceImageSize(rawImgUrl, publicImgUrl, storage_local_path, log, video_gen_id) {
  if (!sharp) {
    log.info('[Vidu] probe image: skipped (sharp unavailable)', { video_gen_id });
    return null;
  }
  try {
    let probeSource = '';
    const raw = (rawImgUrl || '').trim();
    if (raw.startsWith('data:image')) {
      probeSource = 'data_url';
    } else if (storage_local_path) {
      try {
        if (loadStorageImage(raw, storage_local_path)) probeSource = 'local_static';
      } catch (_) {}
    }
    if (!probeSource) {
      const fetchUrl = (publicImgUrl || '').trim() || raw;
      if (fetchUrl && !fetchUrl.startsWith('data:')) {
        probeSource = 'http_fetch';
        log.info('[Vidu] probe image: fetching', {
          video_gen_id,
          url_head: fetchUrl.length > 160 ? fetchUrl.slice(0, 160) + '…' : fetchUrl,
          url_len: fetchUrl.length,
        });
      }
    }
    const buf = await loadViduReferenceImageBuffer(rawImgUrl, publicImgUrl, storage_local_path, log, video_gen_id);
    if (!buf) {
      log.info('[Vidu] probe image: no buffer', { video_gen_id, has_public: !!publicImgUrl });
      return null;
    }
    if (probeSource === 'data_url') log.info('[Vidu] probe image: source=data URL', { video_gen_id, bytes: buf.length });
    if (probeSource === 'local_static') {
      log.info('[Vidu] probe image: source=local storage', { video_gen_id, bytes: buf.length });
    }
    if (probeSource === 'http_fetch') log.info('[Vidu] probe image: fetch ok', { video_gen_id, bytes: buf.length });

    const meta = await sharp(buf, { failOn: 'none' }).rotate().metadata();
    const w = meta.width;
    const h = meta.height;
    if (!w || !h) {
      log.warn('[Vidu] probe image: no width/height in metadata', { video_gen_id, meta: { w, h, orientation: meta.orientation } });
      return null;
    }
    const whRatio = w / h;
    log.info('[Vidu] probe image: dimensions', {
      video_gen_id,
      source: probeSource || 'unknown',
      width: w,
      height: h,
      wh_ratio: Number(whRatio.toFixed(6)),
    });
    return { width: w, height: h };
  } catch (e) {
    log.warn('[Vidu] probe image dimensions failed', { error: e.message, video_gen_id });
    return null;
  }
}

/** 图生视频时参考图比例与目标不一致：强调参考图仅作内容参考，按目标画幅生成（不改原图） */
function viduMismatchAspectPromptSuffix(targetRatioLabel) {
  const r = targetRatioLabel || '16:9';
  return (
    `【画幅】参考图仅作角色、场景与风格参考，请勿沿用参考图的画幅比例；请按 ${r} 宽高比输出整段视频，构图与运镜可在该比例下自由发挥。` +
    ` The reference image is for subject/scene/style only; output the full video in aspect ratio ${r}, not the reference frame shape.`
  );
}

/**
 * ?? Vidu ???? API??? api.vidu.cn/ent/v2?
 * ???Authorization: Token {api_key}?? Bearer?
 * ???POST /ent/v2/tasks
 * ???GET /ent/v2/tasks/{id}/creations
 * ?????viduq2 / viduq2-pro / viduq2-turbo / viduq3-pro
 */
async function callViduVideoApi(config, log, opts) {
  const { prompt, model, duration, aspect_ratio, resolution: resolutionOpt, image_url, video_gen_id, files_base_url, storage_local_path } = opts;
  const apiKey = config.api_key || '';
  const base = (config.base_url || 'https://api.vidu.cn').replace(/\/$/, '');
  const modelName = model || 'viduq2';
  const dur = Math.min(10, Math.max(1, Math.round(Number(duration) || 5)));
  const ratio = clampToViduAspectRatio(aspect_ratio || '16:9');
  const hasImage = !!(image_url && image_url.trim());
  const resolutionBody = pickViduResolutionParam(resolutionOpt, modelName, hasImage);

  // ?? api.vidu.cn: Token ??????: Bearer ??
  const isOfficialVidu = /api\.vidu\.cn/i.test(base);
  const authHeader = (isOfficialVidu ? 'Token ' : 'Bearer ') + apiKey;

  // ????????? /ent/v2/img2video ?????????
  const defaultEp = hasImage ? '/ent/v2/img2video' : '/ent/v2/text2video';
  let ep = config.endpoint || defaultEp;
  if (!ep.startsWith('/')) ep = '/' + ep;
  const url = base + ep;

  let effectivePrompt = (prompt || '').trim();

  log.info('[Vidu] task prepare', {
    video_gen_id,
    base_url: base,
    endpoint: ep,
    full_url: url,
    mode: hasImage ? 'img2video' : 'text2video',
    model: modelName,
    duration_sec: dur,
    aspect_ratio_effective: ratio,
    aspect_ratio_from_opts: aspect_ratio != null && aspect_ratio !== '' ? aspect_ratio : '(fallback 16:9)',
    resolution_body: resolutionBody,
    official_fields: 'aspect_ratio + resolution (Vidu ent/v2)',
    prompt_chars: effectivePrompt.length,
    has_image_url: hasImage,
    custom_endpoint: !!(config.endpoint && String(config.endpoint).trim()),
  });

  const body = {
    model: modelName,
    prompt: effectivePrompt,
    duration: dur,
    resolution: resolutionBody,
    aspect_ratio: ratio,
    movement_amplitude: 'auto',
    audio: false,
    off_peak: false,
    watermark: false,
  };
  if (!isOfficialVidu) {
    body.aspectRatio = ratio;
  }

  let publicImgUrl = null;
  if (hasImage) {
    const rawImgUrl = image_url.trim();
    let localImage = null;
    try { localImage = loadStorageImage(rawImgUrl, storage_local_path); } catch (_) {}
    if (localImage) {
      log.info('[Vidu] resolving storage reference image', { relative_path: localImage.relativePath, video_gen_id });
      publicImgUrl = await uploadLocalImageToProxy(storage_local_path, rawImgUrl, log, `vidu_vg${video_gen_id}`);
      if (publicImgUrl) {
        log.info('[Vidu] ????????', { proxy: publicImgUrl, video_gen_id });
      } else if (files_base_url) {
        publicImgUrl = publicUrlFromLocalRef(rawImgUrl, files_base_url);
        log.warn('[Vidu] ????????? files_base_url', { converted: publicImgUrl, video_gen_id });
      } else {
        log.warn('[Vidu] ???????? URL??????', { video_gen_id });
      }
    } else {
      try {
        publicImgUrl = (await uploadService.validatePublicHttpUrl(rawImgUrl)).url;
      } catch (error) {
        log.warn('[Vidu] rejected unsafe remote reference image', { error: error.message, video_gen_id });
      }
    }
    if (publicImgUrl) {
      let imageUrlForVidu = publicImgUrl;
      const dims = await probeViduReferenceImageSize(rawImgUrl, publicImgUrl, storage_local_path, log, video_gen_id);
      const tgtNum = parseViduAspectRatio(ratio);
      const relTol = 0.06;
      const aspectMismatch = !!(dims && tgtNum != null && viduImageAspectMismatchesTarget(dims.width, dims.height, ratio, relTol));
      if (!dims) {
        log.info('[Vidu] aspect check: skipped (could not read image dimensions)', { video_gen_id, target_ratio: ratio });
      } else {
        const imgR = dims.width / dims.height;
        const relDiff = tgtNum != null ? Math.abs(imgR - tgtNum) / Math.max(imgR, tgtNum, 0.01) : null;
        log.info('[Vidu] aspect check', {
          video_gen_id,
          image_px: `${dims.width}x${dims.height}`,
          image_wh_ratio: Number(imgR.toFixed(6)),
          target_ratio_str: ratio,
          target_wh_ratio: tgtNum != null ? Number(tgtNum.toFixed(6)) : null,
          rel_diff: relDiff != null ? Number(relDiff.toFixed(6)) : null,
          tolerance_rel: relTol,
          mismatch: aspectMismatch,
        });
      }

      // img2video 实际画幅跟参考图像素比例走；仅靠 aspect_ratio 字段与 prompt 不可靠 → 比例不一致时生成留白图再上传（原图文件不改）
      let usedLetterbox = false;
      if (aspectMismatch && viduLetterboxCanvasPixels(ratio)) {
        const srcBuf = await loadViduReferenceImageBuffer(rawImgUrl, publicImgUrl, storage_local_path, log, video_gen_id);
        if (srcBuf) {
          const lbBuf = await letterboxBufferToViduAspect(srcBuf, ratio, log, video_gen_id);
          if (lbBuf) {
            const lbUrl = await uploadToImageProxy(lbBuf, 'image/jpeg', log, `vidu_vg${video_gen_id}_ar`);
            if (lbUrl) {
              imageUrlForVidu = lbUrl;
              usedLetterbox = true;
              log.info('[Vidu] img2video will use letterboxed reference (target aspect)', { video_gen_id, target_ratio: ratio });
            } else {
              log.warn('[Vidu] letterbox upload failed, falling back to original image + prompt hint', { video_gen_id });
            }
          }
        }
      }

      if (aspectMismatch && !usedLetterbox) {
        const suffix = viduMismatchAspectPromptSuffix(ratio);
        const sep = '\n\n';
        let combined = effectivePrompt ? `${effectivePrompt}${sep}${suffix}` : suffix;
        const maxLen = 5000;
        if (combined.length > maxLen) {
          const room = maxLen - suffix.length - sep.length;
          const head = room > 0 && effectivePrompt ? effectivePrompt.slice(0, room) : '';
          combined = head ? `${head}${sep}${suffix}` : suffix.slice(0, maxLen);
        }
        effectivePrompt = combined;
        body.prompt = effectivePrompt;
        log.info('[Vidu] appended framing hint to prompt (mismatch, no letterbox)', {
          video_gen_id,
          image: dims ? `${dims.width}x${dims.height}` : '?',
          target_ratio: ratio,
          prompt_chars_after: effectivePrompt.length,
          suffix_chars: suffix.length,
        });
      } else if (dims && !aspectMismatch) {
        log.info('[Vidu] no letterbox / prompt suffix (reference aspect within tolerance of target)', { video_gen_id });
      } else if (aspectMismatch && usedLetterbox) {
        log.info('[Vidu] letterbox applied; skipping long framing prompt suffix', { video_gen_id });
      }

      body.images = [imageUrlForVidu];
      try {
        const u = new URL(imageUrlForVidu);
        log.info('[Vidu] reference image URL (for API)', {
          video_gen_id,
          host: u.host,
          pathname: u.pathname,
          search: u.search ? '(has query)' : '',
          letterboxed: usedLetterbox,
        });
      } catch (_) {
        log.info('[Vidu] reference image URL (for API, non-URL string)', {
          video_gen_id,
          head: imageUrlForVidu.length > 120 ? imageUrlForVidu.slice(0, 120) + '…' : imageUrlForVidu,
          letterboxed: usedLetterbox,
        });
      }
    } else {
      log.info('[Vidu] no public image URL after resolve; img2video body may be invalid', { video_gen_id, raw_was_localhost: /localhost|127\.0\.0\.1/i.test(image_url.trim()) });
    }
  }

  log.info('[Vidu] Video API request', {
    url, model: modelName, auth: isOfficialVidu ? 'Token' : 'Bearer',
    dur, has_image: !!body.images, video_gen_id,
    aspect_ratio_in_json: body.aspect_ratio,
    prompt_chars_final: (body.prompt || '').length,
  });
  logVideoPostRequest(log, 'Vidu', url, body, video_gen_id, { model: modelName, auth: isOfficialVidu ? 'Token' : 'Bearer' });

  const res = await fetchVideoWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  log.info('[Vidu] response summary', {
    status: res.status,
    video_gen_id,
    ...summarizeProviderResponse(raw),
  });

  if (!res.ok) {
    log.error('[Vidu] Video API failed', {
      status: res.status,
      video_gen_id,
      ...summarizeProviderResponse(raw),
    });
    return videoProviderFailure('Vidu', 'video request', res.status, raw);
  }

  let data;
  try { data = JSON.parse(raw); } catch (_) {
    return videoProviderFailure('Vidu', 'video response', res.status, raw);
  }

  const taskId = data?.task_id || data?.id;
  if (!taskId) {
    log.error('[Vidu] no task_id in response', { video_gen_id, ...summarizeProviderResponse(data) });
    return videoProviderFailure('Vidu', 'video response', res.status, data);
  }
  log.info('[Vidu] task created', {
    task_id: taskId,
    state: data?.state,
    video_gen_id,
    response_model: data?.model,
    response_aspect_ratio: data?.aspect_ratio,
    response_duration: data?.duration,
    response_resolution: data?.resolution,
    credits: data?.credits,
  });
  return { task_id: taskId, status: data?.state || 'created' };
}

module.exports = {
  callViduVideoApi,
};
