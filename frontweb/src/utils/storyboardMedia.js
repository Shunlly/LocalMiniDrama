import { assetImageUrl, isPlaceholderMediaUrl } from './mediaUrl.js'
import { parseDramaMetadata } from './canvasLayout.js'

const STORYBOARD_MEDIA_ENDPOINTS = ['images', 'videos']
const STORYBOARD_MEDIA_STATE_ERROR = 'STORYBOARD_MEDIA_NOT_READY'

function normalizeMediaContext(context = {}) {
  const normalizeId = (value) => {
    if (value == null || value === '') return null
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : value
  }
  return {
    projectId: normalizeId(context.projectId),
    episodeId: normalizeId(context.episodeId),
  }
}

function normalizeStoryboardId(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : value
}

function sameMediaContext(left, right) {
  const normalizedLeft = normalizeMediaContext(left)
  const normalizedRight = normalizeMediaContext(right)
  return normalizedLeft.projectId === normalizedRight.projectId
    && normalizedLeft.episodeId === normalizedRight.episodeId
}

function endpointKey(storyboardId, endpoint) {
  return `${endpoint}:${String(storyboardId)}`
}

function sortedEndpointRecords(keys, records) {
  const endpointOrder = new Map(STORYBOARD_MEDIA_ENDPOINTS.map((endpoint, index) => [endpoint, index]))
  return [...keys]
    .map((key) => records.get(key))
    .filter(Boolean)
    .sort((left, right) => {
      const leftId = Number(left.storyboardId)
      const rightId = Number(right.storyboardId)
      if (Number.isFinite(leftId) && Number.isFinite(rightId) && leftId !== rightId) {
        return leftId - rightId
      }
      const idComparison = String(left.storyboardId).localeCompare(String(right.storyboardId))
      if (idComparison !== 0) return idComparison
      return endpointOrder.get(left.endpoint) - endpointOrder.get(right.endpoint)
    })
    .map(({ storyboardId, endpoint }) => ({ storyboardId, endpoint }))
}

function createStoryboardMediaStateError(message) {
  const error = new Error(message)
  error.code = STORYBOARD_MEDIA_STATE_ERROR
  return error
}

export function isStoryboardMediaStateError(error) {
  return error?.code === STORYBOARD_MEDIA_STATE_ERROR
}

export function createStoryboardMediaStateController({ onChange = () => {} } = {}) {
  let context = normalizeMediaContext()
  let contextGeneration = 0
  let requestGeneration = 0
  let initialized = false
  let media = { images: {}, videos: {} }
  let endpointRecords = new Map()
  let latestRequests = new Map()
  let pendingEndpoints = new Set()
  let failedEndpoints = new Set()

  function status() {
    if (pendingEndpoints.size > 0) return 'loading'
    if (failedEndpoints.size > 0) return 'error'
    return initialized ? 'ready' : 'unknown'
  }

  function getSnapshot() {
    return {
      context: { ...context },
      status: status(),
      initialized,
      media: {
        images: { ...media.images },
        videos: { ...media.videos },
      },
      pendingEndpoints: sortedEndpointRecords(pendingEndpoints, endpointRecords),
      failedEndpoints: sortedEndpointRecords(failedEndpoints, endpointRecords),
    }
  }

  function emitChange() {
    onChange(getSnapshot())
  }

  function createRequest(storyboardId, endpoint) {
    const normalizedStoryboardId = normalizeStoryboardId(storyboardId)
    const key = endpointKey(normalizedStoryboardId, endpoint)
    requestGeneration += 1
    const request = {
      projectId: context.projectId,
      episodeId: context.episodeId,
      storyboardId: normalizedStoryboardId,
      endpoint,
      contextGeneration,
      requestGeneration,
    }
    endpointRecords.set(key, { storyboardId: normalizedStoryboardId, endpoint })
    latestRequests.set(key, requestGeneration)
    pendingEndpoints.add(key)
    return request
  }

  function isCurrentRequest(request) {
    if (!request || request.contextGeneration !== contextGeneration) return false
    if (!sameMediaContext(request, context)) return false
    const key = endpointKey(request.storyboardId, request.endpoint)
    return latestRequests.get(key) === request.requestGeneration
  }

  function setContext(nextContext) {
    contextGeneration += 1
    context = normalizeMediaContext(nextContext)
    initialized = false
    media = { images: {}, videos: {} }
    endpointRecords = new Map()
    latestRequests = new Map()
    pendingEndpoints = new Set()
    failedEndpoints = new Set()
    emitChange()
  }

  function beginFull(storyboardIds = []) {
    const ids = [...new Set((storyboardIds || []).map(normalizeStoryboardId))]
    const retainedImages = {}
    const retainedVideos = {}
    for (const storyboardId of ids) {
      if (Object.hasOwn(media.images, storyboardId)) retainedImages[storyboardId] = media.images[storyboardId]
      if (Object.hasOwn(media.videos, storyboardId)) retainedVideos[storyboardId] = media.videos[storyboardId]
    }
    media = { images: retainedImages, videos: retainedVideos }

    const previousFailures = failedEndpoints
    endpointRecords = new Map()
    latestRequests = new Map()
    pendingEndpoints = new Set()
    failedEndpoints = new Set()
    initialized = true

    const requests = []
    for (const storyboardId of ids) {
      for (const endpoint of STORYBOARD_MEDIA_ENDPOINTS) {
        const key = endpointKey(storyboardId, endpoint)
        if (previousFailures.has(key)) failedEndpoints.add(key)
        requests.push(createRequest(storyboardId, endpoint))
      }
    }
    emitChange()
    return requests
  }

  function beginSingle(storyboardId, { expectedContext, storyboardIds } = {}) {
    const normalizedStoryboardId = normalizeStoryboardId(storyboardId)
    const allowedStoryboardIds = new Set((storyboardIds || []).map(normalizeStoryboardId))
    if (
      storyboardId == null
      || storyboardId === ''
      || !sameMediaContext(context, expectedContext)
      || !allowedStoryboardIds.has(normalizedStoryboardId)
    ) return []
    const requests = STORYBOARD_MEDIA_ENDPOINTS.map((endpoint) => (
      createRequest(normalizedStoryboardId, endpoint)
    ))
    emitChange()
    return requests
  }

  function commitSuccess(request, items) {
    if (!isCurrentRequest(request)) return false
    const key = endpointKey(request.storyboardId, request.endpoint)
    media = {
      ...media,
      [request.endpoint]: {
        ...media[request.endpoint],
        [request.storyboardId]: Array.isArray(items) ? items : [],
      },
    }
    pendingEndpoints.delete(key)
    failedEndpoints.delete(key)
    emitChange()
    return true
  }

  function commitFailure(request) {
    if (!isCurrentRequest(request)) return false
    const key = endpointKey(request.storyboardId, request.endpoint)
    pendingEndpoints.delete(key)
    failedEndpoints.add(key)
    emitChange()
    return true
  }

  function actionReason(expectedContext = context) {
    if (!sameMediaContext(context, expectedContext)) {
      return '分镜图片和视频状态尚未就绪，请先重试加载素材'
    }
    const currentStatus = status()
    if (currentStatus === 'loading') return '正在读取分镜图片和视频，请稍候'
    if (currentStatus === 'error') return '分镜图片或视频读取失败，请先重试加载素材'
    if (currentStatus !== 'ready') return '分镜图片和视频状态尚未就绪，请先重试加载素材'
    return ''
  }

  function assertReady(expectedContext = context, { required = true } = {}) {
    if (!required) return true
    const reason = actionReason(expectedContext)
    if (reason) throw createStoryboardMediaStateError(reason)
    return true
  }

  return {
    actionReason,
    assertReady,
    beginFull,
    beginSingle,
    commitFailure,
    commitSuccess,
    getSnapshot,
    isCurrentRequest,
    isCurrentContext: (expectedContext) => sameMediaContext(context, expectedContext),
    setContext,
  }
}

export async function submitStoryboardVideoAfterAccepted({
  createVideo,
  clearSelection = () => {},
  clearPersistedSelection = () => {},
} = {}) {
  const result = await createVideo()
  clearSelection()
  await clearPersistedSelection()
  return result
}

export function dramaUsesFirstLastFrame(drama) {
  const meta = parseDramaMetadata(drama?.metadata)
  return !!meta.storyboard_use_first_last_frame
}

function isHttpVideoUrl(url) {
  if (!url || typeof url !== 'string') return false
  const t = url.trim()
  return t.startsWith('http://') || t.startsWith('https://')
}

export function hasRealMediaValue(value) {
  return !!String(value || '').trim() && !isPlaceholderMediaUrl(value)
}

function isCompletedImage(i) {
  return i?.status === 'completed'
    && i.frame_type !== 'quad_grid'
    && i.frame_type !== 'nine_grid'
    && (hasRealMediaValue(i.image_url) || hasRealMediaValue(i.local_path))
}

export function samePositiveId(left, right) {
  if (left == null || right == null || left === '' || right === '') return false
  const a = Number(left)
  const b = Number(right)
  if (Number.isSafeInteger(a) && Number.isSafeInteger(b) && a > 0 && b > 0) return a === b
  return String(left) === String(right)
}

export function lookupByStoryboardId(collection, storyboardId) {
  if (!collection || typeof collection !== 'object') return undefined
  if (Object.prototype.hasOwnProperty.call(collection, storyboardId)) return collection[storyboardId]
  const numeric = Number(storyboardId)
  if (Number.isSafeInteger(numeric) && numeric > 0) {
    if (Object.prototype.hasOwnProperty.call(collection, numeric)) return collection[numeric]
    if (Object.prototype.hasOwnProperty.call(collection, String(numeric))) return collection[String(numeric)]
  }
  return undefined
}

export function getSbImagesList(imagesBySbId, storyboardId) {
  const list = lookupByStoryboardId(imagesBySbId, storyboardId)
  return Array.isArray(list) ? list.filter(isCompletedImage) : []
}

export function getSbVideosList(videosBySbId, storyboardId) {
  const list = lookupByStoryboardId(videosBySbId, storyboardId)
  if (!Array.isArray(list)) return []
  return list.filter((v) => v.status === 'completed' && (hasRealMediaValue(v.local_path) || (hasRealMediaValue(v.video_url) && isHttpVideoUrl(v.video_url))))
}

/** 首帧图记录（与 FilmCreate.getSbFirstImage 一致） */
export function resolveSbFirstImageRecord(sb, imagesBySbId) {
  if (!sb) return null
  const images = getSbImagesList(imagesBySbId, sb.id)
  if (sb.first_frame_image_id != null) {
    const bound = images.find((i) => samePositiveId(i.id, sb.first_frame_image_id))
    if (bound) return bound
  }
  const typed = images.find((i) => i.frame_type === 'storyboard_first')
  if (typed) return typed
  if (hasRealMediaValue(sb.local_path) || hasRealMediaValue(sb.image_url)) {
    return {
      id: sb.first_frame_image_id,
      image_url: sb.image_url,
      local_path: sb.local_path,
      frame_type: 'storyboard_first',
    }
  }
  return null
}

/** 尾帧图记录（与 FilmCreate.getSbLastImage 一致） */
export function resolveSbLastImageRecord(sb, imagesBySbId) {
  if (!sb) return null
  const images = getSbImagesList(imagesBySbId, sb.id)
  if (sb.last_frame_image_id != null) {
    const bound = images.find((i) => samePositiveId(i.id, sb.last_frame_image_id))
    if (bound) return bound
  }
  const typed = images.find((i) => i.frame_type === 'storyboard_last')
  if (typed) return typed
  if (hasRealMediaValue(sb.last_frame_image_url) || hasRealMediaValue(sb.last_frame_local_path)) {
    return {
      id: sb.last_frame_image_id,
      image_url: sb.last_frame_image_url,
      local_path: sb.last_frame_local_path,
      frame_type: 'storyboard_last',
    }
  }
  return null
}

/** 经典单图模式主图 */
export function resolveSbMainImageRecord(sb, imagesBySbId) {
  if (!sb) return null
  const images = getSbImagesList(imagesBySbId, sb.id)
  if (sb.first_frame_image_id != null) {
    const bound = images.find((image) => Number(image.id) === Number(sb.first_frame_image_id))
    if (bound) return bound
  }
  if (images.length) return images[0]
  if (hasRealMediaValue(sb.local_path) || hasRealMediaValue(sb.image_url)) {
    return { image_url: sb.image_url, local_path: sb.local_path }
  }
  return null
}

export function imageRecordUrl(record) {
  return assetImageUrl(record)
}

/** 当前分镜视频（优先匹配 storyboard.video_url） */
export function resolveSbVideoRecord(sb, videosBySbId) {
  if (!sb) return null
  const list = getSbVideosList(videosBySbId, sb.id)
  if (list.length) {
    if (hasRealMediaValue(sb.video_url)) {
      const matched = list.find((v) => v.video_url === sb.video_url)
      if (matched) return matched
      const lp = sb.video_url.replace(/^\/static\//, '')
      const byPath = list.find((v) => v.local_path && (v.local_path === lp || sb.video_url.includes(v.local_path)))
      if (byPath) return byPath
    }
    return list[0]
  }
  if (hasRealMediaValue(sb.video_url) || hasRealMediaValue(sb.video_local_path)) {
    return { video_url: sb.video_url, local_path: sb.video_local_path }
  }
  return null
}

export function videoRecordUrl(record) {
  if (!record) return ''
  const localPath = record.local_path && String(record.local_path).trim()
  if (isPlaceholderMediaUrl(localPath)) return ''
  if (localPath) return '/static/' + localPath.replace(/^\//, '')
  if (isPlaceholderMediaUrl(record.video_url)) return ''
  if (record.video_url && isHttpVideoUrl(record.video_url)) return record.video_url
  if (record.video_url) {
    const p = String(record.video_url).trim()
    if (p.startsWith('/static/')) return p
    if (!p.startsWith('http')) return '/static/' + p.replace(/^\//, '')
    return p
  }
  return ''
}

export function sbVideoFirstLastUrls(sb, imagesBySbId, useFirstLast) {
  const universal = sb?.creation_mode === 'universal'
  let first = ''
  let last = undefined
  if (!universal) {
    const firstRec = useFirstLast ? resolveSbFirstImageRecord(sb, imagesBySbId) : resolveSbMainImageRecord(sb, imagesBySbId)
    first = imageRecordUrl(firstRec)
  }
  if (useFirstLast && !universal) {
    const lastRec = resolveSbLastImageRecord(sb, imagesBySbId)
    const lu = imageRecordUrl(lastRec)
    if (lu) last = lu
  }
  return { first: first || undefined, last }
}

/** 分镜是否已有可用图片（与列表模式 hasSbImage 逻辑对齐） */
export function hasStoryboardImage(sb, imagesBySbId, drama) {
  if (!sb) return false
  if (dramaUsesFirstLastFrame(drama) && sb.creation_mode !== 'universal') {
    return !!(resolveSbFirstImageRecord(sb, imagesBySbId) || hasRealMediaValue(sb.image_url) || hasRealMediaValue(sb.local_path) || hasRealMediaValue(sb.composed_image))
  }
  return !!(resolveSbMainImageRecord(sb, imagesBySbId) || hasRealMediaValue(sb.image_url) || hasRealMediaValue(sb.local_path) || hasRealMediaValue(sb.composed_image))
}

/** 分镜是否已有可用视频 */
export function hasStoryboardVideo(sb, videosBySbId) {
  if (!sb) return false
  const rec = resolveSbVideoRecord(sb, videosBySbId)
  return !!(hasRealMediaValue(rec?.video_url) || hasRealMediaValue(rec?.local_path) || hasRealMediaValue(sb.video_url))
}

export function getStoryboardMediaAvailability(sb, imagesBySbId, videosBySbId, drama) {
  const imageReady = hasStoryboardImage(sb, imagesBySbId, drama)
  const videoReady = hasStoryboardVideo(sb, videosBySbId)
  return {
    imageReady,
    videoReady,
    ready: imageReady && videoReady,
  }
}
