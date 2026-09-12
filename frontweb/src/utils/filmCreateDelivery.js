import { finalizeFetchRequestFailure, prepareFetchRequest } from './coreJsonRequest.js'
import {
  createTimeoutController,
  DEFAULT_DOWNLOAD_TIMEOUT_MS,
  isRequestCanceled,
  isRequestTimeout,
} from './requestError.js'

export function normalizeVideoDownloadFilenamePart(value, fallback) {
  const normalized = String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u003c\u003e:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 72)
  return normalized || fallback
}

export function videoExtensionForBlob(blob) {
  const contentType = String(blob?.type || '').toLowerCase().split(';')[0].trim()
  const extensions = {
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'video/x-matroska': 'mkv',
    'video/avi': 'avi',
    'video/x-msvideo': 'avi',
  }
  return extensions[contentType] || 'mp4'
}

export function buildEpisodeVideoFilename(title, episodeNumber, blob) {
  const safeTitle = normalizeVideoDownloadFilenamePart(title, 'LocalMiniDrama')
  const numericEpisode = Number(episodeNumber)
  const safeEpisode = Number.isFinite(numericEpisode) && numericEpisode > 0
    ? String(Math.trunc(numericEpisode))
    : normalizeVideoDownloadFilenamePart(episodeNumber, '当前')
  return `${safeTitle}-第${safeEpisode}集-成片.${videoExtensionForBlob(blob)}`
}

export function isJsonVideoDownloadType(contentType) {
  const normalized = String(contentType || '').toLowerCase().split(';')[0].trim()
  return normalized === 'application/json' || normalized === 'text/json' || normalized.endsWith('+json')
}

export async function blobContainsJsonPayload(blob) {
  if (!blob || blob.size > 1024 * 1024 || typeof blob.text !== 'function') return false
  try {
    const text = (await blob.text()).trim()
    if (!text || (!text.startsWith('{') && !text.startsWith('['))) return false
    JSON.parse(text)
    return true
  } catch (_) {
    return false
  }
}

export async function fetchVerifiedVideoBlob(url, fetchImpl = globalThis.fetch, options = {}) {
  const source = String(url || '').trim()
  if (!source) throw new Error('没有可下载的成片地址。')
  const timeout = createTimeoutController(
    options.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS,
    options.signal,
  )
  const config = prepareFetchRequest({
    method: 'GET',
    url: source,
    headers: { Accept: 'video/*, application/octet-stream;q=0.9' },
    signal: timeout.signal,
    suppressErrorToast: options.suppressErrorToast !== false,
  })

  const reportAndThrow = (error) => {
    error.config = error.config || config
    throw finalizeFetchRequestFailure(error, { signal: timeout.signal })
  }

  try {
    let response
    try {
      if (timeout.signal.aborted) {
        const aborted = timeout.signal.reason instanceof Error
          ? timeout.signal.reason
          : new Error(timeout.didTimeout() ? '成片下载超时，请稍后重试。' : '成片下载已取消。')
        throw aborted
      }
      response = await fetchImpl(source, {
        method: 'GET',
        credentials: 'same-origin',
        signal: timeout.signal,
        headers: config.headers,
      })
    } catch (error) {
      if (timeout.didTimeout() || isRequestTimeout(error, timeout.signal)) {
        const timeoutError = new Error('成片下载超时，请稍后重试。')
        timeoutError.isTimeout = true
        timeoutError.code = 'ECONNABORTED'
        reportAndThrow(timeoutError)
      }
      if (isRequestCanceled(error, timeout.signal) || options.signal?.aborted) {
        const cancelError = new Error('成片下载已取消。')
        cancelError.name = 'AbortError'
        cancelError.code = 'ERR_CANCELED'
        reportAndThrow(cancelError)
      }
      const networkError = new Error('无法连接本地服务，成片下载未开始。')
      networkError.code = 'ERR_NETWORK'
      reportAndThrow(networkError)
    }

    if (!response?.ok) {
      const status = Number(response?.status)
      const httpError = new Error(status >= 500
        ? '服务器暂时无法提供成片，请稍后重试。'
        : '暂时无法下载成片，请稍后重试。')
      httpError.status = Number.isFinite(status) && status > 0 ? status : 0
      httpError.response = { status: httpError.status, data: null, headers: response?.headers }
      reportAndThrow(httpError)
    }

    const contentType = response.headers?.get?.('content-type') || ''
    if (isJsonVideoDownloadType(contentType)) {
      const jsonError = new Error('服务器返回了错误信息，未下载任何文件。')
      jsonError.status = Number(response.status) || 0
      jsonError.response = { status: jsonError.status, data: null, headers: response.headers }
      reportAndThrow(jsonError)
    }

    let blob
    try {
      blob = await response.blob()
    } catch (error) {
      if (timeout.didTimeout() || isRequestTimeout(error, timeout.signal)) {
        const timeoutError = new Error('成片下载超时，请稍后重试。')
        timeoutError.isTimeout = true
        timeoutError.code = 'ECONNABORTED'
        reportAndThrow(timeoutError)
      }
      if (isRequestCanceled(error, timeout.signal) || options.signal?.aborted) {
        const cancelError = new Error('成片下载已取消。')
        cancelError.name = 'AbortError'
        cancelError.code = 'ERR_CANCELED'
        reportAndThrow(cancelError)
      }
      const readError = new Error('无法读取成片文件，请重试。')
      reportAndThrow(readError)
    }
    if (!blob || !Number.isFinite(blob.size) || blob.size <= 0) {
      const emptyError = new Error('成片文件为空，未下载任何文件。')
      emptyError.status = Number(response.status) || 0
      emptyError.response = { status: emptyError.status, data: null, headers: response.headers }
      reportAndThrow(emptyError)
    }
    if (isJsonVideoDownloadType(blob.type) || await blobContainsJsonPayload(blob)) {
      const jsonError = new Error('服务器返回了错误信息，未下载任何文件。')
      jsonError.status = Number(response.status) || 0
      jsonError.response = { status: jsonError.status, data: null, headers: response.headers }
      reportAndThrow(jsonError)
    }
    return blob
  } finally {
    timeout.dispose()
  }
}

export function triggerBlobDownload(blob, filename, environment = globalThis) {
  const objectUrl = environment.URL.createObjectURL(blob)
  const anchor = environment.document.createElement('a')
  anchor.href = objectUrl
  anchor.download = filename
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  environment.document.body.appendChild(anchor)
  try {
    anchor.click()
  } finally {
    anchor.remove()
    environment.URL.revokeObjectURL(objectUrl)
  }
}

export function friendlyVideoDownloadError(error) {
  const message = String(error?.message || '')
  const safePrefixes = [
    '没有可下载的成片地址',
    '无法连接本地服务',
    '服务器暂时无法提供成片',
    '服务器返回了错误信息',
    '无法读取成片文件',
    '成片文件为空',
    '成片下载超时',
    '成片下载已取消',
  ]
  return safePrefixes.some((prefix) => message.startsWith(prefix))
    ? message
    : '成片下载失败，请检查本地服务后重试。'
}

export async function validateDeliveryBlob(blob, { label = '文件', kind = 'file' } = {}) {
  if (typeof Blob === 'undefined' || !(blob instanceof Blob)) throw new Error(`${label}未返回文件`)
  if (!Number.isFinite(blob.size) || blob.size <= 0) throw new Error(`${label}为空`)
  const contentType = String(blob.type || '').toLowerCase()
  if (contentType.includes('json') || await blobContainsJsonPayload(blob)) {
    throw new Error(`${label}接口返回了错误信息`)
  }
  if (kind === 'zip') {
    const signature = new Uint8Array(await blob.slice(0, 4).arrayBuffer())
    const isZip = signature[0] === 0x50 && signature[1] === 0x4b && (
      (signature[2] === 0x03 && signature[3] === 0x04)
      || (signature[2] === 0x05 && signature[3] === 0x06)
      || (signature[2] === 0x07 && signature[3] === 0x08)
    )
    if (!isZip) throw new Error(`${label}格式无效`)
  }
  return blob
}

export function buildDeliveryFilename(title, episodeNumber, suffix, extension) {
  const safeTitle = normalizeVideoDownloadFilenamePart(title, 'LocalMiniDrama')
  const numericEpisode = Number(episodeNumber)
  const episode = Number.isFinite(numericEpisode) && numericEpisode > 0 ? `-第${Math.trunc(numericEpisode)}集` : ''
  return `${safeTitle}${episode}-${suffix}.${extension}`
}
