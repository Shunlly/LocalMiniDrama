const VIDEO_EXTENSION = /\.(mp4|webm|mov)$/i

function cleanMediaPath(url) {
  return String(url || '').split(/[?#]/, 1)[0]
}

export function normalizeMediaItem(item = {}) {
  const url = item.url || item.image_url || item.video_url || ''
  const cleanPath = cleanMediaPath(url)
  const isVideo = item.type === 'video' || VIDEO_EXTENSION.test(cleanPath)

  return {
    ...item,
    type: isVideo ? 'video' : 'image',
    name: item.name || item.filename || cleanPath.split('/').pop() || '',
  }
}

export function formatMediaSize(size) {
  if (size == null || size === '') return ''
  const bytes = Number(size)
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes > 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
  if (bytes > 1024) return (bytes / 1024).toFixed(0) + ' KB'
  return bytes + ' B'
}

export function hasActiveMediaFilters(mediaType = 'all', keyword = '') {
  return mediaType !== 'all' || String(keyword).trim().length > 0
}

export function getVisibleSelectedMediaIds(selectedIds, visibleItems = []) {
  const selected = selectedIds instanceof Set ? selectedIds : new Set(selectedIds || [])
  const visibleIds = new Set(
    (Array.isArray(visibleItems) ? visibleItems : []).map((item) => item?.id),
  )
  return Array.from(selected).filter((id) => visibleIds.has(id))
}

export function mediaLibraryAccessState({
  loading = false,
  uploading = false,
  hasSuccessfulLoad = false,
  loadError = '',
  itemCount = 0,
} = {}) {
  return {
    navigationLocked: Boolean(uploading),
    showEntryStrip: Boolean(loading || loadError || Number(itemCount) > 0),
    writeLocked: Boolean(loading || !hasSuccessfulLoad || loadError),
  }
}

export function createLatestMediaRequestGuard() {
  let latestRequestId = 0

  return {
    begin() {
      latestRequestId += 1
      return latestRequestId
    },

    commit(requestId, update) {
      if (requestId !== latestRequestId) return false
      update()
      return true
    },
  }
}
