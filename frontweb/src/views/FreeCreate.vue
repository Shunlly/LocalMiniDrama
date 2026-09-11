<template>
  <div class="free-create-page">
    <FreeCreateHeader @go-back="goBack" />

    <div class="create-layout">
      <FreeCreateInputPanel
        ref="inputPanelRef"
        v-model:mode="mode"
        v-model:prompt="prompt"
        v-model:style="style"
        v-model:aspect-ratio="aspectRatio"
        v-model:duration="duration"
        :generation-capability="generationCapability"
        :active-service-label="activeServiceLabel"
        :aspect-ratio-options="aspectRatioOptions"
        :ref-image-upload-status="refImageUploadStatus"
        :ref-image-data-url="refImageDataUrl"
        :ref-image-file-name="refImageFileName"
        :ref-image-trigger-label="refImageTriggerLabel"
        :ref-image-upload-message="refImageUploadMessage"
        :generating="generating"
        :generate-disabled="generateDisabled"
        :generate-disabled-reason="generateDisabledReason"
        :result-busy-disabled-reason="resultBusyDisabledReason"
        @load-service-configs="loadServiceConfigs"
        @open-ai-config="openAiConfig"
        @generate="generate"
        @trigger-ref-image-upload="triggerRefImageUpload"
        @ref-image-drop="onRefImageDrop"
        @ref-image-change="onRefImageChange"
        @retry-ref-image-upload="retryRefImageUpload"
        @clear-ref-image="clearRefImage"
      />

      <FreeCreateResultPanel
        :results="results"
        :generating="generating"
        :cancelling="cancelling"
        :mode="mode"
        :empty-result-copy="emptyResultCopy"
        :generation-capability="generationCapability"
        :result-busy-disabled-reason="resultBusyDisabledReason"
        :result-image-alt="resultImageAlt"
        :can-retry-item="canRetryItem"
        @clear-results="clearResults"
        @load-service-configs="loadServiceConfigs"
        @cancel-generation="cancelGeneration"
        @retry-generation="retryGeneration"
        @download-item="downloadItem"
        @preview-image="openImagePreview"
      />
    </div>

    <ImagePreviewDialog
      v-model="showImagePreview"
      :src="previewImage.src"
      :alt="previewImage.alt"
    />
  </div>
</template>

<script setup>
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { ElMessage } from '@/utils/elementPlusFeedback.js'
import { aiAPI } from '@/api/ai'
import { imagesAPI } from '@/api/images'
import { taskAPI } from '@/api/task'
import { videosAPI } from '@/api/videos'
import { uploadAPI } from '@/api/upload'
import { generationSettingsAPI } from '@/api/prompts'
import ImagePreviewDialog from '@/components/ImagePreviewDialog.vue'
import FreeCreateHeader from '@/components/freeCreate/FreeCreateHeader.vue'
import FreeCreateInputPanel from '@/components/freeCreate/FreeCreateInputPanel.vue'
import FreeCreateResultPanel from '@/components/freeCreate/FreeCreateResultPanel.vue'
import { getServiceConfigReadiness } from '@/utils/aiServiceReadiness'
import {
  buildFreeCreateGenerationPayload,
  createFreeCreateTaskOwner,
  getFreeCreateAspectRatioOptions,
  getFreeCreateCapabilityNotice,
  getFreeCreateReadyMessage,
  getReferenceUploadBlockReason,
  normalizeFreeCreateAspectRatio,
  parseFreeCreateTaskResult,
  toFreeCreateUserError,
} from '@/utils/freeCreate'

const router = useRouter()
const route = useRoute()
const mode = ref('image')
const prompt = ref('')
const style = ref('')
const aspectRatio = ref('16:9')
const duration = ref(5)
const generating = ref(false)
const cancelling = ref(false)
const activeTaskId = ref('')
const results = ref([])
const showImagePreview = ref(false)
const previewImage = ref({ src: '', alt: '生成图片预览' })
const inputPanelRef = ref(null)
const refImageDataUrl = ref(null)
const refImageLocalPath = ref(null)
const refImageFile = ref(null)
const refImageFileName = ref('参考图')
const refImageUploadStatus = ref('idle')
const refImageUploadError = ref('')
const refImageInput = {
  get value() {
    return inputPanelRef.value?.refImageInput ?? null
  },
}
const refImageUploadStatusRef = {
  get value() {
    return inputPanelRef.value?.refImageUploadStatusRef ?? null
  },
}
let refImageUploadAttempt = 0
/** 与后端视频异步超时一致（分钟 → 毫秒） */
const videoPollMaxMs = ref(30 * 60 * 1000)
const aiConfigs = ref([])
const configLoadState = ref('loading')
const freeCreateTaskOwner = createFreeCreateTaskOwner((taskId, body) => (
  taskAPI.cancel(taskId, body, { suppressErrorToast: true })
))
const leaveProtection = inject('appRouteLeaveProtection', null)
let unregisterLeaveProtection = null

const activeServiceType = computed(() => mode.value === 'video' ? 'video' : 'image')
const activeServiceLabel = computed(() => mode.value === 'video' ? '视频' : '图片')
const aspectRatioOptions = computed(() => getFreeCreateAspectRatioOptions(mode.value))
const activeServiceConfig = computed(() => {
  const configs = aiConfigs.value.filter((config) => (
    config?.service_type === activeServiceType.value
    && config?.is_active !== false
    && config?.is_active !== 0
    && config?.is_active !== '0'
  ))
  return configs.find((config) => config.is_default === true || config.is_default === 1)
    || configs[0]
    || null
})
const generationCapability = computed(() => {
  const serviceLabel = activeServiceLabel.value
  if (configLoadState.value === 'loading') {
    return {
      ready: false,
      status: 'loading',
      issue: '',
      message: getFreeCreateCapabilityNotice({ status: 'loading', serviceLabel }),
    }
  }
  if (configLoadState.value === 'error') {
    return {
      ready: false,
      status: 'error',
      issue: '',
      message: getFreeCreateCapabilityNotice({ status: 'error', serviceLabel }),
    }
  }
  const readiness = getServiceConfigReadiness(activeServiceConfig.value)
  if (readiness.ready) {
    return {
      ...readiness,
      status: 'ready',
      message: getFreeCreateReadyMessage({
        serviceLabel,
        name: activeServiceConfig.value?.name,
        provider: activeServiceConfig.value?.provider,
        model: readiness.model,
      }),
    }
  }
  return {
    ...readiness,
    status: 'missing',
    message: getFreeCreateCapabilityNotice({
      status: 'missing',
      issue: readiness.issue,
      serviceLabel,
    }),
  }
})

function generationUnavailableNotice() {
  return getFreeCreateCapabilityNotice({
    status: generationCapability.value.status,
    issue: generationCapability.value.issue,
    serviceLabel: activeServiceLabel.value,
  })
}
function warnGenerationUnavailable() {
  ElMessage.warning(toFreeCreateUserError(
    generationUnavailableNotice(),
    `${activeServiceLabel.value}服务尚未就绪`,
  ))
}

const referenceUploadBlockReason = computed(() => (
  mode.value === 'video'
    ? getReferenceUploadBlockReason(
      refImageUploadStatus.value,
      refImageUploadError.value,
      refImageLocalPath.value,
    )
    : ''
))
const refImageTriggerLabel = computed(() => {
  if (refImageUploadStatus.value === 'uploading') return '视频参考图正在上传'
  if (refImageUploadStatus.value === 'success') return '更换视频参考图'
  if (refImageUploadStatus.value === 'error') return '重新选择视频参考图'
  return '上传视频参考图'
})
const refImageUploadMessage = computed(() => {
  if (refImageUploadStatus.value === 'uploading') {
    return `参考图上传中：${refImageFileName.value}`
  }
  if (refImageUploadStatus.value === 'success') {
    return `参考图上传成功：${refImageFileName.value}`
  }
  return `参考图上传失败：${refImageUploadError.value || '请重试或移除'}`
})
const generateDisabled = computed(() => (
  generating.value
  || !prompt.value.trim()
  || !generationCapability.value.ready
  || Boolean(referenceUploadBlockReason.value)
))
const generateDisabledReason = computed(() => {
  if (generating.value) return ''
  if (!generationCapability.value.ready) {
    return toFreeCreateUserError(
      generationUnavailableNotice(),
      `${activeServiceLabel.value}服务尚未就绪`,
    )
  }
  if (referenceUploadBlockReason.value) return referenceUploadBlockReason.value
  if (!prompt.value.trim()) return '请先填写提示词'
  return ''
})
const resultBusyDisabledReason = computed(() => {
  if (cancelling.value) return '正在取消生成，请稍候'
  if (generating.value) return '正在生成，请稍候'
  return ''
})
const emptyResultCopy = computed(() => {
  if (generationCapability.value.status === 'loading') {
    return `正在检查${activeServiceLabel.value}服务，就绪后即可在这里查看生成结果`
  }
  if (generationCapability.value.status === 'error') {
    return `暂时无法读取${activeServiceLabel.value}服务配置，因此还不能生成。`
  }
  if (!generationCapability.value.ready) {
    return `请先配置可用的${activeServiceLabel.value}服务，生成结果会显示在这里`
  }
  return '填写提示词后，生成结果会显示在这里'
})

watch(mode, (nextMode) => {
  aspectRatio.value = normalizeFreeCreateAspectRatio(nextMode, aspectRatio.value)
}, { immediate: true })

function goBack() {
  router.push({ name: 'list' })
}

async function loadGenerationSettings() {
  try {
    const res = await generationSettingsAPI.get()
    const m = Math.max(1, Number(res?.video_generation_timeout_minutes) || 30)
    videoPollMaxMs.value = m * 60 * 1000
  } catch (_) {}
}

async function loadServiceConfigs() {
  configLoadState.value = 'loading'
  try {
    aiConfigs.value = await aiAPI.list()
    configLoadState.value = 'loaded'
  } catch (_) {
    aiConfigs.value = []
    configLoadState.value = 'error'
  }
}

function openAiConfig() {
  const returnTo = router.resolve({
    name: 'free-create',
    query: { mode: mode.value },
  }).fullPath
  router.push({
    name: 'ai-config',
    query: {
      service_type: activeServiceType.value,
      returnTo,
    },
  })
}

onMounted(async () => {
  window.addEventListener('beforeunload', handleBeforeUnload)
  unregisterLeaveProtection = leaveProtection?.register?.('free-create', {
    shouldBlockUnload: () => (
      refImageUploadStatus.value === 'uploading' || freeCreateTaskOwner.hasActive()
    ),
    confirmLeave: () => confirmFreeCreateLeave(),
  })
  const requestedMode = Array.isArray(route.query.mode) ? route.query.mode[0] : route.query.mode
  if (requestedMode === 'image' || requestedMode === 'video') mode.value = requestedMode
  await Promise.all([loadGenerationSettings(), loadServiceConfigs()])
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
  unregisterLeaveProtection?.()
  unregisterLeaveProtection = null
})

onBeforeRouteLeave(async () => {
  if (refImageUploadStatus.value === 'uploading') {
    ElMessage.warning('参考图正在上传，请完成后再离开。')
    return false
  }
  if (!freeCreateTaskOwner.hasActive()) return true
  if (!window.confirm('正在生成，离开将取消当前任务。仍要离开吗？')) return false
  return cancelActiveGeneration('用户离开自由创作页面')
})

async function confirmFreeCreateLeave() {
  if (refImageUploadStatus.value === 'uploading') {
    ElMessage.warning('参考图正在上传，请完成后再离开。')
    return false
  }
  if (!freeCreateTaskOwner.hasActive()) return true
  if (!window.confirm('正在生成，离开将取消当前任务。仍要离开吗？')) return false
  return cancelActiveGeneration('用户离开自由创作页面')
}

function handleBeforeUnload(event) {
  if (refImageUploadStatus.value !== 'uploading' && !freeCreateTaskOwner.hasActive()) return
  event.preventDefault()
  event.returnValue = ''
}

function triggerRefImageUpload() {
  if (refImageUploadStatus.value === 'uploading') return
  if (refImageInput.value) refImageInput.value.value = ''
  refImageInput.value?.click()
}

function resultImageAlt(item, index) {
  const description = String(item?.prompt || '').trim().replace(/\s+/g, ' ').slice(0, 80)
  return `第 ${index + 1} 张生成图片${description ? `：${description}` : ''}`
}

function openImagePreview(item, index) {
  if (!item?.url) return
  previewImage.value = { src: item.url, alt: resultImageAlt(item, index) }
  showImagePreview.value = true
}

function clearRefImage() {
  refImageUploadAttempt += 1
  refImageDataUrl.value = null
  refImageLocalPath.value = null
  refImageFile.value = null
  refImageFileName.value = '参考图'
  refImageUploadStatus.value = 'idle'
  refImageUploadError.value = ''
  if (refImageInput.value) refImageInput.value.value = ''
}

async function onRefImageChange(e) {
  const file = e.target.files?.[0]
  if (!file) return
  await processRefImageFile(file)
  e.target.value = ''
}

function onRefImageDrop(e) {
  if (refImageUploadStatus.value === 'uploading') return
  const file = e.dataTransfer?.files?.[0]
  if (file) processRefImageFile(file)
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('无法读取参考图文件'))
    reader.onabort = () => reject(new Error('参考图文件读取已取消'))
    reader.readAsDataURL(file)
  })
}

async function showReferenceUploadError(message, attemptId) {
  if (attemptId !== refImageUploadAttempt) return
  refImageDataUrl.value = null
  refImageLocalPath.value = null
  refImageUploadStatus.value = 'error'
  refImageUploadError.value = message || '上传失败，请重试或移除'
  await nextTick()
  refImageUploadStatusRef.value?.focus()
}

async function processRefImageFile(file) {
  const attemptId = ++refImageUploadAttempt
  refImageFile.value = file
  refImageFileName.value = String(file?.name || '参考图')
  refImageDataUrl.value = null
  refImageLocalPath.value = null
  refImageUploadError.value = ''

  if (!String(file?.type || '').startsWith('image/')) {
    await showReferenceUploadError('请选择图片文件', attemptId)
    return false
  }

  refImageUploadStatus.value = 'uploading'
  try {
    const dataUrl = await readFileAsDataUrl(file)
    if (attemptId !== refImageUploadAttempt) return false
    const res = await uploadAPI.uploadImage(file)
    if (attemptId !== refImageUploadAttempt) return false
    const localPath = String(res?.local_path || '').trim()
    if (!localPath) throw new Error('服务器未返回可用的参考图地址')
    refImageDataUrl.value = dataUrl
    refImageLocalPath.value = localPath
    refImageUploadStatus.value = 'success'
    return true
  } catch (error) {
    await showReferenceUploadError(toFreeCreateUserError(error, '上传失败，请重试或移除'), attemptId)
    return false
  }
}

async function retryRefImageUpload() {
  if (!refImageFile.value || refImageUploadStatus.value === 'uploading') return
  await processRefImageFile(refImageFile.value)
}

async function clearResults() {
  if (freeCreateTaskOwner.hasActive()) {
    const cancelled = await cancelActiveGeneration('用户清空生成结果')
    if (!cancelled) return false
  }
  results.value = []
  return true
}

function markRunCancelled(run, message = '生成已取消') {
  if (!run?.item) return
  run.item.status = 'cancelled'
  run.item.error = message
}

async function cancelActiveGeneration(reason = '用户取消生成') {
  const run = freeCreateTaskOwner.getActive()
  if (!run) return true

  cancelling.value = true
  try {
    await freeCreateTaskOwner.cancel(reason)
    markRunCancelled(run)
    activeTaskId.value = ''
    generating.value = false
    return true
  } catch (error) {
    generating.value = true
    ElMessage.error(`取消失败：${toFreeCreateUserError(error, '请稍后重试')}`)
    return false
  } finally {
    cancelling.value = false
  }
}

async function cancelGeneration() {
  await cancelActiveGeneration('用户取消生成')
}

async function waitForPendingCancellation(run) {
  if (run?.cancelPromise) {
    try {
      await run.cancelPromise
    } catch (_) {}
  }
  return !freeCreateTaskOwner.isActive(run)
}

function downloadItem(item) {
  if (!item.url) return
  const a = document.createElement('a')
  a.href = item.url
  a.download = `free_create_${Date.now()}.${item.type === 'video' ? 'mp4' : 'jpg'}`
  a.click()
}

function canRetryItem(item) {
  if (!item) return false
  if (item.status === 'processing' || item.status === 'pending') return false
  return item.status === 'failed' || item.status === 'cancelled' || !item.url
}

function createGenerationItem() {
  return {
    type: mode.value,
    prompt: prompt.value,
    style: style.value,
    aspectRatio: aspectRatio.value,
    duration: duration.value,
    referenceImageLocalPath: mode.value === 'video' ? (refImageLocalPath.value || null) : null,
    status: 'processing',
    url: null,
    error: null,
  }
}

async function generate() {
  if (!prompt.value.trim()) {
    ElMessage.warning('请先填写提示词')
    return
  }
  if (referenceUploadBlockReason.value) {
    ElMessage.error(referenceUploadBlockReason.value)
    return
  }
  if (!generationCapability.value.ready) {
    warnGenerationUnavailable()
    return
  }
  if (freeCreateTaskOwner.hasActive()) {
    ElMessage.warning('请等待当前生成完成后再试')
    return
  }
  const item = createGenerationItem()
  results.value.unshift(item)
  await runGeneration(item)
}

async function retryGeneration(item) {
  if (!canRetryItem(item)) return
  if (generating.value || cancelling.value || freeCreateTaskOwner.hasActive()) {
    ElMessage.warning('请等待当前生成完成后再重试')
    return
  }
  if (item.type === 'video' || item.type === 'image') mode.value = item.type
  await nextTick()
  if (!generationCapability.value.ready) {
    warnGenerationUnavailable()
    return
  }
  if (item.type === 'video' && !item.referenceImageLocalPath && referenceUploadBlockReason.value) {
    ElMessage.error(referenceUploadBlockReason.value)
    return
  }
  await runGeneration(item)
}

async function runGeneration(item) {
  if (freeCreateTaskOwner.hasActive()) return

  const run = freeCreateTaskOwner.begin({ item })
  generating.value = true
  item.status = 'processing'
  item.url = null
  item.error = null
  try {
    const body = buildFreeCreateGenerationPayload({
      mode: item.type,
      prompt: item.prompt,
      style: item.style,
      aspectRatio: item.aspectRatio,
      duration: item.duration,
      referenceUploadStatus: item.referenceImageLocalPath ? 'success' : 'idle',
      referenceUploadError: '',
      referenceImageLocalPath: item.referenceImageLocalPath,
    })
    if (item.type === 'image') {
      const res = await freeCreateTaskOwner.trackSubmission(run, imagesAPI.create(body))
      if (freeCreateTaskOwner.isActive(run)) activeTaskId.value = run.taskId
      if (await waitForPendingCancellation(run)) return
      if (res?.task_id) {
        await pollImageTask(res.task_id, item, run)
      } else if (res?.image_url || res?.local_path) {
        const localPath = String(res.local_path || '').replace(/^\/+/, '')
        item.url = res.image_url || (localPath ? `/static/${localPath}` : null)
        item.status = 'completed'
      } else {
        failResultItem(item, '提交成功但未返回图片任务或结果')
      }
    } else {
      const res = await freeCreateTaskOwner.trackSubmission(run, videosAPI.create(body))
      if (freeCreateTaskOwner.isActive(run)) activeTaskId.value = run.taskId
      if (await waitForPendingCancellation(run)) return
      if (res?.task_id) {
        await pollVideoTask(res.task_id, item, run)
      } else if (res?.video_url || res?.local_path) {
        item.url = res.local_path ? `/static/${String(res.local_path).replace(/^\/+/, '')}` : res.video_url
        item.status = 'completed'
      } else {
        failResultItem(item, '提交成功但未返回视频任务或结果')
      }
    }
  } catch (e) {
    if (run.cancelRequested || run.cancelConfirmed) {
      markRunCancelled(run)
    } else {
      failResultItem(item, e)
      ElMessage.error(item.error)
    }
  } finally {
    freeCreateTaskOwner.complete(run)
    if (!freeCreateTaskOwner.hasActive()) {
      activeTaskId.value = ''
      generating.value = false
    }
  }
}

function isCancelledTaskStatus(status) {
  return ['cancelled', 'canceled'].includes(status)
}

function failResultItem(item, message) {
  item.status = 'failed'
  item.error = toFreeCreateUserError(message, '生成失败，请稍后重试')
}

async function pollImageTask(taskId, item, run, maxMs = 180000) {
  const start = Date.now()
  let lastPollError = ''
  while (Date.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, 3000))
    if (await waitForPendingCancellation(run)) return

    let res
    try {
      res = await taskAPI.get(taskId, { suppressErrorToast: true })
      lastPollError = ''
    } catch (error) {
      lastPollError = toFreeCreateUserError(error, '任务状态读取失败')
      continue
    }
    if (await waitForPendingCancellation(run)) return

    const status = String(res?.status || '').toLowerCase()
    if (status === 'completed') {
      try {
        const r = parseFreeCreateTaskResult(res.result)
        const localPath = String(r.local_path || '').replace(/^\/+/, '')
        item.url = r.image_url || (localPath ? `/static/${localPath}` : null)
        if (!item.url) throw new Error('任务完成但未返回图片地址')
        item.status = 'completed'
        return
      } catch (error) {
        failResultItem(item, error)
        return
      }
    }
    if (isCancelledTaskStatus(status)) {
      item.status = 'cancelled'
      item.error = toFreeCreateUserError(res?.error || res?.message, '生成已取消')
      return
    }
    if (status === 'failed') {
      failResultItem(item, res?.error || res?.message)
      return
    }
  }
  failResultItem(item, lastPollError ? `轮询超时：${lastPollError}` : '生成超时')
}

async function pollVideoTask(taskId, item, run) {
  const maxMs = videoPollMaxMs.value
  const start = Date.now()
  let lastPollError = ''
  while (Date.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, 4000))
    if (await waitForPendingCancellation(run)) return

    let res
    try {
      res = await taskAPI.get(taskId, { suppressErrorToast: true })
      lastPollError = ''
    } catch (error) {
      lastPollError = toFreeCreateUserError(error, '任务状态读取失败')
      continue
    }
    if (await waitForPendingCancellation(run)) return

    const status = String(res?.status || '').toLowerCase()
    if (status === 'completed') {
      try {
        const r = parseFreeCreateTaskResult(res.result)
        const directLocalPath = String(r.local_path || '').replace(/^\/+/, '')
        item.url = directLocalPath ? `/static/${directLocalPath}` : (r.video_url || null)
        const vgId = r.video_generation_id
        if (vgId) {
          try {
            const vRes = await videosAPI.get(vgId)
            const localPath = String(vRes?.local_path || '').replace(/^\/+/, '')
            item.url = localPath ? `/static/${localPath}` : (vRes?.video_url || item.url)
          } catch (error) {
            lastPollError = toFreeCreateUserError(error, '视频结果读取失败')
            continue
          }
        }
        if (!item.url) throw new Error('任务完成但未返回视频地址')
        item.status = 'completed'
        return
      } catch (error) {
        failResultItem(item, error)
        return
      }
    }
    if (isCancelledTaskStatus(status)) {
      item.status = 'cancelled'
      item.error = toFreeCreateUserError(res?.error || res?.message, '生成已取消')
      return
    }
    if (status === 'failed') {
      failResultItem(item, res?.error || res?.message)
      return
    }
  }
  failResultItem(item, lastPollError ? `轮询超时：${lastPollError}` : '生成超时')
}
</script>

<style scoped>
.free-create-page {
  min-height: 100vh;
  background: #f5f7fa;
  padding: 20px;
}

.create-layout {
  display: flex;
  gap: 20px;
  align-items: flex-start;
}
</style>
