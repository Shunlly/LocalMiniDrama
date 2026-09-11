import { computed, nextTick, ref, watch } from 'vue'
import { ElMessage } from '@/utils/elementPlusFeedback.js'
import { aiAPI } from '@/api/ai'
import { assetsAPI } from '@/api/assets'
import { imagesAPI } from '@/api/images'
import { taskAPI } from '@/api/task'
import { videosAPI } from '@/api/videos'
import { uploadAPI } from '@/api/upload'
import { generationSettingsAPI } from '@/api/prompts'
import {
  applyGeneratedMediaToItem,
  getFreeCreateSaveAriaLabel,
  getFreeCreateSaveDisabledReason,
  positiveFreeCreateId,
  resolveFreeCreateAssetDramaId,
  restoreFreeCreateResults,
  resultFromAsset,
  saveFreeCreateResultToAssets,
  writeFreeCreateHistory,
} from '@/components/freeCreate/freeCreateAssetSave.js'
import { getServiceConfigReadiness } from '@/utils/aiServiceReadiness'
import {
  buildFreeCreateGenerationPayload,
  createFreeCreateTaskOwner,
  FREE_CREATE_LEAVE_CONFIRM_MESSAGE,
  FREE_CREATE_UPLOAD_LEAVE_MESSAGE,
  getFreeCreateAspectRatioOptions,
  getFreeCreateBusyDisabledReason,
  getFreeCreateCapabilityNotice,
  getFreeCreateEmptyResultCopy,
  getFreeCreateGenerateDisabledReason,
  getFreeCreateReadyMessage,
  getReferenceUploadBlockReason,
  normalizeFreeCreateAspectRatio,
  parseFreeCreateTaskResult,
  pollFreeCreateTask,
  shouldBlockFreeCreateUnload,
  toFreeCreateUserError,
} from '@/utils/freeCreate'

function defaultFreeCreateStorage() {
  try {
    return globalThis.localStorage || null
  } catch (_) {
    return null
  }
}

export function useFreeCreateWorkspace({
  router,
  route,
  getRefImageInput,
  getRefImageUploadStatusEl,
  assetsApi,
  imagesApi,
  videosApi,
  taskApi,
  uploadApi,
  aiApi,
  generationSettingsApi,
  storage,
} = {}) {
  const assetsClient = assetsApi || assetsAPI
  const imagesClient = imagesApi || imagesAPI
  const videosClient = videosApi || videosAPI
  const taskClient = taskApi || taskAPI
  const uploadClient = uploadApi || uploadAPI
  const aiClient = aiApi || aiAPI
  const generationSettingsClient = generationSettingsApi || generationSettingsAPI
  const resultStorage = storage === undefined ? defaultFreeCreateStorage() : storage
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
  const refImageFile = ref(null)
  const refImageFileName = ref('参考图')
  const refImageUploadStatus = ref('idle')
  const refImageUploadError = ref('')
  const refImageInput = {
    get value() {
      return getRefImageInput?.() ?? null
    },
  }
  const refImageUploadStatusRef = {
    get value() {
      return getRefImageUploadStatusEl?.() ?? null
    },
  }
  let refImageUploadAttempt = 0
  /** 与后端视频异步超时一致（分钟 → 毫秒） */
  const videoPollMaxMs = ref(30 * 60 * 1000)
  const aiConfigs = ref([])
  const configLoadState = ref('loading')
  const freeCreateTaskOwner = createFreeCreateTaskOwner((taskId, body) => (
    taskClient.cancel(taskId, body, { suppressErrorToast: true })
  ))
  let unregisterLeaveProtection = null
  let restoringResults = false
  const assetSaveTargetDramaId = computed(() => resolveFreeCreateAssetDramaId(route))
  const assetSaveTargetLabel = computed(() => (
    assetSaveTargetDramaId.value ? '当前项目素材中心' : '全局素材中心'
  ))

  function persistResults() {
    if (restoringResults) return
    writeFreeCreateHistory(resultStorage, results.value)
  }

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
  const generateDisabledReason = computed(() => getFreeCreateGenerateDisabledReason({
    generating: generating.value,
    capabilityReady: generationCapability.value.ready,
    capabilityNotice: generationUnavailableNotice(),
    serviceLabel: activeServiceLabel.value,
    referenceUploadBlockReason: referenceUploadBlockReason.value,
    prompt: prompt.value,
  }))
  const resultBusyDisabledReason = computed(() => getFreeCreateBusyDisabledReason({
    cancelling: cancelling.value,
    generating: generating.value,
  }))
  const emptyResultCopy = computed(() => getFreeCreateEmptyResultCopy({
    status: generationCapability.value.status,
    ready: generationCapability.value.ready,
    serviceLabel: activeServiceLabel.value,
  }))

  watch(mode, (nextMode) => {
    aspectRatio.value = normalizeFreeCreateAspectRatio(nextMode, aspectRatio.value)
  }, { immediate: true })

  watch(results, persistResults, { deep: true })

  function goBack() {
    router.push({ name: 'list' })
  }

  async function loadGenerationSettings() {
    try {
      const res = await generationSettingsClient.get()
      const m = Math.max(1, Number(res?.video_generation_timeout_minutes) || 30)
      videoPollMaxMs.value = m * 60 * 1000
    } catch (_) {}
  }

  async function loadServiceConfigs() {
    configLoadState.value = 'loading'
    try {
      aiConfigs.value = await aiClient.list()
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

  function handleBeforeUnload(event) {
    if (!shouldBlockFreeCreateUnload({
      uploading: refImageUploadStatus.value === 'uploading',
      hasActive: freeCreateTaskOwner.hasActive(),
    })) return
    event.preventDefault()
    event.returnValue = ''
  }

  async function confirmFreeCreateLeave() {
    if (refImageUploadStatus.value === 'uploading') {
      ElMessage.warning(FREE_CREATE_UPLOAD_LEAVE_MESSAGE)
      return false
    }
    if (!freeCreateTaskOwner.hasActive()) return true
    if (!window.confirm(FREE_CREATE_LEAVE_CONFIRM_MESSAGE)) return false
    return cancelActiveGeneration('用户离开自由创作页面')
  }

  function mount(leaveProtection) {
    unregisterLeaveProtection = leaveProtection?.register?.('free-create', {
      shouldBlockUnload: () => shouldBlockFreeCreateUnload({
        uploading: refImageUploadStatus.value === 'uploading',
        hasActive: freeCreateTaskOwner.hasActive(),
      }),
      confirmLeave: () => confirmFreeCreateLeave(),
    }) || null
    const requestedMode = Array.isArray(route.query.mode) ? route.query.mode[0] : route.query.mode
    if (requestedMode === 'image' || requestedMode === 'video') mode.value = requestedMode
    return Promise.all([loadGenerationSettings(), loadServiceConfigs(), restorePersistedResults()])
  }

  async function restorePersistedResults() {
    restoringResults = true
    try {
      results.value = await restoreFreeCreateResults({
        storage: resultStorage,
        assetsApi: assetsClient,
        imagesApi: imagesClient,
        videosApi: videosClient,
        taskApi: taskClient,
        dramaId: assetSaveTargetDramaId.value,
      })
    } catch (error) {
      ElMessage.error(toFreeCreateUserError(error, '无法从素材中心恢复生成结果'))
    } finally {
      restoringResults = false
      persistResults()
    }
  }

  function unmount() {
    unregisterLeaveProtection?.()
    unregisterLeaveProtection = null
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
      const res = await uploadClient.uploadImage(file)
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
    persistResults()
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
      localPath: null,
      error: null,
      taskId: null,
      imageGenId: null,
      videoGenId: null,
      assetId: null,
      assetDramaId: null,
      savingAsset: false,
      assetSaveError: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
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
    item.localPath = null
    item.error = null
    item.assetSaveError = ''
    item.savingAsset = false
    item.updatedAt = new Date().toISOString()
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
        const res = await freeCreateTaskOwner.trackSubmission(run, imagesClient.create(body))
        if (freeCreateTaskOwner.isActive(run)) {
          activeTaskId.value = run.taskId
          item.taskId = run.taskId || res?.task_id || item.taskId
        }
        if (res?.id) item.imageGenId = res.id
        if (await waitForPendingCancellation(run)) return
        if (res?.task_id) {
          await pollImageTask(res.task_id, item, run)
        } else if (res?.image_url || res?.local_path) {
          applyGeneratedMediaToItem(item, {
            url: res.image_url,
            localPath: res.local_path,
            imageGenId: res.id,
            taskId: res.task_id || run.taskId,
          })
          item.status = 'completed'
          item.updatedAt = new Date().toISOString()
        } else {
          failResultItem(item, '提交成功但未返回图片任务或结果')
        }
      } else {
        const res = await freeCreateTaskOwner.trackSubmission(run, videosClient.create(body))
        if (freeCreateTaskOwner.isActive(run)) {
          activeTaskId.value = run.taskId
          item.taskId = run.taskId || res?.task_id || item.taskId
        }
        if (res?.id) item.videoGenId = res.id
        if (await waitForPendingCancellation(run)) return
        if (res?.task_id) {
          await pollVideoTask(res.task_id, item, run)
        } else if (res?.video_url || res?.local_path) {
          applyGeneratedMediaToItem(item, {
            url: res.video_url,
            localPath: res.local_path,
            videoGenId: res.id,
            taskId: res.task_id || run.taskId,
          })
          item.status = 'completed'
          item.updatedAt = new Date().toISOString()
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
      persistResults()
    }
  }

  function failResultItem(item, message) {
    item.status = 'failed'
    item.error = toFreeCreateUserError(message, '生成失败，请稍后重试')
  }

  async function pollImageTask(taskId, item, run, maxMs = 180000) {
    return pollFreeCreateTask({
      taskId,
      item,
      run,
      maxMs,
      intervalMs: 3000,
      waitForPendingCancellation,
      fetchTask: (id) => taskClient.get(id, { suppressErrorToast: true }),
      failResultItem,
      async resolveCompletedItem(res, current) {
        const r = parseFreeCreateTaskResult(res.result)
        applyGeneratedMediaToItem(current, {
          url: r.image_url,
          localPath: r.local_path,
          imageGenId: r.image_generation_id,
          taskId,
        })
        current.updatedAt = new Date().toISOString()
      },
    })
  }

  async function pollVideoTask(taskId, item, run) {
    return pollFreeCreateTask({
      taskId,
      item,
      run,
      maxMs: videoPollMaxMs.value,
      intervalMs: 4000,
      waitForPendingCancellation,
      fetchTask: (id) => taskClient.get(id, { suppressErrorToast: true }),
      failResultItem,
      async resolveCompletedItem(res, current) {
        const r = parseFreeCreateTaskResult(res.result)
        applyGeneratedMediaToItem(current, {
          url: r.video_url,
          localPath: r.local_path,
          videoGenId: r.video_generation_id,
          taskId,
        })
        const vgId = r.video_generation_id
        if (vgId) {
          try {
            const vRes = await videosClient.get(vgId)
            applyGeneratedMediaToItem(current, {
              url: vRes?.video_url || current.url,
              localPath: vRes?.local_path,
              videoGenId: vgId,
              taskId,
            })
          } catch (error) {
            return { retry: true, error: toFreeCreateUserError(error, '视频结果读取失败') }
          }
        }
        current.updatedAt = new Date().toISOString()
      },
    })
  }

  function saveItemDisabledReason(item) {
    return getFreeCreateSaveDisabledReason(item, {
      generating: generating.value,
      cancelling: cancelling.value,
      busyReason: resultBusyDisabledReason.value,
    })
  }

  function saveItemAriaLabel(item) {
    return getFreeCreateSaveAriaLabel(item, {
      generating: generating.value,
      cancelling: cancelling.value,
      busyReason: resultBusyDisabledReason.value,
      targetLabel: assetSaveTargetLabel.value,
    })
  }

  async function saveItemToAssets(item) {
    if (!item || item.savingAsset) return false
    const disabledReason = saveItemDisabledReason(item)
    if (disabledReason) {
      if (positiveFreeCreateId(item.assetId)) {
        ElMessage.info('该结果已保存到素材中心')
        return true
      }
      ElMessage.warning(disabledReason)
      return false
    }
    item.savingAsset = true
    item.assetSaveError = ''
    try {
      const asset = await saveFreeCreateResultToAssets(item, {
        assetsApi: assetsClient,
        dramaId: assetSaveTargetDramaId.value,
      })
      const mapped = resultFromAsset(asset)
      if (!mapped?.assetId) throw new Error('素材保存失败：未返回有效素材编号')
      item.assetId = mapped.assetId
      item.assetDramaId = mapped.assetDramaId
      item.localPath = mapped.localPath || item.localPath
      item.url = mapped.url || item.url
      item.updatedAt = new Date().toISOString()
      persistResults()
      ElMessage.success(assetSaveTargetDramaId.value ? '已保存到当前项目素材中心' : '已保存到全局素材中心')
      return true
    } catch (error) {
      item.assetSaveError = toFreeCreateUserError(error, '保存到素材中心失败，请稍后重试')
      ElMessage.error(item.assetSaveError)
      return false
    } finally {
      item.savingAsset = false
    }
  }


  return {
    mode,
    prompt,
    style,
    aspectRatio,
    duration,
    generating,
    cancelling,
    activeTaskId,
    results,
    showImagePreview,
    previewImage,
    refImageDataUrl,
    refImageFileName,
    refImageUploadStatus,
    generationCapability,
    activeServiceLabel,
    aspectRatioOptions,
    refImageTriggerLabel,
    refImageUploadMessage,
    generateDisabled,
    generateDisabledReason,
    resultBusyDisabledReason,
    emptyResultCopy,
    goBack,
    loadServiceConfigs,
    openAiConfig,
    generate,
    triggerRefImageUpload,
    onRefImageDrop,
    onRefImageChange,
    retryRefImageUpload,
    clearRefImage,
    clearResults,
    cancelGeneration,
    retryGeneration,
    downloadItem,
    resultImageAlt,
    canRetryItem,
    openImagePreview,
    assetSaveTargetDramaId,
    assetSaveTargetLabel,
    saveItemDisabledReason,
    saveItemAriaLabel,
    saveItemToAssets,
    confirmFreeCreateLeave,
    handleBeforeUnload,
    mount,
    unmount,
  }
}
