/** 统一媒体 URL：优先 local_path，其次 image_url / video_url */
export function isPlaceholderMediaUrl(value) {
  const text = String(value || '').trim()
  return text.startsWith('mock://') || text.startsWith('placeholder://')
}

export function assetImageUrl(item) {
  if (!item) return ''
  const lp = item.local_path && String(item.local_path).trim()
  if (lp && !isPlaceholderMediaUrl(lp)) return '/static/' + lp.replace(/^\//, '')
  return isPlaceholderMediaUrl(item.image_url) ? '' : (item.image_url || '')
}

export function storyboardImageUrl(sb) {
  if (!sb) return ''
  return assetImageUrl(sb)
}

export function storyboardVideoUrl(sb) {
  if (!sb) return ''
  const lp = sb.video_local_path && String(sb.video_local_path).trim()
  if (lp && !isPlaceholderMediaUrl(lp)) return '/static/' + lp.replace(/^\//, '')
  return isPlaceholderMediaUrl(sb.video_url) ? '' : (sb.video_url || '')
}

export function audioUrl(localPath) {
  if (!localPath) return ''
  const p = String(localPath).trim()
  if (!p) return ''
  if (isPlaceholderMediaUrl(p)) return ''
  return '/static/' + p.replace(/^\//, '')
}
