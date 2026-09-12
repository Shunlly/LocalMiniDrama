import { getMediaLibraryDramaId } from '@/utils/mediaLibrary.js'
import { parseFreeCreateTaskResult } from '@/utils/freeCreate.js'

export const FREE_CREATE_ASSET_NAME_PREFIX = '自由创作：'
export const FREE_CREATE_ASSET_KEYWORD = '自由创作'
export const FREE_CREATE_RESULT_STORAGE_KEY = 'localminidrama.free-create.results.v1'
export const FREE_CREATE_RESULT_LIMIT = 30

function firstQueryValue(value) {
  return Array.isArray(value) ? value[0] : value
}

function nonEmpty(value) {
  return String(value || '').trim()
}

export function positiveFreeCreateId(value) {
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    value = Number(value.trim())
  }
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

export function extractFreeCreateLocalPath(url, localPath) {
  const direct = normalizeLocalPath(localPath)
  if (direct) return direct
  const raw = String(url || '').trim().replace(/\\/g, '/')
  if (!raw) return ''
  if (raw.startsWith('/static/')) {
    return normalizeLocalPath(raw.slice('/static/'.length))
  }
  try {
    const parsed = new URL(raw, 'http://localminidrama.invalid')
    if (parsed.pathname.startsWith('/static/')) {
      return normalizeLocalPath(parsed.pathname.slice('/static/'.length))
    }
  } catch (_) {}
  if (!/^https?:\/\//i.test(raw)) return normalizeLocalPath(raw)
  return ''
}

function normalizeLocalPath(value) {
  return String(value || '').trim().replace(/\\/g, '/').replace(/^\/+/, '')
}

export function resolveFreeCreateAssetDramaId(route = {}) {
  const query = route?.query && typeof route.query === 'object' ? route.query : {}
  const fromQuery = positiveFreeCreateId(firstQueryValue(query.drama_id))
  if (fromQuery) return fromQuery
  const returnTo = String(firstQueryValue(query.returnTo) || '')
  const fromFilm = getMediaLibraryDramaId(returnTo)
  if (fromFilm) return fromFilm
  const dramaMatch = returnTo.match(/^\/drama\/([1-9]\d*)(?:[?#]|$)/)
  return dramaMatch ? positiveFreeCreateId(dramaMatch[1]) : null
}

export function buildFreeCreateAssetName(item = {}) {
  const prompt = nonEmpty(item.prompt).replace(/\s+/g, ' ').slice(0, 40)
  if (prompt) return `${FREE_CREATE_ASSET_NAME_PREFIX}${prompt}`
  return item?.type === 'video' ? '自由创作视频' : '自由创作图片'
}

export function isFreeCreateAssetName(name) {
  return nonEmpty(name).startsWith('自由创作')
}

export function buildFreeCreateAssetPayload(item, dramaId) {
  const localPath = extractFreeCreateLocalPath(item?.url, item?.localPath)
  if (!localPath) {
    throw new Error('该结果还没有可保存的本地文件')
  }
  const type = item?.type === 'video' ? 'video' : 'image'
  const payload = {
    name: buildFreeCreateAssetName(item),
    type,
    url: `/static/${localPath}`,
    local_path: localPath,
  }
  const scopedDramaId = positiveFreeCreateId(dramaId)
  if (scopedDramaId) payload.drama_id = scopedDramaId
  const imageGenId = positiveFreeCreateId(item?.imageGenId ?? item?.image_gen_id)
  const videoGenId = positiveFreeCreateId(item?.videoGenId ?? item?.video_gen_id)
  if (type === 'image' && imageGenId) payload.image_gen_id = imageGenId
  if (type === 'video' && videoGenId) payload.video_gen_id = videoGenId
  return payload
}

export function describeAssetScopeMismatch(asset, dramaId) {
  const assetId = positiveFreeCreateId(asset?.id)
  const assetDramaId = positiveFreeCreateId(asset?.drama_id)
  const expectedDramaId = positiveFreeCreateId(dramaId)
  if (!assetId) return '素材保存失败：未返回有效素材编号'
  if (expectedDramaId && assetId === expectedDramaId && assetDramaId !== expectedDramaId) {
    return '素材保存失败：返回结果不属于当前项目'
  }
  if (expectedDramaId) {
    if (assetDramaId !== expectedDramaId) return '素材保存失败：返回结果不属于当前项目'
    return ''
  }
  if (assetDramaId) return '素材保存失败：返回结果不属于全局素材库'
  return ''
}

export function getFreeCreateSaveDisabledReason(item, {
  generating = false,
  cancelling = false,
  busyReason = '',
} = {}) {
  if (item?.savingAsset) return '正在保存到素材中心，请稍候'
  if (positiveFreeCreateId(item?.assetId)) return '已保存到素材中心'
  if (generating || cancelling) return busyReason || '正在处理，请稍候'
  if (!item?.url) return '生成结果还不能保存'
  if (!extractFreeCreateLocalPath(item.url, item.localPath)) return '该结果还没有可保存的本地文件'
  return ''
}

export function getFreeCreateSaveAriaLabel(item, {
  generating = false,
  cancelling = false,
  busyReason = '',
  targetLabel = '全局素材中心',
} = {}) {
  const disabledReason = getFreeCreateSaveDisabledReason(item, { generating, cancelling, busyReason })
  if (item?.savingAsset) return '正在保存到素材中心'
  if (positiveFreeCreateId(item?.assetId)) return `已保存到${targetLabel}`
  if (disabledReason) return `保存到素材中心不可用：${disabledReason}`
  if (nonEmpty(item?.assetSaveError)) return `重试保存到${targetLabel}`
  return `保存到${targetLabel}`
}

export function applyGeneratedMediaToItem(item, media = {}) {
  if (!item) return item
  const localPath = extractFreeCreateLocalPath(media.url, media.localPath)
  if (localPath) {
    item.localPath = localPath
    const rawUrl = nonEmpty(media.url)
    item.url = rawUrl.startsWith('/static/') ? rawUrl : `/static/${localPath}`
  } else if (media.url) {
    item.url = media.url
  }
  const imageGenId = positiveFreeCreateId(media.imageGenId)
  const videoGenId = positiveFreeCreateId(media.videoGenId)
  if (imageGenId) item.imageGenId = imageGenId
  if (videoGenId) item.videoGenId = videoGenId
  const taskId = nonEmpty(media.taskId)
  if (taskId) item.taskId = taskId
  return item
}

export function freeCreateResultKey(item = {}) {
  const assetId = positiveFreeCreateId(item.assetId)
  if (assetId) return `asset:${assetId}`
  const imageGenId = positiveFreeCreateId(item.imageGenId)
  if (imageGenId) return `image:${imageGenId}`
  const videoGenId = positiveFreeCreateId(item.videoGenId)
  if (videoGenId) return `video:${videoGenId}`
  const taskId = nonEmpty(item.taskId)
  if (taskId) return `task:${taskId}`
  const localPath = extractFreeCreateLocalPath(item.url, item.localPath)
  if (localPath) return `path:${localPath}`
  return ''
}

export function resultFromAsset(asset) {
  if (!asset) return null
  const assetId = positiveFreeCreateId(asset.id)
  if (!assetId) return null
  const localPath = extractFreeCreateLocalPath(asset.url, asset.local_path)
  const url = localPath ? `/static/${localPath}` : nonEmpty(asset.url)
  if (!url) return null
  return {
    type: asset.type === 'video' ? 'video' : 'image',
    prompt: stripFreeCreateAssetName(asset.name),
    status: 'completed',
    url,
    localPath: localPath || null,
    error: null,
    taskId: nonEmpty(asset.task_id) || null,
    imageGenId: positiveFreeCreateId(asset.image_gen_id),
    videoGenId: positiveFreeCreateId(asset.video_gen_id),
    assetId,
    assetDramaId: positiveFreeCreateId(asset.drama_id),
    savingAsset: false,
    assetSaveError: '',
    createdAt: asset.created_at || asset.updated_at || '',
    updatedAt: asset.updated_at || asset.created_at || '',
  }
}

function stripFreeCreateAssetName(name) {
  const text = nonEmpty(name)
  if (text.startsWith(FREE_CREATE_ASSET_NAME_PREFIX)) {
    return text.slice(FREE_CREATE_ASSET_NAME_PREFIX.length).trim()
  }
  if (text === '自由创作图片' || text === '自由创作视频') return ''
  return text
}

export function resultFromImageRecord(record, fallback = {}) {
  if (!record) return null
  const localPath = extractFreeCreateLocalPath(record.image_url || record.url, record.local_path)
  const url = localPath
    ? `/static/${localPath}`
    : nonEmpty(record.image_url || record.url)
  if (!url && String(record.status || '') !== 'failed' && String(record.status || '') !== 'cancelled') {
    return null
  }
  const status = normalizeRecordStatus(record.status, url)
  return {
    type: 'image',
    prompt: nonEmpty(record.prompt) || nonEmpty(fallback.prompt),
    status,
    url: url || null,
    localPath: localPath || null,
    error: status === 'completed' ? null : nonEmpty(record.error_msg || record.error || fallback.error),
    taskId: nonEmpty(record.task_id || fallback.taskId) || null,
    imageGenId: positiveFreeCreateId(record.id || fallback.imageGenId),
    videoGenId: null,
    assetId: positiveFreeCreateId(fallback.assetId),
    assetDramaId: positiveFreeCreateId(record.drama_id || fallback.assetDramaId),
    savingAsset: false,
    assetSaveError: '',
    createdAt: record.created_at || fallback.createdAt || '',
    updatedAt: record.updated_at || record.completed_at || fallback.updatedAt || '',
  }
}

export function resultFromVideoRecord(record, fallback = {}) {
  if (!record) return null
  const localPath = extractFreeCreateLocalPath(record.video_url || record.url, record.local_path)
  const url = localPath
    ? `/static/${localPath}`
    : nonEmpty(record.video_url || record.url)
  if (!url && String(record.status || '') !== 'failed' && String(record.status || '') !== 'cancelled') {
    return null
  }
  const status = normalizeRecordStatus(record.status, url)
  return {
    type: 'video',
    prompt: nonEmpty(record.prompt) || nonEmpty(fallback.prompt),
    status,
    url: url || null,
    localPath: localPath || null,
    error: status === 'completed' ? null : nonEmpty(record.error_msg || record.error || fallback.error),
    taskId: nonEmpty(record.task_id || fallback.taskId) || null,
    imageGenId: null,
    videoGenId: positiveFreeCreateId(record.id || fallback.videoGenId),
    assetId: positiveFreeCreateId(fallback.assetId),
    assetDramaId: positiveFreeCreateId(record.drama_id || fallback.assetDramaId),
    savingAsset: false,
    assetSaveError: '',
    createdAt: record.created_at || fallback.createdAt || '',
    updatedAt: record.updated_at || record.completed_at || fallback.updatedAt || '',
  }
}

function normalizeRecordStatus(status, url) {
  const value = String(status || '').toLowerCase()
  if (value === 'failed') return 'failed'
  if (value === 'cancelled' || value === 'canceled') return 'cancelled'
  if (url) return 'completed'
  if (value === 'completed') return 'completed'
  return 'failed'
}

export function resultFromTask(task, fallback = {}) {
  if (!task) return null
  const status = String(task.status || '').toLowerCase()
  if (status === 'failed') {
    return {
      type: fallback.type === 'video' ? 'video' : 'image',
      prompt: nonEmpty(fallback.prompt),
      status: 'failed',
      url: null,
      localPath: null,
      error: nonEmpty(task.error || task.message) || nonEmpty(fallback.error) || '生成失败，请稍后重试',
      taskId: nonEmpty(task.id || fallback.taskId) || null,
      imageGenId: positiveFreeCreateId(fallback.imageGenId),
      videoGenId: positiveFreeCreateId(fallback.videoGenId),
      assetId: positiveFreeCreateId(fallback.assetId),
      assetDramaId: positiveFreeCreateId(fallback.assetDramaId),
      savingAsset: false,
      assetSaveError: '',
      createdAt: task.created_at || fallback.createdAt || '',
      updatedAt: task.updated_at || fallback.updatedAt || '',
    }
  }
  if (status === 'cancelled' || status === 'canceled') {
    return {
      type: fallback.type === 'video' ? 'video' : 'image',
      prompt: nonEmpty(fallback.prompt),
      status: 'cancelled',
      url: null,
      localPath: null,
      error: nonEmpty(task.error || task.message) || '生成已取消',
      taskId: nonEmpty(task.id || fallback.taskId) || null,
      imageGenId: positiveFreeCreateId(fallback.imageGenId),
      videoGenId: positiveFreeCreateId(fallback.videoGenId),
      assetId: positiveFreeCreateId(fallback.assetId),
      assetDramaId: positiveFreeCreateId(fallback.assetDramaId),
      savingAsset: false,
      assetSaveError: '',
      createdAt: task.created_at || fallback.createdAt || '',
      updatedAt: task.updated_at || fallback.updatedAt || '',
    }
  }
  if (status !== 'completed') return null
  let parsed = {}
  try {
    parsed = parseFreeCreateTaskResult(task.result)
  } catch (_) {
    parsed = {}
  }
  const type = fallback.type === 'video' || parsed.video_generation_id || parsed.video_url
    ? 'video'
    : 'image'
  const localPath = extractFreeCreateLocalPath(
    parsed.image_url || parsed.video_url,
    parsed.local_path,
  )
  const url = localPath
    ? `/static/${localPath}`
    : nonEmpty(parsed.image_url || parsed.video_url)
  if (!url) return null
  return {
    type,
    prompt: nonEmpty(fallback.prompt),
    status: 'completed',
    url,
    localPath: localPath || null,
    error: null,
    taskId: nonEmpty(task.id || fallback.taskId) || null,
    imageGenId: positiveFreeCreateId(parsed.image_generation_id || fallback.imageGenId),
    videoGenId: positiveFreeCreateId(parsed.video_generation_id || fallback.videoGenId),
    assetId: positiveFreeCreateId(fallback.assetId),
    assetDramaId: positiveFreeCreateId(fallback.assetDramaId),
    savingAsset: false,
    assetSaveError: '',
    createdAt: task.created_at || fallback.createdAt || '',
    updatedAt: task.updated_at || fallback.updatedAt || '',
  }
}

export function mergeFreeCreateResults(...groups) {
  const byKey = new Map()

  function keysFor(item) {
    const keys = [freeCreateResultKey(item)].filter(Boolean)
    const localPath = extractFreeCreateLocalPath(item?.url, item?.localPath)
    if (localPath) keys.push(`path:${localPath}`)
    return keys
  }

  for (const group of groups) {
    for (const item of Array.isArray(group) ? group : []) {
      const keys = keysFor(item)
      if (!keys.length) continue
      const existing = keys.map((key) => byKey.get(key)).find(Boolean)
      const merged = existing
        ? {
          ...existing,
          ...item,
          assetId: item.assetId || existing.assetId,
          imageGenId: item.imageGenId || existing.imageGenId,
          videoGenId: item.videoGenId || existing.videoGenId,
          taskId: item.taskId || existing.taskId,
        }
        : item
      const allKeys = new Set(keys)
      if (existing) {
        for (const [key, value] of byKey.entries()) {
          if (value === existing) allKeys.add(key)
        }
      }
      for (const key of allKeys) byKey.set(key, merged)
    }
  }
  return [...new Set(byKey.values())].sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt || left.createdAt || '') || 0
    const rightTime = Date.parse(right.updatedAt || right.createdAt || '') || 0
    return rightTime - leftTime
  })
}

export function serializeFreeCreateHistory(results = []) {
  return (Array.isArray(results) ? results : [])
    .filter((item) => item && (
      ['completed', 'failed', 'cancelled'].includes(item.status)
      || positiveFreeCreateId(item.assetId)
    ))
    .filter((item) => (
      positiveFreeCreateId(item.assetId)
      || positiveFreeCreateId(item.imageGenId)
      || positiveFreeCreateId(item.videoGenId)
      || nonEmpty(item.taskId)
      || extractFreeCreateLocalPath(item.url, item.localPath)
    ))
    .slice(0, FREE_CREATE_RESULT_LIMIT)
    .map((item) => ({
      type: item.type === 'video' ? 'video' : 'image',
      prompt: nonEmpty(item.prompt),
      status: item.status || 'completed',
      url: item.url || null,
      localPath: extractFreeCreateLocalPath(item.url, item.localPath) || null,
      error: item.error || null,
      taskId: nonEmpty(item.taskId) || null,
      imageGenId: positiveFreeCreateId(item.imageGenId),
      videoGenId: positiveFreeCreateId(item.videoGenId),
      assetId: positiveFreeCreateId(item.assetId),
      assetDramaId: positiveFreeCreateId(item.assetDramaId),
      createdAt: item.createdAt || '',
      updatedAt: item.updatedAt || item.createdAt || '',
    }))
}

export function readFreeCreateHistory(storage) {
  if (!storage || typeof storage.getItem !== 'function') return []
  try {
    const parsed = JSON.parse(storage.getItem(FREE_CREATE_RESULT_STORAGE_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch (_) {
    return []
  }
}

export function writeFreeCreateHistory(storage, results) {
  if (!storage || typeof storage.setItem !== 'function') return false
  try {
    storage.setItem(FREE_CREATE_RESULT_STORAGE_KEY, JSON.stringify(serializeFreeCreateHistory(results)))
    return true
  } catch (_) {
    return false
  }
}

function isAssetInFreeCreateScope(asset, dramaId) {
  const assetDramaId = positiveFreeCreateId(asset?.drama_id)
  if (!assetDramaId) return true
  const currentDramaId = positiveFreeCreateId(dramaId)
  return Boolean(currentDramaId && assetDramaId === currentDramaId)
}

export async function listFreeCreateAssets({
  assetsApi,
  dramaId,
} = {}) {
  if (!assetsApi?.list) return []
  const response = await assetsApi.list({
    keyword: FREE_CREATE_ASSET_KEYWORD,
    page_size: 50,
  }, { suppressErrorToast: true })
  return (response?.items || [])
    .filter((item) => isFreeCreateAssetName(item?.name))
    .filter((item) => isAssetInFreeCreateScope(item, dramaId))
    .map(resultFromAsset)
    .filter(Boolean)
}

async function rehydrateFreeCreateHistoryEntry(entry, options = {}) {
  const {
    assetsApi,
    imagesApi,
    videosApi,
    taskApi,
  } = options
  const assetId = positiveFreeCreateId(entry?.assetId)
  if (assetId && assetsApi?.get) {
    try {
      const asset = await assetsApi.get(assetId)
      const mapped = resultFromAsset(asset)
      if (mapped) return { ...mapped, prompt: mapped.prompt || nonEmpty(entry.prompt) }
    } catch (_) {}
  }

  const videoGenId = positiveFreeCreateId(entry?.videoGenId)
  if (videoGenId && videosApi?.get) {
    try {
      const record = await videosApi.get(videoGenId)
      const mapped = resultFromVideoRecord(record, entry)
      if (mapped) return mapped
    } catch (_) {}
  }

  const taskId = nonEmpty(entry?.taskId)
  if (taskId && taskApi?.get) {
    try {
      const task = await taskApi.get(taskId, { suppressErrorToast: true })
      const mapped = resultFromTask(task, entry)
      if (mapped?.url || mapped?.status === 'failed' || mapped?.status === 'cancelled') return mapped
    } catch (_) {}
  }

  const imageGenId = positiveFreeCreateId(entry?.imageGenId)
  if ((imageGenId || taskId) && imagesApi?.list) {
    try {
      const response = await imagesApi.list({
        status: 'completed',
        page_size: 50,
      }, { suppressErrorToast: true })
      const record = (response?.items || []).find((item) => (
        (imageGenId && positiveFreeCreateId(item.id) === imageGenId)
        || (taskId && nonEmpty(item.task_id) === taskId)
      ))
      const mapped = resultFromImageRecord(record, entry)
      if (mapped) return mapped
    } catch (_) {}
  }

  return null
}

export async function restoreFreeCreateResults(options = {}) {
  const history = readFreeCreateHistory(options.storage)
  const restored = []
  for (const entry of history) {
    const item = await rehydrateFreeCreateHistoryEntry(entry, options)
    if (item) restored.push(item)
  }
  const listed = await listFreeCreateAssets(options)
  return mergeFreeCreateResults(restored, listed)
}

export async function saveFreeCreateResultToAssets(item, {
  assetsApi,
  dramaId,
} = {}) {
  if (!item) throw new Error('没有可保存的生成结果')
  if (!assetsApi?.create) throw new Error('素材服务不可用')
  const payload = buildFreeCreateAssetPayload(item, dramaId)
  const created = await assetsApi.create(payload)
  const createdId = positiveFreeCreateId(created?.id)
  if (!createdId) throw new Error('素材保存失败：未返回有效素材编号')
  let confirmed = created
  if (typeof assetsApi.get === 'function') {
    try {
      confirmed = await assetsApi.get(createdId)
    } catch (_) {
      confirmed = created
    }
  }
  if (!positiveFreeCreateId(confirmed?.id)) confirmed = created
  if (typeof assetsApi.list === 'function') {
    try {
      const listed = await assetsApi.list({
        keyword: FREE_CREATE_ASSET_KEYWORD,
        page_size: 50,
        ...(payload.drama_id ? { drama_id: payload.drama_id } : {}),
      }, { suppressErrorToast: true })
      const found = (listed?.items || []).find((row) => positiveFreeCreateId(row.id) === createdId)
      if (found) confirmed = found
      else if (!positiveFreeCreateId(confirmed?.id)) {
        throw new Error('素材已写入但未能从素材列表确认，请稍后在素材中心查看')
      }
    } catch (error) {
      if (error?.message === '素材已写入但未能从素材列表确认，请稍后在素材中心查看') throw error
    }
  }
  const scopeError = describeAssetScopeMismatch(confirmed, dramaId)
  if (scopeError) throw new Error(scopeError)
  return confirmed
}
