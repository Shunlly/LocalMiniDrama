import test from 'node:test'
import assert from 'node:assert/strict'
import { ref } from 'vue'
import { useFilmCreateProductionReadiness } from '../src/composables/filmCreate/useFilmCreateProductionReadiness.js'

const DRAMA_ID = 11
const EPISODE_ID = 22

function createReadiness(overrides = {}) {
  assert.notEqual(DRAMA_ID, EPISODE_ID)
  return useFilmCreateProductionReadiness({
    dramaId: ref(DRAMA_ID),
    productionReadinessLoading: ref(false),
    productionReadinessFailed: ref(false),
    authoritativeProductionReadiness: ref(null),
    videoCapabilityLoading: ref(false),
    videoCapabilityFailed: ref(false),
    videoCapabilityConfigs: ref([]),
    ...overrides,
  })
}

test('production readiness labels stay checking until the request settles', () => {
  const loading = ref(true)
  const failed = ref(false)
  const { productionReadinessState, productionReadinessReason, ttsCapabilityReason } = createReadiness({
    productionReadinessLoading: loading,
    productionReadinessFailed: failed,
  })
  assert.equal(productionReadinessState.value, 'checking')
  assert.match(productionReadinessReason.value, /正在检查完整成片所需的 AI 服务/)
  assert.match(ttsCapabilityReason.value, /正在检查语音合成配置/)
})

test('missing capabilities become a Chinese missing state and do not mix drama/episode ids', () => {
  const { productionReadinessState, productionReadinessReason, ttsCapabilityReason, productionCapabilityGaps } = createReadiness({
    authoritativeProductionReadiness: ref({
      ready: false,
      missing_capabilities: [
        { label: '视频模型', detail: '未配置已启用的视频服务', service_type: 'video' },
        { label: '语音合成', detail: '未配置已启用的 TTS 服务', service_type: 'tts' },
      ],
    }),
  })
  assert.equal(productionReadinessState.value, 'missing')
  assert.match(productionReadinessReason.value, /视频模型：未配置已启用的视频服务/)
  assert.match(productionReadinessReason.value, /语音合成：未配置已启用的 TTS 服务/)
  assert.equal(ttsCapabilityReason.value, '语音合成：未配置已启用的 TTS 服务')
  assert.equal(productionCapabilityGaps.value[0].service_type, 'video')
  assert.notEqual(DRAMA_ID, EPISODE_ID)
})

test('failed lookup reports a retryable Chinese error instead of ready', () => {
  const { productionReadinessState, productionReadinessReason, ttsCapabilityReason } = createReadiness({
    productionReadinessFailed: ref(true),
  })
  assert.equal(productionReadinessState.value, 'error')
  assert.equal(productionReadinessReason.value, '无法确认完整成片制作能力，请刷新后重试。')
  assert.match(ttsCapabilityReason.value, /无法确认语音合成配置/)
})
