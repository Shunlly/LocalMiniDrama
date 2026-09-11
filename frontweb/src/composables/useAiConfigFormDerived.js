/**
 * AI 配置表单派生状态：厂商/模型选项、默认模型联动。页面仍负责提交和 loadList/openTest。
 */
import { computed, watch } from 'vue'
import {
  parseModelText,
  hasDiscoverableCredential,
} from '@/utils/aiConfigDiscoverModels.js'
import { isDeepSeekOfficial } from '@/utils/aiConfigFormSettings.js'
import { applyProviderSelection } from '@/utils/aiConfigProviderSelection.js'
import {
  buildAvailableProviderOptions,
  buildAvailableModels,
  providerModelEmptyHint as describeProviderModelEmptyHint,
} from '@/utils/aiConfigProviderOptions.js'
import {
  applyServiceTypeChange,
  appendModelToList,
  applyPresetModelSelect,
} from '@/utils/aiConfigServiceTypeChange.js'
import { buildEndpointPreviewInfo } from '@/utils/aiConfigEndpointPreview.js'
import { isDefaultModelSelectionValid as isValidDefaultModelSelection } from '@/composables/useAiConfigUnsaved.js'

export function useAiConfigFormDerived(deps = {}) {
  const form = deps.form
  const editingId = deps.editingId
  const presetModelPick = deps.presetModelPick

  const formModelList = computed(() => parseModelText(form.value.modelText))
  const discoverModelsDisabledReason = computed(() => {
    if (!String(form.value.base_url || '').trim()) return '请先填写接口地址'
    if (hasDiscoverableCredential(form.value)) return ''
    return '请先填写 API 密钥后再读取模型'
  })
  const discoverModelsDisabled = computed(() => Boolean(discoverModelsDisabledReason.value))

  const isDeepSeekOfficialForm = computed(() => (
    form.value.service_type === 'text'
    && isDeepSeekOfficial(form.value.provider, form.value.base_url)
  ))

  const isComfyUiForm = computed(() => (
    ['image', 'storyboard_image'].includes(String(form.value.service_type || '').toLowerCase())
      && ['comfyui', 'comfy_ui'].includes(String(form.value.api_protocol || form.value.provider || '').toLowerCase())
  ))

  const isDefaultModelUnavailable = computed(() => {
    const selected = String(form.value.default_model || '').trim()
    return Boolean(selected && !formModelList.value.includes(selected))
  })

  function isDefaultModelSelectionValid(value) {
    return isValidDefaultModelSelection(value, {
      isComfyUi: isComfyUiForm.value,
      modelList: formModelList.value,
    })
  }

  /** 当前服务类型下的预设厂商列表（编辑时若当前 provider 不在列表则补一项；末尾始终附一项自定义入口） */
  const availableProviderOptions = computed(() => buildAvailableProviderOptions(
    form.value.service_type,
    form.value.provider,
    { editingId: editingId.value },
  ))

  /** 当前厂商的预设模型列表（用于追加预设模型） */
  const availableModels = computed(() => buildAvailableModels(form.value.service_type, form.value.provider))

  const providerModelEmptyHint = computed(() => describeProviderModelEmptyHint(
    form.value.service_type,
    form.value.provider,
    availableModels.value,
  ))

  const endpointPreviewInfo = computed(() => buildEndpointPreviewInfo(form.value))

  function onProviderChange(providerId) {
    applyProviderSelection(form.value, providerId, { editingId: editingId.value })
  }

  function onServiceTypeChange() {
    applyServiceTypeChange(form.value, { editingId: editingId.value })
  }

  function ensureModelInList(modelName) {
    appendModelToList(form.value, modelName)
  }

  function onPresetModelSelect(value) {
    applyPresetModelSelect(form.value, value)
    presetModelPick.value = ''
  }

  function onDefaultModelChange(value) {
    appendModelToList(form.value, value)
  }

  // 新增配置延续首项默认值；用户手填的自定义模型会同步进列表，避免被首项覆盖。编辑时保留已失效历史值。
  watch(
    () => [formModelList.value, form.value.default_model],
    () => {
      const list = formModelList.value
      const current = String(form.value.default_model || '').trim()
      if (current && !list.includes(current) && form.value.service_type !== 'jimeng2_character_auth') {
        if (!editingId.value) ensureModelInList(current)
        return
      }
      if (editingId.value || list.length === 0) return
      if (!current || !list.includes(current)) {
        form.value.default_model = list[0] || ''
      }
    },
    { immediate: true },
  )

  return {
    formModelList,
    discoverModelsDisabledReason,
    discoverModelsDisabled,
    isDeepSeekOfficialForm,
    isComfyUiForm,
    isDefaultModelUnavailable,
    isDefaultModelSelectionValid,
    availableProviderOptions,
    availableModels,
    providerModelEmptyHint,
    endpointPreviewInfo,
    onProviderChange,
    onServiceTypeChange,
    ensureModelInList,
    onPresetModelSelect,
    onDefaultModelChange,
  }
}