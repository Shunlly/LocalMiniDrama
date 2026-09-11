/**
 * 全局素材选择弹窗的展示辅助：缩略图地址与卡片可访问名称。
 */

export function mediaPickerItemUrl(item) {
  if (!item) return ''
  if (item.local_path) return '/static/' + String(item.local_path).replace(/^\//, '')
  return item.url || item.image_url || item.video_url || ''
}

export function mediaPickerCardLabel(item, options = {}) {
  const source = options.originLabel || '未知来源'
  const state = options.compatible ? '可选' : (options.incompatibleReason || '不可选')
  return `${item?.name || '未命名素材'}，${item?.type === 'video' ? '视频' : '图片'}，来源 ${source}，${state}`
}
