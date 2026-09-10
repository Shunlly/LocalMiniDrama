import { describeServiceLoadError, isRequestCanceled, isRequestTimeout } from './requestError.js'

export const FREE_CREATE_VIDEO_ASPECT_RATIOS = Object.freeze(['16:9', '9:16', '1:1'])
export const FREE_CREATE_IMAGE_ASPECT_RATIOS = Object.freeze([...FREE_CREATE_VIDEO_ASPECT_RATIOS, '4:3'])

const SECRET_RE = /password\s*=|client_secret|cookie\s*:|authorization\s*:|api[_-]?key\s*[:=]/i
const TECHNICAL_ENGLISH_RE = /network error|timeout of \d+ms|request failed with status code|err_network|econnaborted|etimedout|failed to fetch|load failed|internal server error|econnrefused|enotfound/i
const UNSET_ERROR = '\0'

function nonEmpty(value) {
  return String(value || '').trim()
}

function hasChineseText(text) {
  return /[\u4e00-\u9fff]/.test(String(text || ''))
}

function readErrorText(error) {
  if (typeof error === 'string') return error.trim()
  if (!error || typeof error !== 'object') return ''
  return String(error.message || error.error || '').trim()
}

/** 仅放行不含密钥、链接和英文技术异常的简体中文 */
export function isSafeFreeCreateUserText(text) {
  const value = String(text || '').trim()
  return Boolean(value)
    && hasChineseText(value)
    && !SECRET_RE.test(value)
    && !/https?:\/\//i.test(value)
    && !TECHNICAL_ENGLISH_RE.test(value)
}

export function sanitizeFreeCreateCapabilityDetail(value) {
  const text = nonEmpty(value)
  if (!text) return ''
  if (SECRET_RE.test(text) || /https?:\/\//i.test(text) || TECHNICAL_ENGLISH_RE.test(text)) return ''
  return text
}

/** 自由创作不可用时的中文能力说明，不拼接异常原文 */
export function getFreeCreateCapabilityNotice({
  status = '',
  issue = '',
  serviceLabel = '图片',
} = {}) {
  const label = nonEmpty(serviceLabel) || '图片'
  if (status === 'loading') return `正在检查${label}服务...`
  if (status === 'error') return `无法读取${label}服务配置`
  if (status === 'ready') return `${label}服务已就绪`
  if (issue === 'missing_config') return `尚未配置可用的${label}服务`
  if (issue === 'missing_model') return `${label}服务尚未选择可用模型`
  if (issue === 'missing_credentials') return `${label}服务缺少访问凭据`
  if (issue === 'missing_workflow') return `${label}服务缺少生成工作流`
  return `${label}服务尚未就绪`
}

export function getFreeCreateReadyMessage({
  serviceLabel = '图片',
  name,
  provider,
  model,
} = {}) {
  const label = nonEmpty(serviceLabel) || '图片'
  const identity = sanitizeFreeCreateCapabilityDetail(name) || sanitizeFreeCreateCapabilityDetail(provider)
  const safeModel = sanitizeFreeCreateCapabilityDetail(model)
  const detail = [identity, safeModel].filter(Boolean).join(' / ')
  return detail ? `${label}服务已就绪：${detail}` : `${label}服务已就绪`
}

export function toFreeCreateUserError(error, fallback = '生成失败，请稍后重试') {
  if (error == null || error === '') return fallback
  if (error === 'cancel' || isRequestCanceled(error)) return '操作已取消'

  const raw = readErrorText(error)
  if (isSafeFreeCreateUserText(raw)) return raw

  if (error && typeof error === 'object') {
    const backendMessage = error?.response?.data?.error?.message
    if (isSafeFreeCreateUserText(backendMessage)) return String(backendMessage).trim()
    const described = describeServiceLoadError(error, {
      serviceLabel: '自由创作服务',
      fallback: UNSET_ERROR,
    })
    if (described && described !== UNSET_ERROR && isSafeFreeCreateUserText(described)) {
      return described
    }
    const status = Number(error?.status || error?.response?.status)
    if (Number.isInteger(status) && status > 0) return `自由创作服务暂时不可用（HTTP ${status}）`
    if (isRequestTimeout(error)) return '连接自由创作服务超时，请稍后重试'
  }

  if (raw && TECHNICAL_ENGLISH_RE.test(raw)) {
    if (/timeout/i.test(raw)) return '连接自由创作服务超时，请稍后重试'
    if (/network error|failed to fetch|err_network|econnrefused|enotfound/i.test(raw)) {
      return '无法连接自由创作服务，请检查服务是否已启动'
    }
  }
  return fallback
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

export function parseFreeCreateTaskResult(value) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return {}

  let parsed = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      throw new Error('任务结果格式无效，请重新生成')
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('任务结果格式无效，请重新生成')
  }
  return parsed
}

export function createFreeCreateTaskOwner(cancelTask) {
  if (typeof cancelTask !== 'function') {
    throw new TypeError('cancelTask must be a function')
  }

  let activeRun = null
  let nextRunId = 0

  function isActive(run) {
    return Boolean(run && activeRun === run)
  }

  function begin(metadata = {}) {
    if (activeRun) throw new Error('已有生成任务正在进行')
    activeRun = {
      ...metadata,
      ownerId: ++nextRunId,
      taskId: '',
      submissionPromise: null,
      submissionSettled: false,
      cancelPromise: null,
      cancelRequested: false,
      cancelConfirmed: false,
      cancelError: null,
    }
    return activeRun
  }

  function trackSubmission(run, submission) {
    if (!isActive(run)) throw new Error('生成任务已不再活动')
    const tracked = Promise.resolve(submission).then(
      (result) => {
        run.submissionSettled = true
        run.taskId = nonEmpty(result?.task_id)
        return result
      },
      (error) => {
        run.submissionSettled = true
        throw error
      },
    )
    run.submissionPromise = tracked
    return tracked
  }

  async function cancel(reason = '用户已取消') {
    const run = activeRun
    if (!run) return true
    if (run.cancelPromise) return run.cancelPromise

    run.cancelRequested = true
    run.cancelError = null
    const cancelPromise = (async () => {
      try {
        if (run.submissionPromise) {
          await run.submissionPromise.catch(() => null)
        }
        if (run.taskId) {
          await cancelTask(run.taskId, { reason })
        }
        run.cancelConfirmed = true
        if (activeRun === run) activeRun = null
        return true
      } catch (error) {
        run.cancelRequested = false
        run.cancelError = error
        run.cancelPromise = null
        throw error
      }
    })()
    run.cancelPromise = cancelPromise
    return cancelPromise
  }

  function complete(run) {
    if (!isActive(run)) return false
    activeRun = null
    return true
  }

  return {
    begin,
    cancel,
    complete,
    getActive: () => activeRun,
    hasActive: () => Boolean(activeRun),
    isActive,
    trackSubmission,
  }
}

export function getReferenceUploadBlockReason(status, errorMessage, localPath) {
  if (status === 'uploading') return '参考图正在上传，请等待上传完成'
  if (status === 'error') {
    return isSafeFreeCreateUserText(errorMessage) ? nonEmpty(errorMessage) : '参考图上传失败，请重试或移除'
  }
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
