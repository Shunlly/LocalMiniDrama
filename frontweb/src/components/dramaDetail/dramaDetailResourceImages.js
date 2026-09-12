/**
 * 剧集详情资源图片地址、上传和生成轮询。
 * 不持有弹窗 ref，也不改保存字段。
 */

import { isUserFacingAbort } from '@/utils/userFacingError'

function isCancelledAsyncTaskStatus(status) {
  return ['cancelled', 'canceled', 'cancelling', 'canceling'].includes(String(status || '').toLowerCase())
}

function createCanceledTaskError(message = '操作已取消') {
  const error = new Error(message)
  error.name = 'AbortError'
  error.code = 'ERR_CANCELED'
  return error
}

export function assetImageUrl(item) {
  if (!item) return ''
  const lp = item.local_path && String(item.local_path).trim()
  if (lp) return '/static/' + lp.replace(/^\//, '')
  return item.image_url || ''
}

export async function pollDramaDetailImageTask(taskAPI, taskId, { attempts = 300, intervalMs = 1500 } = {}) {
  if (!taskId) throw new Error('未返回任务ID')
  let task = null
  for (let i = 0; i < attempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
    const tr = await taskAPI.get(taskId)
    task = tr?.data ?? tr
    const status = String(task?.status || '').toLowerCase()
    if (status === 'completed') return task
    if (status === 'failed') throw new Error(task.error || '生成失败')
    if (isCancelledAsyncTaskStatus(status)) throw createCanceledTaskError()
  }
  throw new Error('生成超时')
}

export function createDramaDetailLibraryImages({
  dramaId,
  uploadAPI,
  imagesAPI,
  taskAPI,
  ElMessage,
  toUserError,
} = {}) {
  async function doUploadLibImg(event, form, api, reloadFn) {
    const file = event.target?.files?.[0]
    if (event.target) event.target.value = ''
    if (!file || !form?.id) return
    form.imgUploading = true
    try {
      const res = await uploadAPI.uploadImage(file, { dramaId })
      const data = res?.data ?? res
      const url = data?.url || data?.path || data?.local_path
      if (!url) { ElMessage.error('上传未返回地址'); return }
      form.image_url = url
      form.local_path = data?.local_path ?? null
      await api.update(form.id, { image_url: url, local_path: null })
      reloadFn()
      ElMessage.success('图片已更新')
    } catch (e) { if (isUserFacingAbort(e) || e === 'cancel') return; ElMessage.error(toUserError(e, '上传失败')) }
    finally { form.imgUploading = false }
  }

  async function doGenerateLibImg(form, prompt, api, reloadFn) {
    if (!prompt?.trim()) { ElMessage.warning('请先填写名称或描述'); return }
    form.imgGenerating = true
    try {
      const res = await imagesAPI.create({ prompt: prompt.trim(), drama_id: dramaId || null })
      const imgData = res?.data ?? res
      const task = await pollDramaDetailImageTask(taskAPI, imgData?.task_id)
      const result = task.result
      const imageUrl = result?.image_url
      const localPath = result?.local_path ?? null
      if (!imageUrl && !localPath) throw new Error('未获取到图片地址')
      form.image_url = imageUrl || ''
      form.local_path = localPath
      await api.update(form.id, { image_url: imageUrl || null, local_path: localPath })
      reloadFn()
      ElMessage.success('AI 图片已生成')
    } catch (e) { if (isUserFacingAbort(e) || e === 'cancel') return; ElMessage.error(toUserError(e, '生成失败')) }
    finally { form.imgGenerating = false }
  }

  return { doUploadLibImg, doGenerateLibImg }
}

async function uploadDramaDetailEditorImage({
  event,
  form,
  dramaId,
  uploadAPI,
  persistImage,
  reloadFn,
  ElMessage,
  toUserError,
}) {
  const file = event.target?.files?.[0]
  if (event.target) event.target.value = ''
  if (!file || !form?.id) return
  form.imgUploading = true
  try {
    const res = await uploadAPI.uploadImage(file, { dramaId })
    const data = res?.data ?? res
    const url = data?.url || data?.path || data?.local_path
    if (!url) { ElMessage.error('上传未返回地址'); return }
    form.image_url = url
    form.local_path = data?.local_path ?? null
    await persistImage(form, url)
    reloadFn()
    ElMessage.success('图片已更新')
  } catch (e) { if (isUserFacingAbort(e) || e === 'cancel') return; ElMessage.error(toUserError(e, '上传失败')) }
  finally { form.imgUploading = false }
}

async function generateDramaDetailEditorImage({
  form,
  startGenerate,
  taskAPI,
  reloadFn,
  ElMessage,
  toUserError,
}) {
  if (!form?.id) return
  form.imgGenerating = true
  try {
    const res = await startGenerate(form)
    const data = res?.data ?? res
    const task = await pollDramaDetailImageTask(taskAPI, data?.task_id)
    form.image_url = task.result?.image_url || ''
    form.local_path = task.result?.local_path ?? null
    reloadFn()
    ElMessage.success('AI 图片已生成')
  } catch (e) { if (isUserFacingAbort(e) || e === 'cancel') return; ElMessage.error(toUserError(e, '生成失败')) }
  finally { form.imgGenerating = false }
}

export {
  uploadDramaDetailEditorImage,
  generateDramaDetailEditorImage,
}
