/** 自由画布转为制作参考/主媒体 */
export const FREE_CONVERSION_TYPES = Object.freeze([
  'character',
  'scene',
  'prop',
  'storyboard-image',
  'storyboard-video',
  'storyboard',
])

const TARGET_KEY = /^(character|scene|prop|storyboard-image|storyboard-video|storyboard):(\d+)$/

export function parseFreeConversionTargetKey(value) {
  const match = TARGET_KEY.exec(String(value || ''))
  if (!match) return null
  return { type: match[1], id: Number(match[2]) }
}

export function describeFreeConversionOperation({ mediaReference, isVideo, targetType }) {
  if (!mediaReference) return '追加到目标描述'
  if (targetType === 'storyboard-image') return '设为分镜主图，会覆盖当前主图'
  if (targetType === 'storyboard-video') return '设为分镜视频，会覆盖当前视频'
  if (targetType === 'storyboard') return '追加为分镜参考图'
  return '覆盖目标的参考图'
}

export function buildStoryboardPrimaryMediaPatch(mediaPath, kind) {
  const path = String(mediaPath || '').trim()
  if (!path) return null
  if (kind === 'video') {
    return {
      video_url: `/static/${path}`,
      video_local_path: path,
    }
  }
  return {
    image_url: `/static/${path}`,
    local_path: path,
  }
}

export function validateFreeConversionMedia({ mediaReference, isVideo, targetType }) {
  if (targetType === 'storyboard-image') {
    if (!mediaReference) return '设为分镜主图需要本地图片'
    if (isVideo) return '视频节点不能设为分镜主图，请改选分镜视频'
    return ''
  }
  if (targetType === 'storyboard-video') {
    if (!mediaReference) return '设为分镜视频需要本地视频'
    if (!isVideo) return '图片节点不能设为分镜视频，请改选分镜主图或参考图'
    return ''
  }
  if (isVideo && targetType !== 'storyboard' && mediaReference) {
    return '角色、场景和道具参考只接受图片，请先把视频存为素材'
  }
  if (isVideo && targetType === 'storyboard' && mediaReference) {
    return '分镜参考图只接受图片素材，视频请选择分镜视频'
  }
  if (!mediaReference && !['character', 'scene', 'prop', 'storyboard'].includes(targetType)) {
    return '当前节点没有可转换的文本或本地素材'
  }
  return ''
}
