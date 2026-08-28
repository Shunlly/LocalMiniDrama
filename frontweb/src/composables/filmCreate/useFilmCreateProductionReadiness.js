import { computed } from 'vue'
import { ElMessageBox } from 'element-plus'
import { createLatestRequestGuard } from '@/utils/latestRequest.js'
import { requestCoreJson } from '@/utils/coreJsonRequest'
import { normalizeProductionReadiness } from '@/utils/sourceWorkflowLaunch'
import { getVideoGenerationCapability } from '@/utils/filmCreateActionState'
import { videoConfigSupportsOmni } from '@/utils/storyboardVideoRequest'

export function useFilmCreateProductionReadiness(deps = {}) {
  const {
    dramaId,
    productionReadinessLoading,
    productionReadinessFailed,
    authoritativeProductionReadiness,
    videoCapabilityLoading,
    videoCapabilityFailed,
    videoCapabilityConfigs,
  } = deps

  const videoGenerationCapability = computed(() => getVideoGenerationCapability(
    videoCapabilityConfigs.value,
    { loading: videoCapabilityLoading.value, failed: videoCapabilityFailed.value },
  ))
  const videoCapabilityReason = computed(() => videoGenerationCapability.value.reason)
  const productionCapabilityGaps = computed(() => (
    authoritativeProductionReadiness.value?.missing_capabilities || []
  ))
  const productionReadinessState = computed(() => {
    if (productionReadinessLoading.value) return 'checking'
    if (productionReadinessFailed.value) return 'error'
    return productionCapabilityGaps.value.length ? 'missing' : 'ready'
  })
  const productionReadinessReason = computed(() => {
    if (productionReadinessLoading.value) return '正在检查完整成片所需的 AI 服务与本地合成能力。'
    if (productionReadinessFailed.value) return '无法确认完整成片制作能力，请刷新后重试。'
    if (!productionCapabilityGaps.value.length) return ''
    return productionCapabilityGaps.value
      .map((gap) => `${gap.label}：${gap.detail}`)
      .join('；')
  })
  const ttsCapabilityReason = computed(() => {
    if (productionReadinessLoading.value) return '正在检查语音合成配置，请稍候。'
    if (productionReadinessFailed.value) return '无法确认语音合成配置，请刷新后重试或前往 AI 配置检查。'
    const gap = productionCapabilityGaps.value.find((item) => item?.service_type === 'tts')
    return gap ? `${gap.label}：${gap.detail}` : ''
  })

  let activeVideoAiConfigCache = null
  let activeVideoAiConfigCacheAt = 0
  const ACTIVE_VIDEO_AI_CONFIG_TTL_MS = 15000
  const productionReadinessRequestGuard = createLatestRequestGuard()
  const videoCapabilityRequestGuard = createLatestRequestGuard()

  function invalidateActiveVideoAiConfigCache() {
    activeVideoAiConfigCache = null
    activeVideoAiConfigCacheAt = 0
  }

  function getNovel2AnimeReadiness(data) {
    return requestCoreJson('/workflows/novel2anime/readiness', { method: 'POST', body: data })
  }

  async function refreshProductionReadiness() {
    const requestGeneration = productionReadinessRequestGuard.begin()
    productionReadinessRequestGuard.commit(requestGeneration, () => {
      productionReadinessLoading.value = true
      productionReadinessFailed.value = false
      authoritativeProductionReadiness.value = null
    })
    try {
      const readiness = await getNovel2AnimeReadiness({
        drama_id: dramaId.value,
        qa_mode: 'production',
      })
      productionReadinessRequestGuard.commit(requestGeneration, () => {
        authoritativeProductionReadiness.value = normalizeProductionReadiness(readiness)
      })
    } catch (_) {
      productionReadinessRequestGuard.commit(requestGeneration, () => {
        productionReadinessFailed.value = true
      })
    } finally {
      productionReadinessRequestGuard.commit(requestGeneration, () => {
        productionReadinessLoading.value = false
      })
    }
    return {
      ready: !productionReadinessFailed.value
        && Boolean(authoritativeProductionReadiness.value?.ready),
      reason: productionReadinessReason.value,
    }
  }

  async function refreshVideoGenerationCapability() {
    const requestGeneration = videoCapabilityRequestGuard.begin()
    videoCapabilityRequestGuard.commit(requestGeneration, () => {
      videoCapabilityLoading.value = true
      videoCapabilityFailed.value = false
    })
    let capability
    try {
      const rows = await requestCoreJson('/ai-configs?service_type=video')
      const normalizedRows = Array.isArray(rows) ? rows : []
      capability = getVideoGenerationCapability(normalizedRows)
      videoCapabilityRequestGuard.commit(requestGeneration, () => {
        videoCapabilityConfigs.value = normalizedRows
        activeVideoAiConfigCache = capability.config
      })
    } catch (_) {
      capability = getVideoGenerationCapability([], { failed: true })
      videoCapabilityRequestGuard.commit(requestGeneration, () => {
        videoCapabilityConfigs.value = []
        videoCapabilityFailed.value = true
        activeVideoAiConfigCache = null
      })
    } finally {
      videoCapabilityRequestGuard.commit(requestGeneration, () => {
        activeVideoAiConfigCacheAt = Date.now()
        videoCapabilityLoading.value = false
      })
    }
    return videoCapabilityRequestGuard.isLatest(requestGeneration)
      ? capability
      : videoGenerationCapability.value
  }

  async function getActiveVideoAiConfig() {
    const now = Date.now()
    if (now - activeVideoAiConfigCacheAt < ACTIVE_VIDEO_AI_CONFIG_TTL_MS) {
      return activeVideoAiConfigCache
    }
    const capability = await refreshVideoGenerationCapability()
    return capability.config
  }

  /** 全能分镜 + 当前视频配置是否可走多图参考（火山 Seedance 2.0、可灵 Omni、Agnes Video 等） */
  function canUseUniversalOmniVideoApi(cfg) {
    return videoConfigSupportsOmni(cfg)
  }

  async function confirmUniversalNonSeedance2Video() {
    await ElMessageBox.confirm(
      '你当前视频模型不支持多图参考，全能模式将降级：优先用分镜主图，否则仅传场景参考图。是否继续？',
      '全能模式与模型不匹配',
      { confirmButtonText: '继续', cancelButtonText: '取消', type: 'warning' }
    )
  }

  return {
    invalidateActiveVideoAiConfigCache,
    getNovel2AnimeReadiness,
    refreshProductionReadiness,
    refreshVideoGenerationCapability,
    getActiveVideoAiConfig,
    canUseUniversalOmniVideoApi,
    confirmUniversalNonSeedance2Video,
    videoGenerationCapability,
    videoCapabilityReason,
    productionCapabilityGaps,
    productionReadinessState,
    productionReadinessReason,
    ttsCapabilityReason,
  }
}
