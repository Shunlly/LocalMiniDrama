/**
 * AI 配置页一键厂商预设。页面仍负责弹窗接线和 loadList。
 */
import { ElMessage as defaultElMessage, ElMessageBox as defaultElMessageBox } from '@/utils/elementPlusFeedback.js'
import { aiAPI as defaultAiAPI } from '@/api/ai.js'
import { runAiConfigCreateBatch as defaultRunAiConfigCreateBatch } from '@/utils/aiConfigMutations.js'
import { toUserFacingError, isUserFacingAbort } from '@/utils/userFacingError.js'

/** 通义一键配置用 */
export const TONGYI_CONFIGS = [
  { service_type: 'text', name: '通义千问', base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', provider: 'qwen', model: ['qwen-plus'] },
  { service_type: 'image', name: '通义万象 文本生图', base_url: 'https://dashscope.aliyuncs.com', provider: 'dashscope', model: ['wan2.6-image'] },
  { service_type: 'image', name: '通义千问 文本生图', base_url: 'https://dashscope.aliyuncs.com', provider: 'qwen_image', model: ['qwen-image-max', 'qwen-image-plus', 'qwen-image'] },
  { service_type: 'storyboard_image', name: '通义万象 分镜图', base_url: 'https://dashscope.aliyuncs.com', provider: 'dashscope', model: ['wan2.6-image'] },
  { service_type: 'video', name: '通义万相', base_url: 'https://dashscope.aliyuncs.com', provider: 'dashscope', model: ['wan2.2-kf2v-flash'] }
]

/** 火山引擎一键配置用 */
export const VOLCENGINE_CONFIGS = [
  { service_type: 'text', name: '火山引擎 文本', base_url: 'https://ark.cn-beijing.volces.com/api/v3', provider: 'volcengine', model: ['deepseek-v3-2-251201', 'doubao-1-5-pro-32k-250115', 'kimi-k2-thinking-251104'] },
  { service_type: 'image', name: '火山引擎 即梦 文本生图', base_url: 'https://ark.cn-beijing.volces.com/api/v3', provider: 'volcengine', model: ['doubao-seedream-4-5-251128'] },
  { service_type: 'storyboard_image', name: '火山引擎 即梦 分镜图', base_url: 'https://ark.cn-beijing.volces.com/api/v3', provider: 'volcengine', model: ['doubao-seedream-4-5-251128'] },
  { service_type: 'video', name: '火山引擎 即梦 视频', base_url: 'https://ark.cn-beijing.volces.com/api/v3', provider: 'volces', model: ['doubao-seedance-1-5-pro-251215'] }
]

/** Agnes 一键配置用 */
export const AGNES_CONFIGS = [
  { service_type: 'text', name: 'Agnes 文本', base_url: 'https://apihub.agnes-ai.com/v1', provider: 'agnes', api_protocol: 'openai', model: ['agnes-2.0-flash'] },
  { service_type: 'image', name: 'Agnes 文本生图', base_url: 'https://apihub.agnes-ai.com/v1', provider: 'agnes', api_protocol: 'openai', model: ['agnes-image-2.1-flash'] },
  { service_type: 'storyboard_image', name: 'Agnes 分镜图', base_url: 'https://apihub.agnes-ai.com/v1', provider: 'agnes', api_protocol: 'openai', model: ['agnes-image-2.1-flash'] },
  { service_type: 'video', name: 'Agnes 视频', base_url: 'https://apihub.agnes-ai.com/v1', provider: 'agnes', api_protocol: 'agnes', endpoint: '/videos', query_endpoint: '/videos/{taskId}', model: ['agnes-video-v2.0'] },
]

export function useAiConfigOneKeyPresets(deps = {}) {
  const ElMessage = deps.ElMessage || defaultElMessage
  const ElMessageBox = deps.ElMessageBox || defaultElMessageBox
  const aiAPI = deps.aiAPI || defaultAiAPI
  const runAiConfigCreateBatch = deps.runAiConfigCreateBatch || defaultRunAiConfigCreateBatch
  const configWriteLocked = deps.configWriteLocked
  const oneKeyTongyiVisible = deps.oneKeyTongyiVisible
  const oneKeyTongyiKey = deps.oneKeyTongyiKey
  const oneKeyTongyiSaving = deps.oneKeyTongyiSaving
  const oneKeyVolcVisible = deps.oneKeyVolcVisible
  const oneKeyVolcKey = deps.oneKeyVolcKey
  const oneKeyVolcSaving = deps.oneKeyVolcSaving
  const oneKeyAgnesVisible = deps.oneKeyAgnesVisible
  const oneKeyAgnesKey = deps.oneKeyAgnesKey
  const oneKeyAgnesSaving = deps.oneKeyAgnesSaving
  const loadList = deps.loadList
  const list = deps.list
  const configLoadError = deps.configLoadError
  const invalidateConnectionTestResults = deps.invalidateConnectionTestResults
  const notifyConfigurationChanged = deps.notifyConfigurationChanged
  const revealSavedConfigs = deps.revealSavedConfigs

  function openOneKeyTongyi() {
    if (configWriteLocked.value) return
    oneKeyTongyiKey.value = ''
    oneKeyTongyiVisible.value = true
  }

  async function confirmCreatePreset(configs) {
    const count = Array.isArray(configs) ? configs.length : 0
    try {
      await ElMessageBox.confirm(
        `将创建 ${count} 条预设配置，并把它们设为对应服务的默认项。现有同类默认配置会被替换。预设只用于填表，不代表本应用已真实跑通对应厂商。是否继续？`,
        '一键创建确认',
        { type: 'warning', confirmButtonText: '确认创建', cancelButtonText: '取消' },
      )
      return true
    } catch (error) {
      if (!isUserFacingAbort(error)) {
        ElMessage.error(toUserFacingError(error, '无法确认创建'))
      }
      return false
    }
  }

  async function submitPresetConfigs(configs, apiKey, closeDialog) {
    const createOne = (cfg) => {
      const models = cfg.model || []
      return aiAPI.create({
        service_type: cfg.service_type,
        name: cfg.name,
        provider: cfg.provider,
        api_protocol: cfg.api_protocol || '',
        base_url: cfg.base_url,
        api_key: apiKey,
        model: models,
        default_model: models[0] || null,
        endpoint: cfg.endpoint || '',
        query_endpoint: cfg.query_endpoint || '',
        priority: 10,
        is_default: true,
      })
    }
    const result = await runAiConfigCreateBatch(configs, createOne)
    const message = `预设配置完成：${result.success} 条成功，${result.failed} 条失败`
    const createdIds = result.created.map((item) => Number(item?.id)).filter(Number.isFinite)
    const listConfirmed = await loadList()
    const createdVisible = createdIds.length === result.success
      && createdIds.every((id) => list.value.some((item) => Number(item.id) === id))
    if (result.success > 0 && (!listConfirmed || !createdVisible)) {
      const unconfirmedMessage = '预设配置已写入但列表尚未确认，请勿重复提交。请点击“重试”刷新列表。'
      configLoadError.value = configLoadError.value
        ? `${unconfirmedMessage} ${configLoadError.value}`
        : unconfirmedMessage
      ElMessage.error(unconfirmedMessage)
      return result
    }
    if (result.success > 0) {
      invalidateConnectionTestResults()
      notifyConfigurationChanged()
      revealSavedConfigs?.()
      closeDialog()
      ElMessage.success(message)
    } else {
      ElMessage.error(message)
    }
    return result
  }

  async function submitOneKeyTongyi() {
    if (configWriteLocked.value) return
    const apiKey = oneKeyTongyiKey.value.trim()
    if (!apiKey) return
    if (!await confirmCreatePreset(TONGYI_CONFIGS)) return
    if (configWriteLocked.value) return
    oneKeyTongyiSaving.value = true
    try {
      await submitPresetConfigs(TONGYI_CONFIGS, apiKey, () => {
        oneKeyTongyiVisible.value = false
      })
    } finally {
      oneKeyTongyiSaving.value = false
    }
  }

  function openOneKeyVolc() {
    if (configWriteLocked.value) return
    oneKeyVolcKey.value = ''
    oneKeyVolcVisible.value = true
  }

  async function submitOneKeyVolc() {
    if (configWriteLocked.value) return
    const apiKey = oneKeyVolcKey.value.trim()
    if (!apiKey) return
    if (!await confirmCreatePreset(VOLCENGINE_CONFIGS)) return
    if (configWriteLocked.value) return
    oneKeyVolcSaving.value = true
    try {
      await submitPresetConfigs(VOLCENGINE_CONFIGS, apiKey, () => {
        oneKeyVolcVisible.value = false
      })
    } finally {
      oneKeyVolcSaving.value = false
    }
  }

  function openOneKeyAgnes() {
    if (configWriteLocked.value) return
    oneKeyAgnesKey.value = ''
    oneKeyAgnesVisible.value = true
  }

  async function submitOneKeyAgnes() {
    if (configWriteLocked.value) return
    const apiKey = oneKeyAgnesKey.value.trim()
    if (!apiKey) return
    if (!await confirmCreatePreset(AGNES_CONFIGS)) return
    if (configWriteLocked.value) return
    oneKeyAgnesSaving.value = true
    try {
      await submitPresetConfigs(AGNES_CONFIGS, apiKey, () => {
        oneKeyAgnesVisible.value = false
      })
    } finally {
      oneKeyAgnesSaving.value = false
    }
  }

  return {
    openOneKeyTongyi,
    submitOneKeyTongyi,
    openOneKeyVolc,
    submitOneKeyVolc,
    openOneKeyAgnes,
    submitOneKeyAgnes,
    submitPresetConfigs,
  }
}
