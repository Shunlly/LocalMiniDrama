/**
 * AI 配置页「一键生成并发设置」的读取、校验和保存。
 * 页面负责模板接线和未保存保护；这里处理加载状态、取消与 fail-closed 写入。
 */
import { computed, ref } from 'vue'
import { ElMessage as defaultElMessage } from 'element-plus'
import { generationSettingsAPI as defaultGenerationSettingsAPI } from '@/api/prompts.js'
import { generationSettingsFingerprint } from '@/composables/useAiConfigUnsaved.js'
import { runWithOwnedRequestErrorToast as defaultRunWithOwnedRequestErrorToast } from '@/utils/request.js'
import { toUserFacingError, isUserFacingAbort } from '@/utils/userFacingError.js'
import {
  DEFAULT_JSON_TIMEOUT_MS,
} from '@/utils/requestError.js'
import {
  clampGenerationConcurrency,
  describeGenerationSettingsLoadError,
  loadGenerationSettingsPayload,
  shouldIgnoreGenerationSettingsError,
  validateGenerationConcurrency,
} from '@/utils/aiConfigGenerationSettings.js'

export function useAiConfigGenerationSettings(deps = {}) {
  const generationSettingsAPI = deps.generationSettingsAPI || defaultGenerationSettingsAPI
  const ElMessage = deps.ElMessage || defaultElMessage
  const runWithOwnedRequestErrorToast = deps.runWithOwnedRequestErrorToast || defaultRunWithOwnedRequestErrorToast
  const delayMs = deps.delayMs

  const genConcurrencyInput = ref(null)
  const genVideoConcurrencyInput = ref(null)
  const genSettingSaving = ref(false)
  const genSettingSaved = ref(false)
  const generationSettingsBaseline = ref('')
  const generationSettingsLoadState = ref('loading')
  const generationSettingsLoadError = ref('')
  const generationSettingsWriteLocked = computed(() => generationSettingsLoadState.value !== 'ready' || genSettingSaving.value)
  const generationSettingsDirty = computed(() => (
    generationSettingsLoadState.value === 'ready'
    && Boolean(generationSettingsBaseline.value)
    && generationSettingsFingerprint(genConcurrencyInput.value, genVideoConcurrencyInput.value) !== generationSettingsBaseline.value
  ))

  let generationSettingsAbortController = null

  function abortGenerationSettingsRequest() {
    generationSettingsAbortController?.abort()
    generationSettingsAbortController = null
  }

  function rememberGenerationSettingsBaseline() {
    generationSettingsBaseline.value = generationSettingsFingerprint(
      genConcurrencyInput.value,
      genVideoConcurrencyInput.value,
    )
  }

  async function loadGenerationSettings() {
    generationSettingsAbortController?.abort()
    const controller = new AbortController()
    generationSettingsAbortController = controller
    generationSettingsLoadState.value = 'loading'
    try {
      const payload = await loadGenerationSettingsPayload(generationSettingsAPI, {
        signal: controller.signal,
        timeout: DEFAULT_JSON_TIMEOUT_MS,
        ...(delayMs === undefined ? {} : { delayMs }),
      })
      if (payload.aborted || controller.signal.aborted) return
      genConcurrencyInput.value = payload.concurrency
      genVideoConcurrencyInput.value = payload.videoConcurrency
      rememberGenerationSettingsBaseline()
      generationSettingsLoadError.value = ''
      generationSettingsLoadState.value = 'ready'
    } catch (error) {
      if (shouldIgnoreGenerationSettingsError(error, controller.signal)) return
      generationSettingsLoadError.value = describeGenerationSettingsLoadError(error, controller.signal)
      generationSettingsLoadState.value = 'error'
    } finally {
      if (generationSettingsAbortController === controller) {
        generationSettingsAbortController = null
      }
    }
  }

  function onConcurrencyChange(val) {
    const next = clampGenerationConcurrency(val)
    if (next != null) genConcurrencyInput.value = next
  }

  function onVideoConcurrencyChange(val) {
    const next = clampGenerationConcurrency(val)
    if (next != null) genVideoConcurrencyInput.value = next
  }

  async function saveGenerationSettings() {
    if (generationSettingsWriteLocked.value) {
      ElMessage.warning('生成设置尚未成功读取，请重试后再保存。')
      return
    }
    const n = Number(genConcurrencyInput.value)
    const nv = Number(genVideoConcurrencyInput.value)
    const invalid = validateGenerationConcurrency(n, nv)
    if (invalid) {
      ElMessage.warning(invalid)
      return
    }
    genSettingSaving.value = true
    genSettingSaved.value = false
    try {
      const concurrency = Math.round(n)
      const videoConcurrency = Math.round(nv)
      await runWithOwnedRequestErrorToast(() => generationSettingsAPI.update({ concurrency, video_concurrency: videoConcurrency }))
      genConcurrencyInput.value = concurrency
      genVideoConcurrencyInput.value = videoConcurrency
      rememberGenerationSettingsBaseline()
      genSettingSaved.value = true
      setTimeout(() => { genSettingSaved.value = false }, 2000)
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '保存失败'))
    } finally {
      genSettingSaving.value = false
    }
  }

  return {
    genConcurrencyInput,
    genVideoConcurrencyInput,
    genSettingSaving,
    genSettingSaved,
    generationSettingsBaseline,
    generationSettingsLoadState,
    generationSettingsLoadError,
    generationSettingsWriteLocked,
    generationSettingsDirty,
    loadGenerationSettings,
    saveGenerationSettings,
    onConcurrencyChange,
    onVideoConcurrencyChange,
    abortGenerationSettingsRequest,
  }
}
