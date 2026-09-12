/**
 * 视频查询结果装配：把数据库行转成接口对象，并提供纯像素映射。
 * 路由仍通过 videoService 调用，本模块不改变公开 API。
 */

function parseReferenceImageUrls(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    if (Array.isArray(parsed)) return parsed;
  } catch (_) {}
  return [];
}

function rowToItem(r) {
  return {
    id: r.id,
    storyboard_id: r.storyboard_id,
    drama_id: r.drama_id,
    provider: r.provider,
    prompt: r.prompt,
    model: r.model,
    image_gen_id: r.image_gen_id,
    image_url: r.image_url,
    first_frame_url: r.first_frame_url ?? null,
    last_frame_url: r.last_frame_url ?? null,
    reference_image_urls: parseReferenceImageUrls(r.reference_image_urls),
    video_url: r.video_url,
    local_path: r.local_path,
    status: r.status,
    task_id: r.task_id,
    provider_task_id: r.provider_task_id,
    idempotency_key: r.idempotency_key,
    error_msg: r.error_msg,
    created_at: r.created_at,
    updated_at: r.updated_at,
    completed_at: r.completed_at,
  };
}

/** 与图生 aspectRatioToSize 对齐的归一化分辨率（偶数像素，便于 H.264） */
function targetVideoPixelsForAspect(aspectRatio, resolution) {
  const r = String(aspectRatio || '16:9').trim();
  const resolutionMatch = String(resolution || '').trim().match(/^(\d{3,4})p$/i);
  if (resolutionMatch) {
    const shortEdge = Math.min(2160, Math.max(144, Number(resolutionMatch[1])));
    const ratioMatch = r.match(/^(\d+)\s*:\s*(\d+)$/);
    const widthRatio = ratioMatch ? Number(ratioMatch[1]) : 16;
    const heightRatio = ratioMatch ? Number(ratioMatch[2]) : 9;
    if (widthRatio > 0 && heightRatio > 0) {
      if (widthRatio >= heightRatio) {
        return {
          w: Math.max(2, Math.round((shortEdge * widthRatio) / heightRatio / 2) * 2),
          h: Math.max(2, Math.round(shortEdge / 2) * 2),
        };
      }
      return {
        w: Math.max(2, Math.round(shortEdge / 2) * 2),
        h: Math.max(2, Math.round((shortEdge * heightRatio) / widthRatio / 2) * 2),
      };
    }
  }
  const map = {
    '16:9': { w: 2560, h: 1440 },
    '9:16': { w: 1440, h: 2560 },
    '1:1': { w: 1920, h: 1920 },
    '4:3': { w: 1920, h: 1440 },
    '3:4': { w: 1440, h: 1920 },
    '3:2': { w: 2560, h: 1708 },
    '2:3': { w: 1708, h: 2560 },
    '21:9': { w: 2560, h: 1080 },
  };
  if (map[r]) return map[r];
  const m = r.match(/^(\d+)\s*:\s*(\d+)$/);
  if (m) {
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    if (a > 0 && b > 0 && a !== b) {
      if (a > b) {
        const w = 2560;
        const h = Math.max(2, Math.round((w * b) / a / 2) * 2);
        return { w, h };
      }
      const h = 2560;
      const w = Math.max(2, Math.round((h * a) / b / 2) * 2);
      return { w, h };
    }
  }
  return { w: 1280, h: 720 };
}

module.exports = {
  parseReferenceImageUrls,
  rowToItem,
  targetVideoPixelsForAspect,
};
