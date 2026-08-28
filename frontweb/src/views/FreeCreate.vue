<template>
  <div class="free-create-page">
    <div class="page-header">
      <div class="header-left">
        <el-button text aria-label="返回项目首页" @click="goBack">
          <el-icon><ArrowLeft /></el-icon>
          项目首页
        </el-button>
        <h2 class="page-title">自由创作</h2>
      </div>
      <p class="page-desc">不绑定剧集，直接输入文字生成图片或视频</p>
    </div>

    <div class="create-layout">
      <!-- 左侧：输入面板 -->
      <div class="input-panel">
        <el-tabs v-model="mode" class="mode-tabs">
          <el-tab-pane name="image">
            <template #label>
              <span class="mode-tab-label"><el-icon><Picture /></el-icon>生成图片</span>
            </template>
          </el-tab-pane>
          <el-tab-pane name="video">
            <template #label>
              <span class="mode-tab-label"><el-icon><VideoCamera /></el-icon>生成视频</span>
            </template>
          </el-tab-pane>
        </el-tabs>

        <div
          class="service-readiness"
          :class="`is-${generationCapability.status}`"
          role="status"
          aria-live="polite"
        >
          <el-icon aria-hidden="true">
            <Loading v-if="generationCapability.status === 'loading'" class="is-loading" />
            <CircleCheck v-else-if="generationCapability.ready" />
            <Warning v-else />
          </el-icon>
          <span>{{ generationCapability.message }}</span>
          <el-button
            v-if="generationCapability.status !== 'loading' && !generationCapability.ready"
            link
            type="primary"
            @click="openAiConfig"
          >
            配置{{ activeServiceLabel }}服务
          </el-button>
        </div>

        <div class="form-section">
          <div class="form-label">提示词 <span class="required">*</span></div>
          <el-input
            v-model="prompt"
            type="textarea"
            :rows="5"
            placeholder="描述你想要生成的画面内容..."
            class="prompt-input"
          />
        </div>

        <div v-if="mode === 'video'" class="form-section">
          <div class="form-label">参考图（可选）</div>
          <div
            class="ref-image-zone"
            :class="`is-${refImageUploadStatus}`"
            :aria-busy="refImageUploadStatus === 'uploading'"
            @dragover.prevent
            @drop.prevent="onRefImageDrop"
          >
            <button
              type="button"
              class="ref-image-trigger"
              :aria-label="refImageTriggerLabel"
              :aria-describedby="refImageUploadStatus === 'idle' ? undefined : 'ref-image-upload-status'"
              :disabled="refImageUploadStatus === 'uploading'"
              @click="triggerRefImageUpload"
            >
              <template v-if="refImageUploadStatus === 'success' && refImageDataUrl">
                <img :src="refImageDataUrl" class="ref-preview" alt="当前视频参考图" />
              </template>
              <template v-else-if="refImageUploadStatus === 'uploading'">
                <el-icon class="upload-icon is-loading" aria-hidden="true"><Loading /></el-icon>
                <span class="upload-tip">正在上传 {{ refImageFileName }}</span>
              </template>
              <template v-else-if="refImageUploadStatus === 'error'">
                <el-icon class="upload-icon is-error" aria-hidden="true"><CircleClose /></el-icon>
                <span class="upload-tip is-error">参考图上传失败</span>
              </template>
              <template v-else>
                <el-icon class="upload-icon" aria-hidden="true"><Picture /></el-icon>
                <span class="upload-tip">点击或拖拽上传参考图</span>
              </template>
            </button>
          </div>
        </div>

        <div
          v-if="refImageUploadStatus !== 'idle'"
          id="ref-image-upload-status"
          ref="refImageUploadStatusRef"
          class="ref-upload-status"
          :class="`is-${refImageUploadStatus}`"
          :role="refImageUploadStatus === 'error' ? 'alert' : 'status'"
          :aria-live="refImageUploadStatus === 'error' ? 'assertive' : 'polite'"
          :tabindex="refImageUploadStatus === 'error' ? -1 : undefined"
        >
          <el-icon aria-hidden="true">
            <Loading v-if="refImageUploadStatus === 'uploading'" class="is-loading" />
            <CircleCheck v-else-if="refImageUploadStatus === 'success'" />
            <CircleClose v-else />
          </el-icon>
          <span class="ref-upload-message">{{ refImageUploadMessage }}</span>
          <div class="ref-actions">
            <el-button
              v-if="refImageUploadStatus === 'error'"
              size="small"
              type="primary"
              plain
              @click="retryRefImageUpload"
            >
              重试上传
            </el-button>
            <el-button
              v-if="refImageUploadStatus !== 'uploading'"
              size="small"
              type="danger"
              plain
              @click="clearRefImage"
            >
              移除
            </el-button>
            <el-button v-else size="small" plain @click="clearRefImage">取消上传</el-button>
          </div>
        </div>
        <input
          ref="refImageInput"
          class="visually-hidden"
          type="file"
          accept="image/*"
          :disabled="refImageUploadStatus === 'uploading'"
          @change="onRefImageChange"
        />

        <div class="form-section form-row">
          <div class="form-item">
            <div class="form-label">风格</div>
            <el-input v-model="style" placeholder="例如：电影感 cinematic、日式动漫 anime…" />
          </div>
          <div class="form-item">
            <div class="form-label">{{ mode === 'video' ? '视频比例' : '画面比例' }}</div>
            <el-radio-group
              v-if="mode === 'video'"
              v-model="aspectRatio"
              aria-label="视频画面比例"
              class="aspect-ratio-group"
            >
              <el-radio-button
                v-for="option in aspectRatioOptions"
                :key="option.value"
                :label="option.value"
              >
                {{ option.label }}
              </el-radio-button>
            </el-radio-group>
            <el-select v-else v-model="aspectRatio" aria-label="画面比例">
              <el-option
                v-for="option in aspectRatioOptions"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </el-select>
          </div>
          <div v-if="mode === 'video'" class="form-item">
            <div class="form-label">时长</div>
            <el-select v-model="duration" aria-label="视频时长">
              <el-option label="3秒" :value="3" />
              <el-option label="5秒" :value="5" />
              <el-option label="8秒" :value="8" />
              <el-option label="10秒" :value="10" />
            </el-select>
          </div>
        </div>

        <el-button
          type="primary"
          size="large"
          :loading="generating"
          :disabled="generateDisabled"
          :title="generateDisabledReason"
          class="generate-btn"
          @click="generate"
        >
          {{ generating ? '生成中...' : (mode === 'image' ? '生成图片' : '生成视频') }}
        </el-button>
      </div>

      <!-- 右侧：结果展示 -->
      <div class="result-panel">
        <div class="result-header">
          <span class="result-title">生成结果</span>
          <el-button
            v-if="results.length > 0"
            size="small"
            plain
            :loading="cancelling"
            :disabled="cancelling"
            @click="clearResults"
          >
            {{ generating ? '取消并清空' : '清空' }}
          </el-button>
        </div>

        <div v-if="results.length === 0 && !generating" class="empty-result">
          <el-icon class="empty-icon">
            <Picture v-if="mode === 'image'" />
            <VideoCamera v-else />
          </el-icon>
          <p>填写提示词后，生成结果会显示在这里</p>
        </div>

        <div v-if="generating" class="generating-tip">
          <el-icon class="is-loading"><Loading /></el-icon>
          <span>{{ cancelling ? '正在取消生成...' : '正在生成，请稍候...' }}</span>
          <el-button
            type="danger"
            size="small"
            plain
            :loading="cancelling"
            :disabled="cancelling"
            @click="cancelGeneration"
          >
            <el-icon v-if="!cancelling"><CircleClose /></el-icon>
            <span>取消生成</span>
          </el-button>
        </div>

        <div class="result-grid">
          <div v-for="(item, idx) in results" :key="idx" class="result-item">
            <div class="result-media">
              <video
                v-if="item.type === 'video' && item.url"
                :src="item.url"
                controls
                class="result-video"
                loop
              />
              <button
                v-else-if="item.type === 'image' && item.url"
                type="button"
                class="result-image-button"
                :aria-label="`预览${resultImageAlt(item, idx)}`"
                @click="openImagePreview(item, idx)"
              >
                <img :src="item.url" class="result-image" :alt="resultImageAlt(item, idx)" />
              </button>
              <div v-else-if="item.status === 'pending' || item.status === 'processing'" class="media-loading">
                <el-icon class="is-loading"><Loading /></el-icon>
                <span>{{ item.status === 'processing' ? '生成中...' : '排队中...' }}</span>
              </div>
              <div v-else-if="item.status === 'failed'" class="media-error">
                <el-icon><CircleClose /></el-icon>
                <span>{{ item.error || '生成失败' }}</span>
              </div>
              <div v-else-if="item.status === 'cancelled'" class="media-cancelled">
                <el-icon><CircleClose /></el-icon>
                <span>{{ item.error || '生成已取消' }}</span>
              </div>
            </div>
            <div class="result-meta">
              <span class="result-prompt">{{ item.prompt }}</span>
              <div class="result-actions">
                <el-button v-if="item.url" size="small" plain @click="downloadItem(item)">下载</el-button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <ImagePreviewDialog
      v-model="showImagePreview"
      :src="previewImage.src"
      :alt="previewImage.alt"
    />
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft, CircleCheck, Picture, Loading, CircleClose, VideoCamera, Warning } from '@element-plus/icons-vue'
import { aiAPI } from '@/api/ai'
import { imagesAPI } from '@/api/images'
import { taskAPI } from '@/api/task'
import { videosAPI } from '@/api/videos'
import { uploadAPI } from '@/api/upload'
import { generationSettingsAPI } from '@/api/prompts'
import ImagePreviewDialog from '@/components/ImagePreviewDialog.vue'
import { getServiceConfigReadiness } from '@/utils/aiServiceReadiness'
import {
  buildFreeCreateGenerationPayload,
  createFreeCreateTaskOwner,
  getFreeCreateAspectRatioOptions,
  getReferenceUploadBlockReason,
  normalizeFreeCreateAspectRatio,
  parseFreeCreateTaskResult,
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
const refImageDataUrl = ref(null)
const refImageLocalPath = ref(null)
const refImageInput = ref(null)
const refImageFile = ref(null)
const refImageFileName = ref('参考图')
const refImageUploadStatus = ref('idle')
const refImageUploadError = ref('')
const refImageUploadStatusRef = ref(null)
let refImageUploadAttempt = 0
/** 与后端视频异步超时一致（分钟 → 毫秒） */
const videoPollMaxMs = ref(30 * 60 * 1000)
const aiConfigs = ref([])
const configLoadState = ref('loading')
const freeCreateTaskOwner = createFreeCreateTaskOwner((taskId, body) => (
  taskAPI.cancel(taskId, body, { suppressErrorToast: true })
))

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
  if (configLoadState.value === 'loading') {
    return { ready: false, status: 'loading', message: `正在检查${activeServiceLabel.value}服务...` }
  }
  if (configLoadState.value === 'error') {
    return { ready: false, status: 'error', message: `无法读取${activeServiceLabel.value}服务配置` }
  }
  const readiness = getServiceConfigReadiness(activeServiceConfig.value)
  if (readiness.ready) {
    const identity = activeServiceConfig.value?.name || activeServiceConfig.value?.provider || activeServiceLabel.value
    return {
      ...readiness,
      status: 'ready',
      message: `${activeServiceLabel.value}服务已就绪：${identity}${readiness.model ? ` / ${readiness.model}` : ''}`,
    }
  }
  const issueMessage = {
    missing_config: `尚未配置可用的${activeServiceLabel.value}服务`,
    missing_model: `${activeServiceLabel.value}服务尚未选择可用模型`,
    missing_credentials: `${activeServiceLabel.value}服务缺少访问凭据`,
    missing_workflow: `${activeServiceLabel.value}服务缺少生成工作流`,
  }[readiness.issue]
  return {
    ...readiness,
    status: 'missing',
    message: issueMessage || `${activeServiceLabel.value}服务尚未就绪`,
  }
})
const referenceUploadBlockReason = computed(() => getReferenceUploadBlockReason(
  refImageUploadStatus.value,
  refImageUploadError.value,
  refImageLocalPath.value,
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
  if (!prompt.value.trim()) return '请先填写提示词'
  if (referenceUploadBlockReason.value) return referenceUploadBlockReason.value
  if (!generationCapability.value.ready) return generationCapability.value.message
  return ''
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
  const requestedMode = Array.isArray(route.query.mode) ? route.query.mode[0] : route.query.mode
  if (requestedMode === 'image' || requestedMode === 'video') mode.value = requestedMode
  await Promise.all([loadGenerationSettings(), loadServiceConfigs()])
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
})

onBeforeRouteLeave(async () => {
  if (refImageUploadStatus.value === 'uploading') {
    ElMessage.warning('参考图正在上传，请完成后再离开。')
    return false
  }
  if (!freeCreateTaskOwner.hasActive()) return true
  return cancelActiveGeneration('用户离开自由创作页面')
})

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
    await showReferenceUploadError(error?.message || '上传失败，请重试或移除', attemptId)
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
    ElMessage.error(`取消失败：${error?.message || '请稍后重试'}`)
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

async function generate() {
  if (!prompt.value.trim()) return
  if (referenceUploadBlockReason.value) {
    ElMessage.error(referenceUploadBlockReason.value)
    return
  }
  if (!generationCapability.value.ready) {
    ElMessage.warning(generationCapability.value.message)
    return
  }
  if (freeCreateTaskOwner.hasActive()) return

  const generationMode = mode.value
  const generationPrompt = prompt.value
  const generationStyle = style.value
  const newItem = {
    type: generationMode,
    prompt: generationPrompt,
    style: generationStyle,
    status: 'processing',
    url: null,
    error: null,
  }
  const run = freeCreateTaskOwner.begin({ item: newItem })
  generating.value = true
  results.value.unshift(newItem)
  try {
    const body = buildFreeCreateGenerationPayload({
      mode: generationMode,
      prompt: generationPrompt,
      style: generationStyle,
      aspectRatio: aspectRatio.value,
      duration: duration.value,
      referenceUploadStatus: refImageUploadStatus.value,
      referenceUploadError: refImageUploadError.value,
      referenceImageLocalPath: refImageLocalPath.value,
    })
    if (generationMode === 'image') {
      const res = await freeCreateTaskOwner.trackSubmission(run, imagesAPI.create(body))
      if (freeCreateTaskOwner.isActive(run)) activeTaskId.value = run.taskId
      if (await waitForPendingCancellation(run)) return
      if (res?.task_id) {
        await pollImageTask(res.task_id, newItem, run)
      } else if (res?.image_url || res?.local_path) {
        const localPath = String(res.local_path || '').replace(/^\/+/, '')
        newItem.url = res.image_url || (localPath ? `/static/${localPath}` : null)
        newItem.status = 'completed'
      } else {
        newItem.status = 'failed'
        newItem.error = '提交成功但未返回图片任务或结果'
      }
    } else {
      const res = await freeCreateTaskOwner.trackSubmission(run, videosAPI.create(body))
      if (freeCreateTaskOwner.isActive(run)) activeTaskId.value = run.taskId
      if (await waitForPendingCancellation(run)) return
      if (res?.task_id) {
        await pollVideoTask(res.task_id, newItem, run)
      } else if (res?.video_url || res?.local_path) {
        newItem.url = res.local_path ? `/static/${String(res.local_path).replace(/^\/+/, '')}` : res.video_url
        newItem.status = 'completed'
      } else {
        newItem.status = 'failed'
        newItem.error = '提交成功但未返回视频任务或结果'
      }
    }
  } catch (e) {
    if (run.cancelRequested || run.cancelConfirmed) {
      markRunCancelled(run)
    } else {
      newItem.status = 'failed'
      newItem.error = e.message || '生成失败'
      ElMessage.error(newItem.error)
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
  item.error = message || '生成失败'
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
      lastPollError = error?.message || '任务状态读取失败'
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
        failResultItem(item, error?.message)
        return
      }
    }
    if (isCancelledTaskStatus(status)) {
      item.status = 'cancelled'
      item.error = res?.error || res?.message || '生成已取消'
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
      lastPollError = error?.message || '任务状态读取失败'
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
            lastPollError = error?.message || '视频结果读取失败'
            continue
          }
        }
        if (!item.url) throw new Error('任务完成但未返回视频地址')
        item.status = 'completed'
        return
      } catch (error) {
        failResultItem(item, error?.message)
        return
      }
    }
    if (isCancelledTaskStatus(status)) {
      item.status = 'cancelled'
      item.error = res?.error || res?.message || '生成已取消'
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

.page-header {
  margin-bottom: 20px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 6px;
}

.page-title {
  font-size: 22px;
  font-weight: 600;
  color: #1a1a2e;
  margin: 0;
}

.page-desc {
  color: #6b7280;
  font-size: 14px;
  margin: 0;
}

.create-layout {
  display: flex;
  gap: 20px;
  align-items: flex-start;
}

.input-panel {
  width: 380px;
  flex-shrink: 0;
  background: #fff;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 2px 8px rgba(0,0,0,.06);
}

.mode-tabs {
  margin-bottom: 16px;
}

.mode-tab-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.service-readiness {
  min-height: 40px;
  margin: -6px 0 16px;
  padding: 9px 10px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: #4b5563;
  font-size: 13px;
}

.service-readiness span {
  min-width: 0;
  flex: 1;
  overflow-wrap: anywhere;
}

.service-readiness.is-ready {
  border-color: #86efac;
  background: #f0fdf4;
  color: #166534;
}

.service-readiness.is-missing,
.service-readiness.is-error {
  border-color: #fcd34d;
  background: #fffbeb;
  color: #92400e;
}

.form-section {
  margin-bottom: 16px;
}

.form-label {
  font-size: 13px;
  font-weight: 500;
  color: #374151;
  margin-bottom: 6px;
}

.required {
  color: #ef4444;
}

.prompt-input :deep(.el-textarea__inner) {
  font-size: 14px;
}

.form-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.form-item {
  flex: 1;
  min-width: 100px;
}

.form-item .el-select {
  width: 100%;
}

.aspect-ratio-group {
  display: flex;
  width: 100%;
}

.aspect-ratio-group :deep(.el-radio-button) {
  flex: 1 1 0;
}

.aspect-ratio-group :deep(.el-radio-button__inner) {
  width: 100%;
  padding: 8px 0;
}

.ref-image-zone {
  border: 2px dashed #d1d5db;
  border-radius: 8px;
  padding: 0;
  text-align: center;
  transition: border-color .2s;
  min-height: 100px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  position: relative;
}

.ref-image-zone:hover,
.ref-image-zone:focus-within {
  border-color: #409eff;
}

.ref-image-zone.is-error {
  border-color: #f87171;
  background: #fef2f2;
}

.ref-image-zone.is-success {
  border-color: #86efac;
}

.ref-image-trigger {
  width: 100%;
  min-height: 96px;
  padding: 20px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
}

.ref-image-trigger:disabled {
  cursor: wait;
}

.ref-image-trigger:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: -4px;
}

.ref-preview {
  max-width: 100%;
  max-height: 150px;
  border-radius: 6px;
}

.upload-icon {
  font-size: 28px;
  color: #9ca3af;
}

.upload-icon.is-error,
.upload-tip.is-error {
  color: #b91c1c;
}

.upload-tip {
  font-size: 12px;
  color: #9ca3af;
  max-width: 100%;
  overflow-wrap: anywhere;
}

.ref-upload-status {
  min-height: 40px;
  margin: -8px 0 16px;
  padding: 8px 10px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: #4b5563;
  font-size: 12px;
}

.ref-upload-status.is-success {
  border-color: #86efac;
  background: #f0fdf4;
  color: #166534;
}

.ref-upload-status.is-error {
  border-color: #f87171;
  background: #fef2f2;
  color: #991b1b;
}

.ref-upload-status:focus-visible {
  outline: 2px solid #b91c1c;
  outline-offset: 2px;
}

.ref-upload-message {
  min-width: 0;
  flex: 1;
  overflow-wrap: anywhere;
}

.ref-actions {
  flex: 0 0 auto;
  display: flex;
  gap: 6px;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

.generate-btn {
  width: 100%;
  margin-top: 4px;
}

.result-panel {
  flex: 1;
  background: #fff;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 2px 8px rgba(0,0,0,.06);
  min-height: 400px;
}

.result-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.result-title {
  font-size: 16px;
  font-weight: 600;
  color: #1a1a2e;
}

.empty-result {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 300px;
  color: #9ca3af;
  gap: 12px;
}

.empty-icon {
  font-size: 48px;
}

.generating-tip {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #409eff;
  font-size: 14px;
  margin-bottom: 12px;
}

.result-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
}

.result-item {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
}

.result-media {
  background: #f9fafb;
  aspect-ratio: 16/9;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.result-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.result-image-button {
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: zoom-in;
}

.result-image-button:focus-visible {
  outline: 3px solid #2563eb;
  outline-offset: -3px;
}

.result-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.media-loading,
.media-error,
.media-cancelled {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: #6b7280;
  font-size: 12px;
}

.media-error {
  color: #ef4444;
}

.media-cancelled {
  color: #6b7280;
}

.result-meta {
  padding: 8px 10px;
}

.result-prompt {
  font-size: 12px;
  color: #6b7280;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.result-actions {
  margin-top: 6px;
  display: flex;
  gap: 6px;
}

</style>
