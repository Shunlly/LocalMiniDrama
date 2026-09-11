import {
  getMediaOriginLabel,
  getNetworkAssetCardImageUrl,
  getNetworkAssetPreviewUrl,
  getNetworkAssetImportability,
} from '@/utils/mediaLibrary.js'

export function mediaOriginLabel(item) {
  return getMediaOriginLabel(item)
}

export function networkItemKey(item, index = 0) {
  return item?.source_url || item?.download_url || `${item?.title || 'network'}-${index}`
}

export function networkItemTitle(item) {
  return item?.title?.trim() || '未命名网络素材'
}

export function normalizeNetworkSourceQuery(value) {
  const raw = Array.isArray(value) ? value[0] : value
  return raw === 'commons' || raw === 'openverse' || raw === 'all' ? raw : 'all'
}

export function isOpenversePreview(item) {
  return item?.source === 'openverse'
    || item?.source_provider === 'Openverse'
    || item?.source_metadata?.kind === 'openverse'
    || Boolean(item?.openverse_id)
}

export function networkItemSourceLabel(item) {
  if (!item) return '未知来源'
  if (item.source_site && (item.source === 'openverse' || item.source_provider === 'Openverse' || item.source_metadata?.kind === 'openverse')) {
    return `Openverse · ${item.source_site}`
  }
  return item.source_provider || item.source_site || (isOpenversePreview(item) ? 'Openverse' : 'Wikimedia Commons')
}

export function networkCardImageUrl(item) {
  if (item?.media_type === 'video') return String(item?.thumbnail_url || '').trim()
  return getNetworkAssetCardImageUrl(item)
}

export function networkPlaybackUrl(item) {
  return getNetworkAssetPreviewUrl(item)
}

export function networkDimensions(item) {
  return item?.width && item?.height ? `${item.width} × ${item.height}` : item?.media_type === 'video' ? '视频' : '图片'
}

export function networkItemImportability(item) {
  return getNetworkAssetImportability(item)
}

export function safeExternalUrl(value, requireHttps = false) {
  try {
    const url = new URL(value)
    if (url.username || url.password) return ''
    const allowed = requireHttps ? url.protocol === 'https:' : ['http:', 'https:'].includes(url.protocol)
    return allowed ? url.href : ''
  } catch (_) {
    return ''
  }
}

export function sourceEvidence(item, key) {
  if (!item || !key) return ''
  return item.source_metadata?.[key] ?? item[key] ?? ''
}

export function formatSourceTimestamp(value) {
  const timestamp = Date.parse(String(value || ''))
  if (!Number.isFinite(timestamp)) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(timestamp))
}

export function itemUrl(item) {
  if (!item) return ''
  const lp = item.local_path || item.image_local_path || item.video_local_path
  if (lp) return '/static/' + lp.replace(/^\//, '')
  return item.url || item.image_url || item.video_url || ''
}

export function accessibleItemName(item) {
  return item?.name?.trim() || '未命名素材'
}

export function thumbnailAlt(item) {
  return `素材缩略图：${accessibleItemName(item)}`
}

export function previewAlt(item) {
  return `素材预览图：${accessibleItemName(item)}`
}

export function videoPreviewLabel(item) {
  return `素材视频预览：${accessibleItemName(item)}`
}

export function actionLabel(action, item) {
  return `${action}素材：${accessibleItemName(item)}`
}

export function mediaSelectionLabel(item, selected) {
  return actionLabel(selected ? '取消选择' : '选择', item)
}

export function describeNetworkSearchAnnouncement({ loading, keyword, error, searched, count }) {
  if (loading) return `正在搜索：${String(keyword || '').trim()}`
  if (error) return `搜索失败：${error}`
  if (!searched) return '尚未执行网络素材搜索'
  return Number(count) > 0
    ? `搜索完成，找到 ${count} 项素材`
    : '搜索完成，没有找到匹配素材'
}
