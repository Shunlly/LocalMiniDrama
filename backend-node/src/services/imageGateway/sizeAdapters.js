'use strict';

// 各厂商对 size / 宽高比的本地映射，不发起真实请求。

// 通义万象 size：格式 "宽*高"，总像素须在 589824(768*768)～1638400(1280*1280) 之间
const DASHSCOPE_MIN_PIXELS = 589824;
const DASHSCOPE_MAX_PIXELS = 1638400;

// 火山引擎 Doubao-Seedream-4.5 最低像素要求 3,686,400 (1920*1920)
// 需要自动将低分辨率请求放大到该标准，保持长宽比
const SEEDREAM_MIN_PIXELS = 3686400;

function fixSeedreamSize(size) {
  if (!size || typeof size !== 'string') return '1920x1920'; // 默认使用最低要求 1920x1920
  // 支持 1024x1024 或 1024*1024 格式，统一解析
  const s = size.trim().toLowerCase().replace(/\*/g, 'x');
  const match = s.match(/^(\d+)\s*x\s*(\d+)$/);
  if (!match) return '1920x1920';
  
  let w = parseInt(match[1], 10);
  let h = parseInt(match[2], 10);
  if (!w || !h) return '1920x1920';
  
  const pixels = w * h;
  if (pixels >= SEEDREAM_MIN_PIXELS) return `${w}x${h}`; // 已达标，直接用
  
  // 需要放大
  const scale = Math.sqrt(SEEDREAM_MIN_PIXELS / pixels);
  // 向上取整到 64 的倍数（通常 AI 模型对 64/32/16 对齐有偏好，这里取 64 较稳妥）
  w = Math.ceil((w * scale) / 64) * 64;
  h = Math.ceil((h * scale) / 64) * 64;
  
  // 二次检查是否因为取整导致略小于标准（虽然 ceil 应该不会，但为了保险）
  if (w * h < SEEDREAM_MIN_PIXELS) {
    w += 64;
    h += 64;
  }
  
  return `${w}x${h}`;
}

/** Agnes Image 2.x 官方常用尺寸（过大如 1440x2560 会导致上游 do_request_failed） */
const AGNES_IMAGE_SIZE_BY_RATIO = {
  '16:9': '1792x1024',
  '9:16': '1024x1792',
  '1:1': '1024x1024',
  '4:3': '1024x768',
  '3:4': '768x1024',
  '21:9': '1792x1024',
};

function isAgnesImageConfig(config, model) {
  const p = String(config?.provider || '').toLowerCase();
  const m = String(model || '').toLowerCase();
  const base = String(config?.base_url || '').toLowerCase();
  return p === 'agnes' || /agnes-image/.test(m) || /apihub\.agnes-ai\.com/.test(base);
}

/** 将项目内高分辨率 size 映射为 Agnes 支持的尺寸，保持宽高比类别 */
function fixAgnesImageSize(size) {
  if (!size || typeof size !== 'string') return AGNES_IMAGE_SIZE_BY_RATIO['4:3'];
  const s = size.trim().toLowerCase().replace(/\*/g, 'x');
  const match = s.match(/^(\d+)\s*x\s*(\d+)$/);
  if (!match) return AGNES_IMAGE_SIZE_BY_RATIO['4:3'];
  const w = parseInt(match[1], 10);
  const h = parseInt(match[2], 10);
  if (!w || !h) return AGNES_IMAGE_SIZE_BY_RATIO['4:3'];
  const mapped = AGNES_IMAGE_SIZE_BY_RATIO['16:9'];
  const ratio = w / h;
  const candidates = Object.entries(AGNES_IMAGE_SIZE_BY_RATIO).map(([label, sz]) => {
    const [rw, rh] = sz.split('x').map(Number);
    return { label, sz, r: rw / rh };
  });
  let best = mapped;
  let bestDiff = Infinity;
  for (const c of candidates) {
    const diff = Math.abs(Math.log(ratio) - Math.log(c.r));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = c.sz;
    }
  }
  return best;
}

function dashScopeSize(size) {
  if (!size || typeof size !== 'string') return '1280*1280';
  const s = String(size).trim().toLowerCase().replace(/x/g, '*');
  const match = s.match(/^(\d+)\s*\*\s*(\d+)$/);
  if (!match) return '1280*1280';
  let w = parseInt(match[1], 10);
  let h = parseInt(match[2], 10);
  if (!w || !h) return '1280*1280';
  let pixels = w * h;
  if (pixels <= DASHSCOPE_MAX_PIXELS && pixels >= DASHSCOPE_MIN_PIXELS) return `${w}*${h}`;
  if (pixels > DASHSCOPE_MAX_PIXELS) {
    const scale = Math.sqrt(DASHSCOPE_MAX_PIXELS / pixels);
    w = Math.max(16, Math.round((w * scale) / 16) * 16);
    h = Math.max(16, Math.round((h * scale) / 16) * 16);
    if (w * h > DASHSCOPE_MAX_PIXELS) {
      w = Math.min(w, 1280);
      h = Math.min(h, Math.floor(DASHSCOPE_MAX_PIXELS / w));
      h = Math.floor(h / 16) * 16;
    }
    return `${w}*${h}`;
  }
  const scale = Math.sqrt(DASHSCOPE_MIN_PIXELS / pixels);
  w = Math.max(384, Math.round((w * scale) / 16) * 16);
  h = Math.max(384, Math.round((h * scale) / 16) * 16);
  return `${w}*${h}`;
}


// Gemini 支持的宽高比标签 → 数值 w/h（与 API 一致）
const GEMINI_ASPECT_NUMERIC = [
  ['21:9', 21 / 9],
  ['16:9', 16 / 9],
  ['3:2', 3 / 2],
  ['4:3', 4 / 3],
  ['5:4', 5 / 4],
  ['1:1', 1],
  ['4:5', 4 / 5],
  ['3:4', 3 / 4],
  ['2:3', 2 / 3],
  ['9:16', 9 / 16],
];

/** 按像素尺寸选最接近的 Gemini aspectRatio（对数距离，避免 1440×2560 被误判为 4:5） */
function closestGeminiAspectRatioFromPixels(w, h) {
  if (!w || !h) return '1:1';
  const r = w / h;
  let best = '1:1';
  let bestD = Infinity;
  for (const [label, tr] of GEMINI_ASPECT_NUMERIC) {
    const d = Math.abs(Math.log(r) - Math.log(tr));
    if (d < bestD) {
      bestD = d;
      best = label;
    }
  }
  return best;
}

// Gemini 图片生成支持的比例：1:1 / 16:9 / 9:16 / 4:3 / 3:4 / 3:2 / 2:3 / 5:4 / 4:5 / 21:9
function geminiAspectRatio(size) {
  if (!size || typeof size !== 'string') return '16:9';
  const s = String(size).trim().toLowerCase().replace(/\s/g, '');
  const ratioSet = new Set(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9']);
  if (ratioSet.has(s)) return s;
  const match = s.match(/^(\d+)[x*](\d+)$/);
  if (!match) return '1:1';
  const w = parseInt(match[1], 10);
  const h = parseInt(match[2], 10);
  return closestGeminiAspectRatioFromPixels(w, h);
}

function parseSizeWxHForGemini(size) {
  const match = String(size || '').trim().toLowerCase().replace(/\s/g, '').match(/^(\d+)[x*](\d+)$/);
  if (!match) return null;
  const w = parseInt(match[1], 10);
  const h = parseInt(match[2], 10);
  if (!w || !h) return null;
  return { w, h };
}

/**
 * Google 官方 REST：宽高比在 generationConfig.imageConfig.aspectRatio（不是顶层 aspectRatio）。
 * 顶层字段会被忽略 → 行为变为「匹配参考图尺寸」或近 1:1；参考图多为横屏四视图时成片易为横屏，
 * 再在本地 contain 到 9:16 就会出现上下黑边。
 * imageSize（1K/2K/4K）见官方文档，仅 gemini-3.x 图生模型支持；2.5 不传。
 */
function buildGeminiImageConfig(aspectRatio, modelName, size) {
  const imageConfig = { aspectRatio };
  const m = String(modelName || '').toLowerCase();
  const supportsImageSize =
    m.includes('gemini-3') || m.includes('3.1-flash-image') || m.includes('3-pro-image');
  if (supportsImageSize) {
    const px = parseSizeWxHForGemini(size);
    const longEdge = px ? Math.max(px.w, px.h) : 0;
    // 与项目里常见 1440/2560 档位对齐用 2K；仅小尺寸用 1K（避免默认 4K token 暴涨）
    imageConfig.imageSize = longEdge >= 1200 ? '2K' : '1K';
  }
  return imageConfig;
}

// nano-banana size 转 aspectRatio（1:1 / 16:9 / 9:16 / 4:3 / 3:4 / 3:2 / 2:3 / 5:4 / 4:5 / 21:9 / auto）
function nanoBananaAspectRatio(size) {
  if (!size || typeof size !== 'string') return 'auto';
  const s = String(size).trim().toLowerCase().replace(/\s/g, '');
  const ratioSet = new Set(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9']);
  if (ratioSet.has(s)) return s;
  const match = s.match(/^(\d+)[x*](\d+)$/);
  if (!match) return 'auto';
  const w = parseInt(match[1], 10);
  const h = parseInt(match[2], 10);
  if (!w || !h) return 'auto';
  return closestGeminiAspectRatioFromPixels(w, h);
}

// 可灵 aspect_ratio：16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 3:2 / 2:3
function klingImageAspectRatio(size) {
  if (!size) return '16:9';
  const s = String(size).trim().toLowerCase().replace(/\s/g, '');
  const ratioSet = new Set(['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3']);
  if (ratioSet.has(s)) return s;
  const match = s.match(/^(\d+)[x*](\d+)$/);
  if (!match) return '1:1';
  const w = parseInt(match[1], 10);
  const h = parseInt(match[2], 10);
  if (!w || !h) return '1:1';
  const r = w / h;
  if (r >= 1.6) return '16:9';
  if (r >= 1.2) return '4:3';
  if (r >= 0.9) return '1:1';
  if (r >= 0.7) return '3:4';
  return '9:16';
}

// 通义千问 qwen-image 同步接口：仅支持单条 text，不支持参考图；parameters 仅 size/negative_prompt/prompt_extend/watermark
function isQwenImageProvider(config, model) {
  const p = (config.provider || '').toLowerCase();
  const m = (model || '').toLowerCase();
  return p === 'qwen_image' || /^qwen-image/.test(m);
}

// qwen-image 仅支持以下 size：1664*928(16:9), 1472*1104(4:3), 1328*1328(1:1), 1104*1472(3:4), 928*1664(9:16)
function qwenImageSize(size) {
  const allowed = ['1664*928', '1472*1104', '1328*1328', '1104*1472', '928*1664'];
  if (!size || typeof size !== 'string') return '1664*928';
  const s = String(size).trim().toLowerCase().replace(/x/g, '*');
  const match = s.match(/^(\d+)\s*\*\s*(\d+)$/);
  if (!match) return '1664*928';
  const w = parseInt(match[1], 10);
  const h = parseInt(match[2], 10);
  if (!w || !h) return '1664*928';
  const ratio = w / h;
  if (ratio >= 1.7) return '1664*928';   // 16:9
  if (ratio >= 1.2) return '1472*1104';   // 4:3
  if (ratio >= 0.85) return '1328*1328';  // 1:1
  if (ratio >= 0.65) return '1104*1472';  // 3:4
  return '928*1664';                      // 9:16
}

module.exports = {
  fixSeedreamSize,
  isAgnesImageConfig,
  fixAgnesImageSize,
  dashScopeSize,
  closestGeminiAspectRatioFromPixels,
  geminiAspectRatio,
  parseSizeWxHForGemini,
  buildGeminiImageConfig,
  nanoBananaAspectRatio,
  klingImageAspectRatio,
  isQwenImageProvider,
  qwenImageSize,
};
