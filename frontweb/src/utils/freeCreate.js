export const FREE_CREATE_VIDEO_ASPECT_RATIOS = Object.freeze(['16:9', '9:16', '1:1'])
export const FREE_CREATE_IMAGE_ASPECT_RATIOS = Object.freeze([...FREE_CREATE_VIDEO_ASPECT_RATIOS, '4:3'])

function nonEmpty(value) {
  return String(value || '').trim()
}

function aspectRatiosForMode(mode) {
  return mode === 'video'
    ? FREE_CREATE_VIDEO_ASPECT_RATIOS
    : FREE_CREATE_IMAGE_ASPECT_RATIOS
}

function toStaticMediaPath(value) {
  const raw = nonEmpty(value).replace(/\\/g, '/')
  if (!raw) return ''
  if (raw.startsWith('/static/')) {
    return `/static/${raw.slice('/static/'.length).replace(/^\/+/, '')}`
  }
  return `/static/${raw.replace(/^\/+/, '')}`
}

export function getFreeCreateAspectRatioOptions(mode = 'image') {
  return aspectRatiosForMode(mode).map((value) => ({ label: value, value }))
}

export function normalizeFreeCreateAspectRatio(mode = 'image', aspectRatio = '') {
  const normalized = nonEmpty(aspectRatio).replace(/\uFF1A/g, ':')
  const supported = aspectRatiosForMode(mode)
  return supported.includes(normalized) ? normalized : supported[0]
}

export function getReferenceUploadBlockReason(status, errorMessage, localPath) {
  if (status === 'uploading') return '参考图正在上传，请等待上传完成'
  if (status === 'error') return nonEmpty(errorMessage) || '参考图上传失败，请重试或移除'
  if (status === 'success' && !nonEmpty(localPath)) {
    return '参考图上传结果无效，请重试或移除'
  }
  return ''
}

export function buildFreeCreateGenerationPayload({
  mode = 'image',
  prompt,
  style,
  aspectRatio,
  duration,
  referenceUploadStatus = 'idle',
  referenceUploadError = '',
  referenceImageLocalPath = '',
}) {
  const normalizedMode = mode === 'video' ? 'video' : 'image'
  const uploadBlockReason = getReferenceUploadBlockReason(
    referenceUploadStatus,
    referenceUploadError,
    referenceImageLocalPath,
  )
  if (uploadBlockReason) throw new Error(uploadBlockReason)

  const body = {
    prompt: nonEmpty(prompt),
    aspect_ratio: normalizeFreeCreateAspectRatio(normalizedMode, aspectRatio),
  }
  const normalizedStyle = nonEmpty(style)
  if (normalizedStyle) body.style = normalizedStyle

  if (normalizedMode === 'video') {
    const normalizedDuration = Number(duration)
    if (Number.isFinite(normalizedDuration) && normalizedDuration > 0) {
      body.duration = normalizedDuration
    }
    if (referenceUploadStatus === 'success') {
      const localPath = toStaticMediaPath(referenceImageLocalPath)
      body.first_frame_url = localPath
      body.image_url = localPath
    }
  }
  return body
}
