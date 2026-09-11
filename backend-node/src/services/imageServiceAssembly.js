/**
 * 图片查询结果装配：把数据库行转成接口对象，并提供纯映射辅助。
 * 路由仍通过 imageService 调用，本模块不改变公开 API。
 */

const LAST_FRAME_TYPES = new Set(['last', 'storyboard_last', 'tail', 'last_frame']);

function rowToItem(r) {
  return {
    id: r.id,
    storyboard_id: r.storyboard_id,
    drama_id: r.drama_id,
    scene_id: r.scene_id ?? undefined,
    character_id: r.character_id,
    provider: r.provider,
    prompt: r.prompt,
    model: r.model,
    image_url: r.image_url,
    local_path: r.local_path,
    status: r.status,
    task_id: r.task_id,
    error_msg: r.error_msg,
    frame_type: r.frame_type ?? undefined,
    created_at: r.created_at,
    updated_at: r.updated_at,
    completed_at: r.completed_at,
  };
}

/**
 * 将 aspect_ratio（如 "9:16"）转换为图片生成 size 字符串（如 "720*1280"）
 * DashScope/Wan 用 W*H 格式，OpenAI 用 WxH 格式；统一返回 W*H，callDashScopeImageApi 内部会调 dashScopeSize 做最终校验
 */
function aspectRatioToSize(aspectRatio) {
  // 统一用 WxH（小写 x）格式：DashScope 的 dashScopeSize() 会把 x 转成 * 并自动缩放
  // 各尺寸均 >= 3,686,400 像素，满足 ChatFire/OpenAI 兼容接口的最低像素要求
  const map = {
    '16:9':  '2560x1440',
    '9:16':  '1440x2560',
    '1:1':   '1920x1920',
    '4:3':   '2240x1680',
    '3:4':   '1680x2240',
    '21:9':  '2940x1260',
  };
  return map[aspectRatio] || null;
}

/** 解析 image_generations.size / aspectRatioToSize 结果，如 2560x1440 */
function parseTargetPixelsFromSizeString(sizeStr) {
  if (!sizeStr || typeof sizeStr !== 'string') return null;
  const m = String(sizeStr).trim().toLowerCase().replace(/\s/g, '').match(/^(\d+)[x*](\d+)$/);
  if (!m) return null;
  const w = parseInt(m[1], 10);
  const h = parseInt(m[2], 10);
  if (!w || !h) return null;
  return { w, h };
}

function mergePromptWithStyle(prompt, style) {
  const base = (prompt || '').toString().trim();
  const styleText = (style || '').toString().trim();
  if (!styleText) return base;
  if (!base) return styleText;
  const lowerBase = base.toLowerCase();
  const lowerStyle = styleText.toLowerCase();
  if (lowerBase.includes(lowerStyle)) return base;
  return base + ', ' + styleText;
}

function isUsableProviderReference(value) {
  const text = String(value || '').trim();
  return !!text && !/^(?:mock|placeholder):\/\//i.test(text);
}

function isLastFrameType(frameType) {
  if (frameType == null || frameType === '') return false;
  return LAST_FRAME_TYPES.has(String(frameType).toLowerCase());
}

/** 创建记录时：仅尾帧写入 use_first_frame_layout_lock；默认 1（注入首帧站位参考） */
function resolveUseFirstFrameLayoutLock(req, frameType) {
  if (!isLastFrameType(frameType)) return null;
  const v = req?.use_first_frame_layout_lock;
  if (v === false || v === 0 || v === '0') return 0;
  if (v === true || v === 1 || v === '1') return 1;
  return 1;
}

/** 处理任务时：尾帧且未显式关闭则启用首帧站位锁 */
function rowUseFirstFrameLayoutLock(row) {
  if (!row || !isLastFrameType(row.frame_type)) return false;
  const v = row.use_first_frame_layout_lock;
  if (v === 0 || v === false) return false;
  return true;
}

module.exports = {
  rowToItem,
  aspectRatioToSize,
  parseTargetPixelsFromSizeString,
  mergePromptWithStyle,
  isUsableProviderReference,
  isLastFrameType,
  resolveUseFirstFrameLayoutLock,
  rowUseFirstFrameLayoutLock,
};