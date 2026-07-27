export const FREE_CANVAS_MEDIA_DRAG_TYPE = 'application/x-local-mini-drama-free-canvas-media'

const FREE_CANVAS_MEDIA_DRAG_KINDS = new Set(['project-asset', 'storyboard-media'])

function dragIdentity(value) {
  const identity = String(value ?? '').trim()
  if (!identity || identity.length > 128 || /[\u0000-\u001f\u007f]/.test(identity)) return ''
  return identity
}

export function createFreeCanvasMediaDragPayload(item, { projectId, kind } = {}) {
  const normalizedProjectId = Number(projectId)
  const normalizedKind = FREE_CANVAS_MEDIA_DRAG_KINDS.has(kind) ? kind : ''
  const mediaId = dragIdentity(item?.id)
  const itemProjectId = mediaProjectId(item)
  if (
    !Number.isFinite(normalizedProjectId)
    || normalizedProjectId <= 0
    || !normalizedKind
    || !mediaId
    || (itemProjectId != null && Number(itemProjectId) !== normalizedProjectId)
  ) return null

  const payload = {
    version: 1,
    projectId: normalizedProjectId,
    kind: normalizedKind,
    mediaId,
  }
  if (normalizedKind === 'storyboard-media') {
    const storyboardId = dragIdentity(item?.storyboardId)
    if (!storyboardId) return null
    payload.storyboardId = storyboardId
  }
  return payload
}

export function parseFreeCanvasMediaDragPayload(rawPayload, expectedProjectId) {
  const raw = String(rawPayload || '')
  if (!raw || raw.length > 2048) return null
  let value
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  const projectId = Number(value?.projectId)
  const requiredProjectId = Number(expectedProjectId)
  const kind = FREE_CANVAS_MEDIA_DRAG_KINDS.has(value?.kind) ? value.kind : ''
  const mediaId = dragIdentity(value?.mediaId)
  if (
    value?.version !== 1
    || !Number.isFinite(projectId)
    || projectId <= 0
    || projectId !== requiredProjectId
    || !kind
    || !mediaId
  ) return null

  const payload = { version: 1, projectId, kind, mediaId }
  if (kind === 'storyboard-media') {
    const storyboardId = dragIdentity(value?.storyboardId)
    if (!storyboardId) return null
    payload.storyboardId = storyboardId
  }
  return payload
}

function mediaPathCandidate(value) {
  if (!value || typeof value !== 'object') return ''
  return value.storageKey
    || value.local_path
    || (value.type === 'image' || value.type === 'video' ? value.content : '')
    || ''
}

function trustedMediaPathCandidate(value) {
  if (!value || typeof value !== 'object') return ''
  return value.storageKey || value.local_path || ''
}

function mediaProjectId(value) {
  return value?.projectId ?? value?.project_id ?? value?.drama_id ?? value?.dramaId
}

export function normalizeFreeCanvasMediaPath(value) {
  const source = String(value || '').trim()
  if (!source || source.length > 2048 || /[\u0000-\u001f\u007f]/.test(source)) return ''
  if (/^(?:https?:|data:|blob:)/i.test(source) || /^[a-z]:[\\/]/i.test(source)) return ''

  const normalized = source.replace(/\\/g, '/')
  const relative = normalized.startsWith('/static/')
    ? normalized.slice('/static/'.length)
    : normalized
  if (!relative || relative.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(relative)) return ''

  const segments = relative.split('/')
  if (segments.some((segment) => {
    if (!segment) return true
    try {
      const decoded = decodeURIComponent(segment)
      return decoded === '.' || decoded === '..' || /[\u0000-\u001f\u007f]/.test(decoded)
    } catch {
      return true
    }
  })) return ''

  return segments.join('/')
}

function findAsset(assetsById, id) {
  if (!assetsById || id === undefined || id === null || id === '') return null
  if (assetsById instanceof Map) {
    return assetsById.get(id) || assetsById.get(String(id)) || null
  }
  if (Array.isArray(assetsById)) {
    return assetsById.find((asset) => String(asset?.id) === String(id)) || null
  }
  if (typeof assetsById === 'object') return assetsById[id] || assetsById[String(id)] || null
  return null
}

export function buildFreeCanvasAssetReferencePatch(node, assetReference, assetsById) {
  if (assetReference === undefined || assetReference === null || assetReference === '') {
    return { assetId: undefined, asset_ref: undefined }
  }

  const asset = findAsset(assetsById, assetReference)
  const patch = { assetId: assetReference, asset_ref: assetReference }
  if (node?.type === 'image' || node?.type === 'video') {
    const mediaPath = normalizeFreeCanvasMediaPath(mediaPathCandidate(asset))
    patch.content = mediaPath || undefined
    patch.storageKey = mediaPath || undefined
  }
  return patch
}

export function resolveFreeCanvasMediaPath(node, assetsById) {
  const direct = normalizeFreeCanvasMediaPath(mediaPathCandidate(node))
  if (direct) return direct
  const asset = findAsset(assetsById, node?.asset_ref ?? node?.assetId)
  return normalizeFreeCanvasMediaPath(mediaPathCandidate(asset))
}

export function getFreeCanvasAssetSaveEligibility(node, context = {}) {
  if (!['image', 'video'].includes(node?.type)) {
    return { eligible: false, path: '', reason: '仅本地图片或视频节点可保存为项目素材' }
  }
  if (node?.asset_ref != null || node?.assetId != null) {
    return { eligible: false, path: '', reason: '该节点已关联项目素材，无需重复保存' }
  }
  const path = normalizeFreeCanvasMediaPath(trustedMediaPathCandidate(node))
  if (!path) {
    return { eligible: false, path: '', reason: '未找到可保存的本地图片或视频文件' }
  }
  const projectId = Number(context?.projectId)
  if (!Number.isFinite(projectId) || projectId <= 0) {
    return { eligible: false, path: '', reason: '当前项目尚未就绪，无法验证媒体文件' }
  }
  const nodeProjectId = mediaProjectId(node)
  if (nodeProjectId != null && Number(nodeProjectId) !== projectId) {
    return { eligible: false, path: '', reason: '该媒体不属于当前项目' }
  }
  const inventory = Array.isArray(context?.inventory) ? context.inventory : []
  const knownMedia = inventory.some((item) => (
    Number(mediaProjectId(item)) === projectId
    && item?.type === node.type
    && normalizeFreeCanvasMediaPath(trustedMediaPathCandidate(item)) === path
  ))
  if (!knownMedia) {
    return { eligible: false, path: '', reason: '当前项目媒体清单中未找到该文件，请刷新后重试' }
  }
  return { eligible: true, path, reason: '' }
}

export function filterFreeCanvasAssetItems(items, { query = '', type = 'all' } = {}) {
  const source = Array.isArray(items) ? items : []
  const normalizedType = type === 'image' || type === 'video' ? type : 'all'
  const keyword = String(query || '').trim().toLocaleLowerCase()
  return source.filter((item) => {
    if (normalizedType !== 'all' && item?.type !== normalizedType) return false
    if (!keyword) return true
    const searchable = [item?.name, item?.label, item?.location, item?.title, item?.description]
      .map((value) => String(value || '').toLocaleLowerCase())
      .join('\n')
    return searchable.includes(keyword)
  })
}

export function freeCanvasMediaUrl(node, assetsById) {
  const path = resolveFreeCanvasMediaPath(node, assetsById)
  if (!path) return ''
  return `/static/${path.split('/').map((segment) => encodeURIComponent(segment)).join('/')}`
}

function storyboardLabel(episode, storyboard, episodeIndex, storyboardIndex) {
  const episodeTitle = String(episode?.title || `第 ${episode?.episode_number || episodeIndex + 1} 集`).trim()
  const shotTitle = String(
    storyboard?.title
    || storyboard?.segment_title
    || `分镜 ${storyboard?.storyboard_number || storyboardIndex + 1}`,
  ).trim()
  return `${episodeTitle} · ${shotTitle}`
}

function storyboardMediaEntries(type, storyboard, values, prefix, dramaProjectId) {
  const result = []
  for (const [index, media] of (Array.isArray(values) ? values : []).entries()) {
    const storageKey = normalizeFreeCanvasMediaPath(
      media?.local_path
      || media?.storageKey
      || (type === 'video' ? media?.video_url : media?.image_url)
      || media?.url,
    )
    if (!storageKey) continue
    const mediaId = media?.id ?? `${storyboard.id}:${index + 1}`
    result.push({
      id: `storyboard-${type}:${mediaId}`,
      type,
      projectId: dramaProjectId,
      storyboardId: storyboard.id,
      storageKey,
      label: `${prefix} · ${type === 'video' ? '视频' : '图片'} ${index + 1}`,
    })
  }
  return result
}

export function buildFreeCanvasStoryboardMediaItems(drama, context = {}) {
  const items = []
  const dramaProjectId = drama?.id
  for (const [episodeIndex, episode] of (drama?.episodes || []).entries()) {
    for (const [storyboardIndex, storyboard] of (episode?.storyboards || []).entries()) {
      if (storyboard?.id == null) continue
      const mediaStatus = context.mediaStatusBySbId?.[storyboard.id]
      if (mediaStatus && mediaStatus.state !== 'ready') continue
      const prefix = storyboardLabel(episode, storyboard, episodeIndex, storyboardIndex)
      items.push(...storyboardMediaEntries(
        'image',
        storyboard,
        context.imagesBySbId?.[storyboard.id],
        prefix,
        dramaProjectId,
      ))
      items.push(...storyboardMediaEntries(
        'video',
        storyboard,
        context.videosBySbId?.[storyboard.id],
        prefix,
        dramaProjectId,
      ))
    }
  }
  return items
}
