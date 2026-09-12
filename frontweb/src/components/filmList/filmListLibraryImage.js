/** 分类素材库图片地址，以及上传/生图动作。 */

export const LIBRARY_IMAGE_LEAVE_MESSAGE = '素材图片正在上传或生成，请完成后再离开。'

function isCancelledAsyncTaskStatus(status) {
  return ['cancelled', 'canceled', 'cancelling', 'canceling'].includes(String(status || '').toLowerCase())
}

function createCanceledTaskError(message = '操作已取消') {
  const error = new Error(message)
  error.name = 'AbortError'
  error.code = 'ERR_CANCELED'
  return error
}

export function hasPendingLibraryImageWork({ form, saving = false } = {}) {
  return Boolean(saving || form?.imgUploading || form?.imgGenerating)
}

export function assetImageUrl(item) {
  if (!item) return ''
  if (typeof item === 'string') return item.startsWith('http') ? item : item
  const localPath = item.local_path && String(item.local_path).trim()
  if (localPath) return '/static/' + localPath.replace(/^\//, '')
  return item.image_url || ''
}

export function createLibraryImageActions(options = {}) {
  const getListWriteLocked = options.getListWriteLocked || (() => false)
  const uploadAPI = options.uploadAPI
  const imagesAPI = options.imagesAPI
  const taskAPI = options.taskAPI
  const ElMessage = options.ElMessage
  const isUserFacingAbort = options.isUserFacingAbort || (() => false)
  const toUserFacingError = options.toUserFacingError || ((error, fallback) => fallback)
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const maxAttempts = options.maxAttempts || 300
  const pollIntervalMs = options.pollIntervalMs || 1500

  async function doUploadLibImg(event, form, api, reloadFn) {
    if (getListWriteLocked() || form?.imgGenerating || form?.imgUploading) {
      if (event.target) event.target.value = ''
      return
    }
    const file = event.target?.files?.[0]
    if (event.target) event.target.value = ''
    if (!file || !form?.id) return
    form.imgUploading = true
    try {
      const res = await uploadAPI.uploadImage(file)
      const data = res?.data ?? res
      const url = data?.url || data?.path || data?.local_path
      if (!url) { ElMessage.error('上传未返回地址'); return }
      form.image_url = url
      form.local_path = data?.local_path ?? null
      await api.update(form.id, { image_url: url, local_path: null })
      reloadFn()
      ElMessage.success('图片已更新')
    } catch (e) {
      if (isUserFacingAbort(e) || e === 'cancel') return
      ElMessage.error(toUserFacingError(e, '上传失败'))
    }
    finally { form.imgUploading = false }
  }

  async function doGenerateLibImg(form, prompt, api, reloadFn) {
    if (getListWriteLocked() || form?.imgUploading || form?.imgGenerating) return
    if (!prompt?.trim()) { ElMessage.warning('请先填写名称或描述'); return }
    form.imgGenerating = true
    try {
      const res = await imagesAPI.create({ prompt: prompt.trim(), drama_id: null })
      const imgData = res?.data ?? res
      const taskId = imgData?.task_id
      if (!taskId) throw new Error('未返回任务ID')
      let task = null
      for (let i = 0; i < maxAttempts; i++) {
        await sleep(pollIntervalMs)
        const tr = await taskAPI.get(taskId)
        task = tr?.data ?? tr
        const status = String(task?.status || '').toLowerCase()
        if (status === 'completed') break
        if (status === 'failed') throw new Error(task.error || '生成失败')
        if (isCancelledAsyncTaskStatus(status)) throw createCanceledTaskError()
      }
      if (isCancelledAsyncTaskStatus(task?.status)) throw createCanceledTaskError()
      if (!task || String(task.status || '').toLowerCase() !== 'completed') throw new Error('生成超时')
      const result = task.result
      const imageUrl = result?.image_url
      const localPath = result?.local_path ?? null
      if (!imageUrl && !localPath) throw new Error('未获取到图片地址')
      form.image_url = imageUrl || ''
      form.local_path = localPath
      await api.update(form.id, { image_url: imageUrl || null, local_path: localPath })
      reloadFn()
      ElMessage.success('AI 图片已生成')
    } catch (e) {
      if (isUserFacingAbort(e) || e === 'cancel') return
      ElMessage.error(toUserFacingError(e, '生成失败'))
    }
    finally { form.imgGenerating = false }
  }

  return { doUploadLibImg, doGenerateLibImg }
}
