import {
  DEFAULT_JSON_TIMEOUT_MS,
  describeServiceLoadError,
  isRequestCanceled,
  withRequestRetry,
} from '@/utils/requestError.js'

export function parseGenerationSettingsPayload(res) {
  const concurrency = Number(res?.concurrency)
  const videoConcurrency = Number(res?.video_concurrency)
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20
    || !Number.isInteger(videoConcurrency) || videoConcurrency < 1 || videoConcurrency > 20) {
    throw new Error('生成设置返回的数据无效，请重试。')
  }
  return { concurrency, videoConcurrency }
}

export function clampGenerationConcurrency(val) {
  const n = Number(val)
  if (Number.isNaN(n) || n < 1) return null
  return Math.min(20, Math.max(1, Math.round(n)))
}

export function validateGenerationConcurrency(imageConcurrency, videoConcurrency) {
  const n = Number(imageConcurrency)
  const nv = Number(videoConcurrency)
  if (Number.isNaN(n) || n < 1 || n > 20) return '图片并发数请填写 1-20 之间的整数'
  if (Number.isNaN(nv) || nv < 1 || nv > 20) return '视频并发数请填写 1-20 之间的整数'
  return ''
}

export async function loadGenerationSettingsPayload(api, {
  signal,
  timeout = DEFAULT_JSON_TIMEOUT_MS,
  delayMs = 400,
} = {}) {
  const res = await withRequestRetry(
    () => api.get({
      signal,
      timeout,
      suppressErrorToast: true,
    }),
    { maxAttempts: 2, delayMs, signal },
  )
  if (signal?.aborted) return { aborted: true }
  return { aborted: false, ...parseGenerationSettingsPayload(res) }
}

export function describeGenerationSettingsLoadError(error, signal) {
  return describeServiceLoadError(error, {
    serviceLabel: '生成设置服务',
    fallback: '暂时无法读取生成设置，请稍后重试。',
    signal,
  })
}

export function shouldIgnoreGenerationSettingsError(error, signal) {
  return isRequestCanceled(error, signal) || Boolean(signal?.aborted)
}
