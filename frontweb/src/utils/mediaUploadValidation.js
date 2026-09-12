export const MEDIA_LIBRARY_MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024
export const MEDIA_LIBRARY_MAX_FILE_SIZE_LABEL = '100MB'

export function partitionMediaLibraryUploads(files, maxBytes = MEDIA_LIBRARY_MAX_FILE_SIZE_BYTES) {
  const accepted = []
  const oversized = []
  for (const file of Array.from(files || [])) {
    if (Number(file?.size) > maxBytes) oversized.push(file)
    else accepted.push(file)
  }
  return { accepted, oversized }
}

export function buildMediaLibraryUploadFeedback({
  succeeded = 0,
  failedNames = [],
  oversizedNames = [],
  acceptedCount = 0,
} = {}) {
  const failed = Array.isArray(failedNames) ? failedNames.filter(Boolean) : []
  const oversized = Array.isArray(oversizedNames) ? oversizedNames.filter(Boolean) : []
  const successCount = Number(succeeded) || 0
  const accepted = Number(acceptedCount) || failed.length + successCount
  const previewNames = [...failed, ...oversized].slice(0, 3)
  const extraCount = failed.length + oversized.length - previewNames.length
  const preview = previewNames.join('、') + (extraCount > 0 ? ' 等' : '')

  if (failed.length === 0 && oversized.length === 0) return null
  if (successCount === 0) {
    const parts = []
    if (failed.length) parts.push(`${failed.length} 个文件上传失败`)
    if (oversized.length) parts.push(`${oversized.length} 个文件超过 ${MEDIA_LIBRARY_MAX_FILE_SIZE_LABEL} 限制`)
    return {
      tone: 'error',
      title: '素材上传失败',
      detail: `${parts.join('，')}${preview ? `：${preview}` : ''}。这些文件没有写入素材库。`,
    }
  }
  const skipped = oversized.length ? `，另有 ${oversized.length} 个超限文件未开始上传` : ''
  return {
    tone: 'warning',
    title: '部分素材上传失败',
    detail: `已上传 ${successCount}/${accepted} 个可上传素材${skipped}。失败文件不会出现在素材库中${preview ? `：${preview}` : ''}。`,
  }
}
