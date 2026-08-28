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
